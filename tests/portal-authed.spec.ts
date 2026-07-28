// Debug: does the portal token page wedge when the browser ALSO holds an
// OpsHub session on app.housepartydistro.com (Jon's browser state)?
import { test } from "@playwright/test";

const BASE = "https://app.housepartydistro.com";
const EMAIL = "opshubtesting@proton.me";
const PW = "teSting123opShubteSt6969";
const PORTAL = `${BASE}/portal/0c30c724-956a-4a66-861c-f368a410bc1d`;

test("portal with active session", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("requestfailed", (r) => errors.push("REQFAIL: " + r.url().slice(0, 120) + " — " + (r.failure()?.errorText || "")));

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(/house|dashboard|projects/, { timeout: 25000 }).catch(() => console.log("login redirect did not land"));
  await page.waitForTimeout(2000);
  console.log("after login, url:", page.url());

  await page.goto(PORTAL, { waitUntil: "networkidle" }).catch((e) => errors.push("GOTO: " + e.message));
  await page.waitForTimeout(8000);
  console.log("portal url now:", page.url());
  console.log("BODY (first 200):", (await page.locator("body").innerText().catch(() => ""))?.slice(0, 200).replace(/\n+/g, " | "));
  console.log("ERRORS:\n" + (errors.length ? errors.map(e => e.slice(0, 400)).join("\n") : "(none)"));
});
