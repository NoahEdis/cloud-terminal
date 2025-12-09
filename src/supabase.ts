/**
 * Supabase persistence layer for terminal sessions.
 *
 * Provides session storage and output logging to Supabase,
 * allowing sessions to survive server restarts.
 */

import type { ActivityState } from "./types.js";

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Machine identifier for multi-host setups
const HOST_ID = process.env.HOST_ID || process.env.HOSTNAME || "default";

// Batch output settings
const OUTPUT_BATCH_INTERVAL_MS = 2000; // Batch output every 2 seconds
const OUTPUT_BATCH_MAX_SIZE = 10000; // Max characters before forcing a flush

// Track pending output batches per session
const outputBatches = new Map<string, { data: string; timeout: NodeJS.Timeout | null }>();

/**
 * Check if Supabase persistence is configured and enabled.
 */
export function isSupabaseEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Supabase session row type matching the database schema.
 */
export interface SupabaseSession {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exit_code: number | null;
  activity_state: ActivityState;
  externally_controlled: boolean;
  created_at: string;
  last_activity: string;
  last_output_time: string;
  name: string | null;
  host_id: string | null;
}

/**
 * Make a request to Supabase REST API.
 */
async function supabaseRequest<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {}
): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1${path}`);
  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${error}`);
  }

  // For DELETE and some other operations, might return empty
  const text = await response.text();
  if (!text) return [] as T;
  return JSON.parse(text);
}

/**
 * Create a new session in Supabase.
 */
export async function createSession(session: {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  activityState: ActivityState;
  externallyControlled: boolean;
  createdAt: Date;
  lastActivity: Date;
  lastOutputTime: Date;
}): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    await supabaseRequest("POST", "/terminal_sessions", {
      body: {
        id: session.id,
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        status: session.status,
        activity_state: session.activityState,
        externally_controlled: session.externallyControlled,
        created_at: session.createdAt.toISOString(),
        last_activity: session.lastActivity.toISOString(),
        last_output_time: session.lastOutputTime.toISOString(),
        host_id: HOST_ID,
      },
    });
    console.log(`[Supabase] Created session ${session.id}`);
  } catch (error) {
    console.error(`[Supabase] Failed to create session ${session.id}:`, error);
  }
}

/**
 * Update session status in Supabase.
 */
export async function updateSessionStatus(
  sessionId: string,
  updates: {
    status?: "running" | "exited";
    exitCode?: number;
    activityState?: ActivityState;
    externallyControlled?: boolean;
    lastActivity?: Date;
    lastOutputTime?: Date;
  }
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    const body: Record<string, unknown> = {};
    if (updates.status !== undefined) body.status = updates.status;
    if (updates.exitCode !== undefined) body.exit_code = updates.exitCode;
    if (updates.activityState !== undefined) body.activity_state = updates.activityState;
    if (updates.externallyControlled !== undefined) body.externally_controlled = updates.externallyControlled;
    if (updates.lastActivity !== undefined) body.last_activity = updates.lastActivity.toISOString();
    if (updates.lastOutputTime !== undefined) body.last_output_time = updates.lastOutputTime.toISOString();

    await supabaseRequest("PATCH", "/terminal_sessions", {
      searchParams: { id: `eq.${sessionId}` },
      body,
    });
  } catch (error) {
    console.error(`[Supabase] Failed to update session ${sessionId}:`, error);
  }
}

/**
 * Rename a session in Supabase.
 * Updates both the session ID and any associated output records.
 */
export async function renameSession(oldId: string, newId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Flush any pending output for the old session first
  await flushOutputBatch(oldId);

  try {
    // Update the session ID
    await supabaseRequest("PATCH", "/terminal_sessions", {
      searchParams: { id: `eq.${oldId}` },
      body: { id: newId },
    });

    // Update output references to point to the new session ID
    await supabaseRequest("PATCH", "/terminal_output", {
      searchParams: { session_id: `eq.${oldId}` },
      body: { session_id: newId },
    });

    console.log(`[Supabase] Renamed session ${oldId} -> ${newId}`);
  } catch (error) {
    console.error(`[Supabase] Failed to rename session ${oldId} -> ${newId}:`, error);
  }
}

