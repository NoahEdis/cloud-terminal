/**
 * Types for sync management.
 */

// ============================================================================
// Sync Status Types
// ============================================================================

export type SyncStatus = "idle" | "syncing" | "error";
export type SyncFreshness = "never" | "recent" | "today" | "this week" | "stale";
export type SyncTrigger = "manual" | "cron" | "webhook";
export type SyncRunStatus = "running" | "success" | "error" | "cancelled";

// ============================================================================
// Sync Source
// ============================================================================

/**
 * A sync source with combined status and configuration.
 * Comes from the v_sync_sources view.
 */
export interface SyncSource {
  source: string;
  description: string | null;
  status: SyncStatus;
  freshness: SyncFreshness;
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  total_items_synced: number;
  error_message: string | null;
  enabled: boolean;
  schedule: string | null;
  options: Record<string, unknown>;
}

/**
 * Configuration update for a sync source.
 */
export interface SyncSourceConfig {
  enabled?: boolean;
  schedule?: string | null;
  options?: Record<string, unknown>;
}

// ============================================================================
// Sync Run (History)
// ============================================================================

/**
 * A single sync run record from sync_history.
 */
export interface SyncRun {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  status: SyncRunStatus;
  items_processed: number;
  items_created: number;
  items_updated: number;
  items_failed: number;
  error_message: string | null;
  triggered_by: SyncTrigger;
  options: Record<string, unknown>;
  duration_ms: number | null;
}

// ============================================================================
// Source Metadata
// ============================================================================

/**
 * Static metadata about sync sources.
 * Used for display purposes.
 */
export interface SyncSourceMeta {
  name: string;
  displayName: string;
  description: string;
  icon: string; // lucide icon name
  category: "communication" | "productivity" | "automation" | "google";
  supportsWebhook: boolean;
  supportsCron: boolean;
  configFields?: SyncConfigField[];
}

/**
 * A configuration field for a sync source.
 */
export interface SyncConfigField {
  key: string;
  label: string;
  type: "number" | "string" | "boolean" | "select";
  default?: unknown;
  options?: { label: string; value: string }[];
  description?: string;
}

/**
 * Static metadata for all sync sources.
 */
export const SYNC_SOURCE_META: Record<string, SyncSourceMeta> = {
  beeper: {
    name: "beeper",
    displayName: "Beeper",
    description: "Chats, contacts, and messaging accounts",
    icon: "MessageSquare",
    category: "communication",
    supportsWebhook: false,
    supportsCron: true,
    configFields: [
      {
        key: "chat_limit",
        label: "Chat Limit",
        type: "number",
        default: 100,
        description: "Maximum number of chats to sync",
      },
    ],
  },
  "google-calendar": {
    name: "google-calendar",
    displayName: "Google Calendar",
    description: "Events and attendees",
    icon: "Calendar",
    category: "google",
    supportsWebhook: true,
    supportsCron: true,
    configFields: [
      {
        key: "days_ahead",
        label: "Days Ahead",
        type: "number",
        default: 30,
        description: "Sync events up to N days in the future",
      },
      {
        key: "days_behind",
        label: "Days Behind",
        type: "number",
        default: 7,
        description: "Sync events up to N days in the past",
      },
    ],
  },
  make: {
    name: "make",
    displayName: "Make.com",
    description: "Scenarios and organizations",
    icon: "Workflow",
    category: "automation",
    supportsWebhook: false,
    supportsCron: true,
    configFields: [],
  },
  n8n: {
    name: "n8n",
    displayName: "n8n",
    description: "Workflows and tags",
    icon: "GitBranch",
    category: "automation",
    supportsWebhook: false,
    supportsCron: true,
    configFields: [],
  },
  gmail: {
    name: "gmail",
    displayName: "Gmail",
    description: "Emails and threads",
    icon: "Mail",
    category: "google",
    supportsWebhook: true,
    supportsCron: true,
    configFields: [
      {
        key: "max_results",
        label: "Max Results",
        type: "number",
        default: 500,
        description: "Maximum emails to fetch per sync",
      },
      {
        key: "query",
        label: "Search Query",
        type: "string",
        default: "",
        description: "Gmail search query (e.g., 'is:unread')",
      },
    ],
  },
};

/**
 * Get display metadata for a source.
 */
export function getSourceMeta(source: string): SyncSourceMeta {
  return (
    SYNC_SOURCE_META[source] || {
      name: source,
      displayName: source,
      description: "Unknown source",
      icon: "HelpCircle",
      category: "automation" as const,
      supportsWebhook: false,
      supportsCron: false,
    }
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a human-readable label for sync status.
 */
export function getStatusLabel(status: SyncStatus): string {
  switch (status) {
    case "idle":
      return "Ready";
    case "syncing":
      return "Syncing";
    case "error":
      return "Error";
  }
}

/**
 * Get a human-readable label for freshness.
 */
export function getFreshnessLabel(freshness: SyncFreshness): string {
  switch (freshness) {
    case "never":
      return "Never synced";
    case "recent":
      return "Recently synced";
    case "today":
      return "Synced today";
    case "this week":
      return "Synced this week";
    case "stale":
      return "Needs sync";
  }
}

/**
 * Format duration in milliseconds to human-readable string.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Parse a cron expression to human-readable string.
 */
export function formatSchedule(cron: string | null): string {
  if (!cron) return "Manual only";

  // Common patterns
  if (cron === "*/5 * * * *") return "Every 5 minutes";
  if (cron === "*/10 * * * *") return "Every 10 minutes";
  if (cron === "*/15 * * * *") return "Every 15 minutes";
  if (cron === "*/30 * * * *") return "Every 30 minutes";
  if (cron === "0 * * * *") return "Every hour";
  if (cron === "0 */2 * * *") return "Every 2 hours";
  if (cron === "0 */6 * * *") return "Every 6 hours";
  if (cron === "0 0 * * *") return "Daily at midnight";
  if (cron === "0 0 */6 * *") return "Every 6 days";

  return cron; // Show raw cron if not a known pattern
}
