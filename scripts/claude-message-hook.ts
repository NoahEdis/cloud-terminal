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

  // For PreToolUse and PostToolUse
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;

  // For PostToolUse - tool response/result
  tool_response?: string | Record<string, unknown>;

  // For UserPromptSubmit - Claude Code may use either format
  prompt?: string;
  user_message?: {
    content?: string;
    role?: string;
  };

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
// 1) tmux session name (if running inside tmux) - DEFINITIVE match
// 2) Existing session with matching claude_session_id in metadata
// 3) Existing session with Claude session ID as its ID
// 4) Create new session with Claude session ID (fallback)
//
// NOTE: CWD-based matching is intentionally DISABLED to prevent cross-session
// message contamination when multiple Claude instances run in the same directory.
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

  // Strategy 1: Check if there's already a session with this exact claude_session_id in metadata
  // This is the most reliable match - same Claude Code instance
  const { data: byMetadata } = await supabase
    .from("terminal_sessions")
    .select("id")
    .eq("metadata->>claude_session_id", claudeSessionId)
    .single();

  if (byMetadata) {
    console.log(`[MessageHook] Found session by claude_session_id: ${byMetadata.id}`);
    return byMetadata.id;
  }

  // Strategy 2: Check if session already exists with this Claude session ID as its ID
  const { data: existingById } = await supabase
    .from("terminal_sessions")
    .select("id")
    .eq("id", claudeSessionId)
    .single();

  if (existingById) {
    console.log(`[MessageHook] Using existing Claude session: ${claudeSessionId.slice(0, 8)}...`);
    return existingById.id;
  }

  // Strategy 3: DISABLED - CWD-based matching is unreliable
  // When multiple Claude instances run in the same directory, CWD matching causes
  // messages from different Claude sessions to get mixed together.
  // Instead, we now ONLY use:
  //   1. Tmux session name (definitive match)
  //   2. Exact claude_session_id match in metadata
  //   3. Exact session ID match
  //   4. Create a new session (fallback)
  //
  // This ensures each Claude Code instance gets its own message stream.
  console.log(`[MessageHook] No tmux session and no existing match for Claude ID ${claudeSessionId.slice(0, 8)}...`);

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
      metadata: { claude_session_id: claudeSessionId },
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

// Update a tool_use message's status when PostToolUse fires
async function updateToolUseStatus(
  sessionId: string,
  toolUseId: string,
  status: "success" | "error"
): Promise<boolean> {
  // Find the tool_use message with this toolUseId and update its status
  const { error } = await supabase
    .from("claude_code_messages")
    .update({ tool_status: status })
    .eq("session_id", sessionId)
    .eq("message_type", "tool_use")
    .eq("tool_status", "pending")
    .filter("metadata->>toolUseId", "eq", toolUseId);

  if (error) {
    console.error("Failed to update tool_use status:", error.message);
    return false;
  }

  return true;
}

