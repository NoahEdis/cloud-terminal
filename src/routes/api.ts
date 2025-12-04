import { Hono } from "hono";
import { sessionManager } from "../session-manager.js";
import type { SessionConfig } from "../types.js";

export const api = new Hono();

// List all sessions
api.get("/sessions", (c) => {
  return c.json(sessionManager.list());
});

// Create a new session
api.post("/sessions", async (c) => {
  const body = await c.req.json<SessionConfig>();

  if (!body.command) {
    return c.json({ error: "command is required" }, 400);
  }

  // Coerce string numbers to actual numbers (n8n sends strings)
  const config: SessionConfig = {
    ...body,
    cols: body.cols ? Number(body.cols) : undefined,
    rows: body.rows ? Number(body.rows) : undefined,
  };

  const session = sessionManager.create(config);

  return c.json(
    {
      id: session.id,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
    },
    201
  );
});

// Get session details
api.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = sessionManager.get(id);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({
    id: session.id,
    command: session.command,
    args: session.args,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    status: session.status,
    exitCode: session.exitCode,
    createdAt: session.createdAt.toISOString(),
    lastActivity: session.lastActivity.toISOString(),
    clientCount: session.clients.size,
    recentOutput: session.outputBuffer.slice(-10000), // Last ~200 lines
  });
});

// Delete/kill a session
api.delete("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const killed = sessionManager.kill(id);

  if (!killed) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({ success: true });
});

// Send input to session
api.post("/sessions/:id/send", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ input: string }>();

  if (typeof body.input !== "string") {
    return c.json({ error: "input is required and must be a string" }, 400);
  }

  const success = sessionManager.write(id, body.input);

  if (!success) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  return c.json({ success: true });
});

// Resize session
api.post("/sessions/:id/resize", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ cols: number; rows: number }>();

  if (typeof body.cols !== "number" || typeof body.rows !== "number") {
    return c.json({ error: "cols and rows are required" }, 400);
  }

  const success = sessionManager.resize(id, body.cols, body.rows);

  if (!success) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  return c.json({ success: true });
});
