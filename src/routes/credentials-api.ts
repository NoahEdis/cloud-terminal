/**
 * Credentials API routes for managing tracked 1Password credentials.
 *
 * Provides endpoints for:
 * - Listing/adding/removing tracked credentials (stored in Supabase)
 * - Fetching available 1Password accounts and their credential metadata
 * - Generating graph visualization data
 */

import { Hono } from "hono";
import * as supabase from "../supabase.js";
import {
  listAccounts,
  getAccountInfo,
  getAccountCredentialRefs,
} from "../lib/opSecrets.js";

export const credentialsApi = new Hono();

// ============================================================================
// Tracked Credentials (Supabase-stored)
// ============================================================================

/**
 * GET /tracked - List all tracked credentials
 * Returns credentials grouped by account for easy consumption
 */
credentialsApi.get("/tracked", async (c) => {
  try {
    const credentials = await supabase.getTrackedCredentials();
    return c.json(credentials);
  } catch (err) {
    console.error("[Credentials API] Failed to get tracked credentials:", err);
    return c.json({ error: "Failed to fetch tracked credentials" }, 500);
  }
});

/**
 * GET /tracked/by-account/:accountName - List tracked credentials for a specific account
 */
credentialsApi.get("/tracked/by-account/:accountName", async (c) => {
  const accountName = c.req.param("accountName");

  try {
    const credentials =
      await supabase.getTrackedCredentialsByAccount(accountName);
    return c.json(credentials);
  } catch (err) {
    console.error(
      `[Credentials API] Failed to get credentials for ${accountName}:`,
      err
    );
    return c.json({ error: "Failed to fetch tracked credentials" }, 500);
  }
});

/**
 * POST /tracked - Add a credential to tracking
 * Body: { account_name, vault_id, vault_name, credential_name, item_id, field_label, service_name?, notes? }
 */
