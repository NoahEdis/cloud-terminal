"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Conversation } from "@elevenlabs/client";
import {
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Settings2,
  Loader2,
} from "lucide-react";

export interface VoiceChatProps {
  agentId?: string;
  voiceId?: string;
  onTranscript?: (text: string, isUser: boolean) => void;
  onConnectionChange?: (connected: boolean) => void;
  onModeChange?: (mode: "idle" | "listening" | "speaking") => void;
  className?: string;
  onOpenSettings?: () => void;
}

interface TranscriptMessage {
  id: string;
  text: string;
  isUser: boolean;
  isTentative: boolean;
  timestamp: Date;
}

export default function VoiceChat({
  agentId,
  voiceId,
  onTranscript,
  onConnectionChange,
  onModeChange,
  className = "",
  onOpenSettings,
}: VoiceChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [mode, setMode] = useState<"idle" | "listening" | "speaking">("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);

  const conversationRef = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const transcriptsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  // Notify parent of mode changes
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  const addTranscript = useCallback(
    (text: string, isUser: boolean, isTentative: boolean) => {
      const id = `${isUser ? "user" : "agent"}-${Date.now()}`;

      setTranscripts((prev) => {
        // If tentative, update existing tentative message
        if (isTentative) {
          const existingIndex = prev.findIndex(
            (t) => t.isUser === isUser && t.isTentative
          );
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              text,
            };
            return updated;
          }
        }

        // If final, remove tentative and add final
        if (!isTentative) {
          const withoutTentative = prev.filter(
            (t) => !(t.isUser === isUser && t.isTentative)
          );
          return [
            ...withoutTentative,
            { id, text, isUser, isTentative, timestamp: new Date() },
          ];
        }

        return [
          ...prev,
          { id, text, isUser, isTentative, timestamp: new Date() },
        ];
      });

      if (!isTentative) {
        onTranscript?.(text, isUser);
      }
    },
    [onTranscript]
  );

  const connect = useCallback(async () => {
    if (!agentId) {
      setError("No agent selected. Please configure a voice agent in settings.");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Get signed URL for private agents
      let signedUrl: string | null = null;
      try {
        const response = await fetch("/api/elevenlabs/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });
        const data = await response.json();
        if (data.signed_url) {
          signedUrl = data.signed_url;
        }
      } catch (e) {
        console.log("Could not get signed URL, trying direct connection");
      }

      // Start conversation session - build config based on signed URL availability
      const sessionConfig = signedUrl
        ? { signedUrl, connectionType: "websocket" as const }
        : { agentId: agentId!, connectionType: "websocket" as const };

      const conversation = await Conversation.startSession({
        ...sessionConfig,
        onConnect: () => {
          console.log("Connected to voice agent");
          setIsConnected(true);
          setIsConnecting(false);
          setMode("listening");
        },
        onDisconnect: () => {
          console.log("Disconnected from voice agent");
          setIsConnected(false);
          setMode("idle");
        },
        onError: (err: string) => {
          console.error("Voice conversation error:", err);
          setError(err || "Connection error");
          setIsConnecting(false);
        },
        onMessage: (message) => {
          // Handle transcript messages
          const msgAny = message as { source?: string; message?: string; isTentative?: boolean };
          if (msgAny.source === "user" && msgAny.message) {
            addTranscript(msgAny.message, true, !!msgAny.isTentative);
          } else if (msgAny.source === "ai" && msgAny.message) {
            addTranscript(msgAny.message, false, !!msgAny.isTentative);
          }
        },
        onModeChange: (modeChange) => {
          const newMode =
            modeChange.mode === "speaking"
              ? "speaking"
              : modeChange.mode === "listening"
              ? "listening"
              : "idle";
          setMode(newMode);
        },
      });

      conversationRef.current = conversation;
    } catch (err) {
      console.error("Connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  }, [agentId, addTranscript]);

  const disconnect = useCallback(async () => {
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch (e) {
        console.error("Error ending session:", e);
      }
      conversationRef.current = null;
    }
    setIsConnected(false);
    setMode("idle");
  }, []);

  const toggleMute = useCallback(() => {
    // Note: The ElevenLabs client may not support muting directly
    // This is a placeholder for UI state
    setIsMuted((prev) => !prev);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.endSession().catch(console.error);
      }
    };
  }, []);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Transcripts area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px] max-h-[300px] bg-zinc-900/50 rounded-lg">
        {transcripts.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-8">
            {isConnected
              ? "Start speaking..."
              : "Connect to start a voice conversation"}
          </div>
        ) : (
          transcripts.map((t) => (
            <div
              key={t.id}
              className={`flex ${t.isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                  t.isUser
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-100"
                } ${t.isTentative ? "opacity-60 italic" : ""}`}
              >
                {t.text}
              </div>
            </div>
          ))
        )}
        <div ref={transcriptsEndRef} />
      </div>

      {/* Mode indicator */}
      <div className="flex items-center justify-center gap-2 py-2 text-sm">
        {mode === "listening" && (
          <>
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-indigo-400">Listening...</span>
          </>
        )}
        {mode === "speaking" && (
          <>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-400">Agent speaking...</span>
          </>
        )}
        {mode === "idle" && !isConnected && (
          <span className="text-zinc-500">Ready to connect</span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 mb-2 text-sm text-red-400 bg-red-950/50 rounded-lg">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 p-2">
        {!isConnected ? (
          <button
            onClick={connect}
            disabled={isConnecting || !agentId}
            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors ${
              isConnecting || !agentId
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Phone className="w-4 h-4" />
            )}
            <span>{isConnecting ? "Connecting..." : "Start Call"}</span>
          </button>
        ) : (
          <>
            <button
              onClick={toggleMute}
              className={`p-2 rounded-full transition-colors ${
                isMuted
                  ? "bg-red-600 hover:bg-red-500 text-white"
                  : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
              }`}
            >
              {isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={disconnect}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
              <span>End Call</span>
            </button>
          </>
        )}

        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
            title="Voice Settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
