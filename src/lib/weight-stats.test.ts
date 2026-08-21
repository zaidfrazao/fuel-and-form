import { describe, expect, test } from "vitest";

import { daysBetween } from "./date";
import type { Reading } from "./weight-chart";
import { PACE_TOLERANCE_KG, TRAILING_DAYS, weightStats } from "./weight-stats";

/**
 * Progress and the trailing rate — FUEL-36, PRD § P5.
 *
 * Gated at 100% for the reason `weight-chart.test.ts` gives about its own
 * subject: every way this can be wrong produces a plausible number. A rate with
 * its sign flipped is a gain reported as a loss; a window off by a day is a
 * figure taken over the wrong month; a percentage that forgot to clamp says 104%
 * of a journey. None of them throws, and none of them looks like anything but a
 * statistic.
 *
 * The verdict is the part with teeth. It is the only claim this app makes about
 * whether the program is WORKING, and both ways it can fail are silent: a band
 * that is a hundredth too wide colours a miss green, and one that is a
 * hundredth too narrow leaves a hit in grey. So the two edges are asserted as
 * edges — on pace at exactly the floor and exactly the ceiling, off pace one
 * hundredth outside each — rather than sampled somewhere in the middle where
 * any band would pass.
 *
 * ## The fixtures
 *
 * Invented figures throughout, per Testing Strategy § 1.5: the repository is
 * public and the owner's real weight lives in the database, never in git.
 *
 * The rates are built from CLEAN differences over whole weeks — 0.9kg across
 * fourteen days is 0.45 a week — so a fixture states the rate it is testing
 * rather than hiding it behind four decimals nobody can check by eye.
 */

const START_KG = 88.2;
const TARGET_KG = 80.4;

/** The journey the percentage is a percentage of. */
const JOURNEY_KG = 7.8;

/** `profiles.goal_pace_kg_per_week`, and the middle of the band it implies. */
const GOAL_PACE = 0.5;

/** Four weekly weigh-ins, newest first — the order the screen holds them in. */
const HISTORY: Reading[] = [
  { date: "2026-08-17", weightKg: 84 },
  { date: "2026-08-10", weightKg: 84.5 },
  { date: "2026-08-03", weightKg: 85 },
  { date: "2026-07-27", weightKg: 85.5 },
];

const stats = (readings: readonly Reading[], goalPaceKgPerWeek = GOAL_PACE) =>
  weightStats({
    readings,
    startWeightKg: START_KG,
    targetWeightKg: TARGET_KG,
    goalPaceKgPerWeek,
  });

/** A rate, or a failure that says which case produced no rate at all. */
function rateOf(readings: readonly Reading[], goalPaceKgPerWeek = GOAL_PACE) {
  const rate = stats(readings, goalPaceKgPerWeek)?.rate;

  if (!rate) throw new Error("expected a trailing rate");

  return rate;
}

describe("progress", () => {
  test("reports kg lost, kg remaining, and the percentage of the journey", () => {
    const result = stats(HISTORY);

    // 88.2 → 84, against a journey of 7.8 to the target.
    expect(result?.lostKg).toBe(4.2);
    expect(result?.remainingKg).toBe(3.6);
    expect(result?.journeyKg).toBe(JOURNEY_KG);
    expect(result?.percentToTarget).toBe(54);
  });

  test("lost and remaining account for the whole journey between them", () => {
    const result = stats(HISTORY);

    // The relation is the real claim — a percentage that agreed with neither
    // figure beside it would be the bug this catches, and it is one no absolute
    // assertion above can see.
    expect((result?.lostKg ?? 0) + (result?.remainingKg ?? 0)).toBeCloseTo(JOURNEY_KG, 10);
  });

  test("is null for a history with nothing in it", () => {
    // Not a zeroed shape. "0%" is a claim about a program that has not started,
    // and § UI Copy gives the empty state its own sentence.
    expect(stats([])).toBeNull();
  });

  test("gives the progress figures from a single weigh-in", () => {
    const result = stats([{ date: "2026-08-17", weightKg: 84 }]);

    expect(result?.lostKg).toBe(4.2);
    expect(result?.percentToTarget).toBe(54);
    // One reading is not a trend. P5's single-data-point state.
    expect(result?.rate).toBeNull();
  });

  test("floors what remains at zero once the target is passed", () => {
    // P5 recalibrates the target every 5kg, so arriving under it is an expected
    // state of this app rather than an edge case. "−1.1 kg remaining" is not a
    // distance and "114%" is not a proportion.
    const result = stats([{ date: "2026-08-17", weightKg: 79.3 }]);

    expect(result?.lostKg).toBe(8.9);
    expect(result?.remainingKg).toBe(0);
    expect(result?.percentToTarget).toBe(100);
  });

  test("reports a gain as a negative loss rather than as nothing", () => {
    // Clamping here would print "0.0 kg" under a label saying Lost, which is a
    // number that is not true. The view relabels it; the arithmetic does not
    // soften it.
    const result = stats([{ date: "2026-08-17", weightKg: 89.4 }]);

    expect(result?.lostKg).toBe(-1.2);
    expect(result?.percentToTarget).toBe(0);
    expect(result?.remainingKg).toBe(9);
  });

  test("never returns a negative zero", () => {
    // `−0` renders as "−0", which reads as a shortfall on a program that is
    // exactly level. `macros.ts` carries the same clause for the same reason.
    //
    // Twenty grams ABOVE the starting weight, not on it. A reading sitting
    // exactly on the start computes `a − a`, which is `+0` in IEEE 754 — so
    // that fixture passes whether the clause is there or not, and pins nothing.
    // This one rounds a real negative to zero, which is where `−0` is actually
    // made. FUEL-10 lost a whole release to the first version of this test.
    const result = stats([{ date: "2026-08-17", weightKg: 88.22 }]);

    expect(Object.is(result?.lostKg, 0)).toBe(true);
  });

  test("has no percentage when the start and the target are the same weight", () => {
    // A legal profile — someone at maintenance — and the second division by zero
    // on this screen. `NaN%` is the alternative.
    const result = weightStats({
      readings: HISTORY,
      startWeightKg: TARGET_KG,
      targetWeightKg: TARGET_KG,
      goalPaceKgPerWeek: GOAL_PACE,
    });

    expect(result?.percentToTarget).toBeNull();
    expect(result?.journeyKg).toBe(0);
    expect(result?.remainingKg).toBe(0);
  });

  test("counts a goal above the start upwards rather than backwards", () => {
    // `profiles` does not forbid a target above the start, so progress is
    // measured TOWARDS the target rather than downwards.
    const result = weightStats({
      readings: [{ date: "2026-08-17", weightKg: 84 }],
      startWeightKg: TARGET_KG,
      targetWeightKg: START_KG,
      goalPaceKgPerWeek: GOAL_PACE,
    });

    expect(result?.percentToTarget).toBe(46);
    expect(result?.remainingKg).toBe(4.2);
  });
});

