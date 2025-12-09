/**
 * Brain API routes for managing knowledge nodes.
 *
 * Provides endpoints for:
 * - CRUD operations on brain nodes
 * - Searching and filtering nodes
 * - Graph visualization data
 * - Statistics
 */

import { Hono } from "hono";
import * as supabase from "../supabase.js";

export const brainApi = new Hono();

// ============================================================================
// Brain Nodes CRUD
// ============================================================================

/**
 * GET / - List all brain nodes with optional filters
 * Query params: node_type, category, source_type, is_active
 */
brainApi.get("/", async (c) => {
  try {
    const nodeType = c.req.query("node_type") as supabase.BrainNodeType | undefined;
    const category = c.req.query("category");
    const sourceType = c.req.query("source_type") as supabase.BrainSourceType | undefined;
    const isActiveStr = c.req.query("is_active");
    const isActive = isActiveStr !== undefined ? isActiveStr === "true" : undefined;

    const nodes = await supabase.getBrainNodes({
      node_type: nodeType,
      category: category || undefined,
      source_type: sourceType,
      is_active: isActive,
    });

    return c.json(nodes);
  } catch (err) {
    console.error("[Brain API] Failed to get brain nodes:", err);
    return c.json({ error: "Failed to fetch brain nodes" }, 500);
  }
});

/**
 * GET /search - Search brain nodes by text
 * Query: ?q=search+terms
 */
brainApi.get("/search", async (c) => {
  const query = c.req.query("q");

  if (!query || query.trim().length < 2) {
    return c.json({ error: "Search query must be at least 2 characters" }, 400);
  }

  try {
    const nodes = await supabase.searchBrainNodes(query);
    return c.json(nodes);
  } catch (err) {
    console.error("[Brain API] Failed to search brain nodes:", err);
    return c.json({ error: "Failed to search brain nodes" }, 500);
  }
});

/**
 * GET /categories - Get all unique categories
 */
brainApi.get("/categories", async (c) => {
  try {
    const categories = await supabase.getBrainCategories();
    return c.json(categories);
  } catch (err) {
    console.error("[Brain API] Failed to get categories:", err);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
});

/**
 * GET /stats - Get brain nodes statistics
 */
brainApi.get("/stats", async (c) => {
  try {
    const stats = await supabase.getBrainStats();
    return c.json(stats);
  } catch (err) {
    console.error("[Brain API] Failed to get stats:", err);
    return c.json({ error: "Failed to fetch statistics" }, 500);
  }
});

/**
 * GET /:id - Get a single brain node by ID
 */
brainApi.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const node = await supabase.getBrainNode(id);

    if (!node) {
      return c.json({ error: "Brain node not found" }, 404);
    }

    return c.json(node);
  } catch (err) {
    console.error(`[Brain API] Failed to get brain node ${id}:`, err);
    return c.json({ error: "Failed to fetch brain node" }, 500);
  }
});

/**
 * POST / - Create a new brain node
 * Body: BrainNodeInput
 */
brainApi.post("/", async (c) => {
  try {
    const body = await c.req.json<supabase.BrainNodeInput>();

    // Validate required fields
    if (!body.node_type) {
      return c.json({ error: "node_type is required" }, 400);
    }
    if (!body.title || !body.title.trim()) {
      return c.json({ error: "title is required" }, 400);
    }
    if (!body.content || !body.content.trim()) {
      return c.json({ error: "content is required" }, 400);
    }

    // Validate node_type
    const validTypes: supabase.BrainNodeType[] = [
      "reasoning", "preference", "workflow", "principle", "pattern", "reference"
    ];
    if (!validTypes.includes(body.node_type)) {
      return c.json({ error: `Invalid node_type. Must be one of: ${validTypes.join(", ")}` }, 400);
    }

    const node = await supabase.createBrainNode(body);

    if (!node) {
      return c.json({ error: "Failed to create brain node" }, 500);
    }

    return c.json(node, 201);
  } catch (err) {
    console.error("[Brain API] Failed to create brain node:", err);
    const message = err instanceof Error ? err.message : "Failed to create brain node";
    return c.json({ error: message }, 500);
  }
});

/**
 * PATCH /:id - Update a brain node
 * Body: BrainNodeUpdate
 */
brainApi.patch("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json<supabase.BrainNodeUpdate>();

    // Validate node_type if provided
    if (body.node_type) {
      const validTypes: supabase.BrainNodeType[] = [
        "reasoning", "preference", "workflow", "principle", "pattern", "reference"
      ];
      if (!validTypes.includes(body.node_type)) {
        return c.json({ error: `Invalid node_type. Must be one of: ${validTypes.join(", ")}` }, 400);
      }
    }

    const node = await supabase.updateBrainNode(id, body);

    if (!node) {
      return c.json({ error: "Brain node not found" }, 404);
    }

    return c.json(node);
  } catch (err) {
    console.error(`[Brain API] Failed to update brain node ${id}:`, err);
    const message = err instanceof Error ? err.message : "Failed to update brain node";
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /:id - Delete a brain node
 */
brainApi.delete("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    await supabase.deleteBrainNode(id);
    return c.json({ success: true });
  } catch (err) {
    console.error(`[Brain API] Failed to delete brain node ${id}:`, err);
    return c.json({ error: "Failed to delete brain node" }, 500);
  }
});

// ============================================================================
// Graph Visualization
// ============================================================================

interface GraphNode {
  id: string;
  label: string;
  type: supabase.BrainNodeType;
  category: string | null;
  priority: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "parent-child" | "related";
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * GET /graph - Get graph visualization data
 */
brainApi.get("/graph", async (c) => {
  try {
    const brainNodes = await supabase.getBrainNodes({ is_active: true });

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const node of brainNodes) {
      // Add node
      nodes.push({
        id: node.id,
        label: node.title,
        type: node.node_type,
        category: node.category,
        priority: node.priority,
      });

      // Add parent-child edge
      if (node.parent_id) {
        edges.push({
          source: node.parent_id,
          target: node.id,
          type: "parent-child",
        });
      }

      // Add related edges
      for (const relatedId of node.related_ids) {
        // Only add edge if we haven't already added the reverse
        const existingEdge = edges.find(
          e => e.type === "related" &&
            ((e.source === node.id && e.target === relatedId) ||
             (e.source === relatedId && e.target === node.id))
        );
        if (!existingEdge) {
          edges.push({
            source: node.id,
            target: relatedId,
            type: "related",
          });
        }
      }
    }

    const graphData: GraphData = { nodes, edges };
    return c.json(graphData);
  } catch (err) {
    console.error("[Brain API] Failed to generate graph data:", err);
    return c.json({ error: "Failed to generate graph data" }, 500);
  }
});
