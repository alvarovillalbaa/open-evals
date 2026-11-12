// T3: owned disposable SQL, production app routes, authored transport only.
import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { CustomEvalItemVersionRecordV3, CustomEvalSetVersionRecordV3, MatchingEvalItemRecord, AnyHttpEvalPlanVersionRecord, AnyHttpEvalRunRecord } from "@open-evals/core";
import { test, expect, type OwnedCompositionFixture } from "./eval-matching.browser.fixture";

async function capture<T>(page: Page, path: string, action: () => Promise<unknown>) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST");
  await action(); const response = await pending;
  return { status: response.status(), value: await response.json() as T, body: response.request().postData()! };
}
async function exact(page: Page, expected = "APPROVED"): Promise<CustomEvalItemVersionRecordV3> {
  const draft = { schemaVersion: "custom-eval-item-draft-v3", itemId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Exact acceptance", expected };
  const preview = await page.context().request.post("/api/v3/eval-items/preview", { data: draft }); expect(preview.status()).toBe(200);
  const saved = await page.context().request.post("/api/v3/eval-items", { data: { schemaVersion: "custom-eval-item-save-v3", draft, expectedPreviewFingerprint: (await preview.json()).preview.fingerprint } });
  expect(saved.status()).toBe(201); return (await saved.json()).record;
}
async function mixed(page: Page, items: MatchingEvalItemRecord[]): Promise<CustomEvalSetVersionRecordV3> {
  const draft = { schemaVersion: "custom-eval-set-draft-v3", setId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Mixed acceptance", datasetPassRateThreshold: 0,
    members: items.map(item => ({ schemaVersion: item.schemaVersion === "custom-eval-item-record-v2" ? "custom-eval-item-ref-v2" : "custom-eval-item-ref-v3", itemId: item.draft.itemId, versionId: item.draft.versionId, fingerprint: item.contract.fingerprint })) };
  const preview = await page.context().request.post("/api/v3/eval-sets/preview", { data: draft }); expect(preview.status()).toBe(200);
  const saved = await page.context().request.post("/api/v3/eval-sets", { data: { schemaVersion: "custom-eval-set-save-v3", draft, expectedPreviewFingerprint: (await preview.json()).preview.fingerprint } });
  expect(saved.status()).toBe(201); return (await saved.json()).record;
}
const refValue = (record: MatchingEvalItemRecord) => `${record.schemaVersion === "custom-eval-item-record-v2" ? "custom-eval-item-ref-v2" : "custom-eval-item-ref-v3"}/${record.draft.itemId}/${record.draft.versionId}`;
async function untouchedTransport(owned: OwnedCompositionFixture, before: unknown) { expect(owned.journal()).toEqual(before); }

test("XM-BR01 desktop exact authoring recovers a committed unknown save through identical retry", async ({ page, owned }, info) => {
  await page.goto("/evals/matching"); const item = page.getByRole("region", { name: "Reusable Eval Item editor", exact: true });
  await item.getByLabel("Item name", { exact: true }).fill("Literal café"); await item.getByLabel("Exact text the output must equal", { exact: true }).fill(" APPROVED\n");
  const before = await owned.snapshot(), journal = owned.journal();
  const preview = await capture<{ preview: unknown }>(page, "/api/v3/eval-items/preview", () => item.getByRole("button", { name: "Preview item without saving", exact: true }).click());
  expect(preview.status).toBe(200); expect((await owned.snapshot()).counts).toEqual(before.counts);
  const bodies: string[] = []; let accepted!: CustomEvalItemVersionRecordV3;
  const match = (url: URL) => url.pathname === "/api/v3/eval-items";
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    bodies.push(route.request().postData()!); const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 }); const value = await response.json();
    if (bodies.length === 1) { expect(response.status()).toBe(201); accepted = value.record; await route.abort("connectionreset"); }
    else { expect(response.status()).toBe(200); expect(value.replayed).toBe(true); expect(value.record).toEqual(accepted); await route.fulfill({ response }); }
  };
  await page.route(match, handler);
  try {
    await item.getByRole("button", { name: "Save immutable item version", exact: true }).click();
    await expect(item.getByRole("alert")).toContainText("save outcome is unknown"); await expect(item.getByLabel("Exact text the output must equal", { exact: true })).toHaveAttribute("readonly", "");
    await item.getByRole("button", { name: "Retry identical item save", exact: true }).click(); await expect(item.getByRole("status")).toContainText("Recovered the exact existing version");
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(accepted.draft.expected).toBe(" APPROVED\n"); expect((await owned.snapshot()).counts.itemVersions).toBe(1);
    await item.getByRole("link", { name: "Open exact saved item version", exact: true }).click(); await expect(page.getByLabel("Exact saved expected text", { exact: true })).toHaveText(" APPROVED\n");
    await page.screenshot({ path: info.outputPath("desktop-exact.png") }); await untouchedTransport(owned, journal);
  } finally { await page.unroute(match, handler); }
});