// Format tool input for display based on tool type
function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return `\`\`\`bash\n${input.command || ""}\n\`\`\``;

    case "Read":
      return `Reading file: \`${input.file_path || ""}\``;

    case "Write":
      const writeContent = String(input.content || "").substring(0, 500);
      const truncated = String(input.content || "").length > 500 ? "\n... (truncated)" : "";
      return `Writing to: \`${input.file_path || ""}\`\n\`\`\`\n${writeContent}${truncated}\n\`\`\``;

    case "Edit":
      return `Editing: \`${input.file_path || ""}\`\nReplacing:\n\`\`\`\n${String(input.old_string || "").substring(0, 200)}\n\`\`\`\nWith:\n\`\`\`\n${String(input.new_string || "").substring(0, 200)}\n\`\`\``;

    case "Glob":
      return `Glob pattern: \`${input.pattern || ""}\`${input.path ? ` in \`${input.path}\`` : ""}`;

    case "Grep":
      return `Grep pattern: \`${input.pattern || ""}\`${input.path ? ` in \`${input.path}\`` : ""}`;

    case "Task":
      return `Spawning agent: ${input.description || "task"}\n${input.prompt ? `Prompt: ${String(input.prompt).substring(0, 300)}...` : ""}`;

    case "WebFetch":
      return `Fetching: ${input.url || ""}`;

    case "WebSearch":
      return `Searching: ${input.query || ""}`;

    case "TodoWrite":
      const todos = input.todos as Array<{ content: string; status: string }> | undefined;
      if (todos && Array.isArray(todos)) {
        return `Updating todos:\n${todos.map((t) => `- [${t.status}] ${t.content}`).join("\n")}`;
      }
      return "Updating todo list";

    default:
      // For unknown tools, show a formatted JSON summary
      const summary = JSON.stringify(input, null, 2);
      if (summary.length > 500) {
        return `Tool input:\n\`\`\`json\n${summary.substring(0, 500)}...\n\`\`\``;
      }
      return `Tool input:\n\`\`\`json\n${summary}\n\`\`\``;
  }
}

