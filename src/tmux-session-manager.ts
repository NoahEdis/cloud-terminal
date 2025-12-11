/**
 * Tmux-based Session Manager for cloud-terminal.
 *
 * Uses tmux as the session backend, enabling bidirectional sync
 * between local tmux sessions and the cloud terminal web UI.
 *
 * Benefits:
 * - Sessions created locally in tmux appear in the cloud UI
 * - Sessions created in the cloud UI can be attached to locally
 * - Sessions persist across server restarts (managed by tmux)
 * - Multiple clients can attach to the same session
 */

import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import * as tmux from "./tmux.js";
import * as supabase from "./supabase.js";
import { insertClaudeCodeMessage } from "./supabase.js";
import type { ActivityState, TaskStatus, SessionEventType } from "./types.js";
import { updateTokenCount } from "./terminal-parser.js";

// Helper to record session events
function recordEvent(
  sessionId: string,
  eventType: SessionEventType,
  details?: Record<string, unknown>
): void {
  supabase.recordSessionEventAsync(sessionId, eventType, details);
}

const MAX_BUFFER_SIZE = 100_000; // ~2000 lines of 50 chars

// Unified session group name - all sessions (web and local) join this group
// This enables Ctrl+B P to cycle through all sessions seamlessly
const UNIFIED_SESSION_GROUP = "cloud-terminal";

// Session prefix for new sessions created via the cloud UI
const CLOUD_SESSION_PREFIX = "terminal-";

/**
 * Clean malformed escape sequences from terminal output.
 * This prevents garbage characters like ^[[ from appearing in the terminal.
 */
