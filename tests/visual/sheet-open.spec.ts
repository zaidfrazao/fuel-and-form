import { expect, test } from "@playwright/test";

import { addDays, todayIn } from "../../src/lib/date";
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
 *   - **`walk-route`** — the walk's trace, its figures and the way out to a map
 *     (FUEL-102). Added because the row it opens from is invisible to every
 *     other baseline: `screens.spec.ts` photographs TODAY, and the demo's two
 *     walks for today are not logged, so the figures line — which only exists
 *     once a walk IS logged — appears in none of the fifty-six screens. The
 *     trace would otherwise be the one graphic in this app with no photograph,
 *     which is the gap § Data Display's other two do not have.
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

/**
 * A past date whose walk was recorded, found rather than hardcoded.
 *
 * The demo's history is generated from the frozen clock, so which days carry a
 * route is deterministic — but it is decided in `seed/history.ts` and not here,
 * and a date written down as a literal would rot silently the first time that
 * file changed its mind. So this walks back from the frozen day and takes the
 * first date offering a trace, and FAILS if none of the last fortnight does.
 *
 * That failure is the point. The alternative — a spec that photographs whatever
 * it lands on — would rewrite this baseline into a picture of an ordinary
 * training screen on the next `--update-snapshots`, which is the same fault the
 * dialog assertion below exists to prevent.
 */
async function datedWalkWithRoute(page: import("@playwright/test").Page) {
  const today = todayIn("Europe/London", new Date(FROZEN_NOW_MS));

  for (let back = 1; back <= 14; back += 1) {
    const date = addDays(today, -back);

    await page.goto(`/training?date=${date}`);
    await expect(page.getByRole("main")).toBeVisible();

    /*
     * Wait for the WALK ROWS, and not for `main` alone — FUEL-103.
     *
     * `count()` below does not wait. `main` becomes visible before the Anytime
     * list at the foot of it has painted, so a date whose walk row had not yet
     * rendered read as "no route on this date" and the loop moved quietly on to
     * an earlier one.
     *
     * The cost is not a flaky failure, which is the kind somebody notices. It
     * is a baseline written from a DIFFERENT WALK by `--update-snapshots`, in
     * silence — exactly what the paragraph above says this function exists to
     * prevent, arriving through the one door it left open. It happened in
     * FUEL-103, to `1272-light` alone out of the eight projects, and the
     * picture was three days off the one every other width had photographed.
     *
     * § P3 puts a walk on the template every day of the week, so the walk's
     * name is on every date this loop visits whether or not it was logged and
     * whether or not it has a trace. That is what tells "no route here" apart
     * from "not painted yet", and it is why the wait is on the NAME rather than
     * on the control being looked for.
     */
    await expect(page.getByText("Morning Walk").first()).toBeVisible();

    const opener = page.getByRole("button", { name: /see the route/ }).first();

    if ((await opener.count()) > 0) return { date, opener };
  }

  throw new Error(
    "No walk with a route in the fortnight before the frozen clock. " +
      "The demo history stopped generating one, or the row stopped offering it.",
  );
}

test("walk-route", async ({ page }) => {
  const { opener } = await datedWalkWithRoute(page);

  await opener.click();

  await expect(page.getByRole("dialog")).toBeVisible();

  // The TRACE, not just the sheet. The geometry is fetched after the sheet
  // opens, so a capture taken on the dialog alone would photograph the loading
  // line about half the time — and would do it more often on a fast machine,
  // which is the way round that gets rebaselined instead of fixed.
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("walk-route.png");
});
