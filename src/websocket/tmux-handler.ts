/**
 * WebSocket handler for tmux-based sessions.
 */

import type { WebSocket } from "ws";
import { tmuxSessionManager } from "../tmux-session-manager.js";
import type { ClientMessage } from "../types.js";

// Heartbeat interval in milliseconds (25 seconds - under typical 30s timeout)
const HEARTBEAT_INTERVAL = 25000;

export async function handleTmuxWebSocketConnection(ws: WebSocket, sessionName: string): Promise<void> {
  // Add client to session
  const added = await tmuxSessionManager.addClient(sessionName, ws);

  if (!added) {
    ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
    ws.close(4004, "Session not found");
    return;
  }

  // Track if client is alive (responds to pings)
  let isAlive = true;

  // Send ping messages to keep connection alive
  const heartbeatInterval = setInterval(() => {
    if (!isAlive) {
      // Client didn't respond to last ping, terminate connection
      console.log(`[WebSocket] Client unresponsive for ${sessionName}, terminating`);
      clearInterval(heartbeatInterval);
      ws.terminate();
      return;
    }

    isAlive = false;
    // Send both WebSocket ping and application-level ping for compatibility
    ws.ping();
    try {
      ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
    } catch {
      // Ignore send errors, connection will be cleaned up
    }
  }, HEARTBEAT_INTERVAL);

  // Handle pong responses (WebSocket-level)
  ws.on("pong", () => {
    isAlive = true;
  });

  // Handle incoming messages
  ws.on("message", async (raw: Buffer) => {
    // Any message from client means it's alive
    isAlive = true;

    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;

      switch (message.type) {
        case "input":
          if (typeof message.data === "string") {
            tmuxSessionManager.write(sessionName, message.data);
          }
          break;

        case "resize":
          if (typeof message.cols === "number" && typeof message.rows === "number") {
            await tmuxSessionManager.resize(sessionName, message.cols, message.rows);
          }
          break;

        case "pong":
          // Application-level pong response
          isAlive = true;
          break;

        default:
          console.warn(`[WebSocket] Unknown message type from client`);
      }
    } catch (e) {
      console.error("[WebSocket] Failed to parse message:", e);
    }
  });

  // Handle client disconnect
  ws.on("close", () => {
    clearInterval(heartbeatInterval);
    tmuxSessionManager.removeClient(sessionName, ws);
  });

  ws.on("error", (err) => {
    console.error(`[WebSocket] Error:`, err);
    clearInterval(heartbeatInterval);
    tmuxSessionManager.removeClient(sessionName, ws);
  });
}
