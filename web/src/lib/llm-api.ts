// LLM API Client
// Unified client for multiple LLM providers with streaming support

import type { LLMMessage, LLMProvider } from "./types";

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  inputCost: number;  // per 1M tokens
  outputCost: number; // per 1M tokens
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  models: ModelInfo[];
  authHeader: "x-api-key" | "bearer" | "query" | "none";
  streamFormat: "sse" | "json-stream";
}

// Provider configurations with model info
export const PROVIDERS: Record<LLMProvider, ProviderConfig> = {
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authHeader: "x-api-key",
    streamFormat: "sse",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200000, inputCost: 3, outputCost: 15 },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", contextWindow: 200000, inputCost: 15, outputCost: 75 },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", contextWindow: 200000, inputCost: 3, outputCost: 15 },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200000, inputCost: 0.25, outputCost: 1.25 },
    ],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authHeader: "bearer",
    streamFormat: "sse",
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, inputCost: 2.5, outputCost: 10 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, inputCost: 0.15, outputCost: 0.6 },
      { id: "o1", name: "o1", contextWindow: 200000, inputCost: 15, outputCost: 60 },
      { id: "o1-mini", name: "o1 Mini", contextWindow: 128000, inputCost: 3, outputCost: 12 },
      { id: "o3-mini", name: "o3 Mini", contextWindow: 200000, inputCost: 1.1, outputCost: 4.4 },
    ],
  },
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authHeader: "query",
    streamFormat: "sse",
    models: [
      { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", contextWindow: 1000000, inputCost: 0, outputCost: 0 },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2000000, inputCost: 1.25, outputCost: 5 },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1000000, inputCost: 0.075, outputCost: 0.3 },
      { id: "gemini-exp-1206", name: "Gemini Exp 1206", contextWindow: 2000000, inputCost: 0, outputCost: 0 },
    ],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    authHeader: "bearer",
    streamFormat: "sse",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", contextWindow: 64000, inputCost: 0.14, outputCost: 0.28 },
      { id: "deepseek-reasoner", name: "DeepSeek R1", contextWindow: 64000, inputCost: 0.55, outputCost: 2.19 },
    ],
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    authHeader: "bearer",
    streamFormat: "sse",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128000, inputCost: 0.59, outputCost: 0.79 },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", contextWindow: 128000, inputCost: 0.05, outputCost: 0.08 },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: 32768, inputCost: 0.24, outputCost: 0.24 },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", contextWindow: 8192, inputCost: 0.2, outputCost: 0.2 },
    ],
  },
  ollama: {
    name: "Ollama",
    baseUrl: "http://localhost:11434/api",
    authHeader: "none",
    streamFormat: "json-stream",
    models: [], // Fetched dynamically
  },
};

// Storage keys for API keys
const API_KEY_STORAGE_PREFIX = "llm_api_key_";

// Get API key for a provider (localStorage fallback)
export function getStoredApiKey(provider: LLMProvider): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`${API_KEY_STORAGE_PREFIX}${provider}`);
}

// Store API key for a provider
export function storeApiKey(provider: LLMProvider, key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${API_KEY_STORAGE_PREFIX}${provider}`, key);
}

// Remove stored API key
export function removeApiKey(provider: LLMProvider): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${API_KEY_STORAGE_PREFIX}${provider}`);
}

// Check if provider has stored API key
export function hasStoredApiKey(provider: LLMProvider): boolean {
  return !!getStoredApiKey(provider);
}

// Get all providers with stored keys
export function getProvidersWithKeys(): LLMProvider[] {
  const providers: LLMProvider[] = ["anthropic", "openai", "gemini", "deepseek", "groq", "ollama"];
  return providers.filter((p) => p === "ollama" || hasStoredApiKey(p));
}

// Get available models for a provider
export function getModelsForProvider(provider: LLMProvider): ModelInfo[] {
  return PROVIDERS[provider]?.models ?? [];
}

// Get default model for a provider
export function getDefaultModel(provider: LLMProvider): string {
  const models = getModelsForProvider(provider);
  return models[0]?.id ?? "";
}

