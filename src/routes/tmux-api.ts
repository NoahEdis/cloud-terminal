/**
 * Tmux-based API routes for cloud-terminal.
 *
 * Uses tmux as the session backend for bidirectional sync
 * between local and cloud terminal sessions.
 */

import { Hono } from "hono";
import { tmuxSessionManager } from "../tmux-session-manager.js";
import type { HookEvent, ActivityState } from "../types.js";

export const tmuxApi = new Hono();

// List all sessions (includes both cloud-created and locally-created tmux sessions)
tmuxApi.get("/sessions", (c) => {
  return c.json(tmuxSessionManager.list());
});

// Create a new tmux session
tmuxApi.post("/sessions", async (c) => {
  const body = await c.req.json<{
    name?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    autoRunCommand?: string;
    chatType?: "claude" | "codex" | "custom";
    projectContext?: string; // Optional project context to inject via /context add
  }>();

  // Coerce string numbers to actual numbers (n8n sends strings)
  const config = {
    name: body.name,
    cwd: body.cwd,
    cols: body.cols ? Number(body.cols) : undefined,
    rows: body.rows ? Number(body.rows) : undefined,
    autoRunCommand: body.autoRunCommand,
    chatType: body.chatType,
    projectContext: body.projectContext,
  };

  try {
    const session = await tmuxSessionManager.create(config);

    return c.json(
      {
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
      },
      201
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    return c.json({ error: message }, 400);
  }
});

// Get session details
tmuxApi.get("/sessions/:name", (c) => {
  const name = c.req.param("name");
  const session = tmuxSessionManager.get(name);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({
    name: session.name,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    status: session.status,
    activityState: session.activityState,
    createdAt: session.createdAt.toISOString(),
    lastActivity: session.lastActivity.toISOString(),
    clientCount: session.clients.size,
    attached: session.tmuxSession?.attached || false,
    windows: session.tmuxSession?.windows || 1,
    recentOutput: session.outputBuffer.slice(-10000), // Last ~200 lines
  });
});

// Rename a session
tmuxApi.post("/sessions/:name/rename", async (c) => {
  const oldName = c.req.param("name");
  const body = await c.req.json<{ newName: string }>();

  if (!body.newName || typeof body.newName !== "string") {
    return c.json({ error: "newName is required and must be a string" }, 400);
  }

  try {
    const renamed = await tmuxSessionManager.rename(oldName, body.newName);

    if (!renamed) {
      return c.json({ error: "Session not found or rename failed" }, 404);
    }

    return c.json({ success: true, oldName, newName: body.newName });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename session";
    return c.json({ error: message }, 400);
  }
});

// Delete/kill a session
tmuxApi.delete("/sessions/:name", async (c) => {
  const name = c.req.param("name");
  const killed = await tmuxSessionManager.kill(name);

  if (!killed) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({ success: true });
});

// Send input to session
tmuxApi.post("/sessions/:name/send", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ input: string }>();

  if (typeof body.input !== "string") {
    return c.json({ error: "input is required and must be a string" }, 400);
  }

  const success = tmuxSessionManager.write(name, body.input);

  if (!success) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  return c.json({ success: true });
});

// Resize session
tmuxApi.post("/sessions/:name/resize", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ cols: number; rows: number }>();

  if (typeof body.cols !== "number" || typeof body.rows !== "number") {
    return c.json({ error: "cols and rows are required" }, 400);
  }

  const success = await tmuxSessionManager.resize(name, body.cols, body.rows);

  if (!success) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  return c.json({ success: true });
});

