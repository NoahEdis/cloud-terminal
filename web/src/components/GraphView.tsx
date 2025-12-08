"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Filter,
  RefreshCw,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";

// ============================================================================
// Types
// ============================================================================

export interface GraphNode {
  id: string;
  label: string;
  labels: string[];
  properties: Record<string, unknown>;
  // D3 simulation properties
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

export interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphViewProps {
  onNodeSelect?: (node: GraphNode | null) => void;
  className?: string;
}

// ============================================================================
// Color Mapping for Node Labels
// ============================================================================

const LABEL_COLORS: Record<string, string> = {
  Person: "#60A5FA",       // blue-400
  Company: "#34D399",      // emerald-400
  Email: "#FBBF24",        // amber-400
  Event: "#F472B6",        // pink-400
  Task: "#A78BFA",         // violet-400
  File: "#FB923C",         // orange-400
  Workflow: "#2DD4BF",     // teal-400
  Application: "#E879F9",  // fuchsia-400
  Project: "#4ADE80",      // green-400
  Meeting: "#F87171",      // red-400
  Contact: "#38BDF8",      // sky-400
  Document: "#818CF8",     // indigo-400
  default: "#71717A",      // zinc-500
};

function getNodeColor(labels: string[]): string {
  for (const label of labels) {
    if (LABEL_COLORS[label]) {
      return LABEL_COLORS[label];
    }
  }
  return LABEL_COLORS.default;
}

// ============================================================================
// Component
// ============================================================================

export default function GraphView({ onNodeSelect, className = "" }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterLabels, setFilterLabels] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // D3 references
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Fetch graph data
  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/graph");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const graphData: GraphData = await response.json();
      setData(graphData);

