import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { AnyHttpEvalPlanPreview, AnyHttpEvalPlanVersionRecord, AnyHttpEvalRunRecord, CustomEvalItemPreviewV2, CustomEvalItemVersionRecordV2, CustomEvalSetPreviewV2, CustomEvalSetVersionRecordV2 } from "@open-evals/core";
import { test, expect, type OwnedCompositionFixture } from "./eval-composition.browser.fixture";

type Capture<T> = { status: number; value: T; requestBody: string };
async function capturePost<T>(page: Page, path: string, action: () => Promise<unknown>): Promise<Capture<T>> {
  let complete!: (value: Capture<T> | { error: unknown }) => void;
  const result = new Promise<Capture<T> | { error: unknown }>(resolve => { complete = resolve; });
  const match = (url: URL) => url.pathname === path;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 25000 });
      const body = await response.body(); expect(body.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 4096);
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T;
      await route.fulfill({ response, body }); complete({ status: response.status(), value, requestBody: route.request().postData()! });
    } catch (error) { complete({ error }); await route.abort("failed").catch(() => undefined); }
  };
  await page.route(match, handler);
  try { await action(); const observed = await result; if ("error" in observed) throw observed.error; return observed; }
  finally { await page.unroute(match, handler); }
}
const itemRef = (item: CustomEvalItemVersionRecordV2) => ({ itemId: item.draft.itemId, versionId: item.draft.versionId, fingerprint: item.contract.fingerprint });
const sorted = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
function unchangedCalls(owned: OwnedCompositionFixture, before: unknown) { expect(owned.journal()).toEqual(before); }
async function uiItem(page: Page, name: string, contains: string) {
  const editor = page.getByRole("region", { name: "Reusable Eval Item editor", exact: true });
  await editor.getByLabel("Item name", { exact: true }).fill(name); await editor.getByLabel("Text the output must contain", { exact: true }).fill(contains);
  const preview = await capturePost<{ preview: CustomEvalItemPreviewV2 }>(page, "/api/v2/eval-items/preview", () => editor.getByRole("button", { name: "Preview item without saving", exact: true }).click());
  expect(preview.status).toBe(200); expect(preview.value.preview.draft.contains).toBe(contains);
  const result = await capturePost<{ record: CustomEvalItemVersionRecordV2; replayed: boolean }>(page, "/api/v2/eval-items", () => editor.getByRole("button", { name: "Save immutable item version", exact: true }).click());
  expect(result.status).toBe(201); expect(result.value.replayed).toBe(false); expect(result.value.record.previewFingerprint).toBe(preview.value.preview.fingerprint); return result.value.record;
}
async function uiSet(page: Page, name: string, items: CustomEvalItemVersionRecordV2[]) {
  const editor = page.getByRole("region", { name: "Composed Eval Set editor", exact: true });
  await editor.getByLabel("Set name", { exact: true }).fill(name);
  for (const item of items) await editor.getByLabel("Add an exact saved item version", { exact: true }).selectOption(`${item.draft.itemId}/${item.draft.versionId}`);
  await expect(editor.getByLabel("Add an exact saved item version", { exact: true }).getByRole("option", { name: `${items[0]!.draft.name} · version ${items[0]!.draft.version}`, exact: true })).toBeDisabled();
  await editor.getByLabel("Dataset pass-rate gate (%)", { exact: true }).fill("0");
  const preview = await capturePost<{ preview: CustomEvalSetPreviewV2 }>(page, "/api/v2/eval-sets/preview", () => editor.getByRole("button", { name: "Preview set without saving", exact: true }).click());
  expect(preview.status).toBe(200); expect(preview.value.preview.draft.members).toEqual(items.map(itemRef));
  const saved = await capturePost<{ record: CustomEvalSetVersionRecordV2; replayed: boolean }>(page, "/api/v2/eval-sets", () => editor.getByRole("button", { name: "Save immutable set version", exact: true }).click());
  expect(saved.status).toBe(201); expect(saved.value.record.previewFingerprint).toBe(preview.value.preview.fingerprint); return saved.value.record;
}

