/**
 * Log into Vercel using Puppeteer with a fresh browser.
 * Credentials from 1Password or will prompt for manual login.
 */
import {
  launchBrowser,
  newPage,
  navigate,
  click,
  waitForSelector,
  type,
  closeBrowser,
  screenshot,
  getText,
  getPageContent,
  waitForNavigation,
  evaluate,
  pressKey,
  listPages,
} from "../../servers/puppeteer/index.js";
import { getSecretValue } from "../../servers/core/opSecrets.js";

const VERCEL_AUTH_URL = process.argv[2] || "https://vercel.com/login";

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("Launching fresh Chrome browser...");

  // Launch a headed browser so user can see and potentially help
  await launchBrowser({
    headless: false,
    disableDefaultViewport: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1200,800"],
  });

  console.log("Creating new page...");
  const page = await newPage({ url: VERCEL_AUTH_URL });
  console.log(`Navigated to: ${page.url}`);

  await delay(3000);

  // Try to get Vercel credentials from 1Password
  let email: string | null = null;
  let password: string | null = null;

  try {
    console.log("Checking 1Password for Vercel credentials...");
    email = await getSecretValue("vercel", "username").catch(() => null);
    password = await getSecretValue("vercel", "password").catch(() => null);

    if (!email) {
      // Try alternate field names
      email = await getSecretValue("vercel", "email").catch(() => null);
    }

    console.log(`Email found: ${!!email}`);
    console.log(`Password found: ${!!password}`);
  } catch (e) {
    console.log("Could not access 1Password:", (e as Error).message);
  }

  // Try GitHub OAuth first (most likely to work with existing session)
  console.log("Attempting GitHub OAuth login...");
  try {
    // Look for "Continue with GitHub" button
    await waitForSelector(page.pageId, 'button[data-testid="github-login-button"], button:has-text("GitHub"), a[href*="github"]', { timeout: 5000 });
    await click(page.pageId, 'button[data-testid="github-login-button"]');
    console.log("Clicked 'Continue with GitHub'");
    await delay(3000);
  } catch {
    console.log("GitHub button not found, trying email login...");

    if (email && password) {
      console.log("Attempting automatic login with 1Password credentials...");

      try {
        // Look for email input
        await waitForSelector(page.pageId, 'input[name="email"], input[type="email"]', { timeout: 5000 });
        await type(page.pageId, 'input[name="email"], input[type="email"]', email);
        console.log("Entered email");

        // Click continue/next button
        await delay(500);
        await click(page.pageId, 'button[type="submit"]');
        console.log("Clicked continue");

        await delay(2000);

        // Look for password input (might be on next page)
        try {
          await waitForSelector(page.pageId, 'input[type="password"]', { timeout: 5000 });
          await type(page.pageId, 'input[type="password"]', password);
          console.log("Entered password");

          await delay(500);
          await click(page.pageId, 'button[type="submit"]');
          console.log("Clicked login");
        } catch {
          console.log("No password field found - might use email-based login");
        }
      } catch (e) {
        console.log("Auto-login failed:", (e as Error).message);
      }
    } else {
      console.log("\n========================================");
      console.log("No Vercel credentials found in 1Password.");
      console.log("Please log in manually in the browser window.");
      console.log("The browser will wait for you to complete login.");
      console.log("========================================\n");
    }
  }

  // Wait for login to complete (look for dashboard or account page)
  console.log("Waiting for login to complete...");
  let loggedIn = false;

  for (let i = 0; i < 60; i++) {  // Wait up to 60 seconds
    await delay(1000);

    const pages = await listPages();
    const currentPage = pages.find(p => p.pageId === page.pageId);
    const currentUrl = currentPage?.url || "";

    console.log(`Current URL: ${currentUrl}`);

    // Check if we're on a dashboard or authenticated page
    if (currentUrl.includes("/dashboard") ||
        currentUrl.includes("/new") ||
        currentUrl.includes("/account") ||
        currentUrl.includes("vercel.com/") && !currentUrl.includes("/login") && !currentUrl.includes("/signup")) {

      // Also check for OAuth device page success
      if (currentUrl.includes("/oauth/device")) {
        console.log("On OAuth device page - looking for confirm button...");
        try {
          await click(page.pageId, 'button[type="submit"]');
          console.log("Clicked confirm button!");
          await delay(2000);
        } catch {
          // Button might not exist yet
        }
      }

      loggedIn = true;
      console.log("Login detected!");
      break;
    }

    // Check if we need to click a confirm button on OAuth page
    if (currentUrl.includes("/oauth/device")) {
      try {
        await click(page.pageId, 'button[type="submit"]');
        console.log("Clicked OAuth confirm button!");
      } catch {
        // Button might not be ready
      }
    }
  }

  if (loggedIn) {
    console.log("\n✓ Successfully logged into Vercel!");

    // If we have an OAuth URL to authorize, navigate there
    if (VERCEL_AUTH_URL.includes("oauth/device")) {
      console.log("Already on OAuth page, checking for confirm...");
    }
  } else {
    console.log("\n✗ Login timeout - please complete login in the browser");
  }

  // Keep browser open for a bit to allow final interactions
  console.log("\nKeeping browser open for 10 more seconds...");
  await delay(10000);

  console.log("Closing browser...");
  await closeBrowser();
  console.log("Done!");
}

main().catch(e => {
  console.error("Error:", e);
  closeBrowser().catch(() => {});
  process.exit(1);
});
