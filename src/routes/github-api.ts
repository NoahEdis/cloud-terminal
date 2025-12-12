/**
 * GitHub API routes for managing project context files.
 *
 * Provides endpoints for:
 * - Reading/writing files to GitHub
 * - Testing GitHub connection
 * - Generating commit messages via AI
 */

import { Hono } from "hono";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAccountCredential } from "../lib/opSecrets.js";

export const githubApi = new Hono();

// GitHub configuration
const GITHUB_OWNER = "noahedis";
const GITHUB_REPO = "new-mcp-structure";
const GITHUB_BRANCH = "main";
const GITHUB_API_BASE = "https://api.github.com";

// Helper to get GitHub token from request header
function getGitHubToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header("X-GitHub-Token") || null;
}

// Helper to validate file path (security: only allow project context files)
function isValidContextPath(path: string): boolean {
  // Must match pattern: cloud-terminal/projects/<folder-name>/CONTEXT.md
  const pattern = /^cloud-terminal\/projects\/[a-zA-Z0-9_-]+\/CONTEXT\.md$/;
  return pattern.test(path);
}

// ============================================================================
// GitHub File Operations
// ============================================================================

/**
 * GET /file - Fetch file content from GitHub
 * Query: ?path=cloud-terminal/projects/my-project/CONTEXT.md
 * Header: X-GitHub-Token (required)
 */
githubApi.get("/file", async (c) => {
  const path = c.req.query("path");
  const token = getGitHubToken(c);

  if (!token) {
    return c.json({ error: "GitHub token required. Set X-GitHub-Token header." }, 401);
  }

  if (!path) {
    return c.json({ error: "path query parameter required" }, 400);
  }

  if (!isValidContextPath(path)) {
    return c.json({ error: "Invalid path. Must be cloud-terminal/projects/<folder>/CONTEXT.md" }, 400);
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}?ref=${GITHUB_BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "cloud-terminal",
        },
      }
    );

    if (response.status === 404) {
      return c.json({ error: "File not found", exists: false }, 404);
    }

    if (!response.ok) {
      const error = await response.text();
      console.error(`[GitHub API] Failed to fetch file: ${response.status}`, error);
      // Use 502 Bad Gateway for upstream GitHub errors
      return c.json({ error: `GitHub API error: ${response.status}` }, 502);
    }

    const data = await response.json();

    // Decode base64 content
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return c.json({
      content,
      sha: data.sha,
      lastModified: data.sha, // GitHub doesn't provide last modified easily, use sha
      exists: true,
    });
  } catch (err) {
    console.error("[GitHub API] Failed to fetch file:", err);
    return c.json({ error: "Failed to fetch file from GitHub" }, 500);
  }
});

/**
 * POST /commit - Create or update a file in GitHub
 * Body: { path, content, message, sha? }
 * Header: X-GitHub-Token (required)
 */
githubApi.post("/commit", async (c) => {
  const token = getGitHubToken(c);

  if (!token) {
    return c.json({ error: "GitHub token required. Set X-GitHub-Token header." }, 401);
  }

  try {
    const body = await c.req.json<{
      path: string;
      content: string;
      message: string;
      sha?: string;
    }>();

    if (!body.path || !body.content || !body.message) {
      return c.json({ error: "path, content, and message are required" }, 400);
    }

    if (!isValidContextPath(body.path)) {
      return c.json({ error: "Invalid path. Must be cloud-terminal/projects/<folder>/CONTEXT.md" }, 400);
    }

    // Encode content to base64
    const contentBase64 = Buffer.from(body.content, "utf-8").toString("base64");

    const requestBody: {
      message: string;
      content: string;
      branch: string;
      sha?: string;
    } = {
      message: body.message,
      content: contentBase64,
      branch: GITHUB_BRANCH,
    };

    // Include sha if updating existing file
    if (body.sha) {
      requestBody.sha = body.sha;
    }

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(body.path)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "cloud-terminal",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (response.status === 409) {
      return c.json({
        error: "Conflict: file was modified. Please reload and try again.",
        code: "CONFLICT"
      }, 409);
    }

    if (!response.ok) {
      const error = await response.text();
      console.error(`[GitHub API] Failed to commit: ${response.status}`, error);
      // Use 502 Bad Gateway for upstream GitHub errors
      return c.json({ error: `GitHub API error: ${response.status}` }, 502);
    }

    const data = await response.json();

    return c.json({
      success: true,
      commitSha: data.commit.sha,
      fileSha: data.content.sha,
    });
  } catch (err) {
    console.error("[GitHub API] Failed to commit:", err);
    return c.json({ error: "Failed to commit to GitHub" }, 500);
  }
});

