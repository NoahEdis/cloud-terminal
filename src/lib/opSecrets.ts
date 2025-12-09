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
