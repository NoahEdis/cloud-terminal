/**
 * Authenticate Vercel CLI using an existing browser session
 */
import {
  scanForBrowsers,
  connectToBrowser,
  attachToExistingPages,
  newPage,
  navigate,
  click,
  waitForSelector,
  getText,
  getPageContent,
  disconnectBrowser,
  listPages,
  type,
  waitForNavigation,
  evaluate,
} from "../../servers/puppeteer/index.js";

async function main() {
  console.log("Scanning for browsers with remote debugging enabled...");

  // First, scan for any browsers with debugging
  const browsers = await scanForBrowsers({ ports: [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229] });

  if (browsers.length === 0) {
    console.log("No browsers found with remote debugging. Trying common Chrome debug ports...");

    // Try to connect directly to port 9222
    try {
      const result = await connectToBrowser({ debugPort: 9222, disableDefaultViewport: true });
      console.log("Connected:", result);
    } catch (e) {
      console.error("Could not connect to any browser.");
      console.log("\nTo enable browser debugging, restart Chrome/Arc with:");
      console.log("  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222");
      console.log("  or");
      console.log("  /Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222");
      process.exit(1);
    }
  } else {
    console.log(`Found ${browsers.length} browser(s):`);
    for (const b of browsers) {
      console.log(`  - Port ${b.port}: ${b.browser.browser}`);
    }

    // Connect to the first one
    const result = await connectToBrowser({
      debugPort: browsers[0].port,
      disableDefaultViewport: true
    });
    console.log("Connected:", result);
  }

  // Attach to existing pages
  const existingPages = await attachToExistingPages();
  console.log(`\nAttached to ${existingPages.length} existing pages:`);
  for (const page of existingPages) {
    console.log(`  - ${page.pageId}: ${page.url}`);
  }

  // Open the Vercel auth URL in a new tab
  const vercelUrl = "https://vercel.com/oauth/device?user_code=PNRS-HDNT";
  console.log(`\nOpening Vercel auth URL: ${vercelUrl}`);

  const page = await newPage({ url: vercelUrl });
  console.log(`Created new page: ${page.pageId}`);

  // Wait for the page to load and look for the authorize button
  console.log("Waiting for page to load...");
  await new Promise(r => setTimeout(r, 3000));

  // Get page content to understand what we're looking at
  const content = await getPageContent(page.pageId);
  console.log("Page title:", page.title);

  // Look for the confirm/authorize button
  try {
    // Try different possible selectors for the auth button
    const selectors = [
      'button[type="submit"]',
      'button:contains("Confirm")',
      'button:contains("Authorize")',
      'button:contains("Allow")',
      'button:contains("Continue")',
      '[data-testid="confirm-button"]',
      'form button',
    ];

    for (const selector of selectors) {
      try {
        await waitForSelector(page.pageId, selector, { timeout: 2000 });
        console.log(`Found button with selector: ${selector}`);
        await click(page.pageId, selector);
        console.log("Clicked authorize button!");
        break;
      } catch {
        // Try next selector
      }
    }

    // Wait a bit for the auth to complete
    await new Promise(r => setTimeout(r, 3000));

    console.log("\nAuth flow completed. Disconnecting from browser...");
  } catch (e) {
    console.error("Error during auth:", e);
  }

  await disconnectBrowser();
  console.log("Done!");
}

main().catch(console.error);