test("CP-BR01 UI reusable items and overlapping sets execute two authored transport calls with six results, critical scopes and no replay dispatch", async ({ page, owned }) => {
  await page.goto(`${owned.baseUrl}/evals/composition`); const items: CustomEvalItemVersionRecordV2[] = [];
  for (const contains of ["red", "blue", "green"]) {
    if (items.length) await page.getByRole("button", { name: "Create another item", exact: true }).click();
    items.push(await uiItem(page, `${contains} check`, contains));
  }
  const first = await uiSet(page, "Red and blue", items.slice(0, 2));
  await page.getByRole("button", { name: "Create another set", exact: true }).click(); const second = await uiSet(page, "Blue and green", items.slice(1));
  expect(first.members[1]!.evalItemVersionId).toBe(second.members[0]!.evalItemVersionId);
  expect(first.members[1]!.publicItemVersionId).toBe(items[1]!.draft.versionId);
  const before = await owned.snapshot(); expect(before.counts.evalItems).toBe(3); expect(before.counts.itemVersions).toBe(3); expect(before.counts.evalSets).toBe(2); expect(before.counts.memberships).toBe(4); expect(before.counts.runs).toBe(0);
  const journalBefore = owned.journal(), datasetVersionId = await owned.dataset();
  await page.goto(`${owned.baseUrl}/evals/plans?family=composition`);
  await page.getByLabel("Plan name", { exact: true }).fill("Shared B critical composition"); await page.getByLabel("Exact dataset version ID", { exact: true }).fill(datasetVersionId);
  for (const set of [first, second]) await page.getByLabel("Add a recent saved custom evaluator version", { exact: true }).selectOption(`custom-eval-set-ref-v2/${set.draft.setId}/${set.draft.versionId}`);
  await page.getByLabel("Target identity", { exact: true }).fill("authored-composition-target"); await page.getByLabel("Declared target version", { exact: true }).fill("1"); await page.getByLabel("Public HTTPS endpoint", { exact: true }).fill("https://composition-target.example.com/evaluate"); await page.getByLabel("Concurrent calls", { exact: true }).fill("2"); await page.getByLabel("Run duration (seconds)", { exact: true }).fill("15");
  const p = await capturePost<{ preview: AnyHttpEvalPlanPreview }>(page, "/api/v1/http-target-plans/preview", () => page.getByRole("button", { name: "Preview plan without calling target", exact: true }).click());
  expect(p.status).toBe(200); expect(p.value.preview.schemaVersion).toBe("http-eval-plan-preview-v2"); if (p.value.preview.schemaVersion !== "http-eval-plan-preview-v2") throw new Error("v2_preview_required");
  expect(p.value.preview.counts).toEqual({ rowCount: 2, evalSetCount: 2, uniqueItemCount: 3, resultPairs: 6, targetCalls: 2 });
  expect(p.value.preview.content.evalSets.flatMap(set => set.members)).toHaveLength(4); unchangedCalls(owned, journalBefore);
  const saved = await capturePost<{ record: AnyHttpEvalPlanVersionRecord; replayed: boolean }>(page, "/api/v1/http-target-plans", () => page.getByRole("button", { name: "Save immutable plan without executing", exact: true }).click());
  expect(saved.status).toBe(201); const plan = saved.value.record; expect(plan.schemaVersion).toBe("http-eval-plan-record-v2");
  expect((await owned.snapshot()).counts.runs).toBe(0); unchangedCalls(owned, journalBefore);
  await page.getByRole("link", { name: "Open saved plan and execution controls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shared B critical composition · version 1", exact: true })).toBeVisible();
  const executionPath = `/api/v1/http-target-plans/${plan.content.draft.planId}/versions/${plan.content.draft.versionId}/runs`;
  type Start = Capture<{ record: AnyHttpEvalRunRecord; replayed: boolean }>;
  const bodies: string[] = []; let firstDone!: (value: Start | { error: unknown }) => void, retryDone!: (value: Start | { error: unknown }) => void;
  const initialResponse = new Promise<Start | { error: unknown }>(resolve => { firstDone = resolve; }), replayResponse = new Promise<Start | { error: unknown }>(resolve => { retryDone = resolve; });
  const match = (url: URL) => url.pathname === executionPath;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const bodyText = route.request().postData()!; bodies.push(bodyText); const initial = bodies.length === 1;
    try {
      const intent = JSON.parse(bodyText); expect(intent.schemaVersion).toBe("http-eval-start-v2"); if (initial) await owned.armTransport(plan, intent.runId);
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 25000 }), body = await response.body(); expect(body.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 4096);
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      if (initial) firstDone({ status: response.status(), value, requestBody: bodyText });
      else { await route.fulfill({ response, body }); retryDone({ status: response.status(), value, requestBody: bodyText }); }
    } catch (error) { (initial ? firstDone : retryDone)({ error }); if (!initial) await route.abort("failed").catch(() => undefined); }
    finally { if (initial) await route.abort("connectionreset"); }
  };
  await page.route(match, handler);
  try {
    await page.getByRole("checkbox", { name: /I authorize this execution/ }).check(); await page.getByRole("button", { name: "Start a new explicit execution", exact: true }).click();
    const initial = await initialResponse; if ("error" in initial) throw initial.error; expect(initial.status).toBe(201); expect(initial.value.replayed).toBe(false); const record = initial.value.record;
    await expect(page.getByRole("alert").filter({ hasText: "execution outcome is unknown" })).toContainText("execution outcome is unknown");
    await page.getByRole("button", { name: "Retry identical execution request", exact: true }).click(); const retry = await replayResponse; if ("error" in retry) throw retry.error;
    expect(retry.status).toBe(200); expect(retry.value.replayed).toBe(true); expect(retry.value.record).toEqual(record); expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(record.ledger.status).toBe("completed"); expect(record.ledger.rows.every(row => row.status === "succeeded")).toBe(true); expect(record.events).toHaveLength(2);
    expect(record.execution.results).toHaveLength(6); expect(new Set(record.execution.results.map(result => `${result.rowId}/${result.evalItemVersionId}`)).size).toBe(6); expect(record.execution.gates).toHaveLength(20);
    expect(new Set(record.execution.gates.map(gate => gate.level))).toEqual(new Set(["field", "item_row", "row", "dataset", "eval_set", "target", "criticality", "run"]));
    const shared = record.execution.results.filter(result => result.evalItemVersionId === items[1]!.storage.versionId); expect(shared).toHaveLength(2);
    for (const set of [first, second]) { const gate = record.execution.gates.find(gate => gate.level === "eval_set" && gate.scopeId === set.storage.versionId)!; expect(gate.passed).toBe(false); for (const result of shared) expect(gate.sourceResultIds).toContain(result.id); }
    expect(record.execution.gates.find(gate => gate.level === "dataset")?.passed).toBe(false); expect(record.execution.gates.find(gate => gate.level === "run")?.passed).toBe(false);
    const transport = owned.journal(), calls = transport.filter(entry => entry.phase === "committed_claim_before_authored_response");
    expect(calls).toHaveLength(2); expect(transport.filter(entry => entry.phase === "authored_dns")).toHaveLength(2); expect(new Set(calls.map(call => call.requestFingerprint)).size).toBe(2);
    for (const call of calls) { expect(call.idempotencyKey).toBe(call.requestFingerprint); expect(call.nativeDnsSocketTlsChecked).toBe(false); expect(call.actualExternalTargetCalls).toBe(0); expect(record.events.find(event => event.rowId === call.rowId)?.rawResponseHash).toBe(call.responseBodySha256); }
    const stored = await owned.snapshot(); expect(stored.counts.runs).toBe(1); expect(stored.counts.samples).toBe(2); expect(stored.claims).toHaveLength(2); expect(stored.counts.results).toBe(6); expect(stored.counts.gates).toBe(20); expect(stored.counts.events).toBe(5);
    expect(sorted(stored.results as Array<{ id: string }>)).toEqual(sorted(record.execution.results)); expect(sorted(stored.gates as Array<{ id: string }>)).toEqual(sorted(record.execution.gates));
    expect(new Set(stored.claims.map(claim => claim.claimToken))).toEqual(new Set(calls.map(call => call.claimToken)));
    await expect(page.getByLabel("Actual target output for Álpha 🧪", { exact: true })).toContainText("red blue green"); await expect(page.getByLabel("Actual target output for Beta", { exact: true })).toContainText("red green");
    const beforeReads = owned.journal(); await page.goto(`${owned.baseUrl}/evals/plans/runs/${record.ledger.publicRunId}`); await expect(page.getByText("Execution status: completed", { exact: true })).toBeVisible(); await expect(page.getByText("Run gate: not passed. Missing or uncertain output cannot pass.", { exact: true })).toBeVisible(); await page.reload(); unchangedCalls(owned, beforeReads);
    const read = await page.context().request.get(`${owned.baseUrl}/api/v1/http-target-plans/runs/${record.ledger.publicRunId}`, { maxRedirects: 0 }); expect(read.status()).toBe(200); expect((await read.json()).record).toEqual(record); unchangedCalls(owned, beforeReads);
  } finally { await page.unroute(match, handler); }
});

