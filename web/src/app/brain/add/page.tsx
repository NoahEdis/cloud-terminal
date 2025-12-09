"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Brain,
  X,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBrainNode } from "@/lib/api";
import type { BrainNodeInput, BrainNodeType, BrainSourceType } from "@/lib/brain-types";
import { NODE_TYPE_META, SOURCE_TYPE_META } from "@/lib/brain-types";

export default function AddBrainNodePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [nodeType, setNodeType] = useState<BrainNodeType>("principle");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceType, setSourceType] = useState<BrainSourceType>("manual");
  const [sourceUrl, setSourceUrl] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [priority, setPriority] = useState(0);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      setError("Title and content are required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const input: BrainNodeInput = {
        node_type: nodeType,
        title: title.trim(),
        content: content.trim(),
        summary: summary.trim() || undefined,
        source_type: sourceType,
        source_url: sourceUrl.trim() || undefined,
        category: category.trim() || undefined,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        priority,
      };

      await createBrainNode(input);
      router.push("/brain");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create brain node");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/brain")}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <Brain className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-100">Add Brain Node</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[12px] text-zinc-500">
            New knowledge entry
          </span>
        </div>
      </header>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 max-w-xl">
          {/* Node Type */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Type
            </label>
            <Select value={nodeType} onValueChange={(v) => setNodeType(v as BrainNodeType)}>
              <SelectTrigger className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {(Object.keys(NODE_TYPE_META) as BrainNodeType[]).map((type) => (
                  <SelectItem key={type} value={type} className="text-[12px] text-zinc-200">
                    <div className="flex flex-col">
                      <span>{NODE_TYPE_META[type].label}</span>
                      <span className="text-[10px] text-zinc-500">
                        {NODE_TYPE_META[type].description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Title *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Prefer TypeScript over JavaScript"
              className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          {/* Summary */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Summary
            </label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief description for list views"
              className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          {/* Content */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Content *
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Detailed explanation, reasoning, or documentation..."
              rows={8}
              className="text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 resize-none"
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Category
            </label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., frontend, backend, devops"
              className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Tags (comma-separated)
            </label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="typescript, react, best-practice"
              className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          {/* Source Type */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Source
            </label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as BrainSourceType)}>
              <SelectTrigger className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {(Object.keys(SOURCE_TYPE_META) as BrainSourceType[]).map((type) => (
                  <SelectItem key={type} value={type} className="text-[12px] text-zinc-200">
                    {SOURCE_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Source URL (if GitHub) */}
          {sourceType === "github" && (
            <div className="space-y-1.5 mb-4">
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
                Source URL
              </label>
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://github.com/..."
                className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          )}

          {/* Priority */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Priority (0-100)
            </label>
            <Input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
              className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 w-24"
            />
            <p className="text-[10px] text-zinc-600">Higher values appear first in lists</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 mt-4 p-2 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-[12px]">
              <X className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => router.push("/brain")}
          className="h-8 px-3 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!title.trim() || !content.trim() || submitting}
          className="h-8 px-3 text-[12px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Create Node
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
