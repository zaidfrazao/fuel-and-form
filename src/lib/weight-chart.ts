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

/**
 * A reading, placed — with its 7-day average beside it, placed too (FUEL-139).
 *
 * The average travels on every point whether or not the chart draws it, because
 * the readout and the data table report it either way: a reading is the scale's
 * number on one morning, and the average is the figure the line says, so a
 * reader scrubbing along a smoothed line is owed both.
 */
export type PlotPoint = Reading & {
  x: number;
  y: number;
  /** The mean of every reading in the 7 days ending on this one. */
  averageKg: number;
  /** Where that average sits on the plate. */
  averageY: number;
};

/** A horizontal rule at one weight — a gridline, the target, or the start. */
export type Rule = { weightKg: number; y: number };

/**
 * How far back a chart looks — FUEL-139.
 *
 * `All` is the journey, the chart as FUEL-35 drew it. The others are windows
 * ending on the latest reading, and they exist because a chart that always
 * spans the whole history compresses the part a check-in is about: six months
 * in, the last four weeks are a sixth of the plate.
 *
 * There is no `1W`. MacroFactor and Alma offer one, but they are apps weighed
 * into daily; this one's cadence is PRD § P5's *weekly* weigh-in, and a week of
 * that is one to three points — a window with no line worth drawing in it.
 */
export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "All";

/**
 * Every window, shortest first, in days — the order the control draws them.
 *
 * Days rather than calendar months: a window is a span of the plate's own axis,
 * which is days, and "1M" meaning 28 in February and 31 in March would make the
 * same button draw a different amount of history depending on when it was
 * pressed. The figures are a month, a quarter, a half and a year, rounded to
 * whole days.
 */
export const RANGES: readonly { key: Exclude<RangeKey, "All">; days: number }[] = [
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
];

/**
 * The trailing average's window, in days, the reading itself included.
 *
 * PRD § P5: "a trailing average smooths daily noise if weigh-ins become more
 * frequent than weekly". A calendar week rather than an exponential weighting,
 * though an EWMA is what the trend-weight apps draw: this one has to be NAMED on
 * the screen, and "7-day average" is a figure a reader can check against the
 * history list by hand. A smoothing constant is not.
 */
export const AVERAGE_DAYS = 7;

/** The same week as a divisor, for the frequency test in `smoothed`. */
const DAYS_PER_WEEK = 7;

/**
 * The windows worth offering for a history — FUEL-139.
 *
 * A window is offered only when it would cut something off. One that spans the
 * whole history draws exactly what `All` draws, and two buttons that do the same
 * thing are a question the reader has to answer to find out they are the same.
 * `All` is always last and always there.
 *
 * @param readings in any order.
 */
