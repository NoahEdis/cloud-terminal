/**
 * Tmux-based Session Manager for cloud-terminal.
 *
 * Uses tmux as the session backend, enabling bidirectional sync
 * between local tmux sessions and the cloud terminal web UI.
 *
 * Benefits:
 * - Sessions created locally in tmux appear in the cloud UI
 * - Sessions created in the cloud UI can be attached to locally
 * - Sessions persist across server restarts (managed by tmux)
 * - Multiple clients can attach to the same session
 */

import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import * as tmux from "./tmux.js";
import * as supabase from "./supabase.js";
import type { ActivityState } from "./types.js";

const MAX_BUFFER_SIZE = 100_000; // ~2000 lines of 50 chars

// Session prefix for cloud-created sessions
const CLOUD_SESSION_PREFIX = "cloud-";

export interface TmuxManagedSession {
  // Tmux session name (used as ID)
  name: string;
  // PTY process attached to tmux (for this connection)
  pty: IPty | null;
  // Tmux session metadata
  tmuxSession: tmux.TmuxSession | null;
  // Working directory
  cwd: string;
  // Terminal dimensions
  cols: number;
  rows: number;
  // Timestamps
  createdAt: Date;
  lastActivity: Date;
  // Output buffer for replay
  outputBuffer: string;
  // Connected WebSocket clients
  clients: Set<WebSocket>;
  // Session state
  status: "running" | "exited";
  activityState: ActivityState;
  // Whether created via cloud terminal or discovered locally
  source: "cloud" | "local";
}

export interface TmuxSessionInfo {
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  lastActivity: string;
  status: "running" | "exited";
  clientCount: number;
  activityState: ActivityState;
  source: "cloud" | "local";
  attached: boolean; // Whether attached locally (via tmux attach)
  windows: number;
}

export class TmuxSessionManager {
  private sessions = new Map<string, TmuxManagedSession>();
  private syncInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private tmuxAvailable = false;

  /**
   * Initialize the session manager.
   * Checks for tmux and syncs existing sessions.
   */
  async init(): Promise<void> {
    this.tmuxAvailable = await tmux.isTmuxAvailable();

    if (!this.tmuxAvailable) {
      console.error("[TmuxSessionManager] tmux is not available on this system");
      throw new Error("tmux is required for TmuxSessionManager");
    }

    console.log("[TmuxSessionManager] tmux is available, syncing sessions...");

    // Initial sync of existing tmux sessions
    await this.syncTmuxSessions();

    // Start periodic sync to detect new local sessions
    this.syncInterval = setInterval(() => this.syncTmuxSessions(), 5000);

    // Clean up dead connections every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);

    console.log(`[TmuxSessionManager] Initialized with ${this.sessions.size} sessions`);
  }

  /**
   * Sync with tmux to discover new/removed sessions.
   */
  async syncTmuxSessions(): Promise<void> {
    const tmuxSessions = await tmux.listSessions();
    const tmuxNames = new Set(tmuxSessions.map(s => s.name));

    // Add new sessions discovered from tmux
    for (const ts of tmuxSessions) {
      if (!this.sessions.has(ts.name)) {
        console.log(`[TmuxSessionManager] Discovered new tmux session: ${ts.name}`);
        this.sessions.set(ts.name, {
          name: ts.name,
          pty: null, // No PTY until a client connects
          tmuxSession: ts,
          cwd: process.env.HOME || "/", // tmux doesn't expose cwd easily
          cols: ts.width,
          rows: ts.height,
          createdAt: ts.created,
          lastActivity: ts.lastActivity,
          outputBuffer: "",
          clients: new Set(),
          status: "running",
          activityState: "idle",
          source: ts.name.startsWith(CLOUD_SESSION_PREFIX) ? "cloud" : "local",
        });
      } else {
        // Update existing session metadata
        const session = this.sessions.get(ts.name)!;
        session.tmuxSession = ts;
        session.lastActivity = ts.lastActivity;
        session.cols = ts.width;
        session.rows = ts.height;
      }
    }

    // Mark sessions that no longer exist in tmux as exited
    for (const [name, session] of this.sessions) {
      if (!tmuxNames.has(name) && session.status === "running") {
        console.log(`[TmuxSessionManager] Session ${name} no longer exists in tmux`);
        session.status = "exited";
        session.activityState = "exited";

        // Notify clients
        const message = JSON.stringify({ type: "exit", code: 0 });
        for (const client of session.clients) {
          if (client.readyState === 1) {
            client.send(message);
          }
        }

        // Clean up PTY if attached
        if (session.pty) {
          try {
            session.pty.kill();
          } catch {}
          session.pty = null;
        }
      }
    }
  }

