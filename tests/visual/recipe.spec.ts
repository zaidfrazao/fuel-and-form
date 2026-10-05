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

/**
 * The prep lists with something ticked — FUEL-144.
 *
 * On the specimen rather than the demo: a tick lives in this context's
 * `localStorage` and writes no row, but the specimen is the one page here
 * whose recipe is the same on every provisioning. Two ingredients and the
 * first step, so the photograph holds a ticked row, an unticked one beside it,
 * both counts moved off zero, and `Clear ticks` drawn.
 */
test("recipe-ticked", async ({ page }) => {
  await page.goto("/dev/recipe?case=chilli");

  const main = page.getByRole("main");
  await expect(main).toBeVisible();

  // A `<section>` with no name is not a region, so it is found by its heading.
  // The rows are tapped as a person taps them — on the label; the input is
  // `sr-only` under the drawn mark, so a click aimed at it is intercepted.
  const rows = (name: string) =>
    main
      .locator("section", { has: page.getByRole("heading", { level: 2, name }) })
      .locator("label");
  const ingredients = rows("Ingredients");
  const steps = rows("Method");

  for (const row of [ingredients.nth(0), ingredients.nth(2), steps.nth(0)]) {
    await row.click();
    await expect(row.getByRole("checkbox")).toBeChecked();
  }

  await expect(main.getByRole("button", { name: "Clear ticks" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);

  await expect(main).toHaveScreenshot("recipe-ticked.png", { timeout: 15_000 });
});

/**
 * The owner's edit sheet — FUEL-147.
 *
 * On the specimen: the demo fixture is a demo session, and a demo session is
 * shown no Edit control, so the live route can never open this sheet here.
 * Opening it writes nothing; Save is never pressed (memory: visual specs must
 * not mutate the demo).
 *
 * Viewport captures, for `sheet-open.spec.ts`'s reason — a sheet is anchored
 * to the window. Two of them: the sheet as it opens, on the name, the figures
 * and the first ingredient's two readings; and scrolled to the method, where
 * the preview numbers the steps the screen will.
 */
test("recipe-edit-sheet", async ({ page }) => {
  await page.goto("/dev/recipe?case=edit");
  await expect(page.getByRole("main")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit recipe" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);

  await expect(page).toHaveScreenshot("recipe-edit-sheet.png", { timeout: 15_000 });

  // The heading, not the region: at 375 the region is taller than the sheet,
  // and centring it scrolls step 1 out of view above.
  const preview = dialog.getByRole("region", { name: "Method preview" });
  await preview.getByRole("heading", { name: "Preview" }).scrollIntoViewIfNeeded();
  await expect(preview.getByRole("listitem").first()).toBeInViewport();

  await expect(page).toHaveScreenshot("recipe-edit-preview.png", { timeout: 15_000 });
});

/**
 * The reassessed macros — FUEL-148.
 *
 * On the specimen, from a fixture: the live sheet's proposal comes from a
 * paid request whose wording no baseline could hold still, and the demo is
 * refused it anyway. The table, the mismatch line, the rationale, the assumed
 * weights and Accept / Discard, in the measure the sheet uses. The main
 * element only, so the specimen's footer is not part of what is compared.
 */
test("recipe-estimate", async ({ page }) => {
  await page.goto("/dev/recipe?case=estimate");

  const report = page.getByRole("region", { name: "Proposed macros" });
  await expect(report).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);

  await expect(page.getByRole("main")).toHaveScreenshot("recipe-estimate.png", { timeout: 15_000 });
});
