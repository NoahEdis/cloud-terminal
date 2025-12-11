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
  Save,
  Edit3,
  Layers,
  ChevronDown,
  Plus,
  Trash2,
  Target,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  // Grouping
  group?: string;
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

interface GraphMetadata {
  labels: string[];
  relationshipTypes: string[];
  nodeCount: number;
  edgeCount: number;
  propertyKeys: string[];
}

// Grouping strategy types
type GroupingStrategy = "none" | "label" | "property" | "cluster";

// Context filter for traversal-based filtering
interface ContextFilter {
  id: string;
  name: string;
  rootNodeId: string;
  rootNodeLabel: string;
  direction: "outgoing" | "incoming" | "both";
  depth: number;
  excludeLabels: string[];
  includeLabels: string[];
  excludeRelationships: string[];
  includeRelationships: string[];
}

interface GraphViewProps {
  onNodeSelect?: (node: GraphNode | null) => void;
  className?: string;
  sessionId?: string;
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
  Client: "#F59E0B",       // amber-500
  System: "#06B6D4",       // cyan-500
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
// LocalStorage helpers for saved filters
// ============================================================================

const SAVED_FILTERS_KEY = "graph_context_filters";
const SESSION_ACTIVE_FILTER_KEY = "graph_session_active_filters";

function getSavedFilters(): ContextFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(SAVED_FILTERS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFilters(filters: ContextFilter[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters));
}

// Per-session active filter state
function getSessionActiveFilter(sessionId: string | undefined): string | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const stored = localStorage.getItem(SESSION_ACTIVE_FILTER_KEY);
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    return map[sessionId] || null;
  } catch {
    return null;
  }
}

