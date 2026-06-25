import { expect, test } from "@playwright/test";

test("product shell exposes only Evals and Improve top-level product areas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Evals" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Improve" })).toBeVisible();
  await expect(page.getByText("Result matrix", { exact: true })).toBeVisible();
  await expect(page.getByText("Campaign answers", { exact: true })).toBeVisible();
  await expect(page.getByText("standalone observability")).toHaveCount(0);
});