// Format tool result for display
function formatToolResult(toolName: string, response: string | Record<string, unknown> | undefined): string {
  if (response === undefined || response === null) {
    return "(no output)";
  }

  // If it's already a string, use it directly
  if (typeof response === "string") {
    return response;
  }

  // For objects, format based on tool type
  switch (toolName) {
    case "Bash":
      // Bash results often have stdout/stderr
      if ("stdout" in response) {
        const stdout = String(response.stdout || "");
        const stderr = String(response.stderr || "");
        if (stderr && stdout) {
          return `${stdout}\n\n**stderr:**\n${stderr}`;
        }
        return stdout || stderr || "(no output)";
      }
      break;

    case "Glob":
      // Glob returns file list
      if (Array.isArray(response)) {
        const files = response as string[];
        if (files.length === 0) return "(no files found)";
        if (files.length <= 20) return files.join("\n");
        return `${files.slice(0, 20).join("\n")}\n... and ${files.length - 20} more files`;
      }
      break;

    case "Grep":
      // Grep returns matches
      if (Array.isArray(response)) {
        const matches = response as string[];
        if (matches.length === 0) return "(no matches)";
        if (matches.length <= 30) return matches.join("\n");
        return `${matches.slice(0, 30).join("\n")}\n... and ${matches.length - 30} more matches`;
      }
      break;

    case "Edit":
      // Edit returns success/failure info
      if ("filePath" in response || "file_path" in response) {
        const filePath = String(response.filePath || response.file_path || "");
        return `Edited \`${filePath}\``;
      }
      return "Edit completed";

    case "Write":
      // Write returns file path
      if ("filePath" in response || "file_path" in response) {
        const filePath = String(response.filePath || response.file_path || "");
        return `Wrote \`${filePath}\``;
      }
      return "Write completed";

    case "Read":
      // Read returns file content - truncate for display
      if ("content" in response) {
        const content = String(response.content || "");
        if (content.length > 500) {
          return `\`\`\`\n${content.substring(0, 500)}...\n\`\`\`\n(${content.length} total characters)`;
        }
        return `\`\`\`\n${content}\n\`\`\``;
      }
      break;

    case "WebFetch":
      // WebFetch returns fetched content summary
      if ("content" in response) {
        const content = String(response.content || "");
        if (content.length > 500) {
          return `${content.substring(0, 500)}...\n\n(${content.length} total characters)`;
        }
        return content;
      }
      break;

    case "WebSearch":
      // WebSearch returns search results
      if ("results" in response && Array.isArray(response.results)) {
        const results = response.results as Array<{ title?: string; url?: string; snippet?: string }>;
        if (results.length === 0) return "(no results)";
        return results
          .slice(0, 5)
          .map((r, i) => `${i + 1}. **${r.title || "Untitled"}**\n   ${r.url || ""}\n   ${r.snippet || ""}`)
          .join("\n\n");
      }
      break;

    case "Task":
      // Task (agent) returns completion info
      if ("result" in response) {
        return String(response.result || "Task completed");
      }
      return "Task completed";

    case "TodoWrite":
      // TodoWrite returns updated list
      return "Todo list updated";

    case "AskUserQuestion":
      // Should be handled separately, but just in case
      return "Question asked";
  }

  // Default: show formatted JSON
  const keys = Object.keys(response);
  if (keys.length === 0) {
    return "(empty response)";
  }

  // Helper to safely stringify values
  const stringify = (val: unknown): string => {
    if (val === null || val === undefined) return "null";
    if (typeof val === "string") return val.length > 200 ? val.substring(0, 200) + "..." : val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (Array.isArray(val)) {
      if (val.length === 0) return "[]";
      if (val.length <= 3) return JSON.stringify(val);
      return `[${val.length} items]`;
    }
    if (typeof val === "object") {
      const objKeys = Object.keys(val);
      if (objKeys.length === 0) return "{}";
      return `{${objKeys.slice(0, 3).join(", ")}${objKeys.length > 3 ? ", ..." : ""}}`;
    }
    return String(val);
  };

  if (keys.length <= 5) {
    // Small object - show key: value pairs
    return keys.map(k => `**${k}:** ${stringify((response as Record<string, unknown>)[k])}`).join("\n");
  }

  // Larger object - show as truncated JSON
  const json = JSON.stringify(response, null, 2);
  if (json.length > 1000) {
    return `\`\`\`json\n${json.substring(0, 1000)}...\n\`\`\``;
  }
  return `\`\`\`json\n${json}\n\`\`\``;
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
          if (block && typeof block === "object" && "text" in block) {
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
      const toolName = context.tool_name || "unknown";

      // Special handling for AskUserQuestion - store as user_question type
      if (toolName === "AskUserQuestion" && context.tool_input) {
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
      } else {
        // Capture ALL other tool invocations as tool_use
        const toolInput = context.tool_input || {};

        // Format the tool input for display
        let content = formatToolInput(toolName, toolInput);

        await insertMessage(terminalSessionId, "tool_use", content, {
          toolName,
          toolStatus: "pending",
          metadata: {
            toolUseId: context.tool_use_id,
            toolInput: toolInput,
          },
        });

        console.log(`[MessageHook] Captured tool_use: ${toolName}`);
      }
      break;
    }

    case "PostToolUse": {
      const toolName = context.tool_name || "unknown";

      // Skip AskUserQuestion results - the response is handled separately
      if (toolName === "AskUserQuestion") {
        break;
      }

      // Update the original tool_use message's status to success
      if (context.tool_use_id) {
        await updateToolUseStatus(terminalSessionId, context.tool_use_id, "success");
      }

      // Capture tool results
      const toolResponse = context.tool_response;
      let content = formatToolResult(toolName, toolResponse);

      // Truncate very long results (e.g., file contents)
      const maxLength = 10000;
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + `\n\n... (truncated, ${content.length - maxLength} more characters)`;
      }

      await insertMessage(terminalSessionId, "tool_result", content, {
        toolName,
        toolStatus: "success",
        metadata: {
          toolUseId: context.tool_use_id,
        },
      });

      console.log(`[MessageHook] Captured tool_result: ${toolName} (${content.length} chars)`);
      break;
    }

    case "UserPromptSubmit": {
      // Claude Code sends user_message.content for the prompt text
      const promptText = context.prompt || context.user_message?.content;
      if (promptText) {
        await insertMessage(terminalSessionId, "user_prompt", promptText);
        console.log(`[MessageHook] Captured user prompt: "${promptText.slice(0, 50)}..."`);
      } else {
        console.log(`[MessageHook] UserPromptSubmit received but no prompt text found. Context keys: ${Object.keys(context).join(", ")}`);
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