/**
 * Delete a session from Supabase.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Flush any pending output first
  await flushOutputBatch(sessionId);

  try {
    await supabaseRequest("DELETE", "/terminal_sessions", {
      searchParams: { id: `eq.${sessionId}` },
    });
    console.log(`[Supabase] Deleted session ${sessionId}`);
  } catch (error) {
    console.error(`[Supabase] Failed to delete session ${sessionId}:`, error);
  }
}

/**
 * Get all sessions for this host from Supabase.
 */
export async function getSessions(): Promise<SupabaseSession[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    return await supabaseRequest<SupabaseSession[]>("GET", "/terminal_sessions", {
      searchParams: {
        host_id: `eq.${HOST_ID}`,
        order: "created_at.desc",
      },
    });
  } catch (error) {
    console.error("[Supabase] Failed to get sessions:", error);
    return [];
  }
}

/**
 * Get a single session by ID.
 */
export async function getSession(sessionId: string): Promise<SupabaseSession | null> {
  if (!isSupabaseEnabled()) return null;

  try {
    const results = await supabaseRequest<SupabaseSession[]>("GET", "/terminal_sessions", {
      searchParams: { id: `eq.${sessionId}` },
    });
    return results[0] || null;
  } catch (error) {
    console.error(`[Supabase] Failed to get session ${sessionId}:`, error);
    return null;
  }
}

/**
 * Append terminal output for a session (batched for efficiency).
 */
export function appendOutput(sessionId: string, data: string): void {
  if (!isSupabaseEnabled()) return;

  let batch = outputBatches.get(sessionId);
  if (!batch) {
    batch = { data: "", timeout: null };
    outputBatches.set(sessionId, batch);
  }

  batch.data += data;

  // If batch is large enough, flush immediately
  if (batch.data.length >= OUTPUT_BATCH_MAX_SIZE) {
    flushOutputBatch(sessionId);
    return;
  }

  // Otherwise, schedule a flush
  if (!batch.timeout) {
    batch.timeout = setTimeout(() => {
      flushOutputBatch(sessionId);
    }, OUTPUT_BATCH_INTERVAL_MS);
  }
}

/**
 * Flush pending output batch for a session.
 */
async function flushOutputBatch(sessionId: string): Promise<void> {
  const batch = outputBatches.get(sessionId);
  if (!batch || !batch.data) {
    return;
  }

  // Clear the batch
  const data = batch.data;
  batch.data = "";
  if (batch.timeout) {
    clearTimeout(batch.timeout);
    batch.timeout = null;
  }

  try {
    // Get the next chunk sequence number
    const result = await supabaseRequest<{ chunk_seq: number }[]>(
      "GET",
      "/terminal_output",
      {
        searchParams: {
          session_id: `eq.${sessionId}`,
          select: "chunk_seq",
          order: "chunk_seq.desc",
          limit: "1",
        },
      }
    );

    const nextSeq = result.length > 0 ? result[0].chunk_seq + 1 : 0;

    // Insert the output chunk
    await supabaseRequest("POST", "/terminal_output", {
      body: {
        session_id: sessionId,
        chunk_seq: nextSeq,
        data,
      },
    });
  } catch (error) {
    console.error(`[Supabase] Failed to append output for session ${sessionId}:`, error);
  }
}

/**
 * Get the full output buffer for a session.
 */
export async function getSessionOutput(sessionId: string): Promise<string> {
  if (!isSupabaseEnabled()) return "";

  try {
    const results = await supabaseRequest<{ data: string }[]>(
      "GET",
      "/terminal_output",
      {
        searchParams: {
          session_id: `eq.${sessionId}`,
          select: "data",
          order: "chunk_seq.asc",
        },
      }
    );

    return results.map((r) => r.data).join("");
  } catch (error) {
    console.error(`[Supabase] Failed to get output for session ${sessionId}:`, error);
    return "";
  }
}

