# Session Events System

This document describes the session events system used for debugging, analytics, and audit logging in Cloud Terminal.

## Overview

The `session_events` table provides an **append-only audit log** of all significant events that occur during terminal sessions. Events are correlated with raw terminal output via `output_offset`, enabling timeline reconstruction for debugging.

## Database Schema

```sql
CREATE TABLE session_events (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    output_offset BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_timestamp TIMESTAMPTZ
);
```

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Auto-incrementing event ID |
| `session_id` | TEXT | References the terminal session |
| `event_type` | TEXT | Type of event (see Event Types below) |
| `details` | JSONB | Event-specific metadata |
| `output_offset` | BIGINT | Byte offset in terminal_output for correlation |
| `created_at` | TIMESTAMPTZ | Server timestamp when event was recorded |
| `client_timestamp` | TIMESTAMPTZ | Optional client-provided timestamp (for latency analysis) |

### Indexes

```sql
-- Primary lookups
CREATE INDEX idx_session_events_session ON session_events(session_id);
CREATE INDEX idx_session_events_session_type ON session_events(session_id, event_type);
CREATE INDEX idx_session_events_session_time ON session_events(session_id, created_at);

-- Cross-session analytics
CREATE INDEX idx_session_events_type ON session_events(event_type);
CREATE INDEX idx_session_events_created ON session_events(created_at);
```

## Event Types

### Session Lifecycle Events

| Event Type | When Triggered | Details Schema |
|------------|----------------|----------------|
| `session_start` | Session created | `{ cwd, cols, rows }` |
| `session_restart` | Session restarted after server restart | `{ reason }` |
| `session_exit` | Session terminated | `{ reason, exitCode? }` |
| `session_attach` | WebSocket client connected | `{ clientCount }` |
| `session_detach` | WebSocket client disconnected | `{ clientCount }` |

### Claude Code Task Events

| Event Type | When Triggered | Details Schema |
|------------|----------------|----------------|
| `task_start` | User submitted a prompt (UserPromptSubmit hook) | `{ hookEvent }` |
| `task_complete` | Task finished (Stop/Notification hook) | `{ hookEvent, toolUseCount, durationMs }` |
| `tool_start` | Tool execution began (PreToolUse hook) | `{ toolName, toolUseCount }` |
| `tool_complete` | Tool execution finished (PostToolUse hook) | `{ toolName }` |

### Activity State Events

| Event Type | When Triggered | Details Schema |
|------------|----------------|----------------|
| `state_idle` | Session became idle | `{ prevState, hookEvent? }` |
| `state_busy` | Session became busy | `{ prevState, hookEvent? }` |

### Terminal Events

| Event Type | When Triggered | Details Schema |
|------------|----------------|----------------|
| `compact` | Claude Code ran /compact | `{ reason, preCompactLines? }` |
| `clear` | Claude Code ran /clear | `{ reason }` |
| `terminal_clear` | Screen cleared (CSI 2J detected) | `{}` |
| `output_truncated` | Output buffer overflow | `{ truncatedBytes }` |

### Error Events

| Event Type | When Triggered | Details Schema |
|------------|----------------|----------------|
| `error` | General error occurred | `{ message, stack? }` |
| `hook_error` | Hook processing failed | `{ hookEvent, error }` |

## Output Offset Correlation

Each event includes an `output_offset` field that indicates the byte position in the accumulated `terminal_output` at the time the event occurred. This enables:

1. **Timeline Reconstruction**: Given an event, you can find exactly what was on screen at that moment
2. **Debugging**: Correlate errors with terminal state
3. **Playback**: Reconstruct session history by interleaving events with output

### Example Query: Get Terminal Context for an Event

```sql
-- Get the 1000 bytes of output around when a tool started
WITH event AS (
  SELECT output_offset FROM session_events WHERE id = 12345
)
SELECT
  substring(
    (SELECT string_agg(data, '' ORDER BY chunk_seq) FROM terminal_output WHERE session_id = 'my-session'),
    (SELECT output_offset FROM event) - 500,
    1000
  ) AS context;
```

