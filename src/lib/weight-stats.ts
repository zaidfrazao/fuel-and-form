import { daysBetween } from "./date";
import type { Reading } from "./weight-chart";

/**
 * How far the program has come, and how fast it is moving — FUEL-36, PRD § P5.
 *
 * Pure arithmetic, no React, no clock, no database — the split `weight-chart.ts`
 * keeps, for the reason it gives: the figures on this screen are claims about
 * someone's own history, and a claim asserted through a rendered `<dl>` is
 * asserted through the one layer of this app jsdom measures worst.
 *
 * It is also the only module in the app that says whether things are GOING well.
 * Everything else here reports — `adherence.ts` refuses to grade at all — and
 * the difference is that P5 asks for the rate to be shown "against the
 * configured goal pace", which is a comparison and therefore a verdict. That is
 * the whole reason the verdict is one boolean produced in one place: a screen
 * that decided on-pace-ness inline would be a screen where the colour and the
 * words could disagree.
 *
 * ## Why the rate is a least-squares slope
 *
 * P5: "a trailing average smooths daily noise if weigh-ins become more frequent
 * than weekly". Three ways to answer that, and only one of them does:
 *
 *   1. **Last minus first, over the span.** Uses two readings out of a possible
 *      twenty-eight, so one bloated Monday morning at either end swings the
 *      whole figure. It does not smooth anything — it just picks two points and
 *      hopes.
 *   2. **Mean of the last week against the mean of the first.** With the WEEKLY
 *      cadence P5 actually describes, each "mean" is a single reading, so it
 *      collapses back into (1) in the normal case while costing more code.
 *   3. **The least-squares slope through every reading in the window.** Uses all
 *      of them, weights none of them specially, and — this is the part that
 *      makes it the right answer rather than the clever one — reduces exactly to
 *      (1) when there are only two.
 *
 * So the estimator behaves like the obvious one when there is nothing to smooth,
 * and genuinely averages when there is.
 *
 * ## Fewer than four weeks, and the division by zero underneath it
 *
 * The window is "the readings in the last 28 days", not "the last 28 days of
 * readings", so a fortnight-old program simply has fewer points in it and the
 * slope is taken through those. Nothing special happens until there is only ONE,
 * and then there is no slope to take: Σ(x−x̄)² is the denominator, and with a
 * single point it is zero.
 *
 * That is the whole of P5's "handles fewer than four weeks without dividing by
 * zero", and it is ONE guard on the denominator rather than a count of the
 * readings. This file was first written with both — `points.length < 2` in
 * front, `variance === 0` behind it — and mutation testing showed the length
 * check could be removed without a single test noticing, because a lone reading
 * arrives at the second guard with a variance of exactly zero and leaves by it.
 * Two guards where one fires is one branch the coverage gate would have called
 * covered while nothing constrained it, which is the trap this project's memory
 * of FUEL-10 and FUEL-17 is about; the redundant one is gone.
 *
 * The guard that stayed is the wider one. Zero variance means every reading in
 * the window falls on one date — trivially so for a single reading, and
 * otherwise only for a list holding two rows for one day, which
 * `weight_logs`'s unique index on `(user_id, date)` makes impossible. That case
 * is kept anyway, because the invariant belongs to the DATABASE while this
 * function's parameter is a plain array, and "no rate" is a better answer to a
 * hand-built list than `Infinity`.
 *
 * A second division by zero the criterion does not name sits in the percentage:
 * `start === target` is a legal profile — someone at maintenance — and dividing
 * the journey by itself would put `NaN%` on the screen. It answers `null`.
 *
 * ## The window ends at the latest reading, not at today
 *
 * So this module never reads a clock, and so a rate still exists after a
 * fortnight away from the scales. The cost is that the figure can be stale, and
 * what pays it is the screen above: `/weight` prints the latest weigh-in's own
 * date directly under the headline figure, so "three weeks ago" is already on
 * the page, immediately above a rate that covers the four weeks ending there.
 */

/** Four weeks, inclusive of the latest reading's own day. P5's trailing window. */
export const TRAILING_DAYS = 28;

