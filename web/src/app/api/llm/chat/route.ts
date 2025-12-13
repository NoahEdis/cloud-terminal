import { NextRequest } from "next/server";

type LLMProvider = "anthropic" | "openai" | "gemini" | "deepseek" | "groq" | "ollama";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatRequest {
  provider: LLMProvider;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  apiKey?: string;
  stream?: boolean;
  temperature?: number;
}

// Provider-specific API configurations
const PROVIDER_CONFIGS = {
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    version: "2023-06-01",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
  },
  ollama: {
    baseUrl: "http://localhost:11434/api/chat",
  },
};

// Get API key from environment or request
function getApiKey(provider: LLMProvider, requestKey?: string): string | null {
  if (requestKey) return requestKey;

  const envKeys: Record<LLMProvider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    groq: "GROQ_API_KEY",
    ollama: "", // No API key needed
  };

  return process.env[envKeys[provider]] || null;
}

// Format request for Anthropic
function formatAnthropicRequest(
  messages: ChatMessage[],
  model: string,
  systemPrompt?: string,
  temperature?: number,
  stream?: boolean
) {
  const chatMessages = messages.filter((m) => m.role !== "system");
  return {
    model,
    max_tokens: 8192,
    stream: stream ?? true,
    temperature: temperature ?? 0.7,
    ...(systemPrompt && { system: systemPrompt }),
    messages: chatMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}

// Format request for OpenAI-compatible APIs (OpenAI, DeepSeek, Groq)
function formatOpenAIRequest(
  messages: ChatMessage[],
  model: string,
  systemPrompt?: string,
  temperature?: number,
  stream?: boolean
) {
  const formattedMessages: ChatMessage[] = [];
  if (systemPrompt) {
    formattedMessages.push({ role: "system", content: systemPrompt });
  }
  formattedMessages.push(...messages.filter((m) => m.role !== "system"));

  return {
    model,
    stream: stream ?? true,
    temperature: temperature ?? 0.7,
    messages: formattedMessages,
  };
}

// Format request for Gemini
function formatGeminiRequest(
  messages: ChatMessage[],
  systemPrompt?: string,
  temperature?: number
) {
  const chatMessages = messages.filter((m) => m.role !== "system");
  const contents = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return {
    contents,
    ...(systemPrompt && {
      system_instruction: { parts: [{ text: systemPrompt }] },
    }),
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: 8192,
    },
  };
}

// Format request for Ollama
function formatOllamaRequest(
  messages: ChatMessage[],
  model: string,
  systemPrompt?: string,
  stream?: boolean
) {
  const formattedMessages: ChatMessage[] = [];
  if (systemPrompt) {
    formattedMessages.push({ role: "system", content: systemPrompt });
  }
  formattedMessages.push(...messages.filter((m) => m.role !== "system"));

  return {
    model,
    stream: stream ?? true,
    messages: formattedMessages,
  };
}

// Handle streaming response from Anthropic
async function* streamAnthropicResponse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Handle streaming response from OpenAI-compatible APIs
async function* streamOpenAIResponse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Handle streaming response from Gemini
async function* streamGeminiResponse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            yield text;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Handle streaming response from Ollama
async function* streamOllamaResponse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { provider, model, messages, systemPrompt, apiKey, stream = true, temperature } = body;

    // Validate required fields
    if (!provider || !model || !messages) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: provider, model, messages" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get API key
    const key = getApiKey(provider, apiKey);
    if (!key && provider !== "ollama") {
      return new Response(
        JSON.stringify({
          error: `API key not configured for ${provider}. Please add it in Settings.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build provider-specific request
    let url: string;
    let headers: Record<string, string>;
    let requestBody: unknown;

    switch (provider) {
      case "anthropic":
        url = PROVIDER_CONFIGS.anthropic.baseUrl;
        headers = {
          "Content-Type": "application/json",
          "x-api-key": key!,
          "anthropic-version": PROVIDER_CONFIGS.anthropic.version,
        };
        requestBody = formatAnthropicRequest(messages, model, systemPrompt, temperature, stream);
        break;

      case "openai":
        url = PROVIDER_CONFIGS.openai.baseUrl;
        headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        };
        requestBody = formatOpenAIRequest(messages, model, systemPrompt, temperature, stream);
        break;

      case "gemini": {
        const action = stream ? "streamGenerateContent" : "generateContent";
        url = `${PROVIDER_CONFIGS.gemini.baseUrl}/${model}:${action}?key=${key}${stream ? "&alt=sse" : ""}`;
        headers = { "Content-Type": "application/json" };
        requestBody = formatGeminiRequest(messages, systemPrompt, temperature);
        break;
      }

      case "deepseek":
        url = PROVIDER_CONFIGS.deepseek.baseUrl;
        headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        };
        requestBody = formatOpenAIRequest(messages, model, systemPrompt, temperature, stream);
        break;

      case "groq":
        url = PROVIDER_CONFIGS.groq.baseUrl;
        headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        };
        requestBody = formatOpenAIRequest(messages, model, systemPrompt, temperature, stream);
        break;

      case "ollama":
        url = PROVIDER_CONFIGS.ollama.baseUrl;
        headers = { "Content-Type": "application/json" };
        requestBody = formatOllamaRequest(messages, model, systemPrompt, stream);
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unsupported provider: ${provider}` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // Make the request
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${provider} API error:`, errorText);
      return new Response(
        JSON.stringify({
          error: `${provider} API error: ${response.status} ${response.statusText}`,
          details: errorText,
        }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle non-streaming response
    if (!stream) {
      const data = await response.json();
      let content = "";

      switch (provider) {
        case "anthropic":
          content = data.content?.[0]?.text || "";
          break;
        case "openai":
        case "deepseek":
        case "groq":
          content = data.choices?.[0]?.message?.content || "";
          break;
        case "gemini":
          content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          break;
        case "ollama":
          content = data.message?.content || "";
          break;
      }

      return new Response(
        JSON.stringify({ content }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle streaming response
    const encoder = new TextEncoder();

    // Select the appropriate streaming handler
    let streamHandler: AsyncGenerator<string>;
    switch (provider) {
      case "anthropic":
        streamHandler = streamAnthropicResponse(response);
        break;
      case "openai":
      case "deepseek":
      case "groq":
        streamHandler = streamOpenAIResponse(response);
        break;
      case "gemini":
        streamHandler = streamGeminiResponse(response);
        break;
      case "ollama":
        streamHandler = streamOllamaResponse(response);
        break;
      default:
        streamHandler = streamOpenAIResponse(response);
    }

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamHandler) {
            const data = JSON.stringify({ content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Stream error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("LLM chat error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
