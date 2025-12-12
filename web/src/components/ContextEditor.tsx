"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Save,
  Loader2,
  FileText,
  Eye,
  Code,
  AlertTriangle,
  Check,
  X,
  RefreshCw,
  Pencil,
  GripVertical,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  getContextFile,
  saveContextFile,
  generateCommitMessage,
  getContextFileTemplate,
  getGitHubPat,
} from "@/lib/api";

interface ContextEditorProps {
  folderName: string;
}

type ViewMode = "edit" | "preview" | "split";

export default function ContextEditor({ folderName }: ContextEditorProps) {
  const router = useRouter();

  // Editor state
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [sha, setSha] = useState<string | undefined>();
  const [isNew, setIsNew] = useState(false);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  // Commit dialog state
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  // Resizable panel state
  const [splitPosition, setSplitPosition] = useState(50); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if content has changed
  const hasChanges = content !== originalContent;

  // Load content on mount
  useEffect(() => {
    async function loadContent() {
      const pat = getGitHubPat();
      if (!pat) {
        setError("GitHub token not configured. Please configure it in Settings.");
        setLoading(false);
        return;
      }

      try {
        const data = await getContextFile(folderName);
        if (data.exists) {
          setContent(data.content);
          setOriginalContent(data.content);
          setSha(data.sha);
          setIsNew(false);
        } else {
          // Create new file with template
          const template = getContextFileTemplate(folderName);
          setContent(template);
          setOriginalContent("");
          setIsNew(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load context file");
      } finally {
        setLoading(false);
      }
    }

    loadContent();
  }, [folderName]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!hasChanges && !isNew) return;

    setShowCommitDialog(true);
    setGeneratingMessage(true);

    try {
      const message = await generateCommitMessage(originalContent, content);
      setCommitMessage(message);
    } catch (err) {
      console.error("Failed to generate commit message:", err);
      // Set a default message on error
      setCommitMessage(isNew ? `Add context file for ${folderName}` : `Update context file for ${folderName}`);
    } finally {
      setGeneratingMessage(false);
    }
  }, [hasChanges, isNew, originalContent, content, folderName]);

  // Handle commit
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
      setError("Commit message is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await saveContextFile(
        folderName,
        content,
        commitMessage,
        isNew ? undefined : sha
      );

      if (result.success) {
        setOriginalContent(content);
        setSha(result.fileSha);
        setIsNew(false);
        setShowCommitDialog(false);
        setSuccessMessage("Changes saved successfully!");
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        if (result.error?.includes("Conflict")) {
          setError("File was modified by another user. Please reload and try again.");
        } else {
          setError(result.error || "Failed to save changes");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }, [commitMessage, folderName, content, isNew, sha]);

  // Handle reload
  const handleReload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getContextFile(folderName);
      if (data.exists) {
        setContent(data.content);
        setOriginalContent(data.content);
        setSha(data.sha);
        setIsNew(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload");
    } finally {
      setLoading(false);
    }
  }, [folderName]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges || isNew) {
          handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, hasChanges, isNew]);

  // Handle divider drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100;

      // Clamp between 20% and 80%
      setSplitPosition(Math.min(80, Math.max(20, newPosition)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // Loading state
  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-black text-zinc-100">
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <FileText className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-100">{folderName}</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[12px] text-zinc-500">CONTEXT.md</span>
          {isNew && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
              NEW
            </span>
          )}
          {hasChanges && !isNew && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
              MODIFIED
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center h-7 rounded-md border border-zinc-800 overflow-hidden">
            <button
              onClick={() => setViewMode("edit")}
              className={`flex items-center gap-1.5 px-2.5 h-full text-[11px] transition-colors ${
                viewMode === "edit"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              title="Edit only"
            >
              <Code className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`flex items-center gap-1.5 px-2.5 h-full text-[11px] border-x border-zinc-800 transition-colors ${
                viewMode === "split"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              title="Split view"
            >
              <Pencil className="w-3 h-3" />
              <Eye className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("preview")}
              className={`flex items-center gap-1.5 px-2.5 h-full text-[11px] transition-colors ${
                viewMode === "preview"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              title="Preview only"
            >
              <Eye className="w-3 h-3" />
            </button>
          </div>

          {/* Reload button */}
          <button
            onClick={handleReload}
            disabled={loading}
            className="p-1.5 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Reload from GitHub"
          >
            <RefreshCw className={`w-4 h-4 text-zinc-400 ${loading ? "animate-spin" : ""}`} />
          </button>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={(!hasChanges && !isNew) || saving}
            className={`flex items-center gap-1.5 h-8 px-3 text-[12px] rounded transition-colors ${
              hasChanges || isNew
                ? "bg-blue-600 hover:bg-blue-500 text-white"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </button>
        </div>
      </header>

      {/* Error/Success messages */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="text-[12px] text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto p-1 rounded hover:bg-red-500/20"
          >
            <X className="w-3 h-3 text-red-400" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="px-4 py-2 bg-green-500/10 border-b border-green-500/30 flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          <span className="text-[12px] text-green-400">{successMessage}</span>
        </div>
      )}

      {/* Editor content */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* Editor pane */}
        {(viewMode === "edit" || viewMode === "split") && (
          <div
            className="flex flex-col min-w-0 bg-zinc-950"
            style={{ width: viewMode === "split" ? `${splitPosition}%` : "100%" }}
          >
            {/* Editor header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/30">
              <Code className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Editor</span>
            </div>
            {/* Editor wrapper with horizontal padding */}
            <div className="flex-1 overflow-hidden">
              <Editor
                height="100%"
                defaultLanguage="markdown"
                value={content}
                onChange={(value) => setContent(value || "")}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineHeight: 1.7,
                  padding: { top: 20, bottom: 20 },
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  fontFamily: "var(--font-geist-mono), monospace",
                  renderLineHighlight: "none",
                  lineNumbers: "off",
                  folding: false,
                  glyphMargin: false,
                  lineDecorationsWidth: 24,
                  lineNumbersMinChars: 0,
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "hidden",
                    verticalScrollbarSize: 8,
                  },
                }}
              />
            </div>
          </div>
        )}

        {/* Resizable divider */}
        {viewMode === "split" && (
          <div
            className={`relative flex-shrink-0 w-1 group cursor-col-resize ${
              isDragging ? "bg-blue-500/50" : "bg-zinc-800 hover:bg-zinc-700"
            } transition-colors`}
            onMouseDown={handleMouseDown}
          >
            {/* Drag handle indicator */}
            <div className={`absolute inset-y-0 -left-1 -right-1 flex items-center justify-center ${
              isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            } transition-opacity`}>
              <div className="flex items-center justify-center w-4 h-8 rounded bg-zinc-700/80">
                <GripVertical className="w-3 h-3 text-zinc-400" />
              </div>
            </div>
          </div>
        )}

        {/* Preview pane */}
        {(viewMode === "preview" || viewMode === "split") && (
          <div
            className="flex flex-col min-w-0 bg-black"
            style={{ width: viewMode === "split" ? `${100 - splitPosition}%` : "100%" }}
          >
            {/* Preview header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/30">
              <Eye className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Preview</span>
            </div>
            {/* Preview content */}
            <ScrollArea className="flex-1">
              <div className="px-8 py-6 prose prose-invert prose-zinc max-w-none prose-headings:font-medium prose-h1:text-xl prose-h1:border-b prose-h1:border-zinc-800 prose-h1:pb-3 prose-h2:text-lg prose-h2:mt-8 prose-h3:text-base prose-p:text-zinc-300 prose-p:leading-relaxed prose-code:text-zinc-300 prose-code:bg-zinc-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-a:text-blue-400 prose-strong:text-zinc-200 prose-li:text-zinc-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Commit dialog */}
      {showCommitDialog && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-[14px] font-medium text-zinc-100 mb-4">
              Commit Changes
            </h3>

            {generatingMessage ? (
              <div className="flex items-center gap-2 text-zinc-400 mb-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[12px]">Generating commit message...</span>
              </div>
            ) : (
              <div className="mb-4">
                <label className="text-[11px] text-zinc-500 mb-1.5 block">
                  Commit message
                </label>
                <Input
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Describe your changes..."
                  className="h-9 text-[12px] bg-zinc-800 border-zinc-700 text-zinc-200"
                  autoFocus
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCommitDialog(false)}
                disabled={saving}
                className="h-8 px-3 text-[12px] rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={saving || generatingMessage || !commitMessage.trim()}
                className="h-8 px-4 text-[12px] rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Committing...
                  </>
                ) : (
                  "Commit"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
