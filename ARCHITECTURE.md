# Cloud Terminal API - Architecture

## Overview

A lightweight server that spawns and manages pseudo-terminals (PTYs) and exposes them via WebSocket and HTTP APIs. Designed for running long-lived CLI tools like Claude Code that need to persist across client reconnections.

## Goals

1. **Session Persistence**: Terminals survive client disconnects
2. **Multi-client Access**: Multiple clients can connect to the same terminal
3. **API-first**: Programmatic control via HTTP + WebSocket
4. **Deployment Flexibility**: Run locally, on a VPS, or in containers
5. **Authentication Ready**: Token-based auth for production use

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Cloud Terminal Server                        │
│                                                                      │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐ │
│  │   HTTP API      │    │            Session Manager              │ │
│  │  (Hono/Express) │    │                                         │ │
│  │                 │    │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │ │
│  │ POST /sessions  │───►│  │Session 1│ │Session 2│ │Session N│   │ │
│  │ GET  /sessions  │    │  │         │ │         │ │         │   │ │
│  │ DELETE /session │    │  │ node-pty│ │ node-pty│ │ node-pty│   │ │
│  │ POST /send      │    │  │ process │ │ process │ │ process │   │ │
│  └─────────────────┘    │  │         │ │         │ │         │   │ │
│                         │  │ buffer  │ │ buffer  │ │ buffer  │   │ │
│  ┌─────────────────┐    │  │ (scroll │ │ (scroll │ │ (scroll │   │ │
│  │  WebSocket API  │    │  │  back)  │ │  back)  │ │  back)  │   │ │
│  │                 │    │  └────┬────┘ └────┬────┘ └────┬────┘   │ │
│  │ /ws/:sessionId  │◄───┼───────┴───────────┴───────────┘        │ │
│  │                 │    │                                         │ │
│  │ - Real-time I/O │    │  Features:                              │ │
│  │ - Reconnection  │    │  - Output buffering (last N lines)     │ │
│  │ - Multi-client  │    │  - Session timeout/cleanup             │ │
│  └─────────────────┘    │  - PTY resize support                  │ │
│                         └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
            │                           │
            ▼                           ▼
    ┌───────────────┐          ┌───────────────────┐
    │ Web Client    │          │ Programmatic      │
    │ (xterm.js)    │          │ Client (SDK)      │
    │               │          │                   │
    │ Browser UI    │          │ Node.js/Python    │
    │ for debugging │          │ scripts           │
    └───────────────┘          └───────────────────┘
```

## Components

### 1. Session Manager

Manages the lifecycle of terminal sessions:

```typescript
interface Session {
  id: string;                    // UUID
  pty: IPty;                     // node-pty process
  command: string;               // e.g., "claude" or "bash"
  args: string[];                // command arguments
  cwd: string;                   // working directory
  env: Record<string, string>;   // environment variables
  createdAt: Date;
  lastActivity: Date;
  outputBuffer: string[];        // Last N lines for reconnection
  clients: Set<WebSocket>;       // Connected WebSocket clients
  status: 'running' | 'exited';
  exitCode?: number;
}
```

### 2. HTTP API

RESTful endpoints for session management:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions` | Create new terminal session |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get session details + recent output |
| `DELETE` | `/api/sessions/:id` | Kill session |
| `POST` | `/api/sessions/:id/send` | Send input to terminal |
| `POST` | `/api/sessions/:id/resize` | Resize terminal |

### 3. WebSocket API

Real-time bidirectional communication:

```typescript
// Connect: ws://host/ws/:sessionId
//
// Client → Server messages:
{ type: 'input', data: string }      // Send keystrokes
{ type: 'resize', cols: number, rows: number }

// Server → Client messages:
{ type: 'output', data: string }     // Terminal output
{ type: 'exit', code: number }       // Process exited
{ type: 'history', data: string }    // Buffered output on reconnect
```

### 4. Output Buffer

Keeps last N characters/lines for reconnection:

- Default: 100,000 characters (~2000 lines)
- Sent to clients on WebSocket connect
- Circular buffer to prevent memory growth

## API Examples

### Create a Claude Code Session

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "command": "claude",
    "args": [],
    "cwd": "/path/to/project",
    "env": {
      "ANTHROPIC_API_KEY": "sk-..."
    }
  }'

# Response:
{
  "id": "abc123",
  "status": "running",
  "createdAt": "2024-12-04T..."
}
```

### Send Input to Session

```bash
# Send a command to Claude Code
curl -X POST http://localhost:3000/api/sessions/abc123/send \
  -H "Content-Type: application/json" \
  -d '{"input": "What files are in this directory?\n"}'
```

### Connect via WebSocket (Node.js)

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000/ws/abc123');

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'output') {
    process.stdout.write(msg.data);
  }
});

// Send input
ws.send(JSON.stringify({ type: 'input', data: 'hello\n' }));
```

## Security Considerations

### For Local Development
- No auth required
- Bind to localhost only

### For Production
- Token-based authentication (Bearer token in header/query)
- TLS termination (nginx/cloudflare)
- Session ownership (users can only access their sessions)
- Rate limiting on session creation
- Resource limits (max sessions per user, memory caps)

## Deployment Options

### Option 1: Simple VPS (Recommended for MVP)
- Single Node.js process on a $5-10/mo VPS
- Use systemd or PM2 for process management
- Nginx for TLS + reverse proxy
- Pros: Simple, cheap, full control
- Cons: Single point of failure

### Option 2: Docker on Cloud VM
- Containerized deployment
- Easy to replicate
- Works on: DigitalOcean, Linode, Hetzner, AWS EC2

### Option 3: Fly.io or Railway
- Container-based PaaS
- Persistent volumes for state
- Built-in TLS
- Pros: Easy deployment, scales
- Cons: Slightly more expensive, less control

### NOT Recommended
- **Cloudflare Workers**: No persistent processes, no PTY support
- **Vercel**: Serverless, 10s timeout, no PTY
- **Lambda/Cloud Functions**: Same limitations

## File Structure

```
cloud-terminal/
├── src/
│   ├── index.ts           # Entry point, starts server
│   ├── server.ts          # HTTP + WebSocket server setup
│   ├── session-manager.ts # PTY lifecycle management
│   ├── routes/
│   │   └── api.ts         # HTTP API routes
│   ├── websocket/
│   │   └── handler.ts     # WebSocket connection handling
│   └── types.ts           # TypeScript interfaces
├── client/
│   ├── sdk.ts             # Programmatic client library
│   └── web/               # Optional xterm.js web UI
│       ├── index.html
│       └── terminal.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Future Enhancements

1. **Session Persistence**: Save/restore sessions across server restarts
2. **Recording**: Record terminal sessions for playback
3. **Webhooks**: Notify external services on events
4. **Multiple Users**: User isolation and access control
5. **Clustering**: Multiple server instances with shared state
