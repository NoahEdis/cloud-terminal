#!/bin/bash
# Claude Code hook script - sends activity state updates to Cloud Terminal API
#
# This script is called by Claude Code hooks to report activity state changes.
# It reads JSON from stdin (Claude Code hook context) and posts to the terminal API.
#
# Usage: Configure in ~/.claude/settings.json hooks section
#
# Environment variables:
#   CLOUD_TERMINAL_API_URL - API URL (default: http://localhost:3000)
#   CLOUD_TERMINAL_API_KEY - API key for authentication (optional)

set -e

# Debug logging (can be removed after testing)
LOG_FILE="/tmp/claude-hook.log"
echo "$(date): Hook called with args: $@" >> "$LOG_FILE"

# Configuration - default to localhost since hooks run on the same machine as server
API_URL="${CLOUD_TERMINAL_API_URL:-http://localhost:3000}"
API_KEY="${CLOUD_TERMINAL_API_KEY:-}"

# Get event type from first argument
EVENT_TYPE="$1"

if [ -z "$EVENT_TYPE" ]; then
  echo "Usage: $0 <event_type>" >&2
  exit 1
fi

# Read hook context from stdin
HOOK_CONTEXT=$(cat)
echo "$(date): Hook context: $HOOK_CONTEXT" >> "$LOG_FILE"

# Detect tmux session name - this is the KEY fix for per-session activity tracking
# If we're running inside tmux, get the session name directly
TMUX_SESSION_NAME=""
if [ -n "$TMUX" ]; then
  # We're inside tmux, get the current session name
  TMUX_SESSION_NAME=$(tmux display-message -p '#S' 2>/dev/null || true)
  echo "$(date): Detected tmux session: $TMUX_SESSION_NAME" >> "$LOG_FILE"
fi

# Extract cwd from hook context (JSON parsing with jq if available, otherwise grep)
if command -v jq &> /dev/null; then
  CWD=$(echo "$HOOK_CONTEXT" | jq -r '.cwd // empty')
  TOOL_NAME=$(echo "$HOOK_CONTEXT" | jq -r '.tool_name // empty')
  SESSION_ID=$(echo "$HOOK_CONTEXT" | jq -r '.session_id // empty')
else
  # Fallback: simple grep-based extraction
  CWD=$(echo "$HOOK_CONTEXT" | grep -oP '"cwd"\s*:\s*"\K[^"]+' || true)
  TOOL_NAME=$(echo "$HOOK_CONTEXT" | grep -oP '"tool_name"\s*:\s*"\K[^"]+' || true)
  SESSION_ID=$(echo "$HOOK_CONTEXT" | grep -oP '"session_id"\s*:\s*"\K[^"]+' || true)
fi

# Build JSON payload - prioritize session_name for accurate per-terminal tracking
PAYLOAD="{\"event\":\"$EVENT_TYPE\""
# IMPORTANT: session_name takes priority over cwd for precise targeting
[ -n "$TMUX_SESSION_NAME" ] && PAYLOAD="$PAYLOAD,\"session_name\":\"$TMUX_SESSION_NAME\""
[ -n "$TOOL_NAME" ] && PAYLOAD="$PAYLOAD,\"tool_name\":\"$TOOL_NAME\""
[ -n "$SESSION_ID" ] && PAYLOAD="$PAYLOAD,\"session_id\":\"$SESSION_ID\""
# Only include cwd as fallback if no tmux session detected
[ -z "$TMUX_SESSION_NAME" ] && [ -n "$CWD" ] && PAYLOAD="$PAYLOAD,\"cwd\":\"$CWD\""
PAYLOAD="$PAYLOAD}"
echo "$(date): Sending payload: $PAYLOAD to $API_URL/api/hook" >> "$LOG_FILE"

# Build curl command
CURL_ARGS=(-s -X POST "$API_URL/api/hook" -H "Content-Type: application/json" -d "$PAYLOAD")

# Add authorization header if API key is set
if [ -n "$API_KEY" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer $API_KEY")
fi

# Send request (async - don't wait for response to avoid slowing down Claude Code)
curl "${CURL_ARGS[@]}" > /dev/null 2>&1 &

# Also send to message hook for structured message capture (Telegram integration)
# Only for relevant events: PreToolUse (for AskUserQuestion), UserPromptSubmit, Stop, Notification
SCRIPT_DIR="$(dirname "$0")"
if [ "$EVENT_TYPE" = "PreToolUse" ] || [ "$EVENT_TYPE" = "UserPromptSubmit" ] || [ "$EVENT_TYPE" = "Stop" ] || [ "$EVENT_TYPE" = "Notification" ]; then
  # Pass the full hook context to the message hook
  echo "$HOOK_CONTEXT" | npx tsx "$SCRIPT_DIR/claude-message-hook.ts" > /dev/null 2>&1 &
fi

# Exit successfully - we don't want hook failures to block Claude Code
exit 0