/**
 * GET /status - Check if GitHub connection is working
 * Header: X-GitHub-Token (required)
 */
githubApi.get("/status", async (c) => {
  const token = getGitHubToken(c);

  if (!token) {
    return c.json({
      connected: false,
      error: "No token provided"
    });
  }

  try {
    // Test by fetching user info
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "cloud-terminal",
      },
    });

    if (!response.ok) {
      return c.json({
        connected: false,
        error: response.status === 401 ? "Invalid token" : `API error: ${response.status}`
      });
    }

    const user = await response.json();

    // Also check repo access
    const repoResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "cloud-terminal",
        },
      }
    );

    const hasRepoAccess = repoResponse.ok;

    return c.json({
      connected: true,
      user: user.login,
      hasRepoAccess,
      repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    });
  } catch (err) {
    console.error("[GitHub API] Status check failed:", err);
    return c.json({
      connected: false,
      error: "Connection failed"
    });
  }
});

// ============================================================================
// AI Commit Message Generation
// ============================================================================

/**
 * POST /generate-commit-message - Generate a commit message using AI
 * Body: { oldContent, newContent, model? }
 */
githubApi.post("/generate-commit-message", async (c) => {
  try {
    const body = await c.req.json<{
      oldContent: string;
      newContent: string;
      model?: string;
    }>();

    if (body.newContent === undefined) {
      return c.json({ error: "newContent is required" }, 400);
    }

    const model = body.model || "gemini-2.0-flash-exp";
    const oldContent = body.oldContent || "";
    const newContent = body.newContent;

    // Determine if this is a create or update
    const isCreate = !oldContent.trim();

    // Build the prompt
    const prompt = isCreate
      ? `Generate a concise git commit message for creating a new project context file.

The file content is:
\`\`\`markdown
${newContent}
\`\`\`

Requirements:
- One line, max 72 characters
- Start with a verb (Add, Create, Initialize)
- Be specific about what the context file documents
- Do not include quotes or markdown formatting in your response
- Just return the commit message text directly`
      : `Generate a concise git commit message for updating a project context file.

Previous content:
\`\`\`markdown
${oldContent}
\`\`\`

New content:
\`\`\`markdown
${newContent}
\`\`\`

Requirements:
- One line, max 72 characters
- Start with a verb (Update, Add, Remove, Fix, Clarify)
- Describe what changed, not the whole file
- Do not include quotes or markdown formatting in your response
- Just return the commit message text directly`;

    let message: string;

    if (model.startsWith("gemini")) {
      // Use Gemini
      const apiKey = await getAccountCredential("automation-engineer", "GOOGLE_AI_API_KEY");
      if (!apiKey) {
        return c.json({ error: "Gemini API key not configured" }, 500);
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({ model });

      const result = await geminiModel.generateContent(prompt);
      message = result.response.text().trim();
    } else if (model.startsWith("gpt")) {
      // Use OpenAI
      const apiKey = await getAccountCredential("automation-engineer", "OPENAI_API_KEY");
      if (!apiKey) {
        return c.json({ error: "OpenAI API key not configured" }, 500);
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 100,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[GitHub API] OpenAI error:", error);
        return c.json({ error: "Failed to generate commit message" }, 500);
      }

      const data = await response.json();
      message = data.choices[0]?.message?.content?.trim() || "Update context file";
    } else {
      return c.json({ error: `Unsupported model: ${model}` }, 400);
    }

    // Clean up the message (remove quotes if present)
    message = message.replace(/^["']|["']$/g, "").trim();

    // Truncate if too long
    if (message.length > 72) {
      message = message.substring(0, 69) + "...";
    }

    return c.json({ message });
  } catch (err) {
    console.error("[GitHub API] Failed to generate commit message:", err);
    return c.json({ error: "Failed to generate commit message" }, 500);
  }
});

/**
 * GET /models - List available AI models for commit message generation
 */
githubApi.get("/models", (c) => {
  return c.json({
    models: [
      { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", provider: "google", default: true },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
    ],
  });
});
