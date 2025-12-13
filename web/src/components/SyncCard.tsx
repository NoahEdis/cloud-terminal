"use client";

import { useState } from "react";
import {
  Calendar,
  GitBranch,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  Settings,
  Square,
  Workflow,
  AlertCircle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SyncSource, SyncRun } from "@/lib/sync-types";
import {
  getSourceMeta,
  formatDuration,
  formatSchedule,
} from "@/lib/sync-types";

interface SyncCardProps {
  source: SyncSource;
  recentRuns?: SyncRun[];
  onTrigger: (source: string) => void;
  onCancel: (runId: string) => void;
  onConfigure: (source: string) => void;
  isTriggering?: boolean;
}

const ICON_MAP: Record<string, typeof Calendar> = {
  Calendar,
  GitBranch,
  Mail,
  MessageSquare,
  Workflow,
  HelpCircle,
};

function getIcon(iconName: string) {
  return ICON_MAP[iconName] || HelpCircle;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function SyncCard({
  source,
  recentRuns = [],
  onTrigger,
  onCancel,
  onConfigure,
  isTriggering = false,
}: SyncCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = getSourceMeta(source.source);
  const Icon = getIcon(meta.icon);

  const isSyncing = source.status === "syncing" || isTriggering;
  const hasError = source.status === "error";

  // Find current running sync if any
  const currentRun = recentRuns.find((r) => r.status === "running");

  // Status colors
  const statusColors = {
    idle: "bg-zinc-600",
    syncing: "bg-blue-500",
    error: "bg-red-500",
  };

  // Freshness colors
  const freshnessColors: Record<string, string> = {
    never: "text-zinc-500",
    recent: "text-green-500",
    today: "text-blue-500",
    "this week": "text-yellow-500",
    stale: "text-red-500",
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/30 overflow-hidden">
      {/* Main card row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Icon */}
        <div className="flex items-center justify-center w-8 h-8 rounded bg-zinc-800">
          <Icon className="w-4 h-4 text-zinc-400" />
        </div>

        {/* Source info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-100">
              {meta.displayName}
            </span>
            {!source.enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                Disabled
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-500">
              {meta.description}
            </span>
            {source.schedule && (
              <span className="text-[10px] text-zinc-600">
                {formatSchedule(source.schedule)}
              </span>
            )}
          </div>
        </div>

        {/* Status indicator */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${statusColors[source.status]}`}
                />
                <span className={`text-[11px] ${freshnessColors[source.freshness]}`}>
                  {isSyncing
                    ? "Syncing..."
                    : formatRelativeTime(source.last_sync_at)}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
              <div className="space-y-1">
                <div>Status: {source.status}</div>
                {source.last_sync_at && (
                  <div>Last sync: {new Date(source.last_sync_at).toLocaleString()}</div>
                )}
                <div>Total items: {source.total_items_synced.toLocaleString()}</div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onConfigure(source.source)}
                  className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                Configure
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {isSyncing ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => currentRun && onCancel(currentRun.id)}
                    disabled={!currentRun}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    <Square className="w-3 h-3" />
                    Cancel
                  </button>
                </TooltipTrigger>
                <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                  Cancel running sync
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onTrigger(source.source)}
                    disabled={!source.enabled}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                  >
                    {hasError ? (
                      <RefreshCw className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    {hasError ? "Retry" : "Run Now"}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                  {source.enabled ? "Trigger manual sync" : "Enable sync first"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Error message */}
      {hasError && source.error_message && (
        <div className="px-3 py-2 border-t border-zinc-800/50 bg-red-500/5">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
            <span className="text-[11px] text-red-400">{source.error_message}</span>
          </div>
        </div>
      )}

      {/* Syncing progress */}
      {isSyncing && (
        <div className="px-3 py-2 border-t border-zinc-800/50 bg-blue-500/5">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            <span className="text-[11px] text-blue-400">
              Syncing in progress...
              {currentRun && currentRun.items_processed > 0 && (
                <span className="text-zinc-500 ml-2">
                  {currentRun.items_processed} items processed
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Expanded section - Recent runs */}
      {expanded && recentRuns.length > 0 && (
        <div className="border-t border-zinc-800/50">
          <div className="px-3 py-1.5 bg-zinc-900/50">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Recent Syncs
            </span>
          </div>
          <div className="divide-y divide-zinc-800/30">
            {recentRuns.slice(0, 5).map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 px-3 py-2 text-[11px]"
              >
                {/* Status icon */}
                {run.status === "running" ? (
                  <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                ) : run.status === "success" ? (
                  <CheckCircle className="w-3 h-3 text-green-500" />
                ) : run.status === "error" ? (
                  <AlertCircle className="w-3 h-3 text-red-400" />
                ) : (
                  <Square className="w-3 h-3 text-zinc-500" />
                )}

                {/* Time */}
                <span className="text-zinc-400 w-20">
                  {formatRelativeTime(run.started_at)}
                </span>

                {/* Trigger type */}
                <span className="text-zinc-600 w-12">{run.triggered_by}</span>

                {/* Items */}
                <span className="text-zinc-500 flex-1">
                  {run.items_processed > 0 && (
                    <>
                      {run.items_processed} items
                      {run.items_created > 0 && (
                        <span className="text-green-500 ml-1">
                          +{run.items_created}
                        </span>
                      )}
                      {run.items_updated > 0 && (
                        <span className="text-blue-500 ml-1">
                          ~{run.items_updated}
                        </span>
                      )}
                      {run.items_failed > 0 && (
                        <span className="text-red-500 ml-1">
                          !{run.items_failed}
                        </span>
                      )}
                    </>
                  )}
                </span>

                {/* Duration */}
                <span className="text-zinc-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(run.duration_ms)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty expanded state */}
      {expanded && recentRuns.length === 0 && (
        <div className="border-t border-zinc-800/50 px-3 py-4 text-center">
          <span className="text-[11px] text-zinc-600">No sync history yet</span>
        </div>
      )}
    </div>
  );
}
