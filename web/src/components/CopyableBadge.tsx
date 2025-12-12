"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CopyableBadgeProps {
  value: string;
  label?: string;
  truncate?: number;
  className?: string;
}

/**
 * A badge that displays a truncated value with click-to-copy functionality.
 * Shows a tooltip with the full value and copy confirmation.
 */
export function CopyableBadge({
  value,
  label,
  truncate = 8,
  className,
}: CopyableBadgeProps) {
  const [copied, setCopied] = useState(false);

  const displayValue = truncate > 0 && value.length > truncate
    ? value.slice(0, truncate)
    : value;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "cursor-pointer text-[9px] px-1.5 py-0 h-4 gap-1",
            "bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600",
            "font-mono transition-colors",
            className
          )}
          onClick={handleCopy}
        >
          {label && <span className="text-zinc-600">{label}</span>}
          <span>{displayValue}</span>
          {copied ? (
            <Check className="w-2.5 h-2.5 text-green-500" />
          ) : (
            <Copy className="w-2.5 h-2.5 opacity-50" />
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-[10px]">
        {copied ? "Copied!" : `Click to copy: ${value}`}
      </TooltipContent>
    </Tooltip>
  );
}