  /**
   * Create a new tmux session.
   */
  async create(config: {
    name?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<TmuxManagedSession> {
    const name = config.name || `${CLOUD_SESSION_PREFIX}${Date.now()}`;
    const cwd = config.cwd || process.env.HOME || "/";
    const cols = config.cols || 80;
    const rows = config.rows || 24;

    // Check if session already exists
    if (await tmux.sessionExists(name)) {
      throw new Error(`Session '${name}' already exists`);
    }

    // Create tmux session
    await tmux.createSession({ name, cwd, width: cols, height: rows });

    const tmuxSession = await tmux.getSession(name);

    const session: TmuxManagedSession = {
      name,
      pty: null,
      tmuxSession,
      cwd,
      cols,
      rows,
      createdAt: new Date(),
      lastActivity: new Date(),
      outputBuffer: "",
      clients: new Set(),
      status: "running",
      activityState: "idle",
      source: "cloud",
    };

    this.sessions.set(name, session);
    console.log(`[TmuxSessionManager] Created session: ${name}`);

    // Persist to Supabase
    supabase.createSession({
      id: name,
      command: "tmux",
      args: [name],
      cwd,
      cols,
      rows,
      status: "running",
      activityState: "idle",
      externallyControlled: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      lastOutputTime: session.lastActivity,
    });

    return session;
  }

  /**
   * Get a session by name.
   */
  get(name: string): TmuxManagedSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * List all sessions.
   */
  list(): TmuxSessionInfo[] {
    return Array.from(this.sessions.values()).map(s => ({
      name: s.name,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
      status: s.status,
      clientCount: s.clients.size,
      activityState: s.activityState,
      source: s.source,
      attached: s.tmuxSession?.attached || false,
      windows: s.tmuxSession?.windows || 1,
    }));
  }

  /**
   * Kill a session.
   */
  async kill(name: string): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session) return false;

    // Kill the tmux session
    const killed = await tmux.killSession(name);

    // Clean up PTY if attached
    if (session.pty) {
      try {
        session.pty.kill();
      } catch {}
    }

    // Remove from our tracking
    this.sessions.delete(name);
    console.log(`[TmuxSessionManager] Killed session: ${name}`);

    // Delete from Supabase
    supabase.deleteSession(name);

    return killed;
  }

  /**
   * Write data to a session.
   */
  write(name: string, data: string): boolean {
    const session = this.sessions.get(name);
    if (!session || session.status !== "running") return false;

    session.lastActivity = new Date();

    // If we have a PTY attached, write to it
    if (session.pty) {
      session.pty.write(data);
    } else {
      // Otherwise send keys via tmux command
      tmux.sendKeys(name, data, true);
    }

    return true;
  }

