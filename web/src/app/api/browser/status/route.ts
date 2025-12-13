import { NextResponse } from "next/server";

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL;

export async function GET() {
  // If no browser agent URL is configured, return 503
  if (!BROWSER_AGENT_URL) {
    return NextResponse.json(
      { error: "Browser agent not configured" },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${BROWSER_AGENT_URL}/api/status`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      // Treat 5xx errors as agent unavailable
      if (res.status >= 500) {
        return NextResponse.json(
          { error: "Browser agent unavailable" },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: `Browser agent returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect";
    return NextResponse.json(
      { error: `Browser agent unavailable: ${message}` },
      { status: 503 }
    );
  }
}
