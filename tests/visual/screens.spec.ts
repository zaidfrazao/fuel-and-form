import { expect, test } from "@playwright/test";

import { FROZEN_NOW_MS, SCREENS } from "./constants";

/**
 * The screens, at four widths, in both themes — 72 baselines.
 *
 * TESTING_STRATEGY § 2.3. The width and the theme are the Playwright *project*
 * (see playwright.config.ts), so this file describes one screen once and the
 * matrix falls out of the configuration rather than out of eight nested loops.
 *
 * Seven of the nine are the mock's own screens at their own routes. The last two
 * are the other states of `/` — day-complete and nothing-planned — which no
 * route can reach at the frozen instant and which `/dev/right-now` addresses by
 * URL; `constants.ts` carries that argument beside them.
 */

test.beforeEach(async ({ page }) => {
  /**
   * The browser's clock, pinned to the same instant the server is frozen at.
   *
   * Most of what these screens show is rendered on the server and is already
   * held still by `freeze-clock.mjs`. This closes the gap for anything that
   * reads the clock after hydration — and, more usefully, it means a component
   * that starts doing so later cannot introduce drift that only shows up as an
   * occasional failed diff months from now.
   *
   * `setFixedTime` rather than `install()`: it fixes what `Date.now()` answers
   * and leaves timers running. Faking the timers as well would stop anything
   * waiting on one, and a page that never finishes settling is a screenshot of a
   * spinner.
   */
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

for (const screen of SCREENS) {
  const { slug, path } = screen;
  const settlesOn = "settlesOn" in screen ? screen.settlesOn : undefined;
  const capture = "capture" in screen ? screen.capture : undefined;

  test(slug, async ({ page }) => {
    await page.goto(path);

    /**
     * A screen is ready when its `<main>` is on the page. Asserting it before
     * the screenshot means a route that has started redirecting to `/login` —
     * an expired session, a broken cookie — fails here, naming the problem,
     * rather than quietly rewriting the baseline into a picture of the login
     * form on the next `--update-snapshots`.
     */
    await expect(page.getByRole("main")).toBeVisible();

    /**
     * A screen with an asynchronous client check has a second readiness
     * condition, and `<main>` being visible is not it — see `settlesOn` in
     * constants.ts. Without this the screenshot races a section that mounts a
     * beat later and the page grows underneath the comparison.
     */
    if (settlesOn) {
      await expect(page.getByRole("heading", { name: settlesOn })).toBeVisible();
    }

    // No webfont, but the system stack still resolves through fontconfig and a
    // frame painted before it settles measures text at fallback metrics.
    await page.evaluate(() => document.fonts.ready);

    /**
     * Wait for the document to stop growing before capturing it.
     *
     * `fullPage` asks the browser for the whole scroll height, and that number is
     * not final the moment `<main>` becomes visible. `/plan/template` at 1920
     * caught this on `main`: one frame came back 1920×1120 — the viewport plus a
     * notice band — where the settled page is 1920×2776. The *content* in that
     * frame was correct and the final capture matched the baseline byte for
     * byte; only the height Playwright measured was wrong, so it could not find
     * two consecutive stable frames and timed out.
     *
     * It surfaced on a fast run rather than a slow one, which is what makes this
     * worth an explicit wait rather than a longer timeout: on a quiet machine the
     * capture starts sooner and is more likely to beat the layout, so the
     * failure gets *more* likely as the machine gets better.
     *
     * Three matching samples at 100ms is 300ms of a genuinely stationary height.
     */
    await page.waitForFunction(
      () => {
        const store = window as unknown as { __h?: number; __same?: number };
        const height = document.documentElement.scrollHeight;

        if (store.__h === height) {
          store.__same = (store.__same ?? 0) + 1;
        } else {
          store.__h = height;
          store.__same = 0;
        }

        return (store.__same ?? 0) >= 3;
      },
      undefined,
      { polling: 100, timeout: 15_000 },
    );

    /**
     * `fullPage`, because this milestone is about composition — what gains a
     * column, what stays at the measure, what the frame does with the width left
     * over — and half of that is below the fold at 375px.
     *
     * The cost, stated: a sticky element is painted once, at its resting place
     * in the document, so these baselines do not show the action bars *pinned*.
     * FUEL-72 removes that pinning above 1024px anyway, and the two widths below
     * it are where the sticky behaviour is unchanged and already covered by the
     * unit suite's DOM assertions.
     */
    /**
     * 15s rather than the default 5s, for the stability comparison rather than
     * for a slow page. `toHaveScreenshot` captures repeatedly until two
     * consecutive frames match; the height wait above makes an unstable frame
     * unlikely, and this keeps one from failing the run outright.
     */
    /**
     * A `capture` selector photographs that element instead of the document —
     * FUEL-77, and only the two `/dev/right-now` states use it. The specimen
     * page carries a case switcher below the screen, so a full-page shot would
     * bake a row of links into the baseline and re-baseline both screens every
     * time a case is added. `fullPage` has no meaning for a locator: it captures
     * the element's whole box, scrolling to it if it has to.
     */
    if (capture) {
      await expect(page.locator(capture)).toHaveScreenshot(`${slug}.png`, {
        timeout: 15_000,
      });
      return;
    }

    await expect(page).toHaveScreenshot(`${slug}.png`, { fullPage: true, timeout: 15_000 });
  });
}
