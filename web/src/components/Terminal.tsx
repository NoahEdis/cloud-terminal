"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ChevronDown } from "lucide-react";
import { getWebSocketUrl, pollOutput, sendInput } from "@/lib/api";
import type { WebSocketMessage } from "@/lib/types";

interface TerminalProps {
  sessionId: string;
  onExit?: (code: number) => void;
  onError?: (error: string) => void;
}

export interface TerminalHandle {
  scrollToBottom: () => void;
}

// Reconnection settings
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

// Clean malformed escape sequences from terminal output
// This handles cases where OSC sequences or DA responses get corrupted/truncated
function cleanTerminalOutput(data: string): string {
  // Remove orphaned OSC-like sequences without proper ESC prefix
  // Pattern: ]0; or >0; followed by text until BEL (\x07) or ST (\x1b\\) or end
  // These appear when the ESC character gets stripped
  let cleaned = data.replace(/[>\]]0;[^\x07\x1b]*(?:\x07|\x1b\\)?/g, "");

  // Remove corrupted DA (Device Attributes) responses like ">0;276c"
  // Normal DA response is ESC [ ? ... c, but corrupted ones lose the ESC [
  cleaned = cleaned.replace(/>[\d;]+c/g, "");

  // Remove orphaned CSI sequences without ESC prefix (starting with [ directly)
  // But be careful not to remove legitimate bracket content
  cleaned = cleaned.replace(/(?<!\x1b)\[[\d;]*[A-Za-z]/g, (match) => {
    // Only remove if it looks like a CSI sequence parameter (numbers and ; only before letter)
    if (/^\[[\d;]+[A-Za-z]$/.test(match)) {
      return "";
    }
    return match;
  });

  return cleaned;
}

export default function Terminal({ sessionId, onExit, onError }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const offsetRef = useRef<number>(0);
  const usingPollingRef = useRef<boolean>(false);
  const initializedRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>(sessionId);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const lastScrollCheckRef = useRef<number>(0);

  // Reconnection state
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);

  // Keep sessionId ref updated
  sessionIdRef.current = sessionId;

  // Check if terminal is scrolled to bottom (with tolerance for edge cases)
  const checkIfAtBottom = useCallback(() => {
    if (!xtermRef.current) return true;
    const buffer = xtermRef.current.buffer.active;
    // Add a small tolerance (2 lines) to handle edge cases
    const tolerance = 2;
    return buffer.viewportY >= buffer.baseY - tolerance;
  }, []);

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.scrollToBottom();
      setShowScrollButton(false);
    }
  }, []);

  // Stop polling - defined first so it can be used by startPolling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Start HTTP polling fallback
  const startPolling = useCallback(() => {
    if (pollingRef.current) return; // Already polling
    usingPollingRef.current = true;
    xtermRef.current?.writeln("\x1b[33mUsing HTTP polling mode\x1b[0m\r\n");

    const poll = async () => {
      try {
        const response = await pollOutput(sessionId, offsetRef.current);
        if (response.output) {
          xtermRef.current?.write(cleanTerminalOutput(response.output));
        }
        offsetRef.current = response.offset;

        if (response.status === "exited" && response.exitCode !== undefined) {
          xtermRef.current?.writeln(`\r\n\x1b[33mSession exited with code ${response.exitCode}\x1b[0m`);
          onExit?.(response.exitCode);
          stopPolling();
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    };

    // Poll immediately, then every 100ms
    poll();
    pollingRef.current = setInterval(poll, 100);
  }, [sessionId, onExit, stopPolling]);

  // Calculate reconnection delay with exponential backoff
  const getReconnectDelay = useCallback(() => {
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
      MAX_RECONNECT_DELAY
    );
    return delay;
  }, []);

  const connect = useCallback(() => {
    if (!xtermRef.current) return;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = getWebSocketUrl(sessionId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      // Show reconnected message if we had previous attempts
      if (reconnectAttemptsRef.current > 0) {
        xtermRef.current?.writeln("\x1b[32mReconnected\x1b[0m\r\n");
      } else {
        xtermRef.current?.writeln("\x1b[32mConnected to session\x1b[0m\r\n");
      }

      // Reset reconnection attempts on successful connection
      reconnectAttemptsRef.current = 0;

      // Send initial resize
      if (fitAddonRef.current && xtermRef.current) {
        try {
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims) {
            ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch (e) {
          console.warn("Failed to send initial resize:", e);
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "output":
            xtermRef.current?.write(cleanTerminalOutput(msg.data));
            break;
          case "history":
            xtermRef.current?.write(cleanTerminalOutput(msg.data));
            // Scroll to bottom after history loads
            setTimeout(() => {
              xtermRef.current?.scrollToBottom();
            }, 50);
            break;
          case "exit":
            intentionalCloseRef.current = true; // Don't reconnect on exit
            xtermRef.current?.writeln(`\r\n\x1b[33mSession exited with code ${msg.code}\x1b[0m`);
            onExit?.(msg.code);
            break;
          case "error":
            xtermRef.current?.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
            onError?.(msg.message);
            break;
          case "ping":
            // Respond to server pings to keep connection alive
            try {
              ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
            } catch {
              // Ignore send errors
            }
            break;
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    };

    ws.onclose = (event) => {
      // Don't reconnect if it was intentional or session exited
      if (intentionalCloseRef.current) {
        return;
      }

      // 1000 = normal close, 1005 = no status received (normal for some scenarios)
      const isAbnormalClose = event.code !== 1000 && event.code !== 1005;

      if (isAbnormalClose) {
        xtermRef.current?.writeln(`\r\n\x1b[33mConnection closed (${event.code})\x1b[0m`);
      }

      // Try to reconnect if we haven't exceeded max attempts
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS && !usingPollingRef.current) {
        const delay = getReconnectDelay();
        reconnectAttemptsRef.current++;

        xtermRef.current?.writeln(`\x1b[33mReconnecting in ${delay / 1000}s... (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})\x1b[0m`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else if (!usingPollingRef.current) {
        // Max attempts reached, fall back to polling
        xtermRef.current?.writeln("\x1b[33mMax reconnection attempts reached. Falling back to HTTP polling...\x1b[0m\r\n");
        startPolling();
      }
    };

    ws.onerror = () => {
      // Don't log error if we're already using polling or intentionally closed
      if (!usingPollingRef.current && !intentionalCloseRef.current) {
        xtermRef.current?.writeln("\r\n\x1b[31mWebSocket error\x1b[0m");
      }
      // Note: onclose will be called after onerror, which handles reconnection
    };
  }, [sessionId, onExit, onError, startPolling, getReconnectDelay]);

  useEffect(() => {
    // Prevent re-initialization on re-renders
    if (initializedRef.current || !terminalRef.current) return;
    initializedRef.current = true;

    // Create terminal with minimal monochrome theme
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontWeight: "400",
      letterSpacing: 0,
      lineHeight: 1.3,
      scrollback: 10000,
      scrollOnUserInput: true,
      allowProposedApi: true,
      theme: {
        background: "#09090b", // zinc-950
        foreground: "#e4e4e7", // zinc-200
        cursor: "#a1a1aa", // zinc-400
        cursorAccent: "#09090b",
        selectionBackground: "rgba(161, 161, 170, 0.25)", // zinc-400 with opacity
        selectionForeground: "#fafafa", // zinc-50
        black: "#18181b", // zinc-900
        red: "#f87171", // red-400
        green: "#4ade80", // green-400
        yellow: "#facc15", // yellow-400
        blue: "#60a5fa", // blue-400
        magenta: "#c084fc", // purple-400
        cyan: "#22d3ee", // cyan-400
        white: "#e4e4e7", // zinc-200
        brightBlack: "#52525b", // zinc-600
        brightRed: "#fca5a5", // red-300
        brightGreen: "#86efac", // green-300
        brightYellow: "#fde047", // yellow-300
        brightBlue: "#93c5fd", // blue-300
        brightMagenta: "#d8b4fe", // purple-300
        brightCyan: "#67e8f9", // cyan-300
        brightWhite: "#fafafa", // zinc-50
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Delay fit() to ensure DOM is ready and has dimensions
    // This prevents "Cannot read properties of undefined (reading 'dimensions')" errors
    requestAnimationFrame(() => {
      if (terminalRef.current && terminalRef.current.offsetWidth > 0 && terminalRef.current.offsetHeight > 0) {
        try {
          fitAddon.fit();
        } catch (e) {
          console.warn("Terminal fit failed, will retry on resize:", e);
        }
      }
    });

    // Smooth scrolling for terminal viewport
    const termElement = terminalRef.current;
    const viewport = termElement.querySelector('.xterm-viewport') as HTMLElement;

    // Apply smooth scroll CSS to the viewport
    if (viewport) {
      viewport.style.scrollBehavior = 'auto'; // Use auto for immediate response, CSS handles smoothing
    }

    // Custom wheel handler for smooth scrolling
    // xterm's default wheel handling can be janky, so we use viewport scrollTop directly
    const handleWheel = (e: WheelEvent) => {
      if (!viewport) return;

      // Get scroll amount in pixels
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) {
        // Lines to pixels (roughly 20px per line)
        deltaY *= 20;
      } else if (e.deltaMode === 2) {
        // Pages to pixels
        deltaY *= viewport.clientHeight;
      }

      // Apply scroll directly to viewport for smooth scrolling
      viewport.scrollTop += deltaY;

      e.preventDefault();
      e.stopPropagation();
    };

    // Add wheel handler
    termElement.addEventListener('wheel', handleWheel, { capture: true, passive: false });

    // Mobile touch scrolling
    let touchStartY = 0;
    let lastTouchY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        lastTouchY = touchStartY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!viewport || e.touches.length !== 1) return;

      const touchY = e.touches[0].clientY;
      const deltaY = lastTouchY - touchY;
      lastTouchY = touchY;

      // Apply scroll directly
      viewport.scrollTop += deltaY;
      e.preventDefault();
    };

    termElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    termElement.addEventListener('touchmove', handleTouchMove, { passive: false });

    // Store handlers for cleanup
    const cleanupScrollHandlers = () => {
      termElement.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
      termElement.removeEventListener('touchstart', handleTouchStart);
      termElement.removeEventListener('touchmove', handleTouchMove);
      if (viewport) {
        viewport.removeEventListener('scroll', handleViewportScroll);
      }
      if (scrollButtonTimeout) {
        clearTimeout(scrollButtonTimeout);
      }
      if (writeTimeout) {
        clearTimeout(writeTimeout);
      }
    };

    // Track scroll position to show/hide scroll button
    // Use a simple scroll event listener on the viewport instead of xterm's onScroll
    let scrollButtonTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateScrollButton = () => {
      const isAtBottom = checkIfAtBottom();
      setShowScrollButton(!isAtBottom);
    };

    const handleViewportScroll = () => {
      // Debounce scroll button updates to reduce state churn
      if (scrollButtonTimeout) {
        clearTimeout(scrollButtonTimeout);
      }
      scrollButtonTimeout = setTimeout(updateScrollButton, 150);
    };

    if (viewport) {
      viewport.addEventListener('scroll', handleViewportScroll, { passive: true });
    }

    // Check scroll position when new content is written (debounced)
    let writeTimeout: ReturnType<typeof setTimeout> | null = null;
    term.onWriteParsed(() => {
      if (writeTimeout) {
        clearTimeout(writeTimeout);
      }
      writeTimeout = setTimeout(updateScrollButton, 200);
    });

    // Handle input - use WebSocket if available, otherwise HTTP
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      } else if (usingPollingRef.current) {
        // Use HTTP API to send input when in polling mode
        sendInput(sessionIdRef.current, data).catch((e) => {
          console.error("Failed to send input:", e);
        });
      }
    });

    // Handle resize
    const handleResize = () => {
      // Only fit if terminal has dimensions
      if (!terminalRef.current || terminalRef.current.offsetWidth === 0 || terminalRef.current.offsetHeight === 0) {
        return;
      }
      try {
        fitAddon.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsRef.current.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        }
      } catch (e) {
        console.warn("Resize failed:", e);
      }
    };

    window.addEventListener("resize", handleResize);

    // Connect to WebSocket
    connect();

    return () => {
      window.removeEventListener("resize", handleResize);
      cleanupScrollHandlers();
      // Mark close as intentional to prevent reconnection attempts
      intentionalCloseRef.current = true;
      // Clear any pending reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      wsRef.current?.close();
      stopPolling();
      term.dispose();
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, checkIfAtBottom]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={terminalRef}
        className="terminal-container w-full h-full bg-zinc-950 rounded-lg overflow-hidden"
        style={{
          WebkitOverflowScrolling: "touch",
        }}
      />
      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 h-7 w-7 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex items-center justify-center transition-colors z-10"
        >
          <ChevronDown className="w-4 h-4 text-zinc-300" />
        </button>
      )}
    </div>
  );
}
