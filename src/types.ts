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
  outputBuffer: string;
  clients: Set<WebSocket>;
  status: "running" | "exited";
  exitCode?: number;
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
