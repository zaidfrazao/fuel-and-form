import { type Locator, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The frame, measured — Brand Guide § Desktop, FUEL-70.
 *
 * Its three claims are all numbers about a rendered page, and every cheaper
 * place to assert them is blind to all three. jsdom has no layout, so the unit
 * suite can hold which classes an element wears and nothing about where it
 * lands; the baselines hold the picture but report a fault as "some pixels
 * differ" rather than as "the banner is 124px left of the column". § Desktop
 * states the faults as measurements, so this is where they are answered.
 *
 * ## Why one spec that resizes, rather than the project matrix
 *
 * `screens.spec.ts` gets its width from the Playwright project, which is right
 * for a screenshot: one picture per width, per theme, and the matrix falls out
 * of the configuration. This asks a different question — whether two boxes share
 * a centre — and the answer has no theme and does not want eight runs. Four
 * widths in one browser is the whole of it, and `1440` in particular is a width
 * no baseline covers: it is the far side of the frame's cap, where the container
 * has started to centre and a fault would show as a *growing* offset.
 *
 * ## Why `/shopping`
 *
 * It is the screen § Desktop measured the original faults on — the 544px void,
 * the 516px on the right, the 124px offset — so the numbers here and the numbers
 * in the guide are about the same page. It is also the plainest: a single list
 * at the measure, with no aside and no second column to complicate the arithmetic.
 */

/** The demo banner's inner box: `aside` > frame > measure. */
const BAND_MEASURE = 'aside[aria-label="Demo session"] > div > div';

/** An element's border box, in page coordinates. */
const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (!box) throw new Error("element is not visible, so it has no box");

  return box;
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

/**
 * The four widths the ticket names. 1024 is where the rail appears, 1272 is the
 * frame's cap, and 1280 and 1440 are both past it — the two that would drift if
 * anything were still centring on the viewport.
 */
const WIDTHS = [1024, 1280, 1440, 1920];

/**
 * ## This asked about centres until FUEL-78, and a centre was a proxy
 *
 * § Desktop states the rule as a position rather than as a centre: the notice
 * bands "stop having a centre of their own: **they take the measure's
 * position**", which is what `walk-reminder.tsx` says it wants — "the width and
 * padding match every page's `main`, so the sentence lines up with the content
 * beneath it". And the section is explicit about the frame generally:
 * "**content is left-aligned in the frame, not centred in it.** ... Every screen
 * puts its measure at the same x whether or not it has an aside."
 *
 * While every `<main>` in the app was exactly the measure, an equal centre and
 * an equal x were the same assertion, and the centre was the one written. They
 * stopped being the same assertion at FUEL-77, which gave `/` and `/training` a
 * `<main>` spanning the measure and the aside — this test never looked at those
 * two, so it went on passing — and FUEL-78 removes the last screen where the
 * proxy held: `/shopping` now spans the frame for its list while its header
 * stays on the measure.
 *
 * So the offset is measured where § Desktop puts it. The band's inner box and
 * `<main>` begin at the same x, and the band is still the measure's width,
 * because § Desktop's amendment leaves prose on the measure — a demo notice is
 * a sentence. A band that had drifted from the column, which is the 124px fault
 * this file was written for, fails on the first assertion; a band that had been
 * widened to follow the content fails on the second.
 */
test("the notice band begins where the content column begins", async ({ page }) => {
  await page.goto("/shopping");
  await expect(page.getByRole("main")).toBeVisible();

  // The session is a demo, so the banner is there. Asserted rather than assumed:
  // without it every offset below would be measured against nothing and pass.
  await expect(page.locator(BAND_MEASURE)).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    const band = await boxOf(page.locator(BAND_MEASURE));
    const main = await boxOf(page.getByRole("main"));

    expect(Math.abs(band.x - main.x), `banner x at ${width}px`).toBeLessThan(0.5);

    // The measure's width, whatever the page beside it has taken. 640 at every
    // width here: `WIDTHS` starts at 1024, where the frame's second track is
    // already the full measure.
    expect(band.width, `banner width at ${width}px`).toBeCloseTo(640, 0);
  }
});

test("the void between the rail and the content is the frame's gutter", async ({ page }) => {
  await page.goto("/shopping");
  await expect(page.getByRole("main")).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    const rail = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    const main = await page.getByRole("main").boundingBox();

    if (!rail || !main) throw new Error("the rail and the content must both be visible");

    // 28px, § Spacing's ≥768px gutter doing the same job between columns. It was
    // 544px of leftover space at 1920 before the frame, and leftover space is
    // what a gutter stops being: this number does not move with the window.
    expect(main.x - (rail.x + rail.width), `gutter at ${width}px`).toBeCloseTo(28, 0);
  }
});

test("/plan does not push off the right of the screen at 1024", async ({ page }) => {
  /**
   * The one failure `min-w-0` exists to prevent, at the exact width it happens
   * at — FUEL-58 measured it as 248px off the right edge, and it is silent
   * everywhere else. The frame did not retire it: `min-width: auto` is a
   * property of the item in a grid too, and a fixed track does not grow to fit
   * an item that refuses to shrink.
   *
   * The week grid itself scrolls, inside its own `overflow-x-auto` box. That is
   * the intended behaviour and is why the assertion is about the DOCUMENT's
   * scroll width rather than the grid's.
   */
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/plan");
  await expect(page.getByRole("main")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow, "horizontal overflow at 1024px").toBe(0);
});
