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
  type BrowserStatus,
  type ModelGroup,
  type ActivityLogEntry,
  BrowserApiError,
} from "@/lib/browser-api";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export default function BrowserPage() {
  const router = useRouter();
  const activityEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Connection state
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");

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
  const [previousStepCount, setPreviousStepCount] = useState(0);

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
      type: ActivityLogEntry["type"],
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

  // Poll status
  useEffect(() => {
    const pollInterval = isRunning ? 1000 : 5000;

    const poll = async () => {
      try {
        const newStatus = await getBrowserStatus();
        setStatus(newStatus);
        setConnectionStatus("connected");
        setError(null);

        // Update running state
        const wasRunning = isRunning;
        setIsRunning(newStatus.isRunning);

        // Update model config from server
        if (!wasRunning && newStatus.provider && newStatus.model) {
          setSelectedProvider(newStatus.provider);
          setSelectedModel(newStatus.model);
          setHeadless(newStatus.headless);
        }

        // Handle step changes for activity log
        if (newStatus.stepCount > previousStepCount && newStatus.stepCount > 0) {
          addActivity(
            "step",
            `Step ${newStatus.stepCount}${newStatus.totalSteps ? ` of ${newStatus.totalSteps}` : ""}`,
            { step: newStatus.stepCount, total: newStatus.totalSteps }
          );
          setPreviousStepCount(newStatus.stepCount);
        }

        // Handle user input request
        if (newStatus.waitingForUserInput && newStatus.userInputPrompt) {
          setUserInputPrompt(newStatus.userInputPrompt);
          setUserInputModalOpen(true);
        }

        // Handle task completion
        if (wasRunning && !newStatus.isRunning && newStatus.currentTask === null) {
          addActivity("complete", "Task completed", {
            cost: newStatus.estimatedCost,
            steps: previousStepCount,
          });
          setPreviousStepCount(0);
        }
      } catch (err) {
        setConnectionStatus("disconnected");
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
  }, [isRunning, previousStepCount, addActivity]);

  // Auto-scroll activity log
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLog]);

  // Handle task submission
  const handleSubmitTask = async () => {
    if (!taskInput.trim() || isSubmitting || isRunning) return;

    setIsSubmitting(true);
    setError(null);

    try {
      addActivity("task_started", taskInput.trim());
      await sendBrowserTask(taskInput.trim());
      setTaskInput("");
      setPreviousStepCount(0);
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
    switch (connectionStatus) {
      case "connected":
        return <Circle className="w-2 h-2 fill-emerald-500 text-emerald-500" />;
      case "connecting":
        return <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />;
      case "disconnected":
        return <Circle className="w-2 h-2 fill-red-500 text-red-500" />;
    }
  };

  // Get activity icon
  const getActivityIcon = (type: ActivityLogEntry["type"]) => {
    switch (type) {
      case "task_started":
        return <Globe className="w-3 h-3 text-blue-400" />;
      case "step":
        return <RefreshCw className="w-3 h-3 text-zinc-400" />;
      case "tool":
        return <Circle className="w-3 h-3 text-purple-400" />;
      case "result":
        return <CheckCircle className="w-3 h-3 text-emerald-400" />;
      case "complete":
        return <CheckCircle className="w-3 h-3 text-emerald-500" />;
      case "error":
        return <AlertCircle className="w-3 h-3 text-red-400" />;
      case "user_input":
        return <Send className="w-3 h-3 text-blue-400" />;
      default:
        return <Circle className="w-3 h-3 text-zinc-500" />;
    }
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
              <optgroup key={group.provider} label={group.provider}>
                {group.models.map((m) => (
                  <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                    {m.label || m.model}
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
          <span className="capitalize">{connectionStatus}</span>
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Log */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-2 border-b border-zinc-800 text-[11px] text-zinc-500 uppercase tracking-wider shrink-0">
            Activity Log
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {activityLog.length === 0 ? (
                <div className="text-[12px] text-zinc-600 py-8 text-center">
                  No activity yet. Enter a task to get started.
                </div>
              ) : (
                activityLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 text-[12px]"
                  >
                    <div className="mt-0.5 shrink-0">
                      {getActivityIcon(entry.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span
                        className={
                          entry.type === "error"
                            ? "text-red-400"
                            : entry.type === "complete"
                              ? "text-emerald-400"
                              : "text-zinc-300"
                        }
                      >
                        {entry.content}
                      </span>
                      <span className="text-zinc-600 ml-2">
                        {entry.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={activityEndRef} />
            </div>
          </ScrollArea>
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
              connectionStatus === "disconnected"
                ? "Browser agent unavailable..."
                : isRunning
                  ? "Task in progress..."
                  : "Enter a task for the browser agent..."
            }
            disabled={connectionStatus === "disconnected" || isRunning}
            className="flex-1 min-h-[40px] max-h-[120px] px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 rounded-lg resize-none placeholder:text-zinc-600 disabled:opacity-50 focus:outline-none focus:border-zinc-700"
            rows={1}
          />
          <button
            onClick={handleSubmitTask}
            disabled={
              !taskInput.trim() ||
              isSubmitting ||
              isRunning ||
              connectionStatus === "disconnected"
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
