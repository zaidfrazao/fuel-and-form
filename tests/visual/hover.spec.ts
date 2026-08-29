import { expect, test, type Locator, type Page } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * One control per class, photographed with the pointer on it — FUEL-75.
 *
 * § Desktop specifies a hover for every control class in § Component Patterns,
 * and `BRAND_GUIDE.html` draws them as a specimen: rest beside a held-open
 * hover, one pair per class. This is the app's half of that specimen, and it is
 * the only test in the repository that can see a hover state at all — the
 * `screens` matrix photographs seven pages with the mouse parked at the origin,
 * which is what makes those 56 baselines the *control* for this change rather
 * than a check on it. They must come back byte-identical: nothing here alters a
 * rest state.
 *
 * ## Element screenshots, not pages
 *
 * Each specimen captures the control alone. Three reasons, in the order they
 * bite. A page capture would photograph the demo's data around the control and
 * fail whenever a seed value moved; `fullPage` measures the document height
 * while the layout is still settling, which `screens.spec.ts` records at
 * length; and a hover is a claim about one element, so a baseline that also
 * carried its neighbours would fail for reasons that had nothing to do with the
 * state under test.
 *
 * ## Both themes, one width
 *
 * A hover is a ground and a ground is a colour, so dark mode is not a
 * derivative here — `surface` sits *above* the canvas in light and *below* it
 * in dark, so the two answer in opposite directions. One width, because
 * § Desktop's states are triggered by `@media (hover: hover)` rather than by a
 * breakpoint: 1272 is where the rail exists to be photographed, and nothing
 * about any of these states changes with width.
 */

/** A control, and where to find one. */
type Specimen = {
  /** The baseline's filename. Stable — renaming one orphans its PNGs. */
  readonly name: string;
  readonly path: string;
  /** Anything that has to happen before the control is on the page. */
  readonly prepare?: (page: Page) => Promise<void>;
  readonly locate: (page: Page) => Locator;
};

/** The four button variants carry `data-variant`, which is why they are used. */
const variant = (page: Page, name: string) =>
  page.locator(`[data-variant="${name}"]`).first();

const rail = (page: Page) =>
  page.getByRole("navigation", { name: "Primary" });

/**
 * Opening the meal picker, which is where the app's only tiles live.
 *
 * `sheet-open.spec.ts` opens the same sheet from the same cell. Nothing is
 * asserted about `<main>` after this runs: the sheet sets `aria-modal`, which
 * takes the page out of the accessibility tree, so `getByRole("main")` times
 * out while it is up.
 */
