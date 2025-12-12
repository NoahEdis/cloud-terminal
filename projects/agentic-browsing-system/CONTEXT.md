# Agentic Browsing System

## Overview

The **Agentic Browsing System** is a comprehensive framework for autonomous and semi-autonomous web browser control using AI agents. It enables:

- **Autonomous Task Execution**: AI agents (Claude, GPT-4, Gemini, etc.) can independently complete complex multi-step web tasks
- **Browser Automation**: Both agent-driven and CLI-based browser control with human-like interactions
- **Rich Session Recording**: Capture screenshots, network requests, console logs, and user interactions
- **Persistent Learning**: Store and recall page structures, element selectors, and interaction patterns
- **Multi-Provider LLM Support**: Works with Anthropic Claude, OpenAI GPT-4, Google Gemini, Groq (Llama), DeepSeek, and local Ollama
- **Observation & Analysis**: Passively record user actions and convert them into reusable automation flows

---

## Architecture

The system is built on **three core layers**:

```
Layer 3: Chat UI & API (browser-agent-chat/)
         Web interface for task submission, model selection
                              |
Layer 2: Agent Orchestration (langchain-agent/)
         ReAct-style agent loop, memory, tool management
                              |
Layer 1: Browser Automation (browser-automation/)
         Puppeteer (TypeScript), browser-use (Python), profiles
```

### Component Breakdown

**A. Browser Automation (`servers/browser-automation/`)**
- Python layer (`agents/browser/runner.py`): Uses browser-use framework for autonomous control
- TypeScript wrapper (`servers/browser-automation/index.ts`): Session management, run persistence
- Core tools (`servers/browser-automation/core/browser.ts`): Puppeteer-based element clicking, typing, scrolling
- Observation mode (`servers/browser-automation/observer/`): Passively record user interactions
- Page knowledge (`servers/browser-automation/knowledge/`): Persistent storage of page structures and selectors
- Profiles (`servers/browser-automation/core/browserProfiles.ts`): Support for Chrome, Arc, MultiLogin, Puppeteer-managed profiles

**B. Agent Orchestration (`servers/langchain-agent/`)**
- Agent loop (`servers/langchain-agent/core/agent.ts`): ReAct-style decision making
- Tools (`servers/langchain-agent/tools/browserTools.ts`): 40+ browser automation tools exposed to LLM
- Memory (`servers/langchain-agent/core/memory.ts`): Session context and working memory
- System prompt (`servers/langchain-agent/prompts/systemPrompt.ts`): Agent instruction with tool definitions

**C. Chat Interface (`servers/browser-agent-chat/`)**
- Web server (`servers/browser-agent-chat/server.ts`): HTTP + WebSocket for real-time updates
- Agent manager (`servers/browser-agent-chat/agent-manager.ts`): Lifecycle and task queue management
- LLM providers (`servers/browser-agent-chat/llm-providers.ts`): Support for multiple LLM vendors
- Calibration (`servers/browser-agent-chat/calibration-manager.ts`): Record and analyze human interactions
- Replay (`servers/browser-agent-chat/replay-manager.ts`): Reconstruct action sequences from recordings

---

## Key Files

### Primary Entry Points

| File | Purpose |
|------|---------|
| `/servers/browser-automation/index.ts` | LLM-driven automation via browser-use (Python) |
| `/servers/browser-automation/core/browser.ts` | Direct browser control via Puppeteer |
| `/servers/browser-agent-chat/index.ts` | Chat interface - Web server entry point |
| `/agents/browser/index.ts` | Python agent wrapper - invokes runner.py |
| `/agents/browser/runner.py` | Python browser-use runner - actual agent |

### Core Modules

| Module | Key Exports | Role |
|--------|------------|------|
| `core/types.ts` | `InteractiveElement`, `PageState`, `ActionResult` | Type definitions |
| `core/config.ts` | `getLogsDirectory()`, `getDefaultModel()` | Configuration management |
| `knowledge/pageKnowledge.ts` | `getOrCreateSite()`, `upsertElement()`, `recordInteraction()` | Persistent page knowledge |
| `observer/observerMode.ts` | `startObservation()`, `stopObservation()` | Record user interactions |
| `langchain-agent/core/agent.ts` | `AnthropicLLM`, `executeAgent()` | Agent execution loop |
| `langchain-agent/tools/browserTools.ts` | `allTools`, `getTool()` | Tool definitions (40+ tools) |

