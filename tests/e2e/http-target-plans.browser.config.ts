import assert from "node:assert/strict";
import path from "node:path";
import { defineConfig } from "@playwright/test";
assert.equal(process.env.HTTP_PLAN_BROWSER_ALLOW, "owned-disposable");
assert.equal(process.env.HTTP_PLAN_BROWSER_BASE_URL, "http://127.0.0.1:4173");
const report = process.env.HTTP_PLAN_BROWSER_REPORT_FILE, output = process.env.HTTP_PLAN_BROWSER_OUTPUT_DIR, temporary = process.env.RUNNER_TEMP;
assert.ok(report && output && temporary && path.isAbsolute(report) && path.isAbsolute(output) && path.isAbsolute(temporary));
const evidence = path.join(path.resolve(temporary), "open-evals-http-target-browser-evidence");
assert.equal(path.resolve(report), path.join(evidence, "browser-report.json")); assert.equal(path.resolve(output), path.join(evidence, "browser-output"));
export default defineConfig({ testDir: ".", testMatch: "http-target-plans.browser.spec.ts", fullyParallel: false, forbidOnly: true, retries: 0, repeatEach: 1, workers: 1,
  timeout: 90000, globalTimeout: 420000, expect: { timeout: 10000 }, reporter: [["list"], ["json", { outputFile: report }]], outputDir: output,
  use: { baseURL: process.env.HTTP_PLAN_BROWSER_BASE_URL, browserName: "chromium", headless: true, viewport: { width: 1280, height: 900 }, serviceWorkers: "block", actionTimeout: 10000, navigationTimeout: 20000, trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" },
  projects: [{ name: "chromium-owned-production-no-dispatch" }] });
