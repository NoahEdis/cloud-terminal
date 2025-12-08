import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { api } from "./routes/api.js";
import { handleWebSocketConnection } from "./websocket/handler.js";
import { sessionManager } from "./session-manager.js";
import { authMiddleware } from "./middleware/auth.js";
import { getTailscaleStatus, getBindHost, getTailscaleHostname } from "./tailscale.js";

const API_KEY = process.env.API_KEY;

export interface ServerConfig {
  port?: number;
  host?: string;
  tailscale?: boolean; // Bind to Tailscale IP if available
}

export function createTerminalServer(config: ServerConfig = {}) {
  const port = config.port || 3000;
  const configHost = config.host || "localhost";
  const useTailscale = config.tailscale ?? false;

  // Create Hono app
  const app = new Hono();

  // Middleware - explicit CORS configuration for cross-origin access
  // Use a function to dynamically return the request origin (required when credentials: true)
  app.use("*", cors({
    origin: (origin) => origin || "*", // Echo back the request origin
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
    credentials: true,
  }));
  app.use("*", logger());

  // Health check (no auth required) - includes Tailscale status
  app.get("/health", async (c) => {
    const tailscale = await getTailscaleStatus();
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      tailscale: {
        connected: tailscale.connected,
        ip: tailscale.ip,
        hostname: tailscale.hostname,
        tailnet: tailscale.tailnet,
        peerCount: tailscale.peers?.length || 0,
      },
    });
  });

  // Auth middleware for API routes (except /api/hook which is called locally)
  app.use("/api/*", async (c, next) => {
    // Skip auth for hook endpoint - called from localhost by Claude Code hooks
    if (c.req.path === "/api/hook") {
      return next();
    }
    return authMiddleware(c, next);
  });

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
    const url = `http://${configHost}:${port}${req.url}`;
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
  const shutdown = async () => {
    console.log("\n[Server] Shutting down...");
    await sessionManager.shutdown();
    wss.close();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  return {
    start: async () => {
      // Initialize session manager (Supabase persistence)
      await sessionManager.init();

      // Determine bind host - always use configured host (e.g., 0.0.0.0 for Funnel compatibility)
      // When TAILSCALE=true, we still need to bind to 0.0.0.0 so Funnel can proxy to us
      let host = configHost;
      let tailscaleHostname: string | null = null;

      if (useTailscale) {
        // Get Tailscale info for display, but bind to configured host (0.0.0.0)
        tailscaleHostname = await getTailscaleHostname();
        console.log(`[Server] Tailscale mode enabled`);
        if (tailscaleHostname) {
          console.log(`[Server] Tailscale hostname: ${tailscaleHostname}`);
        }
      }

      httpServer.listen(port, host, () => {
        console.log(`[Server] Cloud Terminal API running at http://${host}:${port}`);
        console.log(`[Server] WebSocket endpoint: ws://${host}:${port}/ws/:sessionId`);
        if (tailscaleHostname) {
          console.log(`[Server] Tailscale Funnel URL: https://${tailscaleHostname.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.taile629c0.ts.net`);
        }
        console.log(`[Server] Press Ctrl+C to stop`);
      });
    },
    stop: shutdown,
    app,
    httpServer,
    wss,
  };
}