/**
 * Flush all pending output batches (call on shutdown).
 */
export async function flushAllOutput(): Promise<void> {
  const flushPromises: Promise<void>[] = [];
  for (const sessionId of outputBatches.keys()) {
    flushPromises.push(flushOutputBatch(sessionId));
  }
  await Promise.all(flushPromises);
}

/**
 * Mark all running sessions for this host as orphaned (call on startup).
 * This handles the case where the server crashed and sessions weren't properly closed.
 */
export async function markOrphanedSessions(): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    await supabaseRequest("PATCH", "/terminal_sessions", {
      searchParams: {
        host_id: `eq.${HOST_ID}`,
        status: "eq.running",
      },
      body: {
        status: "exited",
        activity_state: "exited",
        exit_code: -1, // Indicates abnormal termination
      },
    });
    console.log("[Supabase] Marked orphaned sessions as exited");
  } catch (error) {
    console.error("[Supabase] Failed to mark orphaned sessions:", error);
  }
}

/**
 * Initialize Supabase persistence.
 * Call this on server startup.
 */
export async function initSupabase(): Promise<void> {
  if (!isSupabaseEnabled()) {
    console.log("[Supabase] Persistence disabled (SUPABASE_URL not configured)");
    return;
  }

  console.log(`[Supabase] Persistence enabled for host: ${HOST_ID}`);

  // Mark any orphaned sessions from previous runs
  await markOrphanedSessions();
}

/**
 * Shutdown Supabase persistence.
 * Call this on server shutdown.
 */
export async function shutdownSupabase(): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Flush all pending output
  await flushAllOutput();
  console.log("[Supabase] Flushed all pending output");
}

// ============================================================================
// Tracked Credentials
// ============================================================================

/**
 * Tracked credential row type matching the database schema.
 */
export interface TrackedCredential {
  id: string;
  account_name: string;
  vault_id: string;
  vault_name: string;
  credential_name: string;
  item_id: string;
  field_label: string;
  service_name: string | null;
  notes: string | null;
  added_at: string;
  updated_at: string;
}

/**
 * Input type for creating a tracked credential.
 */
export interface TrackedCredentialInput {
  account_name: string;
  vault_id: string;
  vault_name: string;
  credential_name: string;
  item_id: string;
  field_label: string;
  service_name?: string;
  notes?: string;
}

/**
 * Get all tracked credentials.
 */
export async function getTrackedCredentials(): Promise<TrackedCredential[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    return await supabaseRequest<TrackedCredential[]>("GET", "/tracked_credentials", {
      searchParams: {
        order: "account_name.asc,credential_name.asc",
      },
    });
  } catch (error) {
    console.error("[Supabase] Failed to get tracked credentials:", error);
    return [];
  }
}

/**
 * Get tracked credentials for a specific account.
 */
export async function getTrackedCredentialsByAccount(accountName: string): Promise<TrackedCredential[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    return await supabaseRequest<TrackedCredential[]>("GET", "/tracked_credentials", {
      searchParams: {
        account_name: `eq.${accountName}`,
        order: "credential_name.asc",
      },
    });
  } catch (error) {
    console.error(`[Supabase] Failed to get tracked credentials for ${accountName}:`, error);
    return [];
  }
}

/**
 * Add a credential to tracking.
 */
export async function addTrackedCredential(credential: TrackedCredentialInput): Promise<TrackedCredential | null> {
  if (!isSupabaseEnabled()) return null;

  try {
    const results = await supabaseRequest<TrackedCredential[]>("POST", "/tracked_credentials", {
      body: {
        account_name: credential.account_name,
        vault_id: credential.vault_id,
        vault_name: credential.vault_name,
        credential_name: credential.credential_name,
        item_id: credential.item_id,
        field_label: credential.field_label,
        service_name: credential.service_name || null,
        notes: credential.notes || null,
      },
    });
    console.log(`[Supabase] Added tracked credential: ${credential.account_name}/${credential.credential_name}`);
    return results[0] || null;
  } catch (error) {
    console.error(`[Supabase] Failed to add tracked credential:`, error);
    throw error;
  }
}

