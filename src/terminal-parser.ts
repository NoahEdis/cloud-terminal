/**
 * Terminal output parser for Claude Code status extraction.
 * Parses Claude Code's status output to extract:
 * - Token counts (e.g., "94.0k tokens")
 * - Tool use counts (e.g., "34 tool uses")
 * - Elapsed time (e.g., "1m 28s")
 */

export interface ParsedStatus {
  tokenCount: number | null;
  toolCount: number | null;
  elapsed: string | null;
}

// Regex patterns for Claude Code output
const PATTERNS = {
  // Token count: "94.0k tokens" or "1.2k tokens" or "445 tokens"
  tokenCount: /(\d+(?:\.\d+)?)(k)?\s*tokens/i,

  // Tool count: "34 tool uses" or "(3 tool uses)"
  toolCount: /(\d+)\s*tool\s*uses?/i,

  // Elapsed time: "1m 28s" or "45s" or "2h 15m"
  elapsed: /(\d+h\s*)?(\d+m\s*)?(\d+s)/i,
};

/**
 * Parse token count from string like "94.0k" -> 94000
 */
function parseTokenString(value: string, hasK: boolean): number {
  const num = parseFloat(value);
  return hasK ? Math.round(num * 1000) : Math.round(num);
}

/**
 * Extract status information from terminal output chunk.
 * Called on each chunk of terminal output to update session metrics.
 */
export function parseTerminalOutput(output: string): ParsedStatus {
  const result: ParsedStatus = {
    tokenCount: null,
    toolCount: null,
    elapsed: null,
  };

  // Extract token count
  const tokenMatch = output.match(PATTERNS.tokenCount);
  if (tokenMatch) {
    result.tokenCount = parseTokenString(tokenMatch[1], !!tokenMatch[2]);
  }

  // Extract tool count
  const toolMatch = output.match(PATTERNS.toolCount);
  if (toolMatch) {
    result.toolCount = parseInt(toolMatch[1], 10);
  }

  // Extract elapsed time
  const elapsedMatch = output.match(PATTERNS.elapsed);
  if (elapsedMatch) {
    result.elapsed = elapsedMatch[0].trim();
  }

  return result;
}

/**
 * Update session token count from terminal output.
 * Only updates if parsed count is higher (tokens accumulate).
 */
export function updateTokenCount(
  currentCount: number,
  output: string
): number {
  const parsed = parseTerminalOutput(output);
  if (parsed.tokenCount !== null && parsed.tokenCount > currentCount) {
    return parsed.tokenCount;
  }
  return currentCount;
}
