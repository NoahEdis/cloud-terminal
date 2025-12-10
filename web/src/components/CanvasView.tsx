"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Layers, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FigmaEmbed, type FigmaDiagram } from "./FigmaEmbed";
import { Input } from "@/components/ui/input";

// ============================================================================
// Types
// ============================================================================

interface CanvasViewProps {
  /** Session ID for future session-scoped diagrams (not currently used) */
  sessionId?: string;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export default function CanvasView({ sessionId: _sessionId, className }: CanvasViewProps) {
  const [diagrams, setDiagrams] = useState<FigmaDiagram[]>([]);
  const [selectedDiagram, setSelectedDiagram] = useState<FigmaDiagram | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Fetch diagrams from API
  const fetchDiagrams = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.set("category", selectedCategory);
      if (selectedType) params.set("type", selectedType);
      if (searchQuery) params.set("search", searchQuery);

      const queryString = params.toString();
      const response = await fetch(`/api/diagrams${queryString ? `?${queryString}` : ""}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch diagrams: ${response.statusText}`);
      }

      const data = await response.json();
      setDiagrams(data.diagrams || []);

      // Auto-select first diagram if none selected
      if (data.diagrams?.length > 0 && !selectedDiagram) {
        setSelectedDiagram(data.diagrams[0]);
      }
    } catch (err) {
      console.error("Error fetching diagrams:", err);
      setError(err instanceof Error ? err.message : "Failed to load diagrams");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, selectedType, searchQuery, selectedDiagram]);

  useEffect(() => {
    fetchDiagrams();
  }, [fetchDiagrams]);

  // Get unique categories and types for filtering
  const categories = [...new Set(diagrams.map(d => d.category).filter(Boolean))] as string[];
  const types = [...new Set(diagrams.map(d => d.diagramType))] as string[];

  // Filter diagrams based on search
  const filteredDiagrams = diagrams.filter(diagram => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      diagram.title.toLowerCase().includes(query) ||
      diagram.description?.toLowerCase().includes(query) ||
      diagram.pageName.toLowerCase().includes(query) ||
      diagram.category?.toLowerCase().includes(query)
    );
  });

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setSelectedType(null);
  };

  const hasFilters = searchQuery || selectedCategory || selectedType;

  return (
    <div className={cn("h-full flex", className)}>
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
        {/* Header */}
        <div className="p-3 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-zinc-100">Diagrams</h3>
            <button
              onClick={fetchDiagrams}
              disabled={isLoading}
              className="p-1 rounded hover:bg-zinc-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 text-zinc-400", isLoading && "animate-spin")} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search diagrams..."
              className="h-8 pl-8 text-[12px] bg-zinc-900 border-zinc-800 placeholder:text-zinc-600"
            />
          </div>
        </div>

        {/* Filters */}
        {(categories.length > 0 || types.length > 0) && (
          <div className="p-2 border-b border-zinc-800 flex flex-wrap gap-1">
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              >
                <X className="w-2.5 h-2.5" />
                Clear
              </button>
            )}
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                className={cn(
                  "px-2 py-1 text-[10px] rounded transition-colors",
                  selectedCategory === cat
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Diagram List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-[12px] text-red-400 mb-2">{error}</p>
              <button
                onClick={fetchDiagrams}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
              >
                Try again
              </button>
            </div>
          ) : filteredDiagrams.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
              <p className="text-[12px] text-zinc-500">
                {hasFilters ? "No matching diagrams" : "No diagrams available"}
              </p>
            </div>
          ) : (
            filteredDiagrams.map((diagram) => (
              <button
                key={diagram.id}
                onClick={() => setSelectedDiagram(diagram)}
                className={cn(
                  "w-full text-left p-2.5 rounded-lg border transition-colors",
                  selectedDiagram?.id === diagram.id
                    ? "bg-zinc-800 border-zinc-600"
                    : "bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50"
                )}
              >
                <div className="flex items-start gap-2">
                  {/* Thumbnail placeholder */}
                  {diagram.thumbnailUrl ? (
                    <img
                      src={diagram.thumbnailUrl}
                      alt=""
                      className="w-12 h-9 object-cover rounded border border-zinc-700 bg-zinc-800 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-9 rounded border border-zinc-700 bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <Layers className="w-4 h-4 text-zinc-600" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h4 className="text-[12px] font-medium text-zinc-200 truncate">
                      {diagram.title}
                    </h4>
                    {diagram.description && (
                      <p className="text-[10px] text-zinc-500 line-clamp-2 mt-0.5">
                        {diagram.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] text-zinc-600 capitalize">
                        {diagram.diagramType}
                      </span>
                      {diagram.category && (
                        <>
                          <span className="text-zinc-700">|</span>
                          <span className="text-[9px] text-zinc-600">
                            {diagram.category}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 bg-zinc-900/30">
        {selectedDiagram ? (
          <FigmaEmbed
            fileKey={selectedDiagram.fileKey}
            nodeId={selectedDiagram.pageId}
            title={selectedDiagram.title}
            description={selectedDiagram.description}
            embedHost="cloud-terminal"
            height="100%"
            className="h-full rounded-none border-0"
            showToolbar={true}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Layers className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
              <p className="text-[13px] text-zinc-500 mb-1">No diagram selected</p>
              <p className="text-[11px] text-zinc-600">
                Select a diagram from the sidebar to view
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
