/**
 * Tmux-based Cloud Terminal Server.
 *
 * Uses tmux as the session backend for bidirectional sync between
 * local tmux sessions and the cloud terminal web UI.
 *
 * Sessions created locally (via `tmux new -s foo`) appear in cloud UI.
 * Sessions created in cloud UI can be attached to locally (`tmux attach -t foo`).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { tmuxApi } from "./routes/tmux-api.js";
import { credentialsApi } from "./routes/credentials-api.js";
import { settingsApi } from "./routes/settings-api.js";
import { handleTmuxWebSocketConnection } from "./websocket/tmux-handler.js";
import { tmuxSessionManager } from "./tmux-session-manager.js";
import { authMiddleware } from "./middleware/auth.js";
import { getTailscaleStatus, getTailscaleHostname } from "./tailscale.js";

const API_KEY = process.env.API_KEY;

export interface ServerConfig {
  port?: number;
  host?: string;
  tailscale?: boolean;
}

export function createTmuxTerminalServer(config: ServerConfig = {}) {
  const port = config.port || 3000;
  const configHost = config.host || "localhost";
  const useTailscale = config.tailscale ?? false;

  // Create Hono app
  const app = new Hono();

  // Middleware - explicit CORS configuration for cross-origin access
  // When credentials: true, origin must be specific (not *), so we echo the request origin
  app.use("*", cors({
    origin: (origin) => origin || "https://web-noah-edis-projects.vercel.app",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
    credentials: true,
  }));
  app.use("*", logger());

  // Health check (no auth required)
  app.get("/health", async (c) => {
    const tailscale = await getTailscaleStatus();
    const sessions = tmuxSessionManager.list();
    return c.json({
      status: "ok",
      mode: "tmux",
      timestamp: new Date().toISOString(),
      sessions: {
        total: sessions.length,
        local: sessions.filter(s => s.source === "local").length,
        cloud: sessions.filter(s => s.source === "cloud").length,
      },
      tailscale: {
        connected: tailscale.connected,
        ip: tailscale.ip,
        hostname: tailscale.hostname,
        tailnet: tailscale.tailnet,
        peerCount: tailscale.peers?.length || 0,
      },
    });
  });

  // Auth middleware for API routes (except /api/hook)
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/hook") {
      return next();
    }
    return authMiddleware(c, next);
  });

  // API routes
  app.route("/api", tmuxApi);
  app.route("/api/credentials", credentialsApi);
  app.route("/api/settings", settingsApi);

  // Create HTTP server
  const httpServer = createServer();

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade requests
  // URL format: /ws/:sessionName (tmux session name)
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    // Match session names (can contain letters, numbers, dashes, underscores)
    const match = url.pathname.match(/^\/ws\/([a-zA-Z0-9_-]+)$/);

    if (!match) {
      socket.destroy();
      return;
    }

    // Check auth
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

    const sessionName = match[1];
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleTmuxWebSocketConnection(ws, sessionName);
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
    await tmuxSessionManager.shutdown();
    wss.close();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  return {
    start: async () => {
      // Initialize tmux session manager
      await tmuxSessionManager.init();

      let host = configHost;
      let tailscaleHostname: string | null = null;

      if (useTailscale) {
        tailscaleHostname = await getTailscaleHostname();
        console.log(`[Server] Tailscale mode enabled`);
        if (tailscaleHostname) {
          console.log(`[Server] Tailscale hostname: ${tailscaleHostname}`);
        }
      }

      httpServer.listen(port, host, () => {
        console.log(`[Server] Tmux Terminal API running at http://${host}:${port}`);
        console.log(`[Server] Mode: tmux (bidirectional sync enabled)`);
        console.log(`[Server] WebSocket endpoint: ws://${host}:${port}/ws/:sessionName`);
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
