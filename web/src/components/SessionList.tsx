"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  Zap,
  Star,
  Clock,
  FileCode,
} from "lucide-react";
import {
  listSessions,
  createSession,
  killSession,
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
} from "@/lib/api";
import type { SessionInfo, SessionConfig, ActivityState } from "@/lib/types";
import { getSessionId } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";

interface SessionListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function ActivityIndicator({ state }: { state?: ActivityState }) {
  const stateColors = {
    idle: "bg-primary shadow-[0_0_8px_var(--primary)]",
    busy: "bg-amber-500 shadow-[0_0_8px_theme(colors.amber.500)] animate-pulse",
    exited: "bg-muted-foreground/50",
  };

  const stateLabels = {
    idle: "Waiting for input",
    busy: "Running",
    exited: "Exited",
  };

  const currentState = state || "exited";

  return (
    <div
      className={`w-2 h-2 rounded-full transition-all ${stateColors[currentState]}`}
      title={stateLabels[currentState]}
    />
  );
}

export default function SessionList({ selectedId, onSelect }: SessionListProps) {
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
  const [showSettings, setShowSettings] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
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

  // Load saved and recent directories, descriptions, and doc files
  useEffect(() => {
    setSavedDirectoriesState(getSavedDirectories());
    setRecentDirectoriesState(getRecentDirectories());
    setSessionDescriptionsState(getSessionDescriptions());
    setFolderDescriptionsState(getFolderDescriptions());
    setFolderDocFilesState(getFolderDocFiles());
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
    const storedUrl = localStorage.getItem("terminalApiUrl");
    const storedKey = localStorage.getItem("terminalApiKey");
    setApiUrl(storedUrl || getDefaultApiUrl());
    setApiKey(storedKey ?? getDefaultApiKey());
    setLocalStorageLoaded(true);
    fetchSessions();

    const interval = setInterval(fetchSessions, 2000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const groupedSessions = useMemo(() => {
    const groups: Record<string, SessionInfo[]> = { "": [] };

    for (const folder of folders) {
      groups[folder] = [];
    }

    for (const session of sessions) {
      const sessionId = getSessionId(session);
      const folder = sessionFolders[sessionId] || "";
      if (!groups[folder]) {
        groups[folder] = [];
      }
      groups[folder].push(session);
    }

    return groups;
  }, [sessions, sessionFolders, folders]);

  const handleCreate = async () => {
    try {
      const session = await createSession(newSessionConfig);
      const sessionId = getSessionId(session);
      setSessions((prev) => [...prev, session]);
      if (newSessionFolder) {
        setSessionFolder(sessionId, newSessionFolder);
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
    if (!confirm("Kill this session?")) return;

    try {
      await killSession(id);
      setSessions((prev) => prev.filter((s) => getSessionId(s) !== id));
      if (selectedId === id) {
        onSelect("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to kill session");
    }
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

  const saveSettings = () => {
    localStorage.setItem("terminalApiUrl", apiUrl);
    localStorage.setItem("terminalApiKey", apiKey);
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

  // Sync localStorage data periodically to ensure consistency across devices/tabs
  useEffect(() => {
    const syncLocalStorage = () => {
      setSessionNamesState(getSessionNames());
      setSessionFoldersState(getSessionFolders());
      setFoldersState(getFoldersList());
      setSessionDescriptionsState(getSessionDescriptions());
      setFolderDescriptionsState(getFolderDescriptions());
      setFolderDocFilesState(getFolderDocFiles());
    };
    const interval = setInterval(syncLocalStorage, 500);
    return () => clearInterval(interval);
  }, []);

  const renderSession = (session: SessionInfo) => {
    const sessionId = getSessionId(session);
    return (
      <Card
        key={sessionId}
        onClick={() => onSelect(sessionId)}
        className={`p-3 cursor-pointer transition-all hover:bg-accent/50 border-border/50 ${
          selectedId === sessionId
            ? "border-primary/50 bg-accent/30 shadow-[0_0_15px_rgba(57,255,20,0.1)]"
            : "hover:border-border"
        }`}
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
                className="flex-1 h-8 text-sm"
                autoFocus
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => saveRename(sessionId)}
              >
                <Check className="w-4 h-4 text-primary" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={cancelRename}
              >
                <X className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <ActivityIndicator state={session.activityState} />
                <span className="truncate text-sm font-medium">
                  {getDisplayName(session)}
                </span>
                {session.source === "local" && session.attached && (
                  <Badge variant="outline" className="text-xs px-1.5 py-0">attached</Badge>
                )}
              </div>
              <div
                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => handleRename(sessionId, sessionNames[sessionId] || "")}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleEditDescription("session", sessionId)}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      {sessionDescriptions[sessionId] ? "Edit Description" : "Add Description"}
                    </DropdownMenuItem>
                    {folders.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => handleMoveToFolder(sessionId, "")}
                          className={!sessionFolders[sessionId] ? "text-primary" : ""}
                        >
                          (No folder)
                        </DropdownMenuItem>
                        {folders.map((folder) => (
                          <DropdownMenuItem
                            key={folder}
                            onClick={() => handleMoveToFolder(sessionId, folder)}
                            className={sessionFolders[sessionId] === folder ? "text-primary" : ""}
                          >
                            {folder}
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleKill(sessionId)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Kill Session
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </div>
        {sessionDescriptions[sessionId] && (
          <div className="mt-1 text-xs text-muted-foreground/70 italic truncate">
            {sessionDescriptions[sessionId]}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate flex-1">{session.cwd}</span>
          <span className="ml-2 flex-shrink-0">{formatTime(session.lastActivity)}</span>
        </div>
      </Card>
    );
  };

  const renderFolderSection = (folderName: string, folderSessions: SessionInfo[]) => {
    const isCollapsed = collapsedFolders.has(folderName);
    const hasIdleSessions = folderSessions.some((s) => s.activityState === "idle");

    return (
      <div key={folderName || "__ungrouped"} className="mb-3">
        {folderName && (
          <div
            className="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/30 group"
            onClick={() => toggleFolder(folderName)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
                {isCollapsed ? (
                  <Folder className="w-4 h-4 text-primary/70" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-primary" />
                )}
                <span className="text-sm font-medium">{folderName}</span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {folderSessions.length}
                </Badge>
                {folderDocFiles[folderName] && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center">
                        <FileCode className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{folderDocFiles[folderName]}</TooltipContent>
                  </Tooltip>
                )}
                {hasIdleSessions && isCollapsed && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
                )}
              </div>
              {folderDescriptions[folderName] && (
                <div className="ml-10 text-xs text-muted-foreground/70 italic truncate">
                  {folderDescriptions[folderName]}
                </div>
              )}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleCreateInFolder(folderName)}>
                    <Plus className="w-3.5 h-3.5 mr-2" />
                    New Terminal
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleEditDescription("folder", folderName)}>
                    <Pencil className="w-3.5 h-3.5 mr-2" />
                    {folderDescriptions[folderName] ? "Edit Description" : "Add Description"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditDocFile(folderName)}>
                    <FileCode className="w-3.5 h-3.5 mr-2" />
                    {folderDocFiles[folderName] ? "Edit Doc File" : "Set Doc File"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleDeleteFolder(folderName)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Delete folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        {(!folderName || !isCollapsed) && (
          <div className={`space-y-2 ${folderName ? "ml-6 mt-2" : ""}`}>
            {folderSessions.length === 0 ? (
              !folderName && sessions.length > 0 ? null : (
                <p className="px-3 py-4 text-xs italic text-muted-foreground">
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
    <div className="h-full w-full flex flex-col bg-background md:bg-card/30 backdrop-blur-sm border-r border-border/50">
      {/* Header */}
      <div className="p-5 border-b border-border/50">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shadow-[0_0_15px_rgba(57,255,20,0.2)]">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div className="text-lg font-semibold tracking-tight">
            Cloud<span className="text-primary">Terminal</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button onClick={() => setShowNewSession(true)} className="flex-1">
            <Plus className="w-4 h-4 mr-2" />
            New Session
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" onClick={() => setShowNewFolder(true)}>
                <FolderPlus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Folder</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" onClick={fetchSessions}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" onClick={() => setShowSettings(true)}>
                <Settings className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 text-sm bg-destructive/10 text-destructive border-b border-destructive/20">
          {error}
        </div>
      )}

      {/* Session List */}
      <ScrollArea className="flex-1 p-4">
        {loading || !localStorageLoaded ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : sessions.length === 0 && folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Terminal className="w-8 h-8 mb-3 text-muted-foreground" />
            <p className="text-sm text-foreground/80">No sessions yet</p>
            <p className="text-xs mt-1 text-muted-foreground">
              Create a new session to get started
            </p>
          </div>
        ) : (
          <>
            {folders.map((folder) => renderFolderSection(folder, groupedSessions[folder] || []))}
            {renderFolderSection("", groupedSessions[""] || [])}
          </>
        )}
      </ScrollArea>

      {/* New Session Dialog */}
      <Dialog open={showNewSession} onOpenChange={setShowNewSession}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Command
              </label>
              <Input
                type="text"
                value={newSessionConfig.command}
                onChange={(e) =>
                  setNewSessionConfig((prev) => ({ ...prev, command: e.target.value }))
                }
                placeholder="zsh"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Working Directory
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleSaveCurrentDirectory}
                  disabled={!newSessionConfig.cwd || savedDirectories.includes(newSessionConfig.cwd)}
                >
                  <Star className="w-3 h-3 mr-1" />
                  Save
                </Button>
              </div>
              <Input
                type="text"
                value={newSessionConfig.cwd || ""}
                onChange={(e) =>
                  setNewSessionConfig((prev) => ({ ...prev, cwd: e.target.value }))
                }
                placeholder="/home/user"
              />
              {/* Saved directories */}
              {savedDirectories.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Star className="w-3 h-3" /> Saved
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {savedDirectories.map((dir) => (
                      <div key={dir} className="group flex items-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs font-mono"
                          onClick={() => handleSelectDirectory(dir)}
                        >
                          {dir.split("/").pop() || dir}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleRemoveSavedDirectory(dir)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Recent directories */}
              {recentDirectories.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Recent
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {recentDirectories.slice(0, 5).map((dir) => (
                      <Button
                        key={dir}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs font-mono"
                        onClick={() => handleSelectDirectory(dir)}
                      >
                        {dir.split("/").pop() || dir}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {folders.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Folder
                </label>
                <select
                  value={newSessionFolder}
                  onChange={(e) => setNewSessionFolder(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">(No folder)</option>
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewSession(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>
              <Zap className="w-4 h-4 mr-2" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNewFolder(false);
                setNewFolderName("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateFolder}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                API URL
              </label>
              <Input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                API Key (optional)
              </label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Leave empty for local dev"
              />
            </div>

            {/* API Documentation */}
            <div className="border-t border-border pt-4 mt-4">
              <h4 className="text-sm font-medium mb-3">API Reference</h4>
              <div className="space-y-3 text-xs text-muted-foreground font-mono">
                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-primary">GET</span>
                    <span>/api/sessions</span>
                  </div>
                  <p className="text-muted-foreground/70">List all sessions</p>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-green-400">POST</span>
                    <span>/api/sessions</span>
                  </div>
                  <p className="text-muted-foreground/70">Create a new session</p>
                  <pre className="text-xs overflow-x-auto">{"{ command, cwd?, cols?, rows? }"}</pre>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-primary">GET</span>
                    <span>/api/sessions/:id</span>
                  </div>
                  <p className="text-muted-foreground/70">Get session details + output</p>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-green-400">POST</span>
                    <span>/api/sessions/:id/send</span>
                  </div>
                  <p className="text-muted-foreground/70">Send input to session</p>
                  <pre className="text-xs overflow-x-auto">{"{ input: string }"}</pre>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-primary">GET</span>
                    <span>/api/sessions/:id/history</span>
                  </div>
                  <p className="text-muted-foreground/70">Capture terminal history</p>
                  <pre className="text-xs overflow-x-auto">{"?lines=5000&format=markdown"}</pre>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-primary">GET</span>
                    <span>/api/sessions/:id/recap</span>
                  </div>
                  <p className="text-muted-foreground/70">Generate context recap for Claude</p>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-green-400">POST</span>
                    <span>/api/hook</span>
                  </div>
                  <p className="text-muted-foreground/70">Claude Code activity webhook</p>
                  <pre className="text-xs overflow-x-auto">{"{ event, session_name?, cwd? }"}</pre>
                </div>

                <div className="bg-muted/30 rounded-md p-3 space-y-2">
                  <div className="text-primary mb-1">WebSocket</div>
                  <span>/ws/:id</span>
                  <p className="text-muted-foreground/70">Real-time terminal I/O</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>
              Cancel
            </Button>
            <Button onClick={saveSettings}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Description Edit Dialog */}
      <Dialog open={editingDescription !== null} onOpenChange={(open) => !open && handleCancelDescription()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingDescription?.type === "session" ? "Session Description" : "Folder Description"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                A short description to help identify this {editingDescription?.type === "session" ? "session" : "folder"}.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDescription}>
              Cancel
            </Button>
            <Button onClick={handleSaveDescription}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doc File Edit Dialog */}
      <Dialog open={editingDocFile !== null} onOpenChange={(open) => !open && handleCancelDocFile()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Documentation File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Path to a documentation file (e.g., CLAUDE.md, README.md) that provides context for Claude Code.
                This will be included when creating new terminals in this folder.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDocFile}>
              Cancel
            </Button>
            <Button onClick={handleSaveDocFile}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
