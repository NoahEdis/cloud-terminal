# Cloud Terminal System

## Overview

The **Cloud Terminal System** is a sophisticated distributed terminal management platform that enables:

- **Session Persistence**: Terminal sessions survive client disconnects and server restarts via tmux + Supabase
- **Multi-client Access**: Multiple browsers/clients can simultaneously connect to the same terminal
- **Real-time Synchronization**: WebSocket-based bidirectional communication with fallback to HTTP polling
- **Activity Tracking**: Integration with Claude Code via hooks for rich state visualization
- **Data Persistence**: Complete session history, output, and event audit logs in Supabase PostgreSQL
- **Local Tmux Sync**: Bidirectional synchronization between cloud terminal and local tmux sessions

---

## Architecture

### High-Level Flow

```
Next.js Frontend (web)              Backend Server (Node.js + Hono)
- React 19 + TypeScript             Two Modes:
- xterm.js for terminal UI          - PTY (legacy)
- D3 for graph visualization        - Tmux (default)
        |                                   |
WebSocket /ws/:sessionId      HTTP API /api/:endpoint
- Real-time output streaming        - Create sessions
- Input/resize commands             - List sessions
- Multi-client support              - Send commands
        |                                   |
        +-----------------------------------+
                        |
           Session Management Layer
           - Tmux Session Manager
           - PTY Session Manager
           - Supabase Sync (Persistence)
                        |
           Supabase PostgreSQL
           - terminal_sessions
           - terminal_output
           - session_events
```

### Backend Modes

1. **Tmux Mode** (Default): `MODE=tmux`
   - Sessions backed by tmux (terminal multiplexer)
   - Survives server restarts
   - Used in production

2. **PTY Mode** (Legacy): `MODE=pty`
   - Direct node-pty process management
   - In-memory session tracking

---

## Key Files

### Backend Source (`/src`)

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, mode selector |
| `tmux-server.ts` | Tmux mode HTTP + WebSocket server |
| `server.ts` | PTY mode server |
| `tmux-session-manager.ts` | Tmux session lifecycle |
| `session-manager.ts` | PTY session lifecycle |
| `tmux.ts` | Low-level tmux CLI wrappers |
| `supabase.ts` | Data persistence layer (54KB) |
| `terminal-parser.ts` | ANSI escape sequence parsing |
| `types.ts` | Core TypeScript interfaces |
| `routes/tmux-api.ts` | Tmux mode REST API |
| `routes/credentials-api.ts` | 1Password integration |
| `websocket/tmux-handler.ts` | Tmux WebSocket handling |

### Frontend Source (`web/src`)

| File | Purpose |
|------|---------|
| `components/Terminal.tsx` | xterm.js wrapper (18KB) |
| `components/ChatList.tsx` | Session list with filtering (75KB) |
| `components/ChatDetail.tsx` | Session details panel (25KB) |
| `components/MessageView.tsx` | Rich message rendering (27KB) |
| `components/GraphView.tsx` | D3 visualization (49KB) |
| `lib/api.ts` | API client with connection manager (59KB) |
| `app/page.tsx` | Main dashboard (33KB) |

---

## Core Patterns

### Session Lifecycle (Tmux Mode)

```typescript
// 1. Create session
POST /api/sessions {name, cwd, cols, rows}
  |
// 2. tmux new-session -d -s {name}
  |
// 3. Store in memory + Supabase
  |
// 4. Client connects via WebSocket
GET /ws/{sessionName}
  |
// 5. Output streamed, input relayed
  |
// 6. Session persists after disconnect
```

### Activity State Management

**States:**
- `idle`: Session waiting for input
- `busy`: Processing (tool use, etc.)
- `exited`: Session terminated

**Claude Code Hook Integration:**
```typescript
// Hook events map to state transitions:
UserPromptSubmit -> busy
PreToolUse       -> busy (with currentTool)
PostToolUse      -> busy
Notification     -> idle
Stop             -> idle
SessionEnd       -> exited
```

