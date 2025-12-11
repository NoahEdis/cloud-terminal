"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Terminal,
  Plus,
  Trash2,
  RefreshCw,
  Pencil,
  Check,
  X,
  Settings,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Star,
  Clock,
  FileCode,
  Search,
  Archive,
  History,
  AlertTriangle,
  Bot,
  Plug,
  MonitorSmartphone,
  Cloud,
  Brain,
} from "lucide-react";
import {
  listSessions,
  createSession,
  killSession,
  killAllSessions,
  getSessionNames,
  setSessionName,
  getDefaultApiUrl,
  getDefaultApiKey,
  getSessionFolders,
  setSessionFolder,
  getFoldersList,
  addFolder,
  removeFolder,
  getSavedDirectories,
  addSavedDirectory,
  removeSavedDirectory,
  getRecentDirectories,
  addRecentDirectory,
  getSessionDescriptions,
  setSessionDescription,
  getFolderDescriptions,
  setFolderDescription,
  getFolderDocFiles,
  setFolderDocFile,
  archiveSession,
  getArchivedSessions,
  searchArchivedSessions,
  removeArchivedSession,
  clearArchivedSessions,
  getPersistedSettings,
  updatePersistedSettings,
  type ArchivedSession,
} from "@/lib/api";
import type { SessionInfo, SessionConfig, ActivityState, SessionMetrics, ChatType } from "@/lib/types";
import { getSessionId } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ChatListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function ActivityIndicator({ state }: { state?: ActivityState }) {
  const stateColors = {
    idle: "bg-emerald-500",
    busy: "bg-amber-500 animate-pulse",
    exited: "bg-zinc-600",
  };

  const stateLabels = {
    idle: "Waiting for input",
    busy: "Running",
    exited: "Exited",
  };

  const currentState = state || "exited";

  return (
    <div
      className={`w-1.5 h-1.5 rounded-full ${stateColors[currentState]}`}
      title={stateLabels[currentState]}
    />
  );
}

