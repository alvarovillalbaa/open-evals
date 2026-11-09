import type { Page, Response } from "@playwright/test";
import { test, expect, expectNoRows, expectPersisted, openCreate, type OwnedBrowserFixture, type PersistedVersion } from "./custom-evals.browser.fixture";

interface SaveView {
  id: string;
  version: PersistedVersion;
  replayed: boolean;
  evalSet: { id: string; versions: PersistedVersion[] };
}

const apiPath = "/api/v1/eval-sets";
const nameInput = (page: Page) => page.getByLabel("Name", { exact: true });
const editorForm = (page: Page) => page.locator("form").filter({ has: nameInput(page) });
const containsInput = (page: Page) => editorForm(page).getByLabel(/^Text the output must contain/);
const thresholdInput = (page: Page) => page.getByLabel("Dataset pass-rate gate (%)", { exact: true });
const history = (page: Page) => page.locator('section[aria-labelledby="custom-eval-history"]');
const isSave = (response: Response) => response.request().method() === "POST" && new URL(response.url()).pathname === apiPath;

async function fill(page: Page, name: string, contains: string, threshold: number) {
  await nameInput(page).fill(name);
  await containsInput(page).fill(contains);
  await thresholdInput(page).fill(String(threshold));
}

async function save(page: Page, button: string, status = 201): Promise<{ view: SaveView; response: Response }> {
  const pending = page.waitForResponse(isSave);
  await page.getByRole("button", { name: button, exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(status);
  const view = await response.json() as SaveView;
  expect(view.version.id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  expect(view.version.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  return { view, response };
}

async function detail(page: Page, owned: OwnedBrowserFixture, setId: string) {
  const response = await page.context().request.get(`${owned.baseUrl}${apiPath}/${setId}`, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  return (await response.json()).evalSet as SaveView["evalSet"];
}

async function expectNarrowLayout(page: Page) {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const document = await page.evaluate(() => ({ viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  expect(document.documentWidth).toBeLessThanOrEqual(document.viewport + 1);
  expect(document.bodyWidth).toBeLessThanOrEqual(document.viewport + 1);
  for (const control of [nameInput(page), containsInput(page), thresholdInput(page)]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
}

test("CE-BR01 desktop creates versions and reloads immutable history through the real app", async ({ page, owned }) => {
  await openCreate(page, owned);
  const firstText = "  DESKTOP_FIRST_REQUIRED_TEXT\nKeep exact spaces.  ";
  await fill(page, "Desktop first check", firstText, 80);
  const first = (await save(page, "Save Eval Set")).view;
  expect(first.replayed).toBe(false);
  expect(first.version.version).toBe(1);
  await expect(editorForm(page).getByRole("status")).toHaveText("Saved version 1. Latest saved version: 1.");
  await expectPersisted(owned, [first.version.id]);
  await page.getByRole("link", { name: "Open saved Eval Set", exact: true }).click();
  await expect(page).toHaveURL(`${owned.baseUrl}/evals/custom/${first.id}`);
  await page.reload();
  await expect(nameInput(page)).toHaveValue("Desktop first check");
  await expect(containsInput(page)).toHaveValue(firstText);
  await expect(thresholdInput(page)).toHaveValue("80");

  const secondText = "DESKTOP_SECOND_REQUIRED_TEXT";
  await fill(page, "Desktop changed check", secondText, 65);
  const second = (await save(page, "Save new version")).view;
  expect(second.version.version).toBe(2);
  expect(second.version.contract.authoring.expectedVersionId).toBe(first.version.id);
  expect(second.version.id).not.toBe(first.version.id);
  await expect(editorForm(page).getByRole("status")).toHaveText("Saved version 2. Latest saved version: 2.");
  await page.reload();
  await expect(nameInput(page)).toHaveValue("Desktop changed check");
  await expect(containsInput(page)).toHaveValue(secondText);
  await expect(history(page).getByRole("listitem")).toHaveCount(2);
  await expect(history(page).getByRole("heading", { name: "Version 1: Desktop first check", exact: true })).toBeVisible();
  await expect(history(page).getByRole("heading", { name: "Version 2: Desktop changed check", exact: true })).toBeVisible();
  const stored = await expectPersisted(owned, [first.version.id, second.version.id]);
  expect(stored.versions[0].contract.itemVersions[0].item.config.contains).toBe(firstText);
  expect(stored.versions[0].contract.name).toBe("Desktop first check");
  expect((await detail(page, owned, first.id)).versions.map(version => version.id)).toEqual([second.version.id, first.version.id]);

  await page.getByRole("link", { name: "Custom Eval Sets", exact: true }).click();
  await expect(page.getByRole("link", { name: "Desktop changed check", exact: true })).toBeVisible();
  await expect(page.getByText("2 saved versions", { exact: true })).toBeVisible();
  await owned.attachSnapshot("desktop-persistence");
});

test("CE-BR02 a committed POST response is lost and an identical UI retry creates no duplicates", async ({ page, owned }) => {
  await openCreate(page, owned);
  await fill(page, "Unknown outcome check", "BR02_REAL_COMMITTED_TEXT", 100);
  const bodies: string[] = [];
  let resolveFirst!: (value: { status?: number; view?: SaveView; error?: string }) => void;
  const committed = new Promise<{ status?: number; view?: SaveView; error?: string }>(resolve => { resolveFirst = resolve; });
  await page.route(`**${apiPath}`, async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    bodies.push(route.request().postData() ?? "");
    if (bodies.length !== 1) { await route.continue(); return; }
    try {
      // Send the actual request to the real handler and consume its committed response first.
      const real = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      const view = await real.json() as SaveView;
      resolveFirst({ status: real.status(), view });
      await route.abort("connectionreset");
    } catch (error) {
      resolveFirst({ error: error instanceof Error ? error.name : "real_fetch_failed" });
      await route.abort("failed");
    }
  });
  await page.getByRole("button", { name: "Save Eval Set", exact: true }).click();
  const first = await committed;
  expect(first.error).toBeUndefined();
  expect(first.status).toBe(201);
  expect(first.view?.replayed).toBe(false);
  const saved = first.view!;
  await expect(editorForm(page).getByRole("alert")).toContainText("The save outcome is unknown.");
  await expect(nameInput(page)).toHaveJSProperty("readOnly", true);
  await expect(containsInput(page)).toHaveJSProperty("readOnly", true);
  await expect(thresholdInput(page)).toHaveJSProperty("readOnly", true);
  await expectPersisted(owned, [saved.version.id]);
  expect(bodies).toHaveLength(1);

  const recovered = (await save(page, "Retry unchanged save", 200)).view;
  expect(recovered.replayed).toBe(true);
  expect(recovered.version.id).toBe(saved.version.id);
  expect(recovered.version.fingerprint).toBe(saved.version.fingerprint);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  await expect(editorForm(page).getByRole("status")).toHaveText("Recovered version 1. Latest saved version: 1.");
  await expect(nameInput(page)).toHaveJSProperty("readOnly", false);
  await expect(history(page).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("link", { name: "Open saved Eval Set", exact: true }).click();
  await page.reload();
  await expect(containsInput(page)).toHaveValue("BR02_REAL_COMMITTED_TEXT");
  await expectPersisted(owned, [saved.version.id]);
  expect((await detail(page, owned, saved.id)).versions).toHaveLength(1);
  await owned.attachSnapshot("lost-response-identical-retry-persistence");
});

test("CE-BR03 a stale second writer retains its draft and explicitly reviews the loaded head before saving", async ({ page, browser, owned }) => {
  await openCreate(page, owned);
  await fill(page, "Original shared check", "BR03_ORIGINAL_TEXT", 100);
  const first = (await save(page, "Save Eval Set")).view;
  await page.getByRole("link", { name: "Open saved Eval Set", exact: true }).click();
  const peer = await owned.peerContext(browser);
  expect(peer.actorId).not.toBe(owned.actorId);
  const stalePage = await peer.context.newPage();
  await stalePage.goto(`${owned.baseUrl}/evals/custom/${first.id}`);
  await expect(containsInput(stalePage)).toHaveValue("BR03_ORIGINAL_TEXT");
  await fill(stalePage, "Retained second-writer draft", "BR03_RETAINED_DRAFT_TEXT", 63);

  await fill(page, "First writer accepted head", "BR03_ACCEPTED_HEAD_TEXT", 85);
  const second = (await save(page, "Save new version")).view;
  expect(second.version.version).toBe(2);
  const staleResponse = stalePage.waitForResponse(isSave);
  await stalePage.getByRole("button", { name: "Save new version", exact: true }).click();
  const conflict = await staleResponse;
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toEqual({ error: "custom_eval_version_conflict" });
  const staleIntent = conflict.request().postDataJSON();
  expect(staleIntent.expectedVersionId).toBe(first.version.id);
  await expect(editorForm(stalePage).getByRole("alert")).toContainText("Load the latest version, review your draft, then save again.");
  await expect(nameInput(stalePage)).toHaveValue("Retained second-writer draft");
  await expect(containsInput(stalePage)).toHaveValue("BR03_RETAINED_DRAFT_TEXT");
  await expect(nameInput(stalePage)).toHaveJSProperty("readOnly", true);
  await expect(stalePage.getByRole("button", { name: "Save new version", exact: true })).toBeDisabled();
  await expectPersisted(owned, [first.version.id, second.version.id]);

  const loaded = stalePage.waitForResponse(response => response.request().method() === "GET"
    && new URL(response.url()).pathname === `${apiPath}/${first.id}`);
  await stalePage.getByRole("button", { name: "Load latest saved version", exact: true }).click();
  expect((await loaded).status()).toBe(200);
  await expect(editorForm(stalePage).getByRole("status")).toHaveText("Loaded latest version 2. Your draft is unchanged; review it before saving another version.");
  await expect(nameInput(stalePage)).toHaveValue("Retained second-writer draft");
  await expect(containsInput(stalePage)).toHaveValue("BR03_RETAINED_DRAFT_TEXT");
  await expect(thresholdInput(stalePage)).toHaveValue("63");
  await expect(nameInput(stalePage)).toBeEditable();
  await expect(history(stalePage).getByRole("heading", { name: "Version 2: First writer accepted head", exact: true })).toBeVisible();
  await expectPersisted(owned, [first.version.id, second.version.id]);
  // A deliberate review/edit occurs after reading the actual new saved head.
  await nameInput(stalePage).fill("Reviewed retained second-writer draft");
  const third = await save(stalePage, "Save new version");
  const reviewedIntent = third.response.request().postDataJSON();
  expect(reviewedIntent.version).toBe(3);
  expect(reviewedIntent.expectedVersionId).toBe(second.version.id);
  expect(reviewedIntent.versionId).not.toBe(staleIntent.versionId);
  expect(reviewedIntent.contains).toBe("BR03_RETAINED_DRAFT_TEXT");
  await expect(editorForm(stalePage).getByRole("status")).toHaveText("Saved version 3. Latest saved version: 3.");
  await stalePage.reload();
  await expect(nameInput(stalePage)).toHaveValue("Reviewed retained second-writer draft");
  await expect(containsInput(stalePage)).toHaveValue("BR03_RETAINED_DRAFT_TEXT");
  await expect(history(stalePage).getByRole("listitem")).toHaveCount(3);
  const stored = await expectPersisted(owned, [first.version.id, second.version.id, third.view.version.id]);
  expect(stored.audits.map(audit => audit.actorId)).toEqual([owned.actorId, owned.actorId, peer.actorId]);
  expect(stored.versions[0].contract.name).toBe("Original shared check");
  expect(stored.versions[1].contract.itemVersions[0].item.config.contains).toBe("BR03_ACCEPTED_HEAD_TEXT");
  await owned.attachSnapshot("stale-head-reviewed-save-persistence");
});

test("CE-BR04 a 390x844 viewport validates fields and saves then reloads without horizontal clipping", async ({ page, owned }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCreate(page, owned);
  let postCount = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === apiPath) postCount += 1; });
  await expectNarrowLayout(page);
  await page.getByRole("button", { name: "Save Eval Set", exact: true }).click();
  expect(await nameInput(page).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await fill(page, "   ", "   ", 100);
  await page.getByRole("button", { name: "Save Eval Set", exact: true }).click();
  await expect(editorForm(page).getByRole("alert")).toContainText("Enter a name, up to 4,096 bytes of nonblank text");
  await fill(page, "Narrow validation check", "é".repeat(2049), 75);
  await page.getByRole("button", { name: "Save Eval Set", exact: true }).click();
  await expect(editorForm(page).getByRole("alert")).toContainText("Enter a name, up to 4,096 bytes of nonblank text");
  await fill(page, "Narrow validation check", "VALID_NARROW_TEXT", 101);
  await page.getByRole("button", { name: "Save Eval Set", exact: true }).click();
  expect(await thresholdInput(page).evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
  expect(postCount).toBe(0);
  await expectNoRows(owned);

  const text = `NARROW_${"x".repeat(220)}\nPreserve emoji 🧭 and spaces.  `;
  await fill(page, "Narrow saved check", text, 25);
  const saved = (await save(page, "Save Eval Set")).view;
  expect(saved.version.contract.gates.datasetPassRateThreshold).toBe(25);
  await expect(editorForm(page).getByRole("status")).toHaveText("Saved version 1. Latest saved version: 1.");
  await expect(history(page).getByText("Dataset pass-rate gate: 25%. Text check: critical.", { exact: true })).toBeVisible();
  await expectNarrowLayout(page);
  await page.getByRole("link", { name: "Open saved Eval Set", exact: true }).click();
  await page.reload();
  await expect(nameInput(page)).toHaveValue("Narrow saved check");
  await expect(containsInput(page)).toHaveValue(text);
  await expect(thresholdInput(page)).toHaveValue("25");
  await expectNarrowLayout(page);
  expect(postCount).toBe(1);
  const stored = await expectPersisted(owned, [saved.version.id]);
  expect(stored.versions[0].contract.itemVersions[0].item.config.contains).toBe(text);
  await owned.attachSnapshot("narrow-validation-persistence");
});
