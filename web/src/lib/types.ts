export type ActivityState = "idle" | "busy" | "exited";

export interface SessionInfo {
  // Tmux mode uses `name` as the identifier, PTY mode uses `id`
  id?: string;
  name?: string;
  // Command info (optional in tmux mode where sessions are discovered)
  command?: string;
  args?: string[];
  cwd: string;
  cols: number | null;
  rows: number | null;
  status: "running" | "exited";
  exitCode?: number;
  createdAt: string;
  lastActivity: string;
  clientCount: number;
  recentOutput?: string;
  activityState?: ActivityState;
  // Tmux-specific fields
  source?: "local" | "cloud";
  attached?: boolean;
  windows?: number;
  // Client-side only (stored in localStorage)
  displayName?: string;
  folder?: string;
}

// Helper to get session identifier (works with both tmux and PTY modes)
export function getSessionId(session: SessionInfo): string {
  return session.name || session.id || "";
}

export interface SessionConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  tailscale?: {
    connected: boolean;
    ip?: string;
    hostname?: string;
    tailnet?: string;
    peerCount?: number;
  };
}

export type WebSocketMessage =
  | { type: "output"; data: string }
  | { type: "history"; data: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "activity"; state: ActivityState };

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };
