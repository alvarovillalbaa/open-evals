import { createHash } from "node:crypto";
import type { Page, Request, Route } from "@playwright/test";
import type { CustomDatasetDraft, CustomDatasetPreview, CustomDatasetSaveResult, CustomDatasetVersionRecord, ProvidedOutputRunRecord } from "@open-evals/core";
import { test, expect, emptyCounts, expectNoDatasetWrites, expectStored, type OwnedCustomDatasetFixture } from "./custom-datasets.browser.fixture";

const endpoint = "/api/v1/custom-datasets";
const source = (page: Page) => page.getByLabel("Dataset source text", { exact: true });
const name = (page: Page) => page.getByLabel("Dataset name", { exact: true });
const format = (page: Page) => page.getByLabel("Source format", { exact: true });
const review = (page: Page) => page.getByLabel("Review declarations", { exact: true });
const upload = (page: Page) => page.getByLabel("Upload JSON or JSONL", { exact: true });
const rows = (marker: string) => JSON.stringify([
  { rowKey: "Alpha", input: { prompt: `Authored alpha ${marker}` }, metadata: { marker, zero: 0, flag: false } },
  { rowKey: "Beta", input: { prompt: `Authored beta ${marker}` }, expectedOutput: "approved reference", context: null }
]);

async function open(page: Page, owned: OwnedCustomDatasetFixture) {
  const access = await page.context().request.get(`${owned.baseUrl}${endpoint}`, { maxRedirects: 0 });
  expect(access.status()).toBe(200); expect((await access.json()).canWrite).toBe(true);
  const document = await page.goto(`${owned.baseUrl}/evals/datasets`);
  expect(document?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Custom datasets", exact: true })).toBeVisible();
  await expect(source(page)).toHaveValue(""); await expectNoDatasetWrites(owned);
}
async function edit(page: Page, sourceText: string, datasetName: string) {
  await name(page).fill(datasetName); await format(page).selectOption("json"); await review(page).selectOption("synthetic"); await source(page).fill(sourceText);
}
// Capture the real response before delivering it unchanged to Chromium. Reading a
// CDP body only after click completion can lose an already-consumed fetch resource.
async function capturePost<T>(page: Page, path: string, action: () => Promise<unknown>) {
  type Capture = { status: number; value: T; request: Request };
  let complete!: (value: { captured?: Capture; error?: unknown }) => void;
  const captured = new Promise<{ captured?: Capture; error?: unknown }>(resolve => { complete = resolve; });
  const matches = (url: URL) => url.pathname === path;
  let received = false;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    received = true;
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      const body = await response.body(); expect(body.length).toBeLessThanOrEqual(8 * 1024 * 1024 + 4096);
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T;
      await route.fulfill({ response, body });
      complete({ captured: { status: response.status(), value, request: route.request() } });
    } catch (error) { complete({ error }); await route.abort("failed").catch(() => undefined); }
  };
  await page.route(matches, handler);
  try {
    await action();
    const result = await captured;
    if (result.error) throw result.error;
    expect(result.captured).toBeDefined();
    return result.captured!;
  } finally {
    if (received) await captured;
    await page.unroute(matches, handler);
  }
}
async function preview(page: Page) {
  const response = await capturePost<{ preview: CustomDatasetPreview }>(page, `${endpoint}/preview`, () => page.getByRole("button", { name: "Preview complete dataset", exact: true }).click());
  expect(response.status).toBe(200);
  const value = response.value;
  const draft = response.request.postDataJSON() as CustomDatasetDraft;
  expect(value.preview.schemaVersion).toBe("custom-dataset-preview-v1"); expect(value.preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(value.preview.intent.sourceDigest).toBe(createHash("sha256").update(draft.sourceText).digest("hex"));
  expect(value.preview.canonicalSnapshotBytes).toBeLessThanOrEqual(1048576);
  await expect(page.getByRole("heading", { name: "Review and explicitly save", exact: true })).toBeVisible();
  return { pinned: value.preview, draft };
}
async function save(page: Page, button = "Save immutable version", status = 201) {
  const response = await capturePost<CustomDatasetSaveResult>(page, endpoint, () => page.getByRole("button", { name: button, exact: true }).click());
  expect(response.status).toBe(status);
  return response;
}
async function refusePreview(page: Page, code: string) {
  const response = await capturePost<{ error: string; rowIndex?: number; line?: number; column?: number }>(page, `${endpoint}/preview`, () => page.getByRole("button", { name: "Preview complete dataset", exact: true }).click());
  expect(response.status).toBe(422);
  const value = response.value; expect(value.error).toBe(code);
  await expect(page.getByRole("heading", { name: "Review and explicitly save", exact: true })).toHaveCount(0);
  return value;
}
async function readVersion(page: Page, owned: OwnedCustomDatasetFixture, record: CustomDatasetVersionRecord) {
  const response = await page.context().request.get(`${owned.baseUrl}${endpoint}/${record.content.dataset.publicId}/versions/${record.content.version.publicId}`, { maxRedirects: 0 });
  expect(response.status()).toBe(200); expect(await response.json()).toEqual({ record });
}
async function openVersion(page: Page, owned: OwnedCustomDatasetFixture, record: CustomDatasetVersionRecord) {
  await page.getByRole("link", { name: "Open exact saved version", exact: true }).click();
  await expect(page).toHaveURL(`${owned.baseUrl}/evals/datasets/${record.content.dataset.publicId}/versions/${record.content.version.publicId}`);
  await expect(page.getByRole("heading", { name: "Saved dataset version", exact: true })).toBeVisible();
  await readVersion(page, owned, record);
}
async function layout(page: Page) {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const size = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(size.root).toBeLessThanOrEqual(size.viewport + 1); expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
  for (const control of [name(page), format(page), review(page), upload(page), source(page)]) {
    await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox(); expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
}

test("CD-BR01 desktop JSONL upload saves complete rows and explicitly scores the exact saved version", async ({ page, owned }) => {
  await open(page, owned);
  const text = '{"rowKey":"Alpha","input":{"prompt":"Authored alpha 🧭","nested":[0,false,"",null]},"expectedOutput":null,"metadata":{"__proto__":{"authored":"kept"},"constructor":"owned","language":"en"},"reviewStatus":"reviewed"}\n'
    + '{"rowKey":"Beta","input":{"prompt":"Authored beta"},"context":null,"history":[0,false,""]}\n';
  await name(page).fill("Authored uploaded inputs 🧭"); await format(page).selectOption("jsonl"); await review(page).selectOption("synthetic");
  await upload(page).setInputFiles({ name: "authored-inputs.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(text) });
  await expect(source(page)).toHaveValue(text); await expect(page.locator('p[role="status"]')).toContainText("File loaded without truncation.");
  await expectNoDatasetWrites(owned);
  const { pinned, draft } = await preview(page);
  expect(draft.sourceText).toBe(text); expect(draft.format).toBe("jsonl"); expect(pinned.content.rows).toHaveLength(2);
  expect(pinned.content.rows.map(row => [row.rowKey, row.reviewStatus])).toEqual([["Alpha", "reviewed"], ["Beta", "synthetic"]]);
  expect(pinned.content.rows[0]?.expectedOutput).toEqual({ present: true, value: null });
  expect(pinned.content.rows[0]?.context).toEqual({ present: false, value: null });
  expect(pinned.content.rows[1]?.context).toEqual({ present: true, value: null });
  expect(pinned.content.rows[1]?.expectedOutput).toEqual({ present: false, value: null });
  expect(Object.hasOwn(pinned.content.rows[0]!.metadata, "__proto__")).toBe(true);
  expect(pinned.content.rows[0]!.metadata["__proto__"]).toEqual({ authored: "kept" });
  await expectNoDatasetWrites(owned);
  const accepted = await save(page); expect(accepted.value.replayed).toBe(false);
  const record = accepted.value.record; expect(record.content).toEqual(pinned.content); expect(record.manifest.previewFingerprint).toBe(pinned.fingerprint);
  expect(accepted.request.postDataJSON()).toEqual({ schemaVersion: "custom-dataset-save-v1", draft, expectedPreviewFingerprint: pinned.fingerprint });
  const stored = await expectStored(owned, record);
  expect(stored.counts).toEqual({ ...emptyCounts(), datasets: 1, versions: 1, rows: 2, datasetAudits: 1 });
  await openVersion(page, owned, record);
  expect(JSON.parse((await page.getByLabel("Saved dataset input for Alpha", { exact: true }).textContent())!)).toEqual(record.snapshot.rows[0]?.input);
  expect(JSON.parse((await page.getByLabel("Saved dataset reference for Alpha", { exact: true }).textContent())!)).toBeNull();
  await page.reload(); await readVersion(page, owned, record);
  let scoringWrites = 0, sourceLoads = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/v1/provided-output-runs")) scoringWrites += 1;
    if (request.method() === "GET" && path === "/api/v1/provided-output-runs/sources") sourceLoads += 1;
  });
  await page.getByRole("link", { name: "Score this saved version", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Score supplied outputs", exact: true })).toBeVisible();
  await expect(page.getByLabel("Dataset version ID", { exact: true })).toHaveValue(record.snapshot.version.id);
  await expect(page.getByLabel("Custom Eval Set version ID", { exact: true })).toHaveValue("");
  expect(scoringWrites).toBe(0); expect(sourceLoads).toBe(0); expect((await owned.snapshot()).counts.runs).toBe(0);
  const evalSetId = await owned.seedEvalSet();
  await page.getByLabel("Custom Eval Set version ID", { exact: true }).fill(evalSetId);
  const load = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/provided-output-runs/sources");
  await page.getByRole("button", { name: "Load selected versions", exact: true }).click(); expect((await load).status()).toBe(200);
  for (const key of ["Alpha", "Beta"]) {
    await expect(page.getByLabel(`Actual output for ${key}`, { exact: true })).toHaveValue("");
    await page.getByLabel(`Actual output for ${key}`, { exact: true }).fill(`APPROVED authored ${key}`);
  }
  const runPreview = await capturePost<unknown>(page, "/api/v1/provided-output-runs/preview", () => page.getByRole("button", { name: "Preview pinned run", exact: true }).click());
  expect(runPreview.status).toBe(200);
  expect((await owned.snapshot()).counts.runs).toBe(0);
  const runResponse = await capturePost<{ record: ProvidedOutputRunRecord }>(page, "/api/v1/provided-output-runs", () => page.getByRole("button", { name: "Run deterministic checks", exact: true }).click());
  expect(runResponse.status).toBe(201);
  const result = runResponse.value.record;
  expect(result.plan.dataset).toEqual(record.snapshot); expect(result.execution.gates.every(gate => gate.passed)).toBe(true);
  const scored = await owned.snapshot();
  expect(scored.counts).toEqual({ datasets: 1, versions: 1, rows: 2, datasetAudits: 1, plans: 1, runs: 1, samples: 2, results: 2, gates: 11, runAudits: 1, evalSets: 1, evalItems: 1 });
  expect(scored.runs).toEqual([result]); await owned.attachSnapshot("desktop-upload-save-reload-explicit-scoring");
});

test("CD-BR02 a lost committed save replays the identical request after a later dataset head", async ({ page, owned }) => {
  await open(page, owned); const original = rows("lost-response-first"); await edit(page, original, "Authored exact retry dataset");
  const { pinned } = await preview(page); const bodies: string[] = [];
  let complete!: (value: { status?: number; value?: CustomDatasetSaveResult; error?: string }) => void;
  const committed = new Promise<{ status?: number; value?: CustomDatasetSaveResult; error?: string }>(resolve => { complete = resolve; });
  let completeRetry!: (value: { status?: number; value?: CustomDatasetSaveResult; error?: string }) => void;
  const retryResponse = new Promise<{ status?: number; value?: CustomDatasetSaveResult; error?: string }>(resolve => { completeRetry = resolve; });
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    bodies.push(route.request().postData() ?? "");
    const firstRequest = bodies.length === 1;
    try {
      const real = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      const body = await real.body();
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as CustomDatasetSaveResult;
      if (firstRequest) complete({ status: real.status(), value });
      else { await route.fulfill({ response: real, body }); completeRetry({ status: real.status(), value }); }
    } catch (error) {
      (firstRequest ? complete : completeRetry)({ error: error instanceof Error ? error.name : "real_fetch_failed" });
      if (!firstRequest) await route.abort("failed").catch(() => undefined);
    } finally { if (firstRequest) await route.abort("connectionreset"); }
  });
  await page.getByRole("button", { name: "Save immutable version", exact: true }).click();
  const real = await committed; expect(real.error).toBeUndefined(); expect(real.status).toBe(201);
  const first = real.value!.record; expect(first.content).toEqual(pinned.content); expect(real.value!.replayed).toBe(false);
  await expect(page.locator('p[role="alert"]')).toContainText("The save outcome is unknown.");
  await expect(source(page)).toHaveJSProperty("readOnly", true); await expect(source(page)).toHaveValue(original);
  await expect(upload(page)).toBeDisabled(); await expect(format(page)).toBeDisabled(); await expect(review(page)).toBeDisabled();
  await expectStored(owned, first);
  const later = await owned.append(first, rows("later-head-before-retry")); expect(later.content.version.version).toBe(2);
  await page.getByRole("button", { name: "Retry unchanged save", exact: true }).click();
  const retried = await retryResponse; expect(retried.error).toBeUndefined(); expect(retried.status).toBe(200);
  expect(retried.value!.replayed).toBe(true); expect(retried.value!.record).toEqual(first);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  await expect(page.locator('p[role="status"]')).toContainText("Recovered the existing immutable version.");
  const stored = await expectStored(owned, first); await expectStored(owned, later);
  expect(stored.counts).toEqual({ ...emptyCounts(), datasets: 1, versions: 2, rows: 4, datasetAudits: 2 });
  await openVersion(page, owned, first); await page.reload(); await readVersion(page, owned, first);
  await owned.attachSnapshot("lost-committed-save-identical-replay-after-later-head");
});

test("CD-BR03 stale-head refusal retains text until a visible head review and fresh append intent", async ({ page, owned }) => {
  const first = await owned.saveDataset(rows("initial-head"), "Authored stale-head dataset");
  const document = await page.goto(`${owned.baseUrl}/evals/datasets/${first.content.dataset.publicId}`); expect(document?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Saved custom dataset", exact: true })).toBeVisible();
  await expect(name(page)).toHaveJSProperty("readOnly", true);
  const preserved = rows("preserved-client-draft"); await source(page).fill(preserved);
  const stale = await preview(page); expect(stale.draft.version).toBe(2); expect(stale.draft.expectedVersionId).toBe(first.content.version.publicId);
  const second = await owned.append(first, rows("other-writer-saved-head"));
  const rejected = await save(page, "Save immutable version", 409);
  expect(rejected.value).toEqual({ error: "custom_dataset_version_conflict" });
  await expect(source(page)).toHaveValue(preserved); await expect(source(page)).toBeEditable();
  await expect(page.getByRole("heading", { name: "Review and explicitly save", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview complete dataset", exact: true })).toBeDisabled();
  expect((await owned.snapshot()).counts.versions).toBe(2);
  const loaded = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `${endpoint}/${first.content.dataset.publicId}`);
  await page.getByRole("button", { name: "Reload current head", exact: true }).click(); expect((await loaded).status()).toBe(200);
  await expect(source(page)).toHaveValue(preserved);
  await page.getByText("Inspect current immutable version", { exact: true }).click();
  const inspected = page.getByLabel("Current saved dataset version", { exact: true }); await expect(inspected).toBeVisible();
  expect(JSON.parse((await inspected.textContent())!)).toEqual(second);
  const acknowledged = page.getByRole("checkbox", { name: "I reviewed the current saved version and want to append my preserved input.", exact: true });
  await expect(acknowledged).not.toBeChecked(); await expect(page.getByRole("button", { name: "Preview complete dataset", exact: true })).toBeDisabled();
  await acknowledged.check(); const fresh = await preview(page);
  expect(fresh.draft.version).toBe(3); expect(fresh.draft.expectedVersionId).toBe(second.content.version.publicId);
  expect(fresh.draft.versionId).not.toBe(stale.draft.versionId); expect(fresh.draft.sourceText).toBe(preserved);
  const accepted = await save(page); const third = accepted.value.record;
  expect(third.content).toEqual(fresh.pinned.content); expect(third.manifest.head?.publicVersionId).toBe(second.content.version.publicId);
  const stored = await expectStored(owned, third); expect(stored.counts.versions).toBe(3); expect(stored.counts.datasetAudits).toBe(3);
  await readVersion(page, owned, first); await readVersion(page, owned, second);
  await page.getByRole("link", { name: "Reload saved dataset and history", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved version history", exact: true })).toBeVisible();
  for (const number of [1, 2, 3]) await expect(page.getByRole("link", { name: `Version ${number}`, exact: true })).toBeVisible();
  await owned.attachSnapshot("stale-head-preserved-text-explicit-review-new-version");
});

test("CD-BR04 explicit declarations, precision, duplicate keys and invalid files never create partial datasets", async ({ page, owned }) => {
  await open(page, owned); await name(page).fill("Authored validation dataset");
  const plain = '[{"rowKey":"Alpha","input":{"prompt":"Authored input"}}]'; await source(page).fill(plain);
  let posts = 0; page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.startsWith(endpoint)) posts += 1; });
  await page.getByRole("button", { name: "Preview complete dataset", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("choose review declarations"); expect(posts).toBe(0); await expectNoDatasetWrites(owned);
  await review(page).selectOption("per-row"); const missing = await refusePreview(page, "custom_dataset_review_status_required");
  expect(missing.rowIndex).toBe(0); expect(missing.line).toBe(1); await expectNoDatasetWrites(owned);
  await review(page).selectOption("synthetic");
  const lossy = '[{"rowKey":"Alpha","input":{"nested":{"unsafe":9007199254740993}}}]'; await source(page).fill(lossy);
  const precision = await refusePreview(page, "custom_dataset_source_precision"); expect(precision.rowIndex).toBe(0); expect(precision.line).toBe(1); expect(precision.column).toBeGreaterThan(0);
  await expect(page.locator('p[role="alert"]')).toContainText("A number would change when saved."); await expect(source(page)).toHaveValue(lossy); await expectNoDatasetWrites(owned);
  const duplicate = '[{"rowKey":"Alpha","input":{"key":1,"key":2}}]'; await source(page).fill(duplicate);
  const duplicateError = await refusePreview(page, "custom_dataset_source_duplicate_key"); expect(duplicateError.rowIndex).toBe(0); expect(duplicateError.line).toBe(1);
  await expect(source(page)).toHaveValue(duplicate); await expectNoDatasetWrites(owned);
  const actual = '[{"rowKey":"Alpha","input":"Authored","output":"Actual response belongs in scoring"}]'; await source(page).fill(actual);
  await refusePreview(page, "custom_dataset_row_invalid"); await expectNoDatasetWrites(owned);
  const beforeFiles = posts;
  await upload(page).setInputFiles({ name: "authored-invalid-utf8.json", mimeType: "application/json", buffer: Buffer.from([0xc3, 0x28]) });
  await expect(page.locator('p[role="alert"]')).toContainText("strict UTF-8 within 2 MiB"); await expect(source(page)).toHaveValue(actual); expect(posts).toBe(beforeFiles);
  await upload(page).setInputFiles({ name: "authored-too-large.json", mimeType: "application/json", buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0x20) });
  await expect(page.locator('p[role="alert"]')).toContainText("strict UTF-8 within 2 MiB"); await expect(source(page)).toHaveValue(actual); expect(posts).toBe(beforeFiles);
  await expectNoDatasetWrites(owned); await owned.attachSnapshot("validation-and-strict-file-boundaries-zero-writes");
});

test("CD-BR05 narrow saved-data flow preserves viewer access and hides private metadata from valid project keys", async ({ page, browser, owned }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, owned);
  const text = rows("narrow-private-data"); await edit(page, text, "Authored private narrow dataset"); await layout(page);
  const pinned = await preview(page); await layout(page); await expectNoDatasetWrites(owned);
  const accepted = await save(page); const record = accepted.value.record; expect(record.content).toEqual(pinned.pinned.content);
  await expectStored(owned, record);
  const legacy = await owned.seedLegacyDataset(); const beforeAccess = (await owned.snapshot()).counts;
  const viewer = await owned.viewerContext(browser); const viewerPage = await viewer.newPage();
  const viewed = await viewerPage.goto(`${owned.baseUrl}/evals/datasets/${record.content.dataset.publicId}`); expect(viewed?.status()).toBe(200);
  await expect(viewerPage.getByRole("heading", { name: "Saved custom dataset", exact: true })).toBeVisible();
  const viewerPinned = await preview(viewerPage); expect(viewerPinned.draft.version).toBe(2);
  await expect(viewerPage.getByRole("button", { name: "Save immutable version", exact: true })).toBeDisabled();
  const deniedViewer = await viewer.request.post(`${owned.baseUrl}${endpoint}`, { maxRedirects: 0, headers: { "Content-Type": "application/json" }, data: "{" });
  expect(deniedViewer.status()).toBe(403); expect((await deniedViewer.json()).error).toBe("workspace_role_forbidden:editor");
  const viewerRecord = await viewer.request.get(`${owned.baseUrl}${endpoint}/${record.content.dataset.publicId}/versions/${record.content.version.publicId}`, { maxRedirects: 0 });
  expect(viewerRecord.status()).toBe(200); expect(await viewerRecord.json()).toEqual({ record });
  const keyHeaders = { Authorization: `Bearer ${owned.apiKey}`, "Content-Type": "application/json" };
  const broadResponse = await page.context().request.get(`${owned.baseUrl}/api/v1/benchmarks`, { maxRedirects: 0, headers: keyHeaders });
  expect(broadResponse.status()).toBe(200); const broad = await broadResponse.json();
  expect(broad.datasets.map((dataset: { id: string }) => dataset.id)).toEqual([legacy.id]);
  expect(broad.datasets[0].name).toBe(legacy.name); expect(broad.datasets[0].versions.map((version: { id: string }) => version.id)).toContain(legacy.versionId);
  for (const privateValue of [record.content.dataset.id, record.content.dataset.publicId, record.snapshot.version.id, record.content.dataset.name]) expect(JSON.stringify(broad)).not.toContain(privateValue);
  for (const path of [endpoint, `${endpoint}/${record.content.dataset.publicId}`, `${endpoint}/${record.content.dataset.publicId}/versions/${record.content.version.publicId}`]) {
    const denied = await page.context().request.get(`${owned.baseUrl}${path}`, { maxRedirects: 0, headers: keyHeaders });
    expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("custom_eval_workspace_session_required");
  }
  for (const path of [endpoint, `${endpoint}/preview`]) {
    const denied = await page.context().request.post(`${owned.baseUrl}${path}`, { maxRedirects: 0, headers: keyHeaders, data: "{" });
    expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("custom_eval_workspace_session_required");
  }
  expect((await owned.snapshot()).counts).toEqual(beforeAccess);
  await openVersion(page, owned, record);
  const size = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(size.root).toBeLessThanOrEqual(size.viewport + 1); expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
  await owned.attachSnapshot("narrow-viewer-and-project-key-private-metadata-boundary");
});
