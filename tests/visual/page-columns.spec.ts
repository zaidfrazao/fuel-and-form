import { type Locator, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The second column, measured — Brand Guide § Desktop, FUEL-77.
 *
 * § Desktop hands `/` and `/training` a composition in two sentences: "the
 * measure keeps the meal, the macro grid and the action bar; the aside takes the
 * day ruler and the Anytime list", and the frame's own table gives the two
 * columns their widths. Every number in that is a rendered box, and nothing
 * cheaper than a browser has one.
 *
 * ## What the other suites cannot say
 *
 * `right-now.test.tsx` and `training.test.tsx` hold the grouping — which
 * sections are in which column, and that grouping them reordered nothing. That
 * is the half jsdom can hold, and it would pass unchanged against a `<main>`
 * with no columns at all: jsdom applies no stylesheet, so `xl:grid` there is a
 * substring.
 *
 * The baselines in `screens.spec.ts` would catch a missing column, and they are
 * the reason this file does not photograph anything. They report a fault as
 * "pixels differ at 1272", which is the same sentence a late font produces. The
 * faults this ticket can actually introduce have names — a measure that changed
 * width when the aside arrived, an aside 8px late because `xl` was still 1280, a
 * bar spanning both columns — and each is one assertion.
 *
 * ## The widths
 *
 * 1271 and 1272, because a breakpoint is a claim about two adjacent pixels and
 * the cheap way to get this wrong is to land it on the wrong side of one. That
 * pair is also the only thing standing between this composition and Tailwind's
 * default `xl`: at 1280 the aside would simply be absent at 1272, which is the
 * width the mock is drawn at and the width the baselines photograph.
 *
 * 1920, because the frame caps at 1272 and centres, so every column measured
 * here must be the same number it was at the cap. And 820, which is the band
 * below — the one width in this file where the correct answer is "one column".
 */

/** The frame: the container `app/(app)/layout.tsx` wraps the rail and main in. */
const FRAME = "main:not([data-column])";

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (!box) throw new Error("element is not visible, so it has no box");

  return box;
};

/** The two column groups, and the frame they are inside. */
const columns = async (page: import("@playwright/test").Page) => {
  const main = await boxOf(page.getByRole("main"));

  return {
    main,
    frame: await boxOf(page.locator(FRAME).locator("xpath=..")),
    measure: await boxOf(page.locator('[data-column="measure"]')),
    aside: await boxOf(page.locator('[data-column="aside"]')),
  };
};

/** `display` as the browser resolves it — the only place the media query ran. */
const displayOf = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).display);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

