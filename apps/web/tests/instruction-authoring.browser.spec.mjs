import { expect, test as base } from "@playwright/test";
import { createInstructionFixture, expectStatus } from "./instruction-authoring.fixtures.mjs";

// T3: authored UI inputs plus exact disposable PostgreSQL fixtures. Not a production test.
const test = base.extend({
  fixture: async ({ page, context }, use) => {
    const fixture = await createInstructionFixture();
    const externalRequests = [], pageErrors = [];
    try {
      await context.addCookies([{ name: "open_evals_session", value: fixture.sessionCookie("editor"), url: fixture.baseURL, httpOnly: true, sameSite: "Lax" }]);
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin === fixture.baseURL) return route.continue();
        externalRequests.push(url.origin);
        await route.abort("blockedbyclient");
      });
      page.on("pageerror", error => pageErrors.push(error.message));
      await use(fixture);
      expect(externalRequests, "browser requests must remain on the disposable loopback app").toEqual([]);
      expect(pageErrors, "no unhandled client exceptions").toEqual([]);
    } finally {
      try { await page.unrouteAll({ behavior: "wait" }); }
      finally { await fixture.cleanup(); }
    }
  }
});

function component(page, number) { return page.getByRole("group", { name: new RegExp(`^Component ${number}(?: · locked in parent)?$`) }); }
function binding(page, number) { return page.getByRole("group", { name: `Binding ${number}`, exact: true }); }
function apiPath(url) { return new URL(url).pathname; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function createThroughUI(page, fixture, label) {
  await page.goto("/instructions");
  await expect(page.getByRole("heading", { name: "No instructions yet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New definition", exact: true }).click();
  await page.getByLabel("Stable key", { exact: true }).fill(fixture.id(label));
  await page.getByLabel("Target ID", { exact: false }).fill(fixture.targetId);
  const responsePromise = page.waitForResponse(response => apiPath(response.url()) === "/api/v1/instructions" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create definition", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const { definition } = await response.json();
  await expect(page).toHaveURL(`${fixture.baseURL}/instructions/${encodeURIComponent(definition.id)}`);
  await expect(page.getByRole("heading", { name: definition.stableKey, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compose first version", exact: true }).click();
  return definition;
}

async function addBinding(page, number, name, type, value) {
  await page.getByRole("button", { name: "Add binding", exact: true }).click();
  const row = binding(page, number);
  await row.getByLabel("Name", { exact: true }).fill(name);
  await row.getByRole("combobox", { name: "Type", exact: true }).selectOption(type);
  if (type === "boolean") await row.getByRole("combobox", { name: "Value", exact: true }).selectOption(value);
  else await row.getByRole("textbox", { name: "Value", exact: true }).fill(value);
}

async function compileThroughUI(page, definitionId) {
  const path = `/api/v1/instructions/${encodeURIComponent(definitionId)}/preview`;
  const responsePromise = page.waitForResponse(response => apiPath(response.url()) === path && response.request().method() === "POST");
  await page.getByRole("button", { name: "Compile preview", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const result = await response.json();
  await expect(page.getByRole("button", { name: "Save reviewed draft", exact: true })).toBeEnabled();
  return result;
}

async function saveThroughUI(page, fixture, definitionId, preview) {
  const path = fixture.definitionPath(definitionId, "/versions");
  const responsePromise = page.waitForResponse(response => apiPath(response.url()) === path && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save reviewed draft", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect(saved.replayed).toBe(false);
  expect(saved.version.version).toEqual(preview.version);
  await expect(page.getByRole("heading", { name: "Saved version · draft", exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${fixture.baseURL}/instructions/${encodeURIComponent(definitionId)}?versionId=${encodeURIComponent(preview.version.id)}`);
  return saved.version;
}

async function persistedDetail(fixture, definitionId, versionId) {
  return expectStatus(await fixture.request(fixture.definitionPath(definitionId, `?versionId=${encodeURIComponent(versionId)}`), { auth: fixture.editor }), 200);
}

async function expectSingleWrite(fixture, definitionId, versionId) {
  const versions = await fixture.sql("select id, components from prompt_versions where prompt_definition_id = $1 and id = $2", [definitionId, versionId]);
  const audits = await fixture.sql("select id, metadata from audit_events where workspace_id = $1 and actor_user_id = $2 and action = 'prompt.version.created' and resource_type = 'prompt_version' and resource_id = $3", [fixture.workspaceId, fixture.editorId, versionId]);
  expect(versions).toHaveLength(1);
  expect(audits).toHaveLength(1);
  expect(versions[0].components.write.actorId).toBe(fixture.editorId);
  return versions[0];
}

test("desktop empty catalog creates, composes typed blocks, saves and reloads the immutable source", async ({ page, fixture }) => {
  const definition = await createThroughUI(page, fixture, "composed");
  await page.getByRole("checkbox", { name: /^Enable composition/ }).check();
  const first = component(page, 1);
  await first.getByLabel("Component ID", { exact: true }).fill("greeting");
  await first.getByLabel("Kind", { exact: true }).fill("role");
  await first.getByRole("combobox", { name: "Source", exact: true }).selectOption("operations");
  const operations = [
    { op: "include", name: "intro" },
    { op: "if", variable: "formal", then: [{ op: "text", template: " Welcome." }] },
    { op: "each", variable: "items", as: "item", indexAs: "index", body: [{ op: "text", template: " {{index}}:{{item}}" }], separator: "," }
  ];
  await first.getByRole("textbox", { name: "Operation array (JSON)", exact: true }).fill(JSON.stringify(operations));
  await addBinding(page, 1, "name", "string", "Ada");
  await addBinding(page, 2, "formal", "boolean", "true");
  await addBinding(page, 3, "items", "json", '["one","two"]');
  await addBinding(page, 4, "limit", "number", "2");
  const blocks = { intro: [{ op: "text", template: "Hello {{name}}." }] };
  await page.getByRole("textbox", { name: "Named block library (JSON object)", exact: true }).fill(JSON.stringify(blocks));
  const preview = await compileThroughUI(page, definition.id);
  expect(preview.version.compiledText).toContain("Hello Ada. Welcome. 0:one, 1:two");
  expect(preview.version.compositionSnapshot.components[0].operations).toEqual(operations);
  expect(preview.version.compositionSnapshot.blocks).toEqual(blocks);
  expect(preview.version.compositionSnapshot.bindings.limit).toEqual({ type: "number", value: 2 });
  const saved = await saveThroughUI(page, fixture, definition.id, preview);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Saved version · draft", exact: true })).toBeVisible();
  await page.getByText("Full source snapshot", { exact: true }).click();
  const snapshot = page.locator("details").filter({ has: page.getByText("Full source snapshot", { exact: true }) }).locator("pre");
  expect(JSON.parse(await snapshot.innerText())).toEqual(preview.version.compositionSnapshot);
  const reloaded = await persistedDetail(fixture, definition.id, saved.id);
  expect(reloaded.selectedVersion.version).toEqual(preview.version);
  await expectSingleWrite(fixture, definition.id, saved.id);
  await page.getByRole("link", { name: "All instructions", exact: true }).click();
  await expect(page.getByRole("heading", { name: definition.stableKey, exact: true })).toBeVisible();
  await expect(page.getByText("1 saved versions", { exact: true })).toBeVisible();
});

test("desktop fork preserves parent locks and rejects an obsolete delayed preview", async ({ page, fixture }) => {
  const definition = fixture.definitionInput("locked_base");
  expectStatus(await fixture.request("/api/v1/instructions", { auth: fixture.editor, method: "POST", body: definition }), 201);
  const baseInput = fixture.literal("locked_version", "Initial mutable instruction.");
  const basePreview = expectStatus(await fixture.request(fixture.definitionPath(definition.id, "/preview"), { auth: fixture.editor, method: "POST", body: baseInput }), 200);
  expectStatus(await fixture.request(fixture.definitionPath(definition.id, "/versions"), { auth: fixture.editor, method: "POST", body: { ...baseInput, previewFingerprint: basePreview.previewFingerprint } }), 201);
  await page.goto(`/instructions/${definition.id}?versionId=${baseInput.versionId}`);
  await page.getByRole("button", { name: "Compose version", exact: true }).click();
  const locked = component(page, 1), mutable = component(page, 2);
  await expect(locked.getByLabel("Component ID", { exact: true })).toBeDisabled();
  await expect(locked.getByRole("textbox", { name: "Literal text", exact: true })).toBeDisabled();
  await expect(locked.getByRole("checkbox", { name: "Lock rendered text", exact: true })).toBeChecked();
  await mutable.getByRole("textbox", { name: "Literal text", exact: true }).fill("First reviewed change.");
  await compileThroughUI(page, definition.id);
  await mutable.getByRole("textbox", { name: "Literal text", exact: true }).fill("Old delayed source.");
  await expect(page.getByRole("button", { name: "Save reviewed draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Review compiled draft", exact: true })).toHaveCount(0);

  const received = deferred(), release = deferred(), completed = deferred();
  const path = fixture.definitionPath(definition.id, "/preview");
  await page.route(url => url.pathname === path, async route => {
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      received.resolve(await response.json());
      await release.promise;
      try { await route.fulfill({ response }); }
      catch (error) {
        // An edited draft aborts this browser request; Chromium may have retired its route.
        if (!/ERR_ABORTED/i.test(route.request().failure()?.errorText ?? "")) throw error;
      }
    } catch (error) {
      received.reject(error);
      throw error;
    } finally { completed.resolve(); }
  }, { times: 1 });
  try {
    const [old] = await Promise.all([received.promise, page.getByRole("button", { name: "Compile preview", exact: true }).click()]);
    expect(old.version.components[1].content).toBe("Old delayed source.");
    const cancellation = page.waitForEvent("requestfailed", { predicate: request => apiPath(request.url()) === path, timeout: 10_000 });
    await mutable.getByRole("textbox", { name: "Literal text", exact: true }).fill("Newest source wins.");
    expect((await cancellation).failure()?.errorText).toMatch(/ERR_ABORTED/i);
    release.resolve();
    await completed.promise;
    await expect(page.getByRole("heading", { name: "Review compiled draft", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save reviewed draft", exact: true })).toBeDisabled();
    const latest = await compileThroughUI(page, definition.id);
    expect(latest.version.components[1].content).toBe("Newest source wins.");
    expect(latest.version.components[0]).toEqual(basePreview.version.components[0]);
    expect(latest.version.parentVersionIds).toEqual([baseInput.versionId]);
    await saveThroughUI(page, fixture, definition.id, latest);
    const original = await persistedDetail(fixture, definition.id, baseInput.versionId);
    expect(original.selectedVersion.version).toEqual(basePreview.version);
  } finally { release.resolve(); }
});

test("390px keyboard controls reorder components and preserve bindings through save and reload", async ({ page, fixture }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const definition = await createThroughUI(page, fixture, "narrow");
  await page.getByRole("checkbox", { name: /^Enable composition/ }).check();
  await component(page, 1).getByLabel("Component ID", { exact: true }).fill("first");
  await component(page, 1).getByRole("textbox", { name: "Template text", exact: true }).fill("First {{count}}.");
  const add = page.getByRole("button", { name: "Add component", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  await component(page, 2).getByLabel("Component ID", { exact: true }).fill("second");
  await component(page, 2).getByRole("textbox", { name: "Template text", exact: true }).fill("Second {{count}}.");
  await component(page, 2).getByRole("button", { name: "Move component 2 up", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(component(page, 1).getByLabel("Component ID", { exact: true })).toHaveValue("second");
  await expect(component(page, 2).getByLabel("Component ID", { exact: true })).toHaveValue("first");
  await page.getByRole("button", { name: "Add binding", exact: true }).focus();
  await page.keyboard.press("Enter");
  const count = binding(page, 1);
  await count.getByLabel("Name", { exact: true }).focus();
  await page.keyboard.type("count");
  await page.keyboard.press("Tab");
  await expect(count.getByRole("combobox", { name: "Type", exact: true })).toBeFocused();
  await count.getByRole("combobox", { name: "Type", exact: true }).selectOption("number");
  await page.keyboard.press("Tab");
  await expect(count.getByRole("textbox", { name: "Value", exact: true })).toBeFocused();
  await count.getByRole("textbox", { name: "Value", exact: true }).fill("3");
  expect(await count.getByRole("textbox", { name: "Value", exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const preview = await compileThroughUI(page, definition.id);
  expect(preview.version.components.map(row => row.id)).toEqual(["second", "first"]);
  expect(preview.version.components.map(row => row.content)).toEqual(["Second 3.", "First 3."]);
  await saveThroughUI(page, fixture, definition.id, preview);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Saved version · draft", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect((await persistedDetail(fixture, definition.id, preview.version.id)).selectedVersion.version).toEqual(preview.version);
});

test("lost save acknowledgement replays one insert and acknowledged reload retries only GET", async ({ page, fixture }) => {
  const definition = await createThroughUI(page, fixture, "lost_ack");
  await page.getByRole("checkbox", { name: /^Enable composition/ }).check();
  await component(page, 1).getByRole("textbox", { name: "Template text", exact: true }).fill("Hello {{name}}.");
  await addBinding(page, 1, "name", "string", "Ada");
  await page.getByRole("textbox", { name: "Named block library (JSON object)", exact: true }).fill(JSON.stringify({ unused: [{ op: "text", template: "source A" }] }));
  const preview = await compileThroughUI(page, definition.id);
  const savePath = fixture.definitionPath(definition.id, "/versions");
  const detailPath = fixture.definitionPath(definition.id);
  const postBodies = [], postResults = [];
  let detailGets = 0;
  await page.route(url => url.pathname === detailPath, async route => {
    if (route.request().method() !== "GET") return route.continue();
    detailGets += 1;
    if (detailGets === 1) return route.fulfill({ status: 503, json: { error: "disposable_reload_unavailable" }, headers: { "cache-control": "no-store" } });
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    if (detailGets === 2) {
      const altered = await response.json();
      altered.selectedVersion.version.compositionSnapshot.blocks.unused[0].template = "source B";
      return route.fulfill({ response, json: altered });
    }
    return route.fulfill({ response });
  });
  await page.route(url => url.pathname === savePath, async route => {
    postBodies.push(route.request().postDataJSON());
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    postResults.push({ status: response.status(), body: await response.json() });
    if (postBodies.length === 1) return route.abort("failed");
    return route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save reviewed draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry same save", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(component(page, 1).getByRole("textbox", { name: "Template text", exact: true })).toBeDisabled();
  expect(postResults[0].status).toBe(201);
  await expectSingleWrite(fixture, definition.id, preview.version.id);
  await page.getByRole("button", { name: "Retry same save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry loading saved version", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Storage is unavailable");
  expect(postResults.map(result => result.status)).toEqual([201, 200]);
  expect(postResults[1].body.replayed).toBe(true);
  expect(postBodies[1]).toEqual(postBodies[0]);
  await expect(page.getByRole("button", { name: "Retry same save", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry loading saved version", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("saved source snapshot does not match");
  await expect(page.getByRole("button", { name: "Retry loading saved version", exact: true })).toBeEnabled();
  await expect(component(page, 1).getByRole("textbox", { name: "Template text", exact: true })).toBeDisabled();
  expect(postBodies).toHaveLength(2);
  await page.getByRole("button", { name: "Retry loading saved version", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved version · draft", exact: true })).toBeVisible();
  expect(detailGets).toBe(3);
  expect(postBodies).toHaveLength(2);
  const persisted = await persistedDetail(fixture, definition.id, preview.version.id);
  expect(persisted.selectedVersion.version).toEqual(preview.version);
  const row = await expectSingleWrite(fixture, definition.id, preview.version.id);
  expect(row.components.source.snapshot.blocks.unused[0].template).toBe("source A");
});