describe("the trailing rate", () => {
  test("is the slope through the window, in kg per week", () => {
    // Four weekly readings falling half a kilogram each.
    expect(rateOf(HISTORY).kgPerWeek).toBe(-0.5);
  });

  test("does not depend on the order the readings arrive in", () => {
    // The screen holds its rows newest-first because that is the order the
    // history list reads in. A module that depended on that would be one
    // refactor of the list away from reporting a loss as a gain.
    expect(stats([...HISTORY].reverse())).toEqual(stats(HISTORY));
  });

  test("reduces to the plain difference when there are only two readings", () => {
    const pair: Reading[] = [
      { date: "2026-08-17", weightKg: 84 },
      { date: "2026-08-10", weightKg: 84.6 },
    ];

    const endpoints = ((84 - 84.6) / daysBetween("2026-08-10", "2026-08-17")) * 7;

    expect(rateOf(pair).kgPerWeek).toBe(-0.6);
    expect(rateOf(pair).kgPerWeek).toBeCloseTo(endpoints, 10);
  });

  test("smooths a spike that the plain difference would follow", () => {
    // P5: "a trailing average smooths daily noise if weigh-ins become more
    // frequent than weekly". Eight daily readings falling 0.1 a day — a true
    // 0.7 a week — with the last one 0.5 high, which is an ordinary morning
    // after a salty dinner and lands on exactly the reading a two-point estimate
    // is built from.
    const trendKgPerWeek = -0.7;
    const daily: Reading[] = [
      { date: "2026-08-10", weightKg: 84.8 },
      { date: "2026-08-11", weightKg: 84.7 },
      { date: "2026-08-12", weightKg: 84.6 },
      { date: "2026-08-13", weightKg: 84.5 },
      { date: "2026-08-14", weightKg: 84.4 },
      { date: "2026-08-15", weightKg: 84.3 },
      { date: "2026-08-16", weightKg: 84.2 },
      { date: "2026-08-17", weightKg: 84.6 },
    ];

    const endpoints = ((84.6 - 84.8) / daysBetween("2026-08-10", "2026-08-17")) * 7;
    const smoothed = rateOf(daily).kgPerWeek;

    // Asserted as an inequality rather than against a figure. The claim P5 makes
    // is comparative — that the rate follows the trend further than a two-point
    // estimate does — and pinning a number here would pass just as happily on an
    // estimator that had stopped smoothing at all.
    expect(Math.abs(smoothed - trendKgPerWeek)).toBeLessThan(
      Math.abs(endpoints - trendKgPerWeek),
    );

    // And the same series without the spike is the trend exactly, so the
    // inequality above is about the spike rather than about the estimator being
    // biased.
    expect(rateOf(daily.slice(0, 7)).kgPerWeek).toBe(trendKgPerWeek);
  });

  test("counts a reading on the last day of the window and drops the one before it", () => {
    const latest: Reading = { date: "2026-08-17", weightKg: 84 };
    const inside: Reading = { date: "2026-07-21", weightKg: 86 };
    const outside: Reading = { date: "2026-07-20", weightKg: 86 };

    expect(daysBetween(inside.date, latest.date)).toBe(TRAILING_DAYS - 1);
    expect(daysBetween(outside.date, latest.date)).toBe(TRAILING_DAYS);

    expect(rateOf([latest, inside]).kgPerWeek).toBe(-0.52);
    // The only reading left inside the window is the latest one, so there is no
    // slope — which is the same guard as the single-weigh-in case.
    expect(stats([latest, outside])?.rate).toBeNull();
  });

  test("ignores a reading older than the window when newer ones exist", () => {
    const recent: Reading[] = [
      { date: "2026-08-17", weightKg: 84 },
      { date: "2026-08-10", weightKg: 84.5 },
    ];

    // A figure from before the window would drag the slope steeply downwards if
    // it were counted.
    const withHistory = [...recent, { date: "2026-06-01", weightKg: 92 }];

    expect(rateOf(withHistory).kgPerWeek).toBe(rateOf(recent).kgPerWeek);
  });

  test("keeps the progress figures when there is no rate to report", () => {
    // The two answers are independent: a program with one weigh-in has come a
    // distance even though it has no speed.
    const result = stats([{ date: "2026-08-17", weightKg: 84 }]);

    expect(result?.rate).toBeNull();
    expect(result?.lostKg).toBe(4.2);
  });

  test("has no rate for two readings that claim the same day", () => {
    // Unreachable through the database — `weight_logs` is unique on
    // `(user_id, date)` — and the guard is what stops a caller that built the
    // list by hand from being told the rate is `Infinity`.
    expect(
      stats([
        { date: "2026-08-17", weightKg: 84 },
        { date: "2026-08-17", weightKg: 84.5 },
      ])?.rate,
    ).toBeNull();
  });
});

