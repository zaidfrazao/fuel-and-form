import { expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The sheet, drawn — four widths, two themes, both of its compositions.
 *
 * `screens.spec.ts` covers the seven routes and says in `constants.ts` why it
 * stops there: the picker sheet is "a sheet that FUEL-73 is about to redraw
 * anyway". FUEL-73 has now redrawn it, so that reason is spent and this is the
 * coverage it was deferring — the same eight projects, so a sheet baseline reads
 * as `__screenshots__/1272-dark/swap-sheet.png` beside its screen.
 *
 * ## The two captures, and why they are not "Swap and Meal detail"
 *
 * The ticket asks for the Swap and Meal-detail screens, which are two of the
 * mock's seven. **`BRAND_GUIDE.html` draws a meal detail and the app has no such
 * route** — § Information Architecture lists seven addresses and none of them is
 * one meal. What the app has is the sheet in two compositions, which is what the
 * mock's two frames are really showing:
 *
 *   - **`swap-sheet`** — the picker with the resulting day totals and the
 *     confirm button, from `/`. § Desktop's own example, and the composition its
 *     ruling turns on: "a swap is one decision about one meal, and putting the
 *     cost and the choice on opposite sides of a gutter would make it two".
 *   - **`meal-picker`** — the tile grid alone, from `/plan/template`, where
 *     choosing a meal costs nothing today and there are no totals to preview.
 *
 * ## Viewport captures, where every other spec is `fullPage`
 *
 * A sheet is anchored to the bottom of the WINDOW and Radix locks the document
 * behind it. `fullPage` resizes the capture to the scroll height, which for a
 * fixed element means photographing it once against a document it is not
 * covering — a picture of a sheet floating in the middle of a page nobody can
 * scroll. The viewport is what a reader is looking at, and it is also the only
 * thing that is true here.
 *
 * That also removes the height race `screens.spec.ts` waits out: nothing is
 * growing, because the capture is the window.
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

test("swap-sheet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();

  await page.getByRole("button", { name: "Swap" }).click();

  // The dialog being visible is the readiness condition, and asserting it before
  // the capture means a sheet that failed to open fails HERE, naming itself,
  // rather than quietly rewriting the baseline into a picture of the screen
  // behind it on the next `--update-snapshots`.
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("swap-sheet.png");
});

test("meal-picker", async ({ page }) => {
  await page.goto("/plan/template");
  await expect(page.getByRole("main")).toBeVisible();

  // Addressed by the slot rather than by the meal in it, so the fixture's
  // Monday breakfast can be renamed without silently selecting nothing.
  await page.getByRole("button", { name: /^Monday breakfast:/ }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("meal-picker.png");
});
