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
}

// WebSocket message types
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "history"; data: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string };
