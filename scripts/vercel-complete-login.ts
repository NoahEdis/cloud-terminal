/**
 * Complete Vercel login flow:
 * 1. Start vercel login command
 * 2. Extract OAuth URL
 * 3. Use Puppeteer to complete the flow
 * 4. Wait for CLI to receive the token
 */
import { spawn } from "child_process";
import {
  launchBrowser,
  newPage,
  click,
  waitForSelector,
  closeBrowser,
  listPages,
} from "../../servers/puppeteer/index.js";

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("Starting Vercel login flow...\n");

  // Start vercel login in background
  const vercelLogin = spawn("vercel", ["login"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let oauthUrl: string | null = null;

  // Capture output to get the OAuth URL
  vercelLogin.stdout.on("data", (data) => {
    const output = data.toString();
    console.log("[vercel]", output);

    // Extract OAuth URL
    const match = output.match(/https:\/\/vercel\.com\/oauth\/device\?user_code=[A-Z0-9-]+/);
    if (match) {
      oauthUrl = match[0];
      console.log(`\nCaptured OAuth URL: ${oauthUrl}\n`);
    }
  });

  vercelLogin.stderr.on("data", (data) => {
    console.error("[vercel error]", data.toString());
  });

  // Wait for OAuth URL
  console.log("Waiting for OAuth URL from vercel login...");
  for (let i = 0; i < 30 && !oauthUrl; i++) {
    await delay(500);
  }

  if (!oauthUrl) {
    console.error("Failed to capture OAuth URL");
    vercelLogin.kill();
    process.exit(1);
  }

  // Launch browser and complete OAuth flow
  console.log("\nLaunching browser to complete OAuth...");
  await launchBrowser({
    headless: false,
    disableDefaultViewport: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1200,800"],
  });

  const page = await newPage({ url: oauthUrl });
  console.log(`Opened: ${page.url}`);

  await delay(3000);

  // Check if we're on the OAuth confirm page or login page
  const pages = await listPages();
  const currentPage = pages.find((p) => p.pageId === page.pageId);
  const currentUrl = currentPage?.url || "";

  console.log(`Current URL: ${currentUrl}`);

  if (currentUrl.includes("/login")) {
    console.log("\n========================================");
    console.log("Not logged in to Vercel.");
    console.log("Please log in manually in the browser window.");
    console.log("========================================\n");

    // Wait for login
    for (let i = 0; i < 120; i++) {
      await delay(1000);
      const pages = await listPages();
      const currentPage = pages.find((p) => p.pageId === page.pageId);
      const newUrl = currentPage?.url || "";

      if (newUrl.includes("/oauth/device") && !newUrl.includes("/login")) {
        console.log("Login complete, now on OAuth page");
        break;
      }

      if (i % 10 === 0) {
        console.log(`Waiting for login... (${120 - i}s remaining)`);
      }
    }
  }

  // Click the confirm button
  console.log("Looking for confirm button...");
  try {
    await waitForSelector(page.pageId, 'button[type="submit"]', { timeout: 5000 });
    await click(page.pageId, 'button[type="submit"]');
    console.log("Clicked confirm button!");
  } catch {
    console.log("Could not find confirm button");
  }

  await delay(3000);

  // Wait for vercel login to complete
  console.log("\nWaiting for vercel login to complete...");

  const loginComplete = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 30000);

    vercelLogin.on("exit", (code) => {
      clearTimeout(timeout);
      console.log(`vercel login exited with code ${code}`);
      resolve(code === 0);
    });
  });

  await closeBrowser();

  if (loginComplete) {
    console.log("\n✓ Successfully logged into Vercel!");
  } else {
    console.log("\n✗ Login may not have completed");
  }
}

main().catch((e) => {
  console.error("Error:", e);
  closeBrowser().catch(() => {});
  process.exit(1);
});
