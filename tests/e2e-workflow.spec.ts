import { test, expect, type Page } from "@playwright/test";

const BASE = "https://opshub-umber.vercel.app";
const EMAIL = "opshubtesting@proton.me";
const PW = "teSting123opShubteSt6969";
const SCREENSHOTS = "tests/screenshots";
const CLIENT_EMAIL = "jon@housepartydistro.com";

let step = 0;
async function snap(page: Page, name: string) {
  step++;
  const filename = `${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${SCREENSHOTS}/${filename}`, fullPage: true });
}

test("Full E2E — every page screenshot", async ({ page }) => {
  test.setTimeout(300000);

  // ── LOGIN ──
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await snap(page, "01-dashboard");

  // ── PROJECTS LIST ──
  await page.goto(`${BASE}/jobs`);
  await page.waitForTimeout(2000);
  await snap(page, "02-projects-list");

  // ── NEW PROJECT — create client + project ──
  await page.goto(`${BASE}/jobs/new`);
  await page.waitForTimeout(2000);
  await snap(page, "03-new-project-form");

  // Click + New Client button
  await page.click('button:has-text("New Client")');
  await page.waitForTimeout(1000);
  await snap(page, "04-new-client-modal");

  // Fill client modal — use nth inputs inside the modal overlay
  const modal = page.locator('div[style*="fixed"]').last();
  const modalInputs = modal.locator("input");

  // Company name (1st input)
  await modalInputs.nth(0).fill("Playwright Test Co");
  // Contact name (2nd input)
  await modalInputs.nth(1).fill("Jon Test");
  // Phone (3rd input)
  await modalInputs.nth(2).fill("702-555-0100");
  // Email (4th input)
  await modalInputs.nth(3).fill(CLIENT_EMAIL);
  await page.waitForTimeout(500);
  await snap(page, "05-client-modal-filled");

  // Scroll down and click Create Client
  const createClientBtn = modal.locator('button:has-text("Create Client")');
  await createClientBtn.scrollIntoViewIfNeeded();
  await createClientBtn.click();
  await page.waitForTimeout(2000);
  await snap(page, "06-client-created");

  // Fill project memo
  const memoLabel = page.locator('text=Project memo').locator("..");
  await memoLabel.locator("input").fill("E2E Test Run");
  await page.waitForTimeout(500);
  await snap(page, "07-project-form-ready");

  // Create project
  await page.click('button:has-text("Create Project")');
  await page.waitForTimeout(3000);
  await snap(page, "08-project-created");

  // ── PROJECT DETAIL — all tabs ──
  if (page.url().includes("/jobs/")) {
    const projectUrl = page.url();

    // Overview (default)
    await snap(page, "09-tab-overview");

    // Each tab — click the progress step or find the tab text
    const tabs = [
      { name: "Processing", slug: "processing" },
      { name: "Buy Sheet", slug: "buysheet" },
      { name: "Art", slug: "art" },
      { name: "Costing", slug: "costing" },
      { name: "Quote", slug: "quote" },
      { name: "Approvals", slug: "approvals" },
      { name: "Blanks", slug: "blanks" },
      { name: "PO", slug: "po" },
    ];

    for (const tab of tabs) {
      // Click the tab in the progress bar
      const tabEl = page.locator(`text="${tab.name}"`).first();
      try {
        await tabEl.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
      } catch {
        // Tab might not be clickable, try navigating
      }
      await snap(page, `10-tab-${tab.slug}`);
    }
  }

  // ── ALL SIDEBAR PAGES ──
  const pages = [
    ["clients", "/clients"],
    ["decorators", "/decorators"],
    ["production", "/production"],
    ["toolkit", "/toolkit"],
    ["staging", "/staging"],
    ["receiving", "/receiving"],
    ["shipping", "/shipping"],
    ["fulfillment", "/fulfillment"],
    ["ecomm", "/ecomm"],
    ["insights", "/insights"],
    ["reports", "/reports"],
    ["settings", "/settings"],
  ];

  for (const [name, path] of pages) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(2000);
    await snap(page, `page-${name}`);
  }

  // ── CLIENT PORTAL ──
  // Go to first existing project with portal token
  await page.goto(`${BASE}/jobs`);
  await page.waitForTimeout(2000);
  const projectLink = page.locator('a[href*="/jobs/"]').first();
  if (await projectLink.isVisible()) {
    await projectLink.click();
    await page.waitForTimeout(2000);
    await snap(page, "project-with-portal");
  }
});
