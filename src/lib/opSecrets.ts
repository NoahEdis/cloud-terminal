/**
 * Local wrapper for 1Password secrets functionality.
 * Re-exports functions from the shared servers/core/opSecrets module.
 *
 * This wrapper exists because cloud-terminal has a restricted rootDir
 * that doesn't include the shared servers directory.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path from cloud-terminal/src/lib/ to new-mcp-structure/config/credentials
// cloud-terminal/src/lib -> cloud-terminal/src -> cloud-terminal -> new-mcp-structure -> config/credentials
const CREDENTIALS_DIR = join(__dirname, "../../../config/credentials");

export interface AccountInfo {
  account: string;
  description: string;
  vaultId: string;
  vaultName: string;
  credentialNames: string[];
}

interface CredentialRef {
  itemId: string;
  fieldLabel: string;
  vaultId?: string;
}

interface AccountConfig {
  account: string;
  description: string;
  vaultId: string;
  vaultName: string;
  credentials: Record<string, CredentialRef>;
}

// Cache for account configs
const accountConfigCache = new Map<string, AccountConfig>();

function loadAccountConfig(accountName: string): AccountConfig {
  const cached = accountConfigCache.get(accountName);
  if (cached) return cached;

  const configPath = join(CREDENTIALS_DIR, `${accountName}.json`);
  const content = readFileSync(configPath, "utf-8");
  const config = JSON.parse(content) as AccountConfig;
  accountConfigCache.set(accountName, config);
  return config;
}

/**
 * List all available 1Password account configurations.
 */
export async function listAccounts(): Promise<string[]> {
  try {
    const files = readdirSync(CREDENTIALS_DIR);
    return files
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

/**
 * Get metadata about a specific account (no secret values).
 */
export async function getAccountInfo(accountName: string): Promise<AccountInfo> {
  const config = loadAccountConfig(accountName);
  return {
    account: config.account,
    description: config.description,
    vaultId: config.vaultId,
    vaultName: config.vaultName,
    credentialNames: Object.keys(config.credentials),
  };
}

/**
 * Get detailed credential references for an account.
 * Returns item IDs and field labels but NOT secret values.
 */
export async function getAccountCredentialRefs(
  accountName: string
): Promise<Record<string, { itemId: string; fieldLabel: string }>> {
  const config = loadAccountConfig(accountName);
  const refs: Record<string, { itemId: string; fieldLabel: string }> = {};

  for (const [name, ref] of Object.entries(config.credentials)) {
    refs[name] = {
      itemId: ref.itemId,
      fieldLabel: ref.fieldLabel,
    };
  }

  return refs;
}

// ============================================================================
// Credential Value Fetching
// ============================================================================

// 1Password Connect configuration
const connectHost = process.env.ONEPASSWORD_CONNECT_HOST?.replace(/\/+$/, "") ?? "";
const connectToken = process.env.ONEPASSWORD_CONNECT_TOKEN ?? "";
const serviceAccountToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;

interface CachedItem {
  id: string;
  fields: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
}

const itemCache = new Map<string, CachedItem>();

/**
 * Fetch an item via 1Password Connect HTTP API.
 */
async function fetchItemViaConnect(
  itemId: string,
  vaultId: string
): Promise<CachedItem> {
  const cacheKey = `connect:${vaultId}:${itemId}`;
  const cached = itemCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(
    `${connectHost}/v1/vaults/${vaultId}/items/${itemId}`,
    {
      headers: {
        Authorization: `Bearer ${connectToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(
      `Failed to fetch 1Password item ${itemId}: ${response.status} ${payload}`
    );
  }

  const data = (await response.json()) as CachedItem;
  itemCache.set(cacheKey, data);
  return data;
}

/**
 * Fetch an item via 1Password CLI with Service Account token.
 */
async function fetchItemViaCLI(
  itemId: string,
  vaultId: string,
  token: string
): Promise<CachedItem> {
  const cacheKey = `cli:${vaultId}:${itemId}`;
  const cached = itemCache.get(cacheKey);
  if (cached) return cached;

  const { execSync } = await import("child_process");

  try {
    const result = execSync(
      `op item get "${itemId}" --vault "${vaultId}" --format json`,
      {
        env: {
          ...process.env,
          OP_SERVICE_ACCOUNT_TOKEN: token,
        },
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const data = JSON.parse(result) as CachedItem;
    itemCache.set(cacheKey, data);
    return data;
  } catch (error) {
    throw new Error(
      `Failed to fetch 1Password item ${itemId} via CLI: ${error}`
    );
  }
}

/**
 * Extract a field value from a cached item.
 */
function extractField(item: CachedItem, fieldLabel: string): string {
  const field = item.fields.find((f) => f.label === fieldLabel);
  if (!field?.value) {
    throw new Error(
      `Field "${fieldLabel}" not found or empty in item ${item.id}`
    );
  }
  return field.value;
}

/**
 * Get a single credential value by account and env var name.
 */
export async function getAccountCredential(
  accountName: string,
  envVarName: string
): Promise<string> {
  const config = loadAccountConfig(accountName);
  const ref = config.credentials[envVarName];

  if (!ref) {
    throw new Error(
      `No credential "${envVarName}" found for account "${accountName}"`
    );
  }

  const vaultId = ref.vaultId ?? config.vaultId;

  // Try CLI with Service Account token first
  if (serviceAccountToken) {
    const item = await fetchItemViaCLI(ref.itemId, vaultId, serviceAccountToken);
    return extractField(item, ref.fieldLabel);
  }

  // Fall back to 1Password Connect (HTTP API)
  if (connectHost && connectToken) {
    const item = await fetchItemViaConnect(ref.itemId, vaultId);
    return extractField(item, ref.fieldLabel);
  }

  throw new Error(
    "1Password is not configured. Set OP_SERVICE_ACCOUNT_TOKEN or ONEPASSWORD_CONNECT_HOST + ONEPASSWORD_CONNECT_TOKEN."
  );
}
