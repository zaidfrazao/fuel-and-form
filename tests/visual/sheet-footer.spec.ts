import { type Locator, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The swap's confirm is on screen after a pick — FUEL-135.
 *
 * Observed at 375×812: the sheet was 969px of content in a 690px viewport, and
 * after a tile was picked the Swap button sat at `top ≈ 947px`, with the day
 * totals only just peeking at the bottom edge. Picking gave no visible next
 * step. The fix pins the confirm, and the two figures it changes, in a footer
 * outside the sheet's scroller (`ui/sheet.tsx`'s `footer`).
 *
 * `swap-sheet.test.tsx` pins the STRUCTURE — the confirm is not inside the
 * scroller. Whether that puts it on screen is a layout claim jsdom cannot make,
 * which is this file.
 *
 * ## The two heights, and the pick
 *
 * 375×667 is the shortest phone the guide measures against and 375×812 is the
 * ticket's. Picking the LAST tile in the whole library is the worst case: it is
 * the one furthest down the scroller, so the tap has scrolled the body as far
 * as a pick can take it. If the footer holds there it holds for any tile.
 *
 * ## "On screen" means hit-testable, not merely inside the window
 *
 * A box inside the viewport can still be covered — by the scrim, by the
 * body's fade, by a sibling painted over it. So each control is asked which
 * element is at its own centre, and must answer itself.
 *
 * A project of its own (`playwright.config.ts`), for the reason `sheet` is one:
 * a position has no theme, and it sets its own viewport per case.
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

/** The box, whole, inside the viewport — and the element at its centre is itself. */
async function expectOnScreen(locator: Locator, height: number) {
  const box = await locator.boundingBox();

  if (!box) throw new Error("element is not visible, so it has no box");

  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(height);

  const hit = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

    return top !== null && element.contains(top);
  });

  expect(hit).toBe(true);
}

for (const height of [667, 812]) {
  test(`Swap and the day's kcal and protein are on screen after a pick at 375×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height });
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();

    await page.getByRole("button", { name: "Swap" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // The whole library, so the last tile is the furthest a pick can reach.
    await sheet.getByRole("button", { name: "Show all meals" }).click();

    const tiles = sheet.getByRole("group", { name: /^Meals for/ }).getByRole("button");
    const last = tiles.last();

    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(last).toHaveAttribute("aria-pressed", "true");

    const swap = sheet.getByRole("button", { name: "Swap", exact: true });
    await expect(swap).toBeEnabled();
    await expectOnScreen(swap, height);

    // The footer's figures: a region labelled for the swap being considered.
    // Asserted on the two values' own labels rather than the region's box, so
    // a region that stayed on screen while clipping its content still fails.
    const figures = sheet.getByRole("region", { name: "Day totals after the swap", exact: true });
    await expectOnScreen(figures.getByText("Calories"), height);
    await expectOnScreen(figures.getByText("Protein"), height);
  });
}