const openMealPicker = async (page: Page) => {
  await page.getByRole("button", { name: /^Monday breakfast:/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

/**
 * The delete confirmation, which is where the Destructive button is filled.
 *
 * § Buttons gives that variant a fill "only inside a confirmation sheet", so
 * both of its rest states have to be photographed in two different places —
 * and § Desktop says why it is the control least affordable to get wrong:
 * "a delete that gives no feedback is a delete pressed twice". The sheet is
 * also the one place on `/weight` with a Text button that is certain to be
 * there, the rest of them being conditional on state the demo may not be in.
 *
 * Nothing is deleted: the row's control opens this and the button inside it is
 * what removes anything, which is the two-step `weigh-ins.tsx` describes.
 */
const openDeleteConfirmation = async (page: Page) => {
  await page.getByRole("button", { name: /^Delete the weigh-in/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

const SPECIMENS: readonly Specimen[] = [
  // ---- § Desktop's second row: a solid fill goes to that fill at 90% --------
  {
    name: "button-primary",
    path: "/weight",
    locate: (page) => variant(page, "default"),
  },
  {
    name: "rail-item-active",
    path: "/",
    locate: (page) => rail(page).getByRole("link", { name: "Now" }),
  },
  {
    name: "tile-ink",
    path: "/plan/template",
    prepare: openMealPicker,
    // `Tile` renders the material as `bg-ink` / `bg-surface`, which is the only
    // thing distinguishing the two tiles from outside the component.
    locate: (page) => page.getByRole("dialog").locator("button.bg-ink").first(),
  },

  // ---- § Desktop's first row: nothing, an outline or a ghost gains `surface`
  {
    name: "button-destructive-filled",
    path: "/weight",
    prepare: openDeleteConfirmation,
    locate: (page) =>
      page.getByRole("dialog").locator('[data-variant="destructive"]').first(),
  },

  // ---- § Desktop's first row: nothing, an outline or a ghost gains `surface`
  {
    name: "button-secondary",
    path: "/",
    locate: (page) => variant(page, "secondary"),
  },
  {
    name: "button-text",
    path: "/weight",
    prepare: openDeleteConfirmation,
    locate: (page) =>
      page.getByRole("dialog").locator('[data-variant="link"]').first(),
  },
  {
    name: "button-destructive",
    path: "/weight",
    locate: (page) => variant(page, "destructive"),
  },
  {
    name: "rail-item-inactive",
    path: "/",
    locate: (page) => rail(page).getByRole("link", { name: "Plan" }),
  },
  {
    name: "list-row",
    path: "/weight",
    /*
     * The edit control, not the `<li>`. The row holds two targets — this and
     * Delete beside it — and `weigh-ins.tsx` records why each grounds only what
     * it activates rather than the pair grounding together.
     */
    locate: (page) =>
      page
        .getByRole("list", { name: "Weigh-ins" })
        .getByRole("listitem")
        .first()
        .getByRole("button")
        .first(),
  },
  {
    name: "week-cell",
    path: "/plan",
    /*
     * `visible: true` because `week-grid.tsx` renders BOTH shapes of the week
     * and hides one with CSS — the stacked one and the grid — so a bare
     * `.first()` can resolve to a cell in the shape this width does not draw
     * and then fail waiting for it to appear. The name is the date rather than
     * the weekday: a grid cell is "Mon 15 Jun breakfast:", where the template
     * editor's row is "Monday breakfast:".
     */
    locate: (page) =>
      page
        .getByRole("button", { name: /breakfast:/ })
        .filter({ visible: true })
        .first(),
  },
  {
    name: "checkbox-row",
    path: "/shopping",
    /*
     * The label is the control: a 46px row whose whole area toggles the box
     * inside it. The `<input>` itself is `sr-only` and has no area to hover.
     */
    locate: (page) => page.locator("label:has(input[type=checkbox])").first(),
  },

  // ---- The link's own state: a colour, per the mock rather than the table ---
  {
    name: "link",
    path: "/plan",
    locate: (page) => page.getByRole("link", { name: "Shopping list" }),
  },
  {
    name: "link-rail-foot",
    path: "/",
    locate: (page) => rail(page).getByRole("link", { name: "Settings" }),
  },

  // ---- § Desktop's third row: a `surface` fill takes the inset rule ---------
  {
    name: "tile-stone",
    path: "/plan/template",
    prepare: openMealPicker,
    locate: (page) =>
      page.getByRole("dialog").locator("button.bg-surface").first(),
  },
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

for (const specimen of SPECIMENS) {
  test(specimen.name, async ({ page }) => {
    await page.goto(specimen.path);
    await expect(page.getByRole("main")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await specimen.prepare?.(page);

    const control = specimen.locate(page);
    /*
     * Asserted before the hover so that a control this sweep was supposed to
     * reach and did not names itself here, rather than failing as a timeout
     * inside `hover()` or — worse — as a screenshot of whatever else the
     * locator happened to resolve to.
     */
    await expect(control).toBeVisible();

    await control.hover();

    /*
     * `toHaveScreenshot` waits for two consecutive identical frames, which is
     * what settles the `transition-colors duration-150` these controls carry.
     * The config disables animations and pins `maxDiffPixels: 0`, so a ground
     * that shifted by one step is a failure rather than a tolerance.
     */
    await expect(control).toHaveScreenshot(`${specimen.name}.png`);
  });
}
