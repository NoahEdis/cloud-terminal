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

// Find or create terminal session UUID from Claude session ID
async function getTerminalSessionId(claudeSessionId: string): Promise<string | null> {
  // First, check if there's a terminal session with this claude session ID in metadata
  const { data: existing } = await supabase
    .from("terminal_sessions")
    .select("id")
    .eq("id", claudeSessionId)
    .single();

  if (existing) {
    return existing.id;
  }

  // Try to find by metadata
  const { data: byMeta } = await supabase
    .from("terminal_sessions")
    .select("id")
    .contains("metadata", { claude_session_id: claudeSessionId })
    .limit(1);

  if (byMeta && byMeta.length > 0) {
    return byMeta[0].id;
  }

  // Create a new session entry for this Claude session
  const { data: created, error } = await supabase
    .from("terminal_sessions")
    .insert({
      id: claudeSessionId,
      command: "claude",
      status: "running",
      activity_state: "busy",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create terminal session:", error.message);
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

  // Get or create terminal session
  const terminalSessionId = await getTerminalSessionId(session_id);
  if (!terminalSessionId) {
    console.error("Could not get terminal session ID");
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