      // Extract unique labels
      const labels = new Set<string>();
      graphData.nodes.forEach((node) => {
        node.labels.forEach((label) => labels.add(label));
      });
      setAvailableLabels(Array.from(labels).sort());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // Filter data based on search and label filters
  const filteredData = useCallback((): GraphData | null => {
    if (!data) return null;

    let nodes = data.nodes;
    let edges = data.edges;

    // Filter by labels
    if (filterLabels.length > 0) {
      nodes = nodes.filter((node) =>
        node.labels.some((label) => filterLabels.includes(label))
      );
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((edge) => {
        const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
        const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (node) =>
          node.label.toLowerCase().includes(query) ||
          node.labels.some((l) => l.toLowerCase().includes(query)) ||
          JSON.stringify(node.properties).toLowerCase().includes(query)
      );
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((edge) => {
        const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
        const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });
    }

    return { nodes, edges };
  }, [data, searchQuery, filterLabels]);

  // Initialize and update D3 visualization
  useEffect(() => {
    const filtered = filteredData();
    if (!filtered || !svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous content
    svg.selectAll("*").remove();

    // Create main group for zoom/pan
    const g = svg.append("g").attr("class", "graph-container");

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Create arrow marker for edges
    svg.append("defs")
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M 0,-5 L 10,0 L 0,5")
      .attr("fill", "#52525B");

    // Clone nodes/edges to avoid mutating original data
    const nodes: GraphNode[] = filtered.nodes.map((n) => ({ ...n }));
    const edges: GraphEdge[] = filtered.edges.map((e) => ({ ...e }));

    // Create force simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(edges)
        .id((d) => d.id)
        .distance(100)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    simulationRef.current = simulation;

    // Create edges
    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(edges)
      .enter()
      .append("line")
      .attr("stroke", "#3F3F46")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // Create edge labels
    const linkLabel = g.append("g")
      .attr("class", "link-labels")
      .selectAll("text")
      .data(edges)
      .enter()
      .append("text")
      .attr("class", "link-label")
      .attr("font-size", "9px")
      .attr("fill", "#71717A")
      .attr("text-anchor", "middle")
      .attr("dy", -3)
      .text((d) => d.type);

    // Create nodes
    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node circles
    node.append("circle")
      .attr("r", 12)
      .attr("fill", (d) => getNodeColor(d.labels))
      .attr("stroke", "#18181B")
      .attr("stroke-width", 2);

    // Node labels
    node.append("text")
      .attr("dy", 24)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("fill", "#A1A1AA")
      .text((d) => {
        const label = d.label || d.id;
        return label.length > 20 ? label.slice(0, 20) + "..." : label;
      });

    // Node hover effects
    node
      .on("mouseenter", function () {
        d3.select(this).select("circle")
          .transition()
          .duration(150)
          .attr("r", 16)
          .attr("stroke-width", 3);
      })
      .on("mouseleave", function () {
        d3.select(this).select("circle")
          .transition()
          .duration(150)
          .attr("r", 12)
          .attr("stroke-width", 2);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        onNodeSelect?.(d);
      });

    // Click on background to deselect
    svg.on("click", () => {
      setSelectedNode(null);
      onNodeSelect?.(null);
    });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

      linkLabel
        .attr("x", (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
        .attr("y", (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2);

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Initial zoom to fit
    const initialScale = 0.8;
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(width * (1 - initialScale) / 2, height * (1 - initialScale) / 2).scale(initialScale)
    );

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [filteredData, onNodeSelect]);

  // Zoom controls
  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 0.7);
    }
  };

  const handleFitToScreen = () => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const svg = d3.select(svgRef.current);
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      svg
        .transition()
        .duration(500)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(width * 0.1, height * 0.1).scale(0.8)
        );
    }
  };

  const toggleLabelFilter = (label: string) => {
    setFilterLabels((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label]
    );
  };

  const filtered = filteredData();

  return (
    <div className={`h-full flex flex-col bg-zinc-950 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-zinc-800">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="h-7 pl-7 text-[12px] bg-zinc-900 border-zinc-800 placeholder:text-zinc-600"
          />
        </div>

        {/* Filter button */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-1.5 rounded border transition-colors ${
            filterLabels.length > 0
              ? "border-blue-600 bg-blue-950/50 text-blue-400"
              : "border-zinc-800 hover:bg-zinc-800 text-zinc-400"
          }`}
          title="Filter by label"
        >
          <Filter className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-zinc-800" />

        {/* Zoom controls */}
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleFitToScreen}
          className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
          title="Fit to screen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-zinc-800" />

        {/* Refresh */}
        <button
          onClick={fetchGraphData}
          disabled={loading}
          className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        {/* Stats */}
        <div className="ml-auto text-[11px] text-zinc-500">
          {filtered && (
            <>
              {filtered.nodes.length} nodes, {filtered.edges.length} edges
            </>
          )}
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="p-2 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-500 mr-1">Labels:</span>
            {availableLabels.map((label) => (
              <button
                key={label}
                onClick={() => toggleLabelFilter(label)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  filterLabels.includes(label)
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {label}
              </button>
            ))}
            {filterLabels.length > 0 && (
              <button
                onClick={() => setFilterLabels([])}
                className="ml-2 text-[11px] text-zinc-500 hover:text-zinc-300 underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main graph area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
            <div className="flex items-center gap-2 text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-[13px]">Loading graph...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
            <div className="text-center">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-red-400" />
              <p className="text-[13px] text-red-400 mb-2">{error}</p>
              <button
                onClick={fetchGraphData}
                className="text-[12px] text-zinc-400 hover:text-zinc-200 underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !error && filtered && filtered.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-900 flex items-center justify-center">
                <Search className="w-5 h-5 text-zinc-600" />
              </div>
              <p className="text-[13px] text-zinc-500">No nodes found</p>
              {(searchQuery || filterLabels.length > 0) && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setFilterLabels([]);
                  }}
                  className="mt-2 text-[12px] text-zinc-500 hover:text-zinc-300 underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ background: "#09090B" }}
        />
      </div>

      {/* Selected node panel */}
      {selectedNode && (
        <div className="absolute bottom-4 right-4 w-72 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden z-20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getNodeColor(selectedNode.labels) }}
              />
              <span className="text-[12px] font-medium text-zinc-200 truncate">
                {selectedNode.label || selectedNode.id}
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedNode(null);
                onNodeSelect?.(null);
              }}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3 max-h-48 overflow-auto">
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                Labels
              </div>
              <div className="flex gap-1 flex-wrap">
                {selectedNode.labels.map((label) => (
                  <span
                    key={label}
                    className="px-1.5 py-0.5 text-[10px] bg-zinc-800 text-zinc-300 rounded"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {Object.keys(selectedNode.properties).length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                  Properties
                </div>
                <div className="space-y-1">
                  {Object.entries(selectedNode.properties).slice(0, 10).map(([key, value]) => (
                    <div key={key} className="text-[11px]">
                      <span className="text-zinc-500">{key}:</span>{" "}
                      <span className="text-zinc-300">
                        {typeof value === "object"
                          ? JSON.stringify(value).slice(0, 50)
                          : String(value).slice(0, 50)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
