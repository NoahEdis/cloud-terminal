// Browser Agent API Client
// Communicates with the browser agent server via Next.js API proxy routes

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

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
}

export interface ModelGroup {
  provider: string;
  models: ModelOption[];
}

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: "task_started" | "step" | "tool" | "result" | "complete" | "error" | "user_input";
  content: string;
  details?: Record<string, unknown>;
}

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
  return handleResponse<ModelGroup[]>(res);
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
  type: ActivityLogEntry["type"],
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