---

## Core Patterns

### Pattern 1: The Agent Loop (ReAct Style)

```typescript
while (!taskComplete) {
  // 1. REASON: Get current state
  const pageState = await getPageState();
  const elements = await extractInteractiveElements();
  const screenshot = await takeScreenshot();

  // 2. THINK: Ask LLM what to do
  const response = await llm.chat(messages, toolDefinitions);

  // 3. ACT: Execute tool call
  const toolCall = response.toolCalls[0];
  const result = await getTool(toolCall.name)(toolCall.arguments);

  // 4. OBSERVE: Update context
  const newState = await getPageState();
}
```

### Pattern 2: Element Index-Based Selection

Instead of CSS selectors, elements are referenced by indices:

```typescript
// Extract interactive elements
const elements = await extractInteractiveElements();
// Returns: [
//   { index: 1, tag: "input", text: "Search", type: "text" },
//   { index: 2, tag: "button", text: "Go", ariaLabel: "Search button" },
// ]

// Agent refers to elements by index
await click({ index: 2 });
await type({ index: 1, text: "typescript" });
```

### Pattern 3: Page Knowledge Storage

```typescript
// Learn page structure from observation
await catalogPage({
  url: "https://example.com/search",
  elements: [
    {
      semanticName: "search_input",
      purpose: "Enter search term",
      primarySelector: '#searchField',
      selectorType: 'css_id',
      stability_score: 0.95,
    }
  ]
});

// Later: Reuse learned knowledge
const selector = await getBestSelector(pageId, "search_input");
```

---

## Integration Points

### Supabase Persistence
```sql
browser_runs (id, task, provider, model, status, final_result, log_dir, total_steps)
browser_actions (id, run_id, step_number, url, action_type, action_data, success, result)
browser_screenshots (id, run_id, step_number, url, screenshot_url)
```

### 1Password Secrets
```typescript
import { getAccountCredential } from "../core/opSecrets.js";
const apiKey = await getAccountCredential("automation-engineer", "ANTHROPIC_API_KEY");
```

### Multi-Provider LLM Support
- Anthropic Claude (claude-3.5-haiku, claude-sonnet-4, claude-opus-4)
- OpenAI (gpt-4o, gpt-4o-mini)
- Google Gemini (gemini-2.0-flash, gemini-1.5-pro)
- Groq (llama-3.3-70b - fastest, cheapest)
- Ollama (local models)

---

## Available Tools (40+)

```typescript
// Navigation
goto(url), goBack(), refresh(), waitForNavigation()

// Interaction
click(index), type(index, text), selectDropdown(),
uploadFile(), press(key), scroll(direction)

// Extraction
getPageState(), screenshot(), extractText(),
getElements(), evaluate(jsCode)

// Knowledge
learnPage(), markElementCritical(), findElementOnPage()

// Observation
startObservation(), stopObservation(), analyzeObservation()
```

---

## Quick Start

### Start Chat Interface
```bash
npx tsx servers/browser-agent-chat/index.ts
# Opens http://localhost:3456
```

### Using TypeScript API
```typescript
import { createSession, runTask, closeSession } from "./servers/browser-automation/index.js";

const { sessionId } = await createSession({ headless: false });
const result = await runTask(
  sessionId,
  "Go to Amazon and search for 'coffee makers'",
  { timeout: 300000, maxSteps: 50 }
);
await closeSession(sessionId);
```

---

## Dependencies

- **puppeteer** (v24.32.0) - Chromium control via CDP
- **browser-use** (Python 0.10.1) - AI-driven automation framework
- **ghost-cursor** (v1.4.1) - Human-like mouse movements
- **@anthropic-ai/sdk** (v0.71.2) - Claude API
- **@google/generative-ai** (v0.24.1) - Gemini API
- **@supabase/supabase-js** (v2.86.0) - PostgreSQL backend
