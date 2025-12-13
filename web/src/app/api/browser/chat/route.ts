import { NextRequest, NextResponse } from "next/server";

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL;

export async function POST(request: NextRequest) {
  if (!BROWSER_AGENT_URL) {
    return NextResponse.json(
      { error: "Browser agent not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();

    const res = await fetch(`${BROWSER_AGENT_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status >= 500) {
        return NextResponse.json(
          { error: "Browser agent unavailable" },
          { status: 503 }
        );
      }
      const errorText = await res.text();
      return NextResponse.json(
        { error: errorText || `Browser agent returned ${res.status}` },
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
