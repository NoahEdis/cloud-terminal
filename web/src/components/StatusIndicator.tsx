"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Circle,
  XCircle,
  Wrench,
  Clock,
  Zap,
  CheckCircle,
} from "lucide-react";
import type { TaskStatus } from "@/lib/types";

interface StatusIndicatorProps {
  taskStatus: TaskStatus | null;
  isConnected: boolean;
  compact?: boolean;
}

/**
 * Format elapsed time from start timestamp.
 */
function formatElapsedTime(startTime: string | null): string {
  if (!startTime) return "";

  const start = new Date(startTime).getTime();
  const now = Date.now();
  const elapsed = Math.floor((now - start) / 1000);

  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/**
 * Format token count for display (e.g., 94000 -> "94.0k").
 */
function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

/**
 * Rich status indicator for Claude Code sessions.
 * Shows current tool, elapsed time, tool count, and token count.
 */
export default function StatusIndicator({
  taskStatus,
  isConnected,
  compact = false,
}: StatusIndicatorProps) {
  const [elapsed, setElapsed] = useState("");

  // Update elapsed time every second when busy
  useEffect(() => {
    if (taskStatus?.activityState !== "busy" || !taskStatus.taskStartTime) {
      setElapsed("");
      return;
    }

    const updateElapsed = () => {
      setElapsed(formatElapsedTime(taskStatus.taskStartTime));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [taskStatus?.activityState, taskStatus?.taskStartTime]);

  // Disconnected state
  if (!isConnected) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <Circle className="w-2 h-2" />
        <span>Disconnected</span>
      </div>
    );
  }

  // Exited state
  if (taskStatus?.activityState === "exited") {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <XCircle className="w-2.5 h-2.5" />
        <span>Session ended</span>
      </div>
    );
  }

  // Busy state - show full status
  if (taskStatus?.activityState === "busy") {
    const toolText = taskStatus.currentTool
      ? `Running ${taskStatus.currentTool}...`
      : "Working...";

    if (compact) {
      return (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          <span>{toolText}</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-3 text-[10px]">
        {/* Status */}
        <div className="flex items-center gap-1.5 text-amber-400">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          <span>{toolText}</span>
        </div>

        {/* Elapsed time */}
        {elapsed && (
          <div className="flex items-center gap-1 text-zinc-400">
            <Clock className="w-2.5 h-2.5" />
            <span>{elapsed}</span>
          </div>
        )}

        {/* Tool count */}
        {taskStatus.toolUseCount > 0 && (
          <div className="flex items-center gap-1 text-zinc-400">
            <Wrench className="w-2.5 h-2.5" />
            <span>{taskStatus.toolUseCount}</span>
          </div>
        )}

        {/* Token count */}
        {taskStatus.tokenCount > 0 && (
          <div className="flex items-center gap-1 text-zinc-400">
            <Zap className="w-2.5 h-2.5" />
            <span>{formatTokenCount(taskStatus.tokenCount)}</span>
          </div>
        )}
      </div>
    );
  }

  // Idle state with completion summary (show briefly after task completes)
  if (taskStatus?.taskCompletedAt && taskStatus.taskStartTime) {
    const completedElapsed = formatElapsedTime(taskStatus.taskStartTime);

    if (compact) {
      return (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <CheckCircle className="w-2.5 h-2.5" />
          <span>Done</span>
        </div>
      );
    }

    // Show completion summary
    const summaryParts: string[] = [];
    if (taskStatus.toolUseCount > 0) {
      summaryParts.push(`${taskStatus.toolUseCount} tools`);
    }
    if (taskStatus.tokenCount > 0) {
      summaryParts.push(`${formatTokenCount(taskStatus.tokenCount)} tokens`);
    }
    if (completedElapsed) {
      summaryParts.push(completedElapsed);
    }

    return (
      <div className="flex items-center gap-2 text-[10px]">
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle className="w-2.5 h-2.5" />
          <span>Done</span>
        </div>
        {summaryParts.length > 0 && (
          <span className="text-zinc-500">({summaryParts.join(" · ")})</span>
        )}
      </div>
    );
  }

  // Default idle state
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
      <Circle className="w-2 h-2 fill-current" />
      <span>Ready</span>
    </div>
  );
}
