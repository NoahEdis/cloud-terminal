#!/bin/bash
# Cloud Terminal Server Startup Script
# This script sources the environment and starts the server
# Used by launchd for auto-start and keep-alive

set -e

# Navigate to the project directory
cd /Users/noahedis/new-mcp-structure/cloud-terminal

# Set up Node.js path (nvm)
export PATH="/Users/noahedis/.nvm/versions/node/v22.18.0/bin:$PATH"
export HOME="/Users/noahedis"

# Source environment variables
if [ -f ".env.local" ]; then
    set -a
    source .env.local
    set +a
fi

# Ensure tmux is available
export PATH="/opt/homebrew/bin:$PATH"

# Default values (if not set in .env.local)
export PORT="${PORT:-31337}"
export HOST="${HOST:-0.0.0.0}"
export MODE="${MODE:-tmux}"
export NODE_ENV="${NODE_ENV:-production}"

# Check if the port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[start-server.sh] Port $PORT is already in use. Exiting."
    exit 0
fi

echo "[start-server.sh] Starting Cloud Terminal Server on port $PORT..."
exec node dist/index.js
