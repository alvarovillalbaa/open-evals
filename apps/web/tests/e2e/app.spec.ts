import { expect, test } from "@playwright/test";

test("product shell exposes requested workflow sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Runs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Benchmarks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Scenarios" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Instructions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Campaigns" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Prompts" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Targets" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Connections" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await expect(page.getByText("standalone observability")).toHaveCount(0);
});
