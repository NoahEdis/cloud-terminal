"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  ArrowLeft,
  Search,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Trash2,
  X,
  Plug,
  FolderTree,
  ArrowRightLeft,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { CredentialsGraph } from "@/components/CredentialsGraph";
import { IntegrationTree } from "@/components/IntegrationTree";

export default function IntegrationsPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<TrackedCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "tree" | "graph">("tree");
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

  // Full-screen graph view
  if (viewMode === "graph") {
    return (
      <div className="h-screen bg-black">
        <CredentialsGraph onClose={() => setViewMode("tree")} />
      </div>
    );
  }

  // Tree view (hierarchical: Application → Organization → Credential)
  if (viewMode === "tree") {
    return (
      <div className="h-screen flex flex-col bg-black text-zinc-100">
        {/* Header */}
        <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-zinc-400" />
            </button>
            <Plug className="w-4 h-4 text-zinc-400" />
            <span className="text-[13px] font-medium text-zinc-100">Integrations</span>
          </div>

          {/* View switcher */}
          <div className="flex items-center h-7 rounded-md border border-zinc-800 overflow-hidden">
            <button
              onClick={() => setViewMode("tree")}
              className="flex items-center gap-1.5 px-2.5 h-full text-[12px] transition-colors bg-zinc-800 text-zinc-100"
            >
              <FolderTree className="w-3 h-3" />
              <span className="hidden sm:inline">Tree</span>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
            >
              <List className="w-3 h-3" />
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className="flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
            >
              <LayoutGrid className="w-3 h-3" />
              <span className="hidden sm:inline">Graph</span>
            </button>
            <button
              onClick={() => router.push("/integrations/syncs")}
              className="flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
            >
              <ArrowRightLeft className="w-3 h-3" />
              <span className="hidden sm:inline">Syncs</span>
            </button>
          </div>
        </header>

        {/* Tree content */}
        <div className="flex-1 overflow-hidden">
          <IntegrationTree />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <Plug className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-100">Integrations</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[12px] text-zinc-500">
            {totalCredentials} across {totalAccounts} account{totalAccounts !== 1 ? "s" : ""}
          </span>
        </div>

        {/* View switcher */}
        <div className="flex items-center h-7 rounded-md border border-zinc-800 overflow-hidden">
          <button
            onClick={() => setViewMode("tree")}
            className="flex items-center gap-1.5 px-2.5 h-full text-[12px] border-r border-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
          >
            <FolderTree className="w-3 h-3" />
            <span className="hidden sm:inline">Tree</span>
          </button>
          <button
            onClick={() => setViewMode("list")}
            className="flex items-center gap-1.5 px-2.5 h-full text-[12px] transition-colors bg-zinc-800 text-zinc-100"
          >
            <List className="w-3 h-3" />
            <span className="hidden sm:inline">List</span>
          </button>
          <button
            onClick={() => setViewMode("graph")}
            className="flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
          >
            <LayoutGrid className="w-3 h-3" />
            <span className="hidden sm:inline">Graph</span>
          </button>
          <button
            onClick={() => router.push("/integrations/syncs")}
            className="flex items-center gap-1.5 px-2.5 h-full text-[12px] border-l border-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
          >
            <ArrowRightLeft className="w-3 h-3" />
            <span className="hidden sm:inline">Syncs</span>
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
        <button
          onClick={loadCredentials}
          disabled={loading}
          className="p-1.5 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => router.push("/integrations/add")}
          className="flex items-center gap-1.5 h-8 px-3 text-[12px] rounded border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-300"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {loading && credentials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin mb-3 text-zinc-600" />
              <p className="text-[12px]">Loading credentials...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="p-2 rounded-full bg-red-500/10 mb-3">
                <X className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-[12px] text-red-400 mb-3">{error}</p>
              <button
                onClick={loadCredentials}
                className="text-[12px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              {searchQuery ? (
                <>
                  <p className="text-[12px] mb-1">No credentials match your search</p>
                  <p className="text-[11px] text-zinc-600">Try a different query</p>
                </>
              ) : (
                <>
                  <p className="text-[12px] mb-1">No integrations tracked yet</p>
                  <p className="text-[11px] text-zinc-600 mb-3">
                    Add integrations from your 1Password accounts
                  </p>
                  <button
                    onClick={() => router.push("/integrations/add")}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
                  >
                    Add integrations
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGroups.map((group) => (
                <div
                  key={group.account}
                  className="rounded border border-zinc-800 bg-zinc-900/30 overflow-hidden"
                >
                  {/* Account header */}
                  <button
                    onClick={() => toggleAccount(group.account)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="text-zinc-500">
                      {expandedAccounts.has(group.account) ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-zinc-200">
                          {group.account}
                        </span>
                        <span className="text-[11px] text-zinc-600">
                          {group.vaultName}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                      {group.credentials.length}
                    </span>
                  </button>

                  {/* Credentials list */}
                  {expandedAccounts.has(group.account) && (
                    <div className="border-t border-zinc-800/50">
                      {group.credentials.map((cred, idx) => (
                        <div
                          key={cred.id}
                          className={`flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/20 transition-colors group ${
                            idx !== group.credentials.length - 1
                              ? "border-b border-zinc-800/30"
                              : ""
                          }`}
                        >
                          <div className="w-5" /> {/* Indent spacer */}
                          <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] text-zinc-300 truncate">
                                {cred.credential_name}
                              </span>
                              {cred.service_name && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                                  {cred.service_name}
                                </span>
                              )}
                            </div>
                            {cred.notes && (
                              <p className="text-[11px] text-zinc-600 truncate mt-0.5">
                                {cred.notes}
                              </p>
                            )}
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleRemove(cred.id, cred.credential_name)}
                                  disabled={removingIds.has(cred.id)}
                                  className="p-1 rounded opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                                >
                                  {removingIds.has(cred.id) ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                                Remove from tracking
                              </TooltipContent>
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
    </div>
  );
}
