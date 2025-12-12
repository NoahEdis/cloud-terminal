import { NextResponse } from "next/server";

const BROWSER_AGENT_URL =
  process.env.BROWSER_AGENT_URL || "http://localhost:3456";

export async function GET() {
  try {
    const res = await fetch(`${BROWSER_AGENT_URL}/api/models`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
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
