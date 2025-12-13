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

// GET /api/sync/sources/:name - Get single sync source
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Query the v_sync_sources view for specific source
    const response = await fetch(
      `${supabaseUrl}/rest/v1/v_sync_sources?source=eq.${encodeURIComponent(name)}&select=*`,
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
      console.error(`[sync/sources/${name}] Failed to fetch:`, error);
      return NextResponse.json(
        { error: `Failed to fetch sync source: ${response.statusText}` },
        { status: response.status }
      );
    }

    const sources: SyncSource[] = await response.json();

    if (sources.length === 0) {
      return NextResponse.json(
        { error: `Sync source '${name}' not found` },
        { status: 404 }
      );
    }

    return NextResponse.json(sources[0]);
  } catch (error) {
    console.error("[sync/sources/name] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sync source" },
      { status: 500 }
    );
  }
}

// PATCH /api/sync/sources/:name - Update sync source configuration
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Update sync_configurations table
    const updateData: Record<string, unknown> = {};
    if (body.enabled !== undefined) updateData.enabled = body.enabled;
    if (body.schedule !== undefined) updateData.schedule = body.schedule;
    if (body.options !== undefined) updateData.options = body.options;

    const response = await fetch(
      `${supabaseUrl}/rest/v1/sync_configurations?source=eq.${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Profile": "neo4j",
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(updateData),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[sync/sources/${name}] Failed to update:`, error);
      return NextResponse.json(
        { error: `Failed to update sync source: ${response.statusText}` },
        { status: response.status }
      );
    }

    // Fetch the updated source from the view
    const viewResponse = await fetch(
      `${supabaseUrl}/rest/v1/v_sync_sources?source=eq.${encodeURIComponent(name)}&select=*`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Accept-Profile": "neo4j",
        },
      }
    );

    if (!viewResponse.ok) {
      return NextResponse.json({ success: true });
    }

    const sources: SyncSource[] = await viewResponse.json();
    return NextResponse.json(sources[0] || { success: true });
  } catch (error) {
    console.error("[sync/sources/name] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update sync source" },
      { status: 500 }
    );
  }
}
