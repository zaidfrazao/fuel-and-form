import { type Locator, type Page, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * `/training`'s session bar, which is pinned where every other bar is released
 * — Brand Guide § Desktop, FUEL-90, and the fault FUEL-106 fixed.
 *
 * § Desktop names exactly one exception to FUEL-72's desktop release: "that one
 * state's bar stays sticky at every width", because "a live readout that
 * scrolls out of sight has failed at its only job at 1920 exactly as at 375".
 * The exception was written into `action-bar.ts`, argued in three places, and
 * **not implemented at `xl`**. Both halves of it were wrong at once:
 *
 *   - the bar scrolled away above 1272, because a grid item's containing block
 *     is its own grid area and a sticky box cannot travel outside one; and
 *   - between 1024 and 1272, where it did stick, it stuck 86px above the foot
 *     of the viewport — `--nav-shell-h`, the height of a shell that is not
 *     there at that width.
 *
 * ## Why this is a separate file from `action-bar.spec.ts`
 *
 * That file is about the release: three bars that stop being pinned at `lg`,
 * asserted at 1023 and 1024 either side of it. This one is about the single bar
 * exempt from that rule, and the widths it needs are the ones where the
 * exception was never true. Folding them together would make one file argue
 * both sides of § Desktop's sentence, and the `beforeEach` is different anyway
 * — every assertion here has to enter the session state first.
 *
 * ## Why a class name would not do
 *
 * The ticket's own criterion, and it is the point of the file: `sticky` was in
 * the class string for the whole time the bar was not sticky. `action-bar.test.tsx`
 * asserted that string and passed, because jsdom applies no stylesheet and
 * cannot see a containing block. The baselines could not see it either — the
 * session state is deliberately left out of `constants.ts`'s screen list, and a
 * full-page capture would not show a scroll position regardless. So the
 * measurement is the bar's real distance from the foot of the viewport, taken
 * again at each step of a real scroll, which is the form the fault was reported
 * in: the gap grew by exactly the scroll distance.
 */

/**
 * The real bar, and not the skeleton's — `action-bar.spec.ts` carries the full
 * argument. `loading.tsx` shares the class string by design, so while `/`'s
 * skeleton is mounted this selector matches two elements and strict mode throws
 * before an assertion runs. The skeleton is `aria-hidden`; the real bar never
 * is.
 */
const BAR = "main .action-bar-fade:not([aria-hidden])";

/**
 * The four widths the criterion names, one from each of § Desktop's bands.
 *
 * The two below the frame's cap are shorter than they were — 375×600 rather
 * than ×667, 1100×540 rather than ×600 — and the widths are the ones the
 * criterion names. FUEL-109 put every bar below 1272 on one row, 58px shorter
 * than the slab over a pair, and this state's page lost the same 58: travel
 * fell from 150 to 92 at 375 and from 134 to 76 at 1100, both under the 100
 * that `gapsWhileScrolling` requires before a measurement means anything. The
 * height is this file's instrument, not its subject — the bar clears the shell
 * at 375×667 in the test below, which keeps the named size.
 */
const WIDTHS = [
  { width: 375, height: 600, band: "the phone" },
  { width: 1100, height: 540, band: "the fluid band above the shell" },
  { width: 1272, height: 900, band: "the frame's cap" },
  { width: 1920, height: 1080, band: "wide" },
] as const;

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (!box) throw new Error("element is not visible, so it has no box");

  return box;
};

/**
 * `position` as the browser resolves it, which is the only place a media query
 * has actually been applied.
 */
const positionOf = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).position);

/**
 * Enter the session state through the control a reader uses.
 *
 * Seeding `localStorage` directly would be one line shorter and would also pass
 * against a build where Start session had stopped working — the state is a
 * boolean keyed to the date (`training.tsx`), and writing it by hand asserts
 * that the key is spelled right rather than that the state is reachable.
 *
 * The marker on the way in is the timer row's `Rest` label, which renders in
 * this state and nowhere else. Explicitly NOT `role="timer"`: that element is
 * inside the timer's *running* branch — `rest-timer.tsx` draws presets until a
 * rest is started — so waiting on it would wait for a state this file never
 * enters, and every assertion below would fail as a timeout at the door.
 */
const TIMER_ROW = "the session bar's timer row";

async function enterSession(page: Page) {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
  await page.goto("/training");
  await expect(page.getByRole("main")).toBeVisible();

  // The bar is conditional on there being a session at all, so without this a
  // failure to find it would arrive later as a confusing box-less error.
  // `:visible` because this is still the plan state, which renders its bar
  // twice since FUEL-118. Once the session is entered there is one bar again,
  // and `BAR` needs nothing added.
  await expect(page.locator(`${BAR}:visible`)).toBeVisible();

  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.locator(BAR).getByText("Rest", { exact: true }), TIMER_ROW).toBeVisible();
}

