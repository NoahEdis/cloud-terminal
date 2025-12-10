import { NextRequest, NextResponse } from "next/server";

interface GraphMetadata {
  labels: string[];
  relationshipTypes: string[];
  nodeCount: number;
  edgeCount: number;
  propertyKeys: string[];
}

/**
 * Get metadata about the graph: available labels, relationship types, counts, etc.
 * Useful for building filter UIs.
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

    // Fetch all nodes to extract labels and property keys
    const nodesResponse = await fetch(
      `${supabaseUrl}/rest/v1/graph_nodes?select=labels,properties`,
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
      labels: string[];
      properties: Record<string, unknown>;
    }> = await nodesResponse.json();

    // Extract unique labels and property keys
    const labelsSet = new Set<string>();
    const propertyKeysSet = new Set<string>();

    rawNodes.forEach((node) => {
      (node.labels || []).forEach((l) => labelsSet.add(l));
      Object.keys(node.properties || {}).forEach((k) => propertyKeysSet.add(k));
    });

    // Fetch relationships to get unique types
    const edgesResponse = await fetch(
      `${supabaseUrl}/rest/v1/graph_relationships?select=type`,
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

    const rawEdges: Array<{ type: string }> = await edgesResponse.json();

    const relationshipTypesSet = new Set<string>();
    rawEdges.forEach((edge) => {
      if (edge.type) relationshipTypesSet.add(edge.type);
    });

    const metadata: GraphMetadata = {
      labels: Array.from(labelsSet).sort(),
      relationshipTypes: Array.from(relationshipTypesSet).sort(),
      nodeCount: rawNodes.length,
      edgeCount: rawEdges.length,
      propertyKeys: Array.from(propertyKeysSet).sort(),
    };

    return NextResponse.json(metadata);
  } catch (error) {
    console.error("Graph metadata error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch metadata" },
      { status: 500 }
    );
  }
}
