import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

function getApiKey(request: NextRequest): string | null {
  // Check for API key in header first (client can provide)
  const headerKey = request.headers.get("x-elevenlabs-api-key");
  if (headerKey) return headerKey;

  // Fall back to environment variable
  return process.env.ELEVENLABS_API_KEY || null;
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = getApiKey(request);

    if (!apiKey) {
      return NextResponse.json(
        { error: "ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in environment or settings." },
        { status: 500 }
      );
    }

    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
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
    console.error("Error fetching voices:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch voices" },
      { status: 500 }
    );
  }
}
