/**
 * The fixed points the visual suite is built on: when it is, how wide it is,
 * and which screens it draws.
 *
 * Shared by `playwright.config.ts` (which turns the widths into projects and
 * hands the instant to the server) and by the specs (which draw the screens and
 * pin the browser's own clock to the same instant). One definition, because a
 * server frozen to one moment and a browser frozen to another is a bug whose
 * only symptom is an occasional one-pixel diff.
 */

/**
 * The instant every run pretends it is: **Wednesday 17 June 2026, 18:54 BST**.
 *
 * Chosen rather than picked:
 *
 *   - **Wednesday**, so `/plan`'s week grid has real days either side of today
 *     and the today column is not against an edge where a border could hide a
 *     regression.
 *   - **18:54**, which is the time `BRAND_GUIDE.html` draws Right Now at, six
 *     minutes before the 19:00 dinner slot. The day ruler gets its full range —
 *     logged meals behind the NOW mark, one still ahead of it — instead of the
 *     empty morning or the finished night.
 *   - **June**, so the demo's twelve weeks of history sit well clear of a DST
 *     transition in `Europe/London`, which is the zone the demo profile is
 *     provisioned in (`src/lib/seed/persona.ts`).
 *
 * Written as UTC because that is unambiguous; 17:54Z is 18:54 in BST.
 */
export const FROZEN_NOW = "2026-06-17T17:54:00.000Z";

/** `FROZEN_NOW` as epoch milliseconds, for `page.clock.setFixedTime`. */
export const FROZEN_NOW_MS = Date.parse(FROZEN_NOW);

/** The port the suite's own `next start` listens on. */
export const PORT = 3100;

export const BASE_URL = `http://localhost:${PORT}`;

/** Where the setup project leaves the provisioned demo session. */
export const STORAGE_STATE = "tests/visual/.auth/demo.json";

/**
 * The four widths.
 *
 * § Desktop of the Brand Guide names four bands (BRAND_GUIDE.md § The
 * breakpoints); these are one width from each, chosen where the band is most
 * likely to break rather than at its midpoint.
 *
 * | Width | Band | Why this one |
 * |---|---|---|
 * | 375 | < 768, the phone | The width the PRD names as dominant, and the width `BRAND_GUIDE.html` draws at |
 * | 820 | `md`, 768–1023 | iPad portrait — the case § Desktop names by hand when it claims the band for FUEL-79 |
 * | 1272 | `xl` | The frame's cap, and the mock's second true width, so a diff here is comparable against the drawing |
 * | 1920 | wide | Where § Desktop measured the faults this milestone exists to fix |
 *
 * **1272 and not the 1280 in TESTING_STRATEGY § 2.3.** § Desktop redefines
 * Tailwind's `xl` from 1280 to 1272, "because the frame is a sum of its columns
 * and 1280 would leave 8px belonging to no column". Baselining at 1280 would
 * photograph the frame with 8px of slack beside it and call that the reference.
 * The strategy has been amended to match rather than left to disagree.
 *
 * **The gap, stated:** 1024–1271 — where the rail has appeared and the action
 * bars have unstuck, but the frame is still fluid — gets no baseline. Four
 * widths cannot cover five bands, and this is the band whose two neighbours
 * bracket it most closely. It is a gap, not an oversight.
 */
export const WIDTHS = [
  { width: 375, height: 667 },
  { width: 820, height: 1180 },
  { width: 1272, height: 900 },
  { width: 1920, height: 1080 },
] as const;

export const THEMES = ["light", "dark"] as const;

/**
 * The seven screens.
 *
 * These are the seven *routes* under `(app)` — exactly the set FUEL-77 and
 * FUEL-78 between them recompose, which is what these baselines exist to hold
 * still.
 *
 * They are not quite the seven that `BRAND_GUIDE.html` draws, and the difference
 * is worth naming. The mock's seven are Right Now, Meal picker, Meal detail,
 * Training, Weight, Week plan and Day complete — three of which are states on
 * `/` rather than addresses, and none of which are `/shopping`, `/settings` or
 * `/plan/template`. Baselining the mock's set literally would have left three of
 * the five screens FUEL-78 recomposes with no coverage at all, to gain coverage
 * of a sheet that FUEL-73 is about to redraw anyway.
 *
 * So: the picker sheet, the meal detail and the day-complete summary are **not
 * covered here**. FUEL-48 owns the flow specs that will have to open those
 * states regardless, and adding them there costs a fixture rather than a second
 * harness.
 *
 * **The sheet's half of that is now spent, and `sheet-open.spec.ts` holds it.**
 * FUEL-73 redrew the sheet — it stands in the measure's column above 1024px
 * rather than centring on the window — so the state this list deferred as "about
 * to be redrawn" has been, and it is baselined by the same eight projects
 * against this same list of widths. The day-complete summary is still FUEL-48's,
 * and so is the meal detail, which is a screen the mock draws and the app has no
 * route for.
 *
 * `slug` is the baseline's filename and must stay stable — renaming one orphans
 * eight committed PNGs.
 *
 * `settlesOn` names a heading that only appears once an asynchronous client
 * check has finished. Only `/settings` needs one, and the reason is worth
 * recording: `push-form.tsx:126` renders **nothing** while it awaits
 * `navigator.serviceWorker.ready`, then mounts a section, so the page is 155px
 * taller a moment after it looks finished. Seven of the eight settings baselines
 * passed the first time by winning that race and one did not — which is the
 * worst possible outcome, because it would have read as a flake rather than as
 * the real late mount it is. Waiting on the heading makes the screen's own
 * readiness the condition instead of the machine's speed.
 */
export const SCREENS = [
  { slug: "right-now", path: "/" },
  { slug: "plan", path: "/plan" },
  { slug: "plan-template", path: "/plan/template" },
  { slug: "training", path: "/training" },
  { slug: "weight", path: "/weight" },
  { slug: "shopping", path: "/shopping" },
  { slug: "settings", path: "/settings", settlesOn: "Notify this device" },
  /**
   * The other two states of `/` — FUEL-77.
   *
   * § Desktop's per-screen table gives day-complete a composition of its own,
   * and FUEL-77 gives one to nothing-planned; both are states of `/` and neither
   * is reachable from the demo at the frozen instant, which is 18:54 with dinner
   * still ahead. `/dev/right-now` addresses every state by URL and is the only
   * way to photograph these two at all.
   *
   * `capture` is why they can be photographed usefully. The specimen page ends
   * in a case switcher, so a `fullPage` shot of it would put a row of links in
   * the baseline and re-baseline both screens every time a case is added. The
   * screen under test is `<main>`, and that is what is compared.
   *
   * The rail is absent here, as it is on every `/dev/*` page. What these
   * baselines hold is the composition inside `<main>`: the crop marks closing
   * the summary rather than the window, and nothing-planned taking the same two
   * columns as the timeline state.
   */
  {
    slug: "right-now-day-complete",
    path: "/dev/right-now?case=complete",
    capture: "main",
  },
  {
    slug: "right-now-nothing-planned",
    path: "/dev/right-now?case=empty",
    capture: "main",
  },
] as const satisfies readonly {
  slug: string;
  path: string;
  settlesOn?: string;
  /** A selector to photograph instead of the whole page. */
  capture?: string;
}[];
