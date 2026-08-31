import { type Page, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS, WIDTHS } from "./constants";

/**
 * The weight chart's type scale, measured — Brand Guide § Typography, FUEL-76.
 *
 * The chart draws into a 320-unit viewBox and lets it scale with the column, so
 * everything inside it used to be multiplied by whatever the column happened to
 * be: at 584px the factor is 1.825 and the 10.5px Micro labels painted at 19.2px
 * — larger than Body, on a screen whose § Typography opens with "the ratio is
 * the rule: 76 ÷ 10.5 ≈ 7.2×". The trend painted at 3.65px and the 4px mark at
 * 7.3px. Every widening in the Desktop milestone made it worse.
 *
 * ## Why here and not in the unit suite
 *
 * Because every number above is a rendered pixel. jsdom applies no CSS and lays
 * nothing out, so `weight-chart.test.tsx` can hold the STRUCTURE the fix rests
 * on — that the words and the mark are drawn in a layer with no viewBox — and
 * nothing about what any of it measures. It is the same trade `frame.spec.ts`
 * makes, and for the same reason: § Typography states its rule as a ratio
 * between two numbers, so a fault has to be reported as a number rather than as
 * "some pixels differ".
 *
 * ## Why one project rather than the screens matrix
 *
 * A font-size has no theme, and the assertion is that a measurement does not
 * change across widths — which wants one browser resizing itself, not eight runs
 * each seeing a single width. It carries no baseline, so it is not part of an
 * `--update-snapshots` run.
 */

/** The one screen that draws the chart. */
const WEIGHT = "/weight";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
  await page.goto(WEIGHT);
  await expect(page.getByRole("img", { name: /Weight trend/ })).toBeVisible();
});

/**
 * Every measurement below, read at one of the suite's four viewports.
 *
 * The viewports come from `constants.ts` so this asks its question at the same
 * widths the baselines are drawn at — a fault found here names a picture that
 * exists.
 */
async function measureAt(page: Page, viewport: (typeof WIDTHS)[number]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  return page.evaluate(() => {
    /*
     * The drawing that is SHOWN, not the first in the document — FUEL-78.
     *
     * `/weight` renders the chart twice: the measure's 320×170 box, and the
     * frame's 968×300 at ≥1272. The geometry depends on the box's aspect and is
     * computed on a server with no viewport, so both are laid out and CSS hides
     * one. A `document.querySelector` takes the measure's drawing at every
     * width, and at 1272 and 1920 that one is `display: none` — every box it
     * reports is zero, which is how this first failed: "label widths: 74.4,
     * 74.4, 0, 0".
     *
     * `getClientRects()` is what asks the question this test means. A hidden
     * element has none; the one being drawn has one.
     */
    const shown = [...document.querySelectorAll("[data-chart-shape]")].find(
      (box) => box.getClientRects().length > 0,
    );

    if (!shown) throw new Error("no chart drawing is visible");

    const geometry = shown.querySelector<SVGSVGElement>('svg[role="img"][aria-label^="Weight trend"]');

    if (!geometry) throw new Error("the chart is not on the page");

    // By the contract rather than by DOM order: the unscaled layer is the one
    // with no viewBox, which is the whole reason its contents keep their size.
    const overlay = [...geometry.parentElement!.querySelectorAll("svg")].find(
      (layer) => !layer.hasAttribute("viewBox"),
    )!;
    const label = [...overlay.querySelectorAll("text")].find((node) =>
      node.textContent?.startsWith("Start"),
    )!;
    const mark = overlay.querySelector("circle")!;
    const trend = geometry.querySelector("polyline")!;

    geometry.scrollIntoView({ block: "center" });

    /**
     * The painted thickness of a stroke, by asking the document what it hit.
     *
     * `getBoundingClientRect` on SVG geometry excludes the stroke in Chromium,
     * so the ink cannot be measured from a box. Hit-testing paints it exactly:
     * the element answers where its stroke is drawn and nowhere else, so
     * scanning across it and taking the extent of the answers is the width.
     */
    const inkThickness = (element: SVGElement, clientX: number, centreY: number) => {
      let first: number | null = null;
      let last = 0;

      for (let dy = -8; dy <= 8; dy += 0.05) {
        if (document.elementsFromPoint(clientX, centreY + dy).includes(element)) {
          if (first === null) first = dy;
          last = dy;
        }
      }

      return first === null ? 0 : Number((last - first + 0.05).toFixed(2));
    };

    // A vertex of the trend, mapped into client space through the scaled layer's
    // own matrix — which is also where the scale factor comes from.
    const matrix = trend.getScreenCTM()!;
    const vertices = trend
      .getAttribute("points")!
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    const vertex = vertices[Math.floor(vertices.length / 2)]!;
    const onTrend = new DOMPoint(vertex[0], vertex[1]).matrixTransform(matrix);

    const geometryBox = geometry.getBoundingClientRect();

    return {
      column: Number(geometryBox.width.toFixed(1)),
      scale: Number(matrix.a.toFixed(3)),
      labelFontSize: getComputedStyle(label).fontSize,
      labelWidth: Number(label.getBoundingClientRect().width.toFixed(1)),
      markBox: Number(mark.getBoundingClientRect().width.toFixed(1)),
      trendInk: inkThickness(trend, onTrend.x, onTrend.y),
    };
  });
}