## Database Functions

### `record_session_event()`

Record a new session event:

```sql
SELECT record_session_event(
  'session-name',           -- p_session_id
  'tool_start',             -- p_event_type
  '{"toolName": "Read"}',   -- p_details (JSONB)
  12345,                    -- p_output_offset
  NOW()                     -- p_client_timestamp (optional)
);
-- Returns: event ID
```

### `get_session_events()`

Query events for a session with optional filters:

```sql
SELECT * FROM get_session_events(
  'session-name',                           -- p_session_id
  '2024-01-01T00:00:00Z'::timestamptz,     -- p_since (optional)
  '2024-12-31T23:59:59Z'::timestamptz,     -- p_until (optional)
  ARRAY['tool_start', 'tool_complete']     -- p_event_types (optional)
);
```

### `get_task_timeline()`

Get all events from a task_start to its task_complete:

```sql
SELECT * FROM get_task_timeline(
  'session-name',  -- p_session_id
  12345            -- p_task_start_id (the ID of a task_start event)
);
-- Returns: id, event_type, details, output_offset, created_at, duration_ms
```

## TypeScript Integration

### Types

```typescript
// src/types.ts
export type SessionEventType =
  | "session_start" | "session_restart" | "session_exit"
  | "session_attach" | "session_detach"
  | "compact" | "clear" | "task_start" | "task_complete"
  | "tool_start" | "tool_complete"
  | "state_idle" | "state_busy"
  | "terminal_clear" | "output_truncated"
  | "error" | "hook_error";

export interface SessionEvent {
  id?: number;
  sessionId: string;
  eventType: SessionEventType;
  details?: Record<string, unknown>;
  outputOffset?: number;
  createdAt?: string;
  clientTimestamp?: string;
}
```

### Recording Events

```typescript
// Synchronous (fire-and-forget)
import { recordSessionEventAsync } from "./supabase.js";

recordSessionEventAsync(sessionId, "tool_start", { toolName: "Read" });

// Async (wait for confirmation)
import { recordSessionEvent } from "./supabase.js";

const eventId = await recordSessionEvent(sessionId, "task_complete", {
  toolUseCount: 15,
  durationMs: 45000
});
```

### Querying Events

```typescript
import { getSessionEvents } from "./supabase.js";

const events = await getSessionEvents("my-session", {
  since: new Date("2024-01-01"),
  eventTypes: ["tool_start", "tool_complete"],
  limit: 100
});
```

## Implementation Notes

### Event Recording Locations

Events are recorded in `src/tmux-session-manager.ts`:

| Location | Events Recorded |
|----------|-----------------|
| `create()` | `session_start` |
| `syncTmuxSessions()` | `session_exit` (when tmux session disappears) |
| `addClient()` | `session_attach` |
| `removeClient()` | `session_detach` |
| `setActivityState()` | `task_start`, `task_complete`, `tool_start`, `tool_complete`, `state_idle`, `state_busy` |
| `attachPty()` onExit | `session_exit` |

### Output Offset Tracking

Output offsets are tracked in-memory in `src/supabase.ts`:

```typescript
// Called when output is appended
supabase.updateOutputOffset(sessionId, data.length);

// Called when recording an event (offset is automatically included)
supabase.recordSessionEventAsync(sessionId, eventType, details);
```

### Best-Effort Recording

Events are recorded asynchronously with `recordSessionEventAsync()` which doesn't wait for the database response. This ensures:

1. **No blocking**: Event recording doesn't slow down terminal operations
2. **Fault tolerance**: Database issues don't crash the server
3. **Trade-off**: Some events may be lost if the database is unavailable

For critical events where confirmation is needed, use `recordSessionEvent()` (async with await).

## Complexity & Edge Cases

### 1. Output Offset Accuracy

