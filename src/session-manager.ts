import * as pty from "node-pty";
import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "ws";
import type { Session, SessionConfig, SessionInfo, ActivityState, HookEvent, TaskStatus } from "./types.js";
import * as supabase from "./supabase.js";

const MAX_BUFFER_SIZE = 100_000; // ~2000 lines of 50 chars

// Patterns that indicate a shell prompt (waiting for input)
const PROMPT_PATTERNS = [
  /[$%#>]\s*$/,                    // Common shell prompts
  /\]\$\s*$/,                      // bash: [user@host dir]$
  /❯\s*$/,                         // starship/oh-my-zsh
  /➜\s*$/,                         // oh-my-zsh themes
  /λ\s*$/,                         // lambda prompts
  />>>\s*$/,                       // Python REPL
  /\.\.\.\s*$/,                    // Python continuation
  /irb.*>\s*$/,                    // Ruby IRB
  />\s*$/,                         // Generic prompt
  /\(y\/n\)\s*$/i,                 // Yes/no prompts
  /\[Y\/n\]\s*$/i,                 // Debian-style prompts
  /:\s*$/,                         // Password prompts, vim commands
  /\?\s*$/,                        // Question prompts
];

// Check if the buffer ends with something that looks like a prompt
function detectPrompt(buffer: string): boolean {
  // Get the last line (or last 200 chars if very long)
  const tail = buffer.slice(-200);
  const lines = tail.split(/\r?\n/);
  const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || "";

  // Check against prompt patterns
  return PROMPT_PATTERNS.some(pattern => pattern.test(lastLine));
}

/**
 * Clean malformed escape sequences from terminal output.
 * This prevents garbage characters like ^[[ from appearing in the terminal.
 */