function cleanTerminalOutput(data: string): string {
  let cleaned = data;

  // Remove orphaned OSC sequences (Operating System Commands) without proper ESC prefix
  // These look like ]0;title or ]10;color etc.
  cleaned = cleaned.replace(/\]1[0-9];[^\x07\x1b\n]*(?:\x07|\x1b\\|\\)?/g, "");
  cleaned = cleaned.replace(/\][0-9];[^\x07\x1b\n]*(?:\x07|\x1b\\|\\)?/g, "");

  // Remove Device Attributes responses (DA1, DA2)
  // These look like ?64;1;2c or >1;1;0c
  cleaned = cleaned.replace(/\?[\d;]+c/g, "");
  cleaned = cleaned.replace(/>[\d;]+c/g, "");

  // Remove orphaned CSI sequences without proper ESC prefix
  // CSI sequences start with [ followed by parameters and a letter
  // But we need to be careful not to remove valid content
  cleaned = cleaned.replace(/(?<!\x1b)\[[\d;]*[A-HJKSTfm]/g, "");

  // Remove incomplete/broken escape sequences
  // Pattern: ESC followed by [ but then garbage or another ESC
  cleaned = cleaned.replace(/\x1b\[\x1b/g, "\x1b");

  // Remove double ESC-[ sequences (the main cause of ^[[^[[ garbage)
  cleaned = cleaned.replace(/\x1b\[\x1b\[/g, "\x1b[");

  // Remove bare ESC characters not followed by valid sequence starters
  // Valid starters: [ (CSI), ] (OSC), ( ) * + (charset), = > (keypad), 7 8 (save/restore)
  cleaned = cleaned.replace(/\x1b(?![\[\]()=*+>78DEMNOPHVWXYZ\\^_c])/g, "");

  return cleaned;
}

export interface TmuxManagedSession {
  // Tmux session name (used as ID)
  name: string;
  // PTY process attached to tmux (for this connection)
  pty: IPty | null;
  // Tmux session metadata
  tmuxSession: tmux.TmuxSession | null;
  // Working directory
  cwd: string;
  // Terminal dimensions
  cols: number;
  rows: number;
  // Timestamps
  createdAt: Date;
  lastActivity: Date;
  // Output buffer for replay
  outputBuffer: string;
  // Connected WebSocket clients
  clients: Set<WebSocket>;
  // Session state
  status: "running" | "exited";
  activityState: ActivityState;
  // Metrics for context tracking
  metrics: SessionMetrics;
  // Task status tracking for visual indicators
  currentTool: string | null;
  taskStartTime: Date | null;
  toolUseCount: number;
  tokenCount: number;
  taskCompletedAt: Date | null;
}

export interface SessionMetrics {
  // Total number of newlines in output (actual lines of content)
  lineCount: number;
  // Total characters in output buffer
  charCount: number;
  // Detected Claude Code message boundaries (user prompts + assistant responses)
  messageCount: number;
  // Estimated token count (rough approximation: chars / 4)
  estimatedTokens: number;
}

export interface TmuxWindowInfo {
  index: number;
  name: string;
  active: boolean;
}

export interface TmuxSessionInfo {
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  lastActivity: string;
  status: "running" | "exited";
  clientCount: number;
  activityState: ActivityState;
  attached: boolean; // Whether attached locally (via tmux attach)
  windows: number;
  /** Window list with active window indicated (for tmux status matching) */
  windowList?: TmuxWindowInfo[];
  /** Name of the active window (e.g., "Process Termination") */
  activeWindowName?: string;
  // Metrics for context tracking
  metrics: SessionMetrics;
  // Task status for visual indicators
  taskStatus?: TaskStatus;
}

// Helper to create initial metrics
function createInitialMetrics(): SessionMetrics {
  return {
    lineCount: 0,
    charCount: 0,
    messageCount: 0,
    estimatedTokens: 0,
  };
}

// Pattern to detect Claude Code message boundaries
// Matches the typical Claude prompt patterns like "╭" (box drawing) or "> " prompts
const CLAUDE_MESSAGE_PATTERNS = [
  /╭─/,  // Claude Code box drawing start
  /Human:/,  // Direct API pattern
  /Assistant:/,  // Direct API pattern
  /^> /m,  // User input prompt
];

// Update metrics based on new output data
function updateMetrics(metrics: SessionMetrics, newData: string, fullBuffer: string): void {
  // Count actual lines in the buffer (not cumulative - accounts for buffer trimming)
  // This gives the real line count of what's currently in the buffer
  metrics.lineCount = (fullBuffer.match(/\n/g) || []).length;

  // Update character count
  metrics.charCount = fullBuffer.length;

  // Rough token estimate (GPT-like: ~4 chars per token)
  metrics.estimatedTokens = Math.ceil(metrics.charCount / 4);

  // Try to detect Claude message boundaries in new output
  // Note: messageCount is still cumulative since we can't re-scan the whole buffer efficiently
  for (const pattern of CLAUDE_MESSAGE_PATTERNS) {
    const matches = newData.match(new RegExp(pattern, 'g'));
    if (matches) {
      metrics.messageCount += matches.length;
    }
  }
}

/**
 * Filter out terminal query responses from input data.
 * These are responses that xterm.js sends in response to terminal capability queries,
 * but should not be forwarded to applications like Claude Code.
 *
 * Common sequences filtered:
 * - Primary DA (Device Attributes): ESC[?1;2c or similar (responds to ESC[c)
 * - Secondary DA: ESC[>0;276;0c or similar (responds to ESC[>c)
 * - OSC responses: ESC]11;rgb:xxxx/xxxx/xxxx (background color query response)
 * - Orphaned responses that lost their ESC prefix through buffering
 */
function filterTerminalResponses(data: string): string {
  let filtered = data;

  // Filter full escape sequences (with ESC prefix)
  // Primary DA response: ESC[?...c
  filtered = filtered.replace(/\x1b\[\?[\d;]*c/g, "");
  // Secondary DA response: ESC[>...c
  filtered = filtered.replace(/\x1b\[>[\d;]*c/g, "");
  // OSC sequences (color queries, title, etc.): ESC]...BEL or ESC]...ST
  filtered = filtered.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "");

  // Filter orphaned responses (ESC got stripped by buffering)
  // These appear as raw ?1;2c or >0;276;0c or ]11;rgb:...
  filtered = filtered.replace(/^\?[\d;]+c/g, "");
  filtered = filtered.replace(/^>[\d;]+c/g, "");
  filtered = filtered.replace(/^\]1?[0-9];[^\x07\n]*/g, "");

  // Also filter these patterns if they appear mid-string (after newlines, etc.)
  filtered = filtered.replace(/\n\?[\d;]+c/g, "\n");
  filtered = filtered.replace(/\n>[\d;]+c/g, "\n");
  filtered = filtered.replace(/\n\]1?[0-9];[^\x07\n]*/g, "\n");

  // Filter mid-string orphaned responses (surrounded by any character)
  // Use a more aggressive pattern for standalone DA responses
  filtered = filtered.replace(/(?<![a-zA-Z0-9])\?[\d;]+c(?![a-zA-Z0-9])/g, "");
  filtered = filtered.replace(/(?<![a-zA-Z0-9])>[\d;]+c(?![a-zA-Z0-9])/g, "");

  // Return the filtered data.
  // NOTE: We intentionally do NOT trim() here because \r and \n are
  // essential for sending Enter/newline to the terminal.
  return filtered;
}

// Configuration for PTY reconnection
const PTY_RECONNECT_MAX_ATTEMPTS = 5;
const PTY_RECONNECT_BASE_DELAY = 1000; // 1 second
const PTY_RECONNECT_MAX_DELAY = 30000; // 30 seconds

export class TmuxSessionManager {
  private sessions = new Map<string, TmuxManagedSession>();
  // Track session_id -> name mapping to detect renames
  private sessionIdToName = new Map<string, string>();
  private syncInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private tmuxAvailable = false;
  // The base session name for the unified group (first session in the group)
  private baseSessionName: string | null = null;
  // Track reconnection attempts per session
  private reconnectAttempts = new Map<string, number>();
  // Track reconnection timeouts to allow cancellation
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Initialize the session manager.
   * Checks for tmux, ensures base session group exists, and syncs sessions.
   */
  async init(): Promise<void> {
    this.tmuxAvailable = await tmux.isTmuxAvailable();

    if (!this.tmuxAvailable) {
      console.error("[TmuxSessionManager] tmux is not available on this system");
      throw new Error("tmux is required for TmuxSessionManager");
    }

    console.log("[TmuxSessionManager] tmux is available, syncing sessions...");

    // Find or create the base session for the unified group
    await this.ensureBaseSession();

    // Initial sync of existing tmux sessions
    await this.syncTmuxSessions();

    // Start periodic sync to detect new local sessions
    this.syncInterval = setInterval(() => this.syncTmuxSessions(), 5000);

    // Clean up dead connections every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);

    console.log(`[TmuxSessionManager] Initialized with ${this.sessions.size} sessions (group: ${this.baseSessionName})`);
  }

  /**
   * Ensure the base session for the unified group exists.
   * Priority:
   * 1. Find an existing session already in the unified group
   * 2. Find ANY existing grouped session and use its group (join existing local sessions)
   * 3. Create a new base session if no groups exist
   */
  private async ensureBaseSession(): Promise<void> {
    const sessions = await tmux.listSessions();

    // Priority 1: Check if any session is already in the unified group
    for (const session of sessions) {
      const group = await tmux.getSessionGroup(session.name);
      if (group === UNIFIED_SESSION_GROUP) {
        this.baseSessionName = session.name;
        console.log(`[TmuxSessionManager] Found existing base session in unified group: ${session.name}`);
        return;
      }
    }

    // Priority 2: Check if the unified session group base exists directly
    if (await tmux.sessionExists(UNIFIED_SESSION_GROUP)) {
      this.baseSessionName = UNIFIED_SESSION_GROUP;
      console.log(`[TmuxSessionManager] Using existing session as base: ${UNIFIED_SESSION_GROUP}`);
      return;
    }

    // Priority 3: Find ANY existing grouped session and join that group
    // This allows cloud-terminal to seamlessly join existing local session groups
    for (const session of sessions) {
      const group = await tmux.getSessionGroup(session.name);
      if (group) {
        // Found an existing group - use its first session as our base
        this.baseSessionName = session.name;
        console.log(`[TmuxSessionManager] Joining existing session group: ${group} (base: ${session.name})`);
        return;
      }
    }

    // Priority 4: No groups exist - create the base session
    // This base session defines the window layout that all grouped sessions share
    console.log(`[TmuxSessionManager] No existing groups found, creating base session: ${UNIFIED_SESSION_GROUP}`);
    await tmux.createSession({
      name: UNIFIED_SESSION_GROUP,
      cwd: process.env.HOME || "/",
    });
    this.baseSessionName = UNIFIED_SESSION_GROUP;
  }

  /**
   * Get the base session name for the unified group.
   */
  getBaseSessionName(): string | null {
    return this.baseSessionName;
  }

  /**
   * Sync with tmux to discover new/removed/renamed sessions.
   * All sessions in the unified group are shown (no deduplication needed).
   */
  async syncTmuxSessions(): Promise<void> {
    const tmuxSessions = await tmux.listSessions();

    const tmuxNames = new Set(tmuxSessions.map(s => s.name));
    const tmuxIds = new Set(tmuxSessions.map(s => s.id));

    // Check for renamed sessions first (same session_id, different name)
    for (const ts of tmuxSessions) {
      const oldName = this.sessionIdToName.get(ts.id);
      if (oldName && oldName !== ts.name && this.sessions.has(oldName)) {
        // Session was renamed!
        console.log(`[TmuxSessionManager] Session renamed: ${oldName} -> ${ts.name}`);

        const session = this.sessions.get(oldName)!;

        // Update the session's name
        session.name = ts.name;
        session.tmuxSession = ts;

        // Move to new key in sessions map
        this.sessions.delete(oldName);
        this.sessions.set(ts.name, session);

        // Update the id->name mapping
        this.sessionIdToName.set(ts.id, ts.name);

        // Broadcast rename event to all connected clients
        const renameMessage = JSON.stringify({
          type: "rename",
          oldName,
          newName: ts.name
        });
        for (const client of session.clients) {
          if (client.readyState === 1) {
            client.send(renameMessage);
          }
        }

        // Update in Supabase
        supabase.renameSession(oldName, ts.name);
      }
    }

    // Add new sessions discovered from tmux
    for (const ts of tmuxSessions) {
      if (!this.sessions.has(ts.name)) {
        // Check the session's group status
        const group = await tmux.getSessionGroup(ts.name);
        const groupInfo = group ? ` (group: ${group})` : " (ungrouped)";
        console.log(`[TmuxSessionManager] Discovered new tmux session: ${ts.name}${groupInfo}`);

        // Log if session is not in the unified group (for debugging visibility issues)
        if (!group && this.baseSessionName) {
          console.log(`[TmuxSessionManager] Note: ${ts.name} is not grouped with ${this.baseSessionName}. Sessions created locally won't share windows, but will still appear in the session list.`);
        }

        this.sessions.set(ts.name, {
          name: ts.name,
          pty: null, // No PTY until a client connects
          tmuxSession: ts,
          cwd: process.env.HOME || "/", // tmux doesn't expose cwd easily
          cols: ts.width,
          rows: ts.height,
          createdAt: ts.created,
          lastActivity: ts.lastActivity,
          outputBuffer: "",
          clients: new Set(),
          status: "running",
          activityState: "idle",
          metrics: createInitialMetrics(),
          // Task status tracking
          currentTool: null,
          taskStartTime: null,
          toolUseCount: 0,
          tokenCount: 0,
          taskCompletedAt: null,
        });
        // Track the session_id -> name mapping
        this.sessionIdToName.set(ts.id, ts.name);
      } else {
        // Update existing session metadata
        const session = this.sessions.get(ts.name)!;
        session.tmuxSession = ts;
        session.lastActivity = ts.lastActivity;
        session.cols = ts.width;
        session.rows = ts.height;
        // Ensure id mapping is tracked
        this.sessionIdToName.set(ts.id, ts.name);
      }
    }

    // Mark sessions that no longer exist in tmux as exited
    for (const [name, session] of this.sessions) {
      if (!tmuxNames.has(name) && session.status === "running") {
        // Check if this session was renamed (don't mark as exited)
        const wasRenamed = session.tmuxSession && tmuxIds.has(session.tmuxSession.id);
        if (wasRenamed) continue;

        console.log(`[TmuxSessionManager] Session ${name} no longer exists in tmux`);
        session.status = "exited";
        session.activityState = "exited";

        // Record session exit event
        recordEvent(name, "session_exit", { reason: "tmux_session_gone" });

        // Notify clients
        const message = JSON.stringify({ type: "exit", code: 0 });
        for (const client of session.clients) {
          if (client.readyState === 1) {
            client.send(message);
          }
        }

        // Clean up PTY if attached
        if (session.pty) {
          try {
            session.pty.kill();
          } catch {}
          session.pty = null;
        }

        // Clean up id mapping
        if (session.tmuxSession) {
          this.sessionIdToName.delete(session.tmuxSession.id);
        }
      }
    }
  }

  /**
   * Create a new tmux session in the unified group.
   * All sessions share the same windows and can be cycled with Ctrl+B P.
   */
  async create(config: {
    name?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    autoRunCommand?: string;
    chatType?: "claude" | "custom";
  }): Promise<TmuxManagedSession> {
    const name = config.name || `${CLOUD_SESSION_PREFIX}${Date.now()}`;
    const cwd = config.cwd || process.env.HOME || "/";
    const cols = config.cols || 80;
    const rows = config.rows || 24;

    // Check if session already exists
    if (await tmux.sessionExists(name)) {
      throw new Error(`Session '${name}' already exists`);
    }

    // Ensure base session exists before creating grouped session
    if (!this.baseSessionName) {
      await this.ensureBaseSession();
    }

    // Create tmux session as an independent session (NOT grouped)
    // Note: We intentionally do NOT use groupWith because grouped sessions share windows,
    // which means commands sent to one session appear in all grouped sessions.
    // Independent sessions are isolated but still visible via tmux list-sessions and Ctrl+B s.
    await tmux.createSession({
      name,
      cwd,
      width: cols,
      height: rows,
      // groupWith removed - sessions should be independent
    });

    const tmuxSession = await tmux.getSession(name);

    const session: TmuxManagedSession = {
      name,
      pty: null,
      tmuxSession,
      cwd,
      cols,
      rows,
      createdAt: new Date(),
      lastActivity: new Date(),
      outputBuffer: "",
      clients: new Set(),
      status: "running",
      activityState: "idle",
      metrics: createInitialMetrics(),
      // Task status tracking
      currentTool: null,
      taskStartTime: null,
      toolUseCount: 0,
      tokenCount: 0,
      taskCompletedAt: null,
    };

    this.sessions.set(name, session);
    console.log(`[TmuxSessionManager] Created session: ${name}`);

    // Record session start event
    recordEvent(name, "session_start", { cwd, cols, rows });

    // Persist to Supabase
    supabase.createSession({
      id: name,
      command: "tmux",
      args: [name],
      cwd,
      cols,
      rows,
      status: "running",
      activityState: "idle",
      externallyControlled: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      lastOutputTime: session.lastActivity,
    });

    // If autoRunCommand is provided, wait for shell prompt then send the command
    if (config.autoRunCommand) {
      // Wait a short time for shell to initialize and display prompt
      await this.waitForPrompt(name, 2000);
      // Send the command
      tmux.sendKeys(name, config.autoRunCommand + "\n", true);
      console.log(`[TmuxSessionManager] Auto-ran command in ${name}: ${config.autoRunCommand}`);

      // If this is a Claude Code session, insert a startup message
      if (config.autoRunCommand.includes("claude")) {
        insertClaudeCodeMessage(
          name,
          "system",
          `**Claude Code** session started\n\nWorking directory: \`${cwd}\``,
          { metadata: { chatType: config.chatType || "claude", autoRunCommand: config.autoRunCommand } }
        ).catch(err => console.error("[TmuxSessionManager] Failed to insert startup message:", err));
      }
    }

    return session;
  }

  /**
   * Wait for shell prompt to appear (simple timeout-based wait).
   * This gives the shell time to initialize before sending commands.
   */
  private async waitForPrompt(name: string, timeoutMs: number): Promise<void> {
    // Simple approach: just wait a fixed time for shell to be ready
    // More sophisticated: poll tmux pane content for prompt patterns
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
  }

  /**
   * Get a session by name.
   */
  get(name: string): TmuxManagedSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * List all sessions.
   */
  list(): TmuxSessionInfo[] {
    return Array.from(this.sessions.values()).map(s => ({
      name: s.name,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
      status: s.status,
      clientCount: s.clients.size,
      activityState: s.activityState,
      attached: s.tmuxSession?.attached || false,
      windows: s.tmuxSession?.windows || 1,
      metrics: s.metrics,
      taskStatus: {
        activityState: s.activityState,
        currentTool: s.currentTool,
        taskStartTime: s.taskStartTime?.toISOString() || null,
        toolUseCount: s.toolUseCount,
        tokenCount: s.tokenCount,
        taskCompletedAt: s.taskCompletedAt?.toISOString() || null,
      },
    }));
  }

  /**
   * Get detailed window info for a session (async operation).
   * Returns the window list and active window name.
   */
  async getSessionWindows(name: string): Promise<{ windowList: TmuxWindowInfo[]; activeWindowName?: string }> {
    const session = this.sessions.get(name);
    if (!session) {
      return { windowList: [] };
    }

    const windows = await tmux.getSessionWindows(name);
    const windowList: TmuxWindowInfo[] = windows.map(w => ({
      index: w.index,
      name: w.name,
      active: w.active,
    }));

    const activeWindow = windows.find(w => w.active);
    return {
      windowList,
      activeWindowName: activeWindow?.name,
    };
  }

  /**
   * Rename a session.
   * Renames the tmux session and updates all tracking.
   */
  async rename(oldName: string, newName: string): Promise<boolean> {
    const session = this.sessions.get(oldName);
    if (!session) return false;

    // Check if new name already exists
    if (this.sessions.has(newName)) {
      throw new Error(`Session '${newName}' already exists`);
    }

    // Rename in tmux
    const renamed = await tmux.renameSession(oldName, newName);
    if (!renamed) return false;

    // Update session name
    session.name = newName;

    // Move to new key in sessions map
    this.sessions.delete(oldName);
    this.sessions.set(newName, session);

    // Update id->name mapping
    if (session.tmuxSession) {
      this.sessionIdToName.set(session.tmuxSession.id, newName);
    }

    // Broadcast rename event to all connected clients
    const renameMessage = JSON.stringify({
      type: "rename",
      oldName,
      newName
    });
    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(renameMessage);
      }
    }

    console.log(`[TmuxSessionManager] Renamed session: ${oldName} -> ${newName}`);

    // Update in Supabase
    supabase.renameSession(oldName, newName);

    return true;
  }

  /**
   * Kill a session.
   */
  async kill(name: string): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session) return false;

    // Kill the tmux session
    const killed = await tmux.killSession(name);

    // Clean up PTY if attached
    if (session.pty) {
      try {
        session.pty.kill();
      } catch {}
    }

    // Remove from our tracking
    this.sessions.delete(name);
    console.log(`[TmuxSessionManager] Killed session: ${name}`);

    // Delete from Supabase
    supabase.deleteSession(name);

    return killed;
  }

  /**
   * Write data to a session.
   * Always uses tmux send-keys for reliable Enter key handling with readline apps.
   */
  write(name: string, data: string): boolean {
    const session = this.sessions.get(name);
    if (!session || session.status !== "running") return false;

    session.lastActivity = new Date();

    // Filter out terminal query responses that can leak into input
    // These are responses from xterm.js that should not be sent to applications
    const filteredData = filterTerminalResponses(data);

    // Skip if nothing left after filtering
    if (!filteredData) return true;

    // Always use tmux send-keys for input - this ensures proper Enter key
    // handling with readline-based apps like Claude Code.
    // The literal=true flag splits on newlines and sends Enter as a key name,
    // which works more reliably than writing \r directly to a PTY.
    // Note: We don't await here because the API returns synchronously,
    // but the tmux commands are executed asynchronously in sequence.
    tmux.sendKeys(name, filteredData, true).catch(err => {
      console.error(`[TmuxSessionManager write] sendKeys error for ${name}:`, err);
    });

    return true;
  }

  /**
   * Resize a session.
   */
  async resize(name: string, cols: number, rows: number): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session || session.status !== "running") return false;

    session.cols = cols;
    session.rows = rows;

    // Resize in tmux
    await tmux.resizeSession(name, cols, rows);

    // Resize PTY if attached
    if (session.pty) {
      session.pty.resize(cols, rows);
    }

    return true;
  }

  /**
   * Add a WebSocket client to a session.
   * Creates a PTY attachment if this is the first cloud client.
   */
  async addClient(name: string, ws: WebSocket): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session) return false;

    session.clients.add(ws);

    // Check if we need to create a new PTY
    const needsNewPty = !session.pty && session.status === "running";

    // If no PTY yet, create one by attaching to tmux
    // Note: tmux will send its own scrollback when we attach, so we don't
    // need to send our buffered history in this case
    if (needsNewPty) {
      await this.attachPty(session);
    } else if (session.outputBuffer.length > 0) {
      // Only send our buffered history if we already have a PTY attached
      // (i.e., this is an additional client joining an existing connection)
      ws.send(JSON.stringify({ type: "history", data: session.outputBuffer }));
    }

    // If session already exited, send exit message
    if (session.status === "exited") {
      ws.send(JSON.stringify({ type: "exit", code: 0 }));
    }

    // Record client attach event
    recordEvent(name, "session_attach", { clientCount: session.clients.size });

    console.log(`[TmuxSessionManager] Client connected to ${name} (${session.clients.size} clients)`);
    return true;
  }

  /**
   * Remove a WebSocket client from a session.
   */
  removeClient(name: string, ws: WebSocket): void {
    const session = this.sessions.get(name);
    if (!session) return;

    session.clients.delete(ws);

    // Record client detach event
    recordEvent(name, "session_detach", { clientCount: session.clients.size });

    console.log(`[TmuxSessionManager] Client disconnected from ${name} (${session.clients.size} clients)`);

    // If no more cloud clients, we can optionally detach the PTY
    // to save resources (the tmux session stays alive)
    if (session.clients.size === 0 && session.pty) {
      // Keep PTY alive for now to preserve buffer
      // Could add a timeout to detach if no clients reconnect
    }
  }

  /**
   * Attach a PTY to a tmux session for streaming output.
   * Includes automatic reconnection if the PTY disconnects but the tmux session still exists.
   */
  private async attachPty(session: TmuxManagedSession): Promise<void> {
    // Cancel any pending reconnection for this session
    const existingTimeout = this.reconnectTimeouts.get(session.name);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.reconnectTimeouts.delete(session.name);
    }

    // Use node-pty to attach to the tmux session
    const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", session.name], {
      name: "xterm-256color",
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env: process.env as Record<string, string>,
    });

    session.pty = ptyProcess;

    // Reset reconnection attempts on successful attach
    this.reconnectAttempts.set(session.name, 0);

    // Handle PTY output
    ptyProcess.onData((rawData: string) => {
      session.lastActivity = new Date();

      // Clean malformed escape sequences before processing
      const data = cleanTerminalOutput(rawData);

      // Append to buffer, trim if too large
      session.outputBuffer += data;
      if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
        session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
      }

      // Update metrics
      updateMetrics(session.metrics, data, session.outputBuffer);

      // Parse terminal output for token counts (supplementary to hooks)
      session.tokenCount = updateTokenCount(session.tokenCount, data);

      // Update output offset for event correlation
      supabase.updateOutputOffset(session.name, data.length);

      // Broadcast to all connected clients
      const message = JSON.stringify({ type: "output", data });
      for (const client of session.clients) {
        if (client.readyState === 1) {
          client.send(message);
        }
      }

      // Log to Supabase
      supabase.appendOutput(session.name, data);
    });

    // Handle PTY exit (tmux detach or session kill)
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[TmuxSessionManager] PTY for ${session.name} exited with code ${exitCode}`);
      session.pty = null;

      // Check if the tmux session still exists
      tmux.sessionExists(session.name).then(async (exists) => {
        if (!exists) {
          // Session is truly gone - mark as exited
          session.status = "exited";
          session.activityState = "exited";

          // Record session exit event
          recordEvent(session.name, "session_exit", { reason: "pty_exit", exitCode });

          const message = JSON.stringify({ type: "exit", code: exitCode });
          for (const client of session.clients) {
            if (client.readyState === 1) {
              client.send(message);
            }
          }

          supabase.updateSessionStatus(session.name, {
            status: "exited",
            exitCode,
            activityState: "exited",
            lastActivity: new Date(),
          });

          // Clean up reconnection tracking
          this.reconnectAttempts.delete(session.name);
          this.reconnectTimeouts.delete(session.name);
        } else if (session.clients.size > 0) {
          // Session still exists and we have connected clients - attempt reconnection
          await this.attemptPtyReconnect(session);
        } else {
          // Session exists but no clients - just log it
          console.log(`[TmuxSessionManager] PTY detached for ${session.name}, no clients connected`);
        }
      });
    });

    console.log(`[TmuxSessionManager] Attached PTY to session: ${session.name}`);
  }

  /**
   * Attempt to reconnect the PTY to a tmux session.
   * Uses exponential backoff for retry delays.
   */
  private async attemptPtyReconnect(session: TmuxManagedSession): Promise<void> {
    const attempts = this.reconnectAttempts.get(session.name) || 0;

    if (attempts >= PTY_RECONNECT_MAX_ATTEMPTS) {
      console.log(`[TmuxSessionManager] Max reconnection attempts reached for ${session.name}`);

      // Notify clients about the connection issue
      const message = JSON.stringify({
        type: "error",
        message: "Lost connection to terminal. Please refresh to reconnect.",
      });
      for (const client of session.clients) {
        if (client.readyState === 1) {
          client.send(message);
        }
      }

      // Reset attempts so manual refresh can try again
      this.reconnectAttempts.set(session.name, 0);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      PTY_RECONNECT_BASE_DELAY * Math.pow(2, attempts),
      PTY_RECONNECT_MAX_DELAY
    );

    console.log(
      `[TmuxSessionManager] Scheduling PTY reconnect for ${session.name} in ${delay}ms (attempt ${attempts + 1}/${PTY_RECONNECT_MAX_ATTEMPTS})`
    );

    // Notify clients about reconnection attempt
    const reconnectMsg = JSON.stringify({
      type: "output",
      data: `\r\n\x1b[33mReconnecting to terminal (attempt ${attempts + 1}/${PTY_RECONNECT_MAX_ATTEMPTS})...\x1b[0m\r\n`,
    });
    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(reconnectMsg);
      }
    }

    this.reconnectAttempts.set(session.name, attempts + 1);

    // Schedule reconnection
    const timeout = setTimeout(async () => {
      this.reconnectTimeouts.delete(session.name);

      // Check if session still exists and has clients
      const stillExists = await tmux.sessionExists(session.name);
      if (!stillExists) {
        console.log(`[TmuxSessionManager] Session ${session.name} no longer exists, aborting reconnect`);
        return;
      }

      if (session.clients.size === 0) {
        console.log(`[TmuxSessionManager] No clients for ${session.name}, aborting reconnect`);
        return;
      }

      if (session.pty) {
        console.log(`[TmuxSessionManager] PTY already attached for ${session.name}, skipping reconnect`);
        return;
      }

      try {
        await this.attachPty(session);

        // Notify clients of successful reconnection
        const successMsg = JSON.stringify({
          type: "output",
          data: `\x1b[32mReconnected to terminal\x1b[0m\r\n`,
        });
        for (const client of session.clients) {
          if (client.readyState === 1) {
            client.send(successMsg);
          }
        }
      } catch (err) {
        console.error(`[TmuxSessionManager] Failed to reconnect PTY for ${session.name}:`, err);
        // Try again
        await this.attemptPtyReconnect(session);
      }
    }, delay);

    this.reconnectTimeouts.set(session.name, timeout);
  }

  /**
   * Clean up exited sessions with no clients.
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const [name, session] of this.sessions) {
      if (
        session.status === "exited" &&
        session.clients.size === 0 &&
        now - session.lastActivity.getTime() > staleThreshold
      ) {
        this.sessions.delete(name);
        console.log(`[TmuxSessionManager] Cleaned up stale session: ${name}`);
      }
    }
  }

  /**
   * Shutdown the session manager.
   */
  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cancel all pending reconnection timeouts
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();
    this.reconnectAttempts.clear();

    // Kill all PTY attachments (but not the tmux sessions themselves)
    for (const session of this.sessions.values()) {
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {}
      }
    }

    // Flush Supabase output
    await supabase.shutdownSupabase();

    console.log("[TmuxSessionManager] Shutdown complete");
  }

  /**
   * Set activity state for a session (called by hooks).
   * @param name - Session name
   * @param state - New activity state
   * @param hookEvent - Original hook event (for task lifecycle tracking)
   * @param toolName - Tool name (for PreToolUse/PostToolUse)
   */
  setActivityState(
    name: string,
    state: ActivityState,
    hookEvent?: string,
    toolName?: string
  ): boolean {
    const session = this.sessions.get(name);
    if (!session || session.status === "exited") return false;

    const now = new Date();
    const prevState = session.activityState;

    // Track task lifecycle based on hook events and record events
    if (hookEvent === "UserPromptSubmit") {
      // New task starting - reset counters
      session.taskStartTime = now;
      session.toolUseCount = 0;
      session.tokenCount = 0;
      session.taskCompletedAt = null;
      session.currentTool = null;
      recordEvent(name, "task_start", { hookEvent });
    } else if (hookEvent === "PreToolUse" && toolName) {
      // Tool starting
      session.currentTool = toolName;
      session.toolUseCount++;
      recordEvent(name, "tool_start", { toolName, toolUseCount: session.toolUseCount });
    } else if (hookEvent === "PostToolUse") {
      // Tool finished - keep currentTool visible briefly, clear on next event
      recordEvent(name, "tool_complete", { toolName: session.currentTool });
    } else if (hookEvent === "Stop" || hookEvent === "Notification") {
      // Task completed
      if (prevState === "busy") {
        session.taskCompletedAt = now;
        recordEvent(name, "task_complete", {
          hookEvent,
          toolUseCount: session.toolUseCount,
          durationMs: session.taskStartTime
            ? now.getTime() - session.taskStartTime.getTime()
            : null,
        });
      }
      session.currentTool = null;
    }

    // Record state changes
    if (state !== prevState) {
      const eventType = state === "idle" ? "state_idle" : state === "busy" ? "state_busy" : null;
      if (eventType) {
        recordEvent(name, eventType, { prevState, hookEvent });
      }
    }

    session.activityState = state;
    session.lastActivity = now;

    // Build task status for broadcast
    const taskStatus: TaskStatus = {
      activityState: state,
      currentTool: session.currentTool,
      taskStartTime: session.taskStartTime?.toISOString() || null,
      toolUseCount: session.toolUseCount,
      tokenCount: session.tokenCount,
      taskCompletedAt: session.taskCompletedAt?.toISOString() || null,
    };

    // Broadcast to clients with full task status
    const message = JSON.stringify({ type: "activity", state, taskStatus });
    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }

    console.log(
      `[TmuxSessionManager] Session ${name} activity -> ${state}` +
        (toolName ? ` (tool: ${toolName})` : "") +
        (session.toolUseCount > 0 ? ` [${session.toolUseCount} tools]` : "")
    );

    // Persist to Supabase
    supabase.updateSessionStatus(name, {
      activityState: state,
      lastActivity: session.lastActivity,
      currentTool: session.currentTool,
      taskStartTime: session.taskStartTime,
      toolUseCount: session.toolUseCount,
      tokenCount: session.tokenCount,
      taskCompletedAt: session.taskCompletedAt,
    });

    return true;
  }

  /**
   * Get task status for a session.
   */
  getTaskStatus(name: string): TaskStatus | null {
    const session = this.sessions.get(name);
    if (!session) return null;

    return {
      activityState: session.activityState,
      currentTool: session.currentTool,
      taskStartTime: session.taskStartTime?.toISOString() || null,
      toolUseCount: session.toolUseCount,
      tokenCount: session.tokenCount,
      taskCompletedAt: session.taskCompletedAt?.toISOString() || null,
    };
  }

  /**
   * Find sessions by working directory (for Claude Code hook integration).
   */
  findByCwd(cwd: string): TmuxManagedSession[] {
    const normalizedCwd = cwd.replace(/\/+$/, "");
    const matches: TmuxManagedSession[] = [];

    for (const session of this.sessions.values()) {
      const sessionCwd = session.cwd.replace(/\/+$/, "");
      if (
        sessionCwd === normalizedCwd ||
        normalizedCwd.startsWith(sessionCwd + "/")
      ) {
        matches.push(session);
      }
    }

    return matches;
  }
}

// Singleton instance
export const tmuxSessionManager = new TmuxSessionManager();
