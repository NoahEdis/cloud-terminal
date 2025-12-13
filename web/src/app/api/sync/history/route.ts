import { NextRequest, NextResponse } from "next/server";

interface SyncRun {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "success" | "error" | "cancelled";
  items_processed: number;
  items_created: number;
  items_updated: number;
  items_failed: number;
  error_message: string | null;
  triggered_by: string;
  options: Record<string, unknown>;
  duration_ms: number | null;
}

// GET /api/sync/history - Get sync history
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const limit = searchParams.get("limit") || "50";

    // Build query
    let queryUrl = `${supabaseUrl}/rest/v1/sync_history?select=*&order=started_at.desc&limit=${limit}`;
    if (source) {
      queryUrl += `&source=eq.${encodeURIComponent(source)}`;
    }

    const response = await fetch(queryUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Accept-Profile": "neo4j",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[sync/history] Failed to fetch:", error);
      return NextResponse.json(
        { error: `Failed to fetch sync history: ${response.statusText}` },
        { status: response.status }
      );
    }

    const history: SyncRun[] = await response.json();

    return NextResponse.json(history);
  } catch (error) {
    console.error("[sync/history] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sync history" },
      { status: 500 }
    );
  }
}
