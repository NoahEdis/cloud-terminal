# Agentic Drone System

## Overview

The **Agentic Drone System** is an AI-powered autonomous drone control framework that uses LLM agents (Claude, GPT-4, Gemini, Groq, Ollama) to control a DJI Mini 3 Pro drone through natural language missions. It combines agentic reasoning with real-time telemetry, vision-based observation, and comprehensive safety enforcement.

**Key Capability**: Users provide mission descriptions in natural language, and the system automatically plans and executes multi-step operations through an AI agent loop, with continuous visual feedback from the drone camera.

---

## Architecture

### High-Level System Flow

```
User Mission (natural language)
        |
    Agent Loop (max 50 steps)
        |
    [get_observation] -> See video + drone state
        |
    [LLM reasons] -> "I should move forward to..."
        |
    [LLM calls tool] -> move_relative(body_x=1.5, body_y=0, body_z=0)
        |
    [Safety checks] -> Verify altitude, battery, obstacles
        |
    [Execute] -> Move drone via Simulator OR Android API
        |
    [Observe result] -> Back to step 1
        |
    Mission Complete (land or max steps reached)
```

### Component Stack

```
Web Frontend (Next.js) - Real-time telemetry, video stream
        | WebSocket
Node.js Backend (http/ws server, port 3457)
    - DroneAgentManager (LLM agent loop)
    - LLM Providers (5 options)
    - Drone Tools (6 tools)
    - DroneInterface (Abstract)
        |
   [Simulator] OR [Android Device + DJI Mini 3 Pro]
```

### Multi-Tier Deployment

1. **Simulator Mode** (Development/Testing)
   - No hardware required
   - Physics simulation
   - Mock video frames with HUD overlay

2. **Real Drone Mode** (Production)
   - Android device running Drone Agent app
   - DJI Mini 3 Pro + Remote Controller
   - REST API communication (HTTP)

---

## Key Files

### Node.js Backend (`src/`)

| File | Purpose |
|------|---------|
| `server/server.ts` | HTTP + WebSocket server (port 3457) |
| `agent/drone-agent.ts` | Mission execution loop, agent manager |
| `agent/drone-tools.ts` | 6 drone tools with safety enforcement |
| `agent/system-prompt.ts` | Safety rules & workflow instructions |
| `agent/llm-providers.ts` | Multi-LLM support |
| `core/types.ts` | TypeScript type definitions (110+ types) |
| `drone/drone-interface.ts` | Abstract interface for drone operations |
| `drone/real-drone-client.ts` | Android API HTTP client |
| `simulator/drone-state.ts` | Physics simulation engine |
| `simulator/video-stream.ts` | Synthetic video frame generation |

### Android Service (`android/`)

| File | Purpose |
|------|---------|
| `DroneManager.kt` | DJI SDK v5 wrapper |
| `DroneHttpServer.kt` | Ktor HTTP server on port 8080 |
| `DroneHttpService.kt` | Android foreground service |

---

## Drone Tools (6 Available)

### 1. get_observation
- Retrieve current drone state + video frame
- Returns: base64 JPEG, position, altitude, battery, obstacles

### 2. takeoff_and_clear
- Safe takeoff sequence to 2m altitude
- Requires: battery > 20%, grounded

### 3. move_relative
- Move in body frame coordinates
- Parameters: body_x_m (-2 to +2), body_y_m (-2 to +2), body_z_m (-1 to +1)
- Safety: altitude limits, obstacle checks, geofence

### 4. rotate
- Yaw rotation: -45 to +45 degrees per call
- Coordinate system: 0=North, 90=East, 180=South, 270=West

### 5. take_photo
- Capture current camera frame
- Returns: photo path, position metadata

### 6. land
- Safe landing sequence
- Gradual altitude reduction, motor stop

---

## Safety Framework

### Hard-Coded Safety Limits