function cleanTerminalOutput(data: string): string {
  let cleaned = data;

  // Remove orphaned OSC sequences (Operating System Commands) without proper ESC prefix
  // These look like ]0;title or ]10;color etc.
  cleaned = cleaned.replace(/\]1[0-9];[^\x07\x1b\n]*(?:\x07|\x1b\\|\\)?/g, "");
  cleaned = cleaned.replace(/\][0-9];[^\x07\x1b\n]*(?:\x07|\x1b\\|\\)?/g, "");

  // Remove Device Attributes responses (DA1, DA2)
  // These look like ?64;1;2c or >1;1;0c
  cleaned = cleaned.replace(/\?[\d;]+c/g, "");
  cleaned = cleaned.replace(/>[\d;]+c/g, "");

  // Remove orphaned CSI sequences without proper ESC prefix
  // CSI sequences start with [ followed by parameters and a letter
  // But we need to be careful not to remove valid content
  cleaned = cleaned.replace(/(?<!\x1b)\[[\d;]*[A-HJKSTfm]/g, "");

  // Remove incomplete/broken escape sequences
  // Pattern: ESC followed by [ but then garbage or another ESC
  cleaned = cleaned.replace(/\x1b\[\x1b/g, "\x1b");

  // Remove double ESC-[ sequences (the main cause of ^[[^[[ garbage)
  cleaned = cleaned.replace(/\x1b\[\x1b\[/g, "\x1b[");

  // Remove bare ESC characters not followed by valid sequence starters
  // Valid starters: [ (CSI), ] (OSC), ( ) * + (charset), = > (keypad), 7 8 (save/restore)
  cleaned = cleaned.replace(/\x1b(?![\[\]()=*+>78DEMNOPHVWXYZ\\^_c])/g, "");

  return cleaned;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up dead sessions every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  create(config: SessionConfig): Session {
    const id = uuidv4();
    const shell =
      config.command || (process.platform === "win32" ? "powershell.exe" : "bash");
    const args = config.args || [];
    const cwd = config.cwd || process.env.HOME || "/";
    const env = { ...process.env, ...config.env } as Record<string, string>;
    const cols = config.cols || 80;
    const rows = config.rows || 24;

    const ptyProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });

    const session: Session = {
      id,
      pty: ptyProcess,
      command: shell,
      args,
      cwd,
      env,
      cols,
      rows,
      createdAt: new Date(),
      lastActivity: new Date(),
      lastOutputTime: new Date(),
      outputBuffer: "",
      clients: new Set(),
      status: "running",
      activityState: "busy", // Starts busy until first prompt appears
      externallyControlled: false, // Will be set true when Claude Code hooks update state
      // Task status tracking for visual indicators
      currentTool: null,
      taskStartTime: null,
      toolUseCount: 0,
      tokenCount: 0,
      taskCompletedAt: null,
    };

    // Handle PTY output
    ptyProcess.onData((rawData: string) => {
      session.lastActivity = new Date();
      session.lastOutputTime = new Date();

      // Clean malformed escape sequences before processing
      const data = cleanTerminalOutput(rawData);

      // Append to buffer, trim if too large
      session.outputBuffer += data;
      if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
        session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
      }

      // Only use prompt detection if not externally controlled by Claude Code hooks
      if (!session.externallyControlled) {
        session.activityState = detectPrompt(session.outputBuffer) ? "idle" : "busy";
      }

      // Broadcast to all connected clients
      const message = JSON.stringify({ type: "output", data });
      for (const client of session.clients) {
        if (client.readyState === 1) {
          // WebSocket.OPEN
          client.send(message);
        }
      }

      // Log output to Supabase (batched for efficiency)
      supabase.appendOutput(session.id, data);
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      session.activityState = "exited";

      const message = JSON.stringify({ type: "exit", code: exitCode });
      for (const client of session.clients) {
        if (client.readyState === 1) {
          client.send(message);
        }
      }

      // Update status in Supabase
      supabase.updateSessionStatus(session.id, {
        status: "exited",
        exitCode,
        activityState: "exited",
        lastActivity: new Date(),
      });
    });

    this.sessions.set(id, session);
    console.log(`[SessionManager] Created session ${id} running: ${shell} ${args.join(" ")}`);

    // Persist to Supabase
    supabase.createSession({
      id: session.id,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      activityState: session.activityState,
      externallyControlled: session.externallyControlled,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      lastOutputTime: session.lastOutputTime,
    });

    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      command: s.command,
      args: s.args,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
      status: s.status,
      exitCode: s.exitCode,
      clientCount: s.clients.size,
      activityState: s.activityState,
      taskStatus: {
        activityState: s.activityState,
        currentTool: s.currentTool,
        taskStartTime: s.taskStartTime?.toISOString() ?? null,
        toolUseCount: s.toolUseCount,
        tokenCount: s.tokenCount,
        taskCompletedAt: s.taskCompletedAt?.toISOString() ?? null,
      },
    }));
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    try {
      session.pty.kill();
    } catch {
      // Process may already be dead
    }
    this.sessions.delete(id);
    console.log(`[SessionManager] Killed session ${id}`);

    // Delete from Supabase
    supabase.deleteSession(id);

    return true;
  }

  write(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== "running") return false;

    session.lastActivity = new Date();
    session.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== "running") return false;

    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
    return true;
  }

  addClient(id: string, ws: WebSocket): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.clients.add(ws);

    // Send buffered output history
    if (session.outputBuffer.length > 0) {
      ws.send(JSON.stringify({ type: "history", data: session.outputBuffer }));
    }

    // If session already exited, send exit message
    if (session.status === "exited" && session.exitCode !== undefined) {
      ws.send(JSON.stringify({ type: "exit", code: session.exitCode }));
    }

    console.log(`[SessionManager] Client connected to session ${id} (${session.clients.size} clients)`);
    return true;
  }

  removeClient(id: string, ws: WebSocket): void {
    const session = this.sessions.get(id);
    if (session) {
      session.clients.delete(ws);
      console.log(`[SessionManager] Client disconnected from session ${id} (${session.clients.size} clients)`);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const [id, session] of this.sessions) {
      // Remove sessions that exited and have no clients and are old
      if (
        session.status === "exited" &&
        session.clients.size === 0 &&
        now - session.lastActivity.getTime() > staleThreshold
      ) {
        this.sessions.delete(id);
        console.log(`[SessionManager] Cleaned up stale session ${id}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.cleanupInterval);
    for (const [id] of this.sessions) {
      this.kill(id);
    }
    // Flush any pending output to Supabase
    await supabase.shutdownSupabase();
  }

  // Initialize persistence (call on startup)
  async init(): Promise<void> {
    await supabase.initSupabase();
  }

  // Find sessions by working directory (for Claude Code hook integration)
  // Returns sessions where the hook's cwd is within the session's cwd tree
  // e.g., hook cwd=/Users/foo/project/src matches session cwd=/Users/foo/project
  // NOTE: We only match when hook's cwd is INSIDE or EQUAL to session's cwd.
  // This prevents hooks from parent directories from affecting sibling sessions.
  findByCwd(cwd: string): Session[] {
    const normalizedCwd = cwd.replace(/\/+$/, ""); // Remove trailing slash
    const matches: Session[] = [];

    for (const session of this.sessions.values()) {
      const sessionCwd = session.cwd.replace(/\/+$/, "");
      // Match if:
      // 1. Exact match, OR
      // 2. Hook's cwd is inside session's cwd (hook is in a subdirectory of the session)
      // We intentionally do NOT match if session's cwd is inside hook's cwd, because
      // a hook from /Users/foo should NOT affect sessions in /Users/foo/project1 and /Users/foo/project2
      if (
        sessionCwd === normalizedCwd ||
        normalizedCwd.startsWith(sessionCwd + "/")
      ) {
        matches.push(session);
      }
    }

    return matches;
  }

  // Update activity state for a session (called by Claude Code hooks)
  setActivityState(
    id: string,
    state: ActivityState,
    hookEvent?: HookEvent,
    toolName?: string
  ): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Don't update if session has exited
    if (session.status === "exited") return false;

    session.activityState = state;
    session.lastActivity = new Date();
    // Once a hook updates the state, disable prompt-based detection for this session
    session.externallyControlled = true;

    // Track task lifecycle based on hook event
    if (hookEvent === "UserPromptSubmit") {
      // New task started - reset counters
      session.currentTool = null;
      session.taskStartTime = new Date();
      session.toolUseCount = 0;
      session.taskCompletedAt = null;
    } else if (hookEvent === "PreToolUse") {
      // Tool is starting
      session.currentTool = toolName ?? null;
      session.toolUseCount++;
      // If no task start time yet, set it now
      if (!session.taskStartTime) {
        session.taskStartTime = new Date();
      }
    } else if (hookEvent === "PostToolUse") {
      // Tool finished, clear current tool but stay busy
      session.currentTool = null;
    } else if (hookEvent === "Stop" || hookEvent === "Notification") {
      // Task completed - mark completion time
      session.currentTool = null;
      session.taskCompletedAt = new Date();
    } else if (hookEvent === "SessionEnd") {
      // Session ended - clear everything
      session.currentTool = null;
      session.taskCompletedAt = new Date();
    }

    // Build task status for broadcast
    const taskStatus = {
      activityState: session.activityState,
      currentTool: session.currentTool,
      taskStartTime: session.taskStartTime?.toISOString() ?? null,
      toolUseCount: session.toolUseCount,
      tokenCount: session.tokenCount,
      taskCompletedAt: session.taskCompletedAt?.toISOString() ?? null,
    };

    // Broadcast activity state change to connected clients
    const message = JSON.stringify({ type: "activity", state, taskStatus });
    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }

    console.log(`[SessionManager] Session ${id} activity state -> ${state}${hookEvent ? ` (${hookEvent})` : ""}${toolName ? ` tool: ${toolName}` : ""}`);

    // Persist to Supabase
    supabase.updateSessionStatus(id, {
      activityState: state,
      externallyControlled: true,
      lastActivity: session.lastActivity,
      currentTool: session.currentTool,
      taskStartTime: session.taskStartTime,
      toolUseCount: session.toolUseCount,
      tokenCount: session.tokenCount,
      taskCompletedAt: session.taskCompletedAt,
    });

    return true;
  }

  // Get task status for a session (for API endpoint)
  getTaskStatus(id: string): TaskStatus | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    return {
      activityState: session.activityState,
      currentTool: session.currentTool,
      taskStartTime: session.taskStartTime?.toISOString() ?? null,
      toolUseCount: session.toolUseCount,
      tokenCount: session.tokenCount,
      taskCompletedAt: session.taskCompletedAt?.toISOString() ?? null,
    };
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
