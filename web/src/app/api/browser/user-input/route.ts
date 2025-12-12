import { NextRequest, NextResponse } from "next/server";

const BROWSER_AGENT_URL =
  process.env.BROWSER_AGENT_URL || "http://localhost:3456";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const res = await fetch(`${BROWSER_AGENT_URL}/api/user-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
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
