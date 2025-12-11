/**
 * Types for structured Claude Code messages stored in Supabase.
 * These represent parsed, semantic messages from Claude Code sessions.
 */

export type MessageType =
  | "user_prompt"     // User's input to Claude
  | "assistant"       // Claude's response text
  | "user_question"   // AskUserQuestion tool invocation
  | "tool_use"        // Tool invocation (PreToolUse) - shows tool name and input
  | "tool_result"     // Tool result (PostToolUse) - shows tool output
  | "final_output"    // Final response when Claude stops
  | "error"           // Error messages
  | "system";         // System messages (startup, info, etc.)

export type ToolStatus = "pending" | "success" | "error";

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionMeta {
  header: string;
  multiSelect: boolean;
  questionId?: string;
  toolUseId?: string;
}

export interface ClaudeCodeMessage {
  id: string;
  session_id: string;
  message_type: MessageType;
  content: string;

  // For user_question type
  options?: QuestionOption[];
  question_meta?: QuestionMeta;
  user_response?: string;
  user_response_at?: string;

  // For tool_use type
  tool_name?: string;
  tool_status?: ToolStatus;

  // General metadata
  metadata?: Record<string, unknown>;

  // Timestamps and ordering
  created_at: string;
  seq: number;
}

// Message display configuration
export interface MessageDisplayConfig {
  showTimestamps: boolean;
  showToolDetails: boolean;
  collapseLongMessages: boolean;
  maxCollapsedLength: number;
}

export const defaultDisplayConfig: MessageDisplayConfig = {
  showTimestamps: true,
  showToolDetails: true,
  collapseLongMessages: true,
  maxCollapsedLength: 500,
};
