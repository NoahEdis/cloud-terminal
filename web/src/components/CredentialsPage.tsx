"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Key,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Search,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getTrackedCredentials,
  removeTrackedCredential,
} from "@/lib/api";
import type { TrackedCredential, CredentialsByAccount } from "@/lib/credential-types";

interface CredentialsPageProps {
  onClose: () => void;
  onAddClick: () => void;
  onGraphClick: () => void;
}

export function CredentialsPage({
  onClose,
  onAddClick,
  onGraphClick,
}: CredentialsPageProps) {
  const [credentials, setCredentials] = useState<TrackedCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  // Load credentials
  const loadCredentials = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTrackedCredentials();
      setCredentials(data);
      // Auto-expand all accounts initially
      const accountNames = new Set(data.map((c) => c.account_name));
      setExpandedAccounts(accountNames);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCredentials();
  }, []);

  // Group credentials by account
  const groupedCredentials = useMemo((): CredentialsByAccount[] => {
    const groups = new Map<string, CredentialsByAccount>();

    for (const cred of credentials) {
      const existing = groups.get(cred.account_name);
      if (existing) {
        existing.credentials.push(cred);
      } else {
        groups.set(cred.account_name, {
          account: cred.account_name,
          vaultName: cred.vault_name,
          credentials: [cred],
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.account.localeCompare(b.account)
    );
  }, [credentials]);

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedCredentials;

    const query = searchQuery.toLowerCase();
    return groupedCredentials
      .map((group) => ({
        ...group,
        credentials: group.credentials.filter(
          (c) =>
            c.credential_name.toLowerCase().includes(query) ||
            c.account_name.toLowerCase().includes(query) ||
            c.vault_name.toLowerCase().includes(query) ||
            c.service_name?.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.credentials.length > 0);
  }, [groupedCredentials, searchQuery]);

  const toggleAccount = (account: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(account)) {
        next.delete(account);
      } else {
        next.add(account);
      }
      return next;
    });
  };

  const handleRemove = async (id: string, credName: string) => {
    if (removingIds.has(id)) return;

    setRemovingIds((prev) => new Set(prev).add(id));
    try {
      await removeTrackedCredential(id);
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error(`Failed to remove credential ${credName}:`, err);
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const totalCredentials = credentials.length;
  const totalAccounts = groupedCredentials.length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900/50 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Key className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
                Credentials
              </h1>
              <p className="text-xs text-zinc-500 font-mono">
                {totalCredentials} tracked across {totalAccounts} account
                {totalAccounts !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === "list"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setViewMode("graph");
                  onGraphClick();
                }}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === "graph"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search and actions */}
        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search credentials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-zinc-900/50 border-zinc-800 text-sm placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-emerald-500/20"
            />
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={loadCredentials}
                  disabled={loading}
                  className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            onClick={onAddClick}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {loading && credentials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500/50" />
              <p className="text-sm">Loading credentials...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="p-3 rounded-full bg-red-500/10 mb-4">
                <X className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm text-red-400 mb-4">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadCredentials}
                className="border-zinc-700 hover:bg-zinc-800"
              >
                Try Again
              </Button>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <div className="p-4 rounded-full bg-zinc-800/50 mb-4">
                <Key className="w-8 h-8 text-zinc-600" />
              </div>
              {searchQuery ? (
                <>
                  <p className="text-sm mb-1">No credentials match your search</p>
                  <p className="text-xs text-zinc-600">Try a different query</p>
                </>
              ) : (
                <>
                  <p className="text-sm mb-1">No credentials tracked yet</p>
                  <p className="text-xs text-zinc-600 mb-4">
                    Add credentials from your 1Password accounts
                  </p>
                  <Button
                    onClick={onAddClick}
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Add Credentials
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredGroups.map((group) => (
                <div
                  key={group.account}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 overflow-hidden"
                >
                  {/* Account header */}
                  <button
                    onClick={() => toggleAccount(group.account)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="text-zinc-500">
                      {expandedAccounts.has(group.account) ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-zinc-200">
                          {group.account}
                        </span>
                        <span className="text-xs text-zinc-600 font-mono">
                          ({group.vaultName})
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-zinc-800 text-zinc-400 border-zinc-700 text-xs font-mono"
                    >
                      {group.credentials.length}
                    </Badge>
                  </button>

                  {/* Credentials list */}
                  {expandedAccounts.has(group.account) && (
                    <div className="border-t border-zinc-800/50">
                      {group.credentials.map((cred, idx) => (
                        <div
                          key={cred.id}
                          className={`flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors group ${
                            idx !== group.credentials.length - 1
                              ? "border-b border-zinc-800/30"
                              : ""
                          }`}
                        >
                          <div className="w-4" /> {/* Indent spacer */}
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm text-zinc-300 truncate">
                                {cred.credential_name}
                              </span>
                              {cred.service_name && (
                                <Badge
                                  variant="outline"
                                  className="border-zinc-700 text-zinc-500 text-[10px] px-1.5 py-0"
                                >
                                  {cred.service_name}
                                </Badge>
                              )}
                            </div>
                            {cred.notes && (
                              <p className="text-xs text-zinc-600 truncate mt-0.5">
                                {cred.notes}
                              </p>
                            )}
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleRemove(cred.id, cred.credential_name)}
                                  disabled={removingIds.has(cred.id)}
                                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                >
                                  {removingIds.has(cred.id) ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove from tracking</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-zinc-800/50 bg-zinc-900/30">
        <p className="text-[10px] text-zinc-600 text-center font-mono">
          Credential metadata only - values stored securely in 1Password
        </p>
      </div>
    </div>
  );
}
