"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Play,
  RefreshCw,
  Search,
  X,
  Plug,
  History,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SyncCard } from "@/components/SyncCard";
import { SyncConfigModal } from "@/components/SyncConfigModal";
import {
  getSyncSources,
  getSyncHistory,
  triggerSync,
  cancelSync,
} from "@/lib/api";
import type { SyncSource, SyncRun } from "@/lib/sync-types";

const POLL_INTERVAL = 5000; // 5 seconds

export default function SyncsPage() {
  const router = useRouter();
  const [sources, setSources] = useState<SyncSource[]>([]);
  const [historyBySource, setHistoryBySource] = useState<Record<string, SyncRun[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [triggeringSource, setTriggeringSource] = useState<string | null>(null);
  const [configSource, setConfigSource] = useState<string | null>(null);

  // Load sources and history
  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const [sourcesData, historyData] = await Promise.all([
        getSyncSources(),
        getSyncHistory({ limit: 50 }),
      ]);

      setSources(sourcesData);

      // Group history by source
      const grouped: Record<string, SyncRun[]> = {};
      for (const run of historyData) {
        if (!grouped[run.source]) {
          grouped[run.source] = [];
        }
        grouped[run.source].push(run);
      }
      setHistoryBySource(grouped);
    } catch (err) {
      if (showLoading) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      }
      console.error("[Syncs] Load error:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Polling for updates
  useEffect(() => {
    const interval = setInterval(() => {
      loadData(false);
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [loadData]);

  // Handle trigger sync
  const handleTrigger = async (sourceName: string) => {
    setTriggeringSource(sourceName);
    try {
      await triggerSync(sourceName);
      // Reload data to show the new running sync
      await loadData(false);
    } catch (err) {
      console.error(`[Syncs] Trigger error for ${sourceName}:`, err);
      // Could add a toast notification here
    } finally {
      setTriggeringSource(null);
    }
  };

  // Handle cancel sync
  const handleCancel = async (runId: string) => {
    try {
      await cancelSync(runId);
      await loadData(false);
    } catch (err) {
      console.error(`[Syncs] Cancel error for ${runId}:`, err);
    }
  };

  // Handle run all
  const handleRunAll = async () => {
    const enabledSources = sources.filter(
      (s) => s.enabled && s.status !== "syncing"
    );
    for (const source of enabledSources) {
      try {
        await triggerSync(source.source);
      } catch {
        // Continue with other sources
      }
    }
    await loadData(false);
  };

  // Filter sources by search
  const filteredSources = sources.filter((source) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      source.source.toLowerCase().includes(query) ||
      source.description?.toLowerCase().includes(query)
    );
  });

  // Check if any source is syncing
  const anySyncing = sources.some((s) => s.status === "syncing");

  // Stats
  const totalItems = sources.reduce((sum, s) => sum + s.total_items_synced, 0);
  const activeCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/integrations")}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <Plug className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-100">Integrations</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[13px] text-zinc-300">Syncs</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[12px] text-zinc-500">
            {activeCount} active, {totalItems.toLocaleString()} items
          </span>
        </div>

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleRunAll}
                  disabled={anySyncing || activeCount === 0}
                  className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] rounded border border-zinc-800 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  Run All
                </button>
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                Trigger all enabled syncs
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </header>

      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            placeholder="Search syncs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={loading}
          className="p-1.5 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-zinc-400 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {loading && sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin mb-3 text-zinc-600" />
              <p className="text-[12px]">Loading syncs...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="p-2 rounded-full bg-red-500/10 mb-3">
                <X className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-[12px] text-red-400 mb-3">{error}</p>
              <button
                onClick={() => loadData(true)}
                className="text-[12px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              {searchQuery ? (
                <>
                  <p className="text-[12px] mb-1">No syncs match your search</p>
                  <p className="text-[11px] text-zinc-600">Try a different query</p>
                </>
              ) : (
                <>
                  <History className="w-8 h-8 text-zinc-700 mb-3" />
                  <p className="text-[12px] mb-1">No sync sources configured</p>
                  <p className="text-[11px] text-zinc-600">
                    Run the database migration to add sync sources
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSources.map((source) => (
                <SyncCard
                  key={source.source}
                  source={source}
                  recentRuns={historyBySource[source.source] || []}
                  onTrigger={handleTrigger}
                  onCancel={handleCancel}
                  onConfigure={setConfigSource}
                  isTriggering={triggeringSource === source.source}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Config Modal */}
      {configSource && (
        <SyncConfigModal
          source={sources.find((s) => s.source === configSource) || null}
          onClose={() => setConfigSource(null)}
          onSave={async () => {
            setConfigSource(null);
            await loadData(false);
          }}
        />
      )}
    </div>
  );
}
