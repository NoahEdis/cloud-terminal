"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Terminal as TerminalIcon,
  MessageSquare,
  Columns,
  Rows,
  ChevronLeft,
  RefreshCw,
} from "lucide-react";
import { listSessions, listMessageSessions, type MessageSession } from "@/lib/api";
import type { SessionInfo } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Dynamically import components to avoid SSR issues
const Terminal = dynamic(() => import("@/components/Terminal"), { ssr: false });
const MessageView = dynamic(() => import("@/components/MessageView"), { ssr: false });

type LayoutMode = "split" | "terminal" | "messages" | "stack";

export default function DemoPage() {
  // Terminal sessions (from Cloud Terminal API)
  const [terminalSessions, setTerminalSessions] = useState<SessionInfo[]>([]);
  const [selectedTerminalSession, setSelectedTerminalSession] = useState<string | null>(null);
  const [terminalLoading, setTerminalLoading] = useState(true);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  // Message sessions (from Supabase)
  const [messageSessions, setMessageSessions] = useState<MessageSession[]>([]);
  const [selectedMessageSession, setSelectedMessageSession] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(true);
  const [messageError, setMessageError] = useState<string | null>(null);

  const [layout, setLayout] = useState<LayoutMode>("messages");

  // Load terminal sessions
  useEffect(() => {
    async function loadTerminalSessions() {
      try {
        const data = await listSessions();
        setTerminalSessions(data);
        if (data.length > 0 && !selectedTerminalSession) {
          setSelectedTerminalSession(data[0].id || data[0].name || null);
        }
        setTerminalError(null);
      } catch (err) {
        setTerminalError(err instanceof Error ? err.message : "Failed to load terminal sessions");
      } finally {
        setTerminalLoading(false);
      }
    }

    loadTerminalSessions();
    const interval = setInterval(loadTerminalSessions, 5000);
    return () => clearInterval(interval);
  }, [selectedTerminalSession]);

  // Load message sessions from Supabase
  useEffect(() => {
    async function loadMessageSessions() {
      try {
        const data = await listMessageSessions();
        setMessageSessions(data);
        if (data.length > 0 && !selectedMessageSession) {
          setSelectedMessageSession(data[0].session_id);
        }
        setMessageError(null);
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : "Failed to load message sessions");
      } finally {
        setMessageLoading(false);
      }
    }

    loadMessageSessions();
    const interval = setInterval(loadMessageSessions, 10000);
    return () => clearInterval(interval);
  }, [selectedMessageSession]);

  const getTerminalSessionIdentifier = (session: SessionInfo) => session.id || session.name || "";

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200">
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </Link>
          <div className="h-4 w-px bg-zinc-700" />
          <h1 className="text-lg font-semibold text-zinc-200">Message View Demo</h1>
          <Badge variant="outline" className="text-xs">
            Experimental
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          {/* Message session selector - shown when messages panel is visible */}
          {(layout === "messages" || layout === "split" || layout === "stack") && (
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <Select
                value={selectedMessageSession || ""}
                onValueChange={setSelectedMessageSession}
              >
                <SelectTrigger className="w-56 bg-zinc-900 border-zinc-700">
                  <SelectValue placeholder="Select messages..." />
                </SelectTrigger>
                <SelectContent>
                  {messageSessions.length === 0 ? (
                    <SelectItem value="none" disabled>
                      {messageLoading ? "Loading..." : messageError || "No message sessions"}
                    </SelectItem>
                  ) : (
                    messageSessions.map((session) => (
                      <SelectItem
                        key={session.session_id}
                        value={session.session_id}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400">
                            {session.session_id.slice(0, 8)}...
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1">
                            {session.message_count} msgs
                          </Badge>
                          <span className="text-xs text-zinc-500">
                            {formatTime(session.latest_message_at)}
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Terminal session selector - shown when terminal panel is visible */}
          {(layout === "terminal" || layout === "split" || layout === "stack") && (
            <div className="flex items-center gap-2">
              <TerminalIcon className="w-4 h-4 text-green-400" />
              <Select
                value={selectedTerminalSession || ""}
                onValueChange={setSelectedTerminalSession}
              >
                <SelectTrigger className="w-56 bg-zinc-900 border-zinc-700">
                  <SelectValue placeholder="Select terminal..." />
                </SelectTrigger>
                <SelectContent>
                  {terminalSessions.length === 0 ? (
                    <SelectItem value="none" disabled>
                      {terminalLoading ? "Loading..." : terminalError || "No terminal sessions"}
                    </SelectItem>
                  ) : (
                    terminalSessions.map((session) => (
                      <SelectItem
                        key={getTerminalSessionIdentifier(session)}
                        value={getTerminalSessionIdentifier(session)}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              session.status === "running" ? "bg-green-500" : "bg-zinc-500"
                            }`}
                          />
                          <span>{session.cwd.split("/").pop() || session.cwd}</span>
                          <span className="text-xs text-zinc-500">
                            {getTerminalSessionIdentifier(session).slice(0, 8)}
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Layout toggle */}
          <div className="flex items-center gap-1 p-1 bg-zinc-900 rounded-lg border border-zinc-700">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "split" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setLayout("split")}
                >
                  <Columns className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split View</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "stack" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setLayout("stack")}
                >
                  <Rows className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stacked View</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "terminal" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setLayout("terminal")}
                >
                  <TerminalIcon className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Terminal Only</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "messages" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setLayout("messages")}
                >
                  <MessageSquare className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Messages Only</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {(terminalLoading || messageLoading) ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-zinc-500">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <span className="text-sm">Loading sessions...</span>
            </div>
          </div>
        ) : (
          <div
            className={`h-full ${
              layout === "split"
                ? "flex"
                : layout === "stack"
                ? "flex flex-col"
                : ""
            }`}
          >
            {/* Terminal panel */}
            {(layout === "split" || layout === "terminal" || layout === "stack") && (
              <div
                className={`${
                  layout === "split"
                    ? "w-1/2 border-r border-zinc-800"
                    : layout === "stack"
                    ? "h-1/2 border-b border-zinc-800"
                    : "h-full"
                }`}
              >
                <div className="h-full flex flex-col">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
                    <TerminalIcon className="w-4 h-4 text-green-400" />
                    <span className="text-sm font-medium text-zinc-300">
                      Raw Terminal Output
                    </span>
                    <Badge variant="outline" className="text-xs ml-auto">
                      xterm.js
                    </Badge>
                  </div>
                  <div className="flex-1">
                    {selectedTerminalSession ? (
                      <Terminal sessionId={selectedTerminalSession} />
                    ) : (
                      <div className="h-full flex items-center justify-center text-zinc-500">
                        <p>Select a terminal session above</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Messages panel */}
            {(layout === "split" || layout === "messages" || layout === "stack") && (
              <div
                className={`bg-zinc-900/30 ${
                  layout === "split"
                    ? "w-1/2"
                    : layout === "stack"
                    ? "h-1/2"
                    : "h-full"
                }`}
              >
                {selectedMessageSession ? (
                  <MessageView sessionId={selectedMessageSession} />
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500">
                    <div className="text-center">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                      <p>No message sessions available</p>
                      <p className="text-xs mt-1">Run Claude Code with message hooks to capture sessions</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer with info */}
      <footer className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/50">
        <p className="text-xs text-zinc-500 text-center">
          The Message View parses structured messages from{" "}
          <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">
            claude_code_messages
          </code>{" "}
          in Supabase. Enable Claude Code hooks to capture messages.
        </p>
      </footer>
    </div>
  );
}