test("CP-BR02 narrow exact history retains two versions of one item and ordered membership after a new set version", async ({ page, owned }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const journalBefore = owned.journal();
  const first = await owned.saveItem({ name: "Café 家族 🧪", contains: "red" });
  const next = await owned.saveItem({ itemId: first.draft.itemId, version: 2, expectedVersionId: first.draft.versionId, name: "Renamed café β", contains: "green" });
  const blue = await owned.saveItem({ name: "Blue item", contains: "blue" }); const set = await owned.saveSet([first, next, blue], { name: "Ordered café set α" });
  await page.goto(`${owned.baseUrl}/evals/composition/sets/${set.draft.setId}/versions/${set.draft.versionId}`);
  const members = page.getByRole("list", { name: "Saved set item versions", exact: true }); await expect(members.getByRole("link")).toHaveCount(3);
  await members.getByRole("link", { name: "1. Café 家族 🧪", exact: true }).click(); await expect(page.getByRole("heading", { name: "Café 家族 🧪 · version 1", exact: true })).toBeVisible(); await expect(page.getByLabel("Exact saved contains text", { exact: true })).toHaveText("red");
  await page.goto(`${owned.baseUrl}/evals/composition/sets/${set.draft.setId}`); const editor = page.getByRole("region", { name: "Composed Eval Set editor", exact: true });
  await editor.getByLabel("Set name", { exact: true }).fill("Ordered café set β"); await editor.getByRole("button", { name: "Move member 3 up", exact: true }).click();
  const p = await capturePost<{ preview: CustomEvalSetPreviewV2 }>(page, "/api/v2/eval-sets/preview", () => editor.getByRole("button", { name: "Preview set without saving", exact: true }).click()); expect(p.status).toBe(200); expect(p.value.preview.draft.members).toEqual([first, blue, next].map(itemRef));
  const saved = await capturePost<{ record: CustomEvalSetVersionRecordV2 }>(page, "/api/v2/eval-sets", () => editor.getByRole("button", { name: "Save immutable set version", exact: true }).click()); expect(saved.status).toBe(201); expect(saved.value.record.draft.version).toBe(2);
  await page.goto(`${owned.baseUrl}/evals/composition/sets/${set.draft.setId}`); const history = page.getByRole("region", { name: "Immutable composition version history", exact: true }); await expect(history.getByRole("link", { name: "Version 1: Ordered café set α", exact: true })).toBeVisible(); await expect(history.getByRole("link", { name: "Version 2: Ordered café set β", exact: true })).toBeVisible();
  const old = await page.context().request.get(`${owned.baseUrl}/api/v2/eval-sets/${set.draft.setId}/versions/${set.draft.versionId}`, { maxRedirects: 0 }); expect(old.status()).toBe(200); expect((await old.json()).record).toEqual(set);
  const oldItem = await page.context().request.get(`${owned.baseUrl}/api/v2/eval-items/${first.draft.itemId}/versions/${first.draft.versionId}`, { maxRedirects: 0 }); expect(oldItem.status()).toBe(200); expect((await oldItem.json()).record).toEqual(first);
  const legacyDraft = { schemaVersion: "custom-eval-set-draft-v1", setId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Legacy blue check", contains: "blue", datasetPassRateThreshold: 100 };
  const legacySave = await page.context().request.post(`${owned.baseUrl}/api/v1/eval-sets`, { maxRedirects: 0, data: legacyDraft }); expect(legacySave.status()).toBe(201); const legacy = (await legacySave.json()).version;
  const datasetVersionId = await owned.dataset(), legacyPlanDraft = { schemaVersion: "http-eval-plan-draft-v1", planId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Unchanged legacy source plan", datasetVersionId, evalSetVersionIds: [legacy.id], target: { targetId: "authored-legacy-target", targetVersion: "1", endpoint: "https://composition-target.example.com/evaluate", timeoutMs: 5000 }, limits: { concurrency: 1, maxDurationSeconds: 15 } };
  const legacyPreview = await page.context().request.post(`${owned.baseUrl}/api/v1/http-target-plans/preview`, { maxRedirects: 0, data: legacyPlanDraft }); expect(legacyPreview.status()).toBe(200); const lp = (await legacyPreview.json()).preview;
  const legacyPlanSave = await page.context().request.post(`${owned.baseUrl}/api/v1/http-target-plans`, { maxRedirects: 0, data: { schemaVersion: "http-eval-plan-save-v1", draft: lp.draft, expectedPreviewFingerprint: lp.fingerprint } }); expect(legacyPlanSave.status()).toBe(201); const legacyPlan = (await legacyPlanSave.json()).record;
  await page.goto(`${owned.baseUrl}/evals/plans/${legacyPlan.content.draft.planId}`); await page.getByRole("link", { name: "Create a separate reusable-composition plan", exact: true }).click();
  expect(JSON.parse(await page.getByLabel("Exact evaluator-set references (JSON)", { exact: true }).inputValue())).toEqual([{ schemaVersion: "custom-eval-set-ref-v1", setId: legacyDraft.setId, versionId: legacy.id, fingerprint: legacy.contract.fingerprint }]);
  await expect(page.getByLabel("Exact dataset version ID", { exact: true })).toHaveValue(datasetVersionId);
  await page.getByLabel("Add a recent saved custom evaluator version", { exact: true }).selectOption(`custom-eval-set-ref-v2/${set.draft.setId}/${saved.value.record.draft.versionId}`);
  await page.getByLabel("Plan name", { exact: true }).fill("Explicit mixed-source plan"); await page.getByLabel("Target identity", { exact: true }).fill("authored-mixed-target"); await page.getByLabel("Declared target version", { exact: true }).fill("1"); await page.getByLabel("Public HTTPS endpoint", { exact: true }).fill("https://composition-target.example.com/evaluate");
  const mixed = await capturePost<{ preview: AnyHttpEvalPlanPreview }>(page, "/api/v1/http-target-plans/preview", () => page.getByRole("button", { name: "Preview plan without calling target", exact: true }).click()); expect(mixed.status).toBe(200); if (mixed.value.preview.schemaVersion !== "http-eval-plan-preview-v2") throw new Error("v2_preview_required");
  expect(mixed.value.preview.counts).toEqual({ rowCount: 2, evalSetCount: 2, uniqueItemCount: 4, resultPairs: 8, targetCalls: 2 }); expect(mixed.value.preview.draft.planId).not.toBe(legacyPlan.content.draft.planId);
  const unchanged = await page.context().request.get(`${owned.baseUrl}/api/v1/http-target-plans/${legacyPlan.content.draft.planId}/versions/${legacyPlan.content.draft.versionId}`, { maxRedirects: 0 }); expect(unchanged.status()).toBe(200); expect((await unchanged.json()).record).toEqual(legacyPlan);
  const size = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth })); expect(size.root).toBeLessThanOrEqual(size.viewport + 1); expect(size.body).toBeLessThanOrEqual(size.viewport + 1); unchangedCalls(owned, journalBefore); expect((await owned.snapshot()).counts.runs).toBe(0);
});

