"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Terminal as TerminalIcon,
  MessageSquare,
  Network,
  Layers,
  PanelLeftClose,
  PanelLeft,
  ArrowUp,
  ChevronUp,
  ChevronDown,
  CornerDownLeft,
  X,
  ImagePlus,
  Loader2,
  Mic,
  Square,
  WifiOff,
  Phone,
} from "lucide-react";
import {
  listSessions,
  sendInput,
  uploadImage,
  getSessionMessageCount,
  getSessionWindows,
  connectionManager,
  migrateLocalStorage,
  type ConnectionStatus,
  type WindowInfoResponse,
} from "@/lib/api";
import type { SessionInfo } from "@/lib/types";
import { getSessionId } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ChatList from "@/components/ChatList";

const Terminal = dynamic(() => import("@/components/Terminal"), { ssr: false });
const MessageView = dynamic(() => import("@/components/MessageView"), { ssr: false });
const GraphView = dynamic(() => import("@/components/GraphView"), { ssr: false });
const CanvasView = dynamic(() => import("@/components/CanvasView"), { ssr: false });
const VoiceChatDialog = dynamic(() => import("@/components/VoiceChatDialog"), { ssr: false });

type ViewMode = "terminal" | "messages" | "graph" | "canvas";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 288; // 18rem = 288px (w-72)

