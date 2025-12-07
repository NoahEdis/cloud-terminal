#!/bin/bash
# Uninstall Cloud Terminal launchd services
# Usage: ./scripts/uninstall-launchd.sh

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

echo "Stopping services..."
launchctl unload "$LAUNCH_AGENTS_DIR/com.cloudterminal.api.plist" 2>/dev/null
launchctl unload "$LAUNCH_AGENTS_DIR/com.cloudterminal.web.plist" 2>/dev/null

echo "Removing plist files..."
rm -f "$LAUNCH_AGENTS_DIR/com.cloudterminal.api.plist"
rm -f "$LAUNCH_AGENTS_DIR/com.cloudterminal.web.plist"

echo "Cloud Terminal launchd services uninstalled."
