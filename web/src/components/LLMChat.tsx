"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Loader2, Bot, User, Trash2, Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  streamChat,
  getLLMChatMessages,
  saveLLMChatMessages,
  generateMessageId,
  PROVIDERS,
} from "@/lib/llm-api";
import type { LLMMessage, LLMProvider } from "@/lib/types";

interface LLMChatProps {
  chatId: string;
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  onClose?: () => void;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  message,
  onCopy,
  onRegenerate,
  isLast,
  isStreaming,
}: {
  message: LLMMessage;
  onCopy: () => void;
  onRegenerate?: () => void;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy();
  };

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? "bg-blue-600" : "bg-zinc-700"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>
      <div className={`flex-1 max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block rounded-lg px-4 py-2 ${
            isUser
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-100 border border-zinc-700"
          }`}
        >
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
            {message.content}
            {isStreaming && isLast && !isUser && (
              <span className="inline-block w-2 h-4 bg-zinc-400 ml-0.5 animate-pulse" />
            )}
          </div>
        </div>
        <div className={`flex items-center gap-2 mt-1 ${isUser ? "justify-end" : ""}`}>
          <span className="text-[10px] text-zinc-500">
            {formatTimestamp(message.timestamp)}
          </span>
          {!isUser && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Copy message"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              {isLast && onRegenerate && !isStreaming && (
                <button
                  onClick={onRegenerate}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Regenerate response"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LLMChat({ chatId, provider, model, systemPrompt }: LLMChatProps) {
  const [messages, setMessages] = useState<LLMMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load messages from storage on mount
  useEffect(() => {
    const storedMessages = getLLMChatMessages(chatId);
    if (storedMessages.length > 0) {
      setMessages(storedMessages);
    }
  }, [chatId]);

  // Save messages whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      saveLLMChatMessages(chatId, messages);
    }
  }, [chatId, messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: LLMMessage = {
      id: generateMessageId(),
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    setIsStreaming(true);

    // Create a placeholder for the assistant message
    const assistantMessage: LLMMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const allMessages = [...messages, userMessage];

      for await (const chunk of streamChat(
        provider,
        model,
        allMessages,
        systemPrompt
      )) {
        if (chunk.type === "content" && chunk.content) {
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.role === "assistant") {
              lastMsg.content += chunk.content;
            }
            return updated;
          });
        } else if (chunk.type === "error") {
          setError(chunk.error || "Unknown error");
          // Remove the empty assistant message on error
          setMessages((prev) => prev.slice(0, -1));
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      // Remove the empty assistant message on error
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, provider, model, systemPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRegenerate = useCallback(async () => {
    if (isStreaming || messages.length < 2) return;

    // Remove the last assistant message
    const newMessages = messages.slice(0, -1);
    setMessages(newMessages);
    setError(null);
    setIsStreaming(true);

    // Create a new assistant message placeholder
    const assistantMessage: LLMMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      for await (const chunk of streamChat(
        provider,
        model,
        newMessages,
        systemPrompt
      )) {
        if (chunk.type === "content" && chunk.content) {
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.role === "assistant") {
              lastMsg.content += chunk.content;
            }
            return updated;
          });
        } else if (chunk.type === "error") {
          setError(chunk.error || "Unknown error");
          setMessages((prev) => prev.slice(0, -1));
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, messages, provider, model, systemPrompt]);

  const handleClearChat = () => {
    setMessages([]);
    saveLLMChatMessages(chatId, []);
  };

  const providerConfig = PROVIDERS[provider];

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div>
            <div className="text-[12px] font-medium text-zinc-200">{providerConfig?.name || provider}</div>
            <div className="text-[10px] text-zinc-500">{model}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClearChat}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
              <Bot className="w-6 h-6 text-zinc-500" />
            </div>
            <h3 className="text-[14px] font-medium text-zinc-300 mb-1">
              Start a conversation
            </h3>
            <p className="text-[12px] text-zinc-500 max-w-[300px]">
              Send a message to start chatting with the {model} model from {providerConfig?.name || provider}.
            </p>
            {systemPrompt && (
              <div className="mt-4 p-3 rounded-lg bg-zinc-900 border border-zinc-800 max-w-[400px]">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">System Prompt</div>
                <div className="text-[11px] text-zinc-400 line-clamp-3">{systemPrompt}</div>
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                onCopy={() => {}}
                onRegenerate={
                  message.role === "assistant" && index === messages.length - 1
                    ? handleRegenerate
                    : undefined
                }
                isLast={index === messages.length - 1}
                isStreaming={isStreaming}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border-t border-red-800/50">
          <p className="text-[12px] text-red-400">{error}</p>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for new line)"
            className="flex-1 min-h-[44px] max-h-[200px] resize-none bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 text-[13px]"
            disabled={isStreaming}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="h-[44px] w-[44px] p-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-zinc-600">
            Press Enter to send, Shift+Enter for new line
          </span>
          <span className="text-[10px] text-zinc-600">
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export default LLMChat;
