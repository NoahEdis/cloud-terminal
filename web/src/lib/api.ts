import type { SessionInfo, SessionConfig, HealthStatus } from "./types";
import type { ClaudeCodeMessage } from "./message-types";

// ============================================================================
// Connection State Management - Auto-reconnect with status tracking
// ============================================================================

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

type ConnectionListener = (status: ConnectionStatus) => void;

class ConnectionManager {
  private status: ConnectionStatus = "disconnected";
  private listeners: Set<ConnectionListener> = new Set();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  getStatus(): ConnectionStatus {
    return this.status;
  }

  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    // Immediately notify of current status
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status !== status) {
      this.status = status;
      this.listeners.forEach((listener) => listener(status));
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${getApiUrl()}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        this.setStatus("connected");
        this.reconnectAttempts = 0;
        return true;
      }
    } catch {
      // Connection failed
    }
    this.setStatus("disconnected");
    return false;
  }

  startHealthCheck(intervalMs = 5000) {
    if (this.healthCheckInterval) return;

    // Check immediately
    this.checkConnection();

    this.healthCheckInterval = setInterval(async () => {
      const wasConnected = this.status === "connected";
      const isConnected = await this.checkConnection();

      if (!wasConnected && isConnected) {
        console.log("[ConnectionManager] Server connection restored");
      } else if (wasConnected && !isConnected) {
        console.log("[ConnectionManager] Server connection lost, will retry...");
      }
    }, intervalMs);
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // Get delay for next reconnect attempt (exponential backoff)
  getReconnectDelay(): number {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;
    return delay;
  }

  resetReconnectAttempts() {
    this.reconnectAttempts = 0;
  }
}

export const connectionManager = new ConnectionManager();

// Default to environment variables, allow localStorage override
const getApiUrl = () => {
  let url: string;
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("terminalApiUrl");
    if (stored) {
      url = stored;
    } else {
      url = process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:3000";
    }
  } else {
    url = process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:3000";
  }
  // Remove trailing slash to prevent double-slash in URL construction
  return url.replace(/\/+$/, "");
};

// Export getters for use in UI components
export const getDefaultApiUrl = () => {
  return (process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:3000").replace(/\/+$/, "");
};

export const getDefaultApiKey = () => {
  return process.env.NEXT_PUBLIC_TERMINAL_API_KEY || "";
};

const getApiKey = () => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("terminalApiKey");
    if (stored) return stored.trim();
  }
  return (process.env.NEXT_PUBLIC_TERMINAL_API_KEY || "").trim();
};

const headers = (): HeadersInit => {
  const apiKey = getApiKey();
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (apiKey) {
    h["Authorization"] = `Bearer ${apiKey}`;
  }
  return h;
};

