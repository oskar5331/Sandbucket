import { expect, test } from "@playwright/test";

// M0 smoke test: the built app serves its home page. Replaced by real journeys
// from M2 on (docs/roadmap.md).
test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Sandbucket" })).toBeVisible();
});
