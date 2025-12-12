"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResourceNode, ResourceHierarchy } from "@/lib/credential-types";

interface ResourceHierarchyTreeProps {
  hierarchy: ResourceHierarchy;
  className?: string;
}

interface ResourceNodeItemProps {
  node: ResourceNode;
  depth?: number;
}

/**
 * Icon mapping for different resource types.
 */
const resourceTypeIcons: Record<string, typeof Folder> = {
  team: Folder,
  workspace: Folder,
  space: Folder,
  folder: Folder,
  project: Folder,
  base: Folder,
  list: File,
  table: File,
  board: File,
  document: File,
  default: File,
};

/**
 * A single resource node in the tree.
 */
function ResourceNodeItem({ node, depth = 0 }: ResourceNodeItemProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2); // Auto-expand first 2 levels
  const hasChildren = node.children && node.children.length > 0;
  const Icon = resourceTypeIcons[node.type] || resourceTypeIcons.default;

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-2 rounded hover:bg-zinc-800/30 transition-colors cursor-pointer",
          depth > 0 && "ml-4"
        )}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren ? (
          <span className="w-3 h-3 flex items-center justify-center text-zinc-600">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        ) : (
          <span className="w-3 h-3" />
        )}
        <Icon className="w-3 h-3 text-zinc-500" />
        <span className="text-[11px] text-zinc-400 truncate">{node.name}</span>
        <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800/50 text-zinc-600">
          {node.type}
        </span>
      </div>
      {hasChildren && isExpanded && (
        <div className="border-l border-zinc-800/50 ml-[18px]">
          {node.children!.map((child, idx) => (
            <ResourceNodeItem key={child.id || idx} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Displays a resource hierarchy as an expandable tree.
 * Shows what API resources are accessible via a credential.
 */
export function ResourceHierarchyTree({
  hierarchy,
  className,
}: ResourceHierarchyTreeProps) {
  if (!hierarchy.resources || hierarchy.resources.length === 0) {
    return (
      <div className={cn("text-[11px] text-zinc-600 py-2", className)}>
        No resources configured
      </div>
    );
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {hierarchy.service_type} Resources
        </span>
        {hierarchy.last_synced_at && (
          <span className="text-[9px] text-zinc-600">
            Synced: {new Date(hierarchy.last_synced_at).toLocaleDateString()}
          </span>
        )}
      </div>
      {hierarchy.resources.map((node, idx) => (
        <ResourceNodeItem key={node.id || idx} node={node} />
      ))}
    </div>
  );
}
