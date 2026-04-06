import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: "https://opshub-umber.vercel.app",
    screenshot: "on",
    trace: "off",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
