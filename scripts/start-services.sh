#!/bin/bash
# Start Cloud Terminal services bound to Tailscale IP
# Usage: ./scripts/start-services.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Get Tailscale IP
TAILSCALE_IP=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null || tailscale ip -4 2>/dev/null)

if [ -z "$TAILSCALE_IP" ]; then
    echo "Error: Tailscale not connected or IP not available"
    exit 1
fi

echo "Tailscale IP: $TAILSCALE_IP"

# Kill any existing processes on our ports
lsof -ti :3000 | xargs kill -9 2>/dev/null
lsof -ti :3001 | xargs kill -9 2>/dev/null

# Start backend API
echo "Starting backend API on $TAILSCALE_IP:3000..."
cd "$PROJECT_DIR"
TAILSCALE=true npm run dev &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to start
sleep 3

# Start web UI
echo "Starting web UI on $TAILSCALE_IP:3001..."
cd "$PROJECT_DIR/web"
npm run dev -- --hostname "$TAILSCALE_IP" --port 3001 &
WEB_PID=$!
echo "Web UI PID: $WEB_PID"

echo ""
echo "============================================"
echo "Cloud Terminal is running!"
echo "============================================"
echo ""
echo "Backend API:  http://$TAILSCALE_IP:3000"
echo "Web UI:       http://$TAILSCALE_IP:3001"
echo ""
echo "Access from any device on your Tailscale network."
echo "Press Ctrl+C to stop both services."
echo ""

# Wait for both processes
wait $BACKEND_PID $WEB_PID