/**
 * Add multiple credentials to tracking at once.
 */
export async function addTrackedCredentials(credentials: TrackedCredentialInput[]): Promise<TrackedCredential[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    const results = await supabaseRequest<TrackedCredential[]>("POST", "/tracked_credentials", {
      body: credentials.map(cred => ({
        account_name: cred.account_name,
        vault_id: cred.vault_id,
        vault_name: cred.vault_name,
        credential_name: cred.credential_name,
        item_id: cred.item_id,
        field_label: cred.field_label,
        service_name: cred.service_name || null,
        notes: cred.notes || null,
      })),
    });
    console.log(`[Supabase] Added ${credentials.length} tracked credentials`);
    return results;
  } catch (error) {
    console.error(`[Supabase] Failed to add tracked credentials:`, error);
    throw error;
  }
}

/**
 * Remove a credential from tracking by ID.
 */
export async function removeTrackedCredential(id: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    await supabaseRequest("DELETE", "/tracked_credentials", {
      searchParams: { id: `eq.${id}` },
    });
    console.log(`[Supabase] Removed tracked credential: ${id}`);
  } catch (error) {
    console.error(`[Supabase] Failed to remove tracked credential ${id}:`, error);
    throw error;
  }
}

/**
 * Update a tracked credential's metadata.
 */
export async function updateTrackedCredential(
  id: string,
  updates: { service_name?: string; notes?: string }
): Promise<TrackedCredential | null> {
  if (!isSupabaseEnabled()) return null;

  try {
    const results = await supabaseRequest<TrackedCredential[]>("PATCH", "/tracked_credentials", {
      searchParams: { id: `eq.${id}` },
      body: updates,
    });
    return results[0] || null;
  } catch (error) {
    console.error(`[Supabase] Failed to update tracked credential ${id}:`, error);
    throw error;
  }
}

/**
 * Check if a credential is already tracked.
 */
export async function isCredentialTracked(accountName: string, credentialName: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;

  try {
    const results = await supabaseRequest<TrackedCredential[]>("GET", "/tracked_credentials", {
      searchParams: {
        account_name: `eq.${accountName}`,
        credential_name: `eq.${credentialName}`,
        select: "id",
      },
    });
    return results.length > 0;
  } catch (error) {
    console.error(`[Supabase] Failed to check if credential is tracked:`, error);
    return false;
  }
}

// ============================================================================
// User Settings
// ============================================================================

/**
 * User settings row type matching the database schema.
 */
export interface UserSettings {
  id: string;
  user_id: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_ID = "default";

/**
 * Get user settings from Supabase.
 */
export async function getSettings(userId: string = DEFAULT_USER_ID): Promise<Record<string, unknown>> {
  if (!isSupabaseEnabled()) return {};

  try {
    const results = await supabaseRequest<UserSettings[]>("GET", "/user_settings", {
      searchParams: {
        user_id: `eq.${userId}`,
        select: "settings",
      },
    });
    return results[0]?.settings || {};
  } catch (error) {
    console.error("[Supabase] Failed to get user settings:", error);
    return {};
  }
}

/**
 * Save user settings to Supabase.
 */
export async function saveSettings(settings: Record<string, unknown>, userId: string = DEFAULT_USER_ID): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    // Upsert settings using POST with ON CONFLICT
    await supabaseRequest("POST", "/user_settings", {
      body: {
        user_id: userId,
        settings,
        updated_at: new Date().toISOString(),
      },
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
    });
    console.log(`[Supabase] Saved user settings for ${userId}`);
  } catch (error) {
    console.error("[Supabase] Failed to save user settings:", error);
    throw error;
  }
}

/**
 * Update specific settings keys (merges with existing settings).
 */
