import { expect, test } from "@playwright/test";

import { FROZEN_NOW_MS, SCREENS } from "./constants";

/**
 * Widening the window never makes a screen worse — FUEL-79's fourth criterion.
 *
 * "The transition across every breakpoint is monotonic — widening the window
 * never makes a screen worse, at any width from 320 to 1920 (the 1023 → 1024
 * week-grid regression is FUEL-71's, and must still be gone)."
 *
 * It was not gone. `/plan`'s grid measured **967px at 1023 and 776px at 1024**,
 * because below `lg` there is no rail and this screen took the whole window, and
 * at `lg` the rail and its gutter take 248px of it back. One pixel of extra
 * window cost 191px of table and about 27px off every day column. FUEL-71 fixed
 * the overflow it was named for — nothing scrolls sideways at any width — and
 * this was the other half, still standing and photographed by nothing: the
 * baselines cover 375, 820, 1272 and 1920, and the fault lives at 1024.
 *
 * ## Why this is a sweep rather than four widths
 *
 * Every other spec in this directory asks a question at a width someone chose.
 * That is the right shape for a composition — you know where the aside arrives
 * — and it is the wrong shape for this, because the failure is a width nobody
 * thought to look at. A breakpoint is a claim about two adjacent pixels and the
 * cheap way to get one wrong is to land it on the wrong side; the widths below
 * are therefore the four bands' edges and both sides of each boundary, not a
 * comfortable sample from the middle of each.
 *
 * ## What "worse" is, narrowed to something a machine can hold
 *
 * Two properties, and deliberately only two:
 *
 *   - **The content column never narrows.** `<main>`'s content box is what every
 *     screen's width ultimately resolves to, and a screen that gives back width
 *     as the window grows is the fault by definition.
 *   - **Nothing scrolls sideways.** § Accessibility: "Nothing on any screen
 *     scrolls sideways at any width from 320px to 1920px, the week grid
 *     included" — the blanket exception it used to grant was withdrawn by
 *     FUEL-71, so this is now a rule with no exceptions to encode.
 *
 * Not "the page is no taller", which reads like the same idea and is not: a
 * screen that gains a second column is shorter, a screen whose figures go
 * four-across is shorter, and a screen that has simply wrapped its prose
 * differently is neither. Height is an outcome of the composition rather than a
 * measure of it, and asserting on it would fail every time a composition
 * improved.
 *
 * ## The 767 → 768 step is a known exception and is excluded by name
 *
 * § Spacing takes the gutter from 22px to 28px at 768, so `<main>`'s content box
 * loses 12px crossing that one boundary — 596 to 584 on a screen at the measure,
 * and 723 to 712 on `/plan`, which spans. That is a rule this ticket does not
 * get to reopen: the line reads "22px mobile" and § Desktop's carry-over table
 * settles it as not carrying. It is the only place in 320–1920 where a screen
 * narrows, it is 12px, and it is recorded here rather than silently tolerated by
 * a threshold — a `toBeGreaterThanOrEqual(previous - 12)` would also pass a
 * screen that lost 12px at 1024, which is the fault this file exists for.
 */

/**
 * Both sides of every boundary, plus each band's ends.
 *
 * 776 is here and is not a breakpoint: it is `--frame-band-max`, the width at
 * which the band's cap starts binding, and the one number in this list that a
 * change to the frame could move without moving a breakpoint.
 */
const WIDTHS = [
  320, 375, 639, 640, 767, 768, 775, 776, 820, 900, 1023, 1024, 1100, 1271,
  1272, 1400, 1920,
] as const;

/** The routes, minus the two `/dev/*` specimens — those have no rail to cross. */
const ROUTES = SCREENS.filter((screen) => !screen.path.startsWith("/dev/"));

/** Where § Spacing changes the gutter, and the one narrowing this file allows. */
const GUTTER_STEP = 768;

