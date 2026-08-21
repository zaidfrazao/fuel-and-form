import { describe, expect, test } from "vitest";

import type { MacroBearing } from "./macros";
import { type PlannedDay, weekGrid } from "./week-grid";
import { weekTotals } from "./week-totals";

/**
 * The week's arithmetic — FUEL-33.
 *
 * Gated at 100% for the reason `macros.ts` is: every way this can be wrong is a
 * plausible figure rather than a crash. A dropped cell, a divisor of seven, a
 * mean taken before the rounding — each prints a number that looks like a
 * number, on a screen whose whole job is being trusted about numbers.
 *
 * ## The fixtures
 *
 * Every macro below is chosen so a wrong answer names its own cause: no two
 * meals share a figure and no two sum to a third, so 950 kcal can only be oats
 * and salad, and 1,250 can only be salad and chilli. `macros.test.ts` argues
 * the same fixture discipline at greater length.
 *
 * Dates are the resolver's own week — Monday 9 March 2026 — so a fixture read
 * across suites means the same day in both.
 */

type Meal = MacroBearing & { id: string };

const OATS: Meal = { id: "m1", kcal: 400, proteinG: 20, fatG: 10, carbG: 60 };
const SALAD: Meal = { id: "m2", kcal: 550, proteinG: 35, fatG: 20, carbG: 40 };
const CHILLI: Meal = { id: "m3", kcal: 700, proteinG: 45, fatG: 25, carbG: 65 };

/** Zero macros and untracked — PRD Open Question 4's shape, ahead of the column. */
const FLEXIBLE: Meal = {
  id: "m4",
  kcal: 0,
  proteinG: 0,
  fatG: 0,
  carbG: 0,
  isUntracked: true,
};

const MON = "2026-03-09";
const TUE = "2026-03-10";
const WED = "2026-03-11";

type Cell = PlannedDay<Meal>["meals"][number];

const planned = (
  slot: Cell["slot"],
  meal: Meal,
  source: Cell["source"] = "template",
  entryId = `e-${slot}`,
): Cell => ({ slot, meal, source, entryId });

const day = (date: string, meals: Cell[] = []): PlannedDay<Meal> => ({ date, meals });

/** The columns as the grid holds them — the input this module actually reads. */
const columns = (days: PlannedDay<Meal>[], today = MON) => weekGrid(days, today);

const figures = (days: PlannedDay<Meal>[], today = MON) => weekTotals(columns(days, today));

describe("a day's figures", () => {
  test("total the meals in the column", () => {
    const { days } = figures([
      day(MON, [planned("breakfast", OATS), planned("lunch", SALAD), planned("dinner", CHILLI)]),
    ]);

    expect(days[0]?.totals).toMatchObject({
      kcal: 1650,
      proteinG: 100,
      fatG: 55,
      carbG: 165,
    });
  });

  test("skip the empty cells rather than counting them as anything", () => {
    // Two of five slots filled. The other three are `meal: null`, and a total
    // that reached into them would throw rather than answer — which is the
    // failure this is really pinning, since `flatMap` is what stops it.
    const { days } = figures([day(MON, [planned("breakfast", OATS), planned("lunch", SALAD)])]);

    expect(days[0]?.totals.kcal).toBe(950);
  });

  test("follow the column, so an override counts instead of the template", () => {
    // The P4 criterion, at the level where it is decidable: this module never
    // sees a plan, only what resolution — or an optimistic swap — put in the
    // cell. Same date, same slot, different meal, different figure.
    const template = figures([day(MON, [planned("dinner", SALAD)])]);
    const swapped = figures([day(MON, [planned("dinner", CHILLI, "override", "o1")])]);

    expect(template.days[0]?.totals.kcal).toBe(550);
    expect(swapped.days[0]?.totals.kcal).toBe(700);
  });

  test("a day with nothing planned is zero, and says it is not planned", () => {
    const { days } = figures([day(MON)]);

    expect(days[0]?.planned).toBe(false);
    expect(days[0]?.totals.kcal).toBe(0);
  });

  test("an untracked meal is a plan for the day, and adds nothing to it", () => {
    const { days } = figures([day(MON, [planned("breakfast", OATS), planned("lunch", FLEXIBLE)])]);

    expect(days[0]?.totals.kcal).toBe(400);
    expect(days[0]?.totals.partial).toBe(true);
    // Not `kcal > 0`: the day is planned, and a divisor that decided otherwise
    // would drop it from the average for having been eaten off-plan.
    expect(days[0]?.planned).toBe(true);
  });

  test("come back in the order they arrived", () => {
    const { days } = figures([day(MON), day(TUE), day(WED)]);

    expect(days.map((entry) => entry.date)).toEqual([MON, TUE, WED]);
  });
});

describe("the average", () => {
  test("divides by the days that have a plan, not by the days in the week", () => {
    // Three days of 2,000 kcal average to 2,000. Divided by seven they average
    // to 857 — a figure describing no day that exists, on a first program week
    // or any week the template leaves partly empty.
    const { average, plannedDays } = figures([
      day(MON, [planned("breakfast", OATS), planned("dinner", CHILLI)]),
      day(TUE, [planned("breakfast", OATS), planned("dinner", CHILLI)]),
      day(WED, [planned("breakfast", OATS), planned("dinner", CHILLI)]),
      day("2026-03-12"),
      day("2026-03-13"),
      day("2026-03-14"),
      day("2026-03-15"),
    ]);

    expect(plannedDays).toBe(3);
    expect(average?.kcal).toBe(1100);
  });

  test("averages every macro, not only the two the grid prints", () => {
    const { average } = figures([
      day(MON, [planned("breakfast", OATS)]),
      day(TUE, [planned("breakfast", CHILLI)]),
    ]);

    expect(average).toEqual({ kcal: 550, proteinG: 32.5, fatG: 17.5, carbG: 62.5 });
  });

  test("keeps one decimal, the precision the figures went in with", () => {
    // 130 g of protein over three days. Unrounded this is 43.333333333333336,
    // which is a claim to precision the meals never had and a number no column
    // in the schema could hold.
    const { average } = figures([
      day(MON, [planned("breakfast", OATS), planned("lunch", SALAD)]),
      day(TUE, [planned("breakfast", OATS)]),
      day(WED, [planned("breakfast", OATS), planned("lunch", SALAD)]),
    ]);

    expect(average?.proteinG).toBe(43.3);
  });

  test("is nothing at all when no day has a plan", () => {
    // A week before the program starts. `null` rather than zero: there is no
    // mean of nothing, and 0 kcal would read as a week planned to starve.
    const { average, plannedDays } = figures([day(MON), day(TUE), day(WED)]);

    expect(average).toBeNull();
    expect(plannedDays).toBe(0);
  });

  test("counts a single planned day as itself", () => {
    const { average, plannedDays } = figures([day(MON, [planned("dinner", CHILLI)]), day(TUE)]);

    expect(plannedDays).toBe(1);
    expect(average?.kcal).toBe(700);
  });
});
