import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { join } from "path";

const execAsync = promisify(exec);

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  body: string;
  type: string;
  scope: string | null;
  breaking: boolean;
}

export interface ChangelogResponse {
  version: string;
  commits: CommitInfo[];
  error?: string;
}

// Parse conventional commit message
function parseCommitMessage(message: string): { type: string; scope: string | null; breaking: boolean; description: string } {
  // Match: type(scope)!: description or type!: description or type: description
  const conventionalMatch = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.*)$/);

  if (conventionalMatch) {
    const [, type, scope, breaking, description] = conventionalMatch;
    return {
      type: type.toLowerCase(),
      scope: scope || null,
      breaking: !!breaking,
      description,
    };
  }

  // Fallback for non-conventional commits
  return {
    type: "other",
    scope: null,
    breaking: false,
    description: message,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const since = searchParams.get("since"); // ISO date string
    const path = searchParams.get("path"); // Filter by path (e.g., "cloud-terminal/web")

    // Get version from package.json
    let version = "unknown";
    try {
      const packageJsonPath = join(process.cwd(), "package.json");
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
      version = packageJson.version || "unknown";
    } catch {
      // Ignore errors reading package.json
    }

    // Build git log command
    // Format: hash|shortHash|author|email|date|subject|body
    const format = "%H|%h|%an|%ae|%aI|%s|%b";
    let gitCommand = `git log --format="${format}" -n ${limit}`;

    if (since) {
      gitCommand += ` --since="${since}"`;
    }

    if (path) {
      gitCommand += ` -- "${path}"`;
    }

    // Execute git log
    const { stdout, stderr } = await execAsync(gitCommand, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024, // 1MB buffer
    });

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    // Parse git log output
    const commits: CommitInfo[] = [];
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split("|");
      if (parts.length < 6) continue;

      const [hash, shortHash, author, authorEmail, date, message, ...bodyParts] = parts;
      const body = bodyParts.join("|").trim();
      const parsed = parseCommitMessage(message);

      commits.push({
        hash,
        shortHash,
        author,
        authorEmail,
        date,
        message,
        body,
        type: parsed.type,
        scope: parsed.scope,
        breaking: parsed.breaking,
      });
    }

    return NextResponse.json({
      version,
      commits,
    } as ChangelogResponse);
  } catch (error) {
    console.error("Changelog API error:", error);
    return NextResponse.json(
      {
        version: "unknown",
        commits: [],
        error: error instanceof Error ? error.message : "Failed to fetch changelog",
      } as ChangelogResponse,
      { status: 500 }
    );
  }
}
