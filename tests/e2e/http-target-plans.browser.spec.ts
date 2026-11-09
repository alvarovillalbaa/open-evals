import { createHash, randomUUID } from "node:crypto";
import type { Page, Request as BrowserRequest, Route } from "@playwright/test";
import type { HttpEvalPlanDraft, HttpEvalPlanPreview, HttpEvalPlanVersionRecord } from "@open-evals/core";
import { test, expect, type OwnedHttpPlanFixture, type HttpPlanSources } from "./http-target-plans.browser.fixture";

// T3 actual application/SQL authoring journeys, authored UNRUN. No target execution is
// authorized here. BR04 drops a real committed application's response; it fabricates no API data.
// Native HTTP execution, actual target responses and recovery UI remain separate pending gates.
const API = "/api/v1/http-target-plans";
function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const r = value as Record<string, unknown>; return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${stable(r[k])}`).join(",")}}`; }
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
// Forward one real application request and capture its complete response before
// delivery, avoiding Chromium's discarded CDP fetch-body resources after click.
async function capturePost<T>(page: Page, path: string, action: () => Promise<unknown>) {
  type Capture = { status: number; value: T; request: BrowserRequest };
  let complete!: (value: { captured?: Capture; error?: unknown }) => void;
  const captured = new Promise<{ captured?: Capture; error?: unknown }>(resolve => { complete = resolve; });
  const match = (url: URL) => url.pathname === path;
  let received = false;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    received = true;
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20000 });
      const body = await response.body(); expect(body.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 4096);
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T;
      await route.fulfill({ response, body });
      complete({ captured: { status: response.status(), value, request: route.request() } });
    } catch (error) { complete({ error }); await route.abort("failed").catch(() => undefined); }
  };
  await page.route(match, handler);
  try {
    await action(); const result = await captured;
    if (result.error) throw result.error;
    expect(result.captured).toBeDefined(); return result.captured!;
  } finally { if (received) await captured; await page.unroute(match, handler); }
}
function draft(sources: HttpPlanSources, patch: Partial<HttpEvalPlanDraft> = {}): HttpEvalPlanDraft { return { schemaVersion: "http-eval-plan-draft-v1", planId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored browser HTTP plan", ...sources, target: { targetId: "authored-browser-target", targetVersion: "1", endpoint: "https://target.example.com/evaluate", timeoutMs: 1000 }, limits: { concurrency: 1, maxDurationSeconds: 5 }, ...patch }; }
async function fill(page: Page, sources: HttpPlanSources, name: string, targetVersion = "1") {
  await page.getByLabel("Plan name", { exact: true }).fill(name);
  await page.getByLabel("Exact dataset version ID", { exact: true }).fill(sources.datasetVersionId);
  await page.getByLabel("Exact custom evaluator-set version IDs, one per line", { exact: true }).fill([...sources.evalSetVersionIds].reverse().join("\n"));
  await page.getByLabel("Target identity", { exact: true }).fill("authored-browser-target");
  await page.getByLabel("Declared target version", { exact: true }).fill(targetVersion);
  await page.getByLabel("Public HTTPS endpoint", { exact: true }).fill("https://target.example.com/evaluate");
  await page.getByLabel("Per-call timeout (ms)", { exact: true }).fill("1000"); await page.getByLabel("Concurrent calls", { exact: true }).fill("1"); await page.getByLabel("Run duration (seconds)", { exact: true }).fill("5");
}
async function preview(page: Page): Promise<HttpEvalPlanPreview> {
  const response = await capturePost<{ preview: HttpEvalPlanPreview }>(page, `${API}/preview`, () => page.getByRole("button", { name: "Preview plan without calling target", exact: true }).click());
  expect(response.status).toBe(200); const value = response.value.preview;
  expect(response.request.postDataJSON()).toEqual(value.draft); expect(value.draft.evalSetVersionIds).toEqual([...value.draft.evalSetVersionIds].sort());
  await expect(page.getByRole("heading", { name: "Complete plan preview", exact: true })).toBeVisible();
  await page.getByText("Inspect complete preview and save fingerprint", { exact: true }).click();
  expect(JSON.parse(await page.getByLabel("Inspect complete preview and save fingerprint", { exact: true }).innerText())).toEqual(value);
  return value;
}
async function save(page: Page, pinned: HttpEvalPlanPreview): Promise<HttpEvalPlanVersionRecord> {
  const response = await capturePost<{ record: HttpEvalPlanVersionRecord; replayed: boolean }>(page, API, () => page.getByRole("button", { name: "Save immutable plan without executing", exact: true }).click());
  expect(response.status).toBe(201); const value = response.value; expect(value.replayed).toBe(false);
  expect(response.request.postDataJSON()).toEqual({ schemaVersion: "http-eval-plan-save-v1", draft: pinned.draft, expectedPreviewFingerprint: pinned.fingerprint });
  await expect(page.getByRole("link", { name: "Open saved plan and execution controls", exact: true })).toBeVisible(); return value.record;
}
async function stored(owned: OwnedHttpPlanFixture, record: HttpEvalPlanVersionRecord, count: number) {
  const data = await owned.snapshot(), native = data.plans.find(p => p.id === record.storage.versionId); expect(native?.record).toEqual(record); expect(native?.fingerprint).toBe(record.fingerprint); expect(native?.createdAt).toBe(record.createdAt);
  const audit = data.audits.find(a => a.resourceId === record.storage.versionId); expect(audit?.actorId).toBe(owned.actorId); expect(audit?.action).toBe("http_eval.plan.saved");
  const metadata = { schemaVersion: "http-eval-plan-audit-v1", planId: record.content.draft.planId, versionId: record.content.draft.versionId, storageVersionId: record.storage.versionId, requestFingerprint: record.requestFingerprint, recordFingerprint: record.fingerprint };
  expect(audit?.metadata).toEqual(metadata); expect(audit?.metadataHash).toBe(hash(metadata)); expect(data.counts.plans).toBe(count); expect(data.counts.planAudits).toBe(count);
  expect(data.dispatchClaims).toBe(0); for (const key of ["runs", "samples", "results", "gates", "workflows", "events"] as const) expect(data.counts[key]).toBe(0);
}
async function exact(page: Page, owned: OwnedHttpPlanFixture, record: HttpEvalPlanVersionRecord) {
  const d = record.content.draft; expect((await page.goto(`${owned.baseUrl}/evals/plans/${d.planId}/versions/${d.versionId}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Exact saved HTTP eval plan", exact: true })).toBeVisible();
  await page.getByText("Inspect complete immutable plan version", { exact: true }).click(); expect(JSON.parse(await page.getByLabel("Inspect complete immutable plan version", { exact: true }).innerText())).toEqual(record);
  await expect(page.getByRole("button", { name: "Start a new explicit execution", exact: true })).toBeDisabled();
}

test("HTTP-BR01 desktop complete preview, explicit immutable save and reload make no execution reservation", async ({ page, owned }) => {
  const sources = await owned.sources(), baseline = (await owned.snapshot()).counts;
  await page.goto(`${owned.baseUrl}/evals/plans`); await fill(page, sources, "Authored desktop plan");
  const p = await preview(page); expect(p.content.samples).toHaveLength(2); expect(p.content.evalSets).toHaveLength(2); expect(p.content.items).toHaveLength(2);
  expect(p.content.policy.maxTargetCalls).toBe(2); expect(p.content.policy.maxJudgeCalls).toBe(0); expect((await owned.snapshot()).counts).toEqual(baseline);
  const record = await save(page, p); expect(record.content).toEqual(p.content); expect(record.previewFingerprint).toBe(p.fingerprint); await stored(owned, record, 1);
  await exact(page, owned, record); await page.reload(); await expect(page.getByRole("button", { name: "Start a new explicit execution", exact: true })).toBeDisabled();
  await page.getByText("Inspect complete immutable plan version", { exact: true }).click(); expect(JSON.parse(await page.getByLabel("Inspect complete immutable plan version", { exact: true }).innerText())).toEqual(record);
  const authorize = page.getByRole("checkbox", { name: /I authorize this execution/ }); await authorize.check(); await expect(page.getByRole("button", { name: "Start a new explicit execution", exact: true })).toBeEnabled(); await authorize.uncheck();
  await stored(owned, record, 1);
});

test("HTTP-BR02 narrow Unicode and complete JSON preserve saved inputs and both evaluator versions", async ({ page, owned }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const sources = await owned.sources(), name = "Café 家族 🧪 — versión α";
  await page.goto(`${owned.baseUrl}/evals/plans`); await fill(page, sources, name, "β-2026");
  const p = await preview(page), row = p.content.dataset.rows.find(r => r.rowKey === "Álpha 🧪")!; expect(row).toBeTruthy(); expect(row.input).toEqual({ prompt: "Authored café input", n: 0, enabled: false }); expect(row.context).toEqual({ present: true, value: null }); expect(row.expectedOutput).toEqual({ present: true, value: { reference: "SECRET_REFERENCE" } });
  expect(p.content.dataset.rows.find(r => r.rowKey === "Beta")?.context).toEqual({ present: false, value: null }); expect(p.content.evalSets.map(s => s.contract.id)).toEqual(sources.evalSetVersionIds);
  const record = await save(page, p); await exact(page, owned, record); await expect(page.getByRole("heading", { name: `${name} · version 1`, exact: true })).toBeVisible();
  await expect(page.getByText("authored-browser-target · β-2026", { exact: true })).toBeVisible();
  const size = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth })); expect(size.root).toBeLessThanOrEqual(size.viewport + 1); expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
  await stored(owned, record, 1);
});

test("HTTP-BR03 actual stale-head conflict preserves fields and requires visible head review before version three", async ({ page, owned }) => {
  const sources = await owned.sources(), first = await owned.savePlan(draft(sources));
  await page.goto(`${owned.baseUrl}/evals/plans/${first.content.draft.planId}`); await page.getByLabel("Plan name", { exact: true }).fill("Preserved authored version"); await page.getByLabel("Declared target version", { exact: true }).fill("2"); const stale = await preview(page);
  const competing = await owned.savePlan({ ...first.content.draft, versionId: randomUUID(), version: 2, expectedVersionId: first.content.draft.versionId, name: "Competing saved head" });
  const failed = await capturePost<{ error: string }>(page, API, () => page.getByRole("button", { name: "Save immutable plan without executing", exact: true }).click()); expect(failed.status).toBe(409); expect(failed.value).toEqual({ error: "http_eval_plan_stale" });
  await expect(page.getByRole("alert")).toContainText("Your text is preserved"); await expect(page.getByLabel("Plan name", { exact: true })).toHaveValue("Preserved authored version"); await expect(page.getByLabel("Declared target version", { exact: true })).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Preview plan without calling target", exact: true })).toBeDisabled(); await page.getByRole("button", { name: "Reload current head", exact: true }).click();
  const review = page.getByRole("checkbox", { name: /I reviewed the current head/ }); await expect(review).toBeVisible(); await expect(review).toBeDisabled(); await page.getByText("Inspect complete current head before another intent", { exact: true }).click(); expect(JSON.parse(await page.getByLabel("Complete current saved plan head", { exact: true }).innerText())).toEqual(competing); await review.check();
  const next = await preview(page); expect(next.draft.version).toBe(3); expect(next.draft.expectedVersionId).toBe(competing.content.draft.versionId); expect(next.draft.versionId).not.toBe(stale.draft.versionId); expect(next.draft.name).toBe("Preserved authored version"); expect(next.draft.target.targetVersion).toBe("2");
  const third = await save(page, next); await stored(owned, third, 3); await page.goto(`${owned.baseUrl}/evals/plans/${first.content.draft.planId}`);
  const history = page.getByRole("region", { name: "Immutable plan version history" }); for (const version of [1, 2, 3]) await expect(history.getByRole("link", { name: new RegExp(`^Version ${version}:`) })).toBeVisible();
  const old = await page.context().request.get(`${owned.baseUrl}${API}/${first.content.draft.planId}/versions/${first.content.draft.versionId}`, { maxRedirects: 0 }); expect(old.status()).toBe(200); expect((await old.json()).record).toEqual(first);
});

test("HTTP-BR04 real committed save with a lost response retries the identical intent without duplication", async ({ page, owned }) => {
  const sources = await owned.sources(); await page.goto(`${owned.baseUrl}/evals/plans`); await fill(page, sources, "Authored exact retry"); const p = await preview(page);
  const bodies: string[] = [];
  type CapturedSave = { status?: number; value?: { record: HttpEvalPlanVersionRecord; replayed: boolean }; error?: unknown };
  let firstComplete!: (value: CapturedSave) => void, retryComplete!: (value: CapturedSave) => void;
  const firstResponse = new Promise<CapturedSave>(resolve => { firstComplete = resolve; });
  const retryResponse = new Promise<CapturedSave>(resolve => { retryComplete = resolve; });
  const match = (url: URL) => url.pathname === API;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    bodies.push(route.request().postData()!); const first = bodies.length === 1;
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20000 });
      const body = await response.body(); expect(body.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 4096);
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as { record: HttpEvalPlanVersionRecord; replayed: boolean };
      if (first) firstComplete({ status: response.status(), value });
      else { await route.fulfill({ response, body }); retryComplete({ status: response.status(), value }); }
    } catch (error) { (first ? firstComplete : retryComplete)({ error }); if (!first) await route.abort("failed").catch(() => undefined); }
    finally { if (first) await route.abort("connectionreset"); }
  };
  await page.route(match, handler);
  try {
    await page.getByRole("button", { name: "Save immutable plan without executing", exact: true }).click();
    const first = await firstResponse; expect(first.error).toBeUndefined(); expect(first.status).toBe(201); expect(first.value?.replayed).toBe(false); const committed = first.value!.record;
    await expect(page.getByRole("alert")).toContainText("save outcome is unknown");
    await expect(page.getByLabel("Plan name", { exact: true })).toHaveAttribute("readonly", ""); await stored(owned, committed, 1);
    await page.getByRole("button", { name: "Retry identical plan save", exact: true }).click(); const response = await retryResponse; expect(response.error).toBeUndefined(); expect(response.status).toBe(200); const value = response.value!; expect(value.replayed).toBe(true); expect(value.record).toEqual(committed);
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(JSON.parse(bodies[0]!)).toEqual({ schemaVersion: "http-eval-plan-save-v1", draft: p.draft, expectedPreviewFingerprint: p.fingerprint });
    await expect(page.getByText("Recovered the existing immutable plan version. No duplicate was saved and no target was called.", { exact: true })).toBeVisible(); await exact(page, owned, committed); await stored(owned, committed, 1);
  } finally { await page.unroute(match, handler); }
});

test("HTTP-BR05 viewer preview and read remain available while write, execution, recovery, keys and foreign scope are denied", async ({ page, browser, owned }) => {
  const sources = await owned.sources(), record = await owned.savePlan(draft(sources)), d = record.content.draft, before = (await owned.snapshot()).counts;
  const viewer = await owned.viewerContext(browser), viewed = await viewer.newPage(); await viewed.goto(`${owned.baseUrl}/evals/plans/${d.planId}`); const p = await preview(viewed); expect(p.draft.version).toBe(2); await expect(viewed.getByRole("button", { name: "Save immutable plan without executing", exact: true })).toBeDisabled();
  for (const path of [API, `${API}/${d.planId}/versions/${d.versionId}/runs`, `${API}/runs/${randomUUID()}/recover`]) { const denied = await viewer.request.post(`${owned.baseUrl}${path}`, { maxRedirects: 0, headers: { "Content-Type": "application/json" }, data: "{" }); expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("workspace_role_forbidden:editor"); }
  await exact(viewed, owned, record); await expect(viewed.getByRole("checkbox", { name: /I authorize this execution/ })).toBeDisabled();
  const headers = { Authorization: `Bearer ${owned.apiKey}`, "Content-Type": "application/json" }; expect((await page.context().request.get(`${owned.baseUrl}/api/v1/benchmarks`, { headers, maxRedirects: 0 })).status()).toBe(200);
  for (const path of [API, `${API}/${d.planId}`, `${API}/${d.planId}/versions/${d.versionId}`, `${API}/${d.planId}/versions/${d.versionId}/runs`, `${API}/runs/${randomUUID()}`]) { const denied = await page.context().request.get(`${owned.baseUrl}${path}`, { headers, maxRedirects: 0 }); expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("custom_eval_workspace_session_required"); }
  for (const path of [API, `${API}/preview`, `${API}/${d.planId}/versions/${d.versionId}/runs`, `${API}/runs/${randomUUID()}/recover`]) { const denied = await page.context().request.post(`${owned.baseUrl}${path}`, { headers, maxRedirects: 0, data: "{" }); expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("custom_eval_workspace_session_required"); }
  const foreign = await owned.foreignContext(browser), missing = await foreign.request.get(`${owned.baseUrl}${API}/${d.planId}/versions/${d.versionId}`, { maxRedirects: 0 }); expect(missing.status()).toBe(404); expect(await missing.json()).toEqual({ error: "http_eval_plan_version_not_found" });
  const foreignPreview = await foreign.request.post(`${owned.baseUrl}${API}/preview`, { data: draft(sources), maxRedirects: 0 }); expect(foreignPreview.status()).toBe(404);
  expect((await owned.snapshot()).counts).toEqual(before); await stored(owned, record, 1);
});
