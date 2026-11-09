import { expect, test } from "@playwright/test";

test("OE-UI01 desktop navigation exposes two areas and their current workflow links", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/evals$/);
  await expect(page.getByRole("heading", { name: "Evals", exact: true })).toBeVisible();
  const areas = page.getByRole("navigation", { name: "Product areas", exact: true });
  await expect(areas.getByRole("link")).toHaveCount(2);
  await expect(areas.getByRole("link", { name: "Evals", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(areas.getByRole("link", { name: "Improve", exact: true })).toBeVisible();
  const evalPages = page.getByRole("navigation", { name: "Evals pages", exact: true });
  await expect(evalPages.getByRole("link", { name: "Runs", exact: true })).toBeVisible();
  await expect(evalPages.getByRole("link", { name: "Connect SDK", exact: true })).toBeVisible();
  await areas.getByRole("link", { name: "Improve", exact: true }).click();
  await expect(page).toHaveURL(/\/improve$/);
  await expect(page.getByRole("heading", { name: "Improve", exact: true })).toBeVisible();
  const improvePages = page.getByRole("navigation", { name: "Improve pages", exact: true });
  await expect(improvePages.getByRole("link", { name: "Instructions", exact: true })).toBeVisible();
  await expect(improvePages.getByRole("link", { name: "Campaigns", exact: true })).toBeVisible();
});

test("OE-UI02 narrow navigation retains both areas and usable SDK links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/evals/sdk");
  await expect(page.getByRole("heading", { name: "SDK connection", exact: true })).toBeVisible();
  const areas = page.getByRole("navigation", { name: "Product areas", exact: true });
  await expect(areas.getByRole("link")).toHaveCount(2);
  await expect(areas.getByRole("link", { name: "Evals", exact: true })).toBeVisible();
  await expect(areas.getByRole("link", { name: "Improve", exact: true })).toBeVisible();
  const evalPages = page.getByRole("navigation", { name: "Evals pages", exact: true });
  await expect(evalPages.getByRole("link", { name: "Connect SDK", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(evalPages.getByRole("link", { name: "Catalogue", exact: true })).not.toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await evalPages.getByRole("link", { name: "Catalogue", exact: true }).click();
  await expect(page).toHaveURL(/\/evals$/);
});

test("OE-UI03 legacy entry points redirect and the trace upload form is absent", async ({ page }) => {
  for (const [from, destination] of [["/benchmarks", "/evals#benchmarks"], ["/scenarios", "/evals#scenarios"], ["/runs/import", "/evals/sdk"]]) {
    await page.goto(from);
    expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe(destination);
  }
  await expect(page.getByRole("heading", { name: "SDK connection", exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import traces", exact: true })).toHaveCount(0);
});
