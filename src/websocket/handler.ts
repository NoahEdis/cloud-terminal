import type { WebSocket } from "ws";
import { sessionManager } from "../session-manager.js";
import type { ClientMessage } from "../types.js";

export function handleWebSocketConnection(ws: WebSocket, sessionId: string): void {
  // Add client to session
  const added = sessionManager.addClient(sessionId, ws);

  if (!added) {
    ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
    ws.close(4004, "Session not found");
    return;
  }

  // Handle incoming messages
  ws.on("message", (raw: Buffer) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;

      switch (message.type) {
        case "input":
          if (typeof message.data === "string") {
            sessionManager.write(sessionId, message.data);
          }
          break;

        case "resize":
          if (typeof message.cols === "number" && typeof message.rows === "number") {
            sessionManager.resize(sessionId, message.cols, message.rows);
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
    sessionManager.removeClient(sessionId, ws);
  });

  ws.on("error", (err) => {
    console.error(`[WebSocket] Error:`, err);
    sessionManager.removeClient(sessionId, ws);
  });
}