/**
 * The bar's distance from the foot of the viewport, taken again at every step
 * of a scroll to the bottom of the page.
 *
 * A pinned bar holds one number the whole way down. A bar that is only
 * *declared* sticky returns the scroll position added to it, which is exactly
 * how the fault was reported: 261, 411, 561, 711 at 1440×900, growing by the
 * 150px between samples.
 *
 * Sampled as fractions of the page's own travel rather than in fixed steps.
 * The first draft stepped by 150 and asserted more than two steps existed,
 * which the 375 case fails honestly: the session state there is one exercise
 * and its sets, and it overran a 667px viewport by 150px in total — 92 since
 * FUEL-109's one-row bar, which is why `WIDTHS` draws the phone 600 tall. A
 * fixed step would either skip that width or shrink until it measured nothing
 * at the wide ones. Five samples describe the same line at any length.
 */
async function gapsWhileScrolling(page: Page, samples = 5) {
  const bar = page.locator(BAR);
  const viewport = page.viewportSize();

  if (!viewport) throw new Error("the test needs a viewport to measure against");

  const travel = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );

  /*
   * A page with nothing to scroll cannot show this fault, so measuring one
   * would pass by describing a still picture. Asserted rather than assumed —
   * a change that made this state shorter than the viewport at some width
   * would otherwise turn this file green by removing its subject.
   */
  /*
   * 100 and not a token 1px. The fault this file exists to catch shows up as
   * the gap growing by the scroll distance, so a page that scrolls 40px would
   * report a 40px drift — a number small enough to read as a rounding artefact
   * beside the 0.5px ones below. The viewport heights above are chosen to leave
   * more travel than that at every width; this is what says so if one changes.
   */
  expect(
    travel,
    "the page must actually scroll for this measurement to mean anything",
  ).toBeGreaterThan(100);

  const gaps: { scrollY: number; gap: number }[] = [];

  for (let i = 0; i < samples; i += 1) {
    const target = Math.round((travel * i) / (samples - 1));

    await page.evaluate((to) => window.scrollTo(0, to), target);
    await page.waitForFunction((to) => Math.abs(window.scrollY - to) < 1, target);

    const box = await boxOf(bar);

    gaps.push({ scrollY: target, gap: viewport.height - (box.y + box.height) });
  }

  return gaps;
}

