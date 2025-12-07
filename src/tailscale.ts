import { exec } from "child_process";
import { promisify } from "util";
import { networkInterfaces } from "os";

const execAsync = promisify(exec);

// Common paths for Tailscale CLI on different platforms
const TAILSCALE_PATHS = [
  "tailscale", // If in PATH
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale", // macOS app
  "/usr/bin/tailscale", // Linux
  "/usr/local/bin/tailscale", // Linux alternate
];

let tailscalePath: string | null = null;

/**
 * Find the Tailscale CLI binary
 */
async function findTailscale(): Promise<string | null> {
  if (tailscalePath) return tailscalePath;

  for (const path of TAILSCALE_PATHS) {
    try {
      await execAsync(`"${path}" version`);
      tailscalePath = path;
      return path;
    } catch {
      // Try next path
    }
  }
  return null;
}

/**
 * Execute a Tailscale command
 */
async function tailscaleExec(args: string): Promise<string> {
  const cli = await findTailscale();
  if (!cli) {
    throw new Error("Tailscale CLI not found");
  }
  const { stdout } = await execAsync(`"${cli}" ${args}`);
  return stdout.trim();
}

export interface TailscaleStatus {
  connected: boolean;
  ip?: string;
  hostname?: string;
  tailnet?: string;
  peers?: TailscalePeer[];
}

export interface TailscalePeer {
  ip: string;
  hostname: string;
  online: boolean;
  os?: string;
}

/**
 * Check if Tailscale is available and connected
 */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const cli = await findTailscale();
    if (!cli) {
      return { connected: false };
    }

    // Get status
    const statusOutput = await tailscaleExec("status --json");
    const status = JSON.parse(statusOutput);

    // Get our IP
    const ip = await tailscaleExec("ip -4").catch(() => null);

    // Parse peers
    const peers: TailscalePeer[] = [];
    if (status.Peer) {
      for (const [, peer] of Object.entries(status.Peer) as [string, any][]) {
        peers.push({
          ip: peer.TailscaleIPs?.[0] || "",
          hostname: peer.HostName || "",
          online: peer.Online || false,
          os: peer.OS || undefined,
        });
      }
    }

    return {
      connected: status.BackendState === "Running",
      ip: ip || status.Self?.TailscaleIPs?.[0],
      hostname: status.Self?.HostName,
      tailnet: status.MagicDNSSuffix,
      peers,
    };
  } catch (e) {
    console.error("[Tailscale] Error getting status:", e);
    return { connected: false };
  }
}

/**
 * Get the Tailscale IP address
 */
export async function getTailscaleIP(): Promise<string | null> {
  try {
    return await tailscaleExec("ip -4");
  } catch {
    return null;
  }
}

/**
 * Get the Tailscale hostname (e.g., "my-machine.tail12345.ts.net")
 */
export async function getTailscaleHostname(): Promise<string | null> {
  try {
    const status = await getTailscaleStatus();
    if (status.hostname && status.tailnet) {
      return `${status.hostname}.${status.tailnet}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if an IP address belongs to Tailscale network (100.x.x.x CGNAT range)
 */
export function isTailscaleIP(ip: string): boolean {
  return ip.startsWith("100.");
}

/**
 * Get the Tailscale IP from network interfaces (fallback if CLI unavailable)
 */
export function getTailscaleIPFromInterfaces(): string | null {
  const interfaces = networkInterfaces();

  // Look for utun interfaces (macOS) or tailscale0 (Linux)
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name.startsWith("utun") || name === "tailscale0") {
      for (const addr of addrs || []) {
        if (addr.family === "IPv4" && isTailscaleIP(addr.address)) {
          return addr.address;
        }
      }
    }
  }

  // Fallback: look for any 100.x.x.x address
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && isTailscaleIP(addr.address)) {
        return addr.address;
      }
    }
  }

  return null;
}

/**
 * Determine the best host to bind to based on configuration
 */
export async function getBindHost(preferTailscale: boolean): Promise<{
  host: string;
  tailscaleIP: string | null;
  mode: "tailscale" | "localhost" | "all";
}> {
  if (preferTailscale) {
    // Try CLI first, then network interfaces
    const ip = (await getTailscaleIP()) || getTailscaleIPFromInterfaces();
    if (ip) {
      return { host: ip, tailscaleIP: ip, mode: "tailscale" };
    }
    console.warn("[Tailscale] Tailscale IP not found, falling back to localhost");
  }

  return { host: "localhost", tailscaleIP: null, mode: "localhost" };
}
