import { NextRequest, NextResponse } from "next/server";

type LLMProvider = "anthropic" | "openai" | "gemini" | "deepseek" | "groq" | "ollama";

interface ValidateRequest {
  provider: LLMProvider;
  apiKey: string;
}

// Validate API key by making a minimal request to each provider
export async function POST(request: NextRequest) {
  try {
    const body: ValidateRequest = await request.json();
    const { provider, apiKey } = body;

    if (!provider || !apiKey) {
      return NextResponse.json(
        { valid: false, error: "Missing provider or apiKey" },
        { status: 400 }
      );
    }

    // Ollama doesn't need validation
    if (provider === "ollama") {
      try {
        const response = await fetch("http://localhost:11434/api/tags");
        return NextResponse.json({ valid: response.ok });
      } catch {
        return NextResponse.json({ valid: false, error: "Ollama not running" });
      }
    }

    let isValid = false;
    let error = "";

    switch (provider) {
      case "anthropic": {
        // Use messages endpoint with minimal request
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        // Even a 400 (invalid model, etc) means the key works
        isValid = response.status !== 401 && response.status !== 403;
        if (!isValid) {
          const data = await response.json().catch(() => ({}));
          error = data.error?.message || "Invalid API key";
        }
        break;
      }

      case "openai": {
        // List models endpoint is a simple auth check
        const response = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        isValid = response.ok;
        if (!isValid) {
          const data = await response.json().catch(() => ({}));
          error = data.error?.message || "Invalid API key";
        }
        break;
      }

      case "gemini": {
        // List models with the API key
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        isValid = response.ok;
        if (!isValid) {
          const data = await response.json().catch(() => ({}));
          error = data.error?.message || "Invalid API key";
        }
        break;
      }

      case "deepseek": {
        // Use chat completions with minimal request
        const response = await fetch("https://api.deepseek.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        isValid = response.ok;
        if (!isValid) {
          const data = await response.json().catch(() => ({}));
          error = data.error?.message || "Invalid API key";
        }
        break;
      }

      case "groq": {
        // List models endpoint
        const response = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        isValid = response.ok;
        if (!isValid) {
          const data = await response.json().catch(() => ({}));
          error = data.error?.message || "Invalid API key";
        }
        break;
      }

      default:
        return NextResponse.json(
          { valid: false, error: `Unknown provider: ${provider}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ valid: isValid, ...(error && { error }) });
  } catch (error) {
    console.error("API key validation error:", error);
    return NextResponse.json(
      {
        valid: false,
        error: error instanceof Error ? error.message : "Validation failed",
      },
      { status: 500 }
    );
  }
}
