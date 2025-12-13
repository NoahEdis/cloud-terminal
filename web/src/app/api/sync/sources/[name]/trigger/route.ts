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
}

// POST /api/sync/sources/:name/trigger - Trigger a sync
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const body = await request.json().catch(() => ({}));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Create a sync_history record
    const runData = {
      source: name,
      status: "running",
      triggered_by: "manual",
      options: body.options || {},
    };

    const createResponse = await fetch(
      `${supabaseUrl}/rest/v1/sync_history`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Profile": "neo4j",
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(runData),
      }
    );

    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.error(`[sync/trigger/${name}] Failed to create run:`, error);
      return NextResponse.json(
        { error: `Failed to create sync run: ${createResponse.statusText}` },
        { status: createResponse.status }
      );
    }

    const runs: SyncRun[] = await createResponse.json();
    const run = runs[0];

    // Update sync_state to "syncing"
    await fetch(
      `${supabaseUrl}/rest/v1/sync_state?source=eq.${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Profile": "neo4j",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sync_status: "syncing" }),
      }
    );

    // Call the trigger_sync Edge Function
    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/trigger_sync`;

    fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: name,
        run_id: run.id,
        options: body.options || {},
      }),
    }).catch((err) => {
      console.error(`[sync/trigger/${name}] Edge function call failed:`, err);
    });

    return NextResponse.json(run);
  } catch (error) {
    console.error("[sync/trigger] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to trigger sync" },
      { status: 500 }
    );
  }
}