function setSessionActiveFilter(sessionId: string | undefined, filterId: string | null) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const stored = localStorage.getItem(SESSION_ACTIVE_FILTER_KEY);
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    if (filterId) {
      map[sessionId] = filterId;
    } else {
      delete map[sessionId];
    }
    localStorage.setItem(SESSION_ACTIVE_FILTER_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// Component
// ============================================================================

export default function GraphView({ onNodeSelect, className = "", sessionId }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Core data state
  const [data, setData] = useState<GraphData | null>(null);
  const [metadata, setMetadata] = useState<GraphMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and basic filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLabels, setFilterLabels] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Selected node and editing
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isEditingNode, setIsEditingNode] = useState(false);
  const [editedProperties, setEditedProperties] = useState<Record<string, string>>({});
  const [savingNode, setSavingNode] = useState(false);

  // Grouping
  const [groupingStrategy, setGroupingStrategy] = useState<GroupingStrategy>("none");
  const [groupingProperty, setGroupingProperty] = useState<string>(""); // For property-based grouping

  // Context filters (advanced traversal-based filtering)
  const [savedFilters, setSavedFilters] = useState<ContextFilter[]>([]);
  const [activeFilter, setActiveFilter] = useState<ContextFilter | null>(null);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [filterBuilderState, setFilterBuilderState] = useState<Partial<ContextFilter>>({
    direction: "outgoing",
    depth: 2,
    excludeLabels: [],
    includeLabels: [],
    excludeRelationships: [],
    includeRelationships: [],
  });

  // D3 references
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Helper to set active filter and persist to session storage
  const updateActiveFilter = useCallback((filter: ContextFilter | null) => {
    setActiveFilter(filter);
    setSessionActiveFilter(sessionId, filter?.id || null);
  }, [sessionId]);

  // Fetch graph metadata
  const fetchMetadata = useCallback(async () => {
    try {
      const response = await fetch("/api/graph/metadata");
      if (response.ok) {
        const meta = await response.json();
        setMetadata(meta);
      }
    } catch (err) {
      console.error("Failed to fetch metadata:", err);
    }
  }, []);

  // Fetch full graph data (clearFilter controls whether to clear activeFilter)
  const fetchGraphData = useCallback(async (clearFilter: boolean = true) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/graph");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const graphData: GraphData = await response.json();
      setData(graphData);
      if (clearFilter) {
        updateActiveFilter(null); // Only clear filter when explicitly refreshing
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph data");
    } finally {
      setLoading(false);
    }
  }, [updateActiveFilter]);

  // Fetch contextual (traversal-based) graph data
  const fetchContextualData = useCallback(async (filter: ContextFilter, persistFilter: boolean = true) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        nodeId: filter.rootNodeId,
        direction: filter.direction,
        depth: filter.depth.toString(),
      });
      if (filter.excludeLabels.length > 0) {
        params.set("excludeLabels", filter.excludeLabels.join(","));
      }
      if (filter.includeLabels.length > 0) {
        params.set("includeLabels", filter.includeLabels.join(","));
      }
      if (filter.excludeRelationships.length > 0) {
        params.set("excludeRelationships", filter.excludeRelationships.join(","));
      }
      if (filter.includeRelationships.length > 0) {
        params.set("includeRelationships", filter.includeRelationships.join(","));
      }

      const response = await fetch(`/api/graph/traverse?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      setData({ nodes: result.nodes, edges: result.edges });
      if (persistFilter) {
        updateActiveFilter(filter);
      } else {
        // Just set local state without persisting (for restoring saved filter)
        setActiveFilter(filter);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch contextual data");
    } finally {
      setLoading(false);
    }
  }, [updateActiveFilter]);

  // Load saved filters and initialize data on session change
  useEffect(() => {
    const filters = getSavedFilters();
    setSavedFilters(filters);

    // Check for session-specific saved filter
    const activeFilterId = getSessionActiveFilter(sessionId);
    if (activeFilterId) {
      const filter = filters.find(f => f.id === activeFilterId);
      if (filter) {
        // Restore the saved filter - fetch contextual data
        fetchContextualData(filter, false); // false = don't re-persist, just restore
        fetchMetadata();
        return; // Don't fetch full graph
      }
    }

    // No saved filter - fetch full graph
    fetchGraphData(false); // false = don't clear filter (there isn't one)
    fetchMetadata();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply grouping to nodes
  const applyGrouping = useCallback((nodes: GraphNode[]): GraphNode[] => {
    if (groupingStrategy === "none") {
      return nodes.map((n) => ({ ...n, group: undefined }));
    }

    if (groupingStrategy === "label") {
      return nodes.map((n) => ({
        ...n,
        group: n.labels[0] || "Unknown",
      }));
    }

    if (groupingStrategy === "property" && groupingProperty) {
      return nodes.map((n) => ({
        ...n,
        group: String(n.properties[groupingProperty] || "Unknown"),
      }));
    }

    return nodes;
  }, [groupingStrategy, groupingProperty]);

  // Filter data based on search and label filters
  const filteredData = useCallback((): GraphData | null => {
    if (!data) return null;

    let nodes = applyGrouping(data.nodes);
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
  }, [data, searchQuery, filterLabels, applyGrouping]);

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

    // Get unique groups for coloring/clustering
    const groups = new Set(nodes.map((n) => n.group).filter(Boolean));
    const groupColors = d3.scaleOrdinal(d3.schemeTableau10).domain(Array.from(groups) as string[]);

    // Create force simulation with grouping forces
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(edges)
        .id((d) => d.id)
        .distance(100)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    // Add grouping force if grouping is enabled
    if (groupingStrategy !== "none" && groups.size > 1) {
      const groupCenters = new Map<string, { x: number; y: number }>();
      const groupArray = Array.from(groups);
      const cols = Math.ceil(Math.sqrt(groupArray.length));

      groupArray.forEach((group, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        groupCenters.set(group as string, {
          x: (col + 0.5) * (width / cols),
          y: (row + 0.5) * (height / Math.ceil(groupArray.length / cols)),
        });
      });

      simulation.force("groupX", d3.forceX<GraphNode>((d) => {
        if (d.group && groupCenters.has(d.group)) {
          return groupCenters.get(d.group)!.x;
        }
        return width / 2;
      }).strength(0.1));

      simulation.force("groupY", d3.forceY<GraphNode>((d) => {
        if (d.group && groupCenters.has(d.group)) {
          return groupCenters.get(d.group)!.y;
        }
        return height / 2;
      }).strength(0.1));
    }

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

    // Node circles - use group color if grouping, otherwise label color
    node.append("circle")
      .attr("r", 12)
      .attr("fill", (d) => {
        if (groupingStrategy !== "none" && d.group) {
          return groupColors(d.group);
        }
        return getNodeColor(d.labels);
      })
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
        setIsEditingNode(false);
        setEditedProperties({});
        onNodeSelect?.(d);
      });

    // Click on background to deselect
    svg.on("click", () => {
      setSelectedNode(null);
      setIsEditingNode(false);
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
  }, [filteredData, onNodeSelect, groupingStrategy]);

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

  // Node editing functions
  const startEditingNode = () => {
    if (!selectedNode) return;
    const props: Record<string, string> = {};
    Object.entries(selectedNode.properties).forEach(([key, value]) => {
      props[key] = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    });
    setEditedProperties(props);
    setIsEditingNode(true);
  };

  const saveNodeChanges = async () => {
    if (!selectedNode) return;

    setSavingNode(true);
    try {
      // Parse edited properties back to proper types
      const newProperties: Record<string, unknown> = {};
      Object.entries(editedProperties).forEach(([key, value]) => {
        // Try to parse as JSON first, fall back to string
        try {
          newProperties[key] = JSON.parse(value);
        } catch {
          newProperties[key] = value;
        }
      });

      const response = await fetch("/api/graph", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedNode.id,
          properties: newProperties,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save: ${response.statusText}`);
      }

      const updatedNode = await response.json();

      // Update local data
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === selectedNode.id ? { ...n, ...updatedNode } : n
          ),
        };
      });

      setSelectedNode({ ...selectedNode, ...updatedNode });
      setIsEditingNode(false);
    } catch (err) {
      console.error("Failed to save node:", err);
      alert("Failed to save changes");
    } finally {
      setSavingNode(false);
    }
  };

  const addProperty = () => {
    const key = prompt("Property name:");
    if (key && !editedProperties[key]) {
      setEditedProperties((prev) => ({ ...prev, [key]: "" }));
    }
  };

  const removeProperty = (key: string) => {
    setEditedProperties((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Context filter functions
  const [filterName, setFilterName] = useState("");

  const createContextFilterFromNode = (node: GraphNode) => {
    setFilterBuilderState({
      rootNodeId: node.id,
      rootNodeLabel: node.label,
      direction: "outgoing",
      depth: 2,
      excludeLabels: [],
      includeLabels: [],
      excludeRelationships: [],
      includeRelationships: [],
    });
    setFilterName(node.label || "New Filter");
    setShowFilterBuilder(true);
  };

  const saveContextFilter = () => {
    if (!filterBuilderState.rootNodeId || !filterBuilderState.rootNodeLabel) return;
    if (!filterName.trim()) return;

    const newFilter: ContextFilter = {
      id: Date.now().toString(),
      name: filterName.trim(),
      rootNodeId: filterBuilderState.rootNodeId,
      rootNodeLabel: filterBuilderState.rootNodeLabel,
      direction: filterBuilderState.direction || "outgoing",
      depth: filterBuilderState.depth || 2,
      excludeLabels: filterBuilderState.excludeLabels || [],
      includeLabels: filterBuilderState.includeLabels || [],
      excludeRelationships: filterBuilderState.excludeRelationships || [],
      includeRelationships: filterBuilderState.includeRelationships || [],
    };

    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    saveFilters(updated);
    setShowFilterBuilder(false);
    setFilterName("");
  };

  const applyContextFilter = (filter: ContextFilter) => {
    fetchContextualData(filter);
  };

  const deleteContextFilter = (id: string) => {
    const updated = savedFilters.filter((f) => f.id !== id);
    setSavedFilters(updated);
    saveFilters(updated);
  };

  const clearActiveFilter = () => {
    updateActiveFilter(null);
    fetchGraphData();
  };

  const filtered = filteredData();
  const availableLabels = metadata?.labels || [];

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

        {/* Grouping dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`p-1.5 rounded border transition-colors flex items-center gap-1 ${
                groupingStrategy !== "none"
                  ? "border-purple-600 bg-purple-950/50 text-purple-400"
                  : "border-zinc-800 hover:bg-zinc-800 text-zinc-400"
              }`}
              title="Grouping"
            >
              <Layers className="w-3.5 h-3.5" />
              <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 bg-zinc-900 border-zinc-800">
            <DropdownMenuLabel className="text-[11px] text-zinc-500">Grouping Strategy</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuItem
              onClick={() => setGroupingStrategy("none")}
              className={`text-[12px] ${groupingStrategy === "none" ? "text-purple-400" : ""}`}
            >
              {groupingStrategy === "none" && <Check className="w-3 h-3 mr-2" />}
              No grouping
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setGroupingStrategy("label")}
              className={`text-[12px] ${groupingStrategy === "label" ? "text-purple-400" : ""}`}
            >
              {groupingStrategy === "label" && <Check className="w-3 h-3 mr-2" />}
              By label
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuLabel className="text-[11px] text-zinc-500">By Property</DropdownMenuLabel>
            {(metadata?.propertyKeys || []).slice(0, 10).map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => {
                  setGroupingStrategy("property");
                  setGroupingProperty(key);
                }}
                className={`text-[12px] ${groupingStrategy === "property" && groupingProperty === key ? "text-purple-400" : ""}`}
              >
                {groupingStrategy === "property" && groupingProperty === key && (
                  <Check className="w-3 h-3 mr-2" />
                )}
                {key}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Context filters dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`p-1.5 rounded border transition-colors flex items-center gap-1 ${
                activeFilter
                  ? "border-emerald-600 bg-emerald-950/50 text-emerald-400"
                  : "border-zinc-800 hover:bg-zinc-800 text-zinc-400"
              }`}
              title="Context filters"
            >
              <Target className="w-3.5 h-3.5" />
              <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 bg-zinc-900 border-zinc-800">
            <DropdownMenuLabel className="text-[11px] text-zinc-500">Context Filters</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-zinc-800" />
            {activeFilter && (
              <>
                <DropdownMenuItem onClick={clearActiveFilter} className="text-[12px] text-amber-400">
                  <X className="w-3 h-3 mr-2" />
                  Clear active: {activeFilter.name}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-800" />
              </>
            )}
            {savedFilters.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-zinc-500 text-center">
                No saved filters. Select a node and use &quot;Focus on this&quot; to create one.
              </div>
            ) : (
              savedFilters.map((filter) => (
                <DropdownMenuItem
                  key={filter.id}
                  className="text-[12px] flex items-center justify-between group"
                >
                  <span onClick={() => applyContextFilter(filter)} className="flex-1 cursor-pointer">
                    {filter.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteContextFilter(filter.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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
          onClick={() => fetchGraphData(true)}
          disabled={loading}
          className="p-1.5 rounded border border-zinc-800 hover:bg-zinc-800 text-zinc-400 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        {/* Stats */}
        <div className="ml-auto text-[11px] text-zinc-500">
          {activeFilter && (
            <span className="text-emerald-400 mr-2">
              Filtered: {activeFilter.name}
            </span>
          )}
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
                onClick={() => fetchGraphData(true)}
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
              {(searchQuery || filterLabels.length > 0 || activeFilter) && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setFilterLabels([]);
                    if (activeFilter) clearActiveFilter();
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
        <div className="absolute bottom-4 right-4 w-80 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden z-20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getNodeColor(selectedNode.labels) }}
              />
              <span className="text-[12px] font-medium text-zinc-200 truncate">
                {selectedNode.label || selectedNode.id}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!isEditingNode ? (
                <>
                  <button
                    onClick={() => createContextFilterFromNode(selectedNode)}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400"
                    title="Focus on this node"
                  >
                    <Target className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={startEditingNode}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-blue-400"
                    title="Edit properties"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={saveNodeChanges}
                    disabled={savingNode}
                    className="p-1 rounded hover:bg-zinc-800 text-emerald-500 hover:text-emerald-400 disabled:opacity-50"
                    title="Save changes"
                  >
                    {savingNode ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => setIsEditingNode(false)}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  setSelectedNode(null);
                  setIsEditingNode(false);
                  onNodeSelect?.(null);
                }}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-3 max-h-64 overflow-auto">
            {/* Labels */}
            <div className="mb-3">
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

            {/* Properties */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Properties
                </div>
                {isEditingNode && (
                  <button
                    onClick={addProperty}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                )}
              </div>

              {isEditingNode ? (
                <div className="space-y-2">
                  {Object.entries(editedProperties).map(([key, value]) => (
                    <div key={key} className="flex items-start gap-1">
                      <div className="flex-1">
                        <div className="text-[10px] text-zinc-500 mb-0.5 flex items-center justify-between">
                          <span>{key}</span>
                          <button
                            onClick={() => removeProperty(key)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <Input
                          value={value}
                          onChange={(e) =>
                            setEditedProperties((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                          className="h-6 text-[11px] bg-zinc-800 border-zinc-700 text-zinc-200"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {Object.keys(selectedNode.properties).length === 0 ? (
                    <p className="text-[11px] text-zinc-600 italic">No properties</p>
                  ) : (
                    Object.entries(selectedNode.properties).map(([key, value]) => (
                      <div key={key} className="text-[11px]">
                        <span className="text-zinc-500">{key}:</span>{" "}
                        <span className="text-zinc-300">
                          {typeof value === "object"
                            ? JSON.stringify(value).slice(0, 100)
                            : String(value).slice(0, 100)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context Filter Builder Modal */}
      {showFilterBuilder && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30">
          <div className="w-96 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <span className="text-[13px] font-medium text-zinc-200">
                Create Context Filter
              </span>
              <button
                onClick={() => setShowFilterBuilder(false)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Filter name */}
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Filter name</div>
                <Input
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="Enter filter name..."
                  className="h-8 text-[12px] bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500"
                  autoFocus
                />
              </div>

              {/* Root node */}
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Starting from</div>
                <div className="px-3 py-2 bg-zinc-800 rounded text-[12px] text-zinc-200">
                  {filterBuilderState.rootNodeLabel}
                </div>
              </div>

              {/* Direction */}
              <div>
                <div className="text-[11px] text-zinc-500 mb-2">Traverse direction</div>
                <div className="flex gap-2">
                  {[
                    { value: "outgoing", icon: ArrowRight, label: "Outgoing" },
                    { value: "incoming", icon: ArrowLeft, label: "Incoming" },
                    { value: "both", icon: ArrowLeftRight, label: "Both" },
                  ].map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() =>
                        setFilterBuilderState((prev) => ({
                          ...prev,
                          direction: value as "outgoing" | "incoming" | "both",
                        }))
                      }
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] transition-colors ${
                        filterBuilderState.direction === value
                          ? "bg-emerald-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Depth */}
              <div>
                <div className="text-[11px] text-zinc-500 mb-2">Depth (hops)</div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((d) => (
                    <button
                      key={d}
                      onClick={() =>
                        setFilterBuilderState((prev) => ({ ...prev, depth: d }))
                      }
                      className={`flex-1 px-2 py-1.5 rounded text-[11px] transition-colors ${
                        filterBuilderState.depth === d
                          ? "bg-emerald-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exclude labels */}
              <div>
                <div className="text-[11px] text-zinc-500 mb-2">Exclude labels (optional)</div>
                <div className="flex gap-1 flex-wrap">
                  {availableLabels.map((label) => (
                    <button
                      key={label}
                      onClick={() => {
                        setFilterBuilderState((prev) => ({
                          ...prev,
                          excludeLabels: prev.excludeLabels?.includes(label)
                            ? prev.excludeLabels.filter((l) => l !== label)
                            : [...(prev.excludeLabels || []), label],
                        }));
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        filterBuilderState.excludeLabels?.includes(label)
                          ? "bg-red-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exclude relationships */}
              {metadata?.relationshipTypes && metadata.relationshipTypes.length > 0 && (
                <div>
                  <div className="text-[11px] text-zinc-500 mb-2">
                    Exclude relationships (optional)
                  </div>
                  <div className="flex gap-1 flex-wrap max-h-24 overflow-auto">
                    {metadata.relationshipTypes.map((type) => (
                      <button
                        key={type}
                        onClick={() => {
                          setFilterBuilderState((prev) => ({
                            ...prev,
                            excludeRelationships: prev.excludeRelationships?.includes(type)
                              ? prev.excludeRelationships.filter((t) => t !== type)
                              : [...(prev.excludeRelationships || []), type],
                          }));
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                          filterBuilderState.excludeRelationships?.includes(type)
                            ? "bg-red-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowFilterBuilder(false);
                  setFilterName("");
                }}
                className="text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveContextFilter}
                disabled={!filterName.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Filter
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
