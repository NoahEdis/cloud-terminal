# Agentic Drone System

## Overview
An AI-powered autonomous drone control framework that uses LLM agents (Claude, GPT-4, Gemini, Groq, Ollama) to control a DJI Mini 3 Pro drone through natural language missions. Combines agentic reasoning with real-time telemetry and comprehensive safety enforcement.

## Key Files

### Node.js Backend (`dji-drone-agent/src/`)
- `server/server.ts` - HTTP/WebSocket server (port 3457)
- `agent/drone-agent.ts` - Mission execution loop
- `agent/drone-tools.ts` - Tool implementations (takeoff, move, land, capture)
- `agent/system-prompt.ts` - Safety rules & workflow instructions
- `agent/llm-providers.ts` - Multi-LLM support (5 providers)
- `drone/drone-interface.ts` - Abstract drone interface
- `drone/real-drone-client.ts` - Android API client
- `drone/simulator-adapter.ts` - Simulator wrapper
- `simulator/drone-state.ts` - Physics simulation
- `simulator/video-stream.ts` - Synthetic video frames

### Android Service (`dji-drone-agent/android/`)
- `DroneManager.kt` - DJI SDK v5 wrapper
- Foreground service exposing REST API (port 8080)
- Supports simulator mode (no hardware) or real mode

### Core Types (`dji-drone-agent/src/core/`)
- `types.ts` - Shared type definitions

## Architecture
```
User sends mission text
    ↓
Agent calls get_observation → sees video + state
    ↓
LLM reasons about next step
    ↓
LLM calls drone tool (move, rotate, land, etc.)
    ↓
Tool executes with safety checks
    ↓
Result returned to LLM
    ↓
Repeat until mission complete (max 50 steps)
```

## Drone Tools (6 Available)
1. `get_observation` - Current video + telemetry
2. `takeoff_and_clear` - Safe takeoff to 2m
3. `move_relative` - Limited movement (±2m horizontal, ±1m vertical)
4. `rotate` - Yaw rotation (±45° per call)
5. `take_photo` - Capture frame
6. `land` - Safe landing

## Safety Enforcement
- Max altitude: 30m, minimum flying: 1m
- Max horizontal speed: 2 m/s
- Max vertical speed: 1 m/s
- Battery threshold: 20% triggers emergency land
- Obstacle detection: Stop if < 2m in movement direction
- Max distance from home: 50m

## Patterns & Conventions
- Vision-capable LLMs required for full functionality
- Agentic reasoning loop (think → plan → execute → observe)
- Safety limits enforced at tool execution layer
- WebSocket events for real-time telemetry and video

## Current State
- **Simulator Mode**: Fully functional and tested
- **Real Drone Mode**: Requires Android app deployment + DJI API key
- **Multi-LLM**: All 5 providers configured with cost tracking
- **Safety**: Comprehensive limits enforced

## TODOs
- Complete Android app deployment documentation
- Add waypoint mission support
- Implement autonomous return-to-home on signal loss
- Add obstacle avoidance using computer vision
