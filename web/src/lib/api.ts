import type { ChatInfo, ChatConfig, HealthStatus } from "./types";
import type { ClaudeCodeMessage } from "./message-types";
import type {
  TrackedCredential,
  TrackedCredentialInput,
  AccountSummary,
  AccountDetails,
  CredentialsGraphData,
  CredentialsStats,
  ApplicationNode,
  OrganizationNode,
  CredentialNode,
  IntegrationHierarchy,
} from "./credential-types";
import type {
  BrainNode,
  BrainNodeInput,
  BrainNodeUpdate,
  BrainNodeFilters,
} from "./brain-types";

// ============================================================================
// localStorage Migration - Migrate old "session" keys to new "chat" keys
// ============================================================================

export function migrateLocalStorage(): void {
  if (typeof window === "undefined") return;

  const migrations: [string, string][] = [
    ["terminal_session_names", "terminal_chat_names"],
    ["terminal_session_folders", "terminal_chat_folders"],
    ["terminal_session_descriptions", "terminal_chat_descriptions"],
    ["terminal_session_history", "terminal_chat_history"],
  ];

  for (const [oldKey, newKey] of migrations) {
    const data = localStorage.getItem(oldKey);
    if (data && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, data);
      localStorage.removeItem(oldKey);
    }
  }
}

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
      url = process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:31337";
    }
  } else {
    url = process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:31337";
  }
  // Remove trailing slash to prevent double-slash in URL construction
  return url.replace(/\/+$/, "");
};

