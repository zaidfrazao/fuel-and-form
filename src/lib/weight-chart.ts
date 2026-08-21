import { type CalendarDate, daysBetween } from "./date";

/**
 * Where every mark on the weight trend chart goes — FUEL-35, PRD § P5.
 *
 * Pure geometry, no React, no clock, no database. The split `week-grid.ts` /
 * `week-grid.tsx` and `adherence.ts` both keep, and here it is what makes P5's
 * two named edge cases testable at all: "chart handles the empty state and the
 * single-data-point state without breaking" is a claim about arithmetic, and
 * arithmetic asserted through a rendered `<svg>` is asserted through the one
 * layer of this app jsdom measures worst.
 *
 * ## Why the app draws its own chart
 *
 * The PRD's stack table names Recharts, with the rationale "one weight-trend
 * line chart; not worth a heavier library". Every acceptance criterion on
 * FUEL-35 is then a subtraction from that library's defaults — no area fill, no
 * gradient, no marker except the latest point, horizontal gridlines only — and
 * what remains is a polyline, five hairlines and a dot. The line this module
 * produces costs no dependency, no client bundle and no `ResponsiveContainer`,
 * which measures the DOM and therefore reports 0×0 under jsdom: the two edge
 * cases the task calls out as "the two that break charting libraries" would
 * have had no automated test at all.
 *
 * A knowing deviation from the stack table, recorded here rather than left to
 * be rediscovered — the same treatment § The Dot Grid's `partial` status got,
 * and the same class of deviation as this build's Next 16 and Tailwind v4.
 *
 * ## Three ways a chart divides by zero
 *
 * All three are ordinary data, not corruption, and each would put `NaN` into a
 * coordinate — which SVG discards silently, drawing nothing and reporting
 * nothing:
 *
 * 1. **One reading.** The horizontal span is zero days. P5 names this one.
 * 2. **Every reading identical.** A stable week. The vertical span is zero.
 * 3. **A flat history sitting exactly on the target.** Both references and every
 *    point are one number, so the vertical span is zero even though the domain
 *    was widened to include the target and the start.
 *
 * Cases 2 and 3 are one guard, because `niceDomain` widens a collapsed range
 * before anything divides by it. Case 1 is its own, in `chartGeometry`.
 */

/**
 * One weigh-in, as far as the geometry is concerned.
 *
 * Structural, so `WeighInRow` from the screen satisfies it without a conversion
 * — and narrower than that type on purpose. The note is not geometry, and a
 * module that could see it is a module that could start deciding where a noted
 * reading is drawn.
 */
export type Reading = {
  date: CalendarDate;
  weightKg: number;
};

/** A reading, placed. */
export type PlotPoint = Reading & { x: number; y: number };

/** A horizontal rule at one weight — a gridline, the target, or the start. */
export type Rule = { weightKg: number; y: number };

export type ChartPlot = {
  /**
   * Every reading, oldest first — which is the order the polyline needs and the
   * opposite of the order `loadWeighIns` returns.
   *
   * Sorted here rather than at the call site. The screen holds its rows newest
   * first because that is the order the history list reads in, and a chart that
   * depended on being handed them the other way round would be one refactor of
   * that list away from drawing the trend backwards — a chart that looks
   * entirely plausible upside down.
   */
  points: PlotPoint[];
  /** The most recent reading, and the only point that carries a mark. */
  latest: PlotPoint;
  /**
   * The `points` attribute of the trend polyline, or `null` for a single
   * reading.
   *
   * `null` rather than a one-pair string because a polyline of one point draws
   * nothing — it has no segment. Emitting it anyway would put an invisible
   * element on the page for the draw-in animation to spend 400ms revealing, and
   * "the chart is blank for a moment" is indistinguishable from the bug this
   * module exists to prevent.
   */
  path: string | null;
  /** Unlabelled hairlines at round kilogram values — the plot's structure. */
  gridlines: Rule[];
  /** The goal weight from `profiles.target_weight_kg`. Labelled. */
  target: Rule;
  /** The starting weight from `profiles.start_weight_kg`. Labelled. */
  start: Rule;
  /** The weights the vertical axis spans, after widening. */
  domain: { lowKg: number; highKg: number };
};

