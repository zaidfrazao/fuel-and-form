import { expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * `/recipe/[mealId]` on the demo fixture — FUEL-143.
 *
 * Reached by following `/`'s title rather than by address. The address holds a
 * meal id, and every demo provisioning mints new ones, so a path in `SCREENS`
 * would name a meal that no longer exists. Following the link is also the
 * entry point the ticket asks for, so the click is part of what is photographed.
 *
 * Read-only: it opens a page and changes nothing, which is the condition on any
 * spec in this matrix (memory: visual specs must not mutate the demo).
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

test("recipe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();

  const title = page.getByRole("heading", { level: 1 }).getByRole("link");
  const href = await title.getAttribute("href");

  // The entry point carries the plan's date — asserted here because this is
  // the one place the real `/` is in front of a real recipe.
  expect(href).toMatch(/^\/recipe\/[0-9a-f-]{36}\?date=\d{4}-\d{2}-\d{2}$/);

  await title.click();

  await expect(page).toHaveURL(href!);
  await expect(page.getByRole("heading", { level: 2, name: "Method" })).toBeVisible();

  await page.evaluate(() => document.fonts.ready);

  // The screen's height IS the baseline's (memory: page heights are in the
  // baselines), so wait for it to stop moving before a fullPage capture.
  await page.waitForFunction(
    () => {
      const store = window as unknown as { __h?: number; __same?: number };
      const height = document.documentElement.scrollHeight;

      if (store.__h === height) store.__same = (store.__same ?? 0) + 1;
      else {
        store.__h = height;
        store.__same = 0;
      }

      return (store.__same ?? 0) >= 3;
    },
    undefined,
    { polling: 100, timeout: 15_000 },
  );

  await page.mouse.move(0, 0);

  await expect(page).toHaveScreenshot("recipe.png", { fullPage: true, timeout: 15_000 });
});
