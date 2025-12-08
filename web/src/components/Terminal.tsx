"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ChevronDown } from "lucide-react";
import { getWebSocketUrl, pollOutput, sendInput } from "@/lib/api";
import type { WebSocketMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";

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
          xtermRef.current?.write(response.output);
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
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "output":
            xtermRef.current?.write(msg.data);
            break;
          case "history":
            xtermRef.current?.write(msg.data);
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

    // Create terminal with phosphor theme
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontWeight: "400",
      letterSpacing: 0,
      lineHeight: 1.2,
      scrollback: 10000, // Enable scrollback buffer (10k lines)
      scrollOnUserInput: true, // Auto-scroll when user types
      // Disable mouse wheel scroll when alternate buffer is active (for programs like less/vim)
      // This ensures wheel scrolling always scrolls the viewport, not sends to the app
      fastScrollModifier: "alt", // Hold Alt for fast scrolling
      scrollSensitivity: 1, // Normal scroll sensitivity
      theme: {
        background: "#050508",
        foreground: "#E8ECF4",
        cursor: "#39FF14",
        cursorAccent: "#050508",
        selectionBackground: "rgba(57, 255, 20, 0.2)",
        selectionForeground: "#E8ECF4",
        black: "#1a1a1f",
        red: "#FF3366",
        green: "#39FF14",
        yellow: "#FFB800",
        blue: "#00D4FF",
        magenta: "#C084FC",
        cyan: "#00D4FF",
        white: "#E8ECF4",
        brightBlack: "#4a4a55",
        brightRed: "#FF6B8A",
        brightGreen: "#6BFF4D",
        brightYellow: "#FFD54F",
        brightBlue: "#4DE8FF",
        brightMagenta: "#D4A5FF",
        brightCyan: "#4DE8FF",
        brightWhite: "#FFFFFF",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fix: Ensure wheel scrolling always works on desktop
    // xterm.js can capture wheel events for mouse reporting mode, which breaks scrolling
    const viewport = terminalRef.current.querySelector('.xterm-viewport') as HTMLElement;
    if (viewport) {
      // Desktop wheel scroll fix
      // When mouse reporting is enabled by shell/apps, wheel events get captured
      // This handler ensures wheel scrolling always scrolls the viewport
      const handleWheel = (e: WheelEvent) => {
        // Check if we have scrollback content to scroll through
        const buffer = term.buffer.active;
        const hasScrollback = buffer.baseY > 0;

        if (hasScrollback) {
          // Calculate scroll direction and amount
          const scrollAmount = Math.sign(e.deltaY) * 3; // 3 lines per scroll tick

          // Get current and target positions
          const currentLine = buffer.viewportY;
          const maxLine = buffer.baseY;
          const targetLine = Math.max(0, Math.min(maxLine, currentLine + scrollAmount));

          // Only intercept if we're not at the edges (let natural behavior take over at edges)
          const isAtTop = currentLine === 0 && e.deltaY < 0;
          const isAtBottom = currentLine >= maxLine && e.deltaY > 0;

          if (!isAtTop && !isAtBottom) {
            // Scroll the terminal viewport
            term.scrollLines(scrollAmount);
            e.preventDefault();
            e.stopPropagation();
          }
        }
      };

      // Add wheel handler with high priority (capture phase)
      terminalRef.current.addEventListener('wheel', handleWheel, { capture: true, passive: false });

      // Mobile touch scrolling fix
      // xterm.js captures touch events which prevents native scrolling on mobile
      let touchStartY = 0;
      let touchStartScrollTop = 0;

      const handleTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          touchStartY = e.touches[0].clientY;
          touchStartScrollTop = viewport.scrollTop;
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          const touchY = e.touches[0].clientY;
          const deltaY = touchStartY - touchY;
          viewport.scrollTop = touchStartScrollTop + deltaY;
          // Prevent default only if we're actually scrolling the terminal
          if (viewport.scrollTop > 0 || deltaY > 0) {
            e.preventDefault();
          }
        }
      };

      // Use passive: false to allow preventDefault
      terminalRef.current.addEventListener('touchstart', handleTouchStart, { passive: true });
      terminalRef.current.addEventListener('touchmove', handleTouchMove, { passive: false });
    }

    // Track scroll position to show/hide scroll button
    // Use throttling to prevent excessive state updates during rapid scrolling
    term.onScroll(() => {
      const now = Date.now();
      // Throttle scroll checks to every 100ms
      if (now - lastScrollCheckRef.current < 100) return;
      lastScrollCheckRef.current = now;

      const isAtBottom = checkIfAtBottom();
      setShowScrollButton(!isAtBottom);
    });

    // Also check scroll position when new content is written
    // This ensures the button shows up when output pushes content out of view
    term.onWriteParsed(() => {
      // Only check if we weren't already showing the button
      // and debounce to avoid excessive checks
      const now = Date.now();
      if (now - lastScrollCheckRef.current < 50) return;
      lastScrollCheckRef.current = now;

      const isAtBottom = checkIfAtBottom();
      setShowScrollButton(!isAtBottom);
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
      fitAddon.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          wsRef.current.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Connect to WebSocket
    connect();

    return () => {
      window.removeEventListener("resize", handleResize);
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
        <Button
          onClick={scrollToBottom}
          size="icon"
          variant="secondary"
          className="absolute bottom-4 right-4 h-10 w-10 rounded-full shadow-lg bg-primary/90 hover:bg-primary text-primary-foreground border border-primary/50 z-10"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      )}
    </div>
  );
}
