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

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Fetch graph data from Supabase
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Get query params for filtering
    const { searchParams } = new URL(request.url);
    const labels = searchParams.get("labels")?.split(",").filter(Boolean);
    const limit = parseInt(searchParams.get("limit") || "500", 10);

    // Fetch nodes from graph_nodes table
    let nodesQuery = `${supabaseUrl}/rest/v1/graph_nodes?select=id,labels,properties,name&limit=${limit}`;

    // Add label filter if provided
    if (labels && labels.length > 0) {
      // Supabase array contains filter
      nodesQuery += `&labels=cs.{${labels.join(",")}}`;
    }

    const nodesResponse = await fetch(nodesQuery, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!nodesResponse.ok) {
      const error = await nodesResponse.text();
      console.error("Failed to fetch nodes:", error);
      return NextResponse.json(
        { error: `Failed to fetch nodes: ${nodesResponse.statusText}` },
        { status: nodesResponse.status }
      );
    }

    const rawNodes: Array<{
      id: string;
      labels: string[];
      properties: Record<string, unknown>;
      name?: string;
    }> = await nodesResponse.json();

    // Transform nodes
    const nodes: GraphNode[] = rawNodes.map((node) => ({
      id: node.id,
      label: node.name || (node.properties?.name as string) || node.labels[0] || node.id.slice(0, 8),
      labels: node.labels || [],
      properties: node.properties || {},
    }));

    // Build set of node IDs for filtering relationships
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Fetch relationships from graph_relationships table
    const edgesResponse = await fetch(
      `${supabaseUrl}/rest/v1/graph_relationships?select=id,type,source_node_id,target_node_id,properties&limit=${limit * 2}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!edgesResponse.ok) {
      const error = await edgesResponse.text();
      console.error("Failed to fetch relationships:", error);
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

    // Filter edges to only include those where both nodes are in our node set
    const edges: GraphEdge[] = rawEdges
      .filter((edge) => nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id))
      .map((edge) => ({
        id: edge.id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        type: edge.type || "RELATED_TO",
        properties: edge.properties,
      }));

    const graphData: GraphData = { nodes, edges };

    return NextResponse.json(graphData);
  } catch (error) {
    console.error("Graph API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch graph" },
      { status: 500 }
    );
  }
}
