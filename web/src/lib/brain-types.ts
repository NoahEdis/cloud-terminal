/**
 * Types for brain knowledge management.
 * Brain nodes store reasoning methodology, thought processes, and system preferences.
 */

// ============================================================================
// Brain Node Types
// ============================================================================

/**
 * Node type classification for brain knowledge.
 */
export type BrainNodeType =
  | "reasoning"    // Reasoning methodology/approach
  | "preference"   // Preferred tool/library/application
  | "workflow"     // Standard workflow/process
  | "principle"    // Core principle/guideline
  | "pattern"      // Code pattern or architectural pattern
  | "reference";   // External reference/documentation link

/**
 * Source type indicating where the knowledge came from.
 */
export type BrainSourceType =
  | "github"    // From GitHub repository/document
  | "manual"    // Manually entered
  | "inferred"  // AI-inferred from behavior
  | "imported"; // Imported from another system

/**
 * A brain knowledge node stored in Supabase.
 */
export interface BrainNode {
  id: string;
  node_type: BrainNodeType;
  title: string;
  content: string;
  summary: string | null;
  source_type: BrainSourceType;
  source_url: string | null;
  source_path: string | null;
  source_commit: string | null;
  category: string | null;
  tags: string[];
  parent_id: string | null;
  related_ids: string[];
  priority: number;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a new brain node.
 */
export interface BrainNodeInput {
  node_type: BrainNodeType;
  title: string;
  content: string;
  summary?: string;
  source_type?: BrainSourceType;
  source_url?: string;
  source_path?: string;
  source_commit?: string;
  category?: string;
  tags?: string[];
  parent_id?: string;
  related_ids?: string[];
  priority?: number;
}

/**
 * Input for updating a brain node.
 */
export interface BrainNodeUpdate {
  node_type?: BrainNodeType;
  title?: string;
  content?: string;
  summary?: string;
  source_type?: BrainSourceType;
  source_url?: string;
  source_path?: string;
  source_commit?: string;
  category?: string;
  tags?: string[];
  parent_id?: string | null;
  related_ids?: string[];
  priority?: number;
  is_active?: boolean;
}

// ============================================================================
// Display & Grouping
// ============================================================================

/**
 * Brain nodes grouped by category.
 */
export interface BrainNodesByCategory {
  category: string;
  nodes: BrainNode[];
}

/**
 * Brain nodes grouped by type.
 */
export interface BrainNodesByType {
  type: BrainNodeType;
  nodes: BrainNode[];
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Statistics about brain nodes.
 */
export interface BrainStats {
  total: number;
  byType: Record<BrainNodeType, number>;
  byCategory: Record<string, number>;
  bySourceType: Record<BrainSourceType, number>;
}

// ============================================================================
// Search & Filtering
// ============================================================================

/**
 * Filter options for brain node queries.
 */
export interface BrainNodeFilters {
  node_type?: BrainNodeType;
  category?: string;
  source_type?: BrainSourceType;
  tags?: string[];
  is_active?: boolean;
  search?: string;
}

// ============================================================================
// Graph Visualization
// ============================================================================

/**
 * A node in the brain graph visualization.
 */
export interface BrainGraphNode {
  id: string;
  label: string;
  type: BrainNodeType;
  category: string | null;
  priority: number;
}

/**
 * An edge in the brain graph visualization.
 */
export interface BrainGraphEdge {
  source: string;
  target: string;
  type: "parent-child" | "related";
}

/**
 * Complete graph data for brain visualization.
 */
export interface BrainGraphData {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
}

// ============================================================================
// UI Display Helpers
// ============================================================================

/**
 * Node type display metadata.
 */
export const NODE_TYPE_META: Record<BrainNodeType, { label: string; description: string }> = {
  reasoning: {
    label: "Reasoning",
    description: "Methodology and approach for problem-solving",
  },
  preference: {
    label: "Preference",
    description: "Preferred tools, libraries, or applications",
  },
  workflow: {
    label: "Workflow",
    description: "Standard processes and procedures",
  },
  principle: {
    label: "Principle",
    description: "Core guidelines and best practices",
  },
  pattern: {
    label: "Pattern",
    description: "Code or architectural patterns",
  },
  reference: {
    label: "Reference",
    description: "External documentation and links",
  },
};

/**
 * Source type display metadata.
 */
export const SOURCE_TYPE_META: Record<BrainSourceType, { label: string; description: string }> = {
  github: {
    label: "GitHub",
    description: "Sourced from GitHub repository",
  },
  manual: {
    label: "Manual",
    description: "Manually entered",
  },
  inferred: {
    label: "Inferred",
    description: "AI-inferred from behavior",
  },
  imported: {
    label: "Imported",
    description: "Imported from another system",
  },
};