for (const path of ["/", "/training"]) {
  test.describe(path, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();

      // Both groups are in the DOM at every width. Asserted before anything is
      // measured, so a screen that stopped rendering one of them fails here
      // rather than passing every geometric claim about a box that is not there.
      await expect(page.locator('[data-column="measure"]')).toHaveCount(1);
      await expect(page.locator('[data-column="aside"]')).toHaveCount(1);
    });

    test("is one column below the cap and two at it", async ({ page }) => {
      /*
       * The breakpoint, from both sides. `display: contents` is what a group is
       * below 1272 — no box of its own, its sections in the page's single
       * column — and `flex` is what it becomes at it.
       *
       * This is also the assertion that fails if `--breakpoint-xl` is ever
       * dropped: Tailwind's default `xl` is 1280, so the aside would arrive
       * eight pixels late and 1272 — the width the mock is drawn at — would be
       * the last width without it.
       */
      const aside = page.locator('[data-column="aside"]');

      await page.setViewportSize({ width: 1271, height: 900 });
      expect(await displayOf(aside), "at 1271px").toBe("contents");

      await page.setViewportSize({ width: 1272, height: 900 });
      expect(await displayOf(aside), "at 1272px").toBe("flex");
    });

    for (const width of [1272, 1920]) {
      test(`the columns are 584 and 356 at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });

        const { measure, aside } = await columns(page);

        // The measure is `--frame-measure-inset`: the 640 track less the 28px
        // `<main>` pads itself by at either side. It is the width a sentence has
        // occupied on every screen since FUEL-70, and § Desktop requires it not
        // to move when the aside arrives — "every screen puts its measure at the
        // same x whether or not it has an aside".
        expect(measure.width, "the reading column").toBeCloseTo(584, 0);

        // And the aside is what is left, which at the cap is the frame's own
        // third track. Nobody declares 356 anywhere; this is where it is checked.
        expect(aside.width, "the aside").toBeCloseTo(356, 0);

        // § Spacing's ≥768px gutter, doing the same job between columns.
        expect(aside.x - (measure.x + measure.width), "the gutter").toBeCloseTo(28, 0);
      });

      test(`the measure keeps its own inset at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });

        const { main, frame, measure, aside } = await columns(page);

        // 28px in from `<main>`'s box on the left, and 28px in from the frame's
        // edge on the right — the same gutter at both ends, which is what makes
        // a left-aligned composition read as symmetric inside the frame.
        expect(measure.x - main.x, "left inset").toBeCloseTo(28, 0);
        expect(
          frame.x + frame.width - (aside.x + aside.width),
          "right inset",
        ).toBeCloseTo(28, 0);
      });

      test(`the action bar stands in the measure at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });

        const bar = page.locator("main .action-bar-fade");

        // `/training`'s bar is conditional on a session; `/`'s on there being
        // something to do. Both are true at the frozen instant, and it is
        // asserted rather than assumed — a `.first()` on an empty locator would
        // fail the same way whatever the layout did.
        await expect(bar).toBeVisible();

        const { measure } = await columns(page);
        const box = await boxOf(bar);

        // § Desktop: "the primary action sits at the end of its column." The
        // column is the measure, so a bar spanning both — which is what it does
        // if `PAGE_MEASURE_FOOT` is dropped and the grid auto-places it — is
        // 384px too wide and sits under the aside as well.
        expect(box.x, "the bar's left edge").toBeCloseTo(measure.x, 0);
        expect(box.width, "the bar's width").toBeCloseTo(measure.width, 0);
      });
    }

    test("the bar follows the content rather than the foot of the window", async ({
      page,
    }) => {
      /*
       * FUEL-72 put the bar at the bottom of a tall `<main>` by `mt-auto`, and
       * the mock draws it 30px under the last figure. At 1272 the mock wins:
       * `PAGE_ASIDE_GRID` packs its rows to the top, so the bar's grid area is
       * its own height and there is no free space for the auto margin to take.
       *
       * A tall viewport is the only place the two answers differ, which is why
       * the height here is 1400 rather than 900.
       */
      await page.setViewportSize({ width: 1440, height: 1400 });

      const bar = await boxOf(page.locator("main .action-bar-fade"));
      const measure = await boxOf(page.locator('[data-column="measure"]'));

      // `action-bar.ts` carries `pt-[30px]`, and the grid adds no row gap — so
      // the gap between the column's last block and the primary is that 30 and
      // nothing else. Measured against the bar's box, whose top IS where its own
      // padding starts.
      expect(bar.y - (measure.y + measure.height), "content to bar").toBeCloseTo(0, 0);

      // And the control: it is nowhere near the foot of a 1400px window, which
      // is where `mt-auto` would still have it.
      expect(bar.y + bar.height, "the bar's bottom").toBeLessThan(1200);
    });

    test("is a single column at 820, unchanged", async ({ page }) => {
      /*
       * The band below, and the control for the whole file. § Desktop gives
       * 768–1023 "the phone's navigation and the desktop's content shapes", and
       * this ticket changes nothing there — so both groups are boxless and every
       * section is on one x.
       */
      await page.setViewportSize({ width: 820, height: 1180 });

      expect(await displayOf(page.locator('[data-column="measure"]'))).toBe("contents");
      expect(await displayOf(page.locator('[data-column="aside"]'))).toBe("contents");

      // Measured on the sections themselves, since a group with no box has no
      // edge to compare. The first thing in each column shares the other's x and
      // sits below it, which is a column rather than a row.
      const first = await boxOf(page.getByRole("heading", { level: 1 }));
      const inAside = await boxOf(
        page.locator('[data-column="aside"] h2, [data-column="aside"] [data-ruler]').first(),
      );

      expect(inAside.x, "the aside's first block").toBeCloseTo(first.x, 0);
      expect(inAside.y, "below rather than beside").toBeGreaterThan(first.y);
    });
  });
}
