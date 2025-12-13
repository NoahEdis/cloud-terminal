import { NextRequest, NextResponse } from "next/server";

interface SyncSource {
  source: string;
  status: "idle" | "syncing" | "error";
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  total_items_synced: number;
  error_message: string | null;
  description: string | null;
  enabled: boolean;
  schedule: string | null;
  options: Record<string, unknown>;
  freshness: string;
}

// GET /api/sync/sources - Get all sync sources
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Query the v_sync_sources view from neo4j schema
    const response = await fetch(
      `${supabaseUrl}/rest/v1/v_sync_sources?select=*&order=source`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Accept-Profile": "neo4j",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("[sync/sources] Failed to fetch sources:", error);
      return NextResponse.json(
        { error: `Failed to fetch sync sources: ${response.statusText}` },
        { status: response.status }
      );
    }

    const sources: SyncSource[] = await response.json();

    return NextResponse.json(sources);
  } catch (error) {
    console.error("[sync/sources] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sync sources" },
      { status: 500 }
    );
  }
}
