#!/usr/bin/env npx tsx
/**
 * Claude Code Message Hook
 *
 * Captures structured messages from Claude Code hooks and stores them in Supabase.
 * Specifically designed to capture:
 * - AskUserQuestion tool invocations (for Telegram integration)
 * - Final outputs (Stop events)
 * - User prompts
 *
 * Usage: Called from claude-hook.sh or directly from Claude Code hooks
 *
 * Environment variables:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for database access
 *   CLOUD_TERMINAL_API_URL - (optional) Cloud Terminal API for session lookup
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Get the script and project directories
const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptDir = __dirname;
const cloudTerminalDir = resolve(scriptDir, "..");
const projectRoot = resolve(scriptDir, "../..");

// Load env from various locations
const envFiles = [
  resolve(projectRoot, ".env.automation-engineer"),
  resolve(projectRoot, ".env"),
  resolve(cloudTerminalDir, ".env"),
  resolve(cloudTerminalDir, "web/.env.local"),
  resolve(cloudTerminalDir, "web/.env"),
];
for (const envFile of envFiles) {
  if (existsSync(envFile)) {
    config({ path: envFile });
    // Don't break - load all to allow overrides
  }
}

// Initialize Supabase client
// Try service role key first (preferred), fall back to anon key
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing Supabase environment variables. Need either:"
  );
  console.error("  - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred)");
  console.error("  - NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  console.error("Checked:", envFiles.join(", "));
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Types for hook context
interface HookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: string;

  // For PreToolUse
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;

  // For UserPromptSubmit
  prompt?: string;

  // For Notification
  message?: string;
  notification_type?: string;

  // For Stop
  stop_hook_active?: boolean;
}

interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

interface TranscriptEntry {
  type: "user" | "assistant" | "tool_result";
  uuid: string;
  timestamp: string;
  message?: {
    role: string;
    content: unknown[];
    stop_reason?: string;
  };
  toolUseResult?: {
    tool_use_id: string;
    content: unknown;
  };
  userMessage?: {
    content: string;
  };
}

// Detect the tmux session name if running inside tmux
function getTmuxSessionName(): string | null {
  // Check if we're running inside tmux
  if (!process.env.TMUX) {
    return null;
  }

  try {
    // Get the tmux session name using tmux command
    const sessionName = execSync("tmux display-message -p '#S'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (sessionName) {
      return sessionName;
    }
  } catch (error) {
    console.error("[MessageHook] Failed to get tmux session name:", error);
  }

  return null;
}

// Get session ID for storing messages
// Priority:
// 1) tmux session name (if running inside tmux)
// 2) Existing session with matching claude_session_id in metadata
// 3) Existing session with matching CWD
// 4) Create new session with Claude session ID (fallback)
async function getSessionId(claudeSessionId: string, cwd?: string): Promise<string | null> {
  const tmuxSessionName = getTmuxSessionName();

  if (tmuxSessionName) {
    // Using tmux session name as the primary identifier
    console.log(`[MessageHook] Using tmux session: ${tmuxSessionName}`);

    // Check if this tmux session exists in the database
    const { data: existing } = await supabase
      .from("terminal_sessions")
      .select("id, metadata")
      .eq("id", tmuxSessionName)
      .single();

    if (existing) {
      // Update metadata with Claude session ID if not already set
      const metadata = (existing.metadata as Record<string, unknown>) || {};
      if (!metadata.claude_session_id || metadata.claude_session_id !== claudeSessionId) {
        await supabase
          .from("terminal_sessions")
          .update({
            metadata: { ...metadata, claude_session_id: claudeSessionId },
          })
          .eq("id", tmuxSessionName);
        console.log(`[MessageHook] Associated Claude session ${claudeSessionId.slice(0, 8)}... with tmux session ${tmuxSessionName}`);
      }
      return existing.id;
    }

    // Tmux session doesn't exist in DB yet - create it
    // Note: In production, the tmux session should already exist (created by Cloud Terminal)
    // This is a fallback for when Claude Code starts before the session is registered
    const { data: created, error } = await supabase
      .from("terminal_sessions")
      .insert({
        id: tmuxSessionName,
        command: "claude",
        status: "running",
        activity_state: "busy",
        metadata: { claude_session_id: claudeSessionId },
      })
      .select("id")
      .single();

    if (error) {
      // Session might have been created by another process, try to fetch it
      const { data: retried } = await supabase
        .from("terminal_sessions")
        .select("id")
        .eq("id", tmuxSessionName)
        .single();

      if (retried) {
        return retried.id;
      }

      console.error("[MessageHook] Failed to create terminal session:", error.message);
      return null;
    }

    return created?.id || null;
  }

  // Not in tmux - try to find an existing session to associate with
  console.log(`[MessageHook] Not in tmux, looking for matching session...`);

  // Strategy 1: Check if there's already a session with this claude_session_id in metadata
  const { data: byMetadata } = await supabase
    .from("terminal_sessions")
    .select("id")
    .eq("metadata->>claude_session_id", claudeSessionId)
    .single();

  if (byMetadata) {
    console.log(`[MessageHook] Found session by claude_session_id: ${byMetadata.id}`);
    return byMetadata.id;
  }

  // Strategy 2: Find a session by matching CWD (most likely to be the correct one)
  if (cwd) {
    const normalizedCwd = cwd.replace(/\/+$/, "");
    const { data: byCwd } = await supabase
      .from("terminal_sessions")
      .select("id, metadata, cwd")
      .eq("cwd", normalizedCwd)
      .eq("status", "running")
      .order("last_activity", { ascending: false })
      .limit(1)
      .single();

    if (byCwd) {
      // Found a session with matching CWD - associate the Claude session ID with it
      const metadata = (byCwd.metadata as Record<string, unknown>) || {};
      if (!metadata.claude_session_id) {
        await supabase
          .from("terminal_sessions")
          .update({
            metadata: { ...metadata, claude_session_id: claudeSessionId },
          })
          .eq("id", byCwd.id);
        console.log(`[MessageHook] Associated Claude session ${claudeSessionId.slice(0, 8)}... with CWD-matched session ${byCwd.id}`);
      }
      console.log(`[MessageHook] Found session by CWD: ${byCwd.id}`);
      return byCwd.id;
    }
  }

  // Strategy 3: Check if session already exists with this Claude session ID as its ID
  const { data: existing } = await supabase
    .from("terminal_sessions")
    .select("id")
    .eq("id", claudeSessionId)
    .single();

  if (existing) {
    console.log(`[MessageHook] Using existing Claude session: ${claudeSessionId.slice(0, 8)}...`);
    return existing.id;
  }

  // Fallback: Create new session with Claude session ID
  console.log(`[MessageHook] Creating new session with Claude ID: ${claudeSessionId.slice(0, 8)}...`);
  const { data: created, error } = await supabase
    .from("terminal_sessions")
    .insert({
      id: claudeSessionId,
      command: "claude",
      cwd: cwd || process.env.HOME || "/",
      status: "running",
      activity_state: "busy",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[MessageHook] Failed to create terminal session:", error.message);
    return null;
  }

  return created?.id || null;
}

// Insert a message into the database
async function insertMessage(
  sessionId: string,
  messageType: string,
  content: string,
  options?: {
    options?: unknown[];
    questionMeta?: Record<string, unknown>;
    toolName?: string;
    toolStatus?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<string | null> {
  const { data, error } = await supabase.rpc("insert_claude_code_message", {
    p_session_id: sessionId,
    p_message_type: messageType,
    p_content: content,
    p_options: options?.options || null,
    p_question_meta: options?.questionMeta || null,
    p_tool_name: options?.toolName || null,
    p_tool_status: options?.toolStatus || null,
    p_metadata: options?.metadata || {},
  });

  if (error) {
    console.error("Failed to insert message:", error.message);
    return null;
  }

  return data;
}

// Parse the last N assistant messages from transcript to get final output
function getRecentAssistantOutput(transcriptPath: string, maxLines = 50): string {
  if (!existsSync(transcriptPath)) {
    return "";
  }

  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.trim().split("\n").slice(-maxLines);

  const textBlocks: string[] = [];

  for (const line of lines.reverse()) {
    try {
      const entry: TranscriptEntry = JSON.parse(line);
      if (entry.type === "assistant" && entry.message?.content) {
        for (const block of entry.message.content) {
          if (typeof block === "object" && "text" in block) {
            textBlocks.unshift((block as { text: string }).text);
          }
        }
        // Stop after finding the first (most recent) assistant message with text
        if (textBlocks.length > 0) break;
      }
    } catch {
      // Skip malformed lines
    }
  }

  return textBlocks.join("\n\n");
}

// Main handler
async function handleHookEvent(context: HookContext): Promise<void> {
  const { session_id, hook_event_name, transcript_path } = context;

  // Get session ID (tmux session name if available, otherwise match by CWD or Claude session ID)
  const terminalSessionId = await getSessionId(session_id, context.cwd);
  if (!terminalSessionId) {
    console.error("[MessageHook] Could not get session ID");
    return;
  }

  switch (hook_event_name) {
    case "PreToolUse": {
      // Check if this is AskUserQuestion
      if (context.tool_name === "AskUserQuestion" && context.tool_input) {
        const input = context.tool_input as unknown as AskUserQuestionInput;

        for (const question of input.questions || []) {
          const content = question.question;
          const options = question.options.map((opt) => ({
            label: opt.label,
            description: opt.description,
          }));

          await insertMessage(terminalSessionId, "user_question", content, {
            options,
            questionMeta: {
              header: question.header,
              multiSelect: question.multiSelect,
              toolUseId: context.tool_use_id,
            },
          });

          console.log(`[MessageHook] Captured AskUserQuestion: "${question.header}"`);
        }
      }
      break;
    }

    case "UserPromptSubmit": {
      if (context.prompt) {
        await insertMessage(terminalSessionId, "user_prompt", context.prompt);
        console.log(`[MessageHook] Captured user prompt`);
      }
      break;
    }

    case "Stop": {
      // Capture final output from the transcript
      const finalOutput = getRecentAssistantOutput(transcript_path);
      if (finalOutput) {
        await insertMessage(terminalSessionId, "final_output", finalOutput, {
          metadata: { stopHookActive: context.stop_hook_active },
        });
        console.log(`[MessageHook] Captured final output (${finalOutput.length} chars)`);
      }
      break;
    }

    case "Notification": {
      // Only capture certain notification types
      if (context.notification_type === "error") {
        await insertMessage(
          terminalSessionId,
          "error",
          context.message || "Unknown error"
        );
        console.log(`[MessageHook] Captured error notification`);
      }
      break;
    }
  }
}

// Read hook context from stdin and process
async function main(): Promise<void> {
  const chunks: Buffer[] = [];

  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", async () => {
    const input = Buffer.concat(chunks).toString("utf-8").trim();

    if (!input) {
      console.error("No input received on stdin");
      process.exit(1);
    }

    try {
      const context: HookContext = JSON.parse(input);
      await handleHookEvent(context);
    } catch (error) {
      console.error(
        "Failed to parse hook context:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
}

main();