export default function Home() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionStatus, setSessionStatus] = useState<"running" | "exited">("running");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("messages");
  const [command, setCommand] = useState("");
  const [pendingImages, setPendingImages] = useState<Array<{ dataUrl: string; name: string }>>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState<number>(0);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);
  const [windowInfo, setWindowInfo] = useState<WindowInfoResponse | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Migrate localStorage keys and start connection health checking on mount
  useEffect(() => {
    // Migrate old "session" keys to new "chat" keys
    migrateLocalStorage();

    connectionManager.startHealthCheck(5000);
    const unsubscribe = connectionManager.subscribe(setConnectionStatus);
    return () => {
      connectionManager.stopHealthCheck();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function loadSessions() {
      try {
        const data = await listSessions();
        setSessions(data);

        // Auto-select first session if none selected
        if (data.length > 0 && !selectedSessionId) {
          setSelectedSessionId(getSessionId(data[0]));
        }

        // Clear selection if selected session no longer exists
        if (selectedSessionId && data.length > 0) {
          const sessionExists = data.some(s => getSessionId(s) === selectedSessionId);
          if (!sessionExists) {
            // Selected session was killed, select first available or clear
            setSelectedSessionId(getSessionId(data[0]));
          }
        }

        // Clear selection if all sessions are gone
        if (data.length === 0 && selectedSessionId) {
          setSelectedSessionId(null);
        }
      } catch (e) {
        console.error("Failed to load sessions:", e);
      }
    }
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, [selectedSessionId]);

  // Fetch message count for the selected session
  useEffect(() => {
    async function fetchMessageCount() {
      if (!selectedSessionId) {
        setMessageCount(0);
        return;
      }
      try {
        const count = await getSessionMessageCount(selectedSessionId);
        setMessageCount(count);
      } catch (e) {
        console.error("Failed to fetch message count:", e);
        setMessageCount(0);
      }
    }
    fetchMessageCount();
    // Refresh count periodically
    const interval = setInterval(fetchMessageCount, 10000);
    return () => clearInterval(interval);
  }, [selectedSessionId]);

  // Fetch tmux window info for the selected session
  useEffect(() => {
    async function fetchWindowInfo() {
      if (!selectedSessionId) {
        setWindowInfo(null);
        return;
      }
      try {
        const info = await getSessionWindows(selectedSessionId);
        setWindowInfo(info);
      } catch {
        setWindowInfo(null);
      }
    }
    fetchWindowInfo();
    // Refresh window info periodically (windows can change)
    const interval = setInterval(fetchWindowInfo, 10000);
    return () => clearInterval(interval);
  }, [selectedSessionId]);

  // Sidebar resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleSelectSession = (id: string) => {
    setSelectedSessionId(id || null);
    setSessionStatus("running");
  };

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!command.trim() && pendingImages.length === 0) || !selectedSessionId) return;

    setUploadingImage(true);
    try {
      // Upload any pending images first
      const imagePaths: string[] = [];
      for (const img of pendingImages) {
        const result = await uploadImage(selectedSessionId, img.dataUrl, img.name);
        imagePaths.push(result.filepath);
      }

      // Build the message with image paths and text
      // Use \r (carriage return) to trigger Enter in terminal, not \n (line feed)
      const parts = [...imagePaths, command.trim()].filter(Boolean);
      if (parts.length > 0) {
        await sendInput(selectedSessionId, parts.join(" ") + "\r");
      }

      setCommand("");
      setPendingImages([]);
      inputRef.current?.blur();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSendKey = async (key: string) => {
    if (!selectedSessionId) return;
    try {
      await sendInput(selectedSessionId, key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send input");
    }
  };

  const addPendingImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    setPendingImages(prev => [...prev, { dataUrl, name: file.name }]);
  }, []);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addPendingImage(file);
    e.target.value = "";
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) await addPendingImage(file);
          return;
        }
      }
    },
    [addPendingImage]
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(track => track.stop());

        // Send to Whisper API for transcription
        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");
          formData.append("model", "whisper-1");

          // Include API key from localStorage if available
          const openaiApiKey = localStorage.getItem("openaiApiKey");
          if (openaiApiKey) {
            formData.append("apiKey", openaiApiKey);
          }

          const response = await fetch("/api/transcribe", {
            method: "POST",
            body: formData,
          });

          if (response.ok) {
            const { text } = await response.json();
            setCommand(prev => prev + (prev ? " " : "") + text);
          } else {
            const errorData = await response.json();
            setError(errorData.error || "Failed to transcribe audio");
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError("Could not access microphone");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const currentSession = sessions.find(s => getSessionId(s) === selectedSessionId);

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4 text-zinc-400" />
            ) : (
              <PanelLeft className="w-4 h-4 text-zinc-400" />
            )}
          </button>

          <span className="text-[13px] font-medium text-zinc-100">
            {viewMode === "terminal" ? "Terminal" : viewMode === "messages" ? "Messages" : viewMode === "graph" ? "Knowledge Graph" : "Canvas"}
          </span>

          {viewMode === "terminal" && sessions.length > 0 && (
            <>
              <span className="text-zinc-600">/</span>
              <Select value={selectedSessionId || ""} onValueChange={handleSelectSession}>
                <SelectTrigger className="h-7 w-44 text-[12px] bg-transparent border-zinc-800 text-zinc-400">
                  <SelectValue placeholder="Select chat" />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((session) => (
                    <SelectItem key={getSessionId(session)} value={getSessionId(session)} className="text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${session.status === "running" ? "bg-emerald-500" : "bg-zinc-600"}`} />
                        <span className="truncate">{session.name || session.cwd.split("/").pop()}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Tmux window indicator - shows active window name for matching with local tmux */}
              {windowInfo?.activeWindowName && (
                <span
                  className="text-[11px] text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded font-mono truncate max-w-32"
                  title={`Tmux windows: ${windowInfo.windows.map(w => `${w.index}:${w.name}${w.active ? '*' : ''}`).join(' ')}`}
                >
                  * {windowInfo.activeWindowName}
                </span>
              )}
            </>
          )}

          {viewMode === "messages" && selectedSessionId && (
            <>
              <span className="text-zinc-600">/</span>
              <span className="text-[12px] text-zinc-400 font-mono">
                {sessions.find(s => getSessionId(s) === selectedSessionId)?.name || selectedSessionId.slice(0, 12)}
              </span>
              {/* Tmux window indicator for messages view */}
              {windowInfo?.activeWindowName && (
                <span
                  className="text-[11px] text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded font-mono truncate max-w-32"
                  title={`Tmux windows: ${windowInfo.windows.map(w => `${w.index}:${w.name}${w.active ? '*' : ''}`).join(' ')}`}
                >
                  * {windowInfo.activeWindowName}
                </span>
              )}
            </>
          )}

          {/* Connection status indicator */}
          {connectionStatus === "disconnected" && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-950/50 border border-red-900/50">
              <WifiOff className="w-3 h-3 text-red-400" />
              <span className="text-[11px] text-red-400">Server offline</span>
            </div>
          )}
          {connectionStatus === "connecting" && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-950/50 border border-amber-900/50">
              <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
              <span className="text-[11px] text-amber-400">Reconnecting...</span>
            </div>
          )}
        </div>

        {/* View switcher */}
        <div className="flex items-center h-7 rounded-md border border-zinc-800 overflow-hidden">
          <button
            onClick={() => setViewMode("terminal")}
            className={`flex items-center gap-1.5 px-2.5 h-full text-[12px] transition-colors ${
              viewMode === "terminal" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <TerminalIcon className="w-3 h-3" />
            <span className="hidden sm:inline">Terminal</span>
          </button>
          <button
            onClick={() => setViewMode("messages")}
            className={`flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors ${
              viewMode === "messages" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            <span className="hidden sm:inline">Messages</span>
            {messageCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 min-w-[18px] text-center text-[10px] font-medium bg-zinc-700 text-zinc-200 rounded-full">
                {messageCount > 99 ? "99+" : messageCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setViewMode("graph")}
            className={`flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors ${
              viewMode === "graph" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Network className="w-3 h-3" />
            <span className="hidden sm:inline">Graph</span>
          </button>
          <button
            onClick={() => setViewMode("canvas")}
            className={`flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors ${
              viewMode === "canvas" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Layers className="w-3 h-3" />
            <span className="hidden sm:inline">Canvas</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div
          ref={sidebarRef}
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className={`flex-shrink-0 border-r border-zinc-800 bg-black overflow-hidden ${
            isResizing ? "" : "transition-all duration-200"
          } ${!sidebarOpen ? "border-r-0" : ""}`}
        >
          <div style={{ width: sidebarWidth }} className="h-full">
            <ChatList selectedId={selectedSessionId} onSelect={handleSelectSession} />
          </div>
        </div>

        {/* Resize handle */}
        {sidebarOpen && (
          <div
            onMouseDown={handleMouseDown}
            className={`w-1 hover:w-1.5 bg-transparent hover:bg-zinc-700 cursor-col-resize flex-shrink-0 transition-all ${
              isResizing ? "w-1.5 bg-zinc-600" : ""
            }`}
          />
        )}

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            {viewMode === "terminal" ? (
              selectedSessionId ? (
                <Terminal
                  sessionId={selectedSessionId}
                  onExit={() => setSessionStatus("exited")}
                  onError={(err) => setError(err)}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <TerminalIcon className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
                    <p className="text-[12px] text-zinc-500">No chat selected</p>
                    <button
                      onClick={() => setSidebarOpen(true)}
                      className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                    >
                      Open chats
                    </button>
                  </div>
                </div>
              )
            ) : viewMode === "messages" ? (
              selectedSessionId ? (
                <MessageView key={selectedSessionId} sessionId={selectedSessionId} />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
                    <p className="text-[12px] text-zinc-500">No chat selected</p>
                    <button
                      onClick={() => setSidebarOpen(true)}
                      className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                    >
                      Open chats
                    </button>
                  </div>
                </div>
              )
            ) : viewMode === "graph" ? (
              <GraphView sessionId={selectedSessionId || undefined} />
            ) : (
              <CanvasView sessionId={selectedSessionId || undefined} />
            )}
          </div>

          {/* Input bar - hidden in graph and canvas modes */}
          {viewMode !== "graph" && viewMode !== "canvas" && (
          <div className="border-t border-zinc-800 p-2.5 bg-zinc-950">
            {error && (
              <div className="mb-2 px-2.5 py-1.5 text-[12px] text-red-400 bg-red-950/50 rounded flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="p-0.5 hover:bg-red-900/50 rounded">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Terminal control keys */}
            <div className="flex items-center justify-center gap-1 mb-2">
              <button
                onClick={() => handleSendKey("\x1b[A")}
                disabled={sessionStatus !== "running"}
                className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
              </button>
              <button
                onClick={() => handleSendKey("\x1b[B")}
                disabled={sessionStatus !== "running"}
                className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>
              <div className="w-px h-4 bg-zinc-800 mx-1" />
              <button
                onClick={() => handleSendKey("\r")}
                disabled={sessionStatus !== "running"}
                className="p-1.5 rounded bg-zinc-100 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CornerDownLeft className="w-3.5 h-3.5 text-zinc-900" />
              </button>
              <button
                onClick={() => handleSendKey("\x1b")}
                disabled={sessionStatus !== "running"}
                className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <X className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>

            {/* Pending images preview */}
            {pendingImages.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {pendingImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-16 w-16 object-cover rounded border border-zinc-700"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingImage(index)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-full flex items-center justify-center transition-colors"
                    >
                      <X className="w-3 h-3 text-zinc-300" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSendCommand} className="flex gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {/* Image upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sessionStatus !== "running" || uploadingImage}
                className="p-2 rounded border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {uploadingImage ? (
                  <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-zinc-400" />
                )}
              </button>

              {/* Microphone button (dictation) */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={sessionStatus !== "running"}
                className={`p-2 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isRecording
                    ? "border-red-600 bg-red-950/50 hover:bg-red-900/50"
                    : "border-zinc-800 hover:bg-zinc-800"
                }`}
                title="Voice dictation"
              >
                {isRecording ? (
                  <Square className="w-4 h-4 text-red-400" />
                ) : (
                  <Mic className="w-4 h-4 text-zinc-400" />
                )}
              </button>

              {/* Voice chat button */}
              <button
                type="button"
                onClick={() => setVoiceChatOpen(true)}
                className="p-2 rounded border border-zinc-800 hover:bg-zinc-800 transition-colors"
                title="Live voice chat"
              >
                <Phone className="w-4 h-4 text-zinc-400" />
              </button>

              {/* Message input */}
              <div className="flex-1">
                <Input
                  ref={inputRef}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Message..."
                  disabled={sessionStatus !== "running"}
                  className="h-9 text-[13px] bg-zinc-900 border-zinc-800 placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-zinc-700"
                />
              </div>

              {/* Send button */}
              <button
                type="submit"
                disabled={sessionStatus !== "running" || (!command.trim() && pendingImages.length === 0)}
                className="h-9 w-9 rounded-full bg-zinc-100 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                <ArrowUp className="w-4 h-4 text-zinc-900" />
              </button>
            </form>
          </div>
          )}
        </div>
      </div>

      {/* Voice Chat Dialog */}
      <VoiceChatDialog
        open={voiceChatOpen}
        onOpenChange={setVoiceChatOpen}
        onTranscript={(text, isUser) => {
          // Optionally send transcripts to the terminal/chat
          if (!isUser && selectedSessionId) {
            // Could send AI response to terminal if needed
            console.log("AI transcript:", text);
          }
        }}
      />

      {/* Version indicator */}
      <div className="fixed bottom-2 left-2 px-2 py-1 rounded bg-zinc-900/80 border border-zinc-800/50 text-[10px] text-zinc-600 font-mono z-50">
        v0.2.8
      </div>
    </div>
  );
}
