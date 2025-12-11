export type ActivityState = "idle" | "busy" | "exited";

export type ChatType = "claude" | "custom";

// Task status for rich visual indicators
export interface TaskStatus {
  activityState: ActivityState;
  currentTool: string | null;
  taskStartTime: string | null;  // ISO timestamp
  toolUseCount: number;
  tokenCount: number;
  taskCompletedAt: string | null;  // ISO timestamp
}

export interface ChatMetrics {
  // Total number of newlines in output (actual lines of content)
  lineCount: number;
  // Total characters in output buffer
  charCount: number;
  // Detected Claude Code message boundaries (user prompts + assistant responses)
  messageCount: number;
  // Estimated token count (rough approximation: chars / 4)
  estimatedTokens: number;
}

export interface ChatInfo {
  // Tmux mode uses `name` as the identifier, PTY mode uses `id`
  id?: string;
  name?: string;
  // Command info (optional in tmux mode where chats are discovered)
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
  // Chat metrics for context tracking
  metrics?: ChatMetrics;
  // Chat type for determining available features
  chatType?: ChatType;
  // Task status for visual indicators
  taskStatus?: TaskStatus;
}

// Helper to get chat identifier (works with both tmux and PTY modes)
export function getChatId(chat: ChatInfo): string {
  return chat.name || chat.id || "";
}

export interface ChatConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  // Chat type for auto-run and feature detection
  chatType?: ChatType;
  // Command to auto-run after chat creation (e.g., claude --dangerously-skip-permissions)
  autoRunCommand?: string;
}

// Legacy aliases for backward compatibility during migration
export type SessionMetrics = ChatMetrics;
export type SessionInfo = ChatInfo;
export type SessionConfig = ChatConfig;
export const getSessionId = getChatId;

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
  | { type: "activity"; state: ActivityState; taskStatus?: TaskStatus }
  | { type: "ping"; timestamp: number };

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "pong"; timestamp: number };