credentialsApi.post("/tracked", async (c) => {
  try {
    const body = await c.req.json<supabase.TrackedCredentialInput>();

    // Validate required fields
    const requiredFields = [
      "account_name",
      "vault_id",
      "vault_name",
      "credential_name",
      "item_id",
      "field_label",
    ];
    for (const field of requiredFields) {
      if (!body[field as keyof supabase.TrackedCredentialInput]) {
        return c.json({ error: `Missing required field: ${field}` }, 400);
      }
    }

    const credential = await supabase.addTrackedCredential(body);

    if (!credential) {
      return c.json({ error: "Failed to add credential" }, 500);
    }

    return c.json(credential, 201);
  } catch (err) {
    console.error("[Credentials API] Failed to add tracked credential:", err);
    const message =
      err instanceof Error ? err.message : "Failed to add credential";
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /tracked/bulk - Add multiple credentials at once
 * Body: { credentials: TrackedCredentialInput[] }
 */
credentialsApi.post("/tracked/bulk", async (c) => {
  try {
    const body = await c.req.json<{
      credentials: supabase.TrackedCredentialInput[];
    }>();

    if (!body.credentials || !Array.isArray(body.credentials)) {
      return c.json({ error: "credentials array is required" }, 400);
    }

    const credentials = await supabase.addTrackedCredentials(body.credentials);
    return c.json({ added: credentials.length, credentials }, 201);
  } catch (err) {
    console.error("[Credentials API] Failed to bulk add credentials:", err);
    const message =
      err instanceof Error ? err.message : "Failed to add credentials";
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /tracked/:id - Remove a credential from tracking
 * Note: This only removes from Supabase, NOT from 1Password
 */
credentialsApi.delete("/tracked/:id", async (c) => {
  const id = c.req.param("id");

  try {
    await supabase.removeTrackedCredential(id);
    return c.json({ success: true });
  } catch (err) {
    console.error(
      `[Credentials API] Failed to remove tracked credential ${id}:`,
      err
    );
    return c.json({ error: "Failed to remove credential" }, 500);
  }
});

/**
 * PATCH /tracked/:id - Update a tracked credential's metadata
 * Body: { service_name?, notes? }
 */
credentialsApi.patch("/tracked/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json<{ service_name?: string; notes?: string }>();
    const updated = await supabase.updateTrackedCredential(id, body);

    if (!updated) {
      return c.json({ error: "Credential not found" }, 404);
    }

    return c.json(updated);
  } catch (err) {
    console.error(
      `[Credentials API] Failed to update tracked credential ${id}:`,
      err
    );
    return c.json({ error: "Failed to update credential" }, 500);
  }
});

/**
 * GET /tracked/check - Check if a specific credential is tracked
 * Query: ?account_name=xxx&credential_name=yyy
 */
credentialsApi.get("/tracked/check", async (c) => {
  const accountName = c.req.query("account_name");
  const credentialName = c.req.query("credential_name");

  if (!accountName || !credentialName) {
    return c.json(
      { error: "account_name and credential_name query params required" },
      400
    );
  }

  try {
    const isTracked = await supabase.isCredentialTracked(
      accountName,
      credentialName
    );
    return c.json({ tracked: isTracked });
  } catch (err) {
    console.error("[Credentials API] Failed to check tracked status:", err);
    return c.json({ error: "Failed to check tracked status" }, 500);
  }
});

// ============================================================================
// 1Password Account Discovery
// ============================================================================

/**
 * GET /1password/accounts - List all available 1Password accounts
 * Returns account metadata from config files (not secret values)
 */
credentialsApi.get("/1password/accounts", async (c) => {
  try {
    const accountNames = await listAccounts();
    const accounts = await Promise.all(
      accountNames.map(async (name) => {
        try {
          const info = await getAccountInfo(name);
          return {
            name,
            description: info.description,
            vaultId: info.vaultId,
            vaultName: info.vaultName,
            credentialCount: info.credentialNames.length,
          };
        } catch {
          return {
            name,
            description: "Error loading account config",
            vaultId: "",
            vaultName: "",
            credentialCount: 0,
            error: true,
          };
        }
      })
    );

    return c.json(accounts);
  } catch (err) {
    console.error("[Credentials API] Failed to list accounts:", err);
    return c.json({ error: "Failed to list 1Password accounts" }, 500);
  }
});

/**
 * GET /1password/accounts/:name - Get detailed credential info for an account
 * Returns credential metadata (names, item IDs) but NOT secret values
 */
credentialsApi.get("/1password/accounts/:name", async (c) => {
  const name = c.req.param("name");

  try {
    const info = await getAccountInfo(name);
    const credentialRefs = await getAccountCredentialRefs(name);

    // Check which credentials are already tracked
    const trackedCredentials =
      await supabase.getTrackedCredentialsByAccount(name);
    const trackedNames = new Set(trackedCredentials.map((c) => c.credential_name));

    // Return credential metadata with tracking status and refs
    const credentials = info.credentialNames.map((credName) => ({
      name: credName,
      tracked: trackedNames.has(credName),
      itemId: credentialRefs[credName]?.itemId || "",
      fieldLabel: credentialRefs[credName]?.fieldLabel || "",
    }));

    return c.json({
      account: name,
      description: info.description,
      vaultId: info.vaultId,
      vaultName: info.vaultName,
      credentials,
    });
  } catch (err) {
    console.error(`[Credentials API] Failed to get account ${name}:`, err);
    const message =
      err instanceof Error && err.message.includes("ENOENT")
        ? "Account not found"
        : "Failed to get account info";
    return c.json({ error: message }, 404);
  }
});

// ============================================================================
// Graph Visualization Data
// ============================================================================

interface GraphNode {
  id: string;
  label: string;
  type: "account" | "vault" | "credential";
  accountName?: string;
  vaultId?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "account-vault" | "vault-credential";
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * GET /graph - Get graph visualization data for tracked credentials
 * Returns nodes and edges for D3 visualization
 */
credentialsApi.get("/graph", async (c) => {
  try {
    const credentials = await supabase.getTrackedCredentials();

    // Build graph data structure
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const accountNodes = new Map<string, GraphNode>();
    const vaultNodes = new Map<string, GraphNode>();

    for (const cred of credentials) {
      // Add account node if not exists
      if (!accountNodes.has(cred.account_name)) {
        const accountNode: GraphNode = {
          id: `account:${cred.account_name}`,
          label: cred.account_name,
          type: "account",
        };
        accountNodes.set(cred.account_name, accountNode);
        nodes.push(accountNode);
      }

      // Add vault node if not exists (unique by account+vault combination)
      const vaultKey = `${cred.account_name}:${cred.vault_id}`;
      if (!vaultNodes.has(vaultKey)) {
        const vaultNode: GraphNode = {
          id: `vault:${vaultKey}`,
          label: cred.vault_name,
          type: "vault",
          accountName: cred.account_name,
          vaultId: cred.vault_id,
        };
        vaultNodes.set(vaultKey, vaultNode);
        nodes.push(vaultNode);

        // Add edge from account to vault
        edges.push({
          source: `account:${cred.account_name}`,
          target: `vault:${vaultKey}`,
          type: "account-vault",
        });
      }

      // Add credential node
      const credNode: GraphNode = {
        id: `credential:${cred.id}`,
        label: cred.credential_name,
        type: "credential",
        accountName: cred.account_name,
        vaultId: cred.vault_id,
      };
      nodes.push(credNode);

      // Add edge from vault to credential
      edges.push({
        source: `vault:${vaultKey}`,
        target: `credential:${cred.id}`,
        type: "vault-credential",
      });
    }

    const graphData: GraphData = { nodes, edges };
    return c.json(graphData);
  } catch (err) {
    console.error("[Credentials API] Failed to generate graph data:", err);
    return c.json({ error: "Failed to generate graph data" }, 500);
  }
});

/**
 * GET /stats - Get statistics about tracked credentials
 */
credentialsApi.get("/stats", async (c) => {
  try {
    const credentials = await supabase.getTrackedCredentials();

    // Calculate statistics
    const byAccount = new Map<string, number>();
    const byVault = new Map<string, number>();
    const byService = new Map<string, number>();

    for (const cred of credentials) {
      byAccount.set(
        cred.account_name,
        (byAccount.get(cred.account_name) || 0) + 1
      );
      byVault.set(cred.vault_name, (byVault.get(cred.vault_name) || 0) + 1);
      if (cred.service_name) {
        byService.set(
          cred.service_name,
          (byService.get(cred.service_name) || 0) + 1
        );
      }
    }

    return c.json({
      total: credentials.length,
      byAccount: Object.fromEntries(byAccount),
      byVault: Object.fromEntries(byVault),
      byService: Object.fromEntries(byService),
    });
  } catch (err) {
    console.error("[Credentials API] Failed to get stats:", err);
    return c.json({ error: "Failed to get statistics" }, 500);
  }
});

// ============================================================================
// Integration Hierarchy (Applications → Organizations → Credentials)
// ============================================================================

/**
 * GET /applications - List all application nodes with logos
 * Returns applications from graph_nodes with svg_logo and metadata
 */
credentialsApi.get("/applications", async (c) => {
  try {
    const applications = await supabase.getApplicationNodes();
    return c.json(applications);
  } catch (err) {
    console.error("[Credentials API] Failed to get applications:", err);
    return c.json({ error: "Failed to fetch applications" }, 500);
  }
});

/**
 * GET /applications/:name - Get a single application by name
 */
credentialsApi.get("/applications/:name", async (c) => {
  const name = c.req.param("name");

  try {
    const application = await supabase.findApplicationByName(name);
    if (!application) {
      return c.json({ error: "Application not found" }, 404);
    }
    return c.json(application);
  } catch (err) {
    console.error(`[Credentials API] Failed to get application ${name}:`, err);
    return c.json({ error: "Failed to fetch application" }, 500);
  }
});

/**
 * GET /hierarchy - Get full integration hierarchy
 * Returns: Application → Organization → Credential tree structure
 */
credentialsApi.get("/hierarchy", async (c) => {
  try {
    const hierarchy = await supabase.getIntegrationHierarchy();
    return c.json(hierarchy);
  } catch (err) {
    console.error("[Credentials API] Failed to get integration hierarchy:", err);
    return c.json({ error: "Failed to fetch integration hierarchy" }, 500);
  }
});

/**
 * GET /organizations - List all organization nodes
 */
credentialsApi.get("/organizations", async (c) => {
  try {
    const organizations = await supabase.getOrganizationNodes();
    return c.json(organizations);
  } catch (err) {
    console.error("[Credentials API] Failed to get organizations:", err);
    return c.json({ error: "Failed to fetch organizations" }, 500);
  }
});

/**
 * POST /organizations - Create an organization node
 * Body: { name, display_name, vault_id?, vault_name? }
 */
credentialsApi.post("/organizations", async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      display_name: string;
      vault_id?: string;
      vault_name?: string;
    }>();

    if (!body.name || !body.display_name) {
      return c.json({ error: "name and display_name are required" }, 400);
    }

    const org = await supabase.createOrganizationNode({
      name: body.name,
      display_name: body.display_name,
      vault_id: body.vault_id,
      vault_name: body.vault_name,
    });

    return c.json(org, 201);
  } catch (err) {
    console.error("[Credentials API] Failed to create organization:", err);
    return c.json({ error: "Failed to create organization" }, 500);
  }
});

/**
 * GET /credential-nodes - List all credential nodes from graph
 */
credentialsApi.get("/credential-nodes", async (c) => {
  try {
    const credentials = await supabase.getCredentialNodes();
    return c.json(credentials);
  } catch (err) {
    console.error("[Credentials API] Failed to get credential nodes:", err);
    return c.json({ error: "Failed to fetch credential nodes" }, 500);
  }
});

/**
 * POST /credential-nodes - Create a credential node
 * Body: { account_name, credential_name, service_name?, item_id?, field_label?, notes?, api_docs_md?, tracked_credential_id? }
 */
credentialsApi.post("/credential-nodes", async (c) => {
  try {
    const body = await c.req.json<{
      account_name: string;
      credential_name: string;
      service_name?: string;
      item_id?: string;
      field_label?: string;
      notes?: string;
      api_docs_md?: string;
      tracked_credential_id?: string;
    }>();

    if (!body.account_name || !body.credential_name) {
      return c.json({ error: "account_name and credential_name are required" }, 400);
    }

    const credential = await supabase.createCredentialNode({
      name: body.credential_name,
      account_name: body.account_name,
      service_name: body.service_name,
      item_id: body.item_id,
      field_label: body.field_label,
      notes: body.notes,
      api_docs_md: body.api_docs_md,
    });

    return c.json(credential, 201);
  } catch (err) {
    console.error("[Credentials API] Failed to create credential node:", err);
    return c.json({ error: "Failed to create credential node" }, 500);
  }
});

/**
 * POST /relationships - Create a graph relationship
 * Body: { source_id, target_id, type }
 */
credentialsApi.post("/relationships", async (c) => {
  try {
    const body = await c.req.json<{
      source_id: string;
      target_id: string;
      type: string;
    }>();

    if (!body.source_id || !body.target_id || !body.type) {
      return c.json({ error: "source_id, target_id, and type are required" }, 400);
    }

    const relationship = await supabase.createGraphRelationship(
      body.source_id,
      body.target_id,
      body.type
    );

    return c.json(relationship, 201);
  } catch (err) {
    console.error("[Credentials API] Failed to create relationship:", err);
    return c.json({ error: "Failed to create relationship" }, 500);
  }
});

/**
 * POST /tracked/:id/link-node - Link a tracked credential to a graph node
 * Body: { node_id }
 */
credentialsApi.post("/tracked/:id/link-node", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json<{ node_id: string }>();

    if (!body.node_id) {
      return c.json({ error: "node_id is required" }, 400);
    }

    await supabase.linkTrackedCredentialToNode(id, body.node_id);
    return c.json({ success: true });
  } catch (err) {
    console.error(`[Credentials API] Failed to link credential ${id}:`, err);
    return c.json({ error: "Failed to link credential to node" }, 500);
  }
});
