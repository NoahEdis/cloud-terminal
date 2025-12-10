"use client";

import { useState, useCallback } from "react";
import {
  Maximize2,
  Minimize2,
  ExternalLink,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ============================================================================
// Types
// ============================================================================

export interface FigmaEmbedProps {
  /** Figma file key (from URL) */
  fileKey: string;
  /** Optional node ID to focus on a specific page/frame */
  nodeId?: string;
  /** Title to display above the embed */
  title?: string;
  /** Description text */
  description?: string;
  /** Height of the embed (default: 600px) */
  height?: number | string;
  /** Whether to show the toolbar */
  showToolbar?: boolean;
  /** Whether to allow fullscreen */
  allowFullscreen?: boolean;
  /** Hide Figma UI elements */
  hideUi?: boolean;
  /** Application name for Figma analytics */
  embedHost?: string;
  /** Show in prototype mode instead of design mode */
  prototypeMode?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Callback when embed loads */
  onLoad?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

// ============================================================================
// Embed URL Generator
// ============================================================================

function generateFigmaEmbedUrl(
  fileKey: string,
  options: {
    nodeId?: string;
    hideUi?: boolean;
    embedHost?: string;
    prototypeMode?: boolean;
  } = {}
): string {
  const baseUrl = options.prototypeMode
    ? `https://embed.figma.com/proto/${fileKey}`
    : `https://embed.figma.com/design/${fileKey}`;

  const params = new URLSearchParams();

  if (options.nodeId) {
    params.set("node-id", options.nodeId);
  }
  if (options.hideUi) {
    params.set("hide-ui", "1");
  }
  if (options.embedHost) {
    params.set("embed-host", options.embedHost);
  }
  // Always allow fullscreen in the embed itself
  params.set("allow-fullscreen", "1");

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

// ============================================================================
// Component
// ============================================================================

export function FigmaEmbed({
  fileKey,
  nodeId,
  title,
  description,
  height = 600,
  showToolbar = true,
  allowFullscreen = true,
  hideUi = false,
  embedHost = "cloud-terminal",
  prototypeMode = false,
  className,
  onLoad,
  onError,
}: FigmaEmbedProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const embedUrl = generateFigmaEmbedUrl(fileKey, {
    nodeId,
    hideUi,
    embedHost,
    prototypeMode,
  });

  const figmaUrl = nodeId
    ? `https://www.figma.com/design/${fileKey}?node-id=${nodeId}`
    : `https://www.figma.com/design/${fileKey}`;

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setIsLoading(false);
    onError?.(new Error("Failed to load Figma embed"));
  }, [onError]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((f) => !f);
  }, []);

  const containerHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card overflow-hidden",
        isFullscreen && "fixed inset-4 z-50 h-auto",
        className
      )}
    >
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h3 className="text-sm font-medium leading-none">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {!title && !description && (
              <span className="text-xs text-muted-foreground">
                Figma Diagram
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleRefresh}
              title="Refresh"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              asChild
              title="Open in Figma"
            >
              <a href={figmaUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>

            {allowFullscreen && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Embed Container */}
      <div
        className="relative flex-1 bg-muted/20"
        style={{ height: isFullscreen ? undefined : containerHeight }}
      >
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading Figma...
              </span>
            </div>
          </div>
        )}

        {/* Figma iframe */}
        <iframe
          key={refreshKey}
          src={embedUrl}
          className="w-full h-full border-0"
          allowFullScreen={allowFullscreen}
          onLoad={handleLoad}
          onError={handleError}
          title={title || "Figma Embed"}
          loading="lazy"
        />
      </div>

      {/* Fullscreen backdrop */}
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm -z-10"
          onClick={toggleFullscreen}
        />
      )}
    </div>
  );
}

// ============================================================================
// Diagram List Component
// ============================================================================

export interface FigmaDiagram {
  id: string;
  fileKey: string;
  pageId: string;
  pageName: string;
  title: string;
  description?: string;
  diagramType: "workflow" | "architecture" | "process" | "entity" | "custom";
  category?: string;
  tags?: string[];
  thumbnailUrl?: string;
  createdAt: string;
}

export interface FigmaDiagramListProps {
  diagrams: FigmaDiagram[];
  selectedId?: string;
  onSelect?: (diagram: FigmaDiagram) => void;
  className?: string;
}

export function FigmaDiagramList({
  diagrams,
  selectedId,
  onSelect,
  className,
}: FigmaDiagramListProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {diagrams.map((diagram) => (
        <button
          key={diagram.id}
          onClick={() => onSelect?.(diagram)}
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border text-left transition-colors",
            "hover:bg-muted/50",
            selectedId === diagram.id && "bg-muted border-primary"
          )}
        >
          {/* Thumbnail */}
          {diagram.thumbnailUrl ? (
            <img
              src={diagram.thumbnailUrl}
              alt={diagram.title}
              className="w-16 h-12 object-cover rounded border bg-muted"
            />
          ) : (
            <div className="w-16 h-12 rounded border bg-muted flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No preview</span>
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium truncate">{diagram.title}</h4>
            {diagram.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {diagram.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground capitalize">
                {diagram.diagramType}
              </span>
              {diagram.category && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">
                    {diagram.category}
                  </span>
                </>
              )}
            </div>
          </div>
        </button>
      ))}

      {diagrams.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No diagrams found</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Combined Viewer Component
// ============================================================================

export interface FigmaDiagramViewerProps {
  diagrams: FigmaDiagram[];
  defaultDiagramId?: string;
  embedHost?: string;
  className?: string;
}

export function FigmaDiagramViewer({
  diagrams,
  defaultDiagramId,
  embedHost = "cloud-terminal",
  className,
}: FigmaDiagramViewerProps) {
  const [selectedDiagram, setSelectedDiagram] = useState<FigmaDiagram | null>(
    () => {
      if (defaultDiagramId) {
        return diagrams.find((d) => d.id === defaultDiagramId) || diagrams[0] || null;
      }
      return diagrams[0] || null;
    }
  );

  return (
    <div className={cn("flex gap-4 h-full", className)}>
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 border-r pr-4 overflow-y-auto">
        <h3 className="text-sm font-medium mb-3">Diagrams</h3>
        <FigmaDiagramList
          diagrams={diagrams}
          selectedId={selectedDiagram?.id}
          onSelect={setSelectedDiagram}
        />
      </div>

      {/* Main View */}
      <div className="flex-1 min-w-0">
        {selectedDiagram ? (
          <FigmaEmbed
            fileKey={selectedDiagram.fileKey}
            nodeId={selectedDiagram.pageId}
            title={selectedDiagram.title}
            description={selectedDiagram.description}
            embedHost={embedHost}
            height="100%"
            className="h-full"
          />
        ) : (
          <div className="h-full flex items-center justify-center border rounded-lg bg-muted/20">
            <p className="text-muted-foreground">Select a diagram to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