```typescript
const DEFAULT_SAFETY_LIMITS = {
  maxAltitude: 30,              // meters
  minAltitudeFlying: 1,         // meters
  maxHorizontalSpeed: 2,        // m/s
  maxVerticalSpeed: 1,          // m/s
  maxMoveDistanceX: 2,          // meters per command
  maxMoveDistanceY: 2,          // meters per command
  maxMoveDistanceZ: 1,          // meters per command
  maxRotation: 45,              // degrees per command
  minBattery: 20,               // % triggers emergency landing
  obstacleStopDistance: 2,      // meters
  maxDistanceFromHome: 50,      // meters
};
```

### Safety Rules (Non-Negotiable)

1. Battery < 25%: LLM instructed to land immediately
2. Battery < 20%: Emergency land triggered
3. Altitude: Never exceed 30m or go below 1m while flying
4. Obstacles: Stop if < 2m in movement direction
5. Geofence: Cannot exceed 50m from home position
6. Sequential execution: Wait for each action to complete

---

## LLM Integration

### Supported Providers

| Provider | Models | Vision | Cost |
|----------|--------|--------|------|
| Google Gemini | gemini-2.0-flash, gemini-1.5-pro | Yes | $0.10-$1.25/1M |
| OpenAI | gpt-4o, gpt-4o-mini | Yes | $0.15-$2.50/1M |
| Anthropic | claude-3.5-haiku, claude-sonnet-4 | Yes | $0.80-$15.00/1M |
| Groq | llama-3.3-70b | No | $0.05-$0.79/1M |
| Ollama | any local model | Varies | Free |

---

## API Endpoints

### HTTP REST (Port 3457)

```
GET  /api/status        - Agent status, token count, cost
GET  /api/telemetry     - Current drone state
GET  /api/observation   - Video frame + state
GET  /api/models        - Available LLM models
POST /api/mission       - Start mission (async)
POST /api/config        - Set provider/model
POST /api/abort         - Abort mission
POST /api/land          - Emergency landing
POST /api/reset         - Reset drone and stats
POST /api/drone/mode    - Switch simulator/real
```

### WebSocket Events

```
telemetry       - Drone state (10 Hz)
video_frame     - Camera frame (5 Hz)
mission_started - Mission began
mission_completed - Mission ended
step_started    - Agent step began
tool_called     - Tool invocation
tool_result     - Tool completed
error           - Error occurred
```

---

## Quick Start

### Simulator Mode
```bash
npm run dev
# Backend runs on http://localhost:3457

# Send mission:
curl -X POST http://localhost:3457/api/mission \
  -H "Content-Type: application/json" \
  -d '{"mission": "Take off, move forward 1 meter, take a photo, and land"}'
```

### Real Drone Mode
```bash
# 1. Set up Android device with DJI app
# 2. Configure environment:
DRONE_MODE=real
ANDROID_API_URL=http://192.168.1.100:8080

# 3. Switch mode:
curl -X POST http://localhost:3457/api/drone/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "real", "androidApiUrl": "http://192.168.1.100:8080"}'
```

---

## Environment Variables

```bash
# LLM API Keys (one or more required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
GROQ_API_KEY=gsk_...
OLLAMA_BASE_URL=http://localhost:11434

# Drone Configuration
DRONE_MODE=simulator              # or "real"
ANDROID_API_URL=http://192.168.1.100:8080

# Server
SERVER_PORT=3457
```

---

## File Structure

```
dji-drone-agent/
├── src/
│   ├── server/server.ts          # HTTP + WebSocket server
│   ├── agent/
│   │   ├── drone-agent.ts        # Mission execution
│   │   ├── drone-tools.ts        # 6 tool implementations
│   │   ├── system-prompt.ts      # Safety rules
│   │   └── llm-providers.ts      # Multi-LLM support
│   ├── drone/
│   │   ├── drone-interface.ts    # Abstract interface
│   │   ├── real-drone-client.ts  # Android API client
│   │   └── simulator-adapter.ts  # Simulator wrapper
│   ├── simulator/
│   │   ├── drone-state.ts        # Physics simulation
│   │   └── video-stream.ts       # Synthetic video
│   └── core/types.ts             # TypeScript interfaces
├── android/
│   └── app/src/main/java/com/droneagent/
│       ├── DroneManager.kt       # DJI SDK wrapper
│       └── service/DroneHttpServer.kt
└── web/                          # Next.js frontend
```