// Format messages for provider-specific API format
function formatMessagesForProvider(
  provider: LLMProvider,
  messages: LLMMessage[],
  systemPrompt?: string
): unknown {
  // Filter out system messages from the main messages array
  const chatMessages = messages.filter((m) => m.role !== "system");

  switch (provider) {
    case "anthropic":
      return {
        system: systemPrompt || undefined,
        messages: chatMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };

    case "openai":
    case "deepseek":
    case "groq": {
      // OpenAI-compatible format
      const formattedMessages: { role: string; content: string }[] = [];
      if (systemPrompt) {
        formattedMessages.push({ role: "system", content: systemPrompt });
      }
      formattedMessages.push(
        ...chatMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }))
      );
      return { messages: formattedMessages };
    }

    case "gemini": {
      // Gemini format
      const contents = chatMessages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      return {
        system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents,
      };
    }

    case "ollama":
      return {
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...chatMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
      };

    default:
      return { messages: chatMessages };
  }
}

// Stream chat with a provider via the backend API
export async function* streamChat(
  provider: LLMProvider,
  model: string,
  messages: LLMMessage[],
  systemPrompt?: string,
  apiKey?: string
): AsyncGenerator<{ type: "content" | "done" | "error"; content?: string; error?: string }> {
  try {
    const response = await fetch("/api/llm/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider,
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        systemPrompt,
        apiKey: apiKey || getStoredApiKey(provider),
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      yield { type: "error", error: error.error || `Request failed: ${response.status}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: "error", error: "No response body" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              yield { type: "content", content: parsed.content };
            }
            if (parsed.error) {
              yield { type: "error", error: parsed.error };
              return;
            }
          } catch {
            // Ignore parse errors for incomplete JSON
          }
        }
      }
    }

    yield { type: "done" };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Non-streaming chat (for simple use cases)
export async function chat(
  provider: LLMProvider,
  model: string,
  messages: LLMMessage[],
  systemPrompt?: string,
  apiKey?: string
): Promise<string> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      systemPrompt,
      apiKey: apiKey || getStoredApiKey(provider),
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.content;
}

// Fetch Ollama models dynamically
export async function fetchOllamaModels(): Promise<ModelInfo[]> {
  try {
    const response = await fetch("http://localhost:11434/api/tags");
    if (!response.ok) return [];

    const data = await response.json();
    return (data.models || []).map((m: { name: string; size: number }) => ({
      id: m.name,
      name: m.name,
      contextWindow: 8192, // Default, varies by model
      inputCost: 0,
      outputCost: 0,
    }));
  } catch {
    return [];
  }
}

// Check API key validity with a provider
export async function validateApiKey(provider: LLMProvider, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch("/api/llm/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey }),
    });
    const data = await response.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

// LLM Chat storage (localStorage-based for now)
const LLM_CHAT_STORAGE_KEY = "llm_chat_messages_";

export interface StoredLLMChat {
  id: string;
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  messages: LLMMessage[];
  createdAt: string;
  lastActivity: string;
}

export function getLLMChatMessages(chatId: string): LLMMessage[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(`${LLM_CHAT_STORAGE_KEY}${chatId}`);
  if (!stored) return [];
  try {
    const data = JSON.parse(stored);
    return data.messages || [];
  } catch {
    return [];
  }
}

export function saveLLMChatMessages(chatId: string, messages: LLMMessage[]): void {
  if (typeof window === "undefined") return;
  const existing = localStorage.getItem(`${LLM_CHAT_STORAGE_KEY}${chatId}`);
  let data: StoredLLMChat;
  if (existing) {
    data = JSON.parse(existing);
    data.messages = messages;
    data.lastActivity = new Date().toISOString();
  } else {
    data = {
      id: chatId,
      provider: "anthropic",
      model: "",
      messages,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
  }
  localStorage.setItem(`${LLM_CHAT_STORAGE_KEY}${chatId}`, JSON.stringify(data));
}

export function getLLMChat(chatId: string): StoredLLMChat | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(`${LLM_CHAT_STORAGE_KEY}${chatId}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function saveLLMChat(chat: StoredLLMChat): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${LLM_CHAT_STORAGE_KEY}${chat.id}`, JSON.stringify(chat));
}

export function deleteLLMChat(chatId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${LLM_CHAT_STORAGE_KEY}${chatId}`);
}

// Generate unique ID for messages
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
