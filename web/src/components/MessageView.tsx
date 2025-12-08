"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  Send,
  MessageSquare,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ClaudeCodeMessage, MessageType, QuestionOption } from "@/lib/message-types";
import { getSessionMessages, answerQuestion, subscribeToMessages } from "@/lib/api";

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
    borderColor: "border-zinc-800",
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

// Individual message component
function MessageCard({
  message,
  showTimestamp,
  onAnswer,
}: {
  message: ClaudeCodeMessage;
  showTimestamp: boolean;
  onAnswer?: (messageId: string, response: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customResponse, setCustomResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const config = messageConfig[message.message_type];
  const Icon = config.icon;
  const isLongContent = message.content.length > 500;

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

  return (
    <div className={`rounded border ${config.borderColor} bg-zinc-900/50 p-3`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
          <span className="text-[12px] font-medium text-zinc-300">{config.label}</span>
          {message.message_type === "tool_use" && message.tool_name && (
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
          {isLongContent && (
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
          prose-code:text-zinc-300 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded prose-pre:p-2 prose-pre:my-2
          prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-zinc-200 prose-strong:font-medium
          prose-em:text-zinc-300
          prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4
          prose-li:my-0.5 prose-li:marker:text-zinc-600
          prose-blockquote:border-l-2 prose-blockquote:border-zinc-700 prose-blockquote:pl-3 prose-blockquote:my-2 prose-blockquote:text-zinc-500 prose-blockquote:not-italic
          prose-hr:border-zinc-800 prose-hr:my-3
          prose-table:text-[11px] prose-th:text-zinc-300 prose-th:font-medium prose-th:bg-zinc-800 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-td:border-zinc-800
          ${!isExpanded && isLongContent ? "max-h-24 overflow-hidden" : ""}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
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
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load initial messages
  useEffect(() => {
    async function loadMessages() {
      setIsLoading(true);
      setError(null);
      try {
        const initialMessages = await getSessionMessages(sessionId);
        setMessages(initialMessages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        setIsLoading(false);
      }
    }

    loadMessages();
  }, [sessionId]);

  // Subscribe to new messages
  useEffect(() => {
    const unsubscribe = subscribeToMessages(sessionId, (newMessages) => {
      setMessages((prev) => {
        // Deduplicate by ID
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueNew = newMessages.filter((m) => !existingIds.has(m.id));
        return [...prev, ...uniqueNew];
      });
    });

    return unsubscribe;
  }, [sessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

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
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-2 text-center">
          <MessageSquare className="w-5 h-5 text-zinc-600" />
          <span className="text-[12px] text-zinc-400">No messages yet</span>
          <p className="text-[11px] text-zinc-600 max-w-xs">
            Structured messages will appear here when Claude Code hooks are active.
          </p>
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
            {messages.length}
          </span>
        </div>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            showTimestamp={showTimestamps}
            onAnswer={handleAnswer}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
