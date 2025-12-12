import { NextRequest, NextResponse } from "next/server";

// Max lengths based on UI constraints:
// - Sidebar: 200-500px (default 288px)
// - Name: 12px font with truncate class - 50 chars shows well
// - Description: 11px italic with truncate - 120 chars is reasonable
const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 120;

export async function POST(request: NextRequest) {
  try {
    const { message, clientApiKey } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    // Use client-provided API key first, fall back to environment variable
    const anthropicApiKey = clientApiKey || process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return NextResponse.json(
        { error: "Anthropic API key not configured. Please add it in Settings." },
        { status: 500 }
      );
    }

    // Generate title using Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Based on this user message, generate a concise chat session name and description.

User message:
"""
${message.slice(0, 2000)}
"""

Requirements:
- name: A short, descriptive title (max ${MAX_NAME_LENGTH} chars). Should capture the main topic or task. Use Title Case.
- description: A brief one-line summary (max ${MAX_DESCRIPTION_LENGTH} chars). Should provide context about what the session is about.

Respond ONLY with valid JSON in this exact format:
{"name": "Your Title Here", "description": "Brief description of the session goal or topic."}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Anthropic API error:", error);
      return NextResponse.json(
        { error: "Title generation failed" },
        { status: response.status }
      );
    }

    const result = await response.json();
    const content = result.content?.[0]?.text;

    if (!content) {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 500 }
      );
    }

    // Parse the JSON response
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and truncate to max lengths
      const name = typeof parsed.name === "string"
        ? parsed.name.slice(0, MAX_NAME_LENGTH).trim()
        : "New Chat";
      const description = typeof parsed.description === "string"
        ? parsed.description.slice(0, MAX_DESCRIPTION_LENGTH).trim()
        : "";

      return NextResponse.json({ name, description });
    } catch (parseError) {
      console.error("Failed to parse AI response:", content, parseError);
      // Return a fallback based on the message
      const fallbackName = message.slice(0, 30).trim() + (message.length > 30 ? "..." : "");
      return NextResponse.json({
        name: fallbackName,
        description: "",
      });
    }
  } catch (error) {
    console.error("Title generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Title generation failed" },
      { status: 500 }
    );
  }
}
