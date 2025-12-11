"use client";

import { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  User,
  Bot,
  HelpCircle,
  Wrench,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Send,
  MessageSquare,
  Loader2,
  Copy,
  Check,
  CornerDownRight,
  Circle,
  ChevronsUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ClaudeCodeMessage, MessageType, QuestionOption } from "@/lib/message-types";
import type { ActivityState, TaskStatus } from "@/lib/types";
import { getSessionMessages, answerQuestion, subscribeToMessages, getChat } from "@/lib/api";
import StatusIndicator from "./StatusIndicator";

// Number of messages to load initially and per page
const INITIAL_MESSAGE_COUNT = 50;
const LOAD_MORE_COUNT = 30;

interface MessageViewProps {
  sessionId: string;
  className?: string;
  showTimestamps?: boolean;
  autoScroll?: boolean;
}

// Format timestamp for display
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Format relative time
function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

// Message type configuration - minimal monochrome styling
const messageConfig: Record<MessageType, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  borderColor: string;
  iconColor: string;
}> = {
  user_prompt: {
    icon: User,
    label: "You",
    borderColor: "border-zinc-700",
    iconColor: "text-zinc-300",
  },
  assistant: {
    icon: Bot,
    label: "Claude",
    borderColor: "border-zinc-700",
    iconColor: "text-zinc-300",
  },
  user_question: {
    icon: HelpCircle,
    label: "Question",
    borderColor: "border-amber-800/50",
    iconColor: "text-amber-500",
  },
  tool_use: {
    icon: Wrench,
    label: "Tool",
    borderColor: "border-blue-900/40",
    iconColor: "text-blue-400",
  },
  tool_result: {
    icon: CornerDownRight,
    label: "Result",
    borderColor: "border-zinc-800/60",
    iconColor: "text-zinc-500",
  },
  final_output: {
    icon: CheckCircle,
    label: "Complete",
    borderColor: "border-emerald-800/50",
    iconColor: "text-emerald-500",
  },
  error: {
    icon: AlertTriangle,
    label: "Error",
    borderColor: "border-red-800/50",
    iconColor: "text-red-400",
  },
};

// Helper to convert todo-style content into checkbox markdown
function processTodoContent(content: string): string {
  // Convert patterns like "- [pending] Task" or "- [in_progress] Task" to checkboxes
  return content
    .replace(/^- \[completed\]\s*/gm, "- [x] ")
    .replace(/^- \[in_progress\]\s*/gm, "- [ ] **[WIP]** ")
    .replace(/^- \[pending\]\s*/gm, "- [ ] ");
}

// Check if message is a "secondary" message (tool use/result) vs "primary" (user/assistant)
function isSecondaryMessage(type: MessageType): boolean {
  return type === "tool_use" || type === "tool_result";
}

