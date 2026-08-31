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
    header: await boxOf(page.locator('[data-column="header"]')),
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
      await expect(page.locator('[data-column="header"]')).toHaveCount(1);
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
      const header = page.locator('[data-column="header"]');

      await page.setViewportSize({ width: 1271, height: 900 });
      expect(await displayOf(aside), "at 1271px").toBe("contents");
      expect(await displayOf(header), "the band at 1271px").toBe("contents");

      await page.setViewportSize({ width: 1272, height: 900 });
      expect(await displayOf(aside), "at 1272px").toBe("flex");
      expect(await displayOf(header), "the band at 1272px").toBe("flex");
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

      test(`the header band spans both columns at ${width}`, async ({ page }) => {
        /*
         * FUEL-86's third zone, and the arithmetic that makes it one thing
         * rather than two — § Desktop: the measure and the aside "together come
         * to exactly that 1024", which is the width the frame is a sum of.
         *
         * A band that merely started at the measure and ran to the aside's
         * right edge would measure the same and mean less. What is asserted is
         * the pair: it begins where the measure begins and ends where the aside
         * ends, so a band placed from column one — over the rail, which is what
         * `col-span-2` would do — fails on its x rather than on its width.
         */
        await page.setViewportSize({ width, height: 900 });

        const { header, measure, aside } = await columns(page);

        expect(header.x, "the band's left edge").toBeCloseTo(measure.x, 0);
        expect(
          header.x + header.width,
          "the band's right edge",
        ).toBeCloseTo(aside.x + aside.width, 0);
        expect(header.width, "the span").toBeCloseTo(584 + 28 + 356, 0);
      });

      test(`the band is above both columns at ${width}`, async ({ page }) => {
        /*
         * A row of its own, not a taller first row. § Desktop's "one job per
         * zone" puts the folio and the time graphic ahead of the subject, and
         * the band's 30px is its own bottom margin rather than a grid row gap —
         * `lib/frame.ts` gives the reason, which is that the action bar brings
         * its own `pt-[30px]` and a row gap would be paid twice.
         */
        await page.setViewportSize({ width, height: 900 });

        const { header, measure, aside } = await columns(page);

        for (const [name, box] of [
          ["the measure", measure],
          ["the aside", aside],
        ] as const) {
          expect(box.y, `${name} starts below the band`).toBeCloseTo(
            header.y + header.height + 30,
            0,
          );
        }
      });

      test(`the measure keeps its own inset at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });

        const { main, measure, aside } = await columns(page);

        // 28px in from `<main>`'s box at both ends — the same gutter on each
        // side, which is what makes a left-aligned composition read as
        // symmetric inside the frame.
        //
        // Measured against `<main>` rather than against its parent, which is
        // what this asked before the FUEL-77 precommit review pointed out the
        // brittleness of an `xpath=..` lookup. It is also the truer statement:
        // at this width `<main>` spans to the last track, so its right edge IS
        // the frame's, and the number being checked is main's own padding
        // rather than a relationship between two boxes.
        expect(measure.x - main.x, "left inset").toBeCloseTo(28, 0);
        expect(
          main.x + main.width - (aside.x + aside.width),
          "right inset",
        ).toBeCloseTo(28, 0);
      });

      test(`the action bar stands in the measure at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });

        // `:not([aria-hidden])` excludes the `/` skeleton's bar, which carries
        // the same class string by design — see `action-bar.spec.ts`, where the
        // race this avoids has been re-run away more than once.
        const bar = page.locator("main .action-bar-fade:not([aria-hidden])");

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

      const bar = await boxOf(
        page.locator("main .action-bar-fade:not([aria-hidden])"),
      );
      const measure = await boxOf(page.locator('[data-column="measure"]'));

      // `action-bar.ts` carries `pt-[30px]`, and the grid adds no row gap — so
      // the gap between the column's last block and the primary is that 30 and
      // nothing else. Measured against the bar's box, whose top IS where its own
      // padding starts.
      expect(bar.y - (measure.y + measure.height), "content to bar").toBeCloseTo(0, 0);

      // And the control: it is nowhere near the foot of a 1400px window, which
      // is where `mt-auto` would still have it.
      expect(bar.y + bar.height, "the bar's bottom").toBeLessThan(1200);

      /*
       * The reason the aside spans both rows, asserted rather than reasoned
       * about — and the one way this arrangement can still go wrong.
       *
       * A grid distributes a spanning item's height across the tracks it spans,
       * so an aside taller than the measure plus the bar would grow row one and
       * push the primary an arbitrary distance below the figures it acts on.
       * Confined to row one it would do the same thing harder. Neither is true
       * on these two screens today — the measure is the longer column on both,
       * by a wide margin — and this is what says so out loud, at the width where
       * it matters, so that a longer Anytime list is reported here rather than
       * discovered in a screenshot.
       */
      const lastBlock = await boxOf(
        page.locator('[data-column="measure"] > *:last-child'),
      );

      expect(
        measure.y + measure.height - (lastBlock.y + lastBlock.height),
        "space the aside added to the measure's row",
      ).toBeCloseTo(0, 0);
    });

    test("draws exactly one day ruler at every width", async ({ page }) => {
      /*
       * § The Four Rules: "one umber element per screen, and it always says: you
       * are here." On `/` that element is the ruler's NOW marker, and `/` holds
       * three copies of the ruler in the DOM so that one DOM can serve three
       * compositions — FUEL-82's device, extended here.
       *
       * This is the assertion that was missing when FUEL-77 drew two of them.
       * `md:block xl:hidden` looks like it stands down at the cap and does not:
       * Tailwind emits the redefined `xl` media block ahead of `md`, so the `md`
       * rule wins at 1272 and both copies drew — one in the measure and one in
       * the aside, two NOW markers on one screen. Nothing in the unit suite
       * could see it (jsdom applies no stylesheet), the geometry assertions
       * above all passed, and it was found by looking at a baseline.
       *
       * Counting what is *drawn* is the cheapest statement of the rule that a
       * browser can make, and it is the one this file was missing.
       */
      for (const width of [375, 820, 1271, 1272, 1920]) {
        await page.setViewportSize({ width, height: 900 });

        const drawn = page.locator("main [data-ruler]:visible");

        // `/training` renders no ruler at all — it is `/`'s graphic — so the
        // count is "one if any", asserted per screen rather than globally.
        const total = await page.locator("main [data-ruler]").count();

        await expect(drawn, `at ${width}px`).toHaveCount(total === 0 ? 0 : 1);
      }
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

      // The band too, and what it draws here is the point. Everything FUEL-86
      // ADDED to it is `hidden` below the cap — `/`'s folio, the ruler's third
      // copy, `/training`'s week standing — so the only thing left drawn is
      // `/training`'s paginator, which was on this screen at this width all
      // along and changed zone rather than visibility. That is the composition
      // reason the 820 baselines come back byte-identical, stated as a count.
      expect(await displayOf(page.locator('[data-column="header"]'))).toBe("contents");
      await expect(page.locator('[data-column="header"] > *:visible')).toHaveCount(
        path === "/" ? 0 : 1,
      );

      // Measured on the sections themselves, since a group with no box has no
      // edge to compare. The first thing in each column shares the other's x and
      // sits below it, which is a column rather than a row.
      const first = await boxOf(page.getByRole("heading", { level: 1 }));

      // `:visible`, because the first thing in the aside at this width is not
      // the first thing in the DOM: `/` renders three copies of the ruler and
      // two of them are `display: none` here. A box is what this measures, and
      // a copy that is not drawn does not have one.
      const inAside = await boxOf(
        page
          .locator('[data-column="aside"] :is(h2, [data-ruler]):visible')
          .first(),
      );

      expect(inAside.x, "the aside's first block").toBeCloseTo(first.x, 0);
      expect(inAside.y, "below rather than beside").toBeGreaterThan(first.y);
    });
  });
}
