import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

function getApiKey(request: NextRequest): string | null {
  const headerKey = request.headers.get("x-elevenlabs-api-key");
  if (headerKey) return headerKey;
  return process.env.ELEVENLABS_API_KEY || null;
}

// Generate a voice preview using TTS
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
    const { voiceId, text } = body;

    if (!voiceId) {
      return NextResponse.json(
        { error: "voiceId is required" },
        { status: 400 }
      );
    }

    // Default preview text if not provided
    const previewText = text || "Hello! This is a preview of my voice. I can help you with various tasks and have conversations in real-time.";

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: previewText,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
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

    // Get the audio as a buffer and return it
    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("Error generating voice preview:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate preview" },
      { status: 500 }
    );
  }
}