// Individual message component
function MessageCard({
  message,
  showTimestamp,
  onAnswer,
  defaultCollapsed = false,
}: {
  message: ClaudeCodeMessage;
  showTimestamp: boolean;
  onAnswer?: (messageId: string, response: string) => void;
  defaultCollapsed?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customResponse, setCustomResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const config = messageConfig[message.message_type];
  const Icon = config.icon;
  const isLongContent = message.content.length > 500;
  const isSecondary = isSecondaryMessage(message.message_type);

  // Process content for special formatting (todos, etc.)
  const processedContent = message.tool_name === "TodoWrite"
    ? processTodoContent(message.content)
    : message.content;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleSubmitAnswer = async () => {
    const response = selectedOption || customResponse;
    if (!response || !onAnswer) return;

    setIsSubmitting(true);
    try {
      await onAnswer(message.id, response);
    } finally {
      setIsSubmitting(false);
    }
  };

  // For secondary messages (tool use/result), show compact collapsed view by default
  if (isSecondary && !isExpanded) {
    return (
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded border border-zinc-800/40 bg-zinc-900/30 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={() => setIsExpanded(true)}
      >
        <Icon className={`w-3 h-3 ${config.iconColor} opacity-60`} />
        <span className="text-[11px] text-zinc-500">{config.label}</span>
        {message.tool_name && (
          <span className="text-[10px] px-1 py-0 rounded bg-zinc-800/50 text-zinc-500 font-mono">
            {message.tool_name}
          </span>
        )}
        {message.tool_status && (
          <span className={`text-[10px] flex items-center gap-0.5 ${
            message.tool_status === "success" ? "text-emerald-500/70" :
            message.tool_status === "error" ? "text-red-400/70" :
            "text-zinc-500"
          }`}>
            {message.tool_status === "success" ? <CheckCircle className="w-2.5 h-2.5" /> :
             message.tool_status === "error" ? <XCircle className="w-2.5 h-2.5" /> :
             <Clock className="w-2.5 h-2.5" />}
          </span>
        )}
        <ChevronRight className="w-3 h-3 text-zinc-600 ml-auto" />
      </div>
    );
  }

  return (
    <div className={`rounded border ${config.borderColor} ${isSecondary ? 'bg-zinc-900/30' : 'bg-zinc-900/50'} ${isSecondary ? 'p-2' : 'p-3'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
          <span className={`text-[12px] font-medium ${isSecondary ? 'text-zinc-400' : 'text-zinc-300'}`}>{config.label}</span>
          {(message.message_type === "tool_use" || message.message_type === "tool_result") && message.tool_name && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
              {message.tool_name}
            </span>
          )}
          {message.tool_status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${
              message.tool_status === "success"
                ? "bg-emerald-900/30 text-emerald-400"
                : message.tool_status === "error"
                ? "bg-red-900/30 text-red-400"
                : "bg-zinc-800 text-zinc-400"
            }`}>
              {message.tool_status === "success" ? (
                <CheckCircle className="w-2.5 h-2.5" />
              ) : message.tool_status === "error" ? (
                <XCircle className="w-2.5 h-2.5" />
              ) : (
                <Clock className="w-2.5 h-2.5" />
              )}
              {message.tool_status}
            </span>
          )}
          {message.question_meta?.header && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">
              {message.question_meta.header}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {showTimestamp && (
            <span className="text-[11px] text-zinc-600 mr-1" title={message.created_at}>
              {formatRelativeTime(message.created_at)}
            </span>
          )}
          <button
            className="p-1 rounded hover:bg-zinc-800 transition-colors"
            onClick={handleCopy}
            title="Copy content"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </button>
          {(isLongContent || isSecondary) && (
            <button
              className="p-1 rounded hover:bg-zinc-800 transition-colors"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className={`text-[12px] text-zinc-400 leading-relaxed prose prose-sm prose-invert max-w-none
          prose-p:my-1.5 prose-p:leading-relaxed
          prose-headings:text-zinc-200 prose-headings:font-medium prose-headings:mt-3 prose-headings:mb-1.5
          prose-h1:text-[14px] prose-h2:text-[13px] prose-h3:text-[12px]
          prose-code:text-emerald-300 prose-code:bg-zinc-950 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-code:font-mono
          prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-2 prose-pre:shadow-inner
          prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-zinc-200 prose-strong:font-medium
          prose-em:text-zinc-300
          prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4
          prose-li:my-0.5 prose-li:marker:text-zinc-600
          [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-emerald-500
          prose-blockquote:border-l-2 prose-blockquote:border-zinc-700 prose-blockquote:pl-3 prose-blockquote:my-2 prose-blockquote:text-zinc-500 prose-blockquote:not-italic
          prose-hr:border-zinc-800 prose-hr:my-3
          prose-table:text-[11px] prose-th:text-zinc-300 prose-th:font-medium prose-th:bg-zinc-800 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-td:border-zinc-800
          ${!isExpanded && isLongContent ? "max-h-24 overflow-hidden" : ""}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {processedContent}
        </ReactMarkdown>
      </div>

      {/* Question options */}
      {message.message_type === "user_question" && message.options && (
        <div className="mt-3 space-y-2">
          {message.user_response ? (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-emerald-900/20 rounded border border-emerald-800/30">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span className="text-[11px] text-emerald-400">
                Answered: {message.user_response}
              </span>
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                {message.options.map((option: QuestionOption, index: number) => (
                  <button
                    key={index}
                    onClick={() => setSelectedOption(option.label)}
                    className={`text-left p-2 rounded border transition-colors ${
                      selectedOption === option.label
                        ? "bg-zinc-800 border-zinc-600"
                        : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-medium text-zinc-200">{option.label}</span>
                      {option.description && (
                        <span className="text-[11px] text-zinc-500">{option.description}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <Input
                  placeholder="Or type a custom response..."
                  value={customResponse}
                  onChange={(e) => {
                    setCustomResponse(e.target.value);
                    setSelectedOption(null);
                  }}
                  className="flex-1 h-7 text-[11px] bg-zinc-900 border-zinc-800 placeholder:text-zinc-600"
                />
                <button
                  onClick={handleSubmitAnswer}
                  disabled={(!selectedOption && !customResponse) || isSubmitting}
                  className="h-7 px-2.5 rounded bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Expand indicator for truncated content */}
      {!isExpanded && isLongContent && (
        <button
          onClick={() => setIsExpanded(true)}
          className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors"
        >
          Show more...
        </button>
      )}
    </div>
  );
}

// Main MessageView component
export default function MessageView({
  sessionId,
  className = "",
  showTimestamps = true,
  autoScroll = true,
}: MessageViewProps) {
  const [messages, setMessages] = useState<ClaudeCodeMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityState, setActivityState] = useState<ActivityState | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lowestSeqRef = useRef<number | null>(null);

  // Load initial messages (most recent) and session state
  useEffect(() => {
    async function loadMessages() {
      setIsLoading(true);
      setError(null);
      setInitialLoadComplete(false);
      setHasMoreMessages(false);
      lowestSeqRef.current = null;
      setUserHasScrolled(false);

      try {
        // Load the most recent messages first (descending order)
        const recentMessages = await getSessionMessages(sessionId, {
          limit: INITIAL_MESSAGE_COUNT,
          order: "desc",
        });

        // Reverse to get ascending order for display
        const sortedMessages = recentMessages.reverse();
        setMessages(sortedMessages);

        // Track the lowest seq we have for loading more
        if (sortedMessages.length > 0) {
          lowestSeqRef.current = sortedMessages[0].seq;
          // If we got the full limit, there might be more messages
          setHasMoreMessages(recentMessages.length >= INITIAL_MESSAGE_COUNT);
        }

        // Also fetch session info to get activity state and task status
        try {
          const chat = await getChat(sessionId);
          setActivityState(chat.activityState || null);
          setIsConnected(chat.status === "running");
          if (chat.taskStatus) {
            setTaskStatus(chat.taskStatus);
          }
        } catch {
          // Session might not exist yet in terminal_sessions
          setIsConnected(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        setIsLoading(false);
      }
    }

    loadMessages();
  }, [sessionId]);

  // Use layout effect to scroll to bottom immediately after render, before paint
  useLayoutEffect(() => {
    if (!isLoading && messages.length > 0 && !initialLoadComplete && messagesContainerRef.current) {
      // Scroll to bottom immediately without animation
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      // Mark initial load complete after scroll
      setInitialLoadComplete(true);
    }
  }, [isLoading, messages.length, initialLoadComplete]);

  // Load more (older) messages
  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMoreMessages || lowestSeqRef.current === null) return;

    setIsLoadingMore(true);
    try {
      const olderMessages = await getSessionMessages(sessionId, {
        limit: LOAD_MORE_COUNT,
        beforeSeq: lowestSeqRef.current,
        order: "desc",
      });

      if (olderMessages.length > 0) {
        const sortedOlder = olderMessages.reverse();
        lowestSeqRef.current = sortedOlder[0].seq;

        // Preserve scroll position when prepending messages
        const container = messagesContainerRef.current;
        const previousScrollHeight = container?.scrollHeight || 0;

        setMessages(prev => [...sortedOlder, ...prev]);

        // After state update, restore scroll position
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - previousScrollHeight;
          }
        });

        setHasMoreMessages(olderMessages.length >= LOAD_MORE_COUNT);
      } else {
        setHasMoreMessages(false);
      }
    } catch (err) {
      console.error("Failed to load more messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [sessionId, isLoadingMore, hasMoreMessages]);

  // Handle scroll events for auto-loading more
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = container;

    // Mark that user has scrolled (for auto-scroll behavior)
    if (scrollTop < scrollHeight - clientHeight - 50) {
      setUserHasScrolled(true);
    } else {
      setUserHasScrolled(false);
    }

    // Load more when scrolled near the top
    if (scrollTop < 100 && hasMoreMessages && !isLoadingMore) {
      loadMoreMessages();
    }
  }, [hasMoreMessages, isLoadingMore, loadMoreMessages]);

  // Poll for session activity state and task status changes
  useEffect(() => {
    const pollTaskStatus = async () => {
      try {
        const chat = await getChat(sessionId);
        setActivityState(chat.activityState || null);
        setIsConnected(chat.status === "running");
        if (chat.taskStatus) {
          setTaskStatus(chat.taskStatus);
        }
      } catch {
        // Ignore errors during polling
      }
    };

    // Poll every 1 second for more responsive status updates
    const interval = setInterval(pollTaskStatus, 1000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Subscribe to new messages with faster polling
  useEffect(() => {
    const unsubscribe = subscribeToMessages(sessionId, (newMessages) => {
      setMessages((prev) => {
        // Merge messages, updating existing ones by ID and adding new ones
        const messageMap = new Map(prev.map((m) => [m.id, m]));
        for (const msg of newMessages) {
          messageMap.set(msg.id, msg);
        }
        // Sort by sequence number
        return Array.from(messageMap.values()).sort((a, b) => a.seq - b.seq);
      });
    }, 500); // Poll every 500ms instead of 1000ms

    return unsubscribe;
  }, [sessionId]);

  // Auto-scroll to bottom for new messages (only if user hasn't scrolled up)
  useEffect(() => {
    if (autoScroll && initialLoadComplete && !userHasScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll, initialLoadComplete, userHasScrolled]);

  // Handle answering a question
  const handleAnswer = useCallback(async (messageId: string, response: string) => {
    try {
      await answerQuestion(messageId, response);
      // Update local state
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, user_response: response, user_response_at: new Date().toISOString() }
            : m
        )
      );
    } catch (err) {
      console.error("Failed to submit answer:", err);
    }
  }, []);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin" />
          <span className="text-[12px] text-zinc-500">Loading messages...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-2 text-center max-w-sm px-4">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-[12px] text-red-400">{error}</span>
          <p className="text-[11px] text-zinc-600">
            Make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.
          </p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        {/* Header with activity indicator */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[12px] font-medium text-zinc-300">Messages</span>
          </div>
          <StatusIndicator taskStatus={taskStatus} isConnected={isConnected} />
        </div>

        {/* Empty state with activity-aware messaging */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center px-4">
            {activityState === "busy" ? (
              <>
                <div className="relative">
                  <MessageSquare className="w-6 h-6 text-zinc-600" />
                  <Loader2 className="w-3 h-3 text-amber-400 absolute -bottom-1 -right-1 animate-spin" />
                </div>
                <span className="text-[12px] text-zinc-300">Claude is working...</span>
                <p className="text-[11px] text-zinc-500 max-w-xs">
                  Messages will appear here as Claude responds. This may take a moment.
                </p>
              </>
            ) : isConnected ? (
              <>
                <div className="relative">
                  <MessageSquare className="w-6 h-6 text-zinc-600" />
                  <Circle className="w-2.5 h-2.5 text-emerald-400 fill-current absolute -bottom-0.5 -right-0.5" />
                </div>
                <span className="text-[12px] text-zinc-300">Ready for input</span>
                <p className="text-[11px] text-zinc-500 max-w-xs">
                  Send a message to Claude to start a conversation. Messages will appear here.
                </p>
              </>
            ) : (
              <>
                <MessageSquare className="w-6 h-6 text-zinc-700" />
                <span className="text-[12px] text-zinc-400">No messages yet</span>
                <p className="text-[11px] text-zinc-600 max-w-xs">
                  Start Claude Code in this session to see structured messages here.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[12px] font-medium text-zinc-300">Messages</span>
          <span className="text-[10px] px-1.5 py-0 rounded bg-zinc-800 text-zinc-500">
            {messages.length}{hasMoreMessages ? "+" : ""}
          </span>
        </div>
        <StatusIndicator taskStatus={taskStatus} isConnected={isConnected} />
      </div>

      {/* Messages list */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5"
        onScroll={handleScroll}
      >
        {/* Load more indicator */}
        {hasMoreMessages && (
          <div className="flex justify-center py-2">
            {isLoadingMore ? (
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading older messages...
              </div>
            ) : (
              <button
                onClick={loadMoreMessages}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-900/50 hover:bg-zinc-800/50 rounded border border-zinc-800 transition-colors"
              >
                <ChevronsUp className="w-3 h-3" />
                Load older messages
              </button>
            )}
          </div>
        )}

        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            showTimestamp={showTimestamps}
            onAnswer={handleAnswer}
            defaultCollapsed={isSecondaryMessage(message.message_type)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
