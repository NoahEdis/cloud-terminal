import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { api } from "./routes/api.js";
import { handleWebSocketConnection } from "./websocket/handler.js";
import { sessionManager } from "./session-manager.js";
import { authMiddleware } from "./middleware/auth.js";

const API_KEY = process.env.API_KEY;

export interface ServerConfig {
  port?: number;
  host?: string;
}

export function createTerminalServer(config: ServerConfig = {}) {
  const port = config.port || 3000;
  const host = config.host || "localhost";

  // Create Hono app
  const app = new Hono();

  // Middleware
  app.use("*", cors());
  app.use("*", logger());

  // Health check (no auth required)
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Auth middleware for API routes
  app.use("/api/*", authMiddleware);

  // API routes
  app.route("/api", api);

  // Create HTTP server
  const httpServer = createServer();

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade requests
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/ws\/([a-f0-9-]+)$/);

    if (!match) {
      socket.destroy();
      return;
    }

    // Check auth for WebSocket (via query param or header)
    if (API_KEY) {
      const apiKeyQuery = url.searchParams.get("api_key");
      const authHeader = request.headers.authorization;
      const apiKeyHeader = request.headers["x-api-key"];

      const isAuthorized =
        apiKeyQuery === API_KEY ||
        authHeader === `Bearer ${API_KEY}` ||
        apiKeyHeader === API_KEY;

      if (!isAuthorized) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    const sessionId = match[1];
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleWebSocketConnection(ws, sessionId);
    });
  });

  // Handle HTTP requests with Hono
  httpServer.on("request", async (req: IncomingMessage, res: ServerResponse) => {
    const url = `http://${host}:${port}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }

    // Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks).toString() : undefined;

    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });

    try {
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const responseBody = await response.text();
      res.end(responseBody);
    } catch (e) {
      console.error("Request error:", e);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Server] Shutting down...");
    sessionManager.shutdown();
    wss.close();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    start: () => {
      httpServer.listen(port, host, () => {
        console.log(`[Server] Cloud Terminal API running at http://${host}:${port}`);
        console.log(`[Server] WebSocket endpoint: ws://${host}:${port}/ws/:sessionId`);
        console.log(`[Server] Press Ctrl+C to stop`);
      });
    },
    stop: shutdown,
    app,
    httpServer,
    wss,
  };
}
