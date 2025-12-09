/**
 * Seed brain nodes with knowledge from the codebase documentation.
 * Creates brain nodes for principles, patterns, workflows, and references.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { createBrainNode, getBrainNodes, deleteBrainNode, BrainNodeInput } = await import('../src/supabase.js');

  console.log('Seeding brain nodes...\n');

  // Define brain nodes to create
  const brainNodes: Array<import('../src/supabase.js').BrainNodeInput> = [
    // === Architecture Principles ===
    {
      node_type: 'principle',
      title: 'Use Neo4j schema for property graph storage',
      content: `All entity data should be stored in the neo4j schema using graph_nodes and graph_relationships tables.

Structure:
- graph_nodes: id UUID, labels TEXT[], properties JSONB, external_id TEXT
- graph_relationships: id UUID, type TEXT, source_node_id, target_node_id, properties JSONB

To access the neo4j schema via PostgREST, use these headers:
- "Accept-Profile": "neo4j"
- "Content-Profile": "neo4j"

Entity types include: Person, Company, Email, Event, Task, File, Workflow, Application, BrainNode, etc.`,
      summary: 'Store entities in neo4j.graph_nodes with labels array and JSONB properties',
      source_type: 'manual',
      category: 'architecture',
      tags: ['neo4j', 'supabase', 'graph', 'database', 'schema'],
      priority: 90,
    },
    {
      node_type: 'principle',
      title: 'Three-tier credential fallback',
      content: `Credentials should follow a 3-tier fallback pattern:
1. Environment variable (highest priority)
2. 1Password Connect API
3. Config file (fallback)

This allows flexible deployment:
- Local development: env vars or config files
- Production: 1Password Connect for secure secret management

Example:
\`\`\`typescript
const apiKey = process.env.API_KEY
  || await getAccountCredential('account-name', 'API_KEY')
  || config.apiKey;
\`\`\``,
      summary: 'Credentials: env var -> 1Password -> config file',
      source_type: 'manual',
      category: 'security',
      tags: ['credentials', '1password', 'secrets', 'security'],
      priority: 85,
    },
    {
      node_type: 'principle',
      title: 'Prefer functional patterns over classes',
      content: `Export pure functions from service modules instead of class instances.

Good:
\`\`\`typescript
export async function getUser(id: string): Promise<User> {
  return client.get(\`/users/\${id}\`);
}
\`\`\`

Avoid:
\`\`\`typescript
class UserService {
  async getUser(id: string) { ... }
}
export const userService = new UserService();
\`\`\`

Exceptions: Classes are acceptable when wrapping external APIs that have stateful clients.`,
      summary: 'Export pure functions, avoid class instances unless wrapping stateful APIs',
      source_type: 'manual',
      category: 'code-style',
      tags: ['functional', 'typescript', 'patterns', 'best-practices'],
      priority: 80,
    },

    // === Patterns ===
    {
      node_type: 'pattern',
      title: 'HTTP Client pattern with httpClient utility',
      content: `Use the httpClient utility from servers/core/httpClient.ts for all HTTP operations.

\`\`\`typescript
import { httpClient, HttpError } from "../core/httpClient.js";

const client = httpClient("https://api.example.com", {
  Authorization: \`Bearer \${token}\`,
});

const data = await client.get<ResponseType>("/endpoint");
const created = await client.post<CreateResponse>("/items", { name: "test" });
\`\`\`

The httpClient automatically:
- Handles JSON serialization/deserialization
- Provides typed responses
- Includes proper error handling with HttpError`,
      summary: 'Use httpClient from servers/core/httpClient.ts for HTTP operations',
      source_type: 'github',
      source_url: 'servers/core/httpClient.ts',
      category: 'patterns',
      tags: ['http', 'api', 'client', 'typescript'],
      priority: 75,
    },
    {
      node_type: 'pattern',
      title: 'Token refresh with 5-minute safety buffer',
      content: `When caching OAuth tokens, use a 5-minute safety buffer before expiry to avoid race conditions.

\`\`\`typescript
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // 5-minute buffer (300,000ms) before expiry
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.token;
  }

  // Refresh the token
  const newToken = await refreshToken();
  cachedToken = {
    token: newToken.access_token,
    expiresAt: Date.now() + (newToken.expires_in * 1000),
  };
  return cachedToken.token;
}
\`\`\``,
      summary: 'Cache tokens with 5-minute buffer before expiry',
      source_type: 'manual',
      category: 'patterns',
      tags: ['oauth', 'token', 'refresh', 'caching'],
      priority: 70,
    },
    {
      node_type: 'pattern',
      title: '1Password account-based credential access',
      content: `Use the account-based API for accessing 1Password secrets.

\`\`\`typescript
import { getAccountCredential, getAccountCredentials } from "../core/opSecrets.js";

// Get a single credential for an account
const apiKey = await getAccountCredential("go-painting", "AIRTABLE_API_KEY");

// Get all credentials for an account
const creds = await getAccountCredentials("automation-engineer");
console.log(creds.OPENAI_API_KEY);
\`\`\`

Prerequisites:
1. 1Password Connect must be running
2. Set env vars: ONEPASSWORD_CONNECT_HOST, ONEPASSWORD_CONNECT_TOKEN
3. Source env: \`source config/credentials/_connect.env\``,
      summary: 'Use getAccountCredential/getAccountCredentials for 1Password access',
      source_type: 'github',
      source_url: 'servers/core/opSecrets.ts',
      category: 'patterns',
      tags: ['1password', 'secrets', 'credentials'],
      priority: 70,
    },

    // === Workflows ===
    {
      node_type: 'workflow',
      title: 'Adding a new service integration',
      content: `Steps to add a new service integration:

1. Create the service module:
   \`servers/<service>/index.ts\`

2. Import httpClient:
   \`\`\`typescript
   import { httpClient, HttpError } from "../core/httpClient.js";
   \`\`\`

3. Add credential mapping to \`config/op-credentials.json\`

4. Export typed functions for each API operation

5. Add environment variable documentation to README

Example structure:
\`\`\`typescript
// servers/example/index.ts
import { httpClient } from "../core/httpClient.js";

const getClient = async () => {
  const apiKey = process.env.EXAMPLE_API_KEY;
  return httpClient("https://api.example.com", {
    Authorization: \`Bearer \${apiKey}\`,
  });
};

export async function listItems(): Promise<Item[]> {
  const client = await getClient();
  return client.get("/items");
}
\`\`\``,
      summary: 'Create module, add credentials, export typed functions',
      source_type: 'manual',
      category: 'development',
      tags: ['integration', 'service', 'api', 'development'],
      priority: 65,
    },
    {
      node_type: 'workflow',
      title: 'Creating a sync script',
      content: `Steps to create a data sync script:

1. Create the script:
   \`scripts/sync<Source>To<Dest>.ts\`

2. Import source service client

3. Fetch data from source

4. Transform to graph model (graph_nodes / graph_relationships format)

5. Upsert to Supabase using neo4j schema

Example:
\`\`\`typescript
// scripts/syncNotionToGraph.ts
import { getPages } from "../servers/notion/index.js";
import { neo4jRequest } from "../servers/supabase/index.js";

async function sync() {
  const pages = await getPages();

  for (const page of pages) {
    await neo4jRequest("POST", "/graph_nodes", {
      body: {
        external_id: \`notion:\${page.id}\`,
        labels: ["Document", "NotionPage"],
        properties: {
          title: page.title,
          url: page.url,
          created_at: page.created_time,
        },
      },
    });
  }
}
\`\`\``,
      summary: 'Fetch from source, transform to graph model, upsert to graph_nodes',
      source_type: 'manual',
      category: 'development',
      tags: ['sync', 'script', 'graph', 'data'],
      priority: 60,
    },
    {
      node_type: 'workflow',
      title: 'Debugging credential issues',
      content: `Steps to debug credential/authentication issues:

1. Source 1Password Connect env:
   \`source config/credentials/_connect.env\`

2. Verify Connect is running:
   \`curl $ONEPASSWORD_CONNECT_HOST/health\`

3. List available accounts:
   \`npx tsx scripts/generateEnv.ts\`

4. Check account config exists:
   \`cat config/credentials/<account>.json\`

5. Test credential fetch:
   \`npx tsx scripts/generateEnv.ts <account>\`

6. For legacy API, check \`config/op-credentials.json\` mapping

7. Run credential validation:
   \`npm run test:api\`

Common issues:
- 1Password Connect not running
- Wrong account name in config
- Missing credential in 1Password vault
- Expired token (for OAuth services)`,
      summary: 'Source env, check Connect health, verify account config, test fetch',
      source_type: 'manual',
      category: 'development',
      tags: ['debugging', 'credentials', '1password', 'troubleshooting'],
      priority: 55,
    },

    // === References ===
    {
      node_type: 'reference',
      title: 'Available service integrations',
      content: `48+ service integrations available:

**Google**: google-drive, gmail, google-calendar, google-sheets, google-tasks, google-cloud, google-gemini

**Productivity**: notion, airtable, clickup, miro, figma, framer

**Automation**: make, n8n, beeper, puppeteer

**Database/Storage**: supabase, cloudinary, cloudflare

**Communication**: slack, gmail

**CRM/Business**: hubspot, companycam, proposify, stripe, fillout, instantly, anymailfinder

**AI/LLM**: openai, anthropic, deepseek, tavily, ollama

**Infrastructure**: 1password, render, multilogin, github

**IoT/Smart Home**: home-assistant, roborock, tapo, tuya, whoop, withings, inkbird, bambulab

**Utilities**: ffmpeg, apify, krisp`,
      summary: '48+ integrations: Google, productivity, automation, AI/LLM, IoT, etc.',
      source_type: 'manual',
      category: 'reference',
      tags: ['services', 'integrations', 'api', 'catalog'],
      priority: 50,
    },
    {
      node_type: 'reference',
      title: 'File location conventions',
      content: `Standard file locations in this codebase:

| Purpose | Location |
|---------|----------|
| Service integrations | \`servers/<service>/index.ts\` |
| Shared HTTP client | \`servers/core/httpClient.ts\` |
| 1Password integration | \`servers/core/opSecrets.ts\` |
| Credential configs (per account) | \`config/credentials/<account>.json\` |
| 1Password Connect env | \`config/credentials/_connect.env\` |
| Legacy credential mapping | \`config/op-credentials.json\` |
| Env generator script | \`scripts/generateEnv.ts\` |
| Sync scripts | \`scripts/sync*.ts\` |
| Setup scripts | \`scripts/setup*.ts\` |
| Test scripts | \`scripts/test*.ts\` |
| Edge Functions | \`supabase/functions/<name>/index.ts\` |
| DB migrations | \`supabase/migrations/\` |`,
      summary: 'Convention-based file locations for services, configs, scripts',
      source_type: 'manual',
      category: 'reference',
      tags: ['files', 'structure', 'conventions', 'organization'],
      priority: 45,
    },
  ];

  // Delete existing test nodes first
  console.log('Cleaning up existing brain nodes...');
  const existingNodes = await getBrainNodes();
  for (const node of existingNodes) {
    if (node.title === 'Test Brain Node') {
      console.log(`  Deleting test node: ${node.title}`);
      await deleteBrainNode(node.id);
    }
  }

  // Create new brain nodes
  console.log('\nCreating brain nodes...');
  let created = 0;
  let skipped = 0;

  for (const nodeInput of brainNodes) {
    // Check if node already exists (by title)
    const existing = existingNodes.find(n => n.title === nodeInput.title);
    if (existing) {
      console.log(`  Skipped (exists): ${nodeInput.title}`);
      skipped++;
      continue;
    }

    try {
      const node = await createBrainNode(nodeInput);
      if (node) {
        console.log(`  Created: ${node.title}`);
        created++;
      }
    } catch (err) {
      console.error(`  Failed: ${nodeInput.title}`, err);
    }
  }

  console.log(`\nDone! Created ${created} nodes, skipped ${skipped} existing.`);
}

main().catch(console.error);
