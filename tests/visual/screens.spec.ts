import { expect, test } from "@playwright/test";

import { FROZEN_NOW_MS, SCREENS } from "./constants";

/**
 * The seven screens, at four widths, in both themes — 56 baselines.
 *
 * TESTING_STRATEGY § 2.3. The width and the theme are the Playwright *project*
 * (see playwright.config.ts), so this file describes one screen once and the
 * matrix falls out of the configuration rather than out of eight nested loops.
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
    await expect(page).toHaveScreenshot(`${slug}.png`, { fullPage: true });
  });
}