### WebSocket Protocol

**Client -> Server:**
```json
{ "type": "input", "data": "ls -la\n" }
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "pong", "timestamp": 1234567890 }
```

**Server -> Client:**
```json
{ "type": "output", "data": "file1\nfile2\n" }
{ "type": "history", "data": "... buffered output ..." }
{ "type": "activity", "state": "idle", "taskStatus": {...} }
{ "type": "ping", "timestamp": 1234567890 }
```

---

## API Routes

### Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:name` | Get session details |
| `DELETE` | `/api/sessions/:name` | Kill session |
| `POST` | `/api/sessions/:name/send` | Send input |
| `POST` | `/api/sessions/:name/resize` | Resize PTY |
| `POST` | `/api/hook` | Claude Code hook endpoint |

### Additional APIs

- `/api/credentials/*` - 1Password integration
- `/api/brain/*` - Knowledge graph
- `/api/github/*` - GitHub integration
- `/api/settings` - Configuration

---

## Data Persistence (Supabase)

### Database Schema

```sql
-- Session metadata
terminal_sessions (
  id, command, cwd, cols, rows, status, exit_code,
  activity_state, current_tool, task_start_time,
  tool_use_count, token_count, created_at, last_activity
)

-- Raw terminal output
terminal_output (
  session_id, chunk_seq, data, created_at
)

-- Audit log
session_events (
  session_id, event_type, details, output_offset, created_at
)
```

---

## Claude Code Integration

### Hook Endpoint

```
POST /api/sessions/:id/hook
{
  "event": "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Notification" | "Stop",
  "tool_name": "Read" | "Bash" | ...
}
```

### Data Extraction

The server parses Claude Code output to extract:
- Current Tool name
- Tool use count
- Token count (from "Usage: X tokens" lines)
- Task duration

---

## Environment Variables

```bash
# Server
PORT=31337
HOST=0.0.0.0
MODE=tmux  # or "pty"

# Authentication
API_KEY=your-secret-key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key

# Optional
TAILSCALE=true
HOST_ID=server-1
```

---

## Dependencies

### Backend
- **hono** (v4.6.0) - HTTP framework
- **node-pty** (v1.0.0) - PTY spawning
- **ws** (v8.18.0) - WebSocket server
- **@google/generative-ai** - Gemini integration

### Frontend
- **next** (16.0.7) - React metaframework
- **react** (19.2.0) - UI library
- **@xterm/xterm** (v5.5.0) - Terminal emulator
- **@monaco-editor/react** - Code editor
- **d3** (v7.9.0) - Visualization
- **@radix-ui/*** - Component library
- **tailwindcss** (v4) - CSS framework

---

## Quick Start

```bash
# Backend
npm install
npm run dev  # Runs on :31337

# Frontend
cd web
npm install
npm run dev  # Runs on :3000

# Create session
curl -X POST http://localhost:31337/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"my-session"}'
```

---

## File Structure

```
cloud-terminal/
├── src/
│   ├── index.ts              # Entry point
│   ├── tmux-server.ts        # Tmux mode server
│   ├── server.ts             # PTY mode server
│   ├── tmux-session-manager.ts
│   ├── session-manager.ts
│   ├── supabase.ts           # Persistence
│   ├── routes/
│   │   ├── tmux-api.ts
│   │   ├── credentials-api.ts
│   │   └── brain-api.ts
│   └── websocket/
│       └── tmux-handler.ts
├── web/
│   ├── src/
│   │   ├── app/page.tsx      # Dashboard
│   │   ├── components/
│   │   │   ├── Terminal.tsx
│   │   │   ├── ChatList.tsx
│   │   │   └── GraphView.tsx
│   │   └── lib/api.ts        # API client
│   └── package.json
├── client/
│   └── sdk.ts                # Programmatic client
└── docs/
    └── SESSION-EVENTS.md
```