describe("the verdict", () => {
  /** Two readings a fortnight apart, falling by `dropKg` between them. */
  const fortnight = (dropKg: number): Reading[] => [
    { date: "2026-08-17", weightKg: 84 },
    { date: "2026-08-03", weightKg: 84 + dropKg },
  ];

  test("is on pace at exactly the configured pace", () => {
    // The ceiling of the band, inclusive.
    const rate = rateOf(fortnight(1));

    expect(rate.kgPerWeek).toBe(-GOAL_PACE);
    expect(rate.onPace).toBe(true);
  });

  test("is on pace at exactly the tolerance below the pace", () => {
    // The floor of the band, inclusive — 0.45 against a configured 0.50. This
    // is the assertion that would fail on a floating-point comparison, because
    // 0.5 − 0.05 is 0.44999999999999996.
    const rate = rateOf(fortnight(0.9));

    // Written as the literal it is rather than as `-(GOAL_PACE -
    // PACE_TOLERANCE_KG)`, which is a DIFFERENT float from −0.45 — the very
    // residue the verdict compares in hundredths to avoid.
    expect(GOAL_PACE - PACE_TOLERANCE_KG).toBeCloseTo(0.45, 10);
    expect(rate.kgPerWeek).toBe(-0.45);
    expect(rate.onPace).toBe(true);
  });

  test("is off pace one hundredth under the floor", () => {
    // The same 0.45 a week, against a pace configured a hundredth higher — so
    // the band moves rather than the rate, and the fixture keeps its clean
    // fortnight.
    expect(rateOf(fortnight(0.9), 0.51).onPace).toBe(false);
  });

  test("is off pace when the loss is faster than the goal", () => {
    // Not a bonus. The pace is what separates a cut from a crash, and § Semantic
    // Colors gives `success` to the rate that is where it should be rather than
    // to the biggest number. Off pace, in either direction, is never an error.
    const rate = rateOf(fortnight(1.5));

    expect(rate.kgPerWeek).toBe(-0.75);
    expect(rate.onPace).toBe(false);
  });

  test("is off pace on a flat week and on a gaining one", () => {
    const flat = rateOf(fortnight(0));
    const gaining = rateOf(fortnight(-0.7));

    expect(Object.is(flat.kgPerWeek, 0)).toBe(true);
    // Ten grams across three weeks is a real loss that rounds to nothing at two
    // decimals — the rate's own `−0`, and the one a reader would see with a
    // sign in front of it. A fortnight does not do it: 0.01 across 14 days
    // lands on −0.005000000000002558, and the residue past the fifth decimal is
    // enough to round it to −0.01 instead.
    expect(
      Object.is(
        rateOf([
          { date: "2026-08-17", weightKg: 84 },
          { date: "2026-07-27", weightKg: 84.01 },
        ]).kgPerWeek,
        0,
      ),
    ).toBe(true);
    expect(flat.onPace).toBe(false);

    expect(gaining.kgPerWeek).toBe(0.35);
    expect(gaining.onPace).toBe(false);
  });
});
