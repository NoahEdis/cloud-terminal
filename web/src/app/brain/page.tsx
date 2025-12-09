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
  Brain,
  FileText,
  Lightbulb,
  Workflow,
  BookOpen,
  Code,
  ExternalLink,
  Github,
  Pencil,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getBrainNodes,
  deleteBrainNode,
} from "@/lib/api";
import type { BrainNode, BrainNodeType } from "@/lib/brain-types";
import { NODE_TYPE_META } from "@/lib/brain-types";
import { BrainGraph } from "@/components/brain-graph";

// Node type icons
const NODE_TYPE_ICONS: Record<BrainNodeType, typeof Brain> = {
  reasoning: Lightbulb,
  preference: FileText,
  workflow: Workflow,
  principle: BookOpen,
  pattern: Code,
  reference: ExternalLink,
};

// Group nodes by category
interface NodesByCategory {
  category: string;
  nodes: BrainNode[];
}

export default function BrainPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<BrainNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<BrainNodeType | "all">("all");

  // Load brain nodes
  const loadNodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBrainNodes(filterType === "all" ? undefined : { node_type: filterType });
      setNodes(data);
      // Auto-expand all categories initially
      const categories = new Set(data.map((n) => n.category || "Uncategorized"));
      setExpandedCategories(categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brain nodes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNodes();
  }, [filterType]);

  // Group nodes by category
  const groupedNodes = useMemo((): NodesByCategory[] => {
    const groups = new Map<string, NodesByCategory>();

    for (const node of nodes) {
      const category = node.category || "Uncategorized";
      const existing = groups.get(category);
      if (existing) {
        existing.nodes.push(node);
      } else {
        groups.set(category, {
          category,
          nodes: [node],
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.category.localeCompare(b.category)
    );
  }, [nodes]);

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedNodes;

    const query = searchQuery.toLowerCase();
    return groupedNodes
      .map((group) => ({
        ...group,
        nodes: group.nodes.filter(
          (n) =>
            n.title.toLowerCase().includes(query) ||
            n.content.toLowerCase().includes(query) ||
            n.summary?.toLowerCase().includes(query) ||
            n.tags.some((t) => t.toLowerCase().includes(query))
        ),
      }))
      .filter((group) => group.nodes.length > 0);
  }, [groupedNodes, searchQuery]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleDelete = async (id: string, title: string) => {
    if (deletingIds.has(id)) return;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await deleteBrainNode(id);
      setNodes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error(`Failed to delete brain node ${title}:`, err);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const totalNodes = nodes.length;
  const totalCategories = groupedNodes.length;

  // Graph view as fullscreen early return
  if (viewMode === "graph") {
    return (
      <div className="h-screen flex flex-col bg-black text-zinc-100">
        {/* Minimal header for graph view */}
        <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("list")}
              className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-zinc-400" />
            </button>
            <Brain className="w-4 h-4 text-zinc-400" />
            <span className="text-[13px] font-medium text-zinc-100">Brain Graph</span>
            <span className="text-zinc-600">/</span>
            <span className="text-[12px] text-zinc-500">
              {totalNodes} node{totalNodes !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => setViewMode("list")}
            className="flex items-center gap-1.5 px-2.5 h-7 text-[12px] rounded border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-400"
          >
            <List className="w-3 h-3" />
            List View
          </button>
        </header>
        {/* Full height graph container */}
        <div className="flex-1 relative">
          {loading && nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin mb-3 text-zinc-600" />
              <p className="text-[12px]">Loading brain nodes...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="p-2 rounded-full bg-red-500/10 mb-3">
                <X className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-[12px] text-red-400 mb-3">{error}</p>
              <button
                onClick={loadNodes}
                className="text-[12px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <Brain className="w-6 h-6 mb-3 text-zinc-600" />
              <p className="text-[12px] mb-1">No brain nodes yet</p>
              <button
                onClick={() => router.push("/brain/add")}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              >
                Add brain node
              </button>
            </div>
          ) : (
            <BrainGraph
              nodes={nodes}
              searchQuery={searchQuery}
            />
          )}
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
          <Brain className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-100">Brain</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[12px] text-zinc-500">
            {totalNodes} node{totalNodes !== 1 ? "s" : ""} across {totalCategories} categor{totalCategories !== 1 ? "ies" : "y"}
          </span>
        </div>

        {/* View switcher */}
        <div className="flex items-center h-7 rounded-md border border-zinc-800 overflow-hidden">
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
        <Select value={filterType} onValueChange={(v) => setFilterType(v as BrainNodeType | "all")}>
          <SelectTrigger className="h-8 w-36 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="all" className="text-[12px] text-zinc-200">All types</SelectItem>
            {(Object.keys(NODE_TYPE_META) as BrainNodeType[]).map((type) => (
              <SelectItem key={type} value={type} className="text-[12px] text-zinc-200">
                {NODE_TYPE_META[type].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={loadNodes}
          disabled={loading}
          className="p-1.5 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => router.push("/brain/add")}
          className="flex items-center gap-1.5 h-8 px-3 text-[12px] rounded border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-300"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {loading && nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin mb-3 text-zinc-600" />
              <p className="text-[12px]">Loading brain nodes...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="p-2 rounded-full bg-red-500/10 mb-3">
                <X className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-[12px] text-red-400 mb-3">{error}</p>
              <button
                onClick={loadNodes}
                className="text-[12px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              {searchQuery ? (
                <>
                  <p className="text-[12px] mb-1">No brain nodes match your search</p>
                  <p className="text-[11px] text-zinc-600">Try a different query</p>
                </>
              ) : (
                <>
                  <Brain className="w-6 h-6 mb-3 text-zinc-600" />
                  <p className="text-[12px] mb-1">No brain nodes yet</p>
                  <p className="text-[11px] text-zinc-600 mb-3">
                    Add knowledge about reasoning, preferences, and workflows
                  </p>
                  <button
                    onClick={() => router.push("/brain/add")}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
                  >
                    Add brain node
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGroups.map((group) => (
                <div
                  key={group.category}
                  className="rounded border border-zinc-800 bg-zinc-900/30 overflow-hidden"
                >
                  {/* Category header */}
                  <button
                    onClick={() => toggleCategory(group.category)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="text-zinc-500">
                      {expandedCategories.has(group.category) ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <span className="text-[12px] font-medium text-zinc-200">
                        {group.category}
                      </span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                      {group.nodes.length}
                    </span>
                  </button>

                  {/* Nodes list */}
                  {expandedCategories.has(group.category) && (
                    <div className="border-t border-zinc-800/50">
                      {group.nodes.map((node, idx) => {
                        const Icon = NODE_TYPE_ICONS[node.node_type];
                        return (
                          <div
                            key={node.id}
                            className={`flex items-start gap-2 px-3 py-2 hover:bg-zinc-800/20 transition-colors group ${
                              idx !== group.nodes.length - 1
                                ? "border-b border-zinc-800/30"
                                : ""
                            }`}
                          >
                            <div className="w-5" /> {/* Indent spacer */}
                            <div className="mt-0.5">
                              <Icon className="w-3.5 h-3.5 text-zinc-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-zinc-300 font-medium truncate">
                                  {node.title}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                                  {NODE_TYPE_META[node.node_type].label}
                                </span>
                                {node.source_type === "github" && (
                                  <Github className="w-3 h-3 text-zinc-600" />
                                )}
                              </div>
                              {node.summary && (
                                <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                                  {node.summary}
                                </p>
                              )}
                              {node.tags.length > 0 && (
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {node.tags.slice(0, 3).map((tag) => (
                                    <span
                                      key={tag}
                                      className="text-[9px] px-1 py-0.5 rounded bg-zinc-800/50 text-zinc-600"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {node.tags.length > 3 && (
                                    <span className="text-[9px] text-zinc-600">
                                      +{node.tags.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => router.push(`/brain/${node.id}`)}
                                      className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                                    Edit
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => handleDelete(node.id, node.title)}
                                      disabled={deletingIds.has(node.id)}
                                      className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                                    >
                                      {deletingIds.has(node.id) ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3 h-3" />
                                      )}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="bg-zinc-800 text-zinc-200 text-[11px] border-zinc-700">
                                    Delete
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </div>
                        );
                      })}
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
