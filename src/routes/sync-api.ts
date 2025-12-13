/**
 * Sync API routes for managing data synchronization.
 *
 * Provides endpoints for:
 * - Listing sync sources and their status
 * - Triggering manual syncs
 * - Viewing sync history
 * - Configuring sync options
 */

import { Hono } from "hono";
import * as supabase from "../supabase.js";

export const syncApi = new Hono();

// ============================================================================
// Sync Sources
// ============================================================================

/**
 * GET /sources - List all sync sources with status
 * Returns combined data from sync_state and sync_configurations
 */
syncApi.get("/sources", async (c) => {
  try {
    const sources = await supabase.getSyncSources();
    return c.json(sources);
  } catch (err) {
    console.error("[Sync API] Failed to get sync sources:", err);
    return c.json({ error: "Failed to fetch sync sources" }, 500);
  }
});

/**
 * GET /sources/:name - Get single sync source details
 */
syncApi.get("/sources/:name", async (c) => {
  const name = c.req.param("name");

  try {
    const source = await supabase.getSyncSourceByName(name);
    if (!source) {
      return c.json({ error: "Sync source not found" }, 404);
    }
    return c.json(source);
  } catch (err) {
    console.error(`[Sync API] Failed to get sync source ${name}:`, err);
    return c.json({ error: "Failed to fetch sync source" }, 500);
  }
});

/**
 * POST /sources/:name/trigger - Trigger a manual sync
 * Body: { options?: Record<string, unknown> }
 * Returns: { run_id, status: 'running' }
 */
syncApi.post("/sources/:name/trigger", async (c) => {
  const name = c.req.param("name");

  try {
    // Parse optional body for sync options
    let options: Record<string, unknown> = {};
    try {
      const body = await c.req.json();
      options = body.options || {};
    } catch {
      // Empty body is fine
    }

    // Check if source exists
    const source = await supabase.getSyncSourceByName(name);
    if (!source) {
      return c.json({ error: "Sync source not found" }, 404);
    }

    // Check if already syncing
    if (source.status === "syncing") {
      return c.json({ error: "Sync already in progress" }, 409);
    }

    // Trigger the sync
    const run = await supabase.triggerSync(name, options);
    return c.json(run, 202);
  } catch (err) {
    console.error(`[Sync API] Failed to trigger sync for ${name}:`, err);
    const message = err instanceof Error ? err.message : "Failed to trigger sync";
    return c.json({ error: message }, 500);
  }
});

/**
 * PATCH /sources/:name/config - Update sync configuration
 * Body: { enabled?: boolean, schedule?: string, options?: Record<string, unknown> }
 */
syncApi.patch("/sources/:name/config", async (c) => {
  const name = c.req.param("name");

  try {
    const body = await c.req.json<{
      enabled?: boolean;
      schedule?: string | null;
      options?: Record<string, unknown>;
    }>();

    const updated = await supabase.updateSyncConfig(name, body);
    if (!updated) {
      return c.json({ error: "Sync source not found" }, 404);
    }

    return c.json(updated);
  } catch (err) {
    console.error(`[Sync API] Failed to update config for ${name}:`, err);
    return c.json({ error: "Failed to update configuration" }, 500);
  }
});

// ============================================================================
// Sync History
// ============================================================================

/**
 * GET /history - Get sync run history
 * Query params: source, limit, offset
 */
syncApi.get("/history", async (c) => {
  try {
    const source = c.req.query("source");
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const history = await supabase.getSyncHistory({ source, limit, offset });
    return c.json(history);
  } catch (err) {
    console.error("[Sync API] Failed to get sync history:", err);
    return c.json({ error: "Failed to fetch sync history" }, 500);
  }
});

/**
 * GET /history/:id - Get single sync run details
 */
syncApi.get("/history/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const run = await supabase.getSyncRunById(id);
    if (!run) {
      return c.json({ error: "Sync run not found" }, 404);
    }
    return c.json(run);
  } catch (err) {
    console.error(`[Sync API] Failed to get sync run ${id}:`, err);
    return c.json({ error: "Failed to fetch sync run" }, 500);
  }
});

/**
 * POST /history/:id/cancel - Cancel a running sync
 */
syncApi.post("/history/:id/cancel", async (c) => {
  const id = c.req.param("id");

  try {
    const run = await supabase.getSyncRunById(id);
    if (!run) {
      return c.json({ error: "Sync run not found" }, 404);
    }

    if (run.status !== "running") {
      return c.json({ error: "Sync is not running" }, 400);
    }

    await supabase.cancelSyncRun(id);
    return c.json({ success: true });
  } catch (err) {
    console.error(`[Sync API] Failed to cancel sync run ${id}:`, err);
    return c.json({ error: "Failed to cancel sync" }, 500);
  }
});
