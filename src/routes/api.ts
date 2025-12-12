import { Hono } from "hono";
import { sessionManager } from "../session-manager.js";
import type { SessionConfig, HookEvent, ActivityState } from "../types.js";

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

// Poll for output - HTTP fallback when WebSocket isn't available
// Returns output from offset to current, plus current buffer length
api.get("/sessions/:id/output", (c) => {
  const id = c.req.param("id");
  const session = sessionManager.get(id);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const offsetStr = c.req.query("offset");
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
  const bufferLength = session.outputBuffer.length;

  // Return new output since offset
  const newOutput = offset < bufferLength ? session.outputBuffer.slice(offset) : "";

  return c.json({
    output: newOutput,
    offset: bufferLength,
    status: session.status,
    exitCode: session.exitCode,
  });
});

// Map Claude Code hook events to activity states
function hookEventToActivityState(event: HookEvent): ActivityState {
  switch (event) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return "busy";
    case "Notification":
    case "Stop":
      return "idle";
    case "SessionEnd":
      return "exited";
    default:
      return "busy";
  }
}

// Claude Code hook webhook - receives activity updates from Claude Code
// IMPORTANT: session_name/session_id is the preferred identifier for accurate per-terminal tracking
api.post("/hook", async (c) => {
  const body = await c.req.json<{
    event: HookEvent;
    cwd?: string;
    session_id?: string;    // PTY mode session UUID
    session_name?: string;  // tmux session name (for cross-compatibility)
    tool_name?: string;     // For PreToolUse/PostToolUse
  }>();

  if (!body.event) {
    return c.json({ error: "event is required" }, 400);
  }

  const newState = hookEventToActivityState(body.event);
  let updatedCount = 0;
  let targetedSession = "";

  // PRIORITY 1: If session_id or session_name provided, ONLY update that specific session
  // This prevents the bug where all terminals in the same directory get updated
  const targetId = body.session_id || body.session_name;
  if (targetId) {
    const success = sessionManager.setActivityState(targetId, newState, body.event, body.tool_name);
    if (success) {
      updatedCount++;
      targetedSession = targetId;
    }
    // Don't fall through to cwd matching - explicit session ID is definitive
  }
  // PRIORITY 2: Fall back to cwd matching ONLY if no session ID provided
  else if (body.cwd) {
    const sessions = sessionManager.findByCwd(body.cwd);
    for (const session of sessions) {
      const success = sessionManager.setActivityState(session.id, newState, body.event, body.tool_name);
      if (success) updatedCount++;
    }
    targetedSession = `cwd:${body.cwd} (${sessions.length} matches)`;
  }
  // PRIORITY 3: No identifier provided - error
  else {
    return c.json({ error: "Either session_id, session_name, or cwd is required" }, 400);
  }

  console.log(`[Hook] ${body.event} -> ${newState} | target: ${targetedSession || "none"} | updated: ${updatedCount}${body.tool_name ? ` | tool: ${body.tool_name}` : ""}`);

  return c.json({ success: true, updated: updatedCount, state: newState, target: targetedSession });
});

// Update activity state directly for a specific session
api.post("/sessions/:id/activity", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ state: ActivityState }>();

  if (!body.state || !["idle", "busy", "exited"].includes(body.state)) {
    return c.json({ error: "state must be one of: idle, busy, exited" }, 400);
  }

  const success = sessionManager.setActivityState(id, body.state);

  if (!success) {
    return c.json({ error: "Session not found or already exited" }, 404);
  }

  return c.json({ success: true, state: body.state });
});

// Get task status for a session (for rich visual indicators)
api.get("/sessions/:id/task-status", (c) => {
  const id = c.req.param("id");
  const taskStatus = sessionManager.getTaskStatus(id);

  if (!taskStatus) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json(taskStatus);
});

// Upload an image and return the file path for Claude Code
// Images are saved to /tmp/cloud-terminal-images/ with UUID filenames
// NOTE: Session validation is optional - we just need to save the file
api.post("/sessions/:id/upload-image", async (c) => {
  const id = c.req.param("id");

  // Log the upload attempt (session may or may not exist)
  console.log(`[Upload] Image upload requested for session: ${id}`);

  const body = await c.req.json<{ image: string; filename?: string }>();

  if (!body.image) {
    return c.json({ error: "image (base64 data URL) is required" }, 400);
  }

  // Parse base64 data URL
  const match = body.image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    return c.json({ error: "Invalid image format. Expected data URL: data:image/png;base64,..." }, 400);
  }

  const [, ext, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");

  // Create images directory if it doesn't exist
  const fs = await import("fs/promises");
  const path = await import("path");
  const crypto = await import("crypto");

  const imageDir = "/tmp/cloud-terminal-images";
  await fs.mkdir(imageDir, { recursive: true });

  // Generate unique filename
  const uuid = crypto.randomUUID();
  const originalName = body.filename?.replace(/[^a-zA-Z0-9.-]/g, "_") || "image";
  const filename = `${uuid}-${originalName}.${ext}`;
  const filepath = path.join(imageDir, filename);

  // Write image to file
  await fs.writeFile(filepath, buffer);

  console.log(`[Upload] Image saved: ${filepath} (${buffer.length} bytes)`);

  return c.json({
    success: true,
    filepath,
    size: buffer.length,
    type: `image/${ext}`,
  });
});

// Restart the backend server
// This endpoint triggers a graceful shutdown and relies on a process manager
// (like launchd or pm2) to restart the server automatically
api.post("/restart", async (c) => {
  console.log("[Server] Restart requested via API");

  // Send response before exiting
  const response = c.json({
    success: true,
    message: "Server is restarting...",
  });

  // Schedule the exit after response is sent
  setTimeout(() => {
    console.log("[Server] Exiting for restart...");
    process.exit(0);
  }, 500);

  return response;
});
