"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Play,
  Pause,
  Volume2,
  Check,
  Loader2,
  RefreshCw,
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Settings,
  X,
} from "lucide-react";
import { Conversation } from "@elevenlabs/client";

interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  description?: string;
}

interface Agent {
  agent_id: string;
  name?: string;
}

interface TranscriptMessage {
  id: string;
  text: string;
  isUser: boolean;
  isTentative: boolean;
}

interface VoiceChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTranscript?: (text: string, isUser: boolean) => void;
}

export default function VoiceChatDialog({
  open,
  onOpenChange,
  onTranscript,
}: VoiceChatDialogProps) {
  // State
  const [view, setView] = useState<"settings" | "chat">("settings");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio preview state
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Chat state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [mode, setMode] = useState<"idle" | "listening" | "speaking">("idle");
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const conversationRef = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const transcriptsEndRef = useRef<HTMLDivElement>(null);

  // Load saved preferences from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedVoiceId = localStorage.getItem("elevenlabs_voice_id");
      const savedAgentId = localStorage.getItem("elevenlabs_agent_id");
      if (savedVoiceId) setSelectedVoiceId(savedVoiceId);
      if (savedAgentId) setSelectedAgentId(savedAgentId);
    }
  }, []);

  // Save preferences to localStorage
  useEffect(() => {
    if (typeof window !== "undefined" && selectedVoiceId) {
      localStorage.setItem("elevenlabs_voice_id", selectedVoiceId);
    }
  }, [selectedVoiceId]);

  useEffect(() => {
    if (typeof window !== "undefined" && selectedAgentId) {
      localStorage.setItem("elevenlabs_agent_id", selectedAgentId);
    }
  }, [selectedAgentId]);

  // Load voices
  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    setError(null);
    try {
      const response = await fetch("/api/elevenlabs/voices");
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setVoices(data.voices || []);
    } catch (err) {
      console.error("Error loading voices:", err);
      setError("Failed to load voices");
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  // Load agents
  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const response = await fetch("/api/elevenlabs/agents");
      const data = await response.json();

      if (!data.error) {
        setAgents(data.agents || []);
      }
    } catch (err) {
      console.error("Error loading agents:", err);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      loadVoices();
      loadAgents();
    }
  }, [open, loadVoices, loadAgents]);

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Play voice preview
  const playPreview = useCallback(async (voiceId: string) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingVoiceId === voiceId) {
      setPlayingVoiceId(null);
      return;
    }

    setLoadingPreview(voiceId);

    try {
      const response = await fetch("/api/elevenlabs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate preview");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setPlayingVoiceId(null);
        URL.revokeObjectURL(url);
      };

      audio.onerror = () => {
        setPlayingVoiceId(null);
        URL.revokeObjectURL(url);
      };

      await audio.play();
      setPlayingVoiceId(voiceId);
    } catch (err) {
      console.error("Error playing preview:", err);
      setError("Failed to play voice preview");
    } finally {
      setLoadingPreview(null);
    }
  }, [playingVoiceId]);

  // Stop preview
  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId(null);
  }, []);

  // Add transcript
  const addTranscript = useCallback(
    (text: string, isUser: boolean, isTentative: boolean) => {
      const id = `${isUser ? "user" : "agent"}-${Date.now()}`;

      setTranscripts((prev) => {
        if (isTentative) {
          const existingIndex = prev.findIndex(
            (t) => t.isUser === isUser && t.isTentative
          );
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], text };
            return updated;
          }
        }

        if (!isTentative) {
          const withoutTentative = prev.filter(
            (t) => !(t.isUser === isUser && t.isTentative)
          );
          return [...withoutTentative, { id, text, isUser, isTentative }];
        }

        return [...prev, { id, text, isUser, isTentative }];
      });

      if (!isTentative) {
        onTranscript?.(text, isUser);
      }
    },
    [onTranscript]
  );

  // Connect to agent
  const connect = useCallback(async () => {
    if (!selectedAgentId) {
      setError("Please select an agent first");
      return;
    }

    setIsConnecting(true);
    setError(null);
    setTranscripts([]);

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      let signedUrl: string | null = null;
      try {
        const response = await fetch("/api/elevenlabs/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: selectedAgentId }),
        });
        const data = await response.json();
        if (data.signed_url) {
          signedUrl = data.signed_url;
        }
      } catch (e) {
        console.log("Could not get signed URL");
      }

      const sessionConfig = signedUrl
        ? { signedUrl, connectionType: "websocket" as const }
        : { agentId: selectedAgentId, connectionType: "websocket" as const };

      const conversation = await Conversation.startSession({
        ...sessionConfig,
        onConnect: () => {
          setIsConnected(true);
          setIsConnecting(false);
          setMode("listening");
          setView("chat");
        },
        onDisconnect: () => {
          setIsConnected(false);
          setMode("idle");
        },
        onError: (err: string) => {
          console.error("Conversation error:", err);
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
          setMode(
            modeChange.mode === "speaking"
              ? "speaking"
              : modeChange.mode === "listening"
              ? "listening"
              : "idle"
          );
        },
      });

      conversationRef.current = conversation;
    } catch (err) {
      console.error("Connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  }, [selectedAgentId, addTranscript]);

  // Disconnect
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

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      stopPreview();
      disconnect();
      setView("settings");
    }
  }, [open, stopPreview, disconnect]);

  // Create new agent
  const createAgent = useCallback(async () => {
    if (!selectedVoiceId) {
      setError("Please select a voice first");
      return;
    }

    setError(null);

    try {
      const response = await fetch("/api/elevenlabs/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Cloud Terminal Assistant",
          prompt:
            "You are a helpful voice assistant for Cloud Terminal. Help users with their coding tasks, answer questions, and provide guidance. Be concise and conversational.",
          firstMessage: "Hi! I'm your Cloud Terminal assistant. How can I help you?",
          voiceId: selectedVoiceId,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setSelectedAgentId(data.agent_id);
      await loadAgents();
    } catch (err) {
      console.error("Error creating agent:", err);
      setError("Failed to create agent");
    }
  }, [selectedVoiceId, loadAgents]);

  const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);
  const selectedAgent = agents.find((a) => a.agent_id === selectedAgentId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view === "settings" ? (
              <>
                <Volume2 className="w-5 h-5" />
                Voice Chat Settings
              </>
            ) : (
              <>
                <Phone className="w-5 h-5 text-emerald-400" />
                Voice Chat
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {view === "settings"
              ? "Select a voice and agent for real-time voice conversations."
              : "Speak naturally to interact with your AI assistant."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center justify-between px-3 py-2 text-sm text-red-400 bg-red-950/50 rounded-lg">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {view === "settings" ? (
          <div className="space-y-4">
            {/* Voice Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-zinc-300">
                  Select Voice
                </label>
                <button
                  onClick={loadVoices}
                  disabled={loadingVoices}
                  className="p-1 text-zinc-400 hover:text-zinc-300 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loadingVoices ? "animate-spin" : ""}`}
                  />
                </button>
              </div>

              {loadingVoices ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                </div>
              ) : (
                <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
                  {voices.map((voice) => (
                    <div
                      key={voice.voice_id}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                        selectedVoiceId === voice.voice_id
                          ? "bg-indigo-600/20 border border-indigo-500/50"
                          : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent"
                      }`}
                      onClick={() => setSelectedVoiceId(voice.voice_id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {selectedVoiceId === voice.voice_id && (
                          <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {voice.name}
                          </div>
                          {voice.labels?.accent && (
                            <div className="text-xs text-zinc-500">
                              {voice.labels.accent}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          playPreview(voice.voice_id);
                        }}
                        disabled={loadingPreview === voice.voice_id}
                        className="p-1.5 rounded-full bg-zinc-700 hover:bg-zinc-600 transition-colors flex-shrink-0"
                        title="Preview voice"
                      >
                        {loadingPreview === voice.voice_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : playingVoiceId === voice.voice_id ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agent Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-zinc-300">
                  Select Agent
                </label>
                <button
                  onClick={loadAgents}
                  disabled={loadingAgents}
                  className="p-1 text-zinc-400 hover:text-zinc-300 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loadingAgents ? "animate-spin" : ""}`}
                  />
                </button>
              </div>

              {loadingAgents ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                </div>
              ) : agents.length > 0 ? (
                <div className="space-y-1 max-h-[120px] overflow-y-auto pr-1">
                  {agents.map((agent) => (
                    <div
                      key={agent.agent_id}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        selectedAgentId === agent.agent_id
                          ? "bg-indigo-600/20 border border-indigo-500/50"
                          : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent"
                      }`}
                      onClick={() => setSelectedAgentId(agent.agent_id)}
                    >
                      {selectedAgentId === agent.agent_id && (
                        <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {agent.name || "Unnamed Agent"}
                        </div>
                        <div className="text-xs text-zinc-500 font-mono truncate">
                          {agent.agent_id}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-sm text-zinc-500">
                  No agents found
                </div>
              )}

              {selectedVoiceId && (
                <button
                  onClick={createAgent}
                  className="w-full mt-2 px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Create New Agent with Selected Voice
                </button>
              )}
            </div>

            {/* Start Call Button */}
            <button
              onClick={connect}
              disabled={!selectedAgentId || isConnecting}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors ${
                !selectedAgentId || isConnecting
                  ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
            >
              {isConnecting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Phone className="w-5 h-5" />
              )}
              <span>{isConnecting ? "Connecting..." : "Start Voice Call"}</span>
            </button>
          </div>
        ) : (
          /* Chat View */
          <div className="space-y-3">
            {/* Transcripts */}
            <div className="h-[250px] overflow-y-auto p-3 bg-zinc-950 rounded-lg space-y-2">
              {transcripts.length === 0 ? (
                <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                  Start speaking...
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
            <div className="flex items-center justify-center gap-2 py-1">
              {mode === "listening" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-sm text-indigo-400">Listening...</span>
                </>
              )}
              {mode === "speaking" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm text-emerald-400">
                    Agent speaking...
                  </span>
                </>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  disconnect();
                  setView("settings");
                }}
                className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>

              <button
                onClick={disconnect}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-full transition-colors"
              >
                <PhoneOff className="w-5 h-5" />
                <span>End Call</span>
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
