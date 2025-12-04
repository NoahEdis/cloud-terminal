import * as pty from "node-pty";
import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "ws";
import type { Session, SessionConfig, SessionInfo } from "./types.js";

const MAX_BUFFER_SIZE = 100_000; // ~2000 lines of 50 chars

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
      outputBuffer: "",
      clients: new Set(),
      status: "running",
    };

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
          // WebSocket.OPEN
          client.send(message);
        }
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;

      const message = JSON.stringify({ type: "exit", code: exitCode });
      for (const client of session.clients) {
        if (client.readyState === 1) {
          client.send(message);
        }
      }
    });

    this.sessions.set(id, session);
    console.log(`[SessionManager] Created session ${id} running: ${shell} ${args.join(" ")}`);
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

  shutdown(): void {
    clearInterval(this.cleanupInterval);
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
