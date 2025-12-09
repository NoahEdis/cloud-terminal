/**
 * Settings API routes for managing user settings.
 *
 * Provides endpoints for:
 * - Getting and saving user settings (stored in Supabase)
 * - Settings persist across sessions, devices, and deployments
 */

import { Hono } from "hono";
import * as supabase from "../supabase.js";

export const settingsApi = new Hono();

/**
 * GET / - Get all settings
 */
settingsApi.get("/", async (c) => {
  try {
    const settings = await supabase.getSettings();
    return c.json(settings);
  } catch (err) {
    console.error("[Settings API] Failed to get settings:", err);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
});

/**
 * PUT / - Replace all settings
 */
settingsApi.put("/", async (c) => {
  try {
    const settings = await c.req.json<Record<string, unknown>>();
    await supabase.saveSettings(settings);
    return c.json({ success: true });
  } catch (err) {
    console.error("[Settings API] Failed to save settings:", err);
    return c.json({ error: "Failed to save settings" }, 500);
  }
});

/**
 * PATCH / - Update specific settings (merge)
 */
settingsApi.patch("/", async (c) => {
  try {
    const updates = await c.req.json<Record<string, unknown>>();
    await supabase.updateSettings(updates);
    return c.json({ success: true });
  } catch (err) {
    console.error("[Settings API] Failed to update settings:", err);
    return c.json({ error: "Failed to update settings" }, 500);
  }
});