test("CP-BR03 actual item CAS requires visible head review and a committed set retry replays before a later head", async ({ page, owned }) => {
  const journalBefore = owned.journal(), item = await owned.saveItem({ name: "Original item", contains: "blue" });
  await page.goto(`${owned.baseUrl}/evals/composition/items/${item.draft.itemId}`); const editor = page.getByRole("region", { name: "Reusable Eval Item editor", exact: true }); await editor.getByLabel("Item name", { exact: true }).fill("Preserved authored edit");
  const stale = await capturePost<{ preview: CustomEvalItemPreviewV2 }>(page, "/api/v2/eval-items/preview", () => editor.getByRole("button", { name: "Preview item without saving", exact: true }).click()); expect(stale.status).toBe(200);
  const competing = await owned.saveItem({ itemId: item.draft.itemId, version: 2, expectedVersionId: item.draft.versionId, name: "Concurrent head", contains: "green" });
  const conflict = await capturePost<{ error: string }>(page, "/api/v2/eval-items", () => editor.getByRole("button", { name: "Save immutable item version", exact: true }).click()); expect(conflict.status).toBe(409);
  await expect(editor.getByRole("alert").filter({ hasText: "Your text and member references are preserved" })).toContainText("Your text and member references are preserved"); await expect(editor.getByLabel("Item name", { exact: true })).toHaveValue("Preserved authored edit"); await expect(editor.getByLabel("Text the output must contain", { exact: true })).toHaveValue("blue"); await expect(editor.getByRole("button", { name: "Preview item without saving", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Reload current head", exact: true }).click(); const review = editor.getByRole("checkbox", { name: /I reviewed the current head/ }); await expect(review).toBeVisible(); await expect(review).toBeDisabled();
  await editor.getByText("Inspect complete current head before another intent", { exact: true }).click(); expect(JSON.parse(await editor.getByLabel("Complete current composition head", { exact: true }).innerText())).toEqual(competing); await review.check();
  const fresh = await capturePost<{ preview: CustomEvalItemPreviewV2 }>(page, "/api/v2/eval-items/preview", () => editor.getByRole("button", { name: "Preview item without saving", exact: true }).click()); expect(fresh.status).toBe(200); expect(fresh.value.preview.draft.version).toBe(3); expect(fresh.value.preview.draft.expectedVersionId).toBe(competing.draft.versionId); expect(fresh.value.preview.draft.versionId).not.toBe(stale.value.preview.draft.versionId);
  const third = await capturePost<{ record: CustomEvalItemVersionRecordV2 }>(page, "/api/v2/eval-items", () => editor.getByRole("button", { name: "Save immutable item version", exact: true }).click()); expect(third.status).toBe(201); expect(third.value.record.draft.name).toBe("Preserved authored edit");
  await page.goto(`${owned.baseUrl}/evals/composition?itemId=${item.draft.itemId}&itemVersionId=${item.draft.versionId}`); const setEditor = page.getByRole("region", { name: "Composed Eval Set editor", exact: true }); await setEditor.getByLabel("Set name", { exact: true }).fill("Unknown immutable set save");
  const p = await capturePost<{ preview: CustomEvalSetPreviewV2 }>(page, "/api/v2/eval-sets/preview", () => setEditor.getByRole("button", { name: "Preview set without saving", exact: true }).click()); expect(p.status).toBe(200); expect(p.value.preview.draft.members).toEqual([itemRef(item)]);
  type Saved = Capture<{ record: CustomEvalSetVersionRecordV2; replayed: boolean }> & { later?: CustomEvalSetVersionRecordV2 };
  let firstDone!: (value: Saved | { error: unknown }) => void, retryDone!: (value: Saved | { error: unknown }) => void; const firstResponse = new Promise<Saved | { error: unknown }>(resolve => { firstDone = resolve; }), retryResponse = new Promise<Saved | { error: unknown }>(resolve => { retryDone = resolve; });
  const bodies: string[] = [], match = (url: URL) => url.pathname === "/api/v2/eval-sets";
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; } bodies.push(route.request().postData()!); const first = bodies.length === 1;
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 25000 }), body = await response.body(); expect(body.length).toBeLessThanOrEqual(2 * 1024 * 1024); const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      if (first) { expect(response.status()).toBe(201); const later = await owned.saveSet([item], { setId: value.record.draft.setId, version: 2, expectedVersionId: value.record.draft.versionId, name: "Later saved head" }); firstDone({ status: response.status(), value, requestBody: bodies[0]!, later }); }
      else { await route.fulfill({ response, body }); retryDone({ status: response.status(), value, requestBody: bodies[1]! }); }
    } catch (error) { (first ? firstDone : retryDone)({ error }); if (!first) await route.abort("failed").catch(() => undefined); }
    finally { if (first) await route.abort("connectionreset"); }
  };
  await page.route(match, handler);
  try {
    await setEditor.getByRole("button", { name: "Save immutable set version", exact: true }).click(); const first = await firstResponse; if ("error" in first) throw first.error; expect(first.status).toBe(201);
    await expect(setEditor.getByRole("alert").filter({ hasText: "save outcome is unknown" })).toContainText("save outcome is unknown"); await expect(setEditor.getByLabel("Set name", { exact: true })).toHaveAttribute("readonly", "");
    await setEditor.getByRole("button", { name: "Retry identical set save", exact: true }).click(); const replay = await retryResponse; if ("error" in replay) throw replay.error; expect(replay.status).toBe(200); expect(replay.value.replayed).toBe(true); expect(replay.value.record).toEqual(first.value.record); expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    const current = await page.context().request.get(`${owned.baseUrl}/api/v2/eval-sets/${first.value.record.draft.setId}`, { maxRedirects: 0 }); expect(current.status()).toBe(200); const value = await current.json(); expect(value.record).toEqual(first.later); expect(value.detail.head.version).toBe(2);
    const stored = await owned.snapshot(); expect(stored.counts.evalItems).toBe(1); expect(stored.counts.itemVersions).toBe(3); expect(stored.counts.evalSets).toBe(1); expect(stored.counts.setVersions).toBe(2); expect(stored.counts.runs).toBe(0); unchangedCalls(owned, journalBefore);
  } finally { await page.unroute(match, handler); }
});

