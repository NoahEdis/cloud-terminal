"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  GitCommit,
  Sparkles,
  Bug,
  RefreshCw,
  FileText,
  Palette,
  TestTube,
  Wrench,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { CommitInfo, ChangelogResponse } from "../api/changelog/route";

// Commit type icons and colors
const commitTypeConfig: Record<string, { icon: typeof GitCommit; color: string; label: string }> = {
  feat: { icon: Sparkles, color: "text-emerald-400", label: "Feature" },
  fix: { icon: Bug, color: "text-amber-400", label: "Fix" },
  refactor: { icon: RefreshCw, color: "text-blue-400", label: "Refactor" },
  docs: { icon: FileText, color: "text-purple-400", label: "Docs" },
  style: { icon: Palette, color: "text-pink-400", label: "Style" },
  test: { icon: TestTube, color: "text-cyan-400", label: "Test" },
  chore: { icon: Wrench, color: "text-zinc-400", label: "Chore" },
  other: { icon: GitCommit, color: "text-zinc-500", label: "Other" },
};

function CommitCard({ commit }: { commit: CommitInfo }) {
  const [copied, setCopied] = useState(false);
  const config = commitTypeConfig[commit.type] || commitTypeConfig.other;
  const Icon = config.icon;

  const copyHash = () => {
    navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedDate = new Date(commit.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="group relative border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors bg-zinc-900/50">
      {/* Breaking change indicator */}
      {commit.breaking && (
        <div className="absolute -top-2 -right-2 bg-red-500/20 border border-red-500/50 rounded-full p-1">
          <AlertTriangle className="w-3 h-3 text-red-400" />
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className={`p-2 rounded-lg bg-zinc-800/50 ${config.color}`}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Message */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${config.color} bg-zinc-800`}>
              {config.label}
            </span>
            {commit.scope && (
              <span className="text-[10px] text-zinc-500 font-mono">
                ({commit.scope})
              </span>
            )}
          </div>

          <p className="text-sm text-zinc-200 mt-1.5 break-words">
            {commit.message.replace(/^(\w+)(?:\([^)]+\))?!?\s*:\s*/, "")}
          </p>

          {/* Body (if exists) */}
          {commit.body && (
            <p className="text-xs text-zinc-500 mt-2 whitespace-pre-wrap break-words border-l-2 border-zinc-800 pl-3">
              {commit.body.slice(0, 200)}
              {commit.body.length > 200 && "..."}
            </p>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-3 mt-3 text-[11px] text-zinc-500">
            {/* Hash */}
            <button
              onClick={copyHash}
              className="flex items-center gap-1 hover:text-zinc-300 transition-colors font-mono"
              title="Click to copy full hash"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              <span>{commit.shortHash}</span>
            </button>

            <span className="text-zinc-700">|</span>

            {/* Author */}
            <span>{commit.author}</span>

            <span className="text-zinc-700">|</span>

            {/* Date */}
            <span>{formattedDate}</span>

            {/* GitHub link (if available) */}
            <a
              href={`https://github.com/noahedis/cloud-terminal/commit/${commit.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity hover:text-zinc-300"
              title="View on GitHub"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChangelogPage() {
  const [changelog, setChangelog] = useState<ChangelogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    async function fetchChangelog() {
      try {
        const res = await fetch("/api/changelog?limit=100&path=cloud-terminal/web");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setChangelog(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch changelog");
      } finally {
        setLoading(false);
      }
    }
    fetchChangelog();
  }, []);

  const filteredCommits = changelog?.commits.filter(
    (c) => !filter || c.type === filter
  );

  // Group commits by date
  const groupedCommits = filteredCommits?.reduce((groups, commit) => {
    const date = new Date(commit.date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(commit);
    return groups;
  }, {} as Record<string, CommitInfo[]>);

  // Count by type
  const typeCounts = changelog?.commits.reduce((counts, c) => {
    counts[c.type] = (counts[c.type] || 0) + 1;
    return counts;
  }, {} as Record<string, number>) || {};

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </Link>
            <div className="h-4 w-px bg-zinc-800" />
            <h1 className="text-lg font-semibold">Changelog</h1>
          </div>
          {changelog && (
            <div className="text-sm text-zinc-500">
              v{changelog.version}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-400">{error}</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="mb-8 p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-zinc-300">
                  {changelog?.commits.length || 0} commits
                </h2>
                {filter && (
                  <button
                    onClick={() => setFilter(null)}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    Clear filter
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(typeCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const config = commitTypeConfig[type] || commitTypeConfig.other;
                    const Icon = config.icon;
                    const isActive = filter === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setFilter(isActive ? null : type)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                          isActive
                            ? "bg-zinc-700 text-white"
                            : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                        }`}
                      >
                        <Icon className={`w-3 h-3 ${config.color}`} />
                        <span>{config.label}</span>
                        <span className="text-zinc-600">({count})</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Commits grouped by date */}
            <div className="space-y-8">
              {groupedCommits &&
                Object.entries(groupedCommits).map(([date, commits]) => (
                  <div key={date}>
                    <h3 className="text-sm font-medium text-zinc-500 mb-3 sticky top-[72px] bg-zinc-950 py-2 z-10">
                      {date}
                    </h3>
                    <div className="space-y-3">
                      {commits.map((commit) => (
                        <CommitCard key={commit.hash} commit={commit} />
                      ))}
                    </div>
                  </div>
                ))}
            </div>

            {/* Empty state */}
            {(!filteredCommits || filteredCommits.length === 0) && (
              <div className="text-center py-20 text-zinc-500">
                <GitCommit className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No commits found</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-6 mt-12">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-zinc-600">
          <p>Commits are fetched from the git history of the cloud-terminal/web directory.</p>
          <p className="mt-1">
            <a
              href="https://github.com/noahedis/cloud-terminal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-white transition-colors"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
