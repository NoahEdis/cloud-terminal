"use client";

import { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Save,
  Loader2,
  Eye,
  Code,
  SplitSquareVertical,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ApiDocsEditorProps {
  open: boolean;
  onClose: () => void;
  title: string;
  initialContent: string;
  onSave: (content: string, commitMessage: string) => Promise<boolean>;
  generateCommitMessage?: (oldContent: string, newContent: string) => Promise<string>;
}

type ViewMode = "edit" | "preview" | "split";

/**
 * Modal editor for API documentation with GitHub sync.
 * Uses Monaco editor for editing and ReactMarkdown for preview.
 */
export function ApiDocsEditor({
  open,
  onClose,
  title,
  initialContent,
  onSave,
  generateCommitMessage,
}: ApiDocsEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [originalContent, setOriginalContent] = useState(initialContent);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasChanges = content !== originalContent;
  const isNew = !originalContent;

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setContent(initialContent);
      setOriginalContent(initialContent);
      setError(null);
      setShowCommitDialog(false);
    }
  }, [open, initialContent]);

  // Handle save button click - show commit dialog
  const handleSaveClick = useCallback(async () => {
    if (!hasChanges && !isNew) return;

    setShowCommitDialog(true);
    setGeneratingMessage(true);

    try {
      if (generateCommitMessage) {
        const message = await generateCommitMessage(originalContent, content);
        setCommitMessage(message);
      } else {
        setCommitMessage(
          isNew ? `Add API docs for ${title}` : `Update API docs for ${title}`
        );
      }
    } catch (err) {
      console.error("Failed to generate commit message:", err);
      setCommitMessage(
        isNew ? `Add API docs for ${title}` : `Update API docs for ${title}`
      );
    } finally {
      setGeneratingMessage(false);
    }
  }, [hasChanges, isNew, originalContent, content, title, generateCommitMessage]);

  // Handle commit
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
      setError("Commit message is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const success = await onSave(content, commitMessage);
      if (success) {
        setOriginalContent(content);
        setShowCommitDialog(false);
        onClose();
      } else {
        setError("Failed to save changes");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }, [commitMessage, content, onSave, onClose]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && open) {
        e.preventDefault();
        if (hasChanges || isNew) {
          handleSaveClick();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, hasChanges, isNew, handleSaveClick]);

  const renderMarkdown = () => (
    <ScrollArea className="h-full">
      <div className="prose prose-sm prose-invert max-w-none p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </ScrollArea>
  );

  const renderEditor = () => (
    <Editor
      height="100%"
      defaultLanguage="markdown"
      value={content}
      onChange={(value) => setContent(value || "")}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[80vh] p-0 gap-0 bg-zinc-950 border-zinc-800">
        <DialogHeader className="px-4 py-3 border-b border-zinc-800 flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-sm font-medium text-zinc-200">
            {title} - API Documentation
          </DialogTitle>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center rounded border border-zinc-800 overflow-hidden">
              <button
                onClick={() => setViewMode("edit")}
                className={cn(
                  "p-1.5 transition-colors",
                  viewMode === "edit"
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
                title="Edit"
              >
                <Code className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode("split")}
                className={cn(
                  "p-1.5 transition-colors border-x border-zinc-800",
                  viewMode === "split"
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
                title="Split"
              >
                <SplitSquareVertical className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode("preview")}
                className={cn(
                  "p-1.5 transition-colors",
                  viewMode === "preview"
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
                title="Preview"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Save button */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={handleSaveClick}
              disabled={(!hasChanges && !isNew) || saving}
            >
              <Save className="w-3 h-3 mr-1" />
              Save
            </Button>
          </div>
        </DialogHeader>

        {/* Editor area */}
        <div className="flex-1 overflow-hidden">
          {viewMode === "edit" && (
            <div className="h-full">{renderEditor()}</div>
          )}
          {viewMode === "preview" && (
            <div className="h-full bg-zinc-900">{renderMarkdown()}</div>
          )}
          {viewMode === "split" && (
            <div className="h-full flex">
              <div className="w-1/2 border-r border-zinc-800">
                {renderEditor()}
              </div>
              <div className="w-1/2 bg-zinc-900">{renderMarkdown()}</div>
            </div>
          )}
        </div>

        {/* Commit dialog */}
        {showCommitDialog && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 w-full max-w-md">
              <h3 className="text-sm font-medium text-zinc-200 mb-3">
                Commit Changes
              </h3>

              {error && (
                <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-400">
                  {error}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">
                    Commit Message
                  </label>
                  <div className="relative">
                    <Input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Describe your changes..."
                      className="text-[12px] bg-zinc-800 border-zinc-700 pr-8"
                      disabled={generatingMessage}
                    />
                    {generatingMessage && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setShowCommitDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={handleCommit}
                    disabled={saving || !commitMessage.trim()}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Commit"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
