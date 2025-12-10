import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

function getApiKey(request: NextRequest): string | null {
  const headerKey = request.headers.get("x-elevenlabs-api-key");
  if (headerKey) return headerKey;
  return process.env.ELEVENLABS_API_KEY || null;
}

// Get signed URL for connecting to an agent via WebSocket
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
    const { agentId } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: "agentId is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${ELEVENLABS_API_URL}/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
        },
      }
    );

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
    console.error("Error getting signed URL:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get signed URL" },
      { status: 500 }
    );
  }
}
