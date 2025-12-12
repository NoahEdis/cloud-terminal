"use client";

import { ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface OnePasswordLinkProps {
  accountId: string;
  vaultId: string;
  itemId: string;
  host: string;
  className?: string;
}

/**
 * Generates a 1Password deep link URL.
 * Format: https://start.1password.com/open/i?a={accountId}&v={vaultId}&i={itemId}&h={host}
 */
export function generate1PasswordUrl(
  accountId: string,
  vaultId: string,
  itemId: string,
  host: string
): string {
  const params = new URLSearchParams({
    a: accountId,
    v: vaultId,
    i: itemId,
    h: host,
  });
  return `https://start.1password.com/open/i?${params.toString()}`;
}

/**
 * A button that opens a credential directly in 1Password.
 */
export function OnePasswordLink({
  accountId,
  vaultId,
  itemId,
  host,
  className,
}: OnePasswordLinkProps) {
  const url = generate1PasswordUrl(accountId, vaultId, itemId, host);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center justify-center",
            "p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50",
            "transition-colors",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-3.5 h-3.5"
            aria-label="Open in 1Password"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
          </svg>
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px]">
        Open in 1Password
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Known 1Password account configurations.
 * Maps organization names to their 1Password account details.
 */
export const OP_ACCOUNTS: Record<string, { accountId: string; host: string }> = {
  personal: {
    accountId: "RAQBB3ZYMNAKFB6ROXXL32PVPA",
    host: "my.1password.com",
  },
  "automation-engineer": {
    accountId: "SQIJLQL4H5DOPJ22UVRBWLLPFA",
    host: "automationengineer.1password.com",
  },
};
