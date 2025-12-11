# Cloud Terminal API

A lightweight server that spawns and manages pseudo-terminals (PTYs) and exposes them via WebSocket and HTTP APIs. Perfect for running long-lived CLI tools like Claude Code that need to persist across client reconnections.

## Features

- **Session Persistence**: Terminals survive client disconnects and server restarts (via tmux + Supabase)
- **Multi-client Access**: Multiple clients can connect to the same terminal
- **Output Buffering**: Reconnecting clients receive recent output history
- **Data Persistence**: Session data, terminal output, and events stored in Supabase
- **Claude Code Integration**: Activity state tracking via hooks for rich UI indicators
- **API-first**: Full control via HTTP REST + WebSocket
- **TypeScript**: Fully typed SDK included

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (development mode with hot reload)
npm run dev

# Or build and run production
npm run build
npm start
```

The server runs at `http://localhost:3000` by default.

## API Reference

### HTTP Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create a new session |
| `GET` | `/api/sessions/:id` | Get session details + recent output |
| `DELETE` | `/api/sessions/:id` | Kill a session |
| `POST` | `/api/sessions/:id/send` | Send input to session |
| `POST` | `/api/sessions/:id/resize` | Resize terminal |

### WebSocket

Connect to `ws://localhost:3000/ws/:sessionId` for real-time I/O.

**Client → Server:**
```json
{ "type": "input", "data": "ls -la\n" }
{ "type": "resize", "cols": 120, "rows": 40 }
```

**Server → Client:**
```json
{ "type": "output", "data": "file1.txt\nfile2.txt\n" }
{ "type": "history", "data": "... buffered output ..." }
{ "type": "exit", "code": 0 }
```

## Usage Examples

### Create a Session

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "command": "claude",
    "cwd": "/path/to/project",
    "env": {
      "ANTHROPIC_API_KEY": "sk-ant-..."
    }
  }'
```

Response:
```json
{
  "id": "abc123-...",
  "command": "claude",
  "status": "running",
  "createdAt": "2024-12-04T..."
}
```

### Send Input

```bash
curl -X POST http://localhost:3000/api/sessions/abc123/send \
  -H "Content-Type: application/json" \
  -d '{"input": "What files are in this directory?\n"}'
```

### Get Output

```bash
curl http://localhost:3000/api/sessions/abc123 | jq '.recentOutput'
```

### Using the CLI

```bash
# List sessions
npx tsx client/cli.ts list

# Create a Claude Code session
npx tsx client/cli.ts create claude /path/to/project

# Connect interactively (like tmux attach)
npx tsx client/cli.ts connect <session-id>

# Send a command
npx tsx client/cli.ts send <session-id> "ls -la"

# Kill a session
npx tsx client/cli.ts kill <session-id>
```

### Using the SDK

```typescript
import { CloudTerminalClient } from "./client/sdk.js";

const client = new CloudTerminalClient({
  baseUrl: "http://localhost:3000"
});

// Create a session
const session = await client.createSession({
  command: "claude",
  cwd: "/my/project"
});

// Connect via WebSocket for real-time I/O
const terminal = client.connect(session.id);
await terminal.open();

terminal.on("output", (data) => console.log(data));
terminal.on("history", (data) => console.log("History:", data));

terminal.write("Hello\n");
```

## Deployment

### Local Development

```bash
npm run dev
```

### Docker

```bash
# Build
docker build -t cloud-terminal .

# Run
docker run -p 3000:3000 cloud-terminal
```

### VPS (Recommended)

1. **Set up a VPS** (DigitalOcean, Linode, Hetzner - $5-10/mo)

2. **Install Node.js 20+**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Clone and build**
   ```bash
   git clone <repo>
   cd cloud-terminal
   npm ci
   npm run build
   ```

4. **Run with PM2**
   ```bash
   npm install -g pm2
   pm2 start dist/index.js --name cloud-terminal
   pm2 save
   pm2 startup
   ```

5. **Set up Nginx + SSL** (optional but recommended)
   ```nginx
   server {
       listen 443 ssl;
       server_name terminal.yourdomain.com;

       ssl_certificate /etc/letsencrypt/live/.../fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch
fly launch

# Deploy
fly deploy
```

### Railway

1. Connect your GitHub repo
2. Railway auto-detects Node.js
3. Set `PORT` environment variable (Railway provides it)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HOST` | `localhost` | Bind address (use `0.0.0.0` for Docker) |

## Security Considerations

**For Production:**

1. Add authentication (Bearer token, API key)
2. Use TLS (via nginx or cloud provider)
3. Restrict which commands can be spawned
4. Set resource limits (max sessions, memory caps)
5. Run in isolated containers

The current MVP has no authentication - suitable for local development only.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design documentation.

## Data Persistence (Supabase)

Enable Supabase persistence for durable sessions that survive server restarts:

```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
export HOST_ID=server-1  # Optional: for multi-host deployments
```

### What's Persisted

| Table | Description |
|-------|-------------|
| `terminal_sessions` | Session metadata, activity state, task status |
| `terminal_output` | Raw terminal output in chunks (append-only) |
| `session_events` | Audit log of session activity (see [docs/SESSION-EVENTS.md](./docs/SESSION-EVENTS.md)) |

### Database Setup

Apply migrations from `supabase/migrations/`:

```bash
# Using psql directly
psql $DATABASE_URL -f supabase/migrations/20251212_session_events.sql

# Or via Supabase dashboard SQL editor
```

## Claude Code Integration

The server integrates with Claude Code hooks for activity state tracking:

```bash
# In your Claude Code hooks configuration, POST to:
POST /api/sessions/:id/hook
{
  "event": "PreToolUse",
  "tool_name": "Read"
}
```

This enables:
- Real-time activity indicators (idle/busy)
- Task progress tracking (tool count, elapsed time)
- Event logging for debugging

See [ARCHITECTURE.md](./ARCHITECTURE.md#claude-code-integration) for details.

## Limitations

- **Not serverless compatible**: Requires persistent processes (won't work on Cloudflare Workers, Vercel Functions, AWS Lambda)
- **Single instance**: No clustering support yet (sessions are in-memory, but persisted to Supabase)
- ~~**No persistence**~~: ✅ Sessions persist via tmux + Supabase

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design and components
- [docs/SESSION-EVENTS.md](./docs/SESSION-EVENTS.md) - Session events system for debugging

## License

MIT
