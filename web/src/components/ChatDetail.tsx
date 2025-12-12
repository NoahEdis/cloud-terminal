"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { Send, Pencil, Check, X, Copy, Terminal as TerminalIcon, CheckCircle, ChevronLeft, ChevronUp, ChevronDown, CornerDownLeft, XCircle, History, FileText, Loader2, ImagePlus } from "lucide-react";
import { getSession, sendInput, getSessionNames, setSessionName, captureHistory, generateRecap, uploadImage } from "@/lib/api";
import type { SessionInfo } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

// Dynamically import Terminal to avoid SSR issues
const Terminal = dynamic(() => import("./Terminal"), { ssr: false });

interface ChatDetailProps {
  chatId: string;
  onBack?: () => void;
}

export default function ChatDetail({ chatId, onBack }: ChatDetailProps) {
  // Alias for backward compatibility with existing code
  const sessionId = chatId;
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [sessionNames, setSessionNamesState] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [capturingHistory, setCapturingHistory] = useState(false);
  const [historyCopied, setHistoryCopied] = useState<"history" | "recap" | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploaded, setImageUploaded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea up to max height (15 lines)
  const adjustTextareaHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = "auto";

    // Calculate max height (approximately 15 lines * line-height)
    // Using 1.5rem line-height, 15 lines = 22.5rem, plus padding
    const lineHeight = 24; // ~1.5rem at 16px base
    const maxLines = 15;
    const padding = 20; // top + bottom padding
    const maxHeight = (lineHeight * maxLines) + padding;

    // Set the height to scrollHeight but cap at maxHeight
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Enable/disable overflow based on whether content exceeds max
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  // Capture and copy terminal history to clipboard
  const handleCaptureHistory = async (format: "plain" | "markdown") => {
    setCapturingHistory(true);
    try {
      const result = await captureHistory(sessionId, { format, lines: 5000 });
      await navigator.clipboard.writeText(result.content);
      setHistoryCopied("history");
      setTimeout(() => setHistoryCopied(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to capture history");
    } finally {
      setCapturingHistory(false);
    }
  };

  // Generate and copy a recap for Claude Code context
  const handleGenerateRecap = async () => {
    setCapturingHistory(true);
    try {
      const result = await generateRecap(sessionId);
      await navigator.clipboard.writeText(result.recap);
      setHistoryCopied("recap");
      setTimeout(() => setHistoryCopied(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate recap");
    } finally {
      setCapturingHistory(false);
    }
  };

  // Handle image upload (from file picker or paste)
  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Only image files are supported");
      return;
    }

    setUploadingImage(true);
    try {
      // Convert file to base64 data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Upload to server
      const result = await uploadImage(sessionId, dataUrl, file.name);

      // Insert filepath into command input or send directly
      if (command.trim()) {
        // Append to existing command
        setCommand((prev) => prev + " " + result.filepath);
      } else {
        // Send the filepath directly as input (for Claude Code)
        await sendInput(sessionId, result.filepath + "\n");
      }

      setImageUploaded(true);
      setTimeout(() => setImageUploaded(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  // Handle paste event for images
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await handleImageUpload(file);
          }
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, command]
  );

  const fetchSession = useCallback(async () => {
    try {
      setError(null);
      const data = await getSession(sessionId);
      setSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch session");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setSessionNamesState(getSessionNames());
    fetchSession();
  }, [fetchSession]);

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    try {
      // Send text and newline together in a single input
      // This ensures the full command + submission arrives atomically,
      // which is important for readline-based prompts like Claude Code
      // Using \n (newline) which works better than \r for most CLI tools
      await sendInput(sessionId, command + "\n");
      setCommand("");
      // Reset textarea height after clearing
      if (inputRef.current) {
        inputRef.current.style.height = "44px";
        inputRef.current.style.overflowY = "hidden";
      }
      // Blur input on mobile to dismiss keyboard
      inputRef.current?.blur();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send command");
    }
  };

  const handleRename = () => {
    setNewName(sessionNames[sessionId] || session?.command || "");
    setEditingName(true);
  };

  const saveRename = () => {
    if (newName.trim()) {
      setSessionName(sessionId, newName.trim());
      setSessionNamesState(getSessionNames());
    }
    setEditingName(false);
  };

  const cancelRename = () => {
    setEditingName(false);
    setNewName("");
  };

  const copySessionId = () => {
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getDisplayName = () => {
    // Check for custom display name first
    if (sessionNames[sessionId]) {
      return sessionNames[sessionId];
    }
    // For tmux sessions, the sessionId IS the name (e.g., "new-mcp-structure-3")
    // For PTY sessions, it's a UUID that we should truncate
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
    if (isUUID) {
      return `${session?.command || "Session"} (${sessionId.slice(0, 8)})`;
    }
    // Tmux session name - use as-is
    return sessionId;
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "running":
        return "default";
      case "exited":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col bg-background">
        {/* Mobile back button in error state */}
        {onBack && (
          <div className="md:hidden flex-shrink-0 px-3 py-2 border-b border-border/50 bg-card/50">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ChevronLeft className="w-4 h-4" />
              Sessions
            </Button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full flex flex-col bg-background">
        {/* Mobile back button in not found state */}
        {onBack && (
          <div className="md:hidden flex-shrink-0 px-3 py-2 border-b border-border/50 bg-card/50">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ChevronLeft className="w-4 h-4" />
              Sessions
            </Button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Session not found
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Terminal Header */}
      <div className="flex-shrink-0 px-3 md:px-5 py-3 border-b border-border/50 bg-card/50 backdrop-blur-sm">
        {/* Mobile: Back button row */}
        {onBack && (
          <div className="md:hidden flex items-center justify-between mb-3">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2">
              <ChevronLeft className="w-4 h-4" />
              Sessions
            </Button>
            <Badge variant={getStatusVariant(session.status)} className="capitalize">
              {session.status}
            </Badge>
          </div>
        )}

        {/* Main header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") cancelRename();
                  }}
                  className="h-8 flex-1 md:w-48 md:flex-none text-sm"
                  autoFocus
                />
                <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={saveRename}>
                  <Check className="w-4 h-4 text-primary" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={cancelRename}>
                  <X className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <TerminalIcon className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="font-medium truncate">{getDisplayName()}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={handleRename}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>

          {/* Desktop-only: right side info */}
          <div className="hidden md:flex items-center gap-4">
            <Badge variant={getStatusVariant(session.status)} className="capitalize">
              {session.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {session.cwd}
            </span>
            {/* History capture dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-2 px-2"
                      disabled={capturingHistory}
                    >
                      {capturingHistory ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : historyCopied ? (
                        <CheckCircle className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <History className="w-3.5 h-3.5" />
                      )}
                      <span className="text-xs">
                        {historyCopied === "history" ? "Copied!" : historyCopied === "recap" ? "Recap copied!" : "History"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Capture terminal history for context</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Capture History</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleCaptureHistory("plain")}>
                  <FileText className="w-4 h-4 mr-2" />
                  Copy as Plain Text
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCaptureHistory("markdown")}>
                  <FileText className="w-4 h-4 mr-2" />
                  Copy as Markdown
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleGenerateRecap}>
                  <History className="w-4 h-4 mr-2" />
                  Copy Context Recap
                  <span className="ml-auto text-xs text-muted-foreground">for Claude</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-2 px-2"
                  onClick={copySessionId}
                >
                  {copied ? (
                    <CheckCircle className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span className="text-xs font-mono">{sessionId.length > 12 ? sessionId.slice(0, 12) + "…" : sessionId}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? "Copied!" : "Copy session ID"}</TooltipContent>
            </Tooltip>
          </div>

          {/* Mobile-only: action buttons */}
          <div className="md:hidden flex-shrink-0 flex items-center gap-1">
            {/* History capture for mobile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={capturingHistory}
                >
                  {capturingHistory ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : historyCopied ? (
                    <CheckCircle className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <History className="w-3.5 h-3.5" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Capture History</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleCaptureHistory("plain")}>
                  <FileText className="w-4 h-4 mr-2" />
                  Copy as Plain Text
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCaptureHistory("markdown")}>
                  <FileText className="w-4 h-4 mr-2" />
                  Copy as Markdown
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleGenerateRecap}>
                  <History className="w-4 h-4 mr-2" />
                  Copy Context Recap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={copySessionId}
            >
              {copied ? (
                <CheckCircle className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile-only: cwd display */}
        <div className="md:hidden mt-2 text-xs text-muted-foreground truncate">
          {session.cwd}
        </div>
      </div>

      {/* Terminal */}
      <div
        className="flex-1 min-h-0 relative"
        onClick={() => inputRef.current?.blur()}
      >
        <Terminal
          sessionId={sessionId}
          onExit={(code) => {
            setSession((prev) => prev ? { ...prev, status: "exited", exitCode: code } : null);
          }}
          onError={(err) => setError(err)}
        />
        {/* Scanline overlay for CRT effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.3)_2px,rgba(0,0,0,0.3)_4px)]" />
      </div>

      {/* Command Input */}
      <form onSubmit={handleSendCommand} className="flex-shrink-0 p-3 md:p-4 border-t border-border/50 bg-card/30">
        {/* Mobile Navigation Controls - for Claude Code multi-select menus */}
        <div className="md:hidden flex items-center justify-center gap-2 mb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={session.status !== "running"}
                onClick={async () => {
                  try {
                    await sendInput(sessionId, "\x1b[A"); // Up arrow escape sequence
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to send input");
                  }
                }}
              >
                <ChevronUp className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Arrow Up</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={session.status !== "running"}
                onClick={async () => {
                  try {
                    await sendInput(sessionId, "\x1b[B"); // Down arrow escape sequence
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to send input");
                  }
                }}
              >
                <ChevronDown className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Arrow Down</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="default"
                size="icon"
                className="h-10 w-10"
                disabled={session.status !== "running"}
                onClick={async () => {
                  try {
                    await sendInput(sessionId, "\n"); // Enter/Return (newline works better for CLI tools)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to send input");
                  }
                }}
              >
                <CornerDownLeft className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Enter</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={session.status !== "running"}
                onClick={async () => {
                  try {
                    await sendInput(sessionId, "\x1b"); // Escape key
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to send input");
                  }
                }}
              >
                <XCircle className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Escape</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex gap-2 md:gap-3">
          {/* Hidden file input for image upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInputChange}
          />

          {/* Image upload button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 flex-shrink-0"
                disabled={session.status !== "running" || uploadingImage}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingImage ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : imageUploaded ? (
                  <CheckCircle className="w-4 h-4 text-primary" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {uploadingImage ? "Uploading..." : imageUploaded ? "Image uploaded!" : "Upload image (or paste)"}
            </TooltipContent>
          </Tooltip>

          <div className="flex-1 relative">
            <span className="absolute left-3 md:left-4 top-3 text-sm text-primary font-mono">
              &gt;
            </span>
            <textarea
              ref={inputRef}
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                adjustTextareaHeight();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendCommand(e);
                }
                // Shift+Enter allows new line (default behavior)
              }}
              onPaste={handlePaste}
              placeholder="Type a command or paste an image..."
              className="w-full pl-7 md:pl-8 pr-3 py-2.5 font-mono bg-background/50 text-base md:text-sm border border-input rounded-md resize-none leading-6 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={session.status !== "running"}
              rows={1}
              style={{ minHeight: "44px", maxHeight: "380px", overflowY: "hidden" }}
            />
          </div>
          <Button
            type="submit"
            disabled={session.status !== "running" || !command.trim()}
            className="gap-2 px-3 md:px-4"
            size="default"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
