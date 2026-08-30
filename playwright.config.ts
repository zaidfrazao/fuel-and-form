import { defineConfig, devices } from "@playwright/test";

import { testDatabaseUrl } from "./tests/integration/env";
import { BASE_URL, FROZEN_NOW, PORT, STORAGE_STATE, THEMES, WIDTHS } from "./tests/visual/constants";

/**
 * Playwright — the visual baselines (FUEL-69) and, later, the flow specs
 * (FUEL-48).
 *
 * Testing Strategy § 2.1 and § 2.3. Vitest has excluded `tests/e2e/**` and
 * `tests/visual/**` since before either directory existed (vitest.config.mts:36),
 * so the two suites cannot collide.
 *
 * ## The test branch, not the app's database
 *
 * A visual run provisions a demo, and provisioning writes about two hundred rows.
 * `DATABASE_URL` is ONE value in Vercel serving all three environments, so the
 * default string is the live database — the suite must never reach it.
 *
 * The guard is `testDatabaseUrl()`, borrowed whole from the integration suite
 * rather than reimplemented: it refuses when `DATABASE_URL_TEST` resolves to the
 * same Neon branch as `DATABASE_URL`, normalising the `-pooler` suffix so the
 * pooled and direct doors into one database are not mistaken for two.
 *
 * Where the integration suite *skips* itself when unconfigured, this one
 * **throws**. A skipped integration run measures nothing and harms nothing; a
 * visual run that quietly fell back to `DATABASE_URL` would write demo rows into
 * production and photograph them.
 */
const databaseUrl = testDatabaseUrl();

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL_TEST is not set. The visual suite provisions a demo account " +
      "(~200 rows) and must never do that against DATABASE_URL, which is the " +
      "live database. See .env.example.",
  );
}

/**
 * The eight combinations, plus the setup project they all depend on.
 *
 * Themes come from `prefers-color-scheme` alone. That is not a shortcut around a
 * toggle — it is how the app actually resolves its mode: `ThemeProvider` is
 * configured `defaultTheme="system"` with `enableSystem`, and there is no
 * in-app theme control outside `/dev/*`. Emulating the media query is therefore
 * the real path, and driving a toggle would be exercising something no visitor
 * has.
 */
const screens = WIDTHS.flatMap(({ width, height }) =>
  THEMES.map((theme) => ({
    name: `${width}-${theme}`,
    /**
     * Two files, because the sheet is drawn by the same matrix and not by the
     * same loop: `screens.spec.ts` iterates SCREENS, and a sheet is a state on a
     * screen rather than a route. Named rather than left to a substring — the
     * regex `/screens\.spec\.ts/` is unanchored and would have matched a file
     * called `sheet-screens.spec.ts` by accident, which is not a wiring anyone
     * should have to notice to keep working.
     */
    testMatch: /(screens|sheet-open)\.spec\.ts/,
    dependencies: ["setup"],
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width, height },
      colorScheme: theme,
      storageState: STORAGE_STATE,
    },
  })),
);