/**
 * The drawing surface, in viewBox units.
 *
 * A fixed viewBox rather than a measured element: the chart then scales with its
 * container at any width, and "legible at 375px" becomes a proportion this
 * module fixes once rather than a number that has to be re-measured. It is also
 * what keeps the whole component renderable on the server.
 *
 * 320 × 170 is close to the 331px a 375px phone leaves inside § Spacing &
 * Layout's 22px gutters, so at the width this app is designed for the units are
 * very nearly device pixels and the geometry below can be reasoned about in
 * them.
 */
export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 170;

/** The height of the filled plot area. The rest is the date axis beneath it. */
export const PLOT_HEIGHT = 148;

/**
 * How far inside the plot area a mark may sit.
 *
 * Wide enough for the latest reading's dot — 4 units of radius plus its 2-unit
 * ring — to clear every edge. A dot clipped by the plate is the one mark on the
 * chart the § Rule 2 accent budget is spent on, and it lands at the right-hand
 * edge every single time, which is exactly where a chart runs out of room.
 */
const INSET = 10;

const LEFT = INSET;
const RIGHT = VIEW_WIDTH - INSET;
const TOP = INSET;
const BOTTOM = PLOT_HEIGHT - INSET;

/**
 * The kilogram intervals a gridline is allowed to fall on.
 *
 * Round numbers only, so the horizontal structure lands somewhere a person
 * would have put it. The list is climbed until one of them divides the range
 * into at most `PREFERRED_MAX_INTERVALS`, which is what keeps a two-week history and a
 * two-year one carrying a similar amount of furniture.
 */
const STEPS_KG = [0.5, 1, 2, 5, 10, 20, 50] as const;

/**
 * How many intervals the range is PREFERRED to divide into — not a guarantee.
 *
 * Once the range outruns the coarsest step the fallback below takes over and the
 * count rises: the widest history this app can hold rules the plate nine times
 * rather than five. That is the right trade — more gridlines beats a step the
 * axis cannot be read against — but the name would otherwise promise a ceiling
 * this does not enforce.
 */
const PREFERRED_MAX_INTERVALS = 4;

/**
 * The step used when no other divides the range finely enough — beyond 200kg of
 * it, which no real history reaches.
 *
 * Typed as a member of the list rather than as a number, so removing 50 from
 * `STEPS_KG` fails the build here instead of leaving a fallback that lands on a
 * value the chart is no longer allowed to rule at.
 */
const COARSEST_STEP_KG: (typeof STEPS_KG)[number] = 50;

/** Coordinates at two decimals — enough for a 320-unit box, and stable in a test. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The step, low and high of the vertical axis, and the values to rule it at.
 *
 * The domain covers every reading **and both references**, which is the whole of
 * FUEL-35's "target line and starting weight both visible": a chart scaled to
 * its data alone would push a target 13kg below the lightest reading off the
 * bottom of the plate, and the criterion would fail on precisely the history it
 * matters most for — an early one, where the target is furthest away.
 *
 * Widening to whole steps is what supplies the padding, so there is no separate
 * margin constant to keep in step with the tick spacing.
 *
 * The collapse guard is the second and third division-by-zero cases from the
 * module comment. `Math.floor` and `Math.ceil` agree whenever every value is
 * already a multiple of the step — a history of one repeated reading, sitting on
 * a target of that same reading, being the flattest possible version — and the
 * range that comes
 * back would then be zero-high. One step either side gives it a real height, and
 * a flat line lands in the middle of the plate where a flat line belongs.
 */
function niceDomain(values: readonly number[]): {
  lowKg: number;
  highKg: number;
  gridKg: number[];
} {
  const lowest = Math.min(...values);
  const highest = Math.max(...values);

  const step =
    STEPS_KG.find((candidate) => (highest - lowest) / candidate <= PREFERRED_MAX_INTERVALS) ??
    COARSEST_STEP_KG;

  let lowKg = round(Math.floor(lowest / step) * step);
  let highKg = round(Math.ceil(highest / step) * step);

  if (lowKg === highKg) {
    lowKg = round(lowKg - step);
    highKg = round(highKg + step);
  }

  const gridKg = Array.from(
    { length: Math.round((highKg - lowKg) / step) + 1 },
    (_, index) => round(lowKg + index * step),
  );

  return { lowKg, highKg, gridKg };
}

