// Browser Agent API Client
// Communicates with the browser agent server via Next.js API proxy routes and WebSocket

export interface BrowserStatus {
  isRunning: boolean;
  currentTask: string | null;
  provider: string;
  model: string;
  headless: boolean;
  sessionActive: boolean;
  stepCount: number;
  totalSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number;
  waitingForUserInput: boolean;
  userInputPrompt: string | null;
  averageResponseTimeMs: number;
  llmCallCount: number;
}

export interface BrowserConfig {
  provider: string;
  model: string;
  headless: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  inputCost: number;
  outputCost: number;
}

export interface ModelsResponse {
  models: ModelInfo[];
  availableProviders: string[];
}

export interface ModelGroup {
  provider: string;
  models: ModelInfo[];
}

// Activity log entry types - expanded for detailed logging
export type ActivityLogType =
  | "task_started"
  | "step"
  | "tool"
  | "tool_result"
  | "thinking"
  | "assistant"
  | "complete"
  | "error"
  | "user_input"
  | "screenshot"
  | "state_change";

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: ActivityLogType;
  content: string;
  details?: Record<string, unknown>;
}

// WebSocket event types from browser agent server
export interface WSToolCalledEvent {
  type: "tool_called";
  data: {
    tool: string;
    args: Record<string, unknown>;
    reason?: string;
  };
}

export interface WSToolResultEvent {
  type: "tool_result";
  data: {
    tool: string;
    result: unknown;
    screenshot?: string; // base64 PNG
    error?: string;
  };
}

export interface WSLiveScreenshotEvent {
  type: "live_screenshot";
  data: {
    screenshot: string; // base64 PNG
    timestamp: number;
  };
}

export interface WSStepStartedEvent {
  type: "step_started";
  data: {
    step: number;
    maxSteps: number;
  };
}

export interface WSTaskStartedEvent {
  type: "task_started";
  data: {
    task: string;
    maxSteps: number;
  };
}

export interface WSTaskCompletedEvent {
  type: "task_completed";
  data: {
    success: boolean;
    result?: string;
    error?: string;
  };
}

export interface WSAssistantMessageEvent {
  type: "assistant_message";
  data: {
    content: string;
  };
}

export interface WSAgentEventEvent {
  type: "agent_event";
  data: {
    event: string;
    details?: Record<string, unknown>;
  };
}

export interface WSErrorEvent {
  type: "error";
  data: {
    message: string;
  };
}

export interface WSUserInputRequestEvent {
  type: "user_input_request";
  data: {
    prompt: string;
  };
}

export interface WSStateChangeEvent {
  type: "state_change";
  data: {
    description: string;
  };
}

export type BrowserWSEvent =
  | WSToolCalledEvent
  | WSToolResultEvent
  | WSLiveScreenshotEvent
  | WSStepStartedEvent
  | WSTaskStartedEvent
  | WSTaskCompletedEvent
  | WSAssistantMessageEvent
  | WSAgentEventEvent
  | WSErrorEvent
  | WSUserInputRequestEvent
  | WSStateChangeEvent;

export class BrowserApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "BrowserApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    throw new BrowserApiError(
      errorData.error || `Request failed with status ${res.status}`,
      res.status
    );
  }
  return res.json();
}

export async function getBrowserStatus(): Promise<BrowserStatus> {
  const res = await fetch("/api/browser/status");
  return handleResponse<BrowserStatus>(res);
}

export async function getAvailableModels(): Promise<ModelGroup[]> {
  const res = await fetch("/api/browser/models");
  const data = await handleResponse<ModelsResponse>(res);

  // Group models by provider, filtering to only available providers
  const availableSet = new Set(data.availableProviders);
  const groupMap = new Map<string, ModelInfo[]>();

  for (const model of data.models) {
    // Only include models from available providers
    if (!availableSet.has(model.provider)) continue;

    if (!groupMap.has(model.provider)) {
      groupMap.set(model.provider, []);
    }
    groupMap.get(model.provider)!.push(model);
  }

  // Convert to array and sort providers
  const providerOrder = ["anthropic", "openai", "gemini", "groq", "ollama"];
  return Array.from(groupMap.entries())
    .sort(([a], [b]) => {
      const aIdx = providerOrder.indexOf(a);
      const bIdx = providerOrder.indexOf(b);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    })
    .map(([provider, models]) => ({ provider, models }));
}

export async function getBrowserConfig(): Promise<BrowserConfig> {
  const res = await fetch("/api/browser/config");
  return handleResponse<BrowserConfig>(res);
}

export async function updateBrowserConfig(
  config: Partial<BrowserConfig>
): Promise<BrowserConfig> {
  const res = await fetch("/api/browser/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return handleResponse<BrowserConfig>(res);
}

export async function sendBrowserTask(task: string): Promise<void> {
  const res = await fetch("/api/browser/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: task }),
  });
  await handleResponse<unknown>(res);
}

export async function sendUserInput(input: string): Promise<void> {
  const res = await fetch("/api/browser/user-input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  await handleResponse<unknown>(res);
}

// Helper to create activity log entry
export function createActivityLogEntry(
  type: ActivityLogType,
  content: string,
  details?: Record<string, unknown>
): ActivityLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    type,
    content,
    details,
  };
}

// Format cost as currency
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

// Format response time
export function formatResponseTime(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

// Get WebSocket URL for browser agent server
// In development, connect directly to the browser agent server
// In production, this would need a WebSocket proxy
export function getBrowserAgentWSUrl(): string {
  // For now, connect directly to the browser agent server
  // This assumes the browser agent runs on the same host
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    return `ws://${host}:3456`;
  }
  return "ws://localhost:3456";
}

// Format tool arguments for display
export function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";

  return entries
    .map(([key, value]) => {
      const valueStr = typeof value === "string"
        ? value.length > 50 ? `"${value.slice(0, 50)}..."` : `"${value}"`
        : JSON.stringify(value);
      return `${key}: ${valueStr}`;
    })
    .join(", ");
}

// Truncate text for display
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