/**
 * § Typography's Micro, at every width the suite is drawn at.
 *
 * The label's WIDTH is asserted beside its font-size, because a font-size is a
 * declaration and a width is what the browser did with it — and it is the width
 * that would move if the glyphs were being scaled by something other than the
 * type scale.
 */
test("the chart's labels are 10.5px however wide the column is", async ({ page }) => {
  const measurements = [];

  for (const viewport of WIDTHS) {
    measurements.push({ width: viewport.width, ...(await measureAt(page, viewport)) });
  }

  for (const measurement of measurements) {
    expect(measurement.labelFontSize, `Micro at ${measurement.width}px`).toBe("10.5px");
  }

  // One width to within a tenth of a pixel, which is the claim the ticket's
  // table made and the app failed: 10.5px declared, 19.1px painted.
  //
  // A tolerance rather than exact equality, and it costs nothing: the fault this
  // catches measured 76.9px against 135.7px. Text is laid out from an origin
  // that lands on a different subpixel at each of these widths, so demanding an
  // identical figure would be asserting something about rasterisation that this
  // test does not mean and a different machine need not honour.
  const widths = measurements.map((measurement) => measurement.labelWidth);
  const spread = Math.max(...widths) - Math.min(...widths);

  expect(spread, `label widths: ${widths.join(", ")}`).toBeLessThan(0.1);
});

/**
 * § Color Palette's 2px trend and § Data Display's 4px mark, likewise — and the
 * scale factor is asserted with them, because the whole test would pass on a
 * chart that had simply stopped scaling.
 */
test("the trend and the mark keep their own size while the plot scales", async ({ page }) => {
  const narrow = await measureAt(page, WIDTHS[0]);
  const medium = await measureAt(page, WIDTHS[1]!);
  const wide = await measureAt(page, WIDTHS[WIDTHS.length - 1]!);

  // The plot still fills its column — AC4, and the control for everything else.
  expect(wide.column).toBeGreaterThan(narrow.column);

  /*
   * The scale guard, which FUEL-78 had to split in two — and the split is the
   * claim rather than an accommodation.
   *
   * This asked `wide.scale > narrow.scale * 1.5`, so that the whole test could
   * not pass on a chart which had simply stopped scaling. Between 375 and 820
   * that is still exactly the right question: both draw the measure's shape, and
   * the viewBox is stretched from ~331px of column to 584.
   *
   * At the cap it is the wrong question, because the frame's shape is 968 user
   * units drawn in a 968px column. The frame caps at 1272 and centres, so that
   * box has no range to scale over at all, and a scale of 1 is the point of it:
   * `INSET`, the dot's clearance and the plate's 14-unit radius are device
   * pixels there rather than the column's scale times fourteen. Demanding
   * growth would be demanding the distortion back.
   */
  expect(medium.scale, "the measure's shape scales with its column").toBeGreaterThan(
    narrow.scale * 1.5,
  );
  expect(wide.scale, "the frame's shape is 1:1 by construction").toBeCloseTo(1, 2);

  // The ink laid on it does not grow with it. A tolerance of a tenth covers the
  // 0.05px step the scan takes; without the fix the wide figure is 3.65px.
  expect(narrow.trendInk).toBeGreaterThan(1.9);
  expect(Math.abs(wide.trendInk - narrow.trendInk)).toBeLessThan(0.11);

  // The mark's box excludes its ring in Chromium, so this is the 4px disc; the
  // claim is that it is the same disc at both widths, to the same tenth of a
  // pixel and for the same reason.
  expect(Math.abs(wide.markBox - narrow.markBox)).toBeLessThan(0.1);
});
