import { describe, expect, test } from "vitest";

import { MAX_KG, MIN_KG } from "./weigh-in";
import {
  CHART_SHAPE,
  CHART_SHAPE_WIDE,
  type ChartPlot,
  chartGeometry,
  PLOT_HEIGHT,
  type Reading,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./weight-chart";

/**
 * The weight chart's geometry — FUEL-35, PRD § P5.
 *
 * Gated at 100% for the reason `macros.ts` and `week-totals.ts` are: every way
 * this can be wrong draws a plausible picture. A trend plotted against a domain
 * that excluded the target is a chart missing a line nobody counts; a reversed
 * sort is a weight loss drawn as a gain, on the screen P5 calls "the single
 * number the whole program is judged on". Neither throws, and neither looks
 * like anything but a chart.
 *
 * ## What is asserted, and what is not
 *
 * Coordinates are checked as RELATIONS wherever a relation is the real claim —
 * a heavier reading sits above a lighter one, the target line is inside the
 * plate, the latest point is the rightmost. Absolute numbers are asserted only
 * where the number is itself the contract: the centred single point, and the
 * bounds of the drawing surface.
 *
 * That split is deliberate. A suite that pinned all 320 units of every
 * coordinate would fail on any change to the inset and pass on a domain that
 * had quietly stopped including the target — which is the mutation that
 * matters, and the one `expect(y).toBe(93.4)` cannot see.
 *
 * ## The fixtures
 *
 * Invented figures throughout, per Testing Strategy § 1.5: the repository is
 * public and the owner's real weight lives in the database, never in git.
 */

const TARGET_KG = 76;
const START_KG = 84.2;

const REFERENCES = { startWeightKg: START_KG, targetWeightKg: TARGET_KG };

/** Four weekly weigh-ins, descending — the ordinary case. Mondays. */
const HISTORY: Reading[] = [
  { date: "2026-07-27", weightKg: 82.4 },
  { date: "2026-08-03", weightKg: 81.6 },
  { date: "2026-08-10", weightKg: 80.9 },
  { date: "2026-08-17", weightKg: 80.1 },
];

/**
 * Indexed access under `noUncheckedIndexedAccess`. Throwing beats a non-null
 * assertion: a fixture that stops lining up fails by name here rather than with
 * a confusing assertion further down — dot-grid.test.tsx makes the same call.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) throw new Error(`No item at ${index}`);

  return item;
}

/** The plot, or a failure that says the chart was empty rather than `null.x`. */
function plotOf(
  readings: readonly Reading[],
  references = REFERENCES,
): ChartPlot {
  const plot = chartGeometry(readings, references);

  if (plot === null) throw new Error("Expected a plot, got the empty state");

  return plot;
}

describe("the empty state", () => {
  /**
   * P5's first named edge case. `null` rather than an empty plot, because
   * § UI Copy Examples writes the empty state as "No weigh-ins yet. Your first
   * entry starts the chart" — the guide's own sentence says there is no chart
   * yet, and `/weight` renders that sentence above where this would be.
   */
  test("a history with nothing in it draws no chart at all", () => {
    expect(chartGeometry([], REFERENCES)).toBeNull();
  });
});

describe("the single-data-point state", () => {
  const ONE: Reading[] = [{ date: "2026-08-17", weightKg: 80.1 }];

  /**
   * P5's second named edge case, and the first of the module's three
   * division-by-zero cases: one reading spans no days, so the horizontal scale
   * has a divisor of zero.
   *
   * The specific failure being pinned is `NaN`, which SVG discards SILENTLY —
   * a coordinate of `NaN` draws nothing and reports nothing, so the chart would
   * simply be blank with no error anywhere to say why.
   */
  test("one reading is a real coordinate, not NaN", () => {
    const { latest } = plotOf(ONE);

    expect(Number.isFinite(latest.x)).toBe(true);
    expect(Number.isFinite(latest.y)).toBe(true);
  });

  /**
   * Centred, not pinned right. With one reading it is simultaneously the first
   * and the latest, and putting it hard against the right-hand edge — where the
   * latest reading otherwise lives — would draw a chart implying a history
   * running off the left of the plate.
   */
  test("the one reading sits at the centre of the plate", () => {
    expect(plotOf(ONE).latest.x).toBe(VIEW_WIDTH / 2);
  });

  /**
   * A polyline of one point has no segment and draws nothing. `null` lets the
   * component omit the element rather than emit an invisible one for the
   * draw-in to spend 400ms revealing — "the chart is blank for a moment" being
   * indistinguishable from the bug above.
   */
  test("there is no trend line to draw", () => {
    expect(plotOf(ONE).path).toBeNull();
  });

  test("the target and the start are still ruled and still on the plate", () => {
    const { start, target } = plotOf(ONE);

    for (const rule of [start, target]) {
      expect(rule.y).toBeGreaterThanOrEqual(0);
      expect(rule.y).toBeLessThanOrEqual(PLOT_HEIGHT);
    }
  });
});

describe("a history that never moves", () => {
  /**
   * The module's second division-by-zero case. Every reading identical is an
   * ordinary week, and the vertical span across the readings alone is zero.
   */
  test("identical readings still have a height to be drawn in", () => {
    const flat: Reading[] = [
      { date: "2026-08-03", weightKg: 80 },
      { date: "2026-08-10", weightKg: 80 },
      { date: "2026-08-17", weightKg: 80 },
    ];

    for (const point of plotOf(flat).points) {
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  /**
   * The third case, and the one that survives the obvious fix. Widening the
   * domain to include the references is what saves the case above — the target
   * is 4kg away, so the range is 4kg rather than 0. Here the readings, the
   * start and the target are all one number, so the widened domain collapses
   * too and the divisor is zero again.
   *
   * A fixture worth keeping: it is the state a maintenance phase reaches on the
   * day the target is met, which is the least likely day for anyone to want the
   * chart to break.
   */
  test("a flat history sitting exactly on the target still draws", () => {
    const onTarget: Reading[] = [
      { date: "2026-08-10", weightKg: 76 },
      { date: "2026-08-17", weightKg: 76 },
    ];

    const { domain, points, start, target } = plotOf(onTarget, {
      startWeightKg: 76,
      targetWeightKg: 76,
    });

    expect(domain.highKg).toBeGreaterThan(domain.lowKg);
    expect(Number.isFinite(target.y)).toBe(true);
    expect(Number.isFinite(start.y)).toBe(true);

    for (const point of points) expect(Number.isFinite(point.y)).toBe(true);
  });

  /** A flat line belongs in the middle of the plate, not against an edge. */
  test("a flat line is drawn centrally rather than on the floor", () => {
    const flat: Reading[] = [
      { date: "2026-08-10", weightKg: 80 },
      { date: "2026-08-17", weightKg: 80 },
    ];

    const [first] = plotOf(flat, { startWeightKg: 80, targetWeightKg: 80 }).points;

    expect(first?.y).toBeCloseTo(PLOT_HEIGHT / 2, 0);
  });
});

describe("the vertical domain", () => {
  /**
   * FUEL-35's "target line and starting weight both visible", stated as the
   * arithmetic that delivers it. A chart scaled to its readings alone would put
   * a 76kg target below an 80.1kg history — off the bottom of the plate — and
   * the criterion would fail on exactly the history it matters most for, an
   * early one where the target is furthest away.
   */
  test("the target is inside the plate even when no reading is near it", () => {
    const { target } = plotOf(HISTORY);

    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThanOrEqual(PLOT_HEIGHT);
  });

  test("the starting weight is inside the plate even when no reading reaches it", () => {
    const { start } = plotOf(HISTORY);

    expect(start.y).toBeGreaterThanOrEqual(0);
    expect(start.y).toBeLessThanOrEqual(PLOT_HEIGHT);
  });

  test("the domain spans every reading as well as both references", () => {
    const { domain } = plotOf(HISTORY);

    expect(domain.lowKg).toBeLessThanOrEqual(TARGET_KG);
    expect(domain.highKg).toBeGreaterThanOrEqual(START_KG);

    for (const reading of HISTORY) {
      expect(domain.lowKg).toBeLessThanOrEqual(reading.weightKg);
      expect(domain.highKg).toBeGreaterThanOrEqual(reading.weightKg);
    }
  });

  /**
   * A reading heavier than the starting weight — the program's first fortnight
   * going the wrong way, or a target raised after a bulk. The domain follows
   * the data rather than assuming the start is the ceiling.
   */
  test("a reading above the starting weight widens the domain to hold it", () => {
    const gained: Reading[] = [
      { date: "2026-08-10", weightKg: 84.2 },
      { date: "2026-08-17", weightKg: 86.5 },
    ];

    const { domain, points } = plotOf(gained);

    expect(domain.highKg).toBeGreaterThanOrEqual(86.5);
    expect(at(points, 1).y).toBeGreaterThanOrEqual(0);
  });

  test("gridlines are horizontal rules at round kilogram values, spanning the domain", () => {
    const { domain, gridlines } = plotOf(HISTORY);

    expect(gridlines.length).toBeGreaterThan(1);
    expect(at(gridlines, 0).weightKg).toBe(domain.lowKg);
    expect(at(gridlines, gridlines.length - 1).weightKg).toBe(domain.highKg);

    for (const rule of gridlines) {
      // A round step, never 80.43 — the horizontal structure lands where a
      // person would have put it. Halves are the finest step allowed.
      expect((rule.weightKg * 2) % 1).toBe(0);
    }
  });

  /**
   * The step list is climbed until one divides the range coarsely enough, so a
   * two-week history and a two-year one carry a similar amount of furniture.
   * Without it, the range in this fixture at half-kilogram steps would rule the
   * plate a hundred times over.
   */
  test("a very long history does not fill the plate with gridlines", () => {
    const decade: Reading[] = [
      { date: "2016-08-17", weightKg: 120 },
      { date: "2026-08-17", weightKg: 70 },
    ];

    expect(plotOf(decade).gridlines.length).toBeLessThanOrEqual(8);
  });

  /**
   * The widest chart that can exist, taken from the parser rather than invented:
   * `lib/weigh-in.ts` accepts a reading anywhere between `MIN_KG` and `MAX_KG`,
   * so a history holding both ends is a history the app will genuinely store.
   *
   * It is past the point where any step in the list divides the range into four,
   * which is the one case the coarsest-step fallback exists for. Bounded here
   * rather than left to the constants so that widening the parser's range — the
   * plausible future change — fails in this file rather than by drawing a chart
   * ruled with a hundred lines.
   */
  test("the widest history the app accepts still draws a legible plate", () => {
    const extremes: Reading[] = [
      { date: "2026-08-10", weightKg: MIN_KG },
      { date: "2026-08-17", weightKg: MAX_KG },
    ];

    const { domain, gridlines, points } = plotOf(extremes);

    expect(domain.lowKg).toBeLessThanOrEqual(MIN_KG);
    expect(domain.highKg).toBeGreaterThanOrEqual(MAX_KG);
    expect(gridlines.length).toBeLessThanOrEqual(12);

    for (const point of points) expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe("the trend", () => {
  /**
   * The sort is the claim. `loadWeighIns` returns the history NEWEST first,
   * because that is the order the list beneath the chart reads in, and a chart
   * that trusted the caller's order would draw a loss as a gain the day someone
   * changed that list — a chart that is entirely plausible upside down.
   */
  test("points run oldest to newest whatever order they arrive in", () => {
    const newestFirst = [...HISTORY].reverse();

    expect(plotOf(newestFirst).points.map((point) => point.date)).toEqual(
      HISTORY.map((reading) => reading.date),
    );
  });

  test("time runs left to right", () => {
    const { points } = plotOf(HISTORY);

    for (let index = 1; index < points.length; index += 1) {
      expect(at(points, index).x).toBeGreaterThan(at(points, index - 1).x);
    }
  });

  /** SVG's y axis points down, so a heavier reading is a SMALLER y. */
  test("a heavier reading is drawn above a lighter one", () => {
    const { points } = plotOf(HISTORY);

    for (let index = 1; index < points.length; index += 1) {
      expect(at(points, index).y).toBeGreaterThan(at(points, index - 1).y);
    }
  });

  /**
   * Time-proportional, not one step per reading. A fortnight's gap between two
   * weigh-ins is a fortnight on the axis — a missed week is visible as the gap
   * it was, rather than smoothed into an evenly spaced series that implies a
   * regularity the data does not have.
   */
  test("the gap after a missed week is drawn as a wider gap", () => {
    const missed: Reading[] = [
      { date: "2026-08-03", weightKg: 81.6 },
      { date: "2026-08-10", weightKg: 80.9 },
      { date: "2026-08-24", weightKg: 80.1 },
    ];

    const { points } = plotOf(missed);

    const weekly = at(points, 1).x - at(points, 0).x;
    const fortnight = at(points, 2).x - at(points, 1).x;

    expect(fortnight).toBeCloseTo(weekly * 2, 1);
  });

  test("the path names every point, in order", () => {
    const { path, points } = plotOf(HISTORY);

    expect(path).toBe(points.map((point) => `${point.x},${point.y}`).join(" "));
  });
});

describe("the latest reading", () => {
  /** § Rule 2's one umber mark. It has to be the newest reading, not the last
   * element of whatever order the caller happened to pass. */
  test("is the newest reading even when the caller passes them newest first", () => {
    expect(plotOf([...HISTORY].reverse()).latest.date).toBe("2026-08-17");
  });

  test("carries the same coordinates as its own point in the path", () => {
    const { latest, points } = plotOf(HISTORY);
    const last = at(points, points.length - 1);

    expect({ x: latest.x, y: latest.y }).toEqual({ x: last.x, y: last.y });
  });

  test("sits at the right-hand edge of the plotted area", () => {
    const { latest, points } = plotOf(HISTORY);

    for (const point of points.slice(0, -1)) {
      expect(latest.x).toBeGreaterThan(point.x);
    }
  });
});

describe("the drawing surface", () => {
  /**
   * The inset exists for this: the latest reading's dot is 4 units of radius
   * plus a 2-unit ring, and it lands at the right-hand edge every time — which
   * is exactly where a chart runs out of room. A clipped dot is the one mark the
   * § Rule 2 accent budget is spent on.
   */
  test("every mark clears the edges of the plate by more than the dot's radius", () => {
    const { gridlines, points } = plotOf(HISTORY);

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(6);
      expect(point.x).toBeLessThanOrEqual(VIEW_WIDTH - 6);
      expect(point.y).toBeGreaterThanOrEqual(6);
      expect(point.y).toBeLessThanOrEqual(PLOT_HEIGHT - 6);
    }

    for (const rule of gridlines) {
      expect(rule.y).toBeGreaterThanOrEqual(0);
      expect(rule.y).toBeLessThanOrEqual(PLOT_HEIGHT);
    }
  });

  /** The date axis lives below the plate, so the plate cannot be the whole box. */
  test("the plot area leaves room beneath it for the date axis", () => {
    expect(PLOT_HEIGHT).toBeLessThan(VIEW_HEIGHT);
  });

  /**
   * A malformed date throws rather than being placed somewhere plausible —
   * `daysBetween` is what raises it, and dot-grid.tsx argues the disposition at
   * length: a graphic that silently draws a mark in the wrong place is worse
   * than an error boundary, because the whole point of it is being trusted at a
   * glance.
   */
  test("a date that does not exist is refused rather than plotted", () => {
    expect(() =>
      chartGeometry(
        [
          { date: "2026-08-10", weightKg: 80 },
          { date: "2026-02-30", weightKg: 79 },
        ],
        REFERENCES,
      ),
    ).toThrow(/2026-02-30/);
  });
});

describe("the caller's rows", () => {
  /**
   * The readings are the screen's `useOptimistic` state. Sorting them in place
   * would reorder the history list rendered beneath the chart — from a function
   * whose whole contract is being pure.
   */
  test("are not reordered by drawing them", () => {
    const newestFirst = [...HISTORY].reverse();
    const asPassed = [...newestFirst];

    chartGeometry(newestFirst, REFERENCES);

    expect(newestFirst).toEqual(asPassed);
  });
});

describe("the two shapes", () => {
  /*
   * FUEL-78. `/weight`'s chart takes the frame at ≥1272, and a box that only
   * got wider would have drawn it 514px tall — 1.88:1, very nearly square. The
   * shape is a parameter instead, and these are the claims that makes.
   */
  const references = { startWeightKg: 84.2, targetWeightKg: 76 };

  const READINGS = [
    { date: "2026-07-27", weightKg: 82.4 },
    { date: "2026-08-03", weightKg: 81.6 },
    { date: "2026-08-10", weightKg: 80.9 },
    { date: "2026-08-17", weightKg: 80.1 },
  ];

  test("the default shape is the phone's, so every existing caller is unmoved", () => {
    expect(chartGeometry(READINGS, references)).toEqual(
      chartGeometry(READINGS, references, CHART_SHAPE),
    );
  });

  test("the frame's shape is 968 by 300, and its units are CSS pixels", () => {
    /*
     * Not a round number for its own sake. The frame caps at 1272 and centres,
     * so `<main>` spans the measure and the aside — 1272 less the 220 rail and
     * the 28px gutter beside it, which is 1024 — and `PageMain` spends 28px a
     * side of that on its own gutter. 968 is what is left, at every width this
     * shape is visible at. One user unit is therefore one device pixel, which
     * is what stops `INSET` and the plate's 14-unit corner radius inflating
     * with the column the way they do on the phone's shape.
     *
     * The gutter BETWEEN the measure and the aside is not subtracted: it is
     * inside the 1024 the two columns share, and this graphic spans across it.
     */
    expect(CHART_SHAPE_WIDE.viewWidth).toBe(1272 - 220 - 28 - 56);
    expect(CHART_SHAPE_WIDE.viewHeight).toBe(300);

    // The axis strip is 22px, which is what a 10.5px Micro date label needs —
    // the same strip in PIXELS the phone's 22 units draw at 375.
    expect(CHART_SHAPE_WIDE.viewHeight - CHART_SHAPE_WIDE.plotHeight).toBe(22);
  });

  test("the frame's box is wider than it is tall by enough to show a slope", () => {
    /*
     * The mock's reasoning, as an assertion: "widening a plot without
     * heightening it flattens what it draws". 1024×220 is 4.65:1 and was
     * rejected as too flat; the aspect-locked box this ticket would otherwise
     * have produced is 968×514, or 1.88:1, and is the same fault inverted.
     */
    const ratio = CHART_SHAPE_WIDE.viewWidth / CHART_SHAPE_WIDE.viewHeight;

    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4);
  });

  test("every mark stays inside the frame's plate, as it does inside the phone's", () => {
    const plot = chartGeometry(READINGS, references, CHART_SHAPE_WIDE);

    if (plot === null) throw new Error("four readings drew nothing");

    // The same claim the phone's shape makes above, in the other box: the
    // latest reading's dot and its ring clear every edge.
    for (const point of plot.points) {
      expect(point.x).toBeGreaterThanOrEqual(6);
      expect(point.x).toBeLessThanOrEqual(CHART_SHAPE_WIDE.viewWidth - 6);
      expect(point.y).toBeGreaterThanOrEqual(6);
      expect(point.y).toBeLessThanOrEqual(CHART_SHAPE_WIDE.plotHeight - 6);
    }

    for (const rule of plot.gridlines) {
      expect(rule.y).toBeGreaterThanOrEqual(0);
      expect(rule.y).toBeLessThanOrEqual(CHART_SHAPE_WIDE.plotHeight);
    }
  });

  test("the two shapes plot the same readings on the same dates", () => {
    const narrow = chartGeometry(READINGS, references, CHART_SHAPE);
    const wide = chartGeometry(READINGS, references, CHART_SHAPE_WIDE);

    if (narrow === null || wide === null) throw new Error("four readings drew nothing");

    /*
     * The shape changes the box, not the data. Same count, same dates, same
     * order, same domain and the same weights ruled — a shape that quietly
     * chose different gridlines would be a second chart rather than the same
     * one laid out differently.
     */
    expect(wide.points.map((p) => p.date)).toEqual(narrow.points.map((p) => p.date));
    expect(wide.domain).toEqual(narrow.domain);
    expect(wide.gridlines.map((g) => g.weightKg)).toEqual(
      narrow.gridlines.map((g) => g.weightKg),
    );
    expect(wide.latest.weightKg).toBe(narrow.latest.weightKg);
  });

  test("the wider box spreads the same readings further apart", () => {
    const narrow = chartGeometry(READINGS, references, CHART_SHAPE);
    const wide = chartGeometry(READINGS, references, CHART_SHAPE_WIDE);

    if (narrow === null || wide === null) throw new Error("four readings drew nothing");

    // The point of the ticket, as one number: the horizontal span the same four
    // weigh-ins occupy is three times what it was.
    const span = (plot: NonNullable<typeof narrow>) =>
      plot.points[plot.points.length - 1]!.x - plot.points[0]!.x;

    expect(span(wide)).toBeGreaterThan(span(narrow) * 2.5);
  });

  test("a single reading centres in the frame's box too", () => {
    const plot = chartGeometry([{ date: "2026-08-17", weightKg: 80.1 }], references, CHART_SHAPE_WIDE);

    if (plot === null) throw new Error("one reading drew nothing");

    expect(plot.latest.x).toBe(CHART_SHAPE_WIDE.viewWidth / 2);
  });
});