// Poll for output - HTTP fallback when WebSocket isn't available
tmuxApi.get("/sessions/:name/output", (c) => {
  const name = c.req.param("name");
  const session = tmuxSessionManager.get(name);

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
    activityState: session.activityState,
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
// IMPORTANT: session_name is the preferred identifier for accurate per-terminal tracking
tmuxApi.post("/hook", async (c) => {
  const body = await c.req.json<{
    event: HookEvent;
    cwd?: string;
    session_name?: string; // tmux session name - PREFERRED for accurate targeting
    session_id?: string;   // Claude Code's internal session ID (not used here)
    tool_name?: string;
  }>();

  if (!body.event) {
    return c.json({ error: "event is required" }, 400);
  }

  const newState = hookEventToActivityState(body.event);
  let updatedCount = 0;
  let targetedSession = "";

  // PRIORITY 1: If session_name provided, ONLY update that specific session
  // This prevents the bug where all terminals in the same directory get updated
  if (body.session_name) {
    const success = tmuxSessionManager.setActivityState(
      body.session_name,
      newState,
      body.event,
      body.tool_name
    );
    if (success) {
      updatedCount++;
      targetedSession = body.session_name;
    }
    // Don't fall through to cwd matching - session_name is definitive
  }
  // PRIORITY 2: Fall back to cwd matching ONLY if no session_name provided
  else if (body.cwd) {
    const sessions = tmuxSessionManager.findByCwd(body.cwd);
    for (const session of sessions) {
      const success = tmuxSessionManager.setActivityState(
        session.name,
        newState,
        body.event,
        body.tool_name
      );
      if (success) updatedCount++;
    }
    targetedSession = `cwd:${body.cwd} (${sessions.length} matches)`;
  }
  // PRIORITY 3: No identifier provided - error
  else {
    return c.json({ error: "Either session_name or cwd is required" }, 400);
  }

  console.log(`[Hook] ${body.event} -> ${newState} | target: ${targetedSession || "none"} | updated: ${updatedCount}${body.tool_name ? ` | tool: ${body.tool_name}` : ""}`);

  return c.json({ success: true, updated: updatedCount, state: newState, target: targetedSession });
});

// Get task status for a session (for rich visual indicators)
tmuxApi.get("/sessions/:name/task-status", (c) => {
  const name = c.req.param("name");
  const taskStatus = tmuxSessionManager.getTaskStatus(name);

  if (!taskStatus) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json(taskStatus);
});

// Capture tmux pane history - useful for feeding context to Claude Code
// This captures the scrollback buffer from tmux sessions
tmuxApi.get("/sessions/:name/history", async (c) => {
  const name = c.req.param("name");
  const session = tmuxSessionManager.get(name);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Get optional parameters for history capture
  const linesParam = c.req.query("lines");
  const lines = linesParam ? parseInt(linesParam, 10) : 50000; // Default to 50k lines
  const formatParam = c.req.query("format");
  const format = formatParam === "markdown" ? "markdown" : "plain";

  try {
    // Import tmux functions dynamically to capture pane
    const tmux = await import("../tmux.js");

    // Capture the pane content with history
    // -S -lines means start from N lines before the visible area
    const historyContent = await tmux.capturePane(name, {
      start: -lines,
      escape: false, // Don't include escape sequences for cleaner output
    });

    if (format === "markdown") {
      // Format as markdown code block for easy pasting
      const markdown = `## Terminal History: ${name}

Captured at: ${new Date().toISOString()}
Lines: ${historyContent.split("\n").length}

\`\`\`
${historyContent}
\`\`\`

---
*Use this history to provide context when starting a new Claude Code session.*
`;
      return c.json({
        session: name,
        lines: historyContent.split("\n").length,
        format: "markdown",
        content: markdown,
        capturedAt: new Date().toISOString(),
      });
    }

    return c.json({
      session: name,
      lines: historyContent.split("\n").length,
      format: "plain",
      content: historyContent,
      capturedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[History] Failed to capture history for ${name}:`, err);
    return c.json({ error: "Failed to capture history" }, 500);
  }
});

// Generate a context recap for Claude Code from session history
// This creates a structured summary that can be fed to a new Claude session
tmuxApi.get("/sessions/:name/recap", async (c) => {
  const name = c.req.param("name");
  const session = tmuxSessionManager.get(name);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  try {
    const tmux = await import("../tmux.js");

    // Capture recent history (last 1000 lines)
    const historyContent = await tmux.capturePane(name, {
      start: -1000,
      escape: false,
    });

    // Generate a recap format suitable for pasting into Claude Code
    const recap = `Context recap for this session:

**Session**: ${name}
**Working Directory**: ${session.cwd}
**Status**: ${session.status}
**Last Activity**: ${session.lastActivity.toISOString()}

**Recent Terminal Output** (last ${historyContent.split("\n").length} lines):
\`\`\`
${historyContent.slice(-10000)}
\`\`\`

---
This context can be pasted into a new Claude Code session to provide continuity.
`;

    return c.json({
      session: name,
      recap,
      capturedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[Recap] Failed to generate recap for ${name}:`, err);
    return c.json({ error: "Failed to generate recap" }, 500);
  }
});

// Get tmux window info for a session (for matching with local tmux status bar)
tmuxApi.get("/sessions/:name/windows", async (c) => {
  const name = c.req.param("name");
  const session = tmuxSessionManager.get(name);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const windowInfo = await tmuxSessionManager.getSessionWindows(name);
  return c.json({
    session: name,
    windowCount: windowInfo.windowList.length,
    windows: windowInfo.windowList,
    activeWindowName: windowInfo.activeWindowName,
  });
});

// Update activity state directly for a specific session
tmuxApi.post("/sessions/:name/activity", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ state: ActivityState }>();

  if (!body.state || !["idle", "busy", "exited"].includes(body.state)) {
    return c.json({ error: "state must be one of: idle, busy, exited" }, 400);
  }

  const success = tmuxSessionManager.setActivityState(name, body.state);

  if (!success) {
    return c.json({ error: "Session not found or already exited" }, 404);
  }

  return c.json({ success: true, state: body.state });
});

// Upload an image and return the file path for Claude Code
// Images are saved to /tmp/cloud-terminal-images/ with UUID filenames
// This allows pasting images into the terminal for Claude Code to process
// NOTE: Session validation is optional - we just need to save the file
tmuxApi.post("/sessions/:name/upload-image", async (c) => {
  const name = c.req.param("name");

  // Log the upload attempt (session may or may not exist)
  console.log(`[Upload] Image upload requested for session: ${name}`);

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
tmuxApi.post("/restart", async (c) => {
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
