#!/bin/bash
# Setup script for cloud-terminal launchd service
# This ensures the server runs persistently and auto-restarts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.cloud-terminal.server.plist"
PLIST_SOURCE="$PROJECT_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }

case "${1:-install}" in
  install)
    echo "Installing cloud-terminal as a persistent service..."

    # Build the project first
    echo "Building project..."
    cd "$PROJECT_DIR"
    npm run build
    print_status "Project built"

    # Create LaunchAgents directory if needed
    mkdir -p "$HOME/Library/LaunchAgents"

    # Create logs directory
    mkdir -p "$HOME/Library/Logs"

    # Stop existing service if running
    if launchctl list | grep -q "com.cloud-terminal.server"; then
      echo "Stopping existing service..."
      launchctl unload "$PLIST_DEST" 2>/dev/null || true
    fi

    # Copy plist to LaunchAgents
    cp "$PLIST_SOURCE" "$PLIST_DEST"
    print_status "Plist installed to $PLIST_DEST"

    # Load the service
    launchctl load "$PLIST_DEST"
    print_status "Service loaded and started"

    # Verify it's running
    sleep 2
    if curl -s http://localhost:3000/health > /dev/null; then
      print_status "Server is running at http://localhost:3000"
    else
      print_warning "Server may still be starting, check logs at ~/Library/Logs/cloud-terminal.log"
    fi

    echo ""
    echo "The cloud-terminal server will now:"
    echo "  - Start automatically on login"
    echo "  - Restart automatically if it crashes"
    echo "  - Run in the background"
    echo ""
    echo "Useful commands:"
    echo "  View logs:    tail -f ~/Library/Logs/cloud-terminal.log"
    echo "  View errors:  tail -f ~/Library/Logs/cloud-terminal.error.log"
    echo "  Stop:         $0 stop"
    echo "  Start:        $0 start"
    echo "  Restart:      $0 restart"
    echo "  Uninstall:    $0 uninstall"
    ;;

  uninstall)
    echo "Uninstalling cloud-terminal service..."

    if [ -f "$PLIST_DEST" ]; then
      launchctl unload "$PLIST_DEST" 2>/dev/null || true
      rm "$PLIST_DEST"
      print_status "Service uninstalled"
    else
      print_warning "Service not installed"
    fi
    ;;

  start)
    echo "Starting cloud-terminal service..."
    if [ -f "$PLIST_DEST" ]; then
      launchctl load "$PLIST_DEST"
      print_status "Service started"
    else
      print_error "Service not installed. Run: $0 install"
      exit 1
    fi
    ;;

  stop)
    echo "Stopping cloud-terminal service..."
    if [ -f "$PLIST_DEST" ]; then
      launchctl unload "$PLIST_DEST"
      print_status "Service stopped"
    else
      print_warning "Service not installed"
    fi
    ;;

  restart)
    echo "Restarting cloud-terminal service..."
    $0 stop
    sleep 1
    $0 start
    ;;

  status)
    if launchctl list | grep -q "com.cloud-terminal.server"; then
      print_status "Service is loaded"
      if curl -s http://localhost:3000/health > /dev/null; then
        print_status "Server is responding at http://localhost:3000"
        curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
      else
        print_warning "Server is not responding"
      fi
    else
      print_warning "Service is not loaded"
    fi
    ;;

  logs)
    tail -f "$HOME/Library/Logs/cloud-terminal.log"
    ;;

  *)
    echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs}"
    exit 1
    ;;
esac