export default defineConfig({
  testDir: "tests",

  /**
   * Baselines land in `tests/visual/__screenshots__/`, which is the path
   * TESTING_STRATEGY § 2.3 commits to. Playwright's own default would put them
   * in a `screens.spec.ts-snapshots/` directory beside the spec.
   *
   * `{projectName}` is the width-and-theme pair, so the tree reads as a matrix:
   * `__screenshots__/1272-dark/plan.png`.
   *
   * `{platform}` is deliberately NOT in the template. Including it would let a
   * run on another operating system find no baseline, write its own, and report
   * a fresh green — the drift these files exist to catch, arriving as a pass.
   * Without it such a run fails loudly against a Linux baseline it cannot match,
   * which is the correct answer until FUEL-51 pins a container.
   */
  snapshotPathTemplate: "tests/visual/__screenshots__/{projectName}/{arg}{ext}",

  /**
   * One worker, and no parallelism inside a file.
   *
   * Pixel comparison is sensitive to how busy the machine is: eight browsers
   * racing for CPU produce half-painted frames and anti-aliasing that differs
   * run to run, which arrives as a flaky diff rather than as the contention it
   * is. It also keeps the single provisioned demo session from being read by
   * eight contexts at once.
   */
  workers: 1,
  fullyParallel: false,

  /**
   * No retries. A retried screenshot that passes on the second attempt is a
   * screenshot nobody can trust, and hiding that behind a retry count is how a
   * visual suite becomes decorative.
   */
  retries: 0,

  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    /**
     * Brand Guide § Motion: the chart and the ruler draw themselves in. An
     * animation mid-flight is a different picture every run, so the suite asks
     * for the reduced-motion treatment the guide already specifies — this is the
     * app's real behaviour for a visitor with the preference set, not a test-only
     * mode.
     *
     * Under `contextOptions` because that is where Playwright takes it; there is
     * no top-level `reducedMotion` in `use`, unlike `colorScheme`.
     */
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },

  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      /**
       * **Zero tolerance**, and it is measured rather than hoped for: two full
       * runs, each against a freshly truncated branch and a newly provisioned
       * demo, produced pixel-identical captures of all 56 screens. Nothing
       * needed absorbing, so nothing is absorbed.
       *
       * A ratio was tried first and removed. 0.2% of a full-page capture at 1920
       * is around eleven thousand pixels — enough to swallow a 100×100 element
       * moving somewhere else entirely. A tolerance loose enough to hide the
       * thing the suite exists to catch is worse than no suite, because it
       * reports green while doing it.
       *
       * If this ever starts flapping, the honest fix is to find what is moving —
       * a late mount, an animation that escaped `animations: "disabled"`, a font
       * that loaded after the frame — not to raise the number until it stops.
       * `settlesOn` in constants.ts is what that fix looked like the one time it
       * has been needed.
       */
      maxDiffPixels: 0,
    },
  },

  projects: [
    {
      name: "setup",
      testMatch: /demo\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    /**
     * The frame's measurements — FUEL-70, and a project of its own for the
     * reason `frame.spec.ts` sets out: it asks whether two boxes share a centre,
     * which has no theme and wants one browser rather than eight. It sets its
     * own viewport per assertion, so the `screens` matrix would run it eight
     * times to learn the same thing.
     */
    {
      name: "frame",
      testMatch: /frame\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
    /**
     * The action bar across the `lg` breakpoint — FUEL-72, and a project for the
     * same reason `frame` is one. It asks where a control sits relative to the
     * content beneath it, which has no theme; and it sets its own viewport per
     * assertion, including 1023, 1024 and 1440 — three widths the `screens`
     * matrix does not have and would not gain by running this eight times.
     */
    /**
     * The sheet's column across the `lg` breakpoint — FUEL-73, and a project for
     * the same reason the two above are. It asks whether the sheet and the
     * content share a left edge, which has no theme; and it needs 1023, 1024 and
     * 1440, which the `screens` matrix does not have.
     */
    {
      name: "sheet",
      testMatch: /sheet\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
    {
      name: "action-bar",
      testMatch: /action-bar\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
    /**
     * The pointer states — FUEL-75. Two projects rather than eight, and rather
     * than one.
     *
     * Both themes, because a hover state IS a colour: `surface` sits above the
     * canvas in light and below it in dark, so the two answer in opposite
     * directions and one of them would prove nothing about the other. One
     * width, because § Desktop triggers these on `@media (hover: hover)` rather
     * than on a breakpoint — there is no second width at which any of them
     * differs, and 1272 is the one where the rail exists to be photographed.
     *
     * `Desktop Chrome` reports `hover: hover`, which is what puts the states in
     * scope at all. A device with `hasTouch` would photograph the rest state
     * and pass, so the touch half of that rule is asserted in
     * `src/lib/pointer.test.ts` against the compiled CSS instead.
     */
    ...THEMES.map((theme) => ({
      name: `hover-${theme}`,
      testMatch: /hover\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1272, height: 900 },
        colorScheme: theme,
        storageState: STORAGE_STATE,
      },
    })),
    ...screens,
  ],

  /**
   * `next build` and then `next start` — never `next dev`.
   *
   * Two reasons, and the second is the one that bites. `next dev` refuses to
   * start a second instance: it exits 0 and points at the one already running,
   * so a suite launched against it would silently test whatever that server was
   * serving and report green. And dev builds differ from production ones in ways
   * that show up in a screenshot.
   *
   * The build runs here, inside the same command and the same environment, so
   * the binary being photographed is built from the working tree and against the
   * test branch. Running it as a separate script would let a stale `.next` be
   * served — a green run against last week's code.
   *
   * Port 3100 rather than 3000 so a `next dev` someone left running cannot
   * answer for us. `reuseExistingServer: false` for the same reason: a readiness
   * check that gets a 200 has only learned that *something* answered.
   */
  webServer: {
    /**
     * The clock shim is attached to `next start` alone, not to the build.
     *
     * A build has no business reading the clock, and freezing it there cost
     * something real: Next evaluates page modules in a sandbox that drops
     * inherited statics off a patched global, so the build died on
     * `Date.UTC is not a function` in a `/dev` page. freeze-clock.mjs is now
     * hardened against that, but the build still has nothing to gain from a
     * fixed clock — so it does not get one.
     */
    command:
      `npm run build && ` +
      `NODE_OPTIONS='--import ./tests/visual/freeze-clock.mjs' npm run start -- --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL: databaseUrl,
      /**
       * Read by tests/visual/freeze-clock.mjs, which the `next start` half of
       * the command above loads. See that file for why the clock and not a mask.
       */
      FUEL_FROZEN_NOW: FROZEN_NOW,
      /**
       * Pinned so nothing incidental reads the machine's zone. The app itself
       * resolves every date in `profiles.timezone` (Europe/London for the demo
       * persona), so this decides nothing the screens display — it is here so
       * that a laptop in another zone cannot become the one difference between
       * two runs.
       */
      TZ: "UTC",
    },
  },
});
