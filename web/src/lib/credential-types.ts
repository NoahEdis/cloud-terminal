/**
 * Types for credential management.
 */

// ============================================================================
// Tracked Credentials (Supabase)
// ============================================================================

/**
 * A credential tracked in Supabase.
 * Contains metadata about 1Password credentials but never actual secret values.
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
 * Input for adding a new tracked credential.
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

// ============================================================================
// 1Password Account Info
// ============================================================================

/**
 * Summary of a 1Password account configuration.
 */
export interface AccountSummary {
  name: string;
  description: string;
  vaultId: string;
  vaultName: string;
  credentialCount: number;
  error?: boolean;
}

/**
 * Detailed credential info for an account.
 */
export interface AccountCredentialInfo {
  name: string;
  tracked: boolean;
  itemId: string;
  fieldLabel: string;
}

/**
 * Detailed account information with credentials.
 */
export interface AccountDetails {
  account: string;
  description: string;
  vaultId: string;
  vaultName: string;
  credentials: AccountCredentialInfo[];
}

// ============================================================================
// Graph Visualization
// ============================================================================

/**
 * Node types in the credentials graph.
 */
export type GraphNodeType = "account" | "vault" | "credential";

/**
 * A node in the credentials graph.
 */
export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  accountName?: string;
  vaultId?: string;
}

/**
 * Edge types in the credentials graph.
 */
export type GraphEdgeType = "account-vault" | "vault-credential";

/**
 * An edge in the credentials graph.
 */
export interface GraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
}

/**
 * Complete graph data for D3 visualization.
 */
export interface CredentialsGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Statistics about tracked credentials.
 */
export interface CredentialsStats {
  total: number;
  byAccount: Record<string, number>;
  byVault: Record<string, number>;
  byService: Record<string, number>;
}

// ============================================================================
// Grouped Data Structures
// ============================================================================

/**
 * Credentials grouped by account for UI display.
 */
export interface CredentialsByAccount {
  account: string;
  vaultName: string;
  credentials: TrackedCredential[];
}

/**
 * Credentials grouped by account then vault for hierarchical display.
 */
export interface CredentialsByAccountAndVault {
  account: string;
  vaults: {
    vaultId: string;
    vaultName: string;
    credentials: TrackedCredential[];
  }[];
}

// ============================================================================
// Integration Hierarchy (Application → Organization → Credential)
// ============================================================================

/**
 * An application node from the graph_nodes table.
 * Applications have logos and API documentation.
 */
export interface ApplicationNode {
  id: string;
  name: string;
  svg_logo: string | null;
  simple_icon_slug: string | null;
  icon_url: string | null;
  category: string | null;
  url: string | null;
  api_docs_md: string | null;
}

/**
 * An organization/account node from the graph_nodes table.
 * Organizations represent 1Password accounts.
 */
export interface OrganizationNode {
  id: string;
  name: string;
  display_name: string;
  vault_id: string | null;
  vault_name: string | null;
}

/**
 * A credential node from the graph_nodes table.
 * Credentials link to tracked_credentials and may have API documentation.
 */
export interface CredentialNode {
  id: string;
  name: string;
  service_name: string | null;
  item_id: string | null;
  field_label: string | null;
  notes: string | null;
  api_docs_md: string | null;
  tracked_credential_id: string | null;
}

/**
 * Full integration hierarchy tree structure.
 * Application → Organization → Credential
 */
export interface IntegrationHierarchy {
  applications: Array<{
    application: ApplicationNode;
    organizations: Array<{
      organization: OrganizationNode;
      credentials: CredentialNode[];
    }>;
  }>;
}
