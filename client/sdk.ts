import WebSocket from "ws";
import { EventEmitter } from "events";

export interface SessionConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface SessionInfo {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode?: number;
  createdAt: string;
  lastActivity: string;
  clientCount: number;
  recentOutput?: string;
}

export interface TerminalClientConfig {
  baseUrl?: string;
  wsUrl?: string;
}

export class CloudTerminalClient {
  private baseUrl: string;
  private wsUrl: string;

  constructor(config: TerminalClientConfig = {}) {
    this.baseUrl = config.baseUrl || "http://localhost:3000";
    this.wsUrl = config.wsUrl || this.baseUrl.replace(/^http/, "ws");
  }

  async createSession(config: SessionConfig): Promise<SessionInfo> {
    const res = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async listSessions(): Promise<SessionInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/sessions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getSession(id: string): Promise<SessionInfo> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error("Session not found");
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  async killSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async sendInput(id: string, input: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }
  }

  async resizeSession(id: string, cols: number, rows: number): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cols, rows }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }
  }

  connect(sessionId: string): TerminalSession {
    return new TerminalSession(`${this.wsUrl}/ws/${sessionId}`);
  }
}

export class TerminalSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnecting = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        this.emit("open");
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          switch (message.type) {
            case "output":
              this.emit("output", message.data);
              break;
            case "history":
              this.emit("history", message.data);
              break;
            case "exit":
              this.emit("exit", message.code);
              break;
            case "error":
              this.emit("error", new Error(message.message));
              break;
          }
        } catch (e) {
          this.emit("error", e);
        }
      });

      this.ws.on("close", (code, reason) => {
        this.emit("close", code, reason.toString());
      });

      this.ws.on("error", (err) => {
        reject(err);
        this.emit("error", err);
      });
    });
  }

  write(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "input", data }));
    }
  }

  resize(cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }

  close(): void {
    this.ws?.close();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Interactive session helper - connects and pipes to stdin/stdout
export async function interactiveSession(
  client: CloudTerminalClient,
  sessionId: string
): Promise<void> {
  const session = client.connect(sessionId);

  await session.open();

  // Pipe terminal output to stdout
  session.on("output", (data: string) => {
    process.stdout.write(data);
  });

  // Show history on connect
  session.on("history", (data: string) => {
    process.stdout.write(data);
  });

  // Handle exit
  session.on("exit", (code: number) => {
    console.log(`\n[Session exited with code ${code}]`);
    process.exit(code);
  });

  // Enable raw mode for stdin
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  // Pipe stdin to terminal
  process.stdin.on("data", (data: Buffer) => {
    session.write(data.toString());
  });

  // Handle resize
  const handleResize = () => {
    if (process.stdout.columns && process.stdout.rows) {
      session.resize(process.stdout.columns, process.stdout.rows);
    }
  };
  process.stdout.on("resize", handleResize);
  handleResize(); // Initial size

  // Handle Ctrl+C (but send it to terminal, not exit)
  // Already handled by raw mode

  session.on("close", () => {
    console.log("\n[Connection closed]");
    process.exit(0);
  });
}

// Export default client
export default CloudTerminalClient;