  /**
   * Resize a session.
   */
  async resize(name: string, cols: number, rows: number): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session || session.status !== "running") return false;

    session.cols = cols;
    session.rows = rows;

    // Resize in tmux
    await tmux.resizeSession(name, cols, rows);

    // Resize PTY if attached
    if (session.pty) {
      session.pty.resize(cols, rows);
    }

    return true;
  }

  /**
   * Add a WebSocket client to a session.
   * Creates a PTY attachment if this is the first cloud client.
   */
  async addClient(name: string, ws: WebSocket): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session) return false;

    session.clients.add(ws);

    // If no PTY yet, create one by attaching to tmux
    if (!session.pty && session.status === "running") {
      await this.attachPty(session);
    }

    // Send buffered output history
    if (session.outputBuffer.length > 0) {
      ws.send(JSON.stringify({ type: "history", data: session.outputBuffer }));
    }

    // If session already exited, send exit message
    if (session.status === "exited") {
      ws.send(JSON.stringify({ type: "exit", code: 0 }));
    }

    console.log(`[TmuxSessionManager] Client connected to ${name} (${session.clients.size} clients)`);
    return true;
  }

  /**
   * Remove a WebSocket client from a session.
   */
  removeClient(name: string, ws: WebSocket): void {
    const session = this.sessions.get(name);
    if (!session) return;

    session.clients.delete(ws);
    console.log(`[TmuxSessionManager] Client disconnected from ${name} (${session.clients.size} clients)`);

    // If no more cloud clients, we can optionally detach the PTY
    // to save resources (the tmux session stays alive)
    if (session.clients.size === 0 && session.pty) {
      // Keep PTY alive for now to preserve buffer
      // Could add a timeout to detach if no clients reconnect
    }
  }

  /**
   * Attach a PTY to a tmux session for streaming output.
   */
  private async attachPty(session: TmuxManagedSession): Promise<void> {
    // Use node-pty to attach to the tmux session
    const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", session.name], {
      name: "xterm-256color",
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env: process.env as Record<string, string>,
    });

    session.pty = ptyProcess;

    // Handle PTY output
    ptyProcess.onData((data: string) => {
      session.lastActivity = new Date();

      // Append to buffer, trim if too large
      session.outputBuffer += data;
      if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
        session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
      }

      // Broadcast to all connected clients
      const message = JSON.stringify({ type: "output", data });
      for (const client of session.clients) {
        if (client.readyState === 1) {
          client.send(message);
        }
      }

      // Log to Supabase
      supabase.appendOutput(session.name, data);
    });

    // Handle PTY exit (tmux detach or session kill)
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[TmuxSessionManager] PTY for ${session.name} exited with code ${exitCode}`);
      session.pty = null;

      // Check if the tmux session still exists
      tmux.sessionExists(session.name).then(exists => {
        if (!exists) {
          session.status = "exited";
          session.activityState = "exited";

          const message = JSON.stringify({ type: "exit", code: exitCode });
          for (const client of session.clients) {
            if (client.readyState === 1) {
              client.send(message);
            }
          }

          supabase.updateSessionStatus(session.name, {
            status: "exited",
            exitCode,
            activityState: "exited",
            lastActivity: new Date(),
          });
        }
      });
    });

    console.log(`[TmuxSessionManager] Attached PTY to session: ${session.name}`);
  }

  /**
   * Clean up exited sessions with no clients.
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const [name, session] of this.sessions) {
      if (
        session.status === "exited" &&
        session.clients.size === 0 &&
        now - session.lastActivity.getTime() > staleThreshold
      ) {
        this.sessions.delete(name);
        console.log(`[TmuxSessionManager] Cleaned up stale session: ${name}`);
      }
    }
  }

  /**
   * Shutdown the session manager.
   */
  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Kill all PTY attachments (but not the tmux sessions themselves)
    for (const session of this.sessions.values()) {
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {}
      }
    }

    // Flush Supabase output
    await supabase.shutdownSupabase();

    console.log("[TmuxSessionManager] Shutdown complete");
  }

  /**
   * Set activity state for a session (called by hooks).
   */
  setActivityState(name: string, state: ActivityState): boolean {
    const session = this.sessions.get(name);
    if (!session || session.status === "exited") return false;

    session.activityState = state;
    session.lastActivity = new Date();

    // Broadcast to clients
    const message = JSON.stringify({ type: "activity", state });
    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }

    console.log(`[TmuxSessionManager] Session ${name} activity -> ${state}`);

    // Persist to Supabase
    supabase.updateSessionStatus(name, {
      activityState: state,
      lastActivity: session.lastActivity,
    });

    return true;
  }

  /**
   * Find sessions by working directory (for Claude Code hook integration).
   */
  findByCwd(cwd: string): TmuxManagedSession[] {
    const normalizedCwd = cwd.replace(/\/+$/, "");
    const matches: TmuxManagedSession[] = [];

    for (const session of this.sessions.values()) {
      const sessionCwd = session.cwd.replace(/\/+$/, "");
      if (
        sessionCwd === normalizedCwd ||
        normalizedCwd.startsWith(sessionCwd + "/")
      ) {
        matches.push(session);
      }
    }

    return matches;
  }
}

// Singleton instance
export const tmuxSessionManager = new TmuxSessionManager();
