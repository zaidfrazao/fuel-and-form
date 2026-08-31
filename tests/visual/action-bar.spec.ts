import { type Locator, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The action bar across the `lg` breakpoint — Brand Guide § Desktop, FUEL-72.
 *
 * § Desktop's ruling is a sentence about where a control sits: "above 1024px
 * there is no thumb, so the bar has no posture to serve, and a control pinned
 * over content the reader is reading is only a cost. The primary action sits at
 * the end of its column." Below that width the opposite holds, and FUEL-65's
 * offset is what makes it true. Two behaviours, one breakpoint, and nothing
 * cheaper than a browser can see either of them.
 *
 * ## Why this is not left to the unit suite or to the baselines
 *
 * `action-bar.test.tsx` holds the class string, which is the whole of what jsdom
 * can hold: it applies no stylesheet, so `lg:static` there is a substring rather
 * than a position. That test would pass against a `lg:` breakpoint redefined to
 * 4000px, against a `static` overridden later in the cascade, and against a
 * `<main>` that had stopped being `flex-1` underneath it.
 *
 * The baselines in `screens.spec.ts` would catch all three, but they report a
 * fault as "some pixels differ" at a width, and the fault this ticket fixed is
 * specifically *a bar covering a list*. Stated as pixels it is indistinguishable
 * from a font that loaded late. Stated as "the last Recent row's bottom is below
 * the bar's top", it is the defect itself, in the terms the ticket used.
 *
 * ## Why `/training`
 *
 * It is the screen the defect was measured on: at 1440×900 the bar held the
 * bottom ~130px of the viewport over the Recent list, cutting it mid-row. It is
 * also the only one of the two where the covering is unambiguous — `/`'s content
 * is short enough at some widths that the bar covers nothing and a passing
 * assertion would prove nothing.
 *
 * ## The widths
 *
 * 1440 because that is the number in the ticket and it is in no baseline. 1023
 * and 1024 because a breakpoint is a claim about two adjacent pixels, and the
 * cheap way to get this wrong is to move the behaviour to the wrong side of it
 * or to smear it across a range.
 */

/**
 * The real bar, and not the skeleton's.
 *
 * `loading.tsx` takes the same class string on purpose — that is FUEL-83's whole
 * mechanism, and the property this file measures depends on it — so while `/`'s
 * skeleton is still mounted this selector matches two elements and strict mode
 * throws before a single assertion runs. It is a race rather than a fault, and
 * it has been re-run away more than once.
 *
 * `:not([aria-hidden])` settles it from the other direction: the skeleton's bar
 * is hidden from the accessibility tree because the whole skeleton is, and the
 * real bar never is. So this names the bar a *user* has, which is what every
 * assertion below is about anyway.
 */
const BAR = "main .action-bar-fade:not([aria-hidden])";

/** The last row of the Recent list — the content the pinned bar used to cover. */
const LAST_RECENT_ROW = 'ul[aria-label="Recent sessions"] > li:last-child';

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (!box) throw new Error("element is not visible, so it has no box");

  return box;
};

/**
 * `position` as the browser resolves it, which is the only place the media query
 * has actually been applied. Read off the element rather than off the class list
 * for that reason — a class list is what the unit suite already has.
 */
const positionOf = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).position);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
  await page.goto("/training");
  await expect(page.getByRole("main")).toBeVisible();

  // The bar is conditional — `/training` renders it only when there is a session
  // — so without this every assertion below would be made against nothing and
  // the spec would pass by describing an empty page.
  await expect(page.locator(BAR)).toBeVisible();
});

test("is released at 1024 and pinned at 1023", async ({ page }) => {
  await page.setViewportSize({ width: 1023, height: 900 });
  expect(await positionOf(page.locator(BAR)), "at 1023px").toBe("sticky");

  await page.setViewportSize({ width: 1024, height: 900 });
  expect(await positionOf(page.locator(BAR)), "at 1024px").toBe("static");
});

test("does not cover the Recent list at 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const bar = await boxOf(page.locator(BAR));
  const row = await boxOf(page.locator(LAST_RECENT_ROW));

  // The defect, stated as the ticket states it. A pinned bar sits over the list,
  // so the row's bottom edge falls below the bar's top; released, the bar is
  // after the list in the column and the row ends above it.
  expect(row.y + row.height, "last Recent row's bottom vs the bar's top").toBeLessThanOrEqual(
    bar.y,
  );
});

test("still clears the navigation shell at 375, which FUEL-65 fixed", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  const bar = await boxOf(page.locator(BAR));
  // By name: `/training` has three `<nav>`s — the § Navigation shell, the date
  // paginator and the week nav — and an unnamed lookup would resolve to whichever
  // came first, then measure the bar against a paginator.
  const shell = await boxOf(page.getByRole("navigation", { name: "Primary" }));

  // The half this ticket must not disturb, asserted rather than trusted to the
  // baselines. Below `lg` the shell is pinned to the viewport and the bar clears
  // it by `--nav-shell-h`; a release that leaked below the breakpoint would put
  // the shell back on top of the primary, which is the state FUEL-65 existed to
  // end.
  expect(await positionOf(page.locator(BAR)), "at 375px").toBe("sticky");
  expect(bar.y + bar.height, "bar's bottom vs the shell's top").toBeLessThanOrEqual(shell.y + 0.5);
});

test("sits at the foot of a tall viewport rather than mid-screen", async ({ page }) => {
  /*
   * AC #4, and the failure mode that releasing the pinning could plausibly have
   * introduced. `mt-auto` inside a `flex-1` `<main>` is what puts the bar at the
   * bottom of the screen when the content does not reach it; drop either and a
   * static bar lands directly under the content with a gap beneath, which at
   * 1920 is the phone's old mid-screen failure with no thumb left to explain it.
   *
   * **1200 and no longer 1920 — FUEL-77.** This is now a claim about one band
   * rather than about every desktop width. At the frame's cap the screen becomes
   * two columns and the bar takes a place in that grid, which packs its rows to
   * the top: § Desktop's "the primary action sits at the end of its column" is
   * drawn by the mock as 30px under the last figure, and `mt-auto` goes inert
   * there because the bar's grid area is its own height. That is the same shape
   * as this ticket's own `bottom-[…]` going inert under `lg:static`, and it is
   * recorded on FUEL-72 as a change to what this ticket shipped.
   *
   * What survives is the 1024–1271 band, where the frame is fluid, there is no
   * second column, and `mt-auto` is still the only thing between the bar and the
   * middle of the screen. `page-columns.spec.ts` holds the other side of the
   * seam, so both behaviours are asserted rather than one being assumed from the
   * other.
   */
  await page.setViewportSize({ width: 1200, height: 1600 });

  const bar = await boxOf(page.locator(BAR));
  const viewport = page.viewportSize();

  expect(await positionOf(page.locator(BAR))).toBe("static");
  expect(
    (viewport?.height ?? 0) - (bar.y + bar.height),
    "gap between the bar's bottom and the foot of the viewport",
  ).toBeLessThan(2);
});