// Export getters for use in UI components
export const getDefaultApiUrl = () => {
  return (process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:31337").replace(/\/+$/, "");
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

export async function listChats(): Promise<ChatInfo[]> {
  const res = await fetch(`${getApiUrl()}/api/sessions`, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getChat(id: string): Promise<ChatInfo> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}`, { headers: headers() });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Chat not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function createChat(config: ChatConfig): Promise<ChatInfo> {
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

export async function killChat(id: string): Promise<void> {
  const url = `${getApiUrl()}/api/sessions/${encodeURIComponent(id)}`;
  console.log(`[API] killChat: DELETE ${url}`);

  const res = await fetch(url, {
    method: "DELETE",
    headers: headers(),
  });

  console.log(`[API] killChat response: ${res.status} ${res.statusText}`);

  if (!res.ok && res.status !== 404) {
    const errorText = await res.text().catch(() => "");
    console.error(`[API] killChat error: ${errorText}`);
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }
}

export async function killAllChats(): Promise<void> {
  const chats = await listChats();
  await Promise.all(chats.map((c) => {
    // Use name (tmux session name) or id (PTY mode), preferring name
    const id = c.name || c.id;
    if (!id) return Promise.resolve(); // Skip if no valid ID
    return killChat(id);
  }));
}

// Legacy aliases for backward compatibility during migration
export const listSessions = listChats;
export const getSession = getChat;
export const createSession = createChat;
export const killSession = killChat;
export const killAllSessions = killAllChats;

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

// Tmux window info for matching with local tmux status bar
export interface TmuxWindowInfo {
  index: number;
  name: string;
  active: boolean;
}

export interface WindowInfoResponse {
  session: string;
  windowCount: number;
  windows: TmuxWindowInfo[];
  activeWindowName?: string;
}

export async function getSessionWindows(id: string): Promise<WindowInfoResponse> {
  const res = await fetch(`${getApiUrl()}/api/sessions/${id}/windows`, {
    headers: headers(),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Session not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// Local storage helpers for chat names
const CHAT_NAMES_KEY = "terminal_chat_names";

export function getChatNames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CHAT_NAMES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setChatName(id: string, name: string): void {
  const names = getChatNames();
  names[id] = name;
  localStorage.setItem(CHAT_NAMES_KEY, JSON.stringify(names));
}

export function removeChatName(id: string): void {
  const names = getChatNames();
  delete names[id];
  localStorage.setItem(CHAT_NAMES_KEY, JSON.stringify(names));
}

// Legacy aliases
export const getSessionNames = getChatNames;
export const setSessionName = setChatName;
export const removeSessionName = removeChatName;

// Local storage helpers for chat folders
const CHAT_FOLDERS_KEY = "terminal_chat_folders";
const FOLDERS_LIST_KEY = "terminal_folders";

export function getChatFolders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CHAT_FOLDERS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setChatFolder(id: string, folder: string): void {
  const folders = getChatFolders();
  if (folder) {
    folders[id] = folder;
  } else {
    delete folders[id];
  }
  localStorage.setItem(CHAT_FOLDERS_KEY, JSON.stringify(folders));
}

export function removeChatFolder(id: string): void {
  const folders = getChatFolders();
  delete folders[id];
  localStorage.setItem(CHAT_FOLDERS_KEY, JSON.stringify(folders));
}

// Legacy aliases
export const getSessionFolders = getChatFolders;
export const setSessionFolder = setChatFolder;
export const removeSessionFolder = removeChatFolder;

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

  // Remove folder assignment from all chats
  const chatFolders = getChatFolders();
  for (const [id, folder] of Object.entries(chatFolders)) {
    if (folder === name) {
      delete chatFolders[id];
    }
  }
  localStorage.setItem(CHAT_FOLDERS_KEY, JSON.stringify(chatFolders));
}

// Chat and folder descriptions
const CHAT_DESCRIPTIONS_KEY = "terminal_chat_descriptions";
const FOLDER_DESCRIPTIONS_KEY = "terminal_folder_descriptions";

export function getChatDescriptions(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CHAT_DESCRIPTIONS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setChatDescription(id: string, description: string): void {
  const descriptions = getChatDescriptions();
  if (description.trim()) {
    descriptions[id] = description.trim();
  } else {
    delete descriptions[id];
  }
  localStorage.setItem(CHAT_DESCRIPTIONS_KEY, JSON.stringify(descriptions));
}

// Legacy aliases
export const getSessionDescriptions = getChatDescriptions;
export const setSessionDescription = setChatDescription;

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
 * Fetch structured messages for a chat.
 * Supports pagination with beforeSeq for loading older messages.
 */
export async function getChatMessages(
  chatId: string,
  options: {
    limit?: number;
    afterSeq?: number;
    beforeSeq?: number;
    messageTypes?: string[];
    order?: "asc" | "desc";
  } = {}
): Promise<ClaudeCodeMessage[]> {
  const searchParams: Record<string, string> = {
    session_id: `eq.${chatId}`,
    order: `seq.${options.order || "asc"}`,
  };

  if (options.limit) {
    searchParams.limit = options.limit.toString();
  }

  if (options.afterSeq !== undefined) {
    searchParams.seq = `gt.${options.afterSeq}`;
  }

  if (options.beforeSeq !== undefined) {
    // If both afterSeq and beforeSeq, use and() syntax
    if (options.afterSeq !== undefined) {
      searchParams.seq = `and(gt.${options.afterSeq},lt.${options.beforeSeq})`;
    } else {
      searchParams.seq = `lt.${options.beforeSeq}`;
    }
  }

  if (options.messageTypes && options.messageTypes.length > 0) {
    searchParams.message_type = `in.(${options.messageTypes.join(",")})`;
  }

  return supabaseRequest<ClaudeCodeMessage[]>("/claude_code_messages", {
    searchParams,
  });
}

/**
 * Get message count for a chat (efficient count query).
 */
export async function getChatMessageCount(chatId: string): Promise<number> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseKey) {
    return 0;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/claude_code_messages?session_id=eq.${encodeURIComponent(chatId)}&select=count`,
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

// Legacy alias
export const getSessionMessageCount = getChatMessageCount;
export const getSessionMessages = getChatMessages;

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
 * Get the latest pending question for a chat (if any).
 */
export async function getPendingQuestion(
  chatId: string
): Promise<ClaudeCodeMessage | null> {
  const messages = await supabaseRequest<ClaudeCodeMessage[]>(
    "/claude_code_messages",
    {
      searchParams: {
        session_id: `eq.${chatId}`,
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
export function subscribeToChatMessages(
  chatId: string,
  onMessage: (messages: ClaudeCodeMessage[]) => void,
  intervalMs: number = 1000
): () => void {
  let lastSeq = -1;
  let active = true;

  const poll = async () => {
    if (!active) return;

    try {
      const messages = await getChatMessages(chatId, {
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

// Legacy alias
export const subscribeToMessages = subscribeToChatMessages;

// ============================================================================
// Chat History/Archive - Stores killed chats for later viewing
// ============================================================================

const CHAT_HISTORY_KEY = "terminal_chat_history";
const MAX_ARCHIVED_CHATS = 100;

export interface ArchivedChat {
  id: string;
  name: string;
  command: string;
  cwd: string;
  createdAt: string;
  killedAt: string;
  folder?: string;
  description?: string;
  /** Truncated terminal history (last ~500 lines) */
  terminalHistory?: string;
}

// Legacy alias
export type ArchivedSession = ArchivedChat;

export function getArchivedChats(): ArchivedChat[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

// Legacy alias
export const getArchivedSessions = getArchivedChats;

export function archiveChat(chat: {
  id: string;
  name?: string;
  command?: string;
  cwd: string;
  createdAt?: string;
  terminalHistory?: string;
}): void {
  const archived = getArchivedChats();
  const chatFolders = getChatFolders();
  const chatDescriptions = getChatDescriptions();
  const chatNames = getChatNames();

  // Don't archive if already exists
  if (archived.some((c) => c.id === chat.id)) return;

  // Truncate terminal history to avoid localStorage overflow (max ~100KB per session)
  let terminalHistory = chat.terminalHistory;
  if (terminalHistory && terminalHistory.length > 100000) {
    // Keep last 100KB
    terminalHistory = terminalHistory.slice(-100000);
  }

  const archivedChat: ArchivedChat = {
    id: chat.id,
    name: chatNames[chat.id] || chat.name || chat.id.slice(0, 8),
    command: chat.command || "zsh",
    cwd: chat.cwd,
    createdAt: chat.createdAt || new Date().toISOString(),
    killedAt: new Date().toISOString(),
    folder: chatFolders[chat.id],
    description: chatDescriptions[chat.id],
    terminalHistory,
  };

  // Add to front and limit size
  archived.unshift(archivedChat);
  const trimmed = archived.slice(0, MAX_ARCHIVED_CHATS);

  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
}

export function removeArchivedChat(id: string): void {
  const archived = getArchivedChats().filter((c) => c.id !== id);
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(archived));
}

export function clearArchivedChats(): void {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify([]));
}

export function searchArchivedChats(query: string): ArchivedChat[] {
  const archived = getArchivedChats();
  if (!query.trim()) return archived;

  const lowerQuery = query.toLowerCase();
  return archived.filter((c) =>
    c.name.toLowerCase().includes(lowerQuery) ||
    c.cwd.toLowerCase().includes(lowerQuery) ||
    c.command.toLowerCase().includes(lowerQuery) ||
    c.folder?.toLowerCase().includes(lowerQuery) ||
    c.description?.toLowerCase().includes(lowerQuery)
  );
}

// Legacy aliases
export const archiveSession = archiveChat;
export const removeArchivedSession = removeArchivedChat;
export const clearArchivedSessions = clearArchivedChats;
export const searchArchivedSessions = searchArchivedChats;

/**
 * List all unique message chats from Supabase.
 * Returns chat IDs with metadata about message counts and timestamps.
 */
export async function listMessageChats(): Promise<MessageSession[]> {
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

// Legacy alias
export const listMessageSessions = listMessageChats;

// ============================================================================
// Credentials API - 1Password credential management
// ============================================================================

/**
 * Get all tracked credentials from Supabase.
 */
export async function getTrackedCredentials(): Promise<TrackedCredential[]> {
  const res = await fetch(`${getApiUrl()}/api/credentials/tracked`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get tracked credentials for a specific account.
 */
export async function getTrackedCredentialsByAccount(
  accountName: string
): Promise<TrackedCredential[]> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/tracked/by-account/${encodeURIComponent(accountName)}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Add a credential to tracking.
 */
export async function addTrackedCredential(
  credential: TrackedCredentialInput
): Promise<TrackedCredential> {
  const res = await fetch(`${getApiUrl()}/api/credentials/tracked`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(credential),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Add multiple credentials at once.
 */
export async function addTrackedCredentials(
  credentials: TrackedCredentialInput[]
): Promise<{ added: number; credentials: TrackedCredential[] }> {
  const res = await fetch(`${getApiUrl()}/api/credentials/tracked/bulk`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ credentials }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Remove a credential from tracking.
 * Note: This does NOT remove from 1Password, only from the tracked list.
 */
export async function removeTrackedCredential(id: string): Promise<void> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/tracked/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: headers(),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

/**
 * Update metadata for a tracked credential.
 */
export async function updateTrackedCredential(
  id: string,
  updates: { service_name?: string; notes?: string }
): Promise<TrackedCredential> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/tracked/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Check if a specific credential is tracked.
 */
export async function isCredentialTracked(
  accountName: string,
  credentialName: string
): Promise<boolean> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/tracked/check?account_name=${encodeURIComponent(
      accountName
    )}&credential_name=${encodeURIComponent(credentialName)}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.tracked;
}

/**
 * List all available 1Password accounts.
 */
export async function get1PasswordAccounts(): Promise<AccountSummary[]> {
  const res = await fetch(`${getApiUrl()}/api/credentials/1password/accounts`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get detailed credential info for a 1Password account.
 */
export async function get1PasswordAccountDetails(
  accountName: string
): Promise<AccountDetails> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/1password/accounts/${encodeURIComponent(accountName)}`,
    { headers: headers() }
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error("Account not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Get graph visualization data for tracked credentials.
 */
export async function getCredentialsGraph(): Promise<CredentialsGraphData> {
  const res = await fetch(`${getApiUrl()}/api/credentials/graph`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get statistics about tracked credentials.
 */
export async function getCredentialsStats(): Promise<CredentialsStats> {
  const res = await fetch(`${getApiUrl()}/api/credentials/stats`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============================================================================
// Integration Hierarchy API - Application → Organization → Credential
// ============================================================================

/**
 * Get all application nodes with logos.
 */
export async function getApplications(): Promise<ApplicationNode[]> {
  const res = await fetch(`${getApiUrl()}/api/credentials/applications`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get a single application by name.
 */
export async function getApplication(name: string): Promise<ApplicationNode> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/applications/${encodeURIComponent(name)}`,
    { headers: headers() }
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error("Application not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Get the full integration hierarchy.
 * Returns a tree: Application → Organization → Credential
 */
export async function getIntegrationHierarchy(): Promise<IntegrationHierarchy> {
  const res = await fetch(`${getApiUrl()}/api/credentials/hierarchy`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get all organization nodes.
 */
export async function getOrganizations(): Promise<OrganizationNode[]> {
  const res = await fetch(`${getApiUrl()}/api/credentials/organizations`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Create a new organization node.
 */
export async function createOrganization(
  name: string,
  displayName: string,
  vaultId?: string,
  vaultName?: string
): Promise<OrganizationNode> {
  const res = await fetch(`${getApiUrl()}/api/credentials/organizations`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name,
      display_name: displayName,
      vault_id: vaultId,
      vault_name: vaultName,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Get all credential nodes from the graph.
 */
export async function getCredentialNodes(): Promise<CredentialNode[]> {
  const res = await fetch(`${getApiUrl()}/api/credentials/credential-nodes`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Create a new credential node.
 */
export async function createCredentialNode(
  accountName: string,
  credentialName: string,
  options?: {
    serviceName?: string;
    itemId?: string;
    fieldLabel?: string;
    notes?: string;
    apiDocsMd?: string;
    trackedCredentialId?: string;
  }
): Promise<CredentialNode> {
  const res = await fetch(`${getApiUrl()}/api/credentials/credential-nodes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      account_name: accountName,
      credential_name: credentialName,
      service_name: options?.serviceName,
      item_id: options?.itemId,
      field_label: options?.fieldLabel,
      notes: options?.notes,
      api_docs_md: options?.apiDocsMd,
      tracked_credential_id: options?.trackedCredentialId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Create a graph relationship between two nodes.
 */
export async function createGraphRelationship(
  sourceId: string,
  targetId: string,
  type: string
): Promise<{ id: string }> {
  const res = await fetch(`${getApiUrl()}/api/credentials/relationships`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      source_id: sourceId,
      target_id: targetId,
      type,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Link a tracked credential to a graph node.
 */
export async function linkCredentialToNode(
  credentialId: string,
  nodeId: string
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${getApiUrl()}/api/credentials/tracked/${encodeURIComponent(credentialId)}/link-node`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ node_id: nodeId }),
    }
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error("Credential not found");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// User Settings API - Persisted settings (Supabase-backed)
// ============================================================================

/**
 * Get all user settings from Supabase.
 * Falls back to localStorage if API fails.
 */
export async function getPersistedSettings(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${getApiUrl()}/api/settings`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    console.error("Failed to fetch settings from server:", err);
    // Fall back to localStorage
    return getLocalSettings();
  }
}

/**
 * Save all user settings to Supabase (replaces all settings).
 * Also saves to localStorage as backup.
 */
export async function savePersistedSettings(settings: Record<string, unknown>): Promise<void> {
  // Always save to localStorage as backup
  saveLocalSettings(settings);

  try {
    const res = await fetch(`${getApiUrl()}/api/settings`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("Failed to save settings to server:", err);
  }
}

/**
 * Update specific settings in Supabase (merges with existing).
 */
export async function updatePersistedSettings(updates: Record<string, unknown>): Promise<void> {
  // Update localStorage
  const localSettings = getLocalSettings();
  saveLocalSettings({ ...localSettings, ...updates });

  try {
    const res = await fetch(`${getApiUrl()}/api/settings`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("Failed to update settings on server:", err);
  }
}

// localStorage helpers for settings
const SETTINGS_KEY = "terminal_user_settings";

function getLocalSettings(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalSettings(settings: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ============================================================================
// Brain API - Knowledge management for reasoning, preferences, workflows
// ============================================================================

/**
 * Graph data structure for brain visualization.
 */
export interface BrainGraphData {
  nodes: {
    id: string;
    label: string;
    type: string;
    category: string | null;
    priority: number;
  }[];
  edges: {
    source: string;
    target: string;
    type: "parent-child" | "related";
  }[];
}

/**
 * Statistics about brain nodes.
 */
export interface BrainStats {
  total: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
  active: number;
  inactive: number;
}

/**
 * Get all brain nodes with optional filters.
 */
export async function getBrainNodes(filters?: BrainNodeFilters): Promise<BrainNode[]> {
  const params = new URLSearchParams();
  if (filters?.node_type) params.set("node_type", filters.node_type);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.source_type) params.set("source_type", filters.source_type);
  if (filters?.is_active !== undefined) params.set("is_active", String(filters.is_active));

  const queryString = params.toString();
  const url = `${getApiUrl()}/api/brain${queryString ? `?${queryString}` : ""}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get a single brain node by ID.
 */
export async function getBrainNode(id: string): Promise<BrainNode> {
  const res = await fetch(`${getApiUrl()}/api/brain/${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Brain node not found");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Create a new brain node.
 */
export async function createBrainNode(input: BrainNodeInput): Promise<BrainNode> {
  const res = await fetch(`${getApiUrl()}/api/brain`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Update an existing brain node.
 */
export async function updateBrainNode(
  id: string,
  updates: BrainNodeUpdate
): Promise<BrainNode> {
  const res = await fetch(`${getApiUrl()}/api/brain/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Brain node not found");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Delete a brain node.
 */
export async function deleteBrainNode(id: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/brain/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

/**
 * Search brain nodes by text query.
 */
export async function searchBrainNodes(query: string): Promise<BrainNode[]> {
  const res = await fetch(
    `${getApiUrl()}/api/brain/search?q=${encodeURIComponent(query)}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get all unique brain node categories.
 */
export async function getBrainCategories(): Promise<string[]> {
  const res = await fetch(`${getApiUrl()}/api/brain/categories`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get brain node statistics.
 */
export async function getBrainStats(): Promise<BrainStats> {
  const res = await fetch(`${getApiUrl()}/api/brain/stats`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Get graph visualization data for brain nodes.
 */
export async function getBrainGraph(): Promise<BrainGraphData> {
  const res = await fetch(`${getApiUrl()}/api/brain/graph`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============================================================================
// Auto-Title Generation API
// ============================================================================

export interface GenerateTitleResponse {
  name: string;
  description: string;
}

/**
 * Generate a session name and description from a user message.
 * Uses Claude to analyze the message and create a concise title.
 */
export async function generateChatTitle(
  message: string,
  clientApiKey?: string
): Promise<GenerateTitleResponse> {
  const res = await fetch("/api/generate-title", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      clientApiKey,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Track which sessions have had auto-title generation attempted
const AUTO_TITLE_ATTEMPTED_KEY = "terminal_auto_title_attempted";

export function getAutoTitleAttempted(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const data = JSON.parse(localStorage.getItem(AUTO_TITLE_ATTEMPTED_KEY) || "[]");
    return new Set(data);
  } catch {
    return new Set();
  }
}

export function markAutoTitleAttempted(sessionId: string): void {
  const attempted = getAutoTitleAttempted();
  attempted.add(sessionId);
  // Keep only the last 1000 session IDs to prevent unbounded growth
  const arr = Array.from(attempted).slice(-1000);
  localStorage.setItem(AUTO_TITLE_ATTEMPTED_KEY, JSON.stringify(arr));
}

export function hasAutoTitleBeenAttempted(sessionId: string): boolean {
  return getAutoTitleAttempted().has(sessionId);
}

// ============================================================================
// GitHub Context Files API
// ============================================================================

const GITHUB_PAT_KEY = "github_pat";
const COMMIT_MESSAGE_MODEL_KEY = "commit_message_model";

/**
 * Get GitHub Personal Access Token from localStorage.
 */
export function getGitHubPat(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GITHUB_PAT_KEY) || "";
}

/**
 * Store GitHub Personal Access Token in localStorage.
 */
export function setGitHubPat(pat: string): void {
  if (typeof window === "undefined") return;
  if (pat.trim()) {
    localStorage.setItem(GITHUB_PAT_KEY, pat.trim());
  } else {
    localStorage.removeItem(GITHUB_PAT_KEY);
  }
}

/**
 * Get the AI model to use for commit message generation.
 */
export function getCommitMessageModel(): string {
  if (typeof window === "undefined") return "gemini-2.0-flash-exp";
  return localStorage.getItem(COMMIT_MESSAGE_MODEL_KEY) || "gemini-2.0-flash-exp";
}

/**
 * Set the AI model for commit message generation.
 */
export function setCommitMessageModel(model: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COMMIT_MESSAGE_MODEL_KEY, model);
}

/**
 * GitHub headers including the PAT token.
 */
function githubHeaders(): HeadersInit {
  const h = headers();
  const pat = getGitHubPat();
  if (pat) {
    (h as Record<string, string>)["X-GitHub-Token"] = pat;
  }
  return h;
}

/**
 * GitHub connection status response.
 */
export interface GitHubStatus {
  connected: boolean;
  user?: string;
  hasRepoAccess?: boolean;
  repo?: string;
  error?: string;
}

/**
 * Test GitHub connection with the stored PAT.
 */
export async function testGitHubConnection(): Promise<GitHubStatus> {
  const pat = getGitHubPat();
  if (!pat) {
    return { connected: false, error: "No token configured" };
  }

  try {
    const res = await fetch(`${getApiUrl()}/api/github/status`, {
      headers: githubHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/**
 * Context file response from GitHub.
 */
export interface ContextFileResponse {
  content: string;
  sha: string;
  lastModified: string;
  exists: boolean;
}

/**
 * Get the path for a folder's context file.
 */
export function getContextFilePath(folderName: string): string {
  // Sanitize folder name for use in file path
  const safeName = folderName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `cloud-terminal/projects/${safeName}/CONTEXT.md`;
}

/**
 * Fetch a project context file from GitHub.
 */
export async function getContextFile(folderName: string): Promise<ContextFileResponse> {
  const path = getContextFilePath(folderName);

  const res = await fetch(
    `${getApiUrl()}/api/github/file?path=${encodeURIComponent(path)}`,
    { headers: githubHeaders() }
  );

  if (res.status === 404) {
    return {
      content: "",
      sha: "",
      lastModified: "",
      exists: false,
    };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Save a project context file to GitHub.
 */
export async function saveContextFile(
  folderName: string,
  content: string,
  message: string,
  sha?: string
): Promise<{ success: boolean; commitSha?: string; fileSha?: string; error?: string }> {
  const path = getContextFilePath(folderName);

  const res = await fetch(`${getApiUrl()}/api/github/commit`, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({
      path,
      content,
      message,
      sha,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: err.error || `HTTP ${res.status}` };
  }

  return res.json();
}

/**
 * Generate a commit message for context file changes.
 */
export async function generateCommitMessage(
  oldContent: string,
  newContent: string,
  model?: string
): Promise<string> {
  const res = await fetch(`${getApiUrl()}/api/github/generate-commit-message`, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({
      oldContent,
      newContent,
      model: model || getCommitMessageModel(),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.message;
}

/**
 * Create a new context file with the default template.
 */
export function getContextFileTemplate(projectName: string): string {
  return `# ${projectName}

## Overview
<!-- Brief description of this project -->

## Key Files
<!-- Important files and their purposes -->

## Architecture
<!-- High-level architecture notes -->

## Patterns & Conventions
<!-- Coding patterns used in this project -->

## Current State
<!-- What's working, what's in progress -->

## TODOs
<!-- Upcoming tasks or known issues -->
`;
}

/**
 * Create a new context file for a project folder.
 */
export async function createContextFile(
  folderName: string
): Promise<{ success: boolean; error?: string }> {
  const pat = getGitHubPat();
  if (!pat) {
    return { success: false, error: "GitHub token not configured" };
  }

  const content = getContextFileTemplate(folderName);
  const message = `Initialize context file for ${folderName}`;

  return saveContextFile(folderName, content, message);
}

/**
 * Available AI models for commit message generation.
 */
export interface AIModel {
  id: string;
  name: string;
  provider: string;
  default?: boolean;
}

/**
 * Get available AI models for commit message generation.
 */
export async function getAvailableModels(): Promise<AIModel[]> {
  try {
    const res = await fetch(`${getApiUrl()}/api/github/models`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.models;
  } catch {
    // Return defaults if API fails
    return [
      { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", provider: "google", default: true },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
    ];
  }
}