test.describe("the session state", () => {
  test.beforeEach(async ({ page }) => {
    await enterSession(page);
  });

  test("stays pinned to the foot of the viewport through a whole scroll", async ({ page }) => {
    for (const { width, height, band } of WIDTHS) {
      await page.setViewportSize({ width, height });

      const gaps = await gapsWhileScrolling(page);
      const first = gaps[0]!.gap;

      for (const { scrollY, gap } of gaps) {
        expect(
          Math.abs(gap - first),
          `at ${width} (${band}), scrolled to ${scrollY}: the bar's gap under the viewport foot drifted from ${first}`,
        ).toBeLessThan(1);
      }

      expect(await positionOf(page.locator(BAR)), `at ${width} (${band})`).toBe("sticky");
    }
  });

  test("clears the shell below 1024 and the viewport's own foot above it", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const bar = await boxOf(page.locator(BAR));
    /*
     * By name: `/training` has three `<nav>`s — the § Navigation shell, the date
     * paginator and the week nav — and an unnamed lookup would measure the bar
     * against whichever came first.
     */
    const shell = await boxOf(page.getByRole("navigation", { name: "Primary" }));

    expect(bar.y + bar.height, "at 375, the bar's bottom vs the shell's top").toBeLessThanOrEqual(
      shell.y + 0.5,
    );

    /*
     * AC #2. Above 1024 the shell is a rail with no height to clear, and
     * § Desktop is explicit that this bar "is pinned above 1024px to the bottom
     * of the viewport, not to a shell height". `--nav-shell-h` is 86px at every
     * width — it is never overridden — so a bar still reading it floats a
     * shell's worth of nothing above the foot with the page moving underneath.
     */
    for (const { width, height, band } of WIDTHS.filter((w) => w.width >= 1024)) {
      await page.setViewportSize({ width, height });

      const box = await boxOf(page.locator(BAR));

      expect(
        Math.abs(height - (box.y + box.height)),
        `at ${width} (${band}), the gap between the bar's bottom and the viewport's foot`,
      ).toBeLessThan(1);
    }
  });

  test("is its own height and not the height of the space it sits in", async ({ page }) => {
    /*
     * AC #3, and the reason `xl:self-start` was in `PAGE_MEASURE_FOOT` in the
     * first place: row three is `1fr`, a grid item stretches to its area by
     * default, and the bar grew an 800px `bg-background` box beneath itself on a
     * tall window. Nothing was drawn wrong, which is why it has to be measured —
     * `action-bar.spec.ts` and `page-columns.spec.ts` both measure this box, and
     * one that is not the bar's own height makes every number they report mean
     * something slightly different from what it says.
     *
     * Two viewport heights at one width. The bar's content is identical in both,
     * so its own height cannot change; a box sized by its container would.
     */
    await page.setViewportSize({ width: 1272, height: 900 });
    const short = await boxOf(page.locator(BAR));

    await page.setViewportSize({ width: 1272, height: 2000 });
    const tall = await boxOf(page.locator(BAR));

    expect(tall.height, "the bar's height at 1272×2000 vs 1272×900").toBeCloseTo(short.height, 0);
  });

  test("clears the measure's last section rather than resting over it", async ({ page }) => {
    /*
     * The one thing `xl:self-end` depends on, asserted rather than trusted.
     *
     * The bar spans the frame's content rows and aligns to their foot, so its
     * resting place is the bottom of whichever column is taller. In this state
     * that is always the aside — the measure holds one exercise and its sets, the
     * aside holds the whole session, the adherence grid and the recent list. If
     * that ever inverted, the flexible row would collapse and a box aligned to
     * the end of the span would be drawn over the foot of the measure, opaquely
     * and with nothing else to report it.
     */
    for (const { width, height, band } of WIDTHS.filter((w) => w.width >= 1272)) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // The real condition, and not `() => true`: scrolling to the bottom is
      // the point of this assertion — that is where the bar comes to rest and
      // where an overlap would appear — so the wait has to be that the scroll
      // actually got there. A wait that is trivially satisfied reads as
      // synchronisation and provides none.
      await page.waitForFunction(() => {
        const doc = document.documentElement;

        return Math.abs(window.scrollY - (doc.scrollHeight - window.innerHeight)) < 1;
      });

      const clearance = await page.evaluate((sel) => {
        const bar = document.querySelector(sel)!.getBoundingClientRect();
        const sections = [...document.querySelectorAll('[data-column="measure"] section')];
        const last = sections.at(-1)!.getBoundingClientRect();

        return bar.top - last.bottom;
      }, BAR);

      expect(
        clearance,
        `at ${width} (${band}), the bar's top vs the measure's last section`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  test("keeps § The Scroll Edge's mask wherever it is pinned", async ({ page }) => {
    /*
     * AC #5. The shared `action-bar-fade` rule is scoped `@media (width < 64rem)`
     * because that is where the other three bars are pinned; this bar is pinned
     * past it, so `action-bar-fade-pinned` carries the same value unconditionally.
     * A fix that changed which class the bar wears could drop the mask above `lg`
     * and nothing else would notice — the edge is invisible to the unit suite and
     * appears only once a list is long enough to run under the bar.
     */
    for (const { width, height, band } of WIDTHS) {
      await page.setViewportSize({ width, height });

      const mask = await page
        .locator(BAR)
        .evaluate((node) => getComputedStyle(node).maskImage);

      expect(mask, `at ${width} (${band}), the bar's mask-image`).not.toBe("none");
    }
  });
});

test("leaves the plan state and `/` released, which is FUEL-72's ruling", async ({ page }) => {
  /*
   * AC #4. The exception is one bar, and the cheapest way for a fix to be wrong
   * is for it to reach the shared string and release nothing. Measured at 1440
   * because that is the width FUEL-72 was measured at.
   *
   * ## Outside the `describe` above, and it has to be
   *
   * This test wants the plan state, and the obvious way to reach it from the
   * session state is to press the primary — which is what the first draft did,
   * and which RECORDS THE SESSION. Entering costs nothing (the state is one
   * boolean in `localStorage`) but leaving writes a row, and the demo is
   * provisioned once for the whole run by `demo.setup.ts`: every project after
   * this one then photographed a day with a logged session on it. Twenty
   * baselines failed, on `/` and on `/training` and in the swap sheet, none of
   * which this ticket touches — `/`'s phone capture came back 58px taller,
   * which is a recorded status appearing, not a bar moving.
   *
   * So the plan state is reached by simply not entering the session, which is
   * also what a reader arriving at the screen gets. Nothing here writes.
   */
  await page.clock.setFixedTime(FROZEN_NOW_MS);
  await page.goto("/training");
  await expect(page.getByRole("main")).toBeVisible();

  // The plan state renders its bar twice since FUEL-118, like `/`'s below, so
  // `:visible` is added here for the same reason and in the same place.
  const plan = page.locator(`${BAR}:visible`);

  await expect(plan).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });

  // The state a reader lands in — the timer row belongs to the other one.
  await expect(plan.getByText("Rest", { exact: true }), TIMER_ROW).toBeHidden();

  expect(await positionOf(plan), "`/training`'s plan state at 1440").toBe("static");

  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();

  // `/` renders its bar twice since FUEL-114 (a sticky copy below 1024 and a
  // released one under the subject from 1024) and CSS draws one, so the
  // selector resolves to both and strict mode throws without `:visible`. It is
  // added here and not to `BAR`, because `:visible` is Playwright's and this
  // file also hands `BAR` to `document.querySelector`.
  const drawn = page.locator(`${BAR}:visible`);

  await expect(drawn).toBeVisible();

  expect(await positionOf(drawn), "`/`'s bar at 1440").toBe("static");
});
