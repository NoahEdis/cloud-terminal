"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Terminal as TerminalIcon,
  MessageSquare,
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
} from "lucide-react";
import {
  listSessions,
  sendInput,
  listMessageSessions,
  uploadImage,
  type MessageSession,
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
import SessionList from "@/components/SessionList";

const Terminal = dynamic(() => import("@/components/Terminal"), { ssr: false });
const MessageView = dynamic(() => import("@/components/MessageView"), { ssr: false });

type ViewMode = "terminal" | "messages";

export default function Home() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionStatus, setSessionStatus] = useState<"running" | "exited">("running");
  const [messageSessions, setMessageSessions] = useState<MessageSession[]>([]);
  const [selectedMessageSession, setSelectedMessageSession] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [command, setCommand] = useState("");
  const [pendingImages, setPendingImages] = useState<Array<{ dataUrl: string; name: string }>>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    async function loadSessions() {
      try {
        const data = await listSessions();
        setSessions(data);
        if (data.length > 0 && !selectedSessionId) {
          setSelectedSessionId(getSessionId(data[0]));
        }
      } catch (e) {
        console.error("Failed to load sessions:", e);
      }
    }
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, [selectedSessionId]);

  useEffect(() => {
    async function loadMessageSessions() {
      try {
        const data = await listMessageSessions();
        setMessageSessions(data);
        if (data.length > 0 && !selectedMessageSession) {
          setSelectedMessageSession(data[0].session_id);
        }
      } catch (e) {
        console.error("Failed to load message sessions:", e);
      }
    }
    loadMessageSessions();
    const interval = setInterval(loadMessageSessions, 10000);
    return () => clearInterval(interval);
  }, [selectedMessageSession]);

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
      const parts = [...imagePaths, command.trim()].filter(Boolean);
      if (parts.length > 0) {
        await sendInput(selectedSessionId, parts.join(" ") + "\n");
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
            {viewMode === "terminal" ? "Terminal" : "Messages"}
          </span>

          {viewMode === "terminal" && sessions.length > 0 && (
            <>
              <span className="text-zinc-600">/</span>
              <Select value={selectedSessionId || ""} onValueChange={handleSelectSession}>
                <SelectTrigger className="h-7 w-44 text-[12px] bg-transparent border-zinc-800 text-zinc-400">
                  <SelectValue placeholder="Select session" />
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
            </>
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
            {messageSessions.length > 0 && (
              <span className="text-[10px] text-zinc-500">
                {messageSessions.reduce((sum, s) => sum + s.message_count, 0)}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div
          className={`flex-shrink-0 border-r border-zinc-800 bg-black overflow-hidden transition-all duration-200 ${
            sidebarOpen ? "w-72" : "w-0 border-r-0"
          }`}
        >
          <div className="w-72 h-full">
            <SessionList selectedId={selectedSessionId} onSelect={handleSelectSession} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            {viewMode === "terminal" && selectedSessionId ? (
              <Terminal
                sessionId={selectedSessionId}
                onExit={() => setSessionStatus("exited")}
                onError={(err) => setError(err)}
              />
            ) : selectedMessageSession ? (
              <MessageView sessionId={selectedMessageSession} />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  {viewMode === "terminal" ? (
                    <>
                      <TerminalIcon className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
                      <p className="text-[12px] text-zinc-500">No session selected</p>
                      <button
                        onClick={() => setSidebarOpen(true)}
                        className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                      >
                        Open sessions
                      </button>
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
                      <p className="text-[12px] text-zinc-500">No messages</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Input bar */}
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
                onClick={() => handleSendKey("\n")}
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

              {/* Microphone button */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={sessionStatus !== "running"}
                className={`p-2 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isRecording
                    ? "border-red-600 bg-red-950/50 hover:bg-red-900/50"
                    : "border-zinc-800 hover:bg-zinc-800"
                }`}
              >
                {isRecording ? (
                  <Square className="w-4 h-4 text-red-400" />
                ) : (
                  <Mic className="w-4 h-4 text-zinc-400" />
                )}
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
        </div>
      </div>
    </div>
  );
}
