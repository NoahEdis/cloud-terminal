"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { HealthStatus } from "@/lib/credential-types";

interface HealthStatusBadgeProps {
  status: HealthStatus;
  checkedAt?: string | null;
  className?: string;
}

const statusConfig: Record<HealthStatus, { color: string; label: string }> = {
  healthy: { color: "bg-green-500", label: "Healthy" },
  warning: { color: "bg-yellow-500", label: "Warning" },
  error: { color: "bg-red-500", label: "Error" },
  unknown: { color: "bg-zinc-500", label: "Unknown" },
};

/**
 * A small colored dot indicating credential health status.
 * Shows tooltip with status details and last check time.
 */
export function HealthStatusBadge({
  status,
  checkedAt,
  className,
}: HealthStatusBadgeProps) {
  const config = statusConfig[status];

  const formatDate = (iso: string) => {
    try {
      const date = new Date(iso);
      return date.toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full flex-shrink-0",
            config.color,
            className
          )}
          aria-label={`Health status: ${config.label}`}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px]">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{config.label}</span>
          {checkedAt && (
            <span className="text-zinc-400">
              Last checked: {formatDate(checkedAt)}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
