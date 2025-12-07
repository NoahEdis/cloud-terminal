import type { SessionInfo, SessionConfig, HealthStatus } from "./types";

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
