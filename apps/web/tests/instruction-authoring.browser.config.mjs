import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { authoringBaseURL } from "./instruction-authoring.fixtures.mjs";

// Dedicated opt-in scope. The approved runner starts the isolated server separately.
const baseURL = authoringBaseURL();
if (new URL(baseURL).port !== "3217") throw new Error("authoring browser checks require the disposable server on port 3217");

export default defineConfig({
  testDir: ".",
  testMatch: "instruction-authoring.browser.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  globalTimeout: 6 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: fileURLToPath(new URL("./.authoring-browser-results/report.json", import.meta.url)) }]],
  outputDir: ".authoring-browser-results",
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "authoring-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }]
});
