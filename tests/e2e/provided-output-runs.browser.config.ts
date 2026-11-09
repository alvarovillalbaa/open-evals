import assert from "node:assert/strict";
import path from "node:path";
import { defineConfig } from "@playwright/test";

assert.equal(process.env.PROVIDED_OUTPUT_BROWSER_ALLOW, "owned-disposable");
assert.equal(process.env.PROVIDED_OUTPUT_BROWSER_BASE_URL, "http://127.0.0.1:4173");
const report = process.env.PROVIDED_OUTPUT_BROWSER_REPORT_FILE;
const output = process.env.PROVIDED_OUTPUT_BROWSER_OUTPUT_DIR;
const temporary = process.env.RUNNER_TEMP;
assert.ok(report && output && temporary && path.isAbsolute(report) && path.isAbsolute(output) && path.isAbsolute(temporary));
const evidence = path.join(path.resolve(temporary), "open-evals-provided-output-browser-evidence");
assert.equal(path.resolve(report), path.join(evidence, "browser-report.json"));
assert.equal(path.resolve(output), path.join(evidence, "browser-output"));

export default defineConfig({
  testDir: ".",
  testMatch: "provided-output-runs.browser.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  repeatEach: 1,
  workers: 1,
  timeout: 90_000,
  globalTimeout: 420_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: report }]],
  outputDir: output,
  use: {
    baseURL: process.env.PROVIDED_OUTPUT_BROWSER_BASE_URL,
    browserName: "chromium", headless: true, viewport: { width: 1280, height: 900 },
    serviceWorkers: "block", actionTimeout: 10_000, navigationTimeout: 20_000,
    trace: "retain-on-failure", screenshot: "only-on-failure", video: "off"
  },
  projects: [{ name: "chromium-owned-production" }]
});
