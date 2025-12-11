import type { IPty } from "node-pty";
import type { WebSocket } from "ws";

export interface SessionConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

// Activity states for terminal sessions
// - idle: Waiting for user input (Claude Code sent Notification or Stop)
// - busy: Processing/running (Claude Code sent UserPromptSubmit or PreToolUse)
// - exited: Session has ended
export type ActivityState = "idle" | "busy" | "exited";

// Hook event types from Claude Code
export type HookEvent =
  | "UserPromptSubmit"  // User sent a message -> busy
  | "PreToolUse"        // Claude is executing a tool -> busy
  | "PostToolUse"       // Tool finished -> still busy (waiting for Claude response)
  | "Notification"      // Claude waiting for input -> idle
  | "Stop"              // Claude finished responding -> idle
  | "SessionEnd";       // Session terminated -> exited

// Task status for rich visual indicators
export interface TaskStatus {
  activityState: ActivityState;
  currentTool: string | null;
  taskStartTime: string | null;  // ISO timestamp
  toolUseCount: number;
  tokenCount: number;
  taskCompletedAt: string | null;  // ISO timestamp
}

export interface Session {
  id: string;
  pty: IPty;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  createdAt: Date;
  lastActivity: Date;
  lastOutputTime: Date;
  outputBuffer: string;
  clients: Set<WebSocket>;
  status: "running" | "exited";
  exitCode?: number;
  activityState: ActivityState;
  // When true, activity state is controlled by Claude Code hooks instead of prompt detection
  externallyControlled: boolean;
  // Task status tracking for visual indicators
  currentTool: string | null;
  taskStartTime: Date | null;
  toolUseCount: number;
  tokenCount: number;
  taskCompletedAt: Date | null;
}

export interface SessionInfo {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  lastActivity: string;
  status: "running" | "exited";
  exitCode?: number;
  clientCount: number;
  activityState: ActivityState;
  taskStatus?: TaskStatus;
}

// WebSocket message types
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "pong"; timestamp: number };

export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "history"; data: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "ping"; timestamp: number }
  | { type: "activity"; state: ActivityState; taskStatus?: TaskStatus };

// Session event types for debugging and analysis
export type SessionEventType =
  // Session lifecycle
  | "session_start"
  | "session_restart"
  | "session_exit"
  | "session_attach"
  | "session_detach"
  // Claude Code specific
  | "compact"
  | "clear"
  | "task_start"
  | "task_complete"
  // Tool usage
  | "tool_start"
  | "tool_complete"
  // Activity state changes
  | "state_idle"
  | "state_busy"
  // Terminal events
  | "terminal_clear"
  | "output_truncated"
  // Errors
  | "error"
  | "hook_error";

export interface SessionEvent {
  id?: number;
  sessionId: string;
  eventType: SessionEventType;
  details?: Record<string, unknown>;
  outputOffset?: number;
  createdAt?: string;
  clientTimestamp?: string;
}
