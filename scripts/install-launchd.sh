#!/bin/bash
# Install Cloud Terminal as launchd services (auto-start on login)
# Usage: ./scripts/install-launchd.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$LAUNCH_AGENTS_DIR"

# Copy plist files
echo "Installing launchd services..."
cp "$SCRIPT_DIR/com.cloudterminal.api.plist" "$LAUNCH_AGENTS_DIR/"
cp "$SCRIPT_DIR/com.cloudterminal.web.plist" "$LAUNCH_AGENTS_DIR/"

# Unload if already loaded (ignore errors)
launchctl unload "$LAUNCH_AGENTS_DIR/com.cloudterminal.api.plist" 2>/dev/null
launchctl unload "$LAUNCH_AGENTS_DIR/com.cloudterminal.web.plist" 2>/dev/null

# Load the services
echo "Loading services..."
launchctl load "$LAUNCH_AGENTS_DIR/com.cloudterminal.api.plist"
launchctl load "$LAUNCH_AGENTS_DIR/com.cloudterminal.web.plist"

echo ""
echo "============================================"
echo "Cloud Terminal launchd services installed!"
echo "============================================"
echo ""
echo "Services will start automatically on login."
echo ""
echo "To check status:"
echo "  launchctl list | grep cloudterminal"
echo ""
echo "To view logs:"
echo "  tail -f /tmp/cloudterminal-api.log"
echo "  tail -f /tmp/cloudterminal-web.log"
echo ""
echo "To stop services:"
echo "  launchctl unload ~/Library/LaunchAgents/com.cloudterminal.api.plist"
echo "  launchctl unload ~/Library/LaunchAgents/com.cloudterminal.web.plist"
echo ""
echo "To uninstall:"
echo "  ./scripts/uninstall-launchd.sh"