export default function ChatList({ selectedId, onSelect }: ChatListProps) {
  // Note: internal state still uses "session" naming for backward compatibility
  // but the external interface and UI use "chat" terminology
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [sessionNames, setSessionNamesState] = useState<Record<string, string>>({});
  const [sessionFolders, setSessionFoldersState] = useState<Record<string, string>>({});
  const [folders, setFoldersState] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [localStorageLoaded, setLocalStorageLoaded] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionConfig, setNewSessionConfig] = useState<SessionConfig>({
    command: "zsh",
    cwd: "/Users/noahedis",
  });
  const [newSessionFolder, setNewSessionFolder] = useState("");
  // Chat type for new chat dialog
  const [newChatType, setNewChatType] = useState<ChatType>("claude");
  const [showSettings, setShowSettings] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  // Claude Code settings
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // Directory picker state
  const [savedDirectories, setSavedDirectoriesState] = useState<string[]>([]);
  const [recentDirectories, setRecentDirectoriesState] = useState<string[]>([]);
  // Description state
  const [sessionDescriptions, setSessionDescriptionsState] = useState<Record<string, string>>({});
  const [folderDescriptions, setFolderDescriptionsState] = useState<Record<string, string>>({});
  const [editingDescription, setEditingDescription] = useState<{ type: "session" | "folder"; id: string } | null>(null);
  const [newDescription, setNewDescription] = useState("");
  // Doc files state
  const [folderDocFiles, setFolderDocFilesState] = useState<Record<string, string>>({});
  const [editingDocFile, setEditingDocFile] = useState<string | null>(null);
  const [newDocFile, setNewDocFile] = useState("");
  // Search and archived sessions state
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archivedSessions, setArchivedSessionsState] = useState<ArchivedSession[]>([]);
  const [isKillingAll, setIsKillingAll] = useState(false);
  // Drag and drop state
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  // Router for navigation
  const router = useRouter();

  // Load saved and recent directories, descriptions, doc files, and archived sessions
  useEffect(() => {
    setSavedDirectoriesState(getSavedDirectories());
    setRecentDirectoriesState(getRecentDirectories());
    setSessionDescriptionsState(getSessionDescriptions());
    setFolderDescriptionsState(getFolderDescriptions());
    setFolderDocFilesState(getFolderDocFiles());
    setArchivedSessionsState(getArchivedSessions());
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      setError(null);
      const data = await listSessions();
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load localStorage data on client side only
    setSessionNamesState(getSessionNames());
    setSessionFoldersState(getSessionFolders());
    setFoldersState(getFoldersList());

    // Load settings from localStorage first for immediate UI
    const storedUrl = localStorage.getItem("terminalApiUrl");
    const storedKey = localStorage.getItem("terminalApiKey");
    const storedOpenaiKey = localStorage.getItem("openaiApiKey");
    const storedGeminiKey = localStorage.getItem("geminiApiKey");
    const storedSkipPermissions = localStorage.getItem("claudeSkipPermissions");

    setApiUrl(storedUrl || getDefaultApiUrl());
    setApiKey(storedKey ?? getDefaultApiKey());
    setOpenaiApiKey(storedOpenaiKey || "");
    setGeminiApiKey(storedGeminiKey || "");
    setSkipPermissions(storedSkipPermissions !== "false"); // Default to true
    setLocalStorageLoaded(true);

    // Then load persisted settings from Supabase (overrides localStorage if available)
    getPersistedSettings().then((settings) => {
      if (settings.openaiApiKey) setOpenaiApiKey(settings.openaiApiKey as string);
      if (settings.geminiApiKey) setGeminiApiKey(settings.geminiApiKey as string);
      if (settings.claudeSkipPermissions !== undefined) setSkipPermissions(settings.claudeSkipPermissions as boolean);
      // Note: API URL and API key are intentionally NOT synced from server
      // as they need to be local to connect to the server in the first place
    }).catch((err) => {
      console.error("Failed to load persisted settings:", err);
    });

    fetchSessions();

    const interval = setInterval(fetchSessions, 2000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Filter sessions and archived sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter((session) => {
      const sessionId = getSessionId(session);
      const name = sessionNames[sessionId] || session.name || "";
      const description = sessionDescriptions[sessionId] || "";
      return (
        name.toLowerCase().includes(query) ||
        session.cwd.toLowerCase().includes(query) ||
        (session.command || "").toLowerCase().includes(query) ||
        description.toLowerCase().includes(query)
      );
    });
  }, [sessions, searchQuery, sessionNames, sessionDescriptions]);

  const filteredArchivedSessions = useMemo(() => {
    return searchArchivedSessions(searchQuery);
  }, [searchQuery, archivedSessions]);

  const groupedSessions = useMemo(() => {
    const groups: Record<string, SessionInfo[]> = { "": [] };

    for (const folder of folders) {
      groups[folder] = [];
    }

    for (const session of filteredSessions) {
      const sessionId = getSessionId(session);
      const folder = sessionFolders[sessionId] || "";
      if (!groups[folder]) {
        groups[folder] = [];
      }
      groups[folder].push(session);
    }

    return groups;
  }, [filteredSessions, sessionFolders, folders]);

  const handleCreate = async () => {
    try {
      // Build auto-run command based on chat type
      let autoRunCommand: string | undefined;
      if (newChatType === "claude") {
        autoRunCommand = skipPermissions ? "claude --dangerously-skip-permissions" : "claude";
      }

      // Create session with optional auto-run command
      const session = await createSession({
        ...newSessionConfig,
        autoRunCommand,
        chatType: newChatType,
      });
      const sessionId = getSessionId(session);
      setSessions((prev) => [...prev, session]);
      // Handle folder assignment (empty string or "__none__" means no folder)
      const folderToAssign = newSessionFolder && newSessionFolder !== "__none__" ? newSessionFolder : "";
      if (folderToAssign) {
        setSessionFolder(sessionId, folderToAssign);
        setSessionFoldersState(getSessionFolders());
      }
      // Add directory to recent list
      if (newSessionConfig.cwd) {
        addRecentDirectory(newSessionConfig.cwd);
        setRecentDirectoriesState(getRecentDirectories());
      }
      setShowNewSession(false);
      setNewSessionConfig({ command: "zsh", cwd: "/Users/noahedis" });
      setNewSessionFolder("");
      setNewChatType("claude"); // Reset to default
      onSelect(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    }
  };

  // Directory picker helpers
  const handleSelectDirectory = (dir: string) => {
    setNewSessionConfig((prev) => ({ ...prev, cwd: dir }));
  };

  const handleSaveCurrentDirectory = () => {
    if (newSessionConfig.cwd) {
      addSavedDirectory(newSessionConfig.cwd);
      setSavedDirectoriesState(getSavedDirectories());
    }
  };

  const handleRemoveSavedDirectory = (dir: string) => {
    removeSavedDirectory(dir);
    setSavedDirectoriesState(getSavedDirectories());
  };

  // Description handlers
  const handleEditDescription = (type: "session" | "folder", id: string) => {
    const currentDesc = type === "session" ? sessionDescriptions[id] : folderDescriptions[id];
    setNewDescription(currentDesc || "");
    setEditingDescription({ type, id });
  };

  const handleSaveDescription = () => {
    if (!editingDescription) return;
    if (editingDescription.type === "session") {
      setSessionDescription(editingDescription.id, newDescription);
      setSessionDescriptionsState(getSessionDescriptions());
    } else {
      setFolderDescription(editingDescription.id, newDescription);
      setFolderDescriptionsState(getFolderDescriptions());
    }
    setEditingDescription(null);
    setNewDescription("");
  };

  const handleCancelDescription = () => {
    setEditingDescription(null);
    setNewDescription("");
  };

  // Doc file handlers
  const handleEditDocFile = (folderName: string) => {
    setNewDocFile(folderDocFiles[folderName] || "");
    setEditingDocFile(folderName);
  };

  const handleSaveDocFile = () => {
    if (!editingDocFile) return;
    setFolderDocFile(editingDocFile, newDocFile);
    setFolderDocFilesState(getFolderDocFiles());
    setEditingDocFile(null);
    setNewDocFile("");
  };

  const handleCancelDocFile = () => {
    setEditingDocFile(null);
    setNewDocFile("");
  };

  // Create terminal in folder handler
  const handleCreateInFolder = async (folderName: string) => {
    // Pre-set the folder for the new session dialog
    setNewSessionFolder(folderName);
    setShowNewSession(true);
  };

  const handleKill = async (id: string) => {
    console.log("[handleKill] ENTERED with id:", id);

    // Skip confirmation for now - just kill directly for debugging
    console.log(`[ChatList] Killing session: ${id}`);

    try {
      // Find the session to archive it before killing
      const sessionToKill = sessions.find((s) => getSessionId(s) === id);
      if (sessionToKill) {
        archiveSession({
          id: getSessionId(sessionToKill),
          name: sessionToKill.name,
          command: sessionToKill.command,
          cwd: sessionToKill.cwd,
          createdAt: sessionToKill.lastActivity,
        });
        setArchivedSessionsState(getArchivedSessions());
      }

      console.log(`[ChatList] Calling killSession API for: ${id}`);
      await killSession(id);
      console.log(`[ChatList] killSession completed for: ${id}`);

      // Calculate remaining sessions before updating state
      const remainingSessions = sessions.filter((s) => getSessionId(s) !== id);
      setSessions(remainingSessions);

      // If the killed session was selected, select the next available or clear
      if (selectedId === id) {
        if (remainingSessions.length > 0) {
          onSelect(getSessionId(remainingSessions[0]));
        } else {
          onSelect("");
        }
      }
    } catch (e) {
      console.error(`[ChatList] Failed to kill session ${id}:`, e);
      setError(e instanceof Error ? e.message : "Failed to kill session");
    }
  };

  const handleKillAll = async () => {
    if (!confirm("Kill ALL sessions? This action cannot be undone.")) return;

    setIsKillingAll(true);
    try {
      // Archive all sessions before killing
      for (const session of sessions) {
        archiveSession({
          id: getSessionId(session),
          name: session.name,
          command: session.command,
          cwd: session.cwd,
          createdAt: session.lastActivity,
        });
      }
      setArchivedSessionsState(getArchivedSessions());

      await killAllSessions();
      setSessions([]);
      onSelect("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to kill all sessions");
    } finally {
      setIsKillingAll(false);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (sessionId: string) => {
    setDraggedSessionId(sessionId);
  };

  const handleDragEnd = () => {
    setDraggedSessionId(null);
    setDragOverFolder(null);
  };

  const handleDragOver = (e: React.DragEvent, folderName: string) => {
    e.preventDefault();
    setDragOverFolder(folderName);
  };

  const handleDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleDrop = (folderName: string) => {
    if (draggedSessionId) {
      handleMoveToFolder(draggedSessionId, folderName);
    }
    setDraggedSessionId(null);
    setDragOverFolder(null);
  };

  const handleRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName || id.slice(0, 8));
  };

  const saveRename = (id: string) => {
    if (editName.trim()) {
      setSessionName(id, editName.trim());
      setSessionNamesState(getSessionNames());
    }
    setEditingId(null);
    setEditName("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveSettings = async () => {
    // Save to localStorage (for API URL/key needed to connect)
    localStorage.setItem("terminalApiUrl", apiUrl);
    localStorage.setItem("terminalApiKey", apiKey);
    localStorage.setItem("openaiApiKey", openaiApiKey);
    localStorage.setItem("geminiApiKey", geminiApiKey);
    localStorage.setItem("claudeSkipPermissions", skipPermissions.toString());

    // Persist API keys and settings to Supabase for cross-device/deploy persistence
    try {
      await updatePersistedSettings({
        openaiApiKey,
        geminiApiKey,
        claudeSkipPermissions: skipPermissions,
      });
    } catch (err) {
      console.error("Failed to persist settings:", err);
    }

    setShowSettings(false);
    fetchSessions();
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      addFolder(newFolderName.trim());
      setFoldersState(getFoldersList());
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  const handleDeleteFolder = (folderName: string) => {
    if (confirm(`Delete folder "${folderName}"? Sessions will be moved to ungrouped.`)) {
      removeFolder(folderName);
      setFoldersState(getFoldersList());
      setSessionFoldersState(getSessionFolders());
    }
  };

  const handleMoveToFolder = (sessionId: string, folder: string) => {
    setSessionFolder(sessionId, folder);
    setSessionFoldersState(getSessionFolders());
  };

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const getDisplayName = (session: SessionInfo) => {
    const sessionId = getSessionId(session);
    // Check for custom display name first
    if (sessionNames[sessionId]) {
      return sessionNames[sessionId];
    }
    // For tmux sessions, use the name directly (it's already readable)
    if (session.name) {
      return session.name;
    }
    // For PTY sessions, use command + truncated id
    return `${session.command || "terminal"} (${sessionId.slice(0, 8)})`;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Format metrics for display (lines and estimated tokens)
  const formatMetrics = (metrics?: SessionMetrics) => {
    if (!metrics || metrics.lineCount === 0) return null;

    const formatNumber = (n: number) => {
      if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
      return n.toString();
    };

    return {
      lines: formatNumber(metrics.lineCount),
      tokens: formatNumber(metrics.estimatedTokens),
    };
  };

  // Sync localStorage data periodically to ensure consistency across devices/tabs
  useEffect(() => {
    const syncLocalStorage = () => {
      setSessionNamesState(getSessionNames());
      setSessionFoldersState(getSessionFolders());
      setFoldersState(getFoldersList());
      setSessionDescriptionsState(getSessionDescriptions());
      setFolderDescriptionsState(getFolderDescriptions());
      setFolderDocFilesState(getFolderDocFiles());
      setArchivedSessionsState(getArchivedSessions());
    };
    const interval = setInterval(syncLocalStorage, 500);
    return () => clearInterval(interval);
  }, []);

  // Render session menu items (shared between dropdown and context menu)
  const renderSessionMenuItems = (sessionId: string, isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu ? ContextMenuSeparator : DropdownMenuSeparator;
    const MenuLabel = isContextMenu ? ContextMenuLabel : DropdownMenuLabel;

    return (
      <>
        <MenuItem onSelect={() => handleRename(sessionId, sessionNames[sessionId] || "")} className="text-[12px]">
          <Pencil className="w-3 h-3 mr-2" />
          Rename
        </MenuItem>
        <MenuItem onSelect={() => handleEditDescription("session", sessionId)} className="text-[12px]">
          <Pencil className="w-3 h-3 mr-2" />
          {sessionDescriptions[sessionId] ? "Edit Description" : "Add Description"}
        </MenuItem>
        {folders.length > 0 && (
          <>
            <MenuSeparator className="bg-zinc-800" />
            <MenuLabel className="text-[11px] text-zinc-500">Move to folder</MenuLabel>
            <MenuItem
              onSelect={() => handleMoveToFolder(sessionId, "")}
              className={`text-[12px] ${!sessionFolders[sessionId] ? "text-zinc-100" : ""}`}
            >
              (No folder)
            </MenuItem>
            {folders.map((folder) => (
              <MenuItem
                key={folder}
                onSelect={() => handleMoveToFolder(sessionId, folder)}
                className={`text-[12px] ${sessionFolders[sessionId] === folder ? "text-zinc-100" : ""}`}
              >
                {folder}
              </MenuItem>
            ))}
          </>
        )}
        <MenuSeparator className="bg-zinc-800" />
        <MenuItem
          onSelect={() => {
            console.log("[MenuItem] onSelect fired for Kill:", sessionId);
            console.log("[MenuItem] typeof handleKill:", typeof handleKill);
            try {
              handleKill(sessionId);
              console.log("[MenuItem] handleKill called successfully");
            } catch (e) {
              console.error("[MenuItem] handleKill threw error:", e);
            }
          }}
          onClick={() => {
            console.log("[MenuItem] onClick fired for Kill:", sessionId);
          }}
          className="text-[12px] text-red-400 focus:text-red-400"
        >
          <Trash2 className="w-3 h-3 mr-2" />
          Kill Session
        </MenuItem>
      </>
    );
  };

  const renderSession = (session: SessionInfo) => {
    const sessionId = getSessionId(session);
    const isDragging = draggedSessionId === sessionId;

    const sessionContent = (
      <div
        onClick={() => onSelect(sessionId)}
        draggable
        onDragStart={() => handleDragStart(sessionId)}
        onDragEnd={handleDragEnd}
        className={`p-2.5 rounded cursor-pointer transition-colors border ${
          selectedId === sessionId
            ? "border-zinc-700 bg-zinc-900"
            : "border-transparent hover:bg-zinc-900/50"
        } ${isDragging ? "opacity-50" : ""}`}
      >
        <div className="flex items-center justify-between">
          {editingId === sessionId ? (
            <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
              <Input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename(sessionId);
                  if (e.key === "Escape") cancelRename();
                }}
                className="flex-1 h-7 text-[12px] bg-zinc-900 border-zinc-700"
                autoFocus
              />
              <button
                className="p-1 rounded hover:bg-zinc-800"
                onClick={() => saveRename(sessionId)}
              >
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              </button>
              <button
                className="p-1 rounded hover:bg-zinc-800"
                onClick={cancelRename}
              >
                <X className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                <ActivityIndicator state={session.activityState} />
                <span className="truncate text-[12px] font-medium text-zinc-200">
                  {getDisplayName(session)}
                </span>
                {session.source === "local" && (
                  <Tooltip delayDuration={800}>
                    <TooltipTrigger asChild>
                      <span className="flex-shrink-0">
                        {session.attached ? (
                          <MonitorSmartphone className="w-3 h-3 text-zinc-500" />
                        ) : (
                          <Cloud className="w-3 h-3 text-zinc-600" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                      {session.attached ? "Attached locally via tmux" : "Running in background (detached)"}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center ml-1"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1 rounded hover:bg-zinc-800">
                      <MoreVertical className="w-3.5 h-3.5 text-zinc-500" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-44 bg-zinc-900 border-zinc-800"
                    onClick={(e) => console.log("[DropdownMenuContent] clicked, target:", (e.target as HTMLElement).textContent)}
                  >
                    {renderSessionMenuItems(sessionId, false)}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </div>
        {sessionDescriptions[sessionId] && (
          <div className="mt-1 text-[11px] text-zinc-500 italic truncate">
            {sessionDescriptions[sessionId]}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="truncate flex-1 min-w-0">{session.cwd}</span>
          <span className="flex-shrink-0 whitespace-nowrap text-zinc-600">
            {(() => {
              const metrics = formatMetrics(session.metrics);
              if (metrics) {
                return `${metrics.lines}L / ${metrics.tokens}t`;
              }
              return null;
            })()}
          </span>
          <span className="flex-shrink-0 whitespace-nowrap">{formatTime(session.lastActivity)}</span>
        </div>
      </div>
    );

    return (
      <ContextMenu key={sessionId}>
        <ContextMenuTrigger asChild>
          {sessionContent}
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-44 bg-zinc-900 border-zinc-800"
          onClick={(e) => console.log("[ContextMenuContent] clicked, target:", (e.target as HTMLElement).textContent)}
        >
          {renderSessionMenuItems(sessionId, true)}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderFolderSection = (folderName: string, folderSessions: SessionInfo[]) => {
    const isCollapsed = collapsedFolders.has(folderName);
    const hasIdleSessions = folderSessions.some((s) => s.activityState === "idle");
    const isDragOver = dragOverFolder === folderName;

    return (
      <div
        key={folderName || "__ungrouped"}
        className="mb-2"
        onDragOver={(e) => handleDragOver(e, folderName)}
        onDragLeave={handleDragLeave}
        onDrop={() => handleDrop(folderName)}
      >
        {folderName && (
          <div
            className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer hover:bg-zinc-900/50 group transition-colors ${
              isDragOver ? "bg-blue-900/30 border border-blue-700/50" : ""
            }`}
            onClick={() => toggleFolder(folderName)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                )}
                {isCollapsed ? (
                  <Folder className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <FolderOpen className="w-3.5 h-3.5 text-zinc-300" />
                )}
                <span className="text-[12px] font-medium text-zinc-200">{folderName}</span>
                <span className="text-[10px] px-1 py-0 rounded bg-zinc-800 text-zinc-500">
                  {folderSessions.length}
                </span>
                {folderDocFiles[folderName] && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center">
                        <FileCode className="w-3 h-3 text-zinc-600" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="bg-zinc-900 border-zinc-800 text-[11px]">{folderDocFiles[folderName]}</TooltipContent>
                  </Tooltip>
                )}
                {hasIdleSessions && isCollapsed && (
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </div>
              {folderDescriptions[folderName] && (
                <div className="ml-8 text-[11px] text-zinc-500 italic truncate">
                  {folderDescriptions[folderName]}
                </div>
              )}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800">
                    <MoreVertical className="w-3.5 h-3.5 text-zinc-500" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
                  <DropdownMenuItem onClick={() => handleCreateInFolder(folderName)} className="text-[12px]">
                    <Plus className="w-3 h-3 mr-2" />
                    New Terminal
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-zinc-800" />
                  <DropdownMenuItem onClick={() => handleEditDescription("folder", folderName)} className="text-[12px]">
                    <Pencil className="w-3 h-3 mr-2" />
                    {folderDescriptions[folderName] ? "Edit Description" : "Add Description"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditDocFile(folderName)} className="text-[12px]">
                    <FileCode className="w-3 h-3 mr-2" />
                    {folderDocFiles[folderName] ? "Edit Doc File" : "Set Doc File"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-zinc-800" />
                  <DropdownMenuItem
                    onClick={() => handleDeleteFolder(folderName)}
                    className="text-[12px] text-red-400 focus:text-red-400"
                  >
                    <Trash2 className="w-3 h-3 mr-2" />
                    Delete folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        {(!folderName || !isCollapsed) && (
          <div className={`space-y-1 ${folderName ? "ml-5 mt-1" : ""}`}>
            {folderSessions.length === 0 ? (
              !folderName && sessions.length > 0 ? null : (
                <p className="px-2 py-3 text-[11px] italic text-zinc-600">
                  {folderName ? "No sessions in this folder" : "No ungrouped sessions"}
                </p>
              )
            ) : (
              folderSessions.map((session) => (
                <div key={getSessionId(session)} className="group">
                  {renderSession(session)}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-black">
      {/* Header */}
      <div className="px-3 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-medium text-zinc-100">Chats</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${showArchived ? "bg-zinc-800" : ""}`}
              title={showArchived ? "Hide History" : "Show History"}
            >
              <History className={`w-3.5 h-3.5 ${showArchived ? "text-zinc-100" : "text-zinc-400"}`} />
            </button>
            <button
              onClick={() => setShowNewFolder(true)}
              className="p-1.5 rounded hover:bg-zinc-800 transition-colors"
              title="New Folder"
            >
              <FolderPlus className="w-3.5 h-3.5 text-zinc-400" />
            </button>
            <button
              onClick={fetchSessions}
              className="p-1.5 rounded hover:bg-zinc-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded hover:bg-zinc-800 transition-colors"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          </div>
        </div>
        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="h-8 pl-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-zinc-800"
            >
              <X className="w-3 h-3 text-zinc-500" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowNewSession(true)}
          className="w-full flex items-center justify-center gap-1.5 h-8 text-[12px] rounded border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-300"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-[12px] text-red-400 bg-red-950/50 border-b border-zinc-800">
          {error}
        </div>
      )}

      {/* Session List */}
      <ScrollArea className="flex-1 px-3 py-2">
        {loading || !localStorageLoaded ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin" />
          </div>
        ) : filteredSessions.length === 0 && folders.length === 0 && !searchQuery && !showArchived ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Terminal className="w-6 h-6 mb-2 text-zinc-600" />
            <p className="text-[12px] text-zinc-400">No chats yet</p>
            <p className="text-[11px] mt-1 text-zinc-600">
              Create a new chat to get started
            </p>
          </div>
        ) : (
          <>
            {/* Search results indicator */}
            {searchQuery && (
              <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-zinc-900/50 border border-zinc-800">
                <Search className="w-3 h-3 text-zinc-500" />
                <span className="text-[11px] text-zinc-400">
                  {filteredSessions.length} active{filteredSessions.length !== 1 ? "s" : ""}
                  {showArchived && `, ${filteredArchivedSessions.length} archived`}
                </span>
              </div>
            )}

            {/* Active sessions */}
            {folders.map((folder) => renderFolderSection(folder, groupedSessions[folder] || []))}
            {renderFolderSection("", groupedSessions[""] || [])}

            {/* Archived sessions */}
            {showArchived && filteredArchivedSessions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between mb-2 px-2">
                  <div className="flex items-center gap-1.5">
                    <Archive className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-[12px] font-medium text-zinc-400">History</span>
                    <span className="text-[10px] px-1 py-0 rounded bg-zinc-800 text-zinc-500">
                      {filteredArchivedSessions.length}
                    </span>
                  </div>
                  {archivedSessions.length > 0 && (
                    <button
                      onClick={() => {
                        if (confirm("Clear all session history?")) {
                          clearArchivedSessions();
                          setArchivedSessionsState([]);
                        }
                      }}
                      className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {filteredArchivedSessions.map((archived) => (
                    <div
                      key={archived.id}
                      onClick={() => onSelect(archived.id)}
                      className={`p-2.5 rounded cursor-pointer transition-colors border ${
                        selectedId === archived.id
                          ? "border-zinc-700 bg-zinc-900"
                          : "border-transparent hover:bg-zinc-900/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" title="Archived" />
                          <span className="truncate text-[12px] font-medium text-zinc-400">
                            {archived.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                            archived
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeArchivedSession(archived.id);
                            setArchivedSessionsState(getArchivedSessions());
                          }}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-800"
                          title="Remove from history"
                        >
                          <X className="w-3 h-3 text-zinc-500" />
                        </button>
                      </div>
                      {archived.description && (
                        <div className="mt-1 text-[11px] text-zinc-600 italic truncate">
                          {archived.description}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-600">
                        <span className="truncate flex-1">{archived.cwd}</span>
                        <span className="ml-2 flex-shrink-0">
                          {new Date(archived.killedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No results message */}
            {searchQuery && filteredSessions.length === 0 && (!showArchived || filteredArchivedSessions.length === 0) && (
              <div className="flex flex-col items-center justify-center h-24 text-center">
                <Search className="w-5 h-5 mb-2 text-zinc-600" />
                <p className="text-[12px] text-zinc-400">No chats found</p>
                <p className="text-[11px] mt-1 text-zinc-600">
                  Try a different search term{!showArchived && " or check history"}
                </p>
              </div>
            )}
          </>
        )}
      </ScrollArea>

      {/* Footer with Brain and Credentials buttons */}
      <div className="px-3 py-2 pb-8 border-t border-zinc-800 space-y-1">
        <button
          onClick={() => router.push("/brain")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded transition-colors"
        >
          <Brain className="w-4 h-4" />
          <span>Brain</span>
        </button>
        <button
          onClick={() => router.push("/integrations")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded transition-colors"
        >
          <Plug className="w-4 h-4" />
          <span>Integrations</span>
        </button>
      </div>

      {/* New Chat Dialog */}
      <Dialog open={showNewSession} onOpenChange={setShowNewSession}>
        <DialogContent className="bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-medium text-zinc-100">New Chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Chat Type Selector */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Chat Type
              </label>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setNewChatType("claude")}
                  className={`flex items-start gap-3 p-3 rounded border transition-colors text-left ${
                    newChatType === "claude"
                      ? "border-emerald-600 bg-emerald-950/30"
                      : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/50"
                  }`}
                >
                  <div className={`p-1.5 rounded ${newChatType === "claude" ? "bg-emerald-600" : "bg-zinc-800"}`}>
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-zinc-200">Claude Code</span>
                      {newChatType === "claude" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-600/30">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      AI-powered coding assistant with full codebase access
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewChatType("custom")}
                  className={`flex items-start gap-3 p-3 rounded border transition-colors text-left ${
                    newChatType === "custom"
                      ? "border-zinc-600 bg-zinc-900"
                      : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/50"
                  }`}
                >
                  <div className={`p-1.5 rounded ${newChatType === "custom" ? "bg-zinc-600" : "bg-zinc-800"}`}>
                    <Terminal className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-zinc-200">Custom Terminal</span>
                      {newChatType === "custom" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-600/20 text-zinc-400 border border-zinc-600/30">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      Standard terminal session with any shell command
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Claude Code Settings - only show when Claude type selected */}
            {newChatType === "claude" && (
              <div className="flex items-center justify-between p-3 bg-zinc-900/50 rounded border border-zinc-800">
                <div>
                  <p className="text-[12px] text-zinc-200">Skip permission prompts</p>
                  <p className="text-[10px] text-zinc-500">Auto-run with --dangerously-skip-permissions</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSkipPermissions(!skipPermissions)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    skipPermissions ? "bg-emerald-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      skipPermissions ? "translate-x-[18px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Command input - only show for custom type */}
            {newChatType === "custom" && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Command
                </label>
                <Input
                  type="text"
                  value={newSessionConfig.command}
                  onChange={(e) =>
                    setNewSessionConfig((prev) => ({ ...prev, command: e.target.value }))
                  }
                  placeholder="zsh"
                  className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Working Directory
                </label>
                <button
                  type="button"
                  className="h-6 px-2 text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 disabled:opacity-40"
                  onClick={handleSaveCurrentDirectory}
                  disabled={!newSessionConfig.cwd || savedDirectories.includes(newSessionConfig.cwd)}
                >
                  <Star className="w-3 h-3" />
                  Save
                </button>
              </div>
              <Input
                type="text"
                value={newSessionConfig.cwd || ""}
                onChange={(e) =>
                  setNewSessionConfig((prev) => ({ ...prev, cwd: e.target.value }))
                }
                placeholder="/home/user"
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
              />
              {/* Saved directories */}
              {savedDirectories.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                    <Star className="w-3 h-3" /> Saved
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {savedDirectories.map((dir) => (
                      <div key={dir} className="group flex items-center">
                        <button
                          type="button"
                          className="h-6 px-2 text-[11px] font-mono border border-zinc-800 rounded hover:bg-zinc-800 text-zinc-400"
                          onClick={() => handleSelectDirectory(dir)}
                        >
                          {dir.split("/").pop() || dir}
                        </button>
                        <button
                          type="button"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-300"
                          onClick={() => handleRemoveSavedDirectory(dir)}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Recent directories */}
              {recentDirectories.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Recent
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {recentDirectories.slice(0, 5).map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        className="h-6 px-2 text-[11px] font-mono border border-zinc-800 rounded hover:bg-zinc-800 text-zinc-400"
                        onClick={() => handleSelectDirectory(dir)}
                      >
                        {dir.split("/").pop() || dir}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {folders.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Folder
                </label>
                <Select value={newSessionFolder} onValueChange={setNewSessionFolder}>
                  <SelectTrigger className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-300">
                    <SelectValue placeholder="(No folder)" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="__none__" className="text-[12px]">(No folder)</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder} value={folder} className="text-[12px]">
                        {folder}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewSession(false)} className="h-8 text-[12px] border-zinc-800 text-zinc-300 hover:bg-zinc-900">
              Cancel
            </Button>
            <Button onClick={handleCreate} className="h-8 text-[12px] bg-zinc-100 text-zinc-900 hover:bg-white">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent className="bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-medium text-zinc-100">New Folder</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Folder Name
              </label>
              <Input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") setShowNewFolder(false);
                }}
                placeholder="My Project"
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowNewFolder(false);
                setNewFolderName("");
              }}
              className="h-8 text-[12px] border-zinc-800 text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} className="h-8 text-[12px] bg-zinc-100 text-zinc-900 hover:bg-white">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-medium text-zinc-100">Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                API URL
              </label>
              <Input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                API Key (optional)
              </label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Leave empty for local dev"
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
              />
            </div>

            {/* Claude Code Settings */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <h4 className="text-[12px] font-medium text-zinc-300 mb-3">Claude Code</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-zinc-900/50 rounded border border-zinc-800">
                  <div>
                    <p className="text-[12px] text-zinc-200">Skip permission prompts</p>
                    <p className="text-[10px] text-zinc-500">Auto-run with --dangerously-skip-permissions flag</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSkipPermissions(!skipPermissions)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      skipPermissions ? "bg-emerald-600" : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        skipPermissions ? "translate-x-[18px]" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <h4 className="text-[12px] font-medium text-red-400 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                Danger Zone
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-red-950/30 rounded border border-red-900/50">
                  <div>
                    <p className="text-[12px] text-zinc-200">Kill All Sessions</p>
                    <p className="text-[10px] text-zinc-500">Terminate all running tmux sessions. Sessions will be archived.</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleKillAll}
                    disabled={isKillingAll || sessions.length === 0}
                    className="h-7 px-3 text-[11px] border-red-800 text-red-400 hover:bg-red-950 hover:text-red-300 disabled:opacity-40"
                  >
                    {isKillingAll ? (
                      <>
                        <div className="w-3 h-3 mr-1.5 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
                        Killing...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3 h-3 mr-1.5" />
                        Kill All ({sessions.length})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* AI Provider API Keys */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <h4 className="text-[12px] font-medium text-zinc-300 mb-3">AI Provider API Keys</h4>
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    OpenAI API Key
                  </label>
                  <Input
                    type="password"
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                  />
                  <p className="text-[10px] text-zinc-600">Used for Whisper transcription and other OpenAI features</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Google Gemini API Key
                  </label>
                  <Input
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIza..."
                    className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                  />
                  <p className="text-[10px] text-zinc-600">Used for Gemini-powered features</p>
                </div>
              </div>
            </div>

            {/* API Documentation */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <h4 className="text-[12px] font-medium text-zinc-300 mb-3">API Reference</h4>
              <div className="space-y-2 text-[11px] text-zinc-400 font-mono">
                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-300">GET</span>
                    <span>/api/sessions</span>
                  </div>
                  <p className="text-zinc-600">List all sessions</p>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-emerald-500">POST</span>
                    <span>/api/sessions</span>
                  </div>
                  <p className="text-zinc-600">Create a new session</p>
                  <pre className="text-[10px] overflow-x-auto text-zinc-500">{"{ command, cwd?, cols?, rows? }"}</pre>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-300">GET</span>
                    <span>/api/sessions/:id</span>
                  </div>
                  <p className="text-zinc-600">Get session details + output</p>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-emerald-500">POST</span>
                    <span>/api/sessions/:id/send</span>
                  </div>
                  <p className="text-zinc-600">Send input to session</p>
                  <pre className="text-[10px] overflow-x-auto text-zinc-500">{"{ input: string }"}</pre>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-300">GET</span>
                    <span>/api/sessions/:id/history</span>
                  </div>
                  <p className="text-zinc-600">Capture terminal history</p>
                  <pre className="text-[10px] overflow-x-auto text-zinc-500">{"?lines=5000&format=markdown"}</pre>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-300">GET</span>
                    <span>/api/sessions/:id/recap</span>
                  </div>
                  <p className="text-zinc-600">Generate context recap for Claude</p>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-emerald-500">POST</span>
                    <span>/api/hook</span>
                  </div>
                  <p className="text-zinc-600">Claude Code activity webhook</p>
                  <pre className="text-[10px] overflow-x-auto text-zinc-500">{"{ event, session_name?, cwd? }"}</pre>
                </div>

                <div className="bg-zinc-900 rounded p-2.5 space-y-1">
                  <div className="text-zinc-300 mb-1">WebSocket</div>
                  <span>/ws/:id</span>
                  <p className="text-zinc-600">Real-time terminal I/O</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSettings(false)} className="h-8 text-[12px] border-zinc-800 text-zinc-300 hover:bg-zinc-900">
              Cancel
            </Button>
            <Button onClick={saveSettings} className="h-8 text-[12px] bg-zinc-100 text-zinc-900 hover:bg-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Description Edit Dialog */}
      <Dialog open={editingDescription !== null} onOpenChange={(open) => !open && handleCancelDescription()}>
        <DialogContent className="bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-medium text-zinc-100">
              {editingDescription?.type === "session" ? "Session Description" : "Folder Description"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Description
              </label>
              <Input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Add a description..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveDescription();
                  if (e.key === "Escape") handleCancelDescription();
                }}
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                autoFocus
              />
              <p className="text-[11px] text-zinc-600">
                A short description to help identify this {editingDescription?.type === "session" ? "session" : "folder"}.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancelDescription} className="h-8 text-[12px] border-zinc-800 text-zinc-300 hover:bg-zinc-900">
              Cancel
            </Button>
            <Button onClick={handleSaveDescription} className="h-8 text-[12px] bg-zinc-100 text-zinc-900 hover:bg-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doc File Edit Dialog */}
      <Dialog open={editingDocFile !== null} onOpenChange={(open) => !open && handleCancelDocFile()}>
        <DialogContent className="bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-medium text-zinc-100">Documentation File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                File Path
              </label>
              <Input
                type="text"
                value={newDocFile}
                onChange={(e) => setNewDocFile(e.target.value)}
                placeholder="/path/to/CLAUDE.md or README.md"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveDocFile();
                  if (e.key === "Escape") handleCancelDocFile();
                }}
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                autoFocus
              />
              <p className="text-[11px] text-zinc-600">
                Path to a documentation file (e.g., CLAUDE.md, README.md) that provides context for Claude Code.
                This will be included when creating new terminals in this folder.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancelDocFile} className="h-8 text-[12px] border-zinc-800 text-zinc-300 hover:bg-zinc-900">
              Cancel
            </Button>
            <Button onClick={handleSaveDocFile} className="h-8 text-[12px] bg-zinc-100 text-zinc-900 hover:bg-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