/**
 * How far under the configured pace still counts as on pace.
 *
 * 0.05 kg/week, which turns a configured 0.50 into the 0.45–0.50 band the
 * program is actually run to. The band is one-sided on purpose: losing FASTER
 * than the goal is off pace too, because the pace is what separates a cut from
 * a crash, and § Semantic Colors gives `success` to the rate that is where it
 * should be rather than to the biggest number.
 *
 * Off pace is never an error, in either direction — the view keeps it in
 * `text-primary` and the guide's § Governing Principle is why: a figure that
 * turns red is an accusation, and a week is not a failure.
 */
export const PACE_TOLERANCE_KG = 0.05;

/** The trailing rate, and the one verdict this app makes. */
export type TrailingRate = {
  /**
   * Signed change per week — NEGATIVE while losing.
   *
   * The slope's own sign, not the loss. Inverting it here would make `rate` mean
   * the opposite of the arithmetic that produced it two lines up, and the view
   * would print a minus sign it had to remember to add. `onPace` does the one
   * conversion that needs doing.
   */
  kgPerWeek: number;
  /** Within `PACE_TOLERANCE_KG` under the configured pace, and no faster. */
  onPace: boolean;
};

/** Everything the progress grid draws. */
export type WeightStats = {
  /**
   * Start minus latest, signed and NOT clamped.
   *
   * A gained kilogram reads as a negative loss rather than as zero, because
   * "0.0 kg" under a label saying "Lost" is a number that is not true. The view
   * relabels it rather than hiding it.
   */
  lostKg: number;
  /**
   * Distance still to go, floored at zero.
   *
   * Clamped where `lostKg` is not, because past the target the honest figure is
   * "none left" rather than "−0.4 kg remaining", and P5 recalibrates the target
   * every 5kg — so arriving under it is an expected state of this app, not an
   * edge case someone will hit once.
   */
  remainingKg: number;
  /** The whole start → target distance, which is what the percentage is of. */
  journeyKg: number;
  /** 0–100, clamped at both ends. `null` when start and target are the same. */
  percentToTarget: number | null;
  /** `null` until a second weigh-in lands inside the trailing window. */
  rate: TrailingRate | null;
};

/** 7, written once so the ×7 below is a conversion rather than a constant. */
const DAYS_PER_WEEK = 7;

/**
 * Rounded to `places`, and never `-0`.
 *
 * The `-0` clause is `macros.ts`'s `round1`, for the same reason it gives there:
 * `-0` is a real JS value that renders as "−0", which reads as a shortfall on a
 * program that is exactly level. Not imported FROM `round1` because this module
 * needs two decimals as well as one — the pace is `numeric(4, 2)`, so a rate
 * shown to one would round 0.45 and 0.54 onto the same figure while the verdict
 * beside it told them apart.
 */
function round(value: number, places: 1 | 2): number {
  const factor = places === 1 ? 10 : 100;
  const rounded = Math.round(value * factor) / factor;

  return rounded === 0 ? 0 : rounded;
}

/** The arithmetic mean. Only ever called with a non-empty list. */
function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * The slope through the trailing window, in kg per week.
 *
 * `x` is days relative to the latest reading, so the values are zero and
 * negative. Any origin gives the same slope — it is a difference from the mean
 * that goes into the sum — and this one is chosen because it makes the window
 * membership test and the coordinate the same subtraction.
 */
function trailingRate(
  ordered: readonly Reading[],
  latest: Reading,
  goalPaceKgPerWeek: number,
): TrailingRate | null {
  const points = ordered
    .filter((reading) => daysBetween(reading.date, latest.date) < TRAILING_DAYS)
    .map((reading) => ({
      x: daysBetween(latest.date, reading.date),
      y: reading.weightKg,
    }));

  const meanX = mean(points.map((point) => point.x));
  const meanY = mean(points.map((point) => point.y));

  let covariance = 0;
  let variance = 0;

  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }

  // No spread in the dates, so there is no slope through them — the ONE guard
  // this needs, covering both ways it happens. See the module doc: a leading
  // `points.length < 2` was written here first and removed as unobservable,
  // because a single reading reaches this line with a variance of exactly zero
  // and leaves by it.
  if (variance === 0) return null;

  const kgPerWeek = round((covariance / variance) * DAYS_PER_WEEK, 2);

  return { kgPerWeek, onPace: onPace(kgPerWeek, goalPaceKgPerWeek) };
}

