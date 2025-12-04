#!/usr/bin/env npx tsx
/**
 * Simple CLI for interacting with the Cloud Terminal API
 *
 * Usage:
 *   npx tsx client/cli.ts list                    # List all sessions
 *   npx tsx client/cli.ts create bash             # Create a bash session
 *   npx tsx client/cli.ts create claude           # Create a Claude Code session
 *   npx tsx client/cli.ts connect <session-id>    # Connect to a session interactively
 *   npx tsx client/cli.ts send <session-id> "ls"  # Send a command
 *   npx tsx client/cli.ts kill <session-id>       # Kill a session
 */

import { CloudTerminalClient, interactiveSession } from "./sdk.js";

const client = new CloudTerminalClient({
  baseUrl: process.env.TERMINAL_API_URL || "http://localhost:3000",
});

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "list": {
      const sessions = await client.listSessions();
      if (sessions.length === 0) {
        console.log("No active sessions");
      } else {
        console.log("Active sessions:");
        for (const s of sessions) {
          console.log(
            `  ${s.id.slice(0, 8)}  ${s.status.padEnd(8)}  ${s.command} ${s.args.join(" ")}  (${s.clientCount} clients)`
          );
        }
      }
      break;
    }

    case "create": {
      const cmd = args[0] || "bash";
      const cwd = args[1] || process.cwd();

      console.log(`Creating session: ${cmd} in ${cwd}`);
      const session = await client.createSession({
        command: cmd,
        cwd,
        env: {
          // Pass through important env vars for Claude Code
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          HOME: process.env.HOME || "",
          PATH: process.env.PATH || "",
          TERM: "xterm-256color",
        },
      });

      console.log(`Session created: ${session.id}`);
      console.log(`Connect with: npx tsx client/cli.ts connect ${session.id}`);
      break;
    }

    case "connect": {
      const sessionId = args[0];
      if (!sessionId) {
        console.error("Usage: connect <session-id>");
        process.exit(1);
      }

      console.log(`Connecting to session ${sessionId}...`);
      console.log("(Press Ctrl+C to detach without killing the session)\n");

      await interactiveSession(client, sessionId);
      break;
    }

    case "send": {
      const sessionId = args[0];
      const input = args.slice(1).join(" ");

      if (!sessionId || !input) {
        console.error("Usage: send <session-id> <input>");
        process.exit(1);
      }

      // Add newline if not present
      const data = input.endsWith("\n") ? input : input + "\n";
      await client.sendInput(sessionId, data);
      console.log("Input sent");
      break;
    }

    case "output": {
      const sessionId = args[0];
      if (!sessionId) {
        console.error("Usage: output <session-id>");
        process.exit(1);
      }

      const session = await client.getSession(sessionId);
      console.log(`Session ${sessionId} (${session.status}):`);
      console.log("---");
      console.log(session.recentOutput || "(no output)");
      break;
    }

    case "kill": {
      const sessionId = args[0];
      if (!sessionId) {
        console.error("Usage: kill <session-id>");
        process.exit(1);
      }

      await client.killSession(sessionId);
      console.log(`Session ${sessionId} killed`);
      break;
    }

    default:
      console.log(`Cloud Terminal CLI

Usage:
  list                      List all sessions
  create <command> [cwd]    Create a new session
  connect <session-id>      Connect interactively
  send <session-id> <input> Send input to session
  output <session-id>       Get recent output
  kill <session-id>         Kill a session

Environment:
  TERMINAL_API_URL          Server URL (default: http://localhost:3000)
  ANTHROPIC_API_KEY         Passed to Claude Code sessions
`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