export function availableRanges(readings: readonly Reading[]): RangeKey[] {
  const dates = readings.map((reading) => reading.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  const span = first !== undefined && last !== undefined ? daysBetween(first, last) : 0;

  // `>=` because a window keeps readings LESS than its days old: a history
  // spanning exactly 30 days has a reading on day 30 that "1M" leaves out.
  return [...RANGES.filter(({ days }) => span >= days).map(({ key }) => key), "All"];
}

/**
 * The window a chart opens on: three months once the history is longer than
 * that, the whole of it until then.
 *
 * Three months is the ticket's number and a check-in's: the last dozen weekly
 * readings, which is enough to see a trend and few enough that a week's change
 * is still visible. Before the history reaches it, `All` IS three months or
 * less, and choosing "3M" there would be a label for a window that cuts nothing.
 */
export function defaultRange(readings: readonly Reading[]): RangeKey {
  return availableRanges(readings).includes("3M") ? "3M" : "All";
}

/**
 * Whether a run of readings is denser than weekly, which is when PRD § P5 asks
 * for the line to be smoothed.
 *
 * "More than one weigh-in per week" as arithmetic: n readings have n − 1 gaps,
 * and the line is smoothed when those gaps average under a week. Exactly weekly
 * is NOT smoothed — seven-day gaps put one reading in every trailing window,
 * where the average of a reading is that reading, and the line would be the
 * same line said a second time.
 *
 * Judged on what is VISIBLE, not on the history. A month of daily weigh-ins at
 * the end of a year of weekly ones is noise in the window that shows it, and
 * smoothing it only there is the point of asking per window.
 *
 * Handed the ends and the count rather than the run, because its one caller has
 * already narrowed both ends — and a guard here for an empty run would be a
 * branch no caller can reach. One reading falls out of the arithmetic: no gaps,
 * a span of zero, and `0 > 0` is false.
 */
function smoothed(first: Reading, last: Reading, count: number): boolean {
  return (count - 1) * DAYS_PER_WEEK > daysBetween(first.date, last.date);
}

/**
 * Each reading's trailing average: the mean of every reading in the
 * `AVERAGE_DAYS` ending on it, itself included.
 *
 * Over the WHOLE history rather than the visible window, so the first point of a
 * one-month chart averages the week it actually followed instead of pretending
 * the history began on the window's edge — which would make the left end of
 * every window a raw reading and the line kink there for no reason in the data.
 *
 * Quadratic, and deliberately: a history is a few hundred rows at most (one a
 * day for a year is 365), and a running-sum version is a second piece of
 * arithmetic to get right for no measurable gain.
 *
 * Never divides by zero: the reading is in its own window, so every window
 * holds at least one.
 *
 * @param ordered oldest first.
 */
export function withAverages<T extends Reading>(
  ordered: readonly T[],
): (T & { averageKg: number })[] {
  return ordered.map((reading, index) => {
    const week = ordered
      .slice(0, index + 1)
      .filter((earlier) => daysBetween(earlier.date, reading.date) < AVERAGE_DAYS);

    return {
      ...reading,
      averageKg: round(week.reduce((total, earlier) => total + earlier.weightKg, 0) / week.length),
    };
  });
}

/**
 * The readings a range shows: those LESS than its days before the newest, so
 * "1M" is the thirty dates ending on the latest reading, that reading included.
 *
 * Ends on the latest reading rather than on today. A window ending today would
 * open on an empty right-hand edge whenever the owner had not weighed in for a
 * few days, and the latest reading is where the chart's one accent mark is and
 * where every other shape of this chart already ends.
 *
 * @param ordered oldest first; returned in the same order.
 */
export function windowed<T extends Reading>(ordered: readonly T[], range: RangeKey): T[] {
  const days = RANGES.find(({ key }) => key === range)?.days;
  const newest = ordered[ordered.length - 1];

  if (days === undefined || newest === undefined) return [...ordered];

  return ordered.filter((reading) => daysBetween(reading.date, newest.date) < days);
}

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
  /**
   * The goal weight from `profiles.target_weight_kg`. Labelled.
   *
   * `null` when a window's axis does not reach it — FUEL-139. See `start`.
   */
  target: Rule | null;
  /**
   * The starting weight from `profiles.start_weight_kg`. Labelled.
   *
   * Always present on `All`, where the band between the two references is the
   * journey and the axis is widened to hold it. A window is scaled to its own
   * readings instead, and a reference outside that scale is left off rather
   * than widening it: a month of readings 2kg apart, stretched to hold a target
   * 13kg below them, is FUEL-139's complaint about the full history arriving by
   * a second route. The table's caption still states both.
   */
  start: Rule | null;
  /** The weights the vertical axis spans, after widening. */
  domain: { lowKg: number; highKg: number };
  /**
   * Whether `path` is the 7-day average rather than the readings themselves —
   * PRD § P5's "if weigh-ins become more frequent than weekly", judged on the
   * points in view. When it is, the readings are drawn as dots beneath it.
   */
  smoothed: boolean;
  /** The window these points are, for the summary and the table to name. */
  range: RangeKey;
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
 * A drawing surface — FUEL-78, and the reason the three constants above are no
 * longer the only ones.
 *
 * `/weight`'s chart takes the frame at ≥1272 rather than the measure: § Desktop
 * gives the screen "**the reading and the trend take the frame** — a chart is a
 * data graphic and 584 is not its width". A box that only got wider would not
 * do it. The viewBox above is 320 × 170, so `h-auto` on a 968px column draws a
 * **514px** chart — 1.88:1, very nearly square, and half a screen tall on the
 * one ticket whose whole argument is rendered height.
 *
 * The mock draws 1024 × 300 and says why: "widening a plot without heightening
 * it flattens what it draws, and 1024×220 is 4.65:1 against the 640-wide box's
 * 3.27 — a weight chart understating its own slope." 514px is that complaint
 * inverted, and just as wrong.
 *
 * So the shape is a parameter. Nothing about how the chart DRAWS changes —
 * every rule, inset, step and label is the one it already had — and the two
 * shapes differ only in the box the same geometry is laid out in.
 */
export type ChartShape = {
  /** The viewBox's width in user units. */
  viewWidth: number;
  /** Its full height, plot area plus the date axis strip beneath. */
  viewHeight: number;
  /** The height of the filled plot area alone. */
  plotHeight: number;
};

/** The shape every width below `xl` draws: the phone's, unchanged since FUEL-35. */
export const CHART_SHAPE: ChartShape = {
  viewWidth: VIEW_WIDTH,
  viewHeight: VIEW_HEIGHT,
  plotHeight: PLOT_HEIGHT,
};

/**
 * The shape `/weight` draws at ≥1272, where the chart has the frame's span.
 *
 * ## The units are CSS pixels, and that is the whole point of these numbers
 *
 * The frame caps at 1272 and centres, so a graphic spanning the measure and the
 * aside inside `PageMain`'s gutters is **968px wide at every width this shape
 * is visible at** — 1272 less the 220 rail and the 28px gutter beside it, which
 * is `<main>`'s 1024, less `PageMain`'s own 28 a side. The gutter BETWEEN the
 * two columns is not subtracted: it is inside that 1024, and this graphic spans
 * across it. There is no range left for the box to scale over, so a viewBox of
 * 968 makes one user unit one device pixel.
 *
 * That is worth having rather than a tidier round number, because it retires a
 * distortion instead of merely avoiding one. Everything in this module sized in
 * units — `INSET`'s 10, the plate's 14-unit corner radius from § Implementation
 * Notes, the dot's clearance — inflates with the column on the phone shape: at
 * 584 the scale is 1.825 and § Implementation Notes' 14px radius is drawn at
 * 25.5. At 968 on this shape it is 14px, which is what the guide asked for.
 * This is FUEL-76's complaint — the type scale inflating with the column —
 * one layer down, and this shape is where it stops.
 *
 * 300 tall is the mock's own number, and 278 leaves a 22px axis strip: the same
 * strip in PIXELS that the phone shape's 22 units draw at 375, which is what a
 * 10.5px Micro date label actually needs. Keeping the strip proportional
 * instead would have spent 66px on one line of type.
 */
export const CHART_SHAPE_WIDE: ChartShape = {
  viewWidth: 968,
  viewHeight: 300,
  plotHeight: 278,
};

/**
 * How far inside the plot area a mark may sit.
 *
 * Wide enough for the latest reading's dot — 4 units of radius plus its 2-unit
 * ring — to clear every edge. A dot clipped by the plate is the one mark on the
 * chart the § Rule 2 accent budget is spent on, and it lands at the right-hand
 * edge every single time, which is exactly where a chart runs out of room.
 */
const INSET = 10;

/**
 * The four edges a mark may occupy, for a given shape.
 *
 * These were four module constants until FUEL-78 gave the chart a second shape.
 * `INSET` is unchanged and is still applied on all four sides — what varies is
 * only the box it is measured in.
 */
function bounds({ viewWidth, plotHeight }: ChartShape) {
  return {
    left: INSET,
    right: viewWidth - INSET,
    top: INSET,
    bottom: plotHeight - INSET,
  };
}

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
  shape: ChartShape = CHART_SHAPE,
  range: RangeKey = "All",
): ChartPlot | null {
  const { left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM } = bounds(shape);

  // Copied before sorting: the screen's array is React state, and `sort`
  // mutates in place. Sorting the caller's rows would reorder the history list
  // rendered beneath this chart, from a function that is supposed to be pure.
  //
  // ## Two-way, and the three-way version was tried and removed
  //
  // This comparator returns 1 rather than 0 for two equal dates, which is a
  // technical breach of the contract: it says "a after b" where it means "no
  // preference". An external review flagged it, and the three-way form was
  // written — then removed, because it cannot be observed. V8's sort only moves
  // an element while the comparator returns a NEGATIVE number, so a tie stops
  // the move either way and the original order survives; measured across arrays
  // of 2 to 12 all-tied elements, the two forms produce identical output.
  //
  // So the third branch was unreachable in effect: no test could distinguish it,
  // and the one written to try passed against BOTH forms — a test that cannot
  // fail, propping up a branch the 100% gate would then have to be satisfied
  // with vacuously. This file removes unreachable branches rather than keeping
  // them (weigh-in.ts and weigh-ins.tsx each lost one the same way), so it is
  // gone and this note is what remains of it.
  //
  // The invariant that makes the whole question academic: `weight_logs` is
  // unique on `(user_id, date)` and the screen's optimistic reducer drops any
  // row sharing a date before it prepends, so a tie does not reach here at all.
  //
  // Compared with `<` rather than `localeCompare`, which reads the runtime's
  // collation. These are `YYYY-MM-DD` strings, where byte order IS chronological
  // order, and `format.ts` records why this app does not let a locale decide
  // anything it can decide itself.
  const ordered = [...readings].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Averaged before the window is cut — see `withAverages`.
  const visible = windowed(withAverages(ordered), range);

  const first = visible[0];
  const last = visible[visible.length - 1];

  // Narrows for `noUncheckedIndexedAccess` as well as being the empty state —
  // dot-grid.tsx's `summarise` reads the same way, and one check that does both
  // is one fewer place for the two to disagree about what "no data" means. A
  // non-empty history always has a non-empty window, since the newest reading
  // is in every one of them.
  if (first === undefined || last === undefined) return null;

  const smooth = smoothed(first, last, visible.length);

  // `All` holds both references, which is FUEL-35's criterion and the journey
  // band. A window holds what it draws — the readings, and the averages when
  // they are the line — so its axis is its own. See `ChartPlot.start`.
  const { lowKg, highKg, gridKg } = niceDomain([
    ...visible.map((reading) => reading.weightKg),
    ...(smooth ? visible.map((reading) => reading.averageKg) : []),
    ...(range === "All" ? [references.startWeightKg, references.targetWeightKg] : []),
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
  const span = daysBetween(first.date, last.date);
  const x = (date: CalendarDate) =>
    span === 0
      ? round((LEFT + RIGHT) / 2)
      : round(LEFT + (daysBetween(first.date, date) / span) * (RIGHT - LEFT));

  const points = visible.map((reading) => ({
    ...reading,
    x: x(reading.date),
    y: y(reading.weightKg),
    averageY: y(reading.averageKg),
  }));

  // A reference is drawn when the axis reaches it. On `All` that is always,
  // because the axis was built to; on a window it is whenever the readings
  // happen to be near one, which late in a cut is the target.
  const reference = (weightKg: number): Rule | null =>
    weightKg >= lowKg && weightKg <= highKg ? { weightKg, y: y(weightKg) } : null;

  return {
    points,
    // Built from `last` rather than read back out of `points`, which is the
    // same coordinates through the same two functions without an index this
    // module would then have to prove is in range.
    latest: { ...last, x: x(last.date), y: y(last.weightKg), averageY: y(last.averageKg) },
    path:
      points.length > 1
        ? points
            .map((point) => `${point.x},${smooth ? point.averageY : point.y}`)
            .join(" ")
        : null,
    gridlines: gridKg.map((weightKg) => ({ weightKg, y: y(weightKg) })),
    target: reference(references.targetWeightKg),
    start: reference(references.startWeightKg),
    domain: { lowKg, highKg },
    smoothed: smooth,
    range,
  };
}