test("CP-BR04 real viewer, key and foreign workspace boundaries reject writes before malformed bodies and preserve scoped metadata", async ({ page, browser, owned }) => {
  const journalBefore = owned.journal(), item = await owned.saveItem(), set = await owned.saveSet([item]), plan = await owned.savePlan([set], await owned.dataset()); const before = (await owned.snapshot()).counts;
  const viewer = await owned.viewerContext(browser), viewed = await viewer.newPage(); await viewed.goto(`${owned.baseUrl}/evals/composition/sets/${set.draft.setId}`);
  await expect(viewed.getByLabel("Set name", { exact: true })).toHaveAttribute("readonly", ""); const p = await capturePost<{ preview: CustomEvalSetPreviewV2 }>(viewed, "/api/v2/eval-sets/preview", () => viewed.getByRole("button", { name: "Preview set without saving", exact: true }).click()); expect(p.status).toBe(200); await expect(viewed.getByRole("button", { name: "Save immutable set version", exact: true })).toBeDisabled();
  const execution = `/api/v1/http-target-plans/${plan.content.draft.planId}/versions/${plan.content.draft.versionId}/runs`;
  for (const path of ["/api/v2/eval-items", "/api/v2/eval-sets", execution, `/api/v1/http-target-plans/runs/${randomUUID()}/recover`]) { const denied = await viewer.request.post(`${owned.baseUrl}${path}`, { data: "{", headers: { "Content-Type": "application/json" }, maxRedirects: 0 }); expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("workspace_role_forbidden:editor"); }
  const headers = { Authorization: `Bearer ${owned.apiKey}` }; const control = await page.context().request.get(`${owned.baseUrl}/api/v1/benchmarks`, { headers, maxRedirects: 0 }); expect(control.status()).toBe(200);
  for (const path of ["/api/v2/eval-items", "/api/v2/eval-sets", `/api/v2/eval-items/${item.draft.itemId}/versions/${item.draft.versionId}`, `/api/v2/eval-sets/${set.draft.setId}/versions/${set.draft.versionId}`, "/api/v1/http-target-plans", `/api/v1/http-target-plans/runs/${randomUUID()}`]) { const denied = await page.context().request.get(`${owned.baseUrl}${path}`, { headers, maxRedirects: 0 }); expect(denied.status()).toBe(403); expect((await denied.json()).error).toBe("custom_eval_workspace_session_required"); }
  for (const path of ["/api/v2/eval-items/preview", "/api/v2/eval-sets/preview", "/api/v2/eval-items", "/api/v2/eval-sets"]) { const denied = await page.context().request.post(`${owned.baseUrl}${path}`, { headers: { ...headers, "Content-Type": "application/json" }, data: "{", maxRedirects: 0 }); expect(denied.status()).toBe(403); }
  const foreign = await owned.foreignContext(browser);
  for (const path of [`/api/v2/eval-items/${item.draft.itemId}/versions/${item.draft.versionId}`, `/api/v2/eval-sets/${set.draft.setId}/versions/${set.draft.versionId}`, `/api/v1/http-target-plans/${plan.content.draft.planId}/versions/${plan.content.draft.versionId}`]) { const missing = await foreign.request.get(`${owned.baseUrl}${path}`, { maxRedirects: 0 }); expect(missing.status()).toBe(404); }
  const foreignPreview = await foreign.request.post(`${owned.baseUrl}/api/v2/eval-sets/preview`, { maxRedirects: 0, data: { ...set.draft, setId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null } }); expect(foreignPreview.status()).toBe(404);
  const validDraft = { ...set.draft, versionId: randomUUID(), version: 2, expectedVersionId: set.draft.versionId }, validJson = JSON.stringify(validDraft);
  const duplicate = validJson.replace('"name":', '"name":"shadowed duplicate","name":');
  const precision = validJson.replace('"datasetPassRateThreshold":0', '"datasetPassRateThreshold":0.100000000000000005');
  expect(duplicate).not.toBe(validJson); expect(precision).not.toBe(validJson);
  // Both otherwise-complete drafts would preview successfully under a lossy JSON.parse.
  for (const source of [duplicate, precision]) { const rejected = await page.context().request.post(`${owned.baseUrl}/api/v2/eval-sets/preview`, { maxRedirects: 0, headers: { "Content-Type": "application/json" }, data: source }); expect(rejected.status()).toBe(422); }
  const invalidUtf8 = await page.context().request.post(`${owned.baseUrl}/api/v2/eval-items/preview`, { maxRedirects: 0, headers: { "Content-Type": "application/json" }, data: Buffer.from([0xff]) }); expect(invalidUtf8.status()).toBe(400);
  expect((await owned.snapshot()).counts).toEqual(before); unchangedCalls(owned, journalBefore);
  const all = owned.journal(); expect(all.filter(entry => entry.phase === "committed_claim_before_authored_response")).toHaveLength(2); expect(all.filter(entry => entry.phase === "authored_dns")).toHaveLength(2); expect(all.every(entry => ["guard_ready", "authored_dns", "committed_claim_before_authored_response"].includes(entry.phase))).toBe(true);
});
