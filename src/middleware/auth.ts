import { Context, Next } from "hono";

const API_KEY = process.env.API_KEY;

export async function authMiddleware(c: Context, next: Next) {
  // Skip auth if no API_KEY is configured (local development)
  if (!API_KEY) {
    return next();
  }

  // Check Authorization header
  const authHeader = c.req.header("Authorization");
  if (authHeader) {
    const [type, token] = authHeader.split(" ");
    if (type === "Bearer" && token === API_KEY) {
      return next();
    }
  }

  // Check X-API-Key header (alternative)
  const apiKeyHeader = c.req.header("X-API-Key");
  if (apiKeyHeader === API_KEY) {
    return next();
  }

  // Check query parameter (for WebSocket connections)
  const apiKeyQuery = c.req.query("api_key");
  if (apiKeyQuery === API_KEY) {
    return next();
  }

  return c.json({ error: "Unauthorized" }, 401);
}
