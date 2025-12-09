"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  Loader2,
  AlertCircle,
  X,
  Key,
  Building2,
  FolderLock,
} from "lucide-react";
import { getCredentialsGraph } from "@/lib/api";
import type { GraphNode, GraphEdge, CredentialsGraphData } from "@/lib/credential-types";

interface D3Node extends GraphNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

interface D3Edge extends Omit<GraphEdge, "source" | "target"> {
  source: string | D3Node;
  target: string | D3Node;
}

interface CredentialsGraphProps {
  onClose: () => void;
}

// Color scheme for node types
const NODE_COLORS = {
  account: "#60A5FA",    // blue-400
  vault: "#FBBF24",      // amber-400
  credential: "#34D399", // emerald-400
};

// Node sizes by type
const NODE_SIZES = {
  account: 20,
  vault: 14,
  credential: 8,
};

export function CredentialsGraph({ onClose }: CredentialsGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<CredentialsGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // D3 references
  const simulationRef = useRef<d3.Simulation<D3Node, D3Edge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Fetch graph data
  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const graphData = await getCredentialsGraph();
      setData(graphData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // Initialize and update D3 visualization
  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

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
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Clone nodes/edges to avoid mutating original data
    const nodes: D3Node[] = data.nodes.map((n) => ({ ...n }));
    const edges: D3Edge[] = data.edges.map((e) => ({ ...e }));

    // Create force simulation with hierarchical layout
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force("link", d3.forceLink<D3Node, D3Edge>(edges)
        .id((d) => d.id)
        .distance((d) => {
          // Shorter links for vault-credential, longer for account-vault
          const edgeType = (d as D3Edge).type;
          return edgeType === "account-vault" ? 120 : 60;
        })
        .strength(0.8)
      )
      .force("charge", d3.forceManyBody()
        .strength((d) => {
          // Stronger repulsion for larger nodes
          const nodeType = (d as D3Node).type;
          return nodeType === "account" ? -500 : nodeType === "vault" ? -300 : -100;
        })
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide()
        .radius((d) => NODE_SIZES[(d as D3Node).type] + 15)
      )
      // Vertical positioning: accounts at top, vaults middle, credentials bottom
      .force("y", d3.forceY<D3Node>()
        .y((d) => {
          switch (d.type) {
            case "account": return height * 0.2;
            case "vault": return height * 0.5;
            case "credential": return height * 0.8;
            default: return height / 2;
          }
        })
        .strength(0.1)
      );

    simulationRef.current = simulation;

    // Create edges
    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(edges)
      .enter()
      .append("line")
      .attr("stroke", "#3F3F46")
      .attr("stroke-width", (d) => d.type === "account-vault" ? 2 : 1)
      .attr("stroke-dasharray", (d) => d.type === "vault-credential" ? "3,3" : "none")
      .attr("opacity", 0.6);

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
        d3.drag<SVGGElement, D3Node>()
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
      .attr("r", (d) => NODE_SIZES[d.type])
      .attr("fill", (d) => NODE_COLORS[d.type])
      .attr("stroke", "#18181B")
      .attr("stroke-width", 2)
      .attr("filter", (d) => d.type === "account" ? "url(#glow)" : "none");

    // Add glow filter for account nodes
    const defs = svg.append("defs");
    const filter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");

    filter.append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");

    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Node icons for accounts and vaults
    node.filter((d) => d.type === "account")
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "12px")
      .attr("fill", "#18181B")
      .text("A");

    node.filter((d) => d.type === "vault")
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "9px")
      .attr("fill", "#18181B")
      .text("V");

    // Node labels
    node.append("text")
      .attr("dy", (d) => NODE_SIZES[d.type] + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", (d) => d.type === "credential" ? "9px" : "11px")
      .attr("font-weight", (d) => d.type === "account" ? "600" : "400")
      .attr("fill", (d) => d.type === "account" ? "#E4E4E7" : "#A1A1AA")
      .text((d) => {
        const label = d.label;
        const maxLen = d.type === "credential" ? 16 : 20;
        return label.length > maxLen ? label.slice(0, maxLen) + "..." : label;
      });

    // Node hover effects
    node
      .on("mouseenter", function (event, d) {
        d3.select(this).select("circle")
          .transition()
          .duration(150)
          .attr("r", NODE_SIZES[d.type] + 4)
          .attr("stroke-width", 3);

        // Highlight connected edges
        link
          .attr("opacity", (l) => {
            const sourceId = typeof l.source === "string" ? l.source : l.source.id;
            const targetId = typeof l.target === "string" ? l.target : l.target.id;
            return sourceId === d.id || targetId === d.id ? 1 : 0.2;
          })
          .attr("stroke", (l) => {
            const sourceId = typeof l.source === "string" ? l.source : l.source.id;
            const targetId = typeof l.target === "string" ? l.target : l.target.id;
            return sourceId === d.id || targetId === d.id ? NODE_COLORS[d.type] : "#3F3F46";
          });
      })
      .on("mouseleave", function (event, d) {
        d3.select(this).select("circle")
          .transition()
          .duration(150)
          .attr("r", NODE_SIZES[d.type])
          .attr("stroke-width", 2);

        link
          .attr("opacity", 0.6)
          .attr("stroke", "#3F3F46");
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      });

    // Click on background to deselect
    svg.on("click", () => {
      setSelectedNode(null);
    });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as D3Node).x ?? 0)
        .attr("y1", (d) => (d.source as D3Node).y ?? 0)
        .attr("x2", (d) => (d.target as D3Node).x ?? 0)
        .attr("y2", (d) => (d.target as D3Node).y ?? 0);

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Initial zoom to fit
    setTimeout(() => {
      if (containerRef.current && zoomRef.current) {
        const scale = 0.9;
        svg.call(
          zoom.transform,
          d3.zoomIdentity
            .translate(width * (1 - scale) / 2, height * (1 - scale) / 2)
            .scale(scale)
        );
      }
    }, 100);

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [data]);

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
          d3.zoomIdentity.translate(width * 0.05, height * 0.05).scale(0.9)
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-b from-zinc-900/50 to-transparent">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Key className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
              Credentials Graph
            </h1>
            <p className="text-xs text-zinc-500 font-mono">
              {data?.nodes.length ?? 0} nodes, {data?.edges.length ?? 0} connections
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleFitToScreen}
            className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
            title="Fit to screen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-zinc-800 mx-1" />

          <button
            onClick={fetchGraphData}
            disabled={loading}
            className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={onClose}
            className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/30">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: NODE_COLORS.account }}
          />
          <span className="text-xs text-zinc-500">Account</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: NODE_COLORS.vault }}
          />
          <span className="text-xs text-zinc-500">Vault</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: NODE_COLORS.credential }}
          />
          <span className="text-xs text-zinc-500">Credential</span>
        </div>
      </div>

      {/* Main graph area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
            <div className="flex flex-col items-center gap-3 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500/50" />
              <span className="text-sm">Loading graph...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
            <div className="text-center">
              <div className="p-3 rounded-full bg-red-500/10 mx-auto mb-4 w-fit">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm text-red-400 mb-4">{error}</p>
              <button
                onClick={fetchGraphData}
                className="text-sm text-zinc-400 hover:text-zinc-200 underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !error && data && data.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="p-4 rounded-full bg-zinc-800/50 mx-auto mb-4 w-fit">
                <Key className="w-8 h-8 text-zinc-600" />
              </div>
              <p className="text-sm text-zinc-500">No credentials to visualize</p>
              <p className="text-xs text-zinc-600 mt-1">
                Add some credentials to see the graph
              </p>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ background: "radial-gradient(circle at 50% 50%, #18181B 0%, #09090B 100%)" }}
        />
      </div>

      {/* Selected node panel */}
      {selectedNode && (
        <div className="absolute bottom-4 right-4 w-72 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden z-20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: NODE_COLORS[selectedNode.type] }}
              />
              <span className="text-xs font-medium text-zinc-200 truncate">
                {selectedNode.label}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3">
            <div className="flex items-center gap-2 mb-3">
              {selectedNode.type === "account" && (
                <Building2 className="w-4 h-4 text-blue-400" />
              )}
              {selectedNode.type === "vault" && (
                <FolderLock className="w-4 h-4 text-amber-400" />
              )}
              {selectedNode.type === "credential" && (
                <Key className="w-4 h-4 text-emerald-400" />
              )}
              <span className="text-xs uppercase tracking-wider text-zinc-500">
                {selectedNode.type}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-zinc-500">ID:</span>{" "}
                <span className="text-zinc-300 font-mono">{selectedNode.id.split(":")[1] || selectedNode.id}</span>
              </div>
              {selectedNode.accountName && (
                <div>
                  <span className="text-zinc-500">Account:</span>{" "}
                  <span className="text-zinc-300">{selectedNode.accountName}</span>
                </div>
              )}
              {selectedNode.vaultId && (
                <div>
                  <span className="text-zinc-500">Vault ID:</span>{" "}
                  <span className="text-zinc-300 font-mono truncate block">{selectedNode.vaultId}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