export async function updateSettings(updates: Record<string, unknown>, userId: string = DEFAULT_USER_ID): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    const existingSettings = await getSettings(userId);
    const mergedSettings = { ...existingSettings, ...updates };
    await saveSettings(mergedSettings, userId);
  } catch (error) {
    console.error("[Supabase] Failed to update user settings:", error);
    throw error;
  }
}

// ============================================================================
// Brain Knowledge Nodes (using neo4j.graph_nodes)
// ============================================================================

/**
 * Brain node type classification.
 * These map to Neo4j labels: ["BrainNode", "<NodeType>"]
 */
export type BrainNodeType = "reasoning" | "preference" | "workflow" | "principle" | "pattern" | "reference";

/**
 * Brain source type.
 */
export type BrainSourceType = "github" | "manual" | "inferred" | "imported";

/**
 * Brain node as stored in neo4j.graph_nodes.
 * The properties JSONB contains all brain-specific fields.
 */
interface GraphNodeRow {
  id: string;
  neo4j_id: number | null;
  external_id: string | null;
  labels: string[];
  properties: {
    title: string;
    content: string;
    summary?: string;
    node_type: BrainNodeType;
    source_type: BrainSourceType;
    source_url?: string;
    source_path?: string;
    source_commit?: string;
    category?: string;
    tags?: string[];
    parent_id?: string;
    related_ids?: string[];
    priority?: number;
    is_active?: boolean;
    last_synced_at?: string;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Brain node type matching the frontend/API interface.
 */
export interface BrainNode {
  id: string;
  node_type: BrainNodeType;
  title: string;
  content: string;
  summary: string | null;
  source_type: BrainSourceType;
  source_url: string | null;
  source_path: string | null;
  source_commit: string | null;
  category: string | null;
  tags: string[];
  parent_id: string | null;
  related_ids: string[];
  priority: number;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input type for creating a brain node.
 */
export interface BrainNodeInput {
  node_type: BrainNodeType;
  title: string;
  content: string;
  summary?: string;
  source_type?: BrainSourceType;
  source_url?: string;
  source_path?: string;
  source_commit?: string;
  category?: string;
  tags?: string[];
  parent_id?: string;
  related_ids?: string[];
  priority?: number;
}

/**
 * Input type for updating a brain node.
 */
export interface BrainNodeUpdate {
  node_type?: BrainNodeType;
  title?: string;
  content?: string;
  summary?: string;
  source_type?: BrainSourceType;
  source_url?: string;
  source_path?: string;
  source_commit?: string;
  category?: string;
  tags?: string[];
  parent_id?: string | null;
  related_ids?: string[];
  priority?: number;
  is_active?: boolean;
}

/**
 * Convert a GraphNodeRow to BrainNode.
 */
function graphNodeToBrainNode(row: GraphNodeRow): BrainNode {
  const props = row.properties;
  return {
    id: row.id,
    node_type: props.node_type,
    title: props.title,
    content: props.content,
    summary: props.summary || null,
    source_type: props.source_type || "manual",
    source_url: props.source_url || null,
    source_path: props.source_path || null,
    source_commit: props.source_commit || null,
    category: props.category || null,
    tags: props.tags || [],
    parent_id: props.parent_id || null,
    related_ids: props.related_ids || [],
    priority: props.priority ?? 0,
    is_active: props.is_active ?? true,
    last_synced_at: props.last_synced_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Generate external_id for brain nodes.
 */
function generateBrainExternalId(nodeType: BrainNodeType, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 50);
  return `brain:${nodeType}:${slug}`;
}

/**
 * Make a request to the neo4j schema in Supabase.
 */
async function neo4jRequest<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {}
): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1${path}`);
  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      "Accept-Profile": "neo4j",
      "Content-Profile": "neo4j",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase neo4j request failed (${response.status}): ${error}`);
  }

  const text = await response.text();
  if (!text) return [] as T;
  return JSON.parse(text);
}

/**
 * Get all brain nodes.
 */
