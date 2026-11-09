import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

if (process.env.EVAL_COMPOSITION_BROWSER_ALLOW !== "owned-disposable" || process.env.EVAL_COMPOSITION_BROWSER_BASE_URL !== "http://127.0.0.1:4173") throw new Error("eval_composition_browser_guard_required");
if (!process.env.RUNNER_TEMP) throw new Error("eval_composition_evidence_root_required");
const evidence = resolve(process.env.RUNNER_TEMP, "open-evals-composition-v2-evidence");
if (process.env.EVAL_COMPOSITION_BROWSER_OUTPUT_DIR !== resolve(evidence, "browser-output") || process.env.EVAL_COMPOSITION_BROWSER_REPORT !== resolve(evidence, "browser-report.json")) throw new Error("eval_composition_evidence_paths_required");
export default defineConfig({
  testDir: ".", testMatch: "eval-composition.browser.spec.ts", fullyParallel: false,
  workers: 1, retries: 0, forbidOnly: true, timeout: 120000,
  expect: { timeout: 10000 },
  outputDir: process.env.EVAL_COMPOSITION_BROWSER_OUTPUT_DIR,
  reporter: [["list"], ["json", { outputFile: process.env.EVAL_COMPOSITION_BROWSER_REPORT }]],
  use: {
    baseURL: "http://127.0.0.1:4173", browserName: "chromium", headless: true,
    viewport: { width: 1280, height: 900 }, serviceWorkers: "block",
    actionTimeout: 10000, navigationTimeout: 20000,
    screenshot: "only-on-failure", trace: "retain-on-failure", video: "off"
  },
  projects: [{ name: "chromium-owned-production-authored-transport" }]
});
