import { NextRequest, NextResponse } from "next/server";

interface GraphNode {
  id: string;
  label: string;
  labels: string[];
  properties: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

interface TraversalResult {
  rootNode: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Traverse the graph from a starting node.
 *
 * Query params:
 * - nodeId: Starting node ID (required)
 * - direction: "outgoing" | "incoming" | "both" (default: "outgoing")
 * - depth: How many hops to traverse (default: 2, max: 5)
 * - excludeLabels: Comma-separated labels to exclude from traversal
 * - includeLabels: Comma-separated labels to include (if set, only these are included)
 * - excludeRelationships: Comma-separated relationship types to exclude
 * - includeRelationships: Comma-separated relationship types to include
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Use service role key to bypass RLS on neo4j schema tables
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get("nodeId");
    const direction = searchParams.get("direction") || "outgoing";
    const depth = Math.min(parseInt(searchParams.get("depth") || "2", 10), 5);
    const excludeLabels = searchParams.get("excludeLabels")?.split(",").filter(Boolean) || [];
    const includeLabels = searchParams.get("includeLabels")?.split(",").filter(Boolean) || [];
    const excludeRelationships = searchParams.get("excludeRelationships")?.split(",").filter(Boolean) || [];
    const includeRelationships = searchParams.get("includeRelationships")?.split(",").filter(Boolean) || [];

    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }

    // Fetch all nodes
    const nodesResponse = await fetch(
      `${supabaseUrl}/rest/v1/graph_nodes?select=id,labels,properties`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Accept-Profile": "neo4j",
        },
      }
    );

    if (!nodesResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch nodes: ${nodesResponse.statusText}` },
        { status: nodesResponse.status }
      );
    }

    const rawNodes: Array<{
      id: string;
      labels: string[];
      properties: Record<string, unknown>;
    }> = await nodesResponse.json();

    // Build node lookup map
    const nodeMap = new Map<string, GraphNode>();
    rawNodes.forEach((node) => {
      nodeMap.set(node.id, {
        id: node.id,
        label: (node.properties?.name as string) || node.labels?.[0] || node.id.slice(0, 8),
        labels: node.labels || [],
        properties: node.properties || {},
      });
    });

    const rootNode = nodeMap.get(nodeId);
    if (!rootNode) {
      return NextResponse.json({ error: "Starting node not found" }, { status: 404 });
    }

    // Fetch all relationships
    const edgesResponse = await fetch(
      `${supabaseUrl}/rest/v1/graph_relationships?select=id,type,source_node_id,target_node_id,properties`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Accept-Profile": "neo4j",
        },
      }
    );

    if (!edgesResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch relationships: ${edgesResponse.statusText}` },
        { status: edgesResponse.status }
      );
    }

    const rawEdges: Array<{
      id: string;
      type: string;
      source_node_id: string;
      target_node_id: string;
      properties?: Record<string, unknown>;
    }> = await edgesResponse.json();

    // Build adjacency lists
    const outgoingEdges = new Map<string, typeof rawEdges>();
    const incomingEdges = new Map<string, typeof rawEdges>();

    rawEdges.forEach((edge) => {
      // Outgoing: source -> target
      if (!outgoingEdges.has(edge.source_node_id)) {
        outgoingEdges.set(edge.source_node_id, []);
      }
      outgoingEdges.get(edge.source_node_id)!.push(edge);

      // Incoming: target -> source
      if (!incomingEdges.has(edge.target_node_id)) {
        incomingEdges.set(edge.target_node_id, []);
      }
      incomingEdges.get(edge.target_node_id)!.push(edge);
    });

    // Helper to check if a node should be included
    const shouldIncludeNode = (node: GraphNode): boolean => {
      // Check exclude labels
      if (excludeLabels.length > 0) {
        if (node.labels.some((l) => excludeLabels.includes(l))) {
          return false;
        }
      }
      // Check include labels (if specified, only include these)
      if (includeLabels.length > 0) {
        if (!node.labels.some((l) => includeLabels.includes(l))) {
          return false;
        }
      }
      return true;
    };

    // Helper to check if an edge should be traversed
    const shouldTraverseEdge = (edge: typeof rawEdges[0]): boolean => {
      if (excludeRelationships.length > 0) {
        if (excludeRelationships.includes(edge.type)) {
          return false;
        }
      }
      if (includeRelationships.length > 0) {
        if (!includeRelationships.includes(edge.type)) {
          return false;
        }
      }
      return true;
    };

    // BFS traversal
    const visitedNodes = new Set<string>([nodeId]);
    const resultNodes: GraphNode[] = [rootNode];
    const resultEdges: GraphEdge[] = [];
    let frontier = [nodeId];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];

      for (const currentId of frontier) {
        const edges: typeof rawEdges = [];

        // Get edges based on direction
        if (direction === "outgoing" || direction === "both") {
          edges.push(...(outgoingEdges.get(currentId) || []));
        }
        if (direction === "incoming" || direction === "both") {
          edges.push(...(incomingEdges.get(currentId) || []));
        }

        for (const edge of edges) {
          if (!shouldTraverseEdge(edge)) continue;

          // Determine the neighbor node ID
          const neighborId = edge.source_node_id === currentId
            ? edge.target_node_id
            : edge.source_node_id;

          const neighborNode = nodeMap.get(neighborId);
          if (!neighborNode) continue;
          if (!shouldIncludeNode(neighborNode)) continue;

          // Add edge to results
          resultEdges.push({
            id: edge.id,
            source: edge.source_node_id,
            target: edge.target_node_id,
            type: edge.type,
            properties: edge.properties,
          });

          // Add node if not visited
          if (!visitedNodes.has(neighborId)) {
            visitedNodes.add(neighborId);
            resultNodes.push(neighborNode);
            nextFrontier.push(neighborId);
          }
        }
      }

      frontier = nextFrontier;
    }

    // Deduplicate edges (same edge might be added from different traversal paths)
    const uniqueEdges = Array.from(
      new Map(resultEdges.map((e) => [e.id, e])).values()
    );

    const result: TraversalResult = {
      rootNode,
      nodes: resultNodes,
      edges: uniqueEdges,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Graph traverse error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to traverse graph" },
      { status: 500 }
    );
  }
}
