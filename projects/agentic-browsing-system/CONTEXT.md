# Agentic Browsing System

## Overview
An AI-powered web browsing agent that uses LLMs (Claude, GPT-4, Gemini, Groq, Ollama) to autonomously control a web browser through natural language commands. Users submit tasks like "Book a flight on Expedia" and the agent browses, extracts data, and completes actions through an intelligent reasoning loop.

## Key Files

### Browser Agent Chat (`servers/browser-agent-chat/`)
- `index.ts` - Main server launcher
- `server.ts` - HTTP/WebSocket server + API routes (port 3456)
- `agent-manager.ts` - Agent lifecycle management, task queue, event routing
- `llm-providers.ts` - LLM provider implementations (6 providers supported)
- `calibration-manager.ts` - UI pattern learning and adaptation
- `widget-patterns.ts` - Learned interaction strategies for complex widgets

### LangChain Agent (`servers/langchain-agent/`)
- `core/agent.ts` - LLM integration and agent executor
- `core/memory.ts` - Task context and working memory management
- `prompts/systemPrompt.ts` - Agent instructions and tool documentation
- `tools/browser/` - 50+ browser actions (click, type, scroll, extract, etc.)

### Browser Automation (`servers/browser-automation/`)
- `core/browser.ts` - Main browser API (screenshot, click, type, scroll)
- `core/types.ts` - PageState, InteractiveElement, BrowserState types
- `core/recording.ts` - Replay capability for debugging
- `observer/` - Observation analysis for learning
- `knowledge/` - Page knowledge graphs for multi-step tasks

### Web Interface (`cloud-terminal/web/`)
- `src/app/browser/page.tsx` - React browser agent UI
- `src/lib/browser-api.ts` - API client
- `src/app/api/browser/*` - Next.js proxy routes

## Architecture
```
User Input (web UI)
    ↓
Next.js API route (/api/browser/*)
    ↓
Browser Agent Server (port 3456)
    ↓
Agent Manager → LLM Provider (Claude/GPT-4/etc.)
    ↓
Tool Executor (LangChain ReAct loop)
    ↓
Browser Automation (Puppeteer)
    ↓
Screenshot + Page State → WebSocket → Activity Log
```

## Patterns & Conventions
- ReAct-style reasoning: Think → Act → Observe → Repeat
- Element indexing (not CSS selectors) for LLM-friendly interaction
- Widget pattern recognition for complex UI (datepickers, dropdowns)
- Token counting and cost tracking per task
- Session persistence (cookies, localStorage)

## Current State
- **Working**: Multi-provider LLM support, real-time WebSocket streaming, 50+ browser tools
- **Recent**: Auto-start capability via launchd, cost tracking, latency monitoring
- **Integration**: Connected to cloud-terminal web UI at `/browser`

## TODOs
- Improve error recovery for failed actions
- Add more widget patterns for common UI components
- Implement task templates for common workflows
