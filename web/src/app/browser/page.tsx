"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Globe,
  Send,
  RefreshCw,
  Monitor,
  MonitorOff,
  Circle,
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
  Play,
  Wrench,
  MessageSquare,
  Brain,
  Eye,
  ChevronRight,
  ChevronDown,
  ImageOff,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getBrowserStatus,
  getAvailableModels,
  updateBrowserConfig,
  sendBrowserTask,
  sendUserInput,
  createActivityLogEntry,
  formatCost,
  formatResponseTime,
  getBrowserAgentWSUrl,
  formatToolArgs,
  truncateText,
  type BrowserStatus,
  type ModelGroup,
  type ActivityLogEntry,
  type ActivityLogType,
  type BrowserWSEvent,
  BrowserApiError,
} from "@/lib/browser-api";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export default function BrowserPage() {
  const router = useRouter();
  const activityEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connection state
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [wsConnected, setWsConnected] = useState(false);

  // Agent status
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Model configuration
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [headless, setHeadless] = useState(true);

  // Activity log
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  // Live screenshot
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const [screenshotTimestamp, setScreenshotTimestamp] = useState<number | null>(null);

  // Input state
  const [taskInput, setTaskInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // User input modal
  const [userInputModalOpen, setUserInputModalOpen] = useState(false);
  const [userInputValue, setUserInputValue] = useState("");
  const [userInputPrompt, setUserInputPrompt] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Add activity log entry
  const addActivity = useCallback(
    (
      type: ActivityLogType,
      content: string,
      details?: Record<string, unknown>
    ) => {
      setActivityLog((prev) => [
        ...prev,
        createActivityLogEntry(type, content, details),
      ]);
    },
    []
  );

  // Toggle entry expansion
  const toggleEntryExpanded = useCallback((id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const wsUrl = getBrowserAgentWSUrl();
        console.log("[Browser] Connecting to WebSocket:", wsUrl);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[Browser] WebSocket connected");
          setWsConnected(true);
          setConnectionStatus("connected");
          setError(null);
        };

        ws.onclose = () => {
          console.log("[Browser] WebSocket disconnected");
          setWsConnected(false);
          wsRef.current = null;

          // Attempt to reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!wsRef.current) {
              connectWebSocket();
            }
          }, 3000);
        };

        ws.onerror = (event) => {
          console.error("[Browser] WebSocket error:", event);
          setConnectionStatus("disconnected");
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as BrowserWSEvent;
            handleWebSocketMessage(message);
          } catch (err) {
            console.error("[Browser] Failed to parse WebSocket message:", err);
          }
        };
      } catch (err) {
        console.error("[Browser] Failed to create WebSocket:", err);
        setConnectionStatus("disconnected");
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: BrowserWSEvent) => {
    console.log("[Browser] WS message:", message.type, message.data);

    switch (message.type) {
      case "task_started":
        setIsRunning(true);
        addActivity("task_started", message.data.task, {
          maxSteps: message.data.maxSteps,
        });
        break;

      case "step_started":
        addActivity(
          "step",
          `Step ${message.data.step} of ${message.data.maxSteps}`,
          { step: message.data.step, maxSteps: message.data.maxSteps }
        );
        break;

      case "tool_called":
        addActivity(
          "tool",
          `${message.data.tool}`,
          {
            tool: message.data.tool,
            args: message.data.args,
            reason: message.data.reason,
          }
        );
        break;

      case "tool_result":
        addActivity(
          "tool_result",
          `${message.data.tool} completed`,
          {
            tool: message.data.tool,
            result: message.data.result,
            error: message.data.error,
          }
        );
        // Update screenshot from tool result if available
        if (message.data.screenshot) {
          setLiveScreenshot(message.data.screenshot);
          setScreenshotTimestamp(Date.now());
        }
        break;

      case "live_screenshot":
        setLiveScreenshot(message.data.screenshot);
        setScreenshotTimestamp(message.data.timestamp);
        break;

      case "assistant_message":
        addActivity("assistant", message.data.content);
        break;

      case "agent_event":
        // Handle various agent events
        if (message.data.event === "thinking" && message.data.details?.content) {
          addActivity("thinking", String(message.data.details.content));
        } else {
          addActivity("state_change", message.data.event, message.data.details);
        }
        break;

      case "state_change":
        addActivity("state_change", message.data.description);
        break;

      case "task_completed":
        setIsRunning(false);
        if (message.data.success) {
          addActivity("complete", message.data.result || "Task completed successfully");
        } else {
          addActivity("error", message.data.error || "Task failed");
        }
        break;

      case "error":
        addActivity("error", message.data.message);
        break;

      case "user_input_request":
        setUserInputPrompt(message.data.prompt);
        setUserInputModalOpen(true);
        break;
    }
  }, [addActivity]);

  // Fetch models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const models = await getAvailableModels();
        setModelGroups(models);
      } catch {
        // Models will just be empty if unavailable
      }
    };
    fetchModels();
  }, []);

  // Poll status (reduced frequency since we have WebSocket)
  useEffect(() => {
    const pollInterval = wsConnected ? (isRunning ? 2000 : 10000) : (isRunning ? 1000 : 5000);

    const poll = async () => {
      try {
        const newStatus = await getBrowserStatus();
        setStatus(newStatus);
        if (!wsConnected) {
          setConnectionStatus("connected");
        }
        setError(null);

        // Update model config from server when not running
        if (!isRunning && newStatus.provider && newStatus.model) {
          setSelectedProvider(newStatus.provider);
          setSelectedModel(newStatus.model);
          setHeadless(newStatus.headless);
        }

        // Sync running state from status
        if (newStatus.isRunning !== isRunning) {
          setIsRunning(newStatus.isRunning);
        }

        // Handle user input request from status (backup for WebSocket)
        if (newStatus.waitingForUserInput && newStatus.userInputPrompt && !userInputModalOpen) {
          setUserInputPrompt(newStatus.userInputPrompt);
          setUserInputModalOpen(true);
        }
      } catch (err) {
        if (!wsConnected) {
          setConnectionStatus("disconnected");
        }
        if (err instanceof BrowserApiError && err.status === 503) {
          setError("Browser agent server not running");
        } else {
          setError(err instanceof Error ? err.message : "Connection failed");
        }
      }
    };

    poll();
    const timer = setInterval(poll, pollInterval);
    return () => clearInterval(timer);
  }, [isRunning, wsConnected, userInputModalOpen]);

  // Auto-scroll activity log
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLog]);

  // Handle task submission
  const handleSubmitTask = async () => {
    if (!taskInput.trim() || isSubmitting || isRunning) return;

    setIsSubmitting(true);
    setError(null);
    setLiveScreenshot(null); // Clear old screenshot

    try {
      // Don't add activity here - WebSocket will send task_started event
      await sendBrowserTask(taskInput.trim());
      setTaskInput("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start task";
      setError(message);
      addActivity("error", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle user input submission
  const handleSubmitUserInput = async () => {
    if (!userInputValue.trim()) return;

    try {
      addActivity("user_input", userInputValue.trim());
      await sendUserInput(userInputValue.trim());
      setUserInputModalOpen(false);
      setUserInputValue("");
      setUserInputPrompt(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send input";
      setError(message);
    }
  };

  // Handle model change
  const handleModelChange = async (provider: string, model: string) => {
    setSelectedProvider(provider);
    setSelectedModel(model);

    try {
      await updateBrowserConfig({ provider, model });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update model");
    }
  };

  // Handle headless toggle
  const handleHeadlessToggle = async () => {
    const newHeadless = !headless;
    setHeadless(newHeadless);

    try {
      await updateBrowserConfig({ headless: newHeadless });
    } catch (err) {
      setHeadless(!newHeadless); // Revert on error
      setError(err instanceof Error ? err.message : "Failed to update config");
    }
  };

  // Keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitTask();
    }
  };

  // Get connection status indicator
  const getStatusIndicator = () => {
    if (wsConnected) {
      return <Circle className="w-2 h-2 fill-emerald-500 text-emerald-500" />;
    }
    switch (connectionStatus) {
      case "connected":
        return <Circle className="w-2 h-2 fill-amber-500 text-amber-500" />;
      case "connecting":
        return <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />;
      case "disconnected":
        return <Circle className="w-2 h-2 fill-red-500 text-red-500" />;
    }
  };

  // Get activity icon
  const getActivityIcon = (type: ActivityLogType) => {
    switch (type) {
      case "task_started":
        return <Play className="w-3 h-3 text-blue-400" />;
      case "step":
        return <RefreshCw className="w-3 h-3 text-zinc-400" />;
      case "tool":
        return <Wrench className="w-3 h-3 text-purple-400" />;
      case "tool_result":
        return <CheckCircle className="w-3 h-3 text-emerald-400" />;
      case "thinking":
        return <Brain className="w-3 h-3 text-amber-400" />;
      case "assistant":
        return <MessageSquare className="w-3 h-3 text-blue-400" />;
      case "complete":
        return <CheckCircle className="w-3 h-3 text-emerald-500" />;
      case "error":
        return <AlertCircle className="w-3 h-3 text-red-400" />;
      case "user_input":
        return <Send className="w-3 h-3 text-blue-400" />;
      case "screenshot":
        return <Eye className="w-3 h-3 text-cyan-400" />;
      case "state_change":
        return <Globe className="w-3 h-3 text-zinc-400" />;
      default:
        return <Circle className="w-3 h-3 text-zinc-500" />;
    }
  };

  // Render activity entry with expanded details
  const renderActivityEntry = (entry: ActivityLogEntry) => {
    const isExpanded = expandedEntries.has(entry.id);
    const hasDetails = entry.details && Object.keys(entry.details).length > 0;

    return (
      <div
        key={entry.id}
        className={`text-[12px] border-l-2 pl-2 py-1 ${
          entry.type === "tool"
            ? "border-purple-500/50 bg-purple-950/20"
            : entry.type === "tool_result"
              ? "border-emerald-500/50 bg-emerald-950/20"
              : entry.type === "thinking"
                ? "border-amber-500/50 bg-amber-950/20"
                : entry.type === "error"
                  ? "border-red-500/50 bg-red-950/20"
                  : entry.type === "complete"
                    ? "border-emerald-500/50"
                    : "border-zinc-700"
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0">
            {getActivityIcon(entry.type)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {hasDetails && (
                <button
                  onClick={() => toggleEntryExpanded(entry.id)}
                  className="shrink-0 p-0.5 hover:bg-zinc-800 rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-zinc-500" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-zinc-500" />
                  )}
                </button>
              )}
              <span
                className={`flex-1 ${
                  entry.type === "error"
                    ? "text-red-400"
                    : entry.type === "complete"
                      ? "text-emerald-400"
                      : entry.type === "tool"
                        ? "text-purple-300 font-medium"
                        : entry.type === "thinking"
                          ? "text-amber-300 italic"
                          : "text-zinc-300"
                }`}
              >
                {entry.type === "tool" && entry.details?.tool ? (
                  <span>
                    <span className="text-purple-400 font-mono">{String(entry.details.tool)}</span>
                    {entry.details.reason ? (
                      <span className="text-zinc-500 ml-2">— {String(entry.details.reason)}</span>
                    ) : null}
                  </span>
                ) : (
                  truncateText(entry.content, isExpanded ? 1000 : 150)
                )}
              </span>
              <span className="text-zinc-600 text-[10px] shrink-0">
                {entry.timestamp.toLocaleTimeString()}
              </span>
            </div>

            {/* Expanded details */}
            {isExpanded && hasDetails ? (
              <div className="mt-2 ml-5 space-y-1.5">
                {entry.details?.args ? (
                  <div className="bg-zinc-900/80 border border-zinc-800 rounded p-2">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Arguments</div>
                    <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap overflow-x-auto">
                      {JSON.stringify(entry.details.args, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {entry.details?.result !== undefined ? (
                  <div className="bg-zinc-900/80 border border-zinc-800 rounded p-2">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Result</div>
                    <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto">
                      {typeof entry.details.result === "string"
                        ? entry.details.result
                        : JSON.stringify(entry.details.result, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {entry.details?.error ? (
                  <div className="bg-red-950/50 border border-red-900/50 rounded p-2">
                    <div className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Error</div>
                    <pre className="text-[11px] text-red-300 font-mono whitespace-pre-wrap">
                      {String(entry.details.error)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <Globe className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-100">Browser</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Model Selector */}
          <select
            value={`${selectedProvider}:${selectedModel}`}
            onChange={(e) => {
              const [provider, model] = e.target.value.split(":");
              handleModelChange(provider, model);
            }}
            disabled={isRunning}
            className="h-7 px-2 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-zinc-300 disabled:opacity-50"
          >
            {modelGroups.length === 0 && (
              <option value=":">No models available</option>
            )}
            {modelGroups.map((group) => (
              <optgroup key={group.provider} label={group.provider.charAt(0).toUpperCase() + group.provider.slice(1)}>
                {group.models.map((m) => (
                  <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Headless Toggle */}
          <button
            onClick={handleHeadlessToggle}
            disabled={isRunning}
            className={`p-1.5 rounded transition-colors ${
              headless
                ? "bg-zinc-800 text-zinc-400"
                : "bg-blue-600 text-white"
            } disabled:opacity-50`}
            title={headless ? "Headless mode (no UI)" : "Visible browser"}
          >
            {headless ? (
              <MonitorOff className="w-4 h-4" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Status Bar */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-zinc-800 text-[11px] text-zinc-500 shrink-0">
        <div className="flex items-center gap-1.5">
          {getStatusIndicator()}
          <span>
            {wsConnected ? "Live" : connectionStatus}
          </span>
        </div>

        {status && (
          <>
            <div className="h-3 w-px bg-zinc-800" />
            <span>
              {isRunning
                ? `Step ${status.stepCount}${status.totalSteps ? `/${status.totalSteps}` : ""}`
                : "Idle"}
            </span>
            <div className="h-3 w-px bg-zinc-800" />
            <span>{formatCost(status.estimatedCost)}</span>
            {status.averageResponseTimeMs > 0 && (
              <>
                <div className="h-3 w-px bg-zinc-800" />
                <span>{formatResponseTime(status.averageResponseTimeMs)} avg</span>
              </>
            )}
          </>
        )}

        {isRunning && (
          <div className="ml-auto flex items-center gap-1.5 text-amber-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Running</span>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border-b border-red-900/50 text-[12px] text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="p-0.5 hover:bg-red-900/30 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Log */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-800">
          <div className="px-3 py-2 border-b border-zinc-800 text-[11px] text-zinc-500 uppercase tracking-wider shrink-0">
            Activity Log
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {connectionStatus === "disconnected" && !wsConnected && activityLog.length === 0 ? (
                <div className="py-6 px-4">
                  <div className="max-w-md mx-auto">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertCircle className="w-5 h-5 text-amber-400" />
                      <h3 className="text-[14px] font-medium text-zinc-200">Browser Agent Server Not Running</h3>
                    </div>
                    <p className="text-[12px] text-zinc-400 mb-4">
                      The browser agent server needs to be running locally to use this feature.
                    </p>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 mb-4">
                      <p className="text-[11px] text-zinc-500 mb-2">Start the server:</p>
                      <code className="text-[12px] text-emerald-400 font-mono">
                        npx tsx servers/browser-agent-chat/index.ts
                      </code>
                    </div>
                    <div className="text-[11px] text-zinc-500 space-y-1">
                      <p>Requirements:</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>At least one LLM API key (Anthropic, OpenAI, etc.)</li>
                        <li>Chrome/Chromium browser installed</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : activityLog.length === 0 ? (
                <div className="text-[12px] text-zinc-600 py-8 text-center">
                  No activity yet. Enter a task to get started.
                </div>
              ) : (
                activityLog.map(renderActivityEntry)
              )}
              <div ref={activityEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Browser View Panel */}
        <div className="w-[400px] flex flex-col shrink-0 bg-zinc-950">
          <div className="px-3 py-2 border-b border-zinc-800 text-[11px] text-zinc-500 uppercase tracking-wider shrink-0 flex items-center justify-between">
            <span>Browser View</span>
            {liveScreenshot && isRunning && (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
            {liveScreenshot ? (
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={`data:image/png;base64,${liveScreenshot}`}
                  alt="Browser screenshot"
                  className="max-w-full max-h-full object-contain rounded border border-zinc-800 shadow-lg"
                />
                {screenshotTimestamp && (
                  <div className="absolute bottom-2 right-2 bg-black/70 text-[10px] text-zinc-400 px-2 py-1 rounded">
                    {new Date(screenshotTimestamp).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center">
                <ImageOff className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-[12px] text-zinc-600">
                  {isRunning
                    ? "Waiting for screenshot..."
                    : "No browser session active"}
                </p>
                <p className="text-[11px] text-zinc-700 mt-1">
                  Screenshots will appear here when a task is running
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task Input */}
      <div className="shrink-0 border-t border-zinc-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              connectionStatus === "disconnected" && !wsConnected
                ? "Browser agent unavailable..."
                : isRunning
                  ? "Task in progress..."
                  : "Enter a task for the browser agent..."
            }
            disabled={(connectionStatus === "disconnected" && !wsConnected) || isRunning}
            className="flex-1 min-h-[40px] max-h-[120px] px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 rounded-lg resize-none placeholder:text-zinc-600 disabled:opacity-50 focus:outline-none focus:border-zinc-700"
            rows={1}
          />
          <button
            onClick={handleSubmitTask}
            disabled={
              !taskInput.trim() ||
              isSubmitting ||
              isRunning ||
              (connectionStatus === "disconnected" && !wsConnected)
            }
            className="h-10 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* User Input Modal */}
      {userInputModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-md mx-4 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-medium text-zinc-100">
                Agent needs your input
              </h3>
              <button
                onClick={() => setUserInputModalOpen(false)}
                className="p-1 hover:bg-zinc-800 rounded"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {userInputPrompt && (
              <p className="text-[12px] text-zinc-400 mb-3">{userInputPrompt}</p>
            )}

            <textarea
              value={userInputValue}
              onChange={(e) => setUserInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitUserInput();
                }
              }}
              placeholder="Enter your response..."
              className="w-full min-h-[80px] px-3 py-2 text-[13px] bg-zinc-950 border border-zinc-800 rounded resize-none placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
              autoFocus
            />

            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setUserInputModalOpen(false)}
                className="px-3 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitUserInput}
                disabled={!userInputValue.trim()}
                className="px-3 py-1.5 text-[12px] bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
