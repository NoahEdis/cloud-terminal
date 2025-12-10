import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

function getApiKey(request: NextRequest): string | null {
  const headerKey = request.headers.get("x-elevenlabs-api-key");
  if (headerKey) return headerKey;
  return process.env.ELEVENLABS_API_KEY || null;
}

// List all agents
export async function GET(request: NextRequest) {
  try {
    const apiKey = getApiKey(request);

    if (!apiKey) {
      return NextResponse.json(
        { error: "ElevenLabs API key not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(`${ELEVENLABS_API_URL}/convai/agents`, {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("ElevenLabs API error:", error);
      return NextResponse.json(
        { error: `ElevenLabs API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching agents:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch agents" },
      { status: 500 }
    );
  }
}

// Create a new agent
export async function POST(request: NextRequest) {
  try {
    const apiKey = getApiKey(request);

    if (!apiKey) {
      return NextResponse.json(
        { error: "ElevenLabs API key not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { name, prompt, firstMessage, voiceId, language } = body;

    const response = await fetch(`${ELEVENLABS_API_URL}/convai/agents/create`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: {
              prompt: prompt || "You are a helpful assistant. Be concise and friendly.",
            },
            first_message: firstMessage || "Hello! How can I help you today?",
            language: language || "en",
          },
          tts: {
            voice_id: voiceId || "21m00Tcm4TlvDq8ikWAM", // Default: Rachel
          },
        },
        name: name || "Voice Assistant",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("ElevenLabs API error:", error);
      return NextResponse.json(
        { error: `ElevenLabs API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error creating agent:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create agent" },
      { status: 500 }
    );
  }
}
