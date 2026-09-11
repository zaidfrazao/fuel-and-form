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

/**
 * The copy of the bar that is drawn at this width — FUEL-118.
 *
 * `/training`'s plan state renders its bar twice since FUEL-118: a sticky copy
 * last in the column below 1024, and a released one in the measure from 1024.
 * CSS draws one, so `BAR` matches two and strict mode throws. `:visible` is
 * Playwright's own pseudo-class, which is safe here because this file never
 * hands a selector to `document.querySelector`.
 */
const DRAWN = `${BAR}:visible`;

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
  await expect(page.locator(DRAWN)).toBeVisible();
});

test("is released at 1024 and pinned at 1023", async ({ page }) => {
  await page.setViewportSize({ width: 1023, height: 900 });
  expect(await positionOf(page.locator(DRAWN)), "at 1023px").toBe("sticky");

  await page.setViewportSize({ width: 1024, height: 900 });
  expect(await positionOf(page.locator(DRAWN)), "at 1024px").toBe("static");
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1100, height: 900 },
]) {
  test(`does not cover the Recent list at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);

    const bar = await boxOf(page.locator(DRAWN));
    const row = await boxOf(page.locator(LAST_RECENT_ROW));

    // The defect, stated as the ticket states it: a bar over the list. This
    // read "the row ends above the bar's top" until FUEL-118, which was true
    // only while the released bar came after the list. Since FUEL-118 the bar
    // is in the measure, above its exercises. At 1440 it stands beside Recent,
    // and in the band it is far above it. So what is asserted is the defect
    // itself: the two boxes do not overlap. 1100 is the band, where the two
    // share one column and a pinned bar would sit on the list again.
    const overlaps =
      bar.x < row.x + row.width &&
      row.x < bar.x + bar.width &&
      bar.y < row.y + row.height &&
      row.y < bar.y + bar.height;

    expect(overlaps, "the bar and the last Recent row share pixels").toBe(false);
  });
}

test("still clears the navigation shell at 375, which FUEL-65 fixed", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  const bar = await boxOf(page.locator(DRAWN));
  // By name: `/training` has three `<nav>`s — the § Navigation shell, the date
  // paginator and the week nav — and an unnamed lookup would resolve to whichever
  // came first, then measure the bar against a paginator.
  const shell = await boxOf(page.getByRole("navigation", { name: "Primary" }));

  // The half this ticket must not disturb, asserted rather than trusted to the
  // baselines. Below `lg` the shell is pinned to the viewport and the bar clears
  // it by `--nav-shell-h`; a release that leaked below the breakpoint would put
  // the shell back on top of the primary, which is the state FUEL-65 existed to
  // end.
  expect(await positionOf(page.locator(DRAWN)), "at 375px").toBe("sticky");
  expect(bar.y + bar.height, "bar's bottom vs the shell's top").toBeLessThanOrEqual(shell.y + 0.5);
});

test("sits under its record in the band, not at the foot of a tall viewport", async ({ page }) => {
  /*
   * FUEL-72's AC #4 put this bar at the foot of a tall viewport by `mt-auto`,
   * and FUEL-77 narrowed that to the 1024–1271 band. FUEL-118 replaces it.
   * § The two states of `/training` puts the plan state's bar in the measure
   * from 1024, under `This session` and above the exercise list, so in the band
   * it is under its subject and nowhere near the foot.
   *
   * **The old assertion had been vacuous for a while, and that is recorded
   * here.** It read "the gap between the bar's bottom and the viewport's foot
   * is under 2", at 1200×1600. After FUEL-92's groups the page was 2394px tall,
   * so on arrival the bar was at y 2312, off-screen. The gap came out at −794,
   * which is under 2 whatever the layout does.
   *
   * 1200×1600 is kept because it is the size at which the two answers differ,
   * and that is asserted too. The window is taller than the bar's foot by far
   * more than a rounding error, so a bar pushed to the foot by an auto margin
   * fails here.
   */
  await page.setViewportSize({ width: 1200, height: 1600 });

  const bar = await boxOf(page.locator(DRAWN));
  const record = await boxOf(
    page
      .locator('[data-column="measure"] > section')
      .filter({ has: page.getByRole("heading", { name: "This session" }) }),
  );
  const viewport = page.viewportSize();

  expect(await positionOf(page.locator(DRAWN))).toBe("static");
  expect(bar.y - (record.y + record.height), "record to bar").toBeCloseTo(28, 0);
  expect(
    (viewport?.height ?? 0) - (bar.y + bar.height),
    "gap between the bar's bottom and the foot of the viewport",
  ).toBeGreaterThan(300);
});
