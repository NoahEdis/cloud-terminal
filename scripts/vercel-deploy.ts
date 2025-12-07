/**
 * Deploy to Vercel using Puppeteer with persistent browser profile.
 * Uses a stored browser profile to maintain login state.
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
import * as path from "path";
import * as os from "os";

const VERCEL_URL = process.argv[2] || "https://vercel.com/dashboard";
const BROWSER_DATA_DIR = path.join(os.homedir(), ".cloud-terminal-browser");

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("Launching Chrome with persistent profile...");
  console.log(`Browser data dir: ${BROWSER_DATA_DIR}`);

  // Launch browser with persistent user data directory
  await launchBrowser({
    headless: false,
    disableDefaultViewport: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1200,800",
      `--user-data-dir=${BROWSER_DATA_DIR}`,
    ],
  });

  console.log("Creating new page...");
  const page = await newPage({ url: VERCEL_URL });
  console.log(`Navigated to: ${page.url}`);

  await delay(3000);

  // Check if we're logged in
  const pages = await listPages();
  const currentPage = pages.find(p => p.pageId === page.pageId);
  const currentUrl = currentPage?.url || "";

  console.log(`Current URL: ${currentUrl}`);

  if (currentUrl.includes("/login")) {
    console.log("\n========================================");
    console.log("Not logged in yet.");
    console.log("Please log in manually in the browser window.");
    console.log("The browser will wait for you to complete login.");
    console.log("Your login will be saved for future sessions.");
    console.log("========================================\n");

    // Wait for login to complete
    for (let i = 0; i < 120; i++) {  // Wait up to 2 minutes
      await delay(1000);

      const pages = await listPages();
      const currentPage = pages.find(p => p.pageId === page.pageId);
      const newUrl = currentPage?.url || "";

      if (!newUrl.includes("/login") && !newUrl.includes("/signup")) {
        console.log("Login detected!");
        break;
      }

      if (i % 10 === 0) {
        console.log(`Waiting for login... (${120 - i}s remaining)`);
      }
    }
  } else {
    console.log("Already logged in!");
  }

  // Navigate to dashboard
  const pages2 = await listPages();
  const currentPage2 = pages2.find(p => p.pageId === page.pageId);
  console.log(`Now at: ${currentPage2?.url}`);

  // If we need to run a specific command, wait a bit then close
  console.log("\nKeeping browser open for 30 seconds for any manual actions...");
  console.log("You can create a token at https://vercel.com/account/tokens");
  await delay(30000);

  console.log("Closing browser...");
  await closeBrowser();
  console.log("Done! Your login has been saved.");
}

main().catch(e => {
  console.error("Error:", e);
  closeBrowser().catch(() => {});
  process.exit(1);
});