test.describe("widening never makes a screen worse — FUEL-79", () => {
  for (const screen of ROUTES) {
    test(`${screen.slug} widens monotonically from 320 to 1920`, async ({ page }) => {
      await page.clock.setFixedTime(FROZEN_NOW_MS);

      const measured: { width: number; content: number }[] = [];

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(screen.path);

        // `screens.spec.ts`'s narrowing, for its reason: `SCREENS` is a `const`
        // tuple, so only the member that declares `settlesOn` has it. Only
        // `/settings` does — `push-form.tsx` renders nothing until it has
        // awaited `navigator.serviceWorker.ready`, then mounts a section, so the
        // page is 155px taller a moment after it looks finished.
        const settlesOn = "settlesOn" in screen ? screen.settlesOn : undefined;

        if (settlesOn) {
          await expect(page.getByRole("heading", { name: settlesOn })).toBeVisible();
        }

        /*
         * Wait for the skeleton to go, and wait for it by COUNT.
         *
         * `(app)/loading.tsx` renders a `<main>` of its own — the same race
         * `action-bar.spec.ts` documents for `APP_ACTION_BAR` — and the obvious
         * two guards both fail here. `locator("main")` throws on strict mode
         * while both are up. And filtering by `aria-hidden` does NOT work, which
         * is the trap: the skeleton marks its column GROUPS `aria-hidden` and
         * not its `<main>`, so a role query and an `aria-hidden` filter both
         * resolve to it happily.
         *
         * That is worth stating because of how it failed rather than that it
         * did. The skeleton's main is a plain `PageMain`, so it measures the
         * 584px measure at every width — a number that is correct for most
         * screens and wrong only for the ones that span. It reported `/plan`
         * "narrowing from 720px at 1024 to 584px at 1100", which reads exactly
         * like the regression this file exists to catch. A guard that silently
         * measures the wrong element is worse than no guard, because it fails
         * as the fault rather than as itself.
         *
         * One `main` on the page means the real one, and `toHaveCount` retries
         * until that is true.
         */
        await expect(page.locator("main")).toHaveCount(1);

        /*
         * The lookup happens inside the page rather than through a handle. A
         * handle resolved on the test side can be detached by a re-render before
         * `evaluate` runs, and `getComputedStyle` on a detached node returns
         * empty strings — which reached the assertion as `NaN`, comparing false
         * against every number and failing as "narrows to NaNpx at 640".
         *
         * The CONTENT box rather than the border box: `<main>` pays its own
         * 22/28px gutter inside its width, so the border box says 640 on a
         * screen whose reader has 584 — and the gutter change at 768 is exactly
         * where the two disagree.
         *
         * § Accessibility's "nothing scrolls sideways at any width" is read in
         * the same pass, because a bleed that takes width from the band is the
         * likeliest way to buy one of these with the other.
         */
        const { content, overflow } = await page.evaluate(() => {
          const main = document.querySelector("main");

          if (!main) throw new Error("no main on the page");

          const style = getComputedStyle(main);

          return {
            content:
              main.getBoundingClientRect().width -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });

        expect(
          Number.isFinite(content),
          `${screen.slug} produced no measurement at ${width}px`,
        ).toBe(true);

        expect(
          overflow,
          `${screen.slug} scrolls sideways at ${width}px`,
        ).toBeLessThanOrEqual(1);

        measured.push({ width, content: Math.round(content) });
      }

      measured.forEach((current, i) => {
        const previous = measured[i - 1];

        if (!previous) return;

        // The gutter step is the one boundary where § Spacing spends 12px of
        // content on purpose. Named, so that a narrowing anywhere else — which
        // is what 1024 was doing — cannot hide behind a tolerance.
        if (current.width === GUTTER_STEP) return;

        expect(
          current.content,
          `${screen.slug} narrows from ${previous.content}px at ${previous.width} to ` +
            `${current.content}px at ${current.width}`,
        ).toBeGreaterThanOrEqual(previous.content);
      });
    });
  }
});