**Issue**: Output offsets are tracked in-memory and reset when the server restarts. If the server restarts mid-session, the offset will be incorrect relative to previously stored output.

**Mitigation**:
- The `session_restart` event marks discontinuities in the offset
- Query events relative to each other (by created_at) rather than absolute offsets across restarts

### 2. Hook Event Ordering

**Issue**: Claude Code hooks may arrive out of order if network latency varies. A `tool_complete` might arrive before `tool_start` in rare cases.

**Mitigation**:
- Events include `created_at` timestamps from the server
- For accurate ordering, always sort by `created_at`
- The `client_timestamp` field can help detect client-server clock skew

### 3. Session Rename Handling

**Issue**: When a session is renamed (in tmux), all events reference the old session_id until the rename is detected and applied.

**Current behavior**:
- Events are recorded with the current session name
- `session_events.session_id` is updated when `terminal_sessions.id` is renamed (FK with CASCADE not automatic for this)

**Future consideration**: Add explicit `session_rename` event type.

### 4. CASCADE Delete

**Note**: When a `terminal_session` is deleted, all associated `session_events` are automatically deleted due to `ON DELETE CASCADE`. This is intentional for cleanup but means events don't survive session deletion.

### 5. Task Boundary Detection

**Challenge**: Determining task boundaries relies on hooks. If hooks fail to fire (e.g., Claude Code crashes), tasks may appear incomplete.

**Detection**: Look for `task_start` events without corresponding `task_complete` within a reasonable time window.

### 6. Token Count Source

Token counts come from two sources:
1. **Terminal parsing** (supplementary): Regex extraction from status line output
2. **Hooks** (authoritative): Not currently implemented - hooks don't include token counts

The parsed count may be inaccurate or missing depending on Claude Code's output format.

## Querying Patterns

### Get All Events for a Session

```sql
SELECT * FROM session_events
WHERE session_id = 'my-session'
ORDER BY created_at ASC;
```

### Count Tools Used Per Task

```sql
SELECT
  t.id AS task_id,
  t.created_at AS task_started,
  COUNT(e.id) AS tool_count
FROM session_events t
LEFT JOIN session_events e
  ON e.session_id = t.session_id
  AND e.event_type = 'tool_start'
  AND e.created_at > t.created_at
  AND e.created_at < COALESCE(
    (SELECT MIN(tc.created_at) FROM session_events tc
     WHERE tc.session_id = t.session_id
     AND tc.event_type = 'task_complete'
     AND tc.created_at > t.created_at),
    NOW()
  )
WHERE t.event_type = 'task_start'
GROUP BY t.id, t.created_at
ORDER BY t.created_at DESC;
```

### Find Long-Running Tasks

```sql
SELECT
  ts.id AS task_start_id,
  ts.created_at AS started,
  tc.created_at AS completed,
  EXTRACT(EPOCH FROM (tc.created_at - ts.created_at)) AS duration_seconds
FROM session_events ts
JOIN session_events tc
  ON tc.session_id = ts.session_id
  AND tc.event_type = 'task_complete'
  AND tc.created_at > ts.created_at
  AND tc.created_at = (
    SELECT MIN(created_at) FROM session_events
    WHERE session_id = ts.session_id
    AND event_type = 'task_complete'
    AND created_at > ts.created_at
  )
WHERE ts.event_type = 'task_start'
AND EXTRACT(EPOCH FROM (tc.created_at - ts.created_at)) > 60  -- > 1 minute
ORDER BY duration_seconds DESC;
```

### Get Most Used Tools

```sql
SELECT
  details->>'toolName' AS tool_name,
  COUNT(*) AS usage_count
FROM session_events
WHERE event_type = 'tool_start'
GROUP BY details->>'toolName'
ORDER BY usage_count DESC;
```

## Migration

The session_events table is created by:

```
supabase/migrations/20251212_session_events.sql
```

Run manually or via Supabase dashboard if not applied automatically.
