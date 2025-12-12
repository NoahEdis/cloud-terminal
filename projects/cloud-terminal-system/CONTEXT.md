# Cloud Terminal System

## Overview
A cloud-based terminal API with bidirectional sync capabilities, enabling persistent terminal sessions across client disconnections. Features a tmux-based backend for session management and a Next.js frontend for web UI interaction. Integrates with Supabase for persistence and provides multi-client access to shared sessions.

## Key Files

### Backend (`cloud-terminal/src/`)
- `index.ts` - Entry point, mode selection (tmux vs pty)
- `tmux-server.ts` - Tmux-mode HTTP/WebSocket server (primary)
- `server.ts` - PTY-mode HTTP/WebSocket server (legacy)
- `tmux-session-manager.ts` - Session lifecycle, bidirectional sync
- `session-manager.ts` - Legacy session manager for PTY mode
- `tmux.ts` - Low-level tmux command wrapper
- `supabase.ts` - Persistence layer (output logging, session events)
- `routes/tmux-api.ts` - REST endpoints for sessions
- `routes/brain-api.ts` - Knowledge graph CRUD
- `routes/credentials-api.ts` - API credential tracking
- `routes/github-api.ts` - GitHub integration (context files)
- `websocket/tmux-handler.ts` - Tmux WebSocket logic
- `middleware/auth.ts` - API key authentication

### Frontend (`cloud-terminal/web/src/`)
- `app/page.tsx` - Main dashboard (layout, view switching)
- `components/Terminal.tsx` - xterm.js wrapper
- `components/MessageView.tsx` - Chat message history
- `components/GraphView.tsx` - D3 knowledge graph
- `components/CanvasView.tsx` - Freeform canvas
- `components/ChatList.tsx` - Sidebar with search & filters
- `components/ChatDetail.tsx` - Chat metadata
- `components/IntegrationTree.tsx` - API integrations treemap
- `components/ContextEditor.tsx` - Context file editor
- `lib/api.ts` - HTTP/WebSocket client SDK
- `lib/types.ts` - Frontend type definitions

### Pages
- `/` - Main terminal interface
- `/brain` - Knowledge graph management
- `/integrations` - API credential tracking
- `/context/[folder]` - Edit context files
- `/settings` - Configuration
- `/browser` - Browser agent interface
- `/changelog` - Version history

## Architecture
```
Frontend (Next.js on Vercel)
    ↓
HTTP/WebSocket to Backend
    ↓
Hono Server (Node.js)
    ↓
tmux Session Manager
    ↓
tmux sessions (local shell)
    ↓
Supabase (persistence)
```

## View Modes
1. **Terminal** - Real-time PTY rendering with xterm.js
2. **Messages** - Chat history from Supabase + Claude interactions
3. **Graph** - D3 knowledge graph: nodes, relationships
4. **Canvas** - Infinite canvas for ideation

## Patterns & Conventions
- Default mode: `tmux` (bidirectional sync with local sessions)
- Sessions survive server restarts (managed by tmux)
- Output buffered (~100KB) sent on reconnection
- Claude Code activity state tracking (idle/busy/exited)
- Multi-client WebSocket I/O to same session

## Current State
- **Working**: Tmux bidirectional sync, multi-client WebSocket, session persistence
- **Features**: Terminal, Messages, Graph, Canvas views
- **Integrations**: Voice (ElevenLabs), Images, Brain nodes, Credentials
- **Auth**: NextAuth v5 for frontend, API key for backend
- **Deployment**: Vercel (frontend), local/Tailscale (backend)

## TODOs
- Improve context file sync reliability
- Add session sharing/collaboration features
- Implement terminal recording and playback
- Add more integrations to brain knowledge graph