export async function getBrainNodes(filters?: {
  node_type?: BrainNodeType;
  category?: string;
  source_type?: BrainSourceType;
  is_active?: boolean;
}): Promise<BrainNode[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    const searchParams: Record<string, string> = {
      "labels": "cs.{BrainNode}",
      order: "updated_at.desc",
    };

    // Build filter conditions for properties JSONB
    const conditions: string[] = [];
    if (filters?.node_type) {
      conditions.push(`properties->node_type.eq.${filters.node_type}`);
    }
    if (filters?.category) {
      conditions.push(`properties->category.eq.${filters.category}`);
    }
    if (filters?.source_type) {
      conditions.push(`properties->source_type.eq.${filters.source_type}`);
    }
    if (filters?.is_active !== undefined) {
      conditions.push(`properties->is_active.eq.${filters.is_active}`);
    }

    // If we have additional filters, they need to be combined differently
    // For now, we'll filter in-memory after fetching
    const rows = await neo4jRequest<GraphNodeRow[]>("GET", "/graph_nodes", { searchParams });

    let nodes = rows.map(graphNodeToBrainNode);

    // Apply filters
    if (filters?.node_type) {
      nodes = nodes.filter(n => n.node_type === filters.node_type);
    }
    if (filters?.category) {
      nodes = nodes.filter(n => n.category === filters.category);
    }
    if (filters?.source_type) {
      nodes = nodes.filter(n => n.source_type === filters.source_type);
    }
    if (filters?.is_active !== undefined) {
      nodes = nodes.filter(n => n.is_active === filters.is_active);
    }

    // Sort by priority desc, then created_at desc
    nodes.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return nodes;
  } catch (error) {
    console.error("[Supabase] Failed to get brain nodes:", error);
    return [];
  }
}

/**
 * Get a brain node by ID.
 */
export async function getBrainNode(id: string): Promise<BrainNode | null> {
  if (!isSupabaseEnabled()) return null;

  try {
    const results = await neo4jRequest<GraphNodeRow[]>("GET", "/graph_nodes", {
      searchParams: {
        id: `eq.${id}`,
        "labels": "cs.{BrainNode}",
      },
    });
    if (results.length === 0) return null;
    return graphNodeToBrainNode(results[0]);
  } catch (error) {
    console.error(`[Supabase] Failed to get brain node ${id}:`, error);
    return null;
  }
}

/**
 * Create a new brain node.
 */
export async function createBrainNode(input: BrainNodeInput): Promise<BrainNode | null> {
  if (!isSupabaseEnabled()) return null;

  try {
    const nodeType = input.node_type;
    const nodeTypeLabel = nodeType.charAt(0).toUpperCase() + nodeType.slice(1);

    const properties = {
      title: input.title,
      content: input.content,
      summary: input.summary || null,
      node_type: input.node_type,
      source_type: input.source_type || "manual",
      source_url: input.source_url || null,
      source_path: input.source_path || null,
      source_commit: input.source_commit || null,
      category: input.category || null,
      tags: input.tags || [],
      parent_id: input.parent_id || null,
      related_ids: input.related_ids || [],
      priority: input.priority ?? 0,
      is_active: true,
    };

    const results = await neo4jRequest<GraphNodeRow[]>("POST", "/graph_nodes", {
      body: {
        external_id: generateBrainExternalId(input.node_type, input.title),
        labels: ["BrainNode", nodeTypeLabel],
        properties,
      },
    });

    console.log(`[Supabase] Created brain node: ${input.title}`);
    return results[0] ? graphNodeToBrainNode(results[0]) : null;
  } catch (error) {
    console.error("[Supabase] Failed to create brain node:", error);
    throw error;
  }
}

/**
 * Update a brain node.
 */
