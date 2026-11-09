import type { Page, Response } from "@playwright/test";
import type { ProvidedOutputRunPlan, ProvidedOutputRunRecord } from "@open-evals/core";
import { test, expect, expectNoRuns, expectOneRun, type OwnedProvidedOutputFixture } from "./provided-output-runs.browser.fixture";

const endpoint = "/api/v1/provided-output-runs";
const datasetInput = (page: Page) => page.getByLabel("Dataset version ID", { exact: true });
const evaluatorInput = (page: Page) => page.getByLabel("Custom Eval Set version ID", { exact: true });
const output = (page: Page, key: "Alpha" | "Beta") => page.getByLabel(`Actual output for ${key}`, { exact: true });
const isPost = (path: string) => (response: Response) => response.request().method() === "POST" && new URL(response.url()).pathname === path;

interface RunView { record: ProvidedOutputRunRecord; replayed: boolean }

async function open(page: Page, owned: OwnedProvidedOutputFixture, evalSetVersionId: string) {
  const access = await page.context().request.get(`${owned.baseUrl}${endpoint}/sources`, { maxRedirects: 0 });
  expect(access.status()).toBe(200);
  expect((await access.json()).sources.datasets.map((entry: { versionId: string }) => entry.versionId)).toContain(owned.datasetVersionId);
  const document = await page.goto(`${owned.baseUrl}/evals/run`);
  expect(document?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Score supplied outputs", exact: true })).toBeVisible();
  await datasetInput(page).fill(owned.datasetVersionId);
  await evaluatorInput(page).fill(evalSetVersionId);
  await load(page);
  await expect(output(page, "Alpha")).toHaveValue("");
  await expect(output(page, "Beta")).toHaveValue("");
  await expectNoRuns(owned);
}

async function load(page: Page) {
  const pending = page.waitForResponse(response => response.request().method() === "GET"
    && new URL(response.url()).pathname === `${endpoint}/sources`
    && new URL(response.url()).searchParams.has("datasetVersionId"));
  await page.getByRole("button", { name: "Load selected versions", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const value = await response.json();
  expect(value.inputs.dataset.rows).toHaveLength(2);
  expect(value.inputs.evalSet.contract.id).toBe(await evaluatorInput(page).inputValue());
  await expect(page.getByRole("heading", { name: "2. Supply actual outputs", exact: true })).toBeVisible();
  return value.inputs;
}

async function preview(page: Page): Promise<ProvidedOutputRunPlan> {
  const pending = page.waitForResponse(isPost(`${endpoint}/preview`));
  await page.getByRole("button", { name: "Preview pinned run", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const value = await response.json() as { plan: ProvidedOutputRunPlan };
  expect(value.plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(value.plan.policy).toMatchObject({ maxTargetCalls: 0, maxJudgeCalls: 0, expectedOutputVisibility: "visible" });
  await expect(page.getByRole("heading", { name: "3. Review and explicitly run", exact: true })).toBeVisible();
  return value.plan;
}

async function run(page: Page, name = "Run deterministic checks", status = 201) {
  const pending = page.waitForResponse(isPost(endpoint));
  await page.getByRole("button", { name, exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(status);
  return { view: await response.json() as RunView, response };
}

async function openResult(page: Page, owned: OwnedProvidedOutputFixture, record: ProvidedOutputRunRecord) {
  await page.getByRole("link", { name: "Open immutable run", exact: true }).click();
  await expect(page).toHaveURL(`${owned.baseUrl}/evals/run/${record.plan.publicRunId}`);
  await expect(page.getByRole("heading", { name: "Supplied-output run", exact: true })).toBeVisible();
  const gates = page.locator('section[aria-labelledby="saved-output-gates"]');
  for (const label of ["Field gates", "Item-row gates", "Row gates", "Dataset gate", "Eval Set gate", "Provided-output target gate", "Criticality gate", "Run gate"]) {
    await expect(gates.getByText(label, { exact: true })).toBeVisible();
  }
  const detail = await page.context().request.get(`${owned.baseUrl}${endpoint}/${record.plan.publicRunId}`, { maxRedirects: 0 });
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toEqual({ record });
}

async function layout(page: Page) {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(geometry.root).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.body).toBeLessThanOrEqual(geometry.width + 1);
  for (const control of [datasetInput(page), evaluatorInput(page), output(page, "Alpha"), output(page, "Beta")]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
}

test("PO-BR01 desktop selects an older exact saved version and reloads all immutable scoring data", async ({ page, owned }) => {
  const saved = await owned.seedEvalSet(21);
  const firstVersionId = saved.versionIds[0];
  expect(firstVersionId).toBeTruthy();
  const history = await page.context().request.get(`${owned.baseUrl}/api/v1/eval-sets/${saved.setId}`, { maxRedirects: 0 });
  expect(history.status()).toBe(200);
  const historical = (await history.json()).evalSet;
  expect(historical.versions).toHaveLength(20);
  expect(historical.hasMore).toBe(true);
  expect(historical.versions.map((version: { id: string }) => version.id)).not.toContain(firstVersionId);
  await open(page, owned, firstVersionId!);
  const alpha = "  APPROVED authored alpha response 🧭\nexact spaces  ";
  const beta = "Approved beta response";
  await output(page, "Alpha").fill(alpha);
  await output(page, "Beta").fill(beta);
  const pinned = await preview(page);
  expect(pinned.evalSet.contract.id).toBe(firstVersionId);
  expect(pinned.evalSet.contract.fingerprint).toBe(saved.firstFingerprint);
  expect(pinned.evalSet.contract.authoring.version).toBe(1);
  expect(pinned.dataset.version.id).toBe(owned.datasetVersionId);
  expect(pinned.dataset.rows.map(row => row.id)).toEqual(owned.rowIds);
  expect(pinned.dataset.rows[0]?.expectedOutput).toEqual({ present: true, value: null });
  expect(pinned.dataset.rows[0]?.context).toEqual({ present: false, value: null });
  await expectNoRuns(owned);
  const { view, response } = await run(page);
  expect(view.replayed).toBe(false);
  expect(view.record.plan).toEqual(pinned);
  expect(response.request().postDataJSON()).toEqual({ schemaVersion: "provided-output-run-request-v1", draft: pinned.draft, expectedPlanFingerprint: pinned.fingerprint });
  expect(view.record.execution.results).toHaveLength(2);
  expect(new Set(view.record.execution.gates.map(gate => gate.level))).toEqual(new Set(["field", "item_row", "row", "dataset", "eval_set", "target", "criticality", "run"]));
  expect(view.record.execution.gates.every(gate => gate.passed)).toBe(true);
  await expectOneRun(owned, view.record);
  await openResult(page, owned, view.record);
  expect(await page.getByLabel("Actual supplied output for Alpha", { exact: true }).textContent()).toBe(alpha);
  expect(JSON.parse((await page.getByLabel("Saved input for Alpha", { exact: true }).textContent())!)).toEqual(pinned.dataset.rows[0]?.input);
  await owned.mutateSource("AFTER_ACCEPTED_RUN");
  await page.reload();
  expect(JSON.parse((await page.getByLabel("Saved input for Alpha", { exact: true }).textContent())!)).toEqual(pinned.dataset.rows[0]?.input);
  expect(await page.getByLabel("Actual supplied output for Alpha", { exact: true }).textContent()).toBe(alpha);
  const reloaded = await page.context().request.get(`${owned.baseUrl}${endpoint}/${pinned.publicRunId}`, { maxRedirects: 0 });
  expect(await reloaded.json()).toEqual({ record: view.record });
  await expectOneRun(owned, view.record);
  await owned.attachSnapshot("desktop-exact-version-immutable-result");
});

test("PO-BR02 a lost committed response retries the identical run after live source mutation without duplication", async ({ page, owned }) => {
  const saved = await owned.seedEvalSet();
  await open(page, owned, saved.versionIds[0]!);
  await output(page, "Alpha").fill("approved alpha before mutation");
  await output(page, "Beta").fill("approved beta before mutation");
  const pinned = await preview(page);
  const bodies: string[] = [];
  let complete!: (value: { status?: number; view?: RunView; error?: string }) => void;
  const committed = new Promise<{ status?: number; view?: RunView; error?: string }>(resolve => { complete = resolve; });
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    bodies.push(route.request().postData() ?? "");
    if (bodies.length !== 1) { await route.continue(); return; }
    try {
      const real = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      complete({ status: real.status(), view: await real.json() as RunView });
    } catch (error) {
      complete({ error: error instanceof Error ? error.name : "real_fetch_failed" });
    } finally { await route.abort("connectionreset"); }
  });
  await page.getByRole("button", { name: "Run deterministic checks", exact: true }).click();
  const accepted = await committed;
  expect(accepted.error).toBeUndefined(); expect(accepted.status).toBe(201);
  const first = accepted.view!;
  expect(first.replayed).toBe(false); expect(first.record.plan).toEqual(pinned);
  await expect(page.locator('p[role="alert"]')).toContainText("The run outcome is unknown.");
  await expect(output(page, "Alpha")).toHaveJSProperty("readOnly", true);
  await expect(datasetInput(page)).toHaveJSProperty("readOnly", true);
  await expect(page.getByRole("button", { name: "Load selected versions", exact: true })).toBeDisabled();
  await expectOneRun(owned, first.record);
  await owned.mutateSource("AFTER_COMMIT_BEFORE_RETRY");
  const retry = await run(page, "Retry unchanged run", 200);
  expect(retry.view.replayed).toBe(true);
  expect(retry.view.record).toEqual(first.record);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  await expect(page.locator('p[role="status"]')).toContainText("Recovered the existing immutable run.");
  await expectOneRun(owned, first.record);
  await openResult(page, owned, first.record);
  await owned.attachSnapshot("lost-response-exact-retry-after-source-change");
});

test("PO-BR03 preview drift refuses the old intent and preserves outputs for an explicitly reviewed new run", async ({ page, owned }) => {
  const saved = await owned.seedEvalSet();
  await open(page, owned, saved.versionIds[0]!);
  const alpha = "approved retained alpha", beta = "approved retained beta";
  await output(page, "Alpha").fill(alpha); await output(page, "Beta").fill(beta);
  const stale = await preview(page);
  await expectNoRuns(owned);
  await owned.mutateSource("BETWEEN_PREVIEW_AND_RUN");
  const conflict = await run(page, "Run deterministic checks", 409);
  expect(conflict.view).toEqual({ error: "provided_output_preview_changed" });
  await expect(page.locator('p[role="alert"]')).toContainText("The preview changed or this run ID conflicts with stored data.");
  await expect(output(page, "Alpha")).toHaveValue(alpha); await expect(output(page, "Beta")).toHaveValue(beta);
  await expect(output(page, "Alpha")).toBeEditable();
  await expect(page.getByRole("heading", { name: "3. Review and explicitly run", exact: true })).toHaveCount(0);
  await expectNoRuns(owned);
  const current = await load(page);
  expect(current.dataset.rows[0].input.mutation).toBe("BETWEEN_PREVIEW_AND_RUN");
  await expect(output(page, "Alpha")).toHaveValue(alpha); await expect(output(page, "Beta")).toHaveValue(beta);
  // The user reviews the changed source before requesting a new preview and Run.
  const rows = page.locator('section[aria-labelledby="provided-output-heading"]');
  const alphaRow = rows.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Alpha", exact: true }) });
  await alphaRow.getByText("Inspect complete saved input and references", { exact: true }).click();
  const reviewedInput = alphaRow.getByLabel("Saved input for Alpha", { exact: true });
  await expect(reviewedInput).toBeVisible();
  expect(JSON.parse((await reviewedInput.textContent())!)).toEqual(current.dataset.rows[0].input);
  const fresh = await preview(page);
  expect(fresh.publicRunId).not.toBe(stale.publicRunId);
  expect(fresh.fingerprint).not.toBe(stale.fingerprint);
  const result = await run(page);
  expect(result.view.record.plan).toEqual(fresh);
  expect(result.view.record.plan.draft.outputs).toEqual(stale.draft.outputs);
  await expectOneRun(owned, result.view.record);
  await openResult(page, owned, result.view.record);
  await owned.attachSnapshot("preview-drift-explicit-new-intent");
});

test("PO-BR04 narrow validation, empty-output failure and workspace-session boundaries preserve private run data", async ({ page, browser, owned }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const saved = await owned.seedEvalSet();
  await open(page, owned, saved.versionIds[0]!);
  let previewPosts = 0, runPosts = 0;
  page.on("request", request => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === `${endpoint}/preview`) previewPosts += 1;
    if (path === endpoint) runPosts += 1;
  });
  await layout(page);
  await output(page, "Alpha").fill("é".repeat(32769));
  await page.getByRole("button", { name: "Preview pinned run", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("keep each output within 64 KiB");
  expect(previewPosts).toBe(0); expect(runPosts).toBe(0);
  await expectNoRuns(owned);
  await output(page, "Alpha").fill(""); await output(page, "Beta").fill("APPROVED narrow beta");
  const pinned = await preview(page);
  expect(pinned.draft.outputs.find(row => row.rowId === owned.rowIds[0])?.output).toBe("");
  await layout(page); await expectNoRuns(owned); expect(runPosts).toBe(0);

  const viewer = await owned.viewerContext(browser);
  const viewerRead = await viewer.request.get(`${owned.baseUrl}${endpoint}/sources`, { maxRedirects: 0 });
  expect(viewerRead.status()).toBe(200);
  const viewerDenied = await viewer.request.post(`${owned.baseUrl}${endpoint}`, { maxRedirects: 0, headers: { "Content-Type": "application/json" }, data: "{" });
  expect(viewerDenied.status()).toBe(403);
  expect((await viewerDenied.json()).error).toBe("workspace_role_forbidden:editor");
  const keyHeaders = { Authorization: `Bearer ${owned.apiKey}`, "Content-Type": "application/json" };
  const validKeyLegacy = await page.context().request.get(`${owned.baseUrl}/api/v1/eval-runs`, { maxRedirects: 0, headers: keyHeaders });
  expect(validKeyLegacy.status()).toBe(200); expect(await validKeyLegacy.json()).toEqual({ batches: [] });
  for (const method of ["read", "preview", "run"] as const) {
    const denied = method === "read"
      ? await page.context().request.get(`${owned.baseUrl}${endpoint}/sources`, { maxRedirects: 0, headers: keyHeaders })
      : await page.context().request.post(`${owned.baseUrl}${endpoint}${method === "preview" ? "/preview" : ""}`, { maxRedirects: 0, headers: keyHeaders, data: "{" });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toBe("custom_eval_workspace_session_required");
  }
  const unknownField = await page.context().request.post(`${owned.baseUrl}${endpoint}/preview`, { maxRedirects: 0,
    data: { ...pinned.draft, workspaceId: owned.workspaceId } });
  expect(unknownField.status()).toBe(422);
  await expectNoRuns(owned);

  const result = await run(page);
  expect(runPosts).toBe(1); expect(previewPosts).toBe(1);
  expect(result.view.record.execution.gates.find(gate => gate.level === "dataset")?.passed).toBe(true);
  expect(result.view.record.execution.gates.find(gate => gate.level === "run")?.passed).toBe(false);
  expect(result.view.record.plan.draft.outputs.find(row => row.rowId === owned.rowIds[0])?.output).toBe("");
  await expectOneRun(owned, result.view.record);
  const viewerDetail = await viewer.request.get(`${owned.baseUrl}${endpoint}/${pinned.publicRunId}`, { maxRedirects: 0 });
  expect(viewerDetail.status()).toBe(200);
  const keyDetail = await page.context().request.get(`${owned.baseUrl}${endpoint}/${pinned.publicRunId}`, { maxRedirects: 0, headers: keyHeaders });
  expect(keyDetail.status()).toBe(403);
  const broad = await page.context().request.get(`${owned.baseUrl}/api/v1/eval-runs`, { maxRedirects: 0 });
  expect(broad.status()).toBe(200); expect(await broad.json()).toEqual({ batches: [] });
  const oldDetail = await page.context().request.get(`${owned.baseUrl}/runs/${result.view.record.plan.id}`, { maxRedirects: 0 });
  expect(oldDetail.status()).toBe(404);
  await openResult(page, owned, result.view.record);
  await expect(page.getByText("The actual output was empty text.", { exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(widths.root).toBeLessThanOrEqual(widths.viewport + 1); expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  await owned.attachSnapshot("narrow-empty-output-gates-and-access-boundary");
});
