"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  File,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ResourceNode, ResourceHierarchy } from "@/lib/credential-types";

interface ResourceHierarchyEditorProps {
  hierarchy: ResourceHierarchy | null;
  serviceType: string;
  onChange: (hierarchy: ResourceHierarchy) => void;
  className?: string;
}

interface EditableNodeProps {
  node: ResourceNode;
  depth: number;
  onUpdate: (node: ResourceNode) => void;
  onDelete: () => void;
  onAddChild: () => void;
}

const RESOURCE_TYPES = [
  "team",
  "workspace",
  "space",
  "folder",
  "project",
  "base",
  "list",
  "table",
  "board",
  "document",
];

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
};

/**
 * An editable resource node with add/edit/delete capabilities.
 */
function EditableNode({
  node,
  depth,
  onUpdate,
  onDelete,
  onAddChild,
}: EditableNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [editType, setEditType] = useState(node.type);

  const hasChildren = node.children && node.children.length > 0;
  const Icon = resourceTypeIcons[node.type] || File;

  const handleSave = () => {
    onUpdate({
      ...node,
      name: editName,
      type: editType,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(node.name);
    setEditType(node.type);
    setIsEditing(false);
  };

  const handleUpdateChild = (index: number, updatedChild: ResourceNode) => {
    const newChildren = [...(node.children || [])];
    newChildren[index] = updatedChild;
    onUpdate({ ...node, children: newChildren });
  };

  const handleDeleteChild = (index: number) => {
    const newChildren = (node.children || []).filter((_, i) => i !== index);
    onUpdate({ ...node, children: newChildren });
  };

  const handleAddChild = () => {
    const newChild: ResourceNode = {
      id: `new-${Date.now()}`,
      name: "New Resource",
      type: "folder",
      children: [],
    };
    onUpdate({
      ...node,
      children: [...(node.children || []), newChild],
    });
  };

  return (
    <div className="select-none">
      <div
        className={cn(
          "group flex items-center gap-1.5 py-1 px-2 rounded hover:bg-zinc-800/30 transition-colors",
          depth > 0 && "ml-4"
        )}
      >
        {/* Expand/collapse toggle */}
        <button
          className="w-3 h-3 flex items-center justify-center text-zinc-600 hover:text-zinc-400"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )
          ) : null}
        </button>

        {isEditing ? (
          <>
            <Select value={editType} onValueChange={setEditType}>
              <SelectTrigger className="h-6 w-24 text-[10px] bg-zinc-900 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type} className="text-[10px]">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-6 flex-1 text-[11px] bg-zinc-900 border-zinc-700"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <button
              onClick={handleSave}
              className="p-1 text-green-500 hover:text-green-400"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 text-zinc-500 hover:text-zinc-400"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <Icon className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] text-zinc-400 truncate flex-1">
              {node.name}
            </span>
            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800/50 text-zinc-600">
              {node.type}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 text-zinc-600 hover:text-zinc-400"
                title="Edit"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                onClick={handleAddChild}
                className="p-1 text-zinc-600 hover:text-zinc-400"
                title="Add child"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={onDelete}
                className="p-1 text-zinc-600 hover:text-red-400"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="border-l border-zinc-800/50 ml-[18px]">
          {node.children!.map((child, idx) => (
            <EditableNode
              key={child.id || idx}
              node={child}
              depth={depth + 1}
              onUpdate={(updated) => handleUpdateChild(idx, updated)}
              onDelete={() => handleDeleteChild(idx)}
              onAddChild={handleAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Editor component for manually creating and editing resource hierarchies.
 */
export function ResourceHierarchyEditor({
  hierarchy,
  serviceType,
  onChange,
  className,
}: ResourceHierarchyEditorProps) {
  const currentHierarchy: ResourceHierarchy = hierarchy || {
    service_type: serviceType,
    last_synced_at: null,
    resources: [],
  };

  const handleAddRoot = () => {
    const newNode: ResourceNode = {
      id: `new-${Date.now()}`,
      name: "New Resource",
      type: "team",
      children: [],
    };
    onChange({
      ...currentHierarchy,
      resources: [...currentHierarchy.resources, newNode],
    });
  };

  const handleUpdateRoot = (index: number, updatedNode: ResourceNode) => {
    const newResources = [...currentHierarchy.resources];
    newResources[index] = updatedNode;
    onChange({
      ...currentHierarchy,
      resources: newResources,
    });
  };

  const handleDeleteRoot = (index: number) => {
    const newResources = currentHierarchy.resources.filter((_, i) => i !== index);
    onChange({
      ...currentHierarchy,
      resources: newResources,
    });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {serviceType} Resources
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] px-2"
          onClick={handleAddRoot}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add Root
        </Button>
      </div>

      {currentHierarchy.resources.length === 0 ? (
        <div className="text-[11px] text-zinc-600 py-4 text-center border border-dashed border-zinc-800 rounded">
          No resources configured. Click "Add Root" to start.
        </div>
      ) : (
        <div className="space-y-0.5 border border-zinc-800 rounded p-2 bg-zinc-900/30">
          {currentHierarchy.resources.map((node, idx) => (
            <EditableNode
              key={node.id || idx}
              node={node}
              depth={0}
              onUpdate={(updated) => handleUpdateRoot(idx, updated)}
              onDelete={() => handleDeleteRoot(idx)}
              onAddChild={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