export async function updateBrainNode(id: string, updates: BrainNodeUpdate): Promise<BrainNode | null> {
  if (!isSupabaseEnabled()) return null;

  try {
    // First get the existing node
    const existing = await getBrainNode(id);
    if (!existing) return null;

    // Merge properties
    const nodeType = updates.node_type || existing.node_type;
    const nodeTypeLabel = nodeType.charAt(0).toUpperCase() + nodeType.slice(1);

    const properties = {
      title: updates.title ?? existing.title,
      content: updates.content ?? existing.content,
      summary: updates.summary !== undefined ? updates.summary : existing.summary,
      node_type: nodeType,
      source_type: updates.source_type ?? existing.source_type,
      source_url: updates.source_url !== undefined ? updates.source_url : existing.source_url,
      source_path: updates.source_path !== undefined ? updates.source_path : existing.source_path,
      source_commit: updates.source_commit !== undefined ? updates.source_commit : existing.source_commit,
      category: updates.category !== undefined ? updates.category : existing.category,
      tags: updates.tags ?? existing.tags,
      parent_id: updates.parent_id !== undefined ? updates.parent_id : existing.parent_id,
      related_ids: updates.related_ids ?? existing.related_ids,
      priority: updates.priority ?? existing.priority,
      is_active: updates.is_active ?? existing.is_active,
      last_synced_at: existing.last_synced_at,
    };

    const results = await neo4jRequest<GraphNodeRow[]>("PATCH", "/graph_nodes", {
      searchParams: { id: `eq.${id}` },
      body: {
        labels: ["BrainNode", nodeTypeLabel],
        properties,
      },
    });

    console.log(`[Supabase] Updated brain node: ${id}`);
    return results[0] ? graphNodeToBrainNode(results[0]) : null;
  } catch (error) {
    console.error(`[Supabase] Failed to update brain node ${id}:`, error);
    throw error;
  }
}

/**
 * Delete a brain node.
 */
export async function deleteBrainNode(id: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  try {
    await neo4jRequest("DELETE", "/graph_nodes", {
      searchParams: { id: `eq.${id}` },
    });
    console.log(`[Supabase] Deleted brain node: ${id}`);
  } catch (error) {
    console.error(`[Supabase] Failed to delete brain node ${id}:`, error);
    throw error;
  }
}

/**
 * Search brain nodes by text.
 */
export async function searchBrainNodes(query: string): Promise<BrainNode[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    // Get all brain nodes and filter in memory for text search
    const allNodes = await getBrainNodes({ is_active: true });
    const queryLower = query.toLowerCase();

    return allNodes.filter(node =>
      node.title.toLowerCase().includes(queryLower) ||
      node.content.toLowerCase().includes(queryLower) ||
      (node.summary && node.summary.toLowerCase().includes(queryLower)) ||
      node.tags.some(tag => tag.toLowerCase().includes(queryLower))
    );
  } catch (error) {
    console.error("[Supabase] Failed to search brain nodes:", error);
    return [];
  }
}

/**
 * Get all unique categories for brain nodes.
 */
export async function getBrainCategories(): Promise<string[]> {
  if (!isSupabaseEnabled()) return [];

  try {
    const nodes = await getBrainNodes({ is_active: true });
    const categories = new Set(nodes.map(n => n.category).filter((c): c is string => c !== null));
    return Array.from(categories).sort();
  } catch (error) {
    console.error("[Supabase] Failed to get brain categories:", error);
    return [];
  }
}

/**
 * Get brain nodes statistics.
 */
export async function getBrainStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  bySourceType: Record<string, number>;
}> {
  if (!isSupabaseEnabled()) {
    return { total: 0, byType: {}, byCategory: {}, bySourceType: {} };
  }

  try {
    const nodes = await getBrainNodes({ is_active: true });

    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const bySourceType: Record<string, number> = {};

    for (const node of nodes) {
      byType[node.node_type] = (byType[node.node_type] || 0) + 1;
      if (node.category) {
        byCategory[node.category] = (byCategory[node.category] || 0) + 1;
      }
      bySourceType[node.source_type] = (bySourceType[node.source_type] || 0) + 1;
    }

    return {
      total: nodes.length,
      byType,
      byCategory,
      bySourceType,
    };
  } catch (error) {
    console.error("[Supabase] Failed to get brain stats:", error);
    return { total: 0, byType: {}, byCategory: {}, bySourceType: {} };
  }
}