/**
 * Whether a rate sits in the band, compared in whole hundredths of a kilogram.
 *
 * Integers rather than floats, because `0.5 - 0.05` is 0.44999999999999996 and
 * the two edges of this band are figures a user will deliberately land on. Both
 * operands are already at two decimals — `goal_pace_kg_per_week` is
 * `numeric(4, 2)` and the rate was rounded to match — so scaling by 100 is
 * exact and the comparison is the one the screen shows rather than the one the
 * floating-point residue implies.
 *
 * The verdict is taken on the ROUNDED rate for the same reason: a screen
 * printing "−0.50 kg/wk" in neutral ink because the unrounded slope was
 * −0.5000001 would be right in a way nobody could see.
 */
function onPace(kgPerWeek: number, goalPaceKgPerWeek: number): boolean {
  const hundredths = (value: number) => Math.round(value * 100);

  // The band is stated in LOSS, which is the direction the pace is configured
  // in. A week of gaining makes this negative and fails the floor without a
  // case of its own.
  const loss = hundredths(-kgPerWeek);
  const pace = hundredths(goalPaceKgPerWeek);

  return loss >= pace - hundredths(PACE_TOLERANCE_KG) && loss <= pace;
}

/**
 * The progress figures and the trailing rate, from a history and a profile.
 *
 * `null` for an empty history — the contract `chartGeometry` and `loadWeighIns`
 * both keep for "there is nothing to describe". The screen already renders
 * § UI Copy's "No weigh-ins yet" for that case, and a zeroed shape would let it
 * render "0%" instead, which is a claim about a program that has not started.
 *
 * Both directions of travel work, because `profiles` does not forbid a target
 * above the start: progress is measured TOWARDS the target rather than
 * downwards, so a gaining goal fills its percentage the same way. `lostKg`
 * keeps the cut's vocabulary because that is what P5 asks for; the view is what
 * decides the word above it.
 */
export function weightStats({
  readings,
  startWeightKg,
  targetWeightKg,
  goalPaceKgPerWeek,
}: {
  /** Every weigh-in, in any order. */
  readings: readonly Reading[];
  startWeightKg: number;
  targetWeightKg: number;
  goalPaceKgPerWeek: number;
}): WeightStats | null {
  // Sorted here rather than at the call site, on `weight-chart.ts`'s reasoning:
  // the screen holds its rows newest-first because that is the order the history
  // list reads in, and a module that depended on being handed them the other way
  // round would be one refactor of that list away from reporting the rate with
  // its sign inverted — a figure that looks entirely plausible upside down.
  //
  // Byte order, not `localeCompare`: these are `YYYY-MM-DD` strings, where byte
  // order IS chronological order.
  const ordered = [...readings].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Narrows for `noUncheckedIndexedAccess` and is the empty state, one check
  // doing both — `chartGeometry` reads the same way.
  const latest = ordered[ordered.length - 1];

  if (latest === undefined) return null;

  const journey = Math.abs(startWeightKg - targetWeightKg);

  // −1 for a cut, +1 for a gaining goal, 0 when there is no journey at all.
  const toward = Math.sign(targetWeightKg - startWeightKg);
  const progress = (latest.weightKg - startWeightKg) * toward;

  return {
    lostKg: round(startWeightKg - latest.weightKg, 1),
    remainingKg: round(Math.max(0, journey - progress), 1),
    journeyKg: round(journey, 1),
    // Clamped before it is a percentage, so overshooting reads as 100 rather
    // than 104 and a gain against a losing goal reads as 0 rather than −8.
    percentToTarget:
      journey === 0 ? null : Math.round(Math.min(1, Math.max(0, progress / journey)) * 100),
    rate: trailingRate(ordered, latest, goalPaceKgPerWeek),
  };
}
