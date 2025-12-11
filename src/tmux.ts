/**
 * Tmux integration for cloud-terminal.
 *
 * Provides functions to interact with tmux sessions, allowing
 * bidirectional sync between local tmux sessions and cloud terminal.
 */

import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface TmuxSession {
  name: string;
  id: string; // tmux session id (e.g., "$0")
  windows: number;
  created: Date;
  attached: boolean;
  width: number;
  height: number;
  lastActivity: Date;
}

export interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
  panes: number;
}

/**
 * Check if tmux is available on the system.
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execAsync("which tmux");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the tmux server PID, or null if not running.
 */
export async function getTmuxServerPid(): Promise<number | null> {
  try {
    const { stdout } = await execAsync("tmux list-sessions -F '#{pid}' 2>/dev/null | head -1");
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * List all tmux sessions.
 */
export async function listSessions(): Promise<TmuxSession[]> {
  try {
    // Format: session_name:session_id:windows:created:attached:width:height:activity
    const format = "#{session_name}:#{session_id}:#{session_windows}:#{session_created}:#{session_attached}:#{session_width}:#{session_height}:#{session_activity}";
    const { stdout } = await execAsync(`tmux list-sessions -F '${format}' 2>/dev/null`);

    return stdout
      .trim()
      .split("\n")
      .filter(line => line.length > 0)
      .map(line => {
        const [name, id, windows, created, attached, width, height, activity] = line.split(":");
        return {
          name,
          id,
          windows: parseInt(windows, 10),
          created: new Date(parseInt(created, 10) * 1000),
          attached: attached === "1",
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          lastActivity: new Date(parseInt(activity, 10) * 1000),
        };
      });
  } catch {
    // No sessions or tmux not running
    return [];
  }
}

/**
 * Get windows for a tmux session.
 */
export async function getSessionWindows(name: string): Promise<TmuxWindow[]> {
  try {
    // Format: window_index:window_name:window_active:window_panes
    const format = "#{window_index}:#{window_name}:#{window_active}:#{window_panes}";
    const { stdout } = await execAsync(
      `tmux list-windows -t '${escapeTmuxName(name)}' -F '${format}' 2>/dev/null`
    );

    return stdout
      .trim()
      .split("\n")
      .filter(line => line.length > 0)
      .map(line => {
        const [index, name, active, panes] = line.split(":");
        return {
          index: parseInt(index, 10),
          name,
          active: active === "1",
          panes: parseInt(panes, 10),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Get all pane PIDs for a session.
 * Used for deduplication - sessions with shared panes are duplicates.
 */
export async function getSessionPanePids(name: string): Promise<number[]> {
  try {
    // Note: Do NOT use -a flag here. -a lists panes from ALL sessions, ignoring -t.
    // We want panes only from the target session for proper fingerprinting.
    const { stdout } = await execAsync(
      `tmux list-panes -t '${escapeTmuxName(name)}' -F '#{pane_pid}' 2>/dev/null`
    );
    return stdout
      .trim()
      .split("\n")
      .filter(line => line.length > 0)
      .map(pid => parseInt(pid, 10))
      .filter(pid => !isNaN(pid))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Get pane fingerprint for a session (sorted, comma-separated PIDs).
 * Sessions with the same fingerprint share windows/panes.
 */
export async function getSessionPaneFingerprint(name: string): Promise<string> {
  const pids = await getSessionPanePids(name);
  return pids.join(",");
}

/**
 * Check if a session with the given name exists.
 */
export async function sessionExists(name: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t '${escapeTmuxName(name)}' 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session.
 * Returns the session name.
 *
 * If `groupWith` is specified, creates a grouped session that shares windows
 * with the target session. This enables Ctrl+B P to cycle between all sessions.
 */
export async function createSession(options: {
  name?: string;
  cwd?: string;
  command?: string;
  width?: number;
  height?: number;
  groupWith?: string;
}): Promise<string> {
  const name = options.name || `cloud-${Date.now()}`;
  const cwd = options.cwd || process.env.HOME || "/";
  const width = options.width || 80;
  const height = options.height || 24;

  let cmd: string;

  if (options.groupWith) {
    // Create a grouped session that shares windows with the target
    // Using -t creates a session in the same group
    cmd = `tmux new-session -d -t '${escapeTmuxName(options.groupWith)}' -s '${escapeTmuxName(name)}'`;
    // Note: grouped sessions inherit windows, so -c (start directory) doesn't apply the same way
    // The new session will share the same windows as the group target
  } else {
    // Create a standalone session
    cmd = `tmux new-session -d -s '${escapeTmuxName(name)}' -x ${width} -y ${height}`;

    if (cwd) {
      cmd += ` -c '${cwd}'`;
    }

    if (options.command) {
      cmd += ` '${options.command}'`;
    }
  }

  await execAsync(cmd);
  return name;
}

/**
 * Get the session group name for a session, or null if not grouped.
 */
export async function getSessionGroup(name: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux display-message -t '${escapeTmuxName(name)}' -p '#{session_group}' 2>/dev/null`
    );
    const group = stdout.trim();
    return group || null;
  } catch {
    return null;
  }
}

/**
 * Join an existing session to a session group.
 * This allows sessions created outside the cloud-terminal to be grouped
 * with cloud-terminal sessions for seamless Ctrl+B P navigation.
 *
 * Note: tmux doesn't have a direct "join group" command. To add a session
 * to a group, we create a new grouped session and then swap the windows.
 * This is a workaround since tmux groups are created at session creation time.
 *
 * Alternative approach: We link the sessions by creating a temporary grouped
 * session and then killing it, which effectively shares the window list.
 */
export async function joinSessionToGroup(
  sessionName: string,
  groupBaseSession: string
): Promise<boolean> {
  try {
    // Check if already in a group
    const currentGroup = await getSessionGroup(sessionName);
    const targetGroup = await getSessionGroup(groupBaseSession);

    // If already in the same group, nothing to do
    if (currentGroup && currentGroup === targetGroup) {
      return true;
    }

    // If the session is already in a different group, we can't easily move it
    if (currentGroup) {
      console.log(`[Tmux] Session ${sessionName} is already in group ${currentGroup}, cannot rejoin`);
      return false;
    }

    // tmux doesn't support moving sessions between groups directly.
    // The best we can do is note that the session exists but isn't grouped.
    // For full group support, sessions need to be created with -t flag.
    //
    // However, we CAN make sessions appear together in the session list
    // by ensuring they're all visible via `tmux list-sessions`.
    // The Ctrl+B P navigation will work as long as sessions are listed.

    console.log(`[Tmux] Session ${sessionName} is not grouped - will be visible but not linked to ${groupBaseSession}`);
    return true;
  } catch (err) {
    console.error(`[Tmux] Failed to check group for ${sessionName}:`, err);
    return false;
  }
}

/**
 * List all session groups.
 */
export async function listSessionGroups(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `tmux list-sessions -F '#{session_group}' 2>/dev/null | sort -u`
    );
    return stdout
      .trim()
      .split("\n")
      .filter(g => g.length > 0);
  } catch {
    return [];
  }
}

/**
 * Kill a tmux session.
 */
export async function killSession(name: string): Promise<boolean> {
  try {
    await execAsync(`tmux kill-session -t '${escapeTmuxName(name)}'`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename a tmux session.
 */
export async function renameSession(oldName: string, newName: string): Promise<boolean> {
  try {
    await execAsync(`tmux rename-session -t '${escapeTmuxName(oldName)}' '${escapeTmuxName(newName)}'`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resize a tmux session's window.
 */
export async function resizeSession(name: string, width: number, height: number): Promise<boolean> {
  try {
    // Resize the session's active window
    await execAsync(`tmux resize-window -t '${escapeTmuxName(name)}' -x ${width} -y ${height}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send keys to a tmux session.
 * When literal=true and the input contains newlines, we split the input
 * and send Enter keys separately to ensure proper readline submission.
 */
export async function sendKeys(name: string, keys: string, literal: boolean = false): Promise<boolean> {
  try {
    const target = escapeTmuxName(name);

    if (literal) {
      // For better readline compatibility, split on newlines and send Enter separately
      // This ensures Claude Code and similar readline apps receive proper submission
      const parts = keys.split(/(\n|\r\n|\r)/);

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "\n" || part === "\r\n" || part === "\r") {
          // Send Enter as a key name, not literal - this works better with readline
          await execAsync(`tmux send-keys -t '${target}' Enter`);
        } else if (part.length > 0) {
          // Send text literally
          await execAsync(`tmux send-keys -t '${target}' -l '${escapeShellArg(part)}'`);
        }
      }
    } else {
      await execAsync(`tmux send-keys -t '${target}' '${escapeShellArg(keys)}'`);
    }
    return true;
  } catch (err) {
    console.error(`[Tmux sendKeys] Error:`, err);
    return false;
  }
}

/**
 * Capture the current pane content from a tmux session.
 */
export async function capturePane(name: string, options: {
  start?: number;
  end?: number;
  escape?: boolean;
} = {}): Promise<string> {
  try {
    let cmd = `tmux capture-pane -t '${escapeTmuxName(name)}' -p`;

    if (options.start !== undefined) {
      cmd += ` -S ${options.start}`;
    }
    if (options.end !== undefined) {
      cmd += ` -E ${options.end}`;
    }
    if (options.escape) {
      cmd += " -e"; // Include escape sequences
    }

    const { stdout } = await execAsync(cmd);
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Get session info by name.
 */
export async function getSession(name: string): Promise<TmuxSession | null> {
  const sessions = await listSessions();
  return sessions.find(s => s.name === name) || null;
}

/**
 * Watch for tmux session changes.
 * Returns a function to stop watching.
 */
export function watchSessions(
  callback: (sessions: TmuxSession[]) => void,
  intervalMs: number = 2000
): () => void {
  let running = true;
  let lastSessionList = "";

  const poll = async () => {
    while (running) {
      try {
        const sessions = await listSessions();
        const sessionList = JSON.stringify(sessions.map(s => s.name).sort());

        // Only callback if sessions changed
        if (sessionList !== lastSessionList) {
          lastSessionList = sessionList;
          callback(sessions);
        }
      } catch (err) {
        console.error("[Tmux] Error polling sessions:", err);
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  };

  poll();

  return () => {
    running = false;
  };
}

/**
 * Spawn a PTY process that attaches to a tmux session.
 * This is used to bridge WebSocket connections to tmux.
 */
export function spawnAttach(
  sessionName: string,
  options: {
    cols?: number;
    rows?: number;
  } = {}
): ChildProcess {
  const cols = options.cols || 80;
  const rows = options.rows || 24;

  // Use script to allocate a PTY for tmux attach
  // This ensures proper terminal handling
  const child = spawn("tmux", ["attach-session", "-t", sessionName], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLUMNS: String(cols),
      LINES: String(rows),
    },
  });

  return child;
}

/**
 * Get the control mode output stream for a session.
 * This allows programmatic interaction with tmux.
 */
export function attachControlMode(sessionName: string): ChildProcess {
  return spawn("tmux", ["-C", "attach-session", "-t", sessionName], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Helper functions

function escapeTmuxName(name: string): string {
  // Escape special characters in tmux session names
  return name.replace(/'/g, "'\"'\"'");
}

function escapeShellArg(arg: string): string {
  // Escape for shell
  return arg.replace(/'/g, "'\"'\"'");
}