export async function getHealth(): Promise<HealthStatus> {
  const res = await fetch(`${getApiUrl()}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await fetch(`${getApiUrl()}/api/sessions`, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getSession(id: string): Promise<SessionInfo> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}`, { headers: headers() });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Session not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function createSession(config: SessionConfig): Promise<SessionInfo> {
  const res = await fetch(`${getApiUrl()}/api/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function killSession(id: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function killAllSessions(): Promise<void> {
  const sessions = await listSessions();
  await Promise.all(sessions.map((s) => {
    const id = s.source === "local" ? s.id : s.name;
    if (!id) return Promise.resolve(); // Skip if no valid ID
    return killSession(id);
  }));
}

export async function sendInput(id: string, input: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}/send`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function resizeSession(id: string, cols: number, rows: number): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}/resize`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ cols, rows }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export function getWebSocketUrl(sessionId: string): string {
  const apiUrl = getApiUrl();
  const wsUrl = apiUrl.replace(/^http/, "ws");
  const apiKey = getApiKey();
  const url = `${wsUrl}/ws/${sessionId}`;
  return apiKey ? `${url}?api_key=${encodeURIComponent(apiKey)}` : url;
}

// HTTP polling fallback for when WebSocket isn't available
export interface PollResponse {
  output: string;
  offset: number;
  status: "running" | "exited";
  exitCode?: number;
}

export async function pollOutput(id: string, offset: number = 0): Promise<PollResponse> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}/output?offset=${offset}`, {
    headers: headers(),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Session not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// Local storage helpers for session names
const SESSION_NAMES_KEY = "terminal_session_names";

export function getSessionNames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SESSION_NAMES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setSessionName(id: string, name: string): void {
  const names = getSessionNames();
  names[id] = name;
  localStorage.setItem(SESSION_NAMES_KEY, JSON.stringify(names));
}

export function removeSessionName(id: string): void {
  const names = getSessionNames();
  delete names[id];
  localStorage.setItem(SESSION_NAMES_KEY, JSON.stringify(names));
}

// Local storage helpers for session folders
const SESSION_FOLDERS_KEY = "terminal_session_folders";
const FOLDERS_LIST_KEY = "terminal_folders";

export function getSessionFolders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SESSION_FOLDERS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setSessionFolder(id: string, folder: string): void {
  const folders = getSessionFolders();
  if (folder) {
    folders[id] = folder;
  } else {
    delete folders[id];
  }
  localStorage.setItem(SESSION_FOLDERS_KEY, JSON.stringify(folders));
}

export function removeSessionFolder(id: string): void {
  const folders = getSessionFolders();
  delete folders[id];
  localStorage.setItem(SESSION_FOLDERS_KEY, JSON.stringify(folders));
}

export function getFoldersList(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FOLDERS_LIST_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addFolder(name: string): void {
  const folders = getFoldersList();
  if (!folders.includes(name)) {
    folders.push(name);
    localStorage.setItem(FOLDERS_LIST_KEY, JSON.stringify(folders));
  }
}

export function removeFolder(name: string): void {
  const folders = getFoldersList().filter(f => f !== name);
  localStorage.setItem(FOLDERS_LIST_KEY, JSON.stringify(folders));

  // Remove folder assignment from all sessions
  const sessionFolders = getSessionFolders();
  for (const [id, folder] of Object.entries(sessionFolders)) {
    if (folder === name) {
      delete sessionFolders[id];
    }
  }
  localStorage.setItem(SESSION_FOLDERS_KEY, JSON.stringify(sessionFolders));
}

// Session and folder descriptions
const SESSION_DESCRIPTIONS_KEY = "terminal_session_descriptions";
const FOLDER_DESCRIPTIONS_KEY = "terminal_folder_descriptions";

export function getSessionDescriptions(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SESSION_DESCRIPTIONS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setSessionDescription(id: string, description: string): void {
  const descriptions = getSessionDescriptions();
  if (description.trim()) {
    descriptions[id] = description.trim();
  } else {
    delete descriptions[id];
  }
  localStorage.setItem(SESSION_DESCRIPTIONS_KEY, JSON.stringify(descriptions));
}

export function getFolderDescriptions(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(FOLDER_DESCRIPTIONS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setFolderDescription(folderName: string, description: string): void {
  const descriptions = getFolderDescriptions();
  if (description.trim()) {
    descriptions[folderName] = description.trim();
  } else {
    delete descriptions[folderName];
  }
  localStorage.setItem(FOLDER_DESCRIPTIONS_KEY, JSON.stringify(descriptions));
}

// Saved directories for quick selection
const SAVED_DIRECTORIES_KEY = "terminal_saved_directories";
const RECENT_DIRECTORIES_KEY = "terminal_recent_directories";
const MAX_RECENT_DIRECTORIES = 10;

export function getSavedDirectories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SAVED_DIRECTORIES_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addSavedDirectory(path: string): void {
  const dirs = getSavedDirectories();
  if (!dirs.includes(path)) {
    dirs.push(path);
    localStorage.setItem(SAVED_DIRECTORIES_KEY, JSON.stringify(dirs));
  }
}

export function removeSavedDirectory(path: string): void {
  const dirs = getSavedDirectories().filter(d => d !== path);
  localStorage.setItem(SAVED_DIRECTORIES_KEY, JSON.stringify(dirs));
}

export function getRecentDirectories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_DIRECTORIES_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addRecentDirectory(path: string): void {
  if (!path) return;
  let dirs = getRecentDirectories().filter(d => d !== path);
  dirs.unshift(path); // Add to front
  dirs = dirs.slice(0, MAX_RECENT_DIRECTORIES); // Keep only last N
  localStorage.setItem(RECENT_DIRECTORIES_KEY, JSON.stringify(dirs));
}

// History capture API - for feeding context to Claude Code sessions
export interface HistoryResponse {
  session: string;
  lines: number;
  format: "plain" | "markdown";
  content: string;
  capturedAt: string;
}

export interface RecapResponse {
  session: string;
  recap: string;
  capturedAt: string;
}

export async function captureHistory(
  id: string,
  options: { lines?: number; format?: "plain" | "markdown" } = {}
): Promise<HistoryResponse> {
  const params = new URLSearchParams();
  if (options.lines) params.set("lines", options.lines.toString());
  if (options.format) params.set("format", options.format);

  const queryString = params.toString();
  const url = `${getApiUrl()}/api/sessions/${id}/history${queryString ? `?${queryString}` : ""}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Session not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateRecap(id: string): Promise<RecapResponse> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}/recap`, {
    headers: headers(),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Session not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// Image upload API - saves image to server and returns file path
export interface ImageUploadResponse {
  success: boolean;
  filepath: string;
  size: number;
  type: string;
}

export async function uploadImage(
  id: string,
  image: string,
  filename?: string
): Promise<ImageUploadResponse> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}/upload-image`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ image, filename }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Session not found");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Folder documentation files storage
const FOLDER_DOC_FILES_KEY = "terminal_folder_doc_files";

export function getFolderDocFiles(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(FOLDER_DOC_FILES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setFolderDocFile(folderName: string, docFile: string): void {
  const docFiles = getFolderDocFiles();
  if (docFile.trim()) {
    docFiles[folderName] = docFile.trim();
  } else {
    delete docFiles[folderName];
  }
  localStorage.setItem(FOLDER_DOC_FILES_KEY, JSON.stringify(docFiles));
}

// ============================================================================
// Claude Code Structured Messages API
// ============================================================================

export interface MessageSession {
  session_id: string;
  message_count: number;
  latest_message_at: string;
  first_message_at: string;
  message_types: string[];
}

// Supabase direct access for messages (client-side)
const getSupabaseUrl = () => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("supabaseUrl");
    if (stored) return stored.replace(/\/+$/, "");
  }
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
};

const getSupabaseAnonKey = () => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("supabaseAnonKey");
    if (stored) return stored.trim();
  }
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
};

// Helper for Supabase REST API calls
async function supabaseRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    searchParams?: Record<string, string>;
  } = {}
): Promise<T> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase not configured");
  }

  const url = new URL(`${supabaseUrl}/rest/v1${path}`);
  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error (${response.status}): ${error}`);
  }

  const text = await response.text();
  if (!text) return [] as T;
  return JSON.parse(text);
}

/**
 * Fetch structured messages for a session.
 */
export async function getSessionMessages(
  sessionId: string,
  options: {
    limit?: number;
    afterSeq?: number;
    messageTypes?: string[];
  } = {}
): Promise<ClaudeCodeMessage[]> {
  const searchParams: Record<string, string> = {
    session_id: `eq.${sessionId}`,
    order: "seq.asc",
  };

  if (options.limit) {
    searchParams.limit = options.limit.toString();
  }

  if (options.afterSeq !== undefined) {
    searchParams.seq = `gt.${options.afterSeq}`;
  }

  if (options.messageTypes && options.messageTypes.length > 0) {
    searchParams.message_type = `in.(${options.messageTypes.join(",")})`;
  }

  return supabaseRequest<ClaudeCodeMessage[]>("/claude_code_messages", {
    searchParams,
  });
}

/**
 * Get message count for a session (efficient count query).
 */
export async function getSessionMessageCount(sessionId: string): Promise<number> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseKey) {
    return 0;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/claude_code_messages?session_id=eq.${encodeURIComponent(sessionId)}&select=count`,
      {
        method: "HEAD",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: "count=exact",
        },
      }
    );

    const countHeader = response.headers.get("content-range");
    if (countHeader) {
      // Format is "0-N/total" or "*/total" when there are no results
      const match = countHeader.match(/\/(\d+)$/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Answer a pending question from Claude.
 */
export async function answerQuestion(
  messageId: string,
  response: string
): Promise<void> {
  await supabaseRequest("/rpc/answer_claude_code_question", {
    method: "POST",
    body: {
      p_message_id: messageId,
      p_response: response,
    },
  });
}

/**
 * Get the latest pending question for a session (if any).
 */
export async function getPendingQuestion(
  sessionId: string
): Promise<ClaudeCodeMessage | null> {
  const messages = await supabaseRequest<ClaudeCodeMessage[]>(
    "/claude_code_messages",
    {
      searchParams: {
        session_id: `eq.${sessionId}`,
        message_type: "eq.user_question",
        user_response: "is.null",
        order: "seq.desc",
        limit: "1",
      },
    }
  );
  return messages[0] || null;
}

/**
 * Subscribe to new messages via polling (simple approach for demo).
 * Returns a function to stop polling.
 */
export function subscribeToMessages(
  sessionId: string,
  onMessage: (messages: ClaudeCodeMessage[]) => void,
  intervalMs: number = 1000
): () => void {
  let lastSeq = -1;
  let active = true;

  const poll = async () => {
    if (!active) return;

    try {
      const messages = await getSessionMessages(sessionId, {
        afterSeq: lastSeq,
      });

      if (messages.length > 0) {
        lastSeq = messages[messages.length - 1].seq;
        onMessage(messages);
      }
    } catch (error) {
      console.error("Message polling error:", error);
    }

    if (active) {
      setTimeout(poll, intervalMs);
    }
  };

  poll();

  return () => {
    active = false;
  };
}

// ============================================================================
// Session History/Archive - Stores killed sessions for later viewing
// ============================================================================

const SESSION_HISTORY_KEY = "terminal_session_history";
const MAX_ARCHIVED_SESSIONS = 100;

export interface ArchivedSession {
  id: string;
  name: string;
  command: string;
  cwd: string;
  createdAt: string;
  killedAt: string;
  folder?: string;
  description?: string;
}

export function getArchivedSessions(): ArchivedSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function archiveSession(session: {
  id: string;
  name?: string;
  command?: string;
  cwd: string;
  createdAt?: string;
}): void {
  const archived = getArchivedSessions();
  const sessionFolders = getSessionFolders();
  const sessionDescriptions = getSessionDescriptions();
  const sessionNames = getSessionNames();

  // Don't archive if already exists
  if (archived.some((s) => s.id === session.id)) return;

  const archivedSession: ArchivedSession = {
    id: session.id,
    name: sessionNames[session.id] || session.name || session.id.slice(0, 8),
    command: session.command || "zsh",
    cwd: session.cwd,
    createdAt: session.createdAt || new Date().toISOString(),
    killedAt: new Date().toISOString(),
    folder: sessionFolders[session.id],
    description: sessionDescriptions[session.id],
  };

  // Add to front and limit size
  archived.unshift(archivedSession);
  const trimmed = archived.slice(0, MAX_ARCHIVED_SESSIONS);

  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(trimmed));
}

export function removeArchivedSession(id: string): void {
  const archived = getArchivedSessions().filter((s) => s.id !== id);
  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(archived));
}

export function clearArchivedSessions(): void {
  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify([]));
}

export function searchArchivedSessions(query: string): ArchivedSession[] {
  const archived = getArchivedSessions();
  if (!query.trim()) return archived;

  const lowerQuery = query.toLowerCase();
  return archived.filter((s) =>
    s.name.toLowerCase().includes(lowerQuery) ||
    s.cwd.toLowerCase().includes(lowerQuery) ||
    s.command.toLowerCase().includes(lowerQuery) ||
    s.folder?.toLowerCase().includes(lowerQuery) ||
    s.description?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * List all unique message sessions from Supabase.
 * Returns session IDs with metadata about message counts and timestamps.
 */
export async function listMessageSessions(): Promise<MessageSession[]> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase not configured. Make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.");
  }

  // Get distinct session_ids with aggregated info
  // Using a simple approach: fetch recent messages and group client-side
  const response = await fetch(
    `${supabaseUrl}/rest/v1/claude_code_messages?select=session_id,message_type,created_at&order=created_at.desc&limit=1000`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error (${response.status}): ${error}`);
  }

  const messages: { session_id: string; message_type: string; created_at: string }[] = await response.json();

  // Group by session_id
  const sessionsMap = new Map<string, {
    session_id: string;
    message_count: number;
    latest_message_at: string;
    first_message_at: string;
    message_types: Set<string>;
  }>();

  for (const msg of messages) {
    const existing = sessionsMap.get(msg.session_id);
    if (existing) {
      existing.message_count++;
      existing.message_types.add(msg.message_type);
      if (msg.created_at > existing.latest_message_at) {
        existing.latest_message_at = msg.created_at;
      }
      if (msg.created_at < existing.first_message_at) {
        existing.first_message_at = msg.created_at;
      }
    } else {
      sessionsMap.set(msg.session_id, {
        session_id: msg.session_id,
        message_count: 1,
        latest_message_at: msg.created_at,
        first_message_at: msg.created_at,
        message_types: new Set([msg.message_type]),
      });
    }
  }

  // Convert to array and sort by latest activity
  return Array.from(sessionsMap.values())
    .map((s) => ({
      ...s,
      message_types: Array.from(s.message_types),
    }))
    .sort((a, b) => b.latest_message_at.localeCompare(a.latest_message_at));
}
