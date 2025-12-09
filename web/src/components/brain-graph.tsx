"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { X } from "lucide-react";
import type { BrainNode, BrainNodeType } from "@/lib/brain-types";

interface BrainGraphProps {
  nodes: BrainNode[];
  searchQuery?: string;
}

// Color scheme for node types
const NODE_TYPE_COLORS: Record<BrainNodeType, string> = {
  principle: "#3b82f6", // blue
  pattern: "#8b5cf6", // purple
  workflow: "#10b981", // green
  reference: "#f59e0b", // amber
  reasoning: "#ef4444", // red
  preference: "#ec4899", // pink
};

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  data: BrainNode;
  radius: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: GraphNode;
  target: GraphNode;
}

export function BrainGraph({ nodes, searchQuery }: BrainGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<BrainNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<BrainNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // D3 force simulation
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = dimensions;

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Main group for zoom/pan
    const g = svg.append("g");

    // Create graph nodes with radius based on priority
    const graphNodes: GraphNode[] = nodes.map((node) => ({
      id: node.id,
      data: node,
      radius: 8 + (node.priority || 0) / 10,
    }));

    // Create links between nodes that share tags or categories
    const links: GraphLink[] = [];
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const nodeA = graphNodes[i].data;
        const nodeB = graphNodes[j].data;

        // Link if same category
        if (nodeA.category && nodeA.category === nodeB.category) {
          links.push({ source: graphNodes[i], target: graphNodes[j] });
          continue;
        }

        // Link if shared tags
        const sharedTags = nodeA.tags.filter((t) => nodeB.tags.includes(t));
        if (sharedTags.length > 0) {
          links.push({ source: graphNodes[i], target: graphNodes[j] });
        }
      }
    }

    // Force simulation
    const simulation = d3.forceSimulation(graphNodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => d.radius + 5));

    // Draw links
    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#27272a")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1);

    // Draw nodes
    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(graphNodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<any, GraphNode>()
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
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => NODE_TYPE_COLORS[d.data.node_type])
      .attr("stroke", (d) => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matches =
            d.data.title.toLowerCase().includes(query) ||
            d.data.content.toLowerCase().includes(query) ||
            d.data.tags.some((t) => t.toLowerCase().includes(query));
          return matches ? "#fff" : "transparent";
        }
        return "transparent";
      })
      .attr("stroke-width", 2)
      .attr("opacity", (d) => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matches =
            d.data.title.toLowerCase().includes(query) ||
            d.data.content.toLowerCase().includes(query) ||
            d.data.tags.some((t) => t.toLowerCase().includes(query));
          return matches ? 1 : 0.3;
        }
        return 1;
      });

    // Node labels
    node.append("text")
      .text((d) => d.data.title.length > 20 ? d.data.title.slice(0, 20) + "..." : d.data.title)
      .attr("x", (d) => d.radius + 4)
      .attr("y", 3)
      .attr("font-size", "10px")
      .attr("fill", "#a1a1aa")
      .attr("pointer-events", "none")
      .attr("opacity", (d) => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matches =
            d.data.title.toLowerCase().includes(query) ||
            d.data.content.toLowerCase().includes(query) ||
            d.data.tags.some((t) => t.toLowerCase().includes(query));
          return matches ? 1 : 0.3;
        }
        return 1;
      });

    // Hover and click handlers
    node.on("mouseenter", (event, d) => {
      setHoveredNode(d.data);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    })
    .on("mouseleave", () => {
      setHoveredNode(null);
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      setSelectedNode(d.data);
      setHoveredNode(null);
    });

    // Click on background to deselect
    svg.on("click", () => {
      setSelectedNode(null);
    });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Center view
    svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1));

    return () => {
      simulation.stop();
    };
  }, [nodes, dimensions, searchQuery]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="bg-black"
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 p-2 rounded bg-zinc-900/80 border border-zinc-800">
        {(Object.entries(NODE_TYPE_COLORS) as [BrainNodeType, string][]).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-[10px] text-zinc-400 capitalize">{type}</span>
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div className="absolute top-3 right-3 text-[10px] text-zinc-600 bg-zinc-900/50 px-2 py-1 rounded">
        Drag nodes • Scroll to zoom • Click node for details
      </div>

      {/* Hover Tooltip */}
      {hoveredNode && !selectedNode && (
        <div
          className="absolute z-50 max-w-xs p-2 rounded bg-zinc-800 border border-zinc-700 shadow-lg pointer-events-none"
          style={{
            left: tooltipPos.x + 10,
            top: tooltipPos.y + 10,
          }}
        >
          <div className="text-[12px] font-medium text-zinc-100 mb-1">
            {hoveredNode.title}
          </div>
          {hoveredNode.summary && (
            <div className="text-[11px] text-zinc-400 mb-1">
              {hoveredNode.summary}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: NODE_TYPE_COLORS[hoveredNode.node_type] + "20",
                color: NODE_TYPE_COLORS[hoveredNode.node_type],
              }}
            >
              {hoveredNode.node_type}
            </span>
            {hoveredNode.category && (
              <span className="text-[9px] text-zinc-500">
                {hoveredNode.category}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Selected Node Detail Panel */}
      {selectedNode && (
        <div className="absolute top-3 left-3 w-80 max-h-[calc(100%-6rem)] overflow-auto rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl">
          <div className="sticky top-0 flex items-center justify-between p-3 border-b border-zinc-800 bg-zinc-900">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: NODE_TYPE_COLORS[selectedNode.node_type] }}
              />
              <span className="text-[11px] text-zinc-400 capitalize">
                {selectedNode.node_type}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 rounded hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>
          <div className="p-3">
            <h3 className="text-[14px] font-medium text-zinc-100 mb-2">
              {selectedNode.title}
            </h3>
            {selectedNode.summary && (
              <p className="text-[12px] text-zinc-400 mb-3">
                {selectedNode.summary}
              </p>
            )}
            <div className="text-[11px] text-zinc-300 whitespace-pre-wrap mb-3 font-mono bg-zinc-800/50 p-2 rounded">
              {selectedNode.content}
            </div>
            {selectedNode.category && (
              <div className="text-[10px] text-zinc-500 mb-2">
                Category: <span className="text-zinc-400">{selectedNode.category}</span>
              </div>
            )}
            {selectedNode.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedNode.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {selectedNode.source_url && (
              <a
                href={selectedNode.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-[10px] text-blue-400 hover:underline truncate"
              >
                {selectedNode.source_url}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