/**
 * Builds every coordinate the chart draws, or `null` for a history with nothing
 * in it.
 *
 * `null` is the empty state, and it is the empty state because Brand Guide
 * § UI Copy Examples already writes one: "No weigh-ins yet. Your first entry
 * starts the chart." The guide's own sentence says the chart does not exist yet,
 * so the honest render is no chart — not an empty plate ruled for data that has
 * never been recorded. The screen says the sentence; this module declines to
 * draw underneath it.
 *
 * @param readings every weigh-in, in any order. Sorted here.
 * @param references the profile's own figures. Never hardcoded: P7 gives the
 *   demo persona different body metrics, so a literal target would draw the
 *   owner's goal across a visitor's chart.
 */
export function chartGeometry(
  readings: readonly Reading[],
  references: { startWeightKg: number; targetWeightKg: number },
): ChartPlot | null {
  // Copied before sorting: the screen's array is React state, and `sort`
  // mutates in place. Sorting the caller's rows would reorder the history list
  // rendered beneath this chart, from a function that is supposed to be pure.
  //
  // Three-way rather than the shorter `a.date < b.date ? -1 : 1`, which returns
  // 1 for two equal dates and so tells the engine to SWAP them — the opposite of
  // the stable order `sort` would otherwise give. `weight_logs` is unique on
  // `(user_id, date)` and the screen's optimistic reducer drops any row sharing
  // a date before it prepends, so a tie should not reach here; the point is that
  // when one does, which reading counts as `latest` is decided by this line
  // rather than by the engine's sort implementation.
  //
  // Compared with `<` and `>` rather than `localeCompare`, which reads the
  // runtime's collation. These are `YYYY-MM-DD` strings, where byte order IS
  // chronological order, and `format.ts` records at length why this app does not
  // let a locale decide anything it can decide itself.
  const ordered = [...readings].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  // Narrows for `noUncheckedIndexedAccess` as well as being the empty state —
  // dot-grid.tsx's `summarise` reads the same way, and one check that does both
  // is one fewer place for the two to disagree about what "no data" means.
  if (first === undefined || last === undefined) return null;

  const { lowKg, highKg, gridKg } = niceDomain([
    ...ordered.map((reading) => reading.weightKg),
    references.startWeightKg,
    references.targetWeightKg,
  ]);

  // Guaranteed non-zero by `niceDomain`'s collapse guard, which is the only
  // reason this division is safe to write without a second check.
  const perKg = (BOTTOM - TOP) / (highKg - lowKg);
  const y = (weightKg: number) => round(BOTTOM - (weightKg - lowKg) * perKg);

  // The first division-by-zero case: a single reading, or a history that somehow
  // spans no days. `weight_logs` is unique on `(user_id, date)` so the second
  // cannot happen with more than one row, which leaves P5's single-data-point
  // state — drawn at the centre of the plate.
  //
  // Centred rather than pinned to the right-hand edge, where the latest reading
  // otherwise lives. With one reading it is simultaneously the first and the
  // latest, and putting it hard against the right would draw a chart that
  // implies a history running off the left of the plate. Centre says what is
  // true: one measurement, no trend yet.
  const days = daysBetween(first.date, last.date);
  const x = (date: CalendarDate) =>
    days === 0
      ? round((LEFT + RIGHT) / 2)
      : round(LEFT + (daysBetween(first.date, date) / days) * (RIGHT - LEFT));

  const points = ordered.map((reading) => ({
    ...reading,
    x: x(reading.date),
    y: y(reading.weightKg),
  }));

  return {
    points,
    // Built from `last` rather than read back out of `points`, which is the
    // same coordinates through the same two functions without an index this
    // module would then have to prove is in range.
    latest: { ...last, x: x(last.date), y: y(last.weightKg) },
    path:
      points.length > 1
        ? points.map((point) => `${point.x},${point.y}`).join(" ")
        : null,
    gridlines: gridKg.map((weightKg) => ({ weightKg, y: y(weightKg) })),
    target: { weightKg: references.targetWeightKg, y: y(references.targetWeightKg) },
    start: { weightKg: references.startWeightKg, y: y(references.startWeightKg) },
    domain: { lowKg, highKg },
  };
}