test("XM-BR02 narrow mixed membership retains both families and exact history after reorder", async ({ page, owned }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); const old = await owned.saveItem({ contains: "APPROVED" }), equal = await exact(page), journal = owned.journal();
  await page.goto("/evals/matching"); const editor = page.getByRole("region", { name: "Composed Eval Set editor", exact: true });
  await editor.getByLabel("Set name", { exact: true }).fill("Mobile mixed acceptance");
  for (const record of [old, equal]) await editor.getByLabel("Add an exact saved item version", { exact: true }).selectOption(refValue(record));
  await editor.getByRole("button", { name: "Move member 2 up", exact: true }).click();
  const preview = await capture<{ preview: { members: Array<{ itemSchemaVersion: string }> } }>(page, "/api/v3/eval-sets/preview", () => editor.getByRole("button", { name: "Preview set without saving", exact: true }).click());
  expect(preview.status).toBe(200); expect(preview.value.preview.members.map(m => m.itemSchemaVersion)).toEqual(["custom-eval-item-v3", "custom-eval-item-v2"]);
  const saved = await capture<{ record: CustomEvalSetVersionRecordV3 }>(page, "/api/v3/eval-sets", () => editor.getByRole("button", { name: "Save immutable set version", exact: true }).click());
  expect(saved.status).toBe(201); const first = saved.value.record;
  await editor.getByRole("link", { name: "Open exact saved set version", exact: true }).click(); await expect(page.getByLabel("Saved set item versions", { exact: true }).getByRole("listitem")).toHaveCount(2);
  const response = await page.context().request.get(`/api/v3/eval-sets/${first.draft.setId}/versions/${first.draft.versionId}`); expect(response.status()).toBe(200); expect((await response.json()).record).toEqual(first);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath("mobile-mixed.png") }); await page.reload();
  await expect(page.getByText("Mobile mixed acceptance · version 1", { exact: true })).toBeVisible(); await untouchedTransport(owned, journal);
});

test("XM-BR03 actual viewer project-key and foreign-workspace policy protects matching routes", async ({ page, browser, owned }, info) => {
  const record = await exact(page), before = await owned.snapshot(), journal = owned.journal(), viewer = await owned.viewerContext(browser), foreign = await owned.foreignContext(browser);
  for (const kind of ["eval-items", "eval-sets"]) {
    const denied = await viewer.request.post(`/api/v3/${kind}`, { headers: { "Content-Type": "application/json" }, data: "{malformed" }); expect(denied.status()).toBe(403);
    const key = await page.context().request.post(`/api/v3/${kind}`, { headers: { Authorization: `Bearer ${owned.apiKey}`, "Content-Type": "application/json" }, data: "{malformed" }); expect(key.status()).toBe(403);
  }
  const path = `/api/v3/eval-items/${record.draft.itemId}/versions/${record.draft.versionId}`;
  expect((await foreign.request.get(path)).status()).toBe(404); expect((await viewer.request.get(path)).status()).toBe(200);
  const inspect = await viewer.newPage(); await inspect.goto(`/evals/matching/items/${record.draft.itemId}`); await expect(inspect.getByLabel("Item name", { exact: true })).toHaveAttribute("readonly", "");
  await inspect.screenshot({ path: info.outputPath("viewer-inspection.png") }); expect((await owned.snapshot()).counts).toEqual(before.counts); await untouchedTransport(owned, journal);
});

