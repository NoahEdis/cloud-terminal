/**
 * WebSocket handler for tmux-based sessions.
 */

import type { WebSocket } from "ws";
import { tmuxSessionManager } from "../tmux-session-manager.js";
import type { ClientMessage } from "../types.js";

export async function handleTmuxWebSocketConnection(ws: WebSocket, sessionName: string): Promise<void> {
  // Add client to session
  const added = await tmuxSessionManager.addClient(sessionName, ws);

  if (!added) {
    ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
    ws.close(4004, "Session not found");
    return;
  }

  // Handle incoming messages
  ws.on("message", async (raw: Buffer) => {
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

        default:
          console.warn(`[WebSocket] Unknown message type from client`);
      }
    } catch (e) {
      console.error("[WebSocket] Failed to parse message:", e);
    }
  });

  // Handle client disconnect
  ws.on("close", () => {
    tmuxSessionManager.removeClient(sessionName, ws);
  });

  ws.on("error", (err) => {
    console.error(`[WebSocket] Error:`, err);
    tmuxSessionManager.removeClient(sessionName, ws);
  });
}
