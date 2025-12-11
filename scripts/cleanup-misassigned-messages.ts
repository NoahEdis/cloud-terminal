#!/usr/bin/env npx tsx
/**
 * Cleanup Misassigned Claude Code Messages
 *
 * This script identifies and optionally removes messages that were incorrectly
 * associated with terminal sessions due to the CWD-based matching bug.
 *
 * The bug caused messages from different Claude Code instances to get mixed
 * when they ran in the same working directory.
 *
 * Detection heuristics:
 * 1. Messages appearing after a "final_output" with later timestamps
 * 2. Messages with different claude_session_id in metadata than the session's
 * 3. Duplicate tool sequences that suggest session mixing
 *
 * Usage:
 *   npx tsx scripts/cleanup-misassigned-messages.ts              # Dry run (analyze only)
 *   npx tsx scripts/cleanup-misassigned-messages.ts --delete     # Actually delete
 *   npx tsx scripts/cleanup-misassigned-messages.ts --session <id>  # Analyze specific session
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

// Load environment
const envFiles = [
  resolve(projectRoot, ".env.automation-engineer"),
  resolve(projectRoot, ".env"),
  resolve(__dirname, "../.env"),
  resolve(__dirname, "../web/.env.local"),
];
for (const envFile of envFiles) {
  if (existsSync(envFile)) {
    config({ path: envFile });
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface Message {
  id: string;
  session_id: string;
  message_type: string;
  content: string;
  tool_name: string | null;
  created_at: string;
  seq: number;
  metadata: Record<string, unknown> | null;
}

interface Session {
  id: string;
  metadata: Record<string, unknown> | null;
  cwd: string | null;
  created_at: string;
}

interface MisassignedMessage {
  message: Message;
  reason: string;
  session: Session;
}

async function getSessionsWithMessages(): Promise<Session[]> {
  const { data, error } = await supabase
    .from("terminal_sessions")
    .select("id, metadata, cwd, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch sessions:", error.message);
    return [];
  }

  return data || [];
}

async function getMessagesForSession(sessionId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("claude_code_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });

  if (error) {
    console.error(`Failed to fetch messages for ${sessionId}:`, error.message);
    return [];
  }

  return data || [];
}

function detectMisassignedMessages(
  session: Session,
  messages: Message[]
): MisassignedMessage[] {
  const misassigned: MisassignedMessage[] = [];
  const sessionClaudeId = (session.metadata as Record<string, unknown>)?.claude_session_id as string | undefined;

  // Track final_output messages
  let lastFinalOutputSeq = -1;
  let lastFinalOutputTime: Date | null = null;

  // First pass: find final_output messages
  for (const msg of messages) {
    if (msg.message_type === "final_output") {
      lastFinalOutputSeq = msg.seq;
      lastFinalOutputTime = new Date(msg.created_at);
    }
  }

  // Second pass: detect anomalies
  for (const msg of messages) {
    // Check 1: Messages appearing significantly after final_output
    // (more than 30 seconds after, suggesting a different session)
    if (lastFinalOutputTime && msg.seq > lastFinalOutputSeq) {
      const msgTime = new Date(msg.created_at);
      const timeDiff = msgTime.getTime() - lastFinalOutputTime.getTime();

      // If message is more than 30 seconds after final_output, it's suspicious
      if (timeDiff > 30000) {
        misassigned.push({
          message: msg,
          reason: `Appeared ${Math.round(timeDiff / 1000)}s after final_output (seq ${lastFinalOutputSeq})`,
          session,
        });
        continue;
      }
    }

    // Check 2: Messages with different claude_session_id in their metadata
    // (if the session has a claude_session_id set)
    if (sessionClaudeId && msg.metadata) {
      const msgClaudeId = msg.metadata.claude_session_id as string | undefined;
      if (msgClaudeId && msgClaudeId !== sessionClaudeId) {
        misassigned.push({
          message: msg,
          reason: `Different claude_session_id: message has ${msgClaudeId?.slice(0, 8)}..., session has ${sessionClaudeId.slice(0, 8)}...`,
          session,
        });
        continue;
      }
    }

    // Check 3: Tool sequences that restart unexpectedly
    // (e.g., user_prompt appearing after tool_use without a final_output in between)
    // This is more heuristic and might have false positives
  }

  return misassigned;
}

async function analyzeSession(sessionId: string): Promise<MisassignedMessage[]> {
  const { data: session } = await supabase
    .from("terminal_sessions")
    .select("id, metadata, cwd, created_at")
    .eq("id", sessionId)
    .single();

  if (!session) {
    console.error(`Session ${sessionId} not found`);
    return [];
  }

  const messages = await getMessagesForSession(sessionId);
  return detectMisassignedMessages(session, messages);
}

async function analyzeAllSessions(): Promise<MisassignedMessage[]> {
  const sessions = await getSessionsWithMessages();
  const allMisassigned: MisassignedMessage[] = [];

  console.log(`Analyzing ${sessions.length} sessions...\n`);

  for (const session of sessions) {
    const messages = await getMessagesForSession(session.id);
    if (messages.length === 0) continue;

    const misassigned = detectMisassignedMessages(session, messages);
    if (misassigned.length > 0) {
      console.log(`Session: ${session.id}`);
      console.log(`  CWD: ${session.cwd || "(unknown)"}`);
      console.log(`  Total messages: ${messages.length}`);
      console.log(`  Misassigned: ${misassigned.length}`);
      console.log("");

      allMisassigned.push(...misassigned);
    }
  }

  return allMisassigned;
}

async function deleteMessages(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;

  const { error, count } = await supabase
    .from("claude_code_messages")
    .delete()
    .in("id", messageIds);

  if (error) {
    console.error("Failed to delete messages:", error.message);
    return 0;
  }

  return count || messageIds.length;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes("--delete");
  const sessionIndex = args.indexOf("--session");
  const specificSession = sessionIndex !== -1 ? args[sessionIndex + 1] : null;

  console.log("=== Claude Code Message Cleanup Tool ===\n");

  let misassigned: MisassignedMessage[];

  if (specificSession) {
    console.log(`Analyzing session: ${specificSession}\n`);
    misassigned = await analyzeSession(specificSession);
  } else {
    misassigned = await analyzeAllSessions();
  }

  if (misassigned.length === 0) {
    console.log("No misassigned messages found.");
    return;
  }

  console.log("\n=== Misassigned Messages ===\n");

  // Group by session for display
  const bySession = new Map<string, MisassignedMessage[]>();
  for (const m of misassigned) {
    const existing = bySession.get(m.session.id) || [];
    existing.push(m);
    bySession.set(m.session.id, existing);
  }

  for (const [sessionId, messages] of bySession) {
    console.log(`\nSession: ${sessionId}`);
    console.log("-".repeat(60));

    for (const { message, reason } of messages) {
      const contentPreview = message.content.slice(0, 80).replace(/\n/g, " ");
      console.log(`  [${message.seq}] ${message.message_type}${message.tool_name ? ` (${message.tool_name})` : ""}`);
      console.log(`      Reason: ${reason}`);
      console.log(`      Content: ${contentPreview}${message.content.length > 80 ? "..." : ""}`);
      console.log(`      Time: ${message.created_at}`);
      console.log("");
    }
  }

  console.log(`\nTotal misassigned messages: ${misassigned.length}`);

  if (shouldDelete) {
    console.log("\nDeleting misassigned messages...");
    const messageIds = misassigned.map((m) => m.message.id);
    const deleted = await deleteMessages(messageIds);
    console.log(`Deleted ${deleted} messages.`);
  } else {
    console.log("\nDry run - no messages deleted.");
    console.log("Run with --delete to remove these messages.");
  }
}

main().catch(console.error);