test("XM-BR04 production execution scores mixed sets once per row and reload never redispatches", async ({ page, owned }, info) => {
  const old = await owned.saveItem({ contains: "APPROVED" }), equal = await exact(page), mixedSet = await mixed(page, [old, equal]), containsSet = await owned.saveSet([old], { datasetPassRateThreshold: 0 });
  const datasetVersionId = await owned.dataset(), journal = owned.journal();
  await page.goto("/evals/plans?family=matching");
  await page.getByLabel("Plan name", { exact: true }).fill("Matching UI acceptance");
  await page.getByLabel("Exact dataset version ID", { exact: true }).fill(datasetVersionId);
  await page.getByLabel("Add a recent saved custom evaluator version", { exact: true }).selectOption(`custom-eval-set-ref-v2/${containsSet.draft.setId}/${containsSet.draft.versionId}`);
  await page.getByLabel("Add a recent saved custom evaluator version", { exact: true }).selectOption(`custom-eval-set-ref-v3/${mixedSet.draft.setId}/${mixedSet.draft.versionId}`);
  await page.getByLabel("Target identity", { exact: true }).fill("authored-composition-target");
  await page.getByLabel("Declared target version", { exact: true }).fill("1");
  await page.getByLabel("Public HTTPS endpoint", { exact: true }).fill("https://composition-target.example.com/evaluate");
  await page.getByLabel("Concurrent calls", { exact: true }).fill("2");
  await page.getByLabel("Run duration (seconds)", { exact: true }).fill("15");
  const preview = await capture<{ preview: { counts: { uniqueItemCount: number; resultPairs: number; targetCalls: number } } }>(page, "/api/v1/http-target-plans/preview", () => page.getByRole("button", { name: "Preview plan without calling target", exact: true }).click());
  expect(preview.status).toBe(200); expect(preview.value.preview.counts).toMatchObject({ uniqueItemCount: 2, resultPairs: 4, targetCalls: 2 });
  const saved = await capture<{ record: AnyHttpEvalPlanVersionRecord }>(page, "/api/v1/http-target-plans", () => page.getByRole("button", { name: "Save immutable plan without executing", exact: true }).click());
  expect(saved.status).toBe(201); const plan = saved.value.record; await untouchedTransport(owned, journal);
  expect(plan.schemaVersion).toBe("http-eval-plan-record-v3");
  await page.goto(`/evals/plans/${plan.content.draft.planId}/versions/${plan.content.draft.versionId}`);
  const executionPath = `/api/v1/http-target-plans/${plan.content.draft.planId}/versions/${plan.content.draft.versionId}/runs`;
  let result!: AnyHttpEvalRunRecord;
  const match = (url: URL) => url.pathname === executionPath;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const intent = JSON.parse(route.request().postData()!); expect(intent.schemaVersion).toBe("http-eval-start-v3"); await owned.armTransport(plan, intent.runId);
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 }); expect(response.status()).toBe(201); result = (await response.json()).record; await route.fulfill({ response });
  };
  await page.route(match, handler);
  try {
    await page.getByRole("checkbox", { name: /I authorize this execution/ }).check();
    await page.getByRole("button", { name: "Start a new explicit execution", exact: true }).click();
    await expect(page.getByText("Execution status: completed", { exact: true })).toBeVisible();
    expect(result.execution.results).toHaveLength(4); expect(result.execution.gates).toHaveLength(16);
    expect(result.execution.gates.find(g => g.level === "eval_set" && g.scopeId === containsSet.storage.versionId)!.passed).toBe(true);
    for (const level of ["dataset", "target", "criticality", "run"]) expect(result.execution.gates.find(g => g.level === level)!.passed).toBe(false);
    const transport = owned.journal(), calls = transport.filter(e => e.phase === "committed_claim_before_authored_response"); expect(calls).toHaveLength(2);
    expect(calls.every(e => e.actualExternalTargetCalls === 0 && e.nativeDnsSocketTlsChecked === false)).toBe(true);
    const snapshot = await owned.snapshot(); expect(snapshot.claims).toHaveLength(2); expect(snapshot.counts.results).toBe(4); expect(snapshot.counts.gates).toBe(16);
    await page.screenshot({ path: info.outputPath("mixed-execution.png") }); await page.reload(); await expect(page.getByText("Execution status: completed", { exact: true })).toBeVisible(); await untouchedTransport(owned, transport);
  } finally { await page.unroute(match, handler); }
});
