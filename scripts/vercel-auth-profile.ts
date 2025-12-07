/**
 * Authenticate Vercel CLI using Chrome with existing profile
 */
import { launchBrowser, newPage, navigate, click, waitForSelector, disconnectBrowser, closeBrowser } from "../../servers/puppeteer/index.js";

async function main() {
  const vercelUrl = process.argv[2] || "https://vercel.com/oauth/device?user_code=TQHB-RNCP";

  console.log("Launching Chrome with your profile...");

  // Launch browser with user's Chrome profile to get existing cookies
  await launchBrowser({
    headless: false,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      `--user-data-dir=/Users/noahedis/Library/Application Support/Google/Chrome`,
      "--profile-directory=Default"
    ]
  });

  console.log("Creating new page...");
  const page = await newPage({ url: vercelUrl });
  console.log(`Opened: ${page.url}`);

  console.log("Waiting for page to load...");
  await new Promise(r => setTimeout(r, 3000));

  // Try to find and click the authorize button
  const buttonSelectors = [
    'button[type="submit"]',
    'button[data-testid="confirm-button"]',
    'button:has-text("Confirm")',
    'button:has-text("Continue")',
    'button:has-text("Authorize")',
  ];

  for (const selector of buttonSelectors) {
    try {
      await waitForSelector(page.pageId, selector, { timeout: 2000 });
      console.log(`Found button: ${selector}`);
      await click(page.pageId, selector);
      console.log("Clicked!");
      break;
    } catch (e) {
      // Try next selector
    }
  }

  console.log("Waiting for auth to complete...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("Closing browser...");
  await closeBrowser();
  console.log("Done!");
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
