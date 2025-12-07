import { config } from "dotenv";

// Load .env.local for local development
config({ path: ".env.local" });

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "localhost";
const tailscale = process.env.TAILSCALE === "true" || process.env.TAILSCALE === "1";

// Mode selection: "tmux" (default) or "pty" (legacy)
// tmux mode enables bidirectional sync with local tmux sessions
const mode = process.env.MODE || "tmux";

async function main() {
  if (mode === "tmux") {
    // Tmux mode: bidirectional sync with local tmux sessions
    const { createTmuxTerminalServer } = await import("./tmux-server.js");
    const server = createTmuxTerminalServer({ port, host, tailscale });
    await server.start();
  } else {
    // PTY mode: standalone sessions (legacy)
    const { createTerminalServer } = await import("./server.js");
    const server = createTerminalServer({ port, host, tailscale });
    await server.start();
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
