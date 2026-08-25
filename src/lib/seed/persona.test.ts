import { describe, expect, it } from "vitest";

import { dayOfWeek } from "@/lib/date";

import { seedMeals } from "./meals";
import { DEMO_PROGRAM_WEEKS, DEMO_TIMEZONE, demoProfile, demoProgramStart } from "./persona";
import { seedPlanTemplate } from "./plan";

/**
 * The demo persona — FUEL-40's half of P7.
 *
 * Two claims worth testing, and neither is "the constants are the constants".
 *
 * The first is that the persona's TARGETS are answerable to the seeded library.
 * PRD Open Question 7 chose them "to sit within ~3% of what the seeded meal
 * library actually delivers", and the arithmetic is recomputed here from
 * `meals.ts` and `plan.ts` rather than compared against a literal. That makes
 * this a cross-check between two files: change a recipe and this fails, which
 * is the point. `plan.test.ts` asks the mirror-image question — whether the
 * library hits the targets — and the duplication is deliberate, because either
 * file could be the one that moved.
 *
 * The second is that `programStartDate` is a MONDAY, whenever it is asked. The
 * Circuit A/B alternation counts from it, and a mid-week start shifts the whole
 * rotation off the week it was designed for — with both circuits looking
 * perfectly plausible on any given day, so nothing on any screen would say so.
 */

describe("what the persona is measured against", () => {
  const mealsByKey = new Map(seedMeals.map((meal) => [meal.key, meal]));

  /** Monday to Friday. The weekend template is deliberately lighter. */
  const WEEKDAYS = [1, 2, 3, 4, 5];

  const totalsFor = (day: number) =>
    seedPlanTemplate
      .filter((entry) => entry.dayOfWeek === day)
      .reduce(
        (sum, entry) => {
          const meal = mealsByKey.get(entry.mealKey);

          // Named rather than asserted away: a template entry pointing at a
          // missing key would otherwise silently lower the average and make
          // the targets look better than they are.
          if (!meal) throw new Error(`The template names "${entry.mealKey}", which is not a seed meal.`);

          return {
            proteinG: sum.proteinG + meal.proteinG,
            fatG: sum.fatG + meal.fatG,
            carbG: sum.carbG + meal.carbG,
          };
        },
        { proteinG: 0, fatG: 0, carbG: 0 },
      );

  const weekdays = WEEKDAYS.map(totalsFor);

  const mean = (pick: (totals: (typeof weekdays)[number]) => number) =>
    weekdays.reduce((sum, totals) => sum + pick(totals), 0) / weekdays.length;

  /** The clock only reaches `programStartDate`; the targets do not move. */
  const profile = demoProfile(new Date("2026-08-25T09:00:00Z"));

  const within = (actual: number, target: number, tolerance: number) =>
    Math.abs(actual - target) / target <= tolerance;

  it("sets a protein target the seeded week actually delivers", () => {
    expect(within(mean((t) => t.proteinG), profile.targetProteinG, 0.035)).toBe(true);
  });

  it("sets a carb target the seeded week actually delivers", () => {
    expect(within(mean((t) => t.carbG), profile.targetCarbG, 0.035)).toBe(true);
  });

  it("sets a fat target the seeded week actually delivers", () => {
    // The one the PRD flags as hardest: the source plan's stated fat target is
    // below what the recipes can produce — MCT coffee alone is 14g — so the
    // persona carries 50g rather than reporting "over on fat" every single day.
    expect(within(mean((t) => t.fatG), profile.targetFatG, 0.035)).toBe(true);
  });

  it("is cutting towards its target rather than away from it", () => {
    // A sign check on the persona as a whole. Reversed, every screen in the app
    // still renders — the chart simply draws a program that is going backwards,
    // and a visitor has nothing to check it against.
    expect(profile.targetWeightKg).toBeLessThan(profile.startWeightKg);
    expect(profile.goalPaceKgPerWeek).toBeGreaterThan(0);
  });
});

describe("when the persona's program started", () => {
  /**
   * Instants chosen to land on every weekday, on both sides of a British
   * Summer Time boundary, and either side of midnight in London.
   *
   * The suite runs in America/New_York (see vitest.config.mts) while the
   * persona is Europe/London, so an implementation reading the server's own
   * clock instead of the persona's zone fails here rather than in production.
   */
  const INSTANTS = [
    "2026-08-25T09:00:00Z",
    "2026-08-26T23:30:00Z",
    "2026-08-27T00:30:00Z",
    "2026-08-28T12:00:00Z",
    "2026-08-29T12:00:00Z",
    "2026-08-30T12:00:00Z",
    "2026-08-31T12:00:00Z",
    // Either side of the last Sunday in October, when London leaves BST.
    "2026-10-24T23:30:00Z",
    "2026-10-25T02:30:00Z",
    "2026-10-26T00:30:00Z",
    // And the March transition, in the other direction.
    "2027-03-27T23:30:00Z",
    "2027-03-29T00:30:00Z",
  ];

  it.each(INSTANTS)("is a Monday, whenever it is asked (%s)", (instant) => {
    // 1 is Monday — `dayOfWeek` is 0 = Sunday, matching getUTCDay().
    expect(dayOfWeek(demoProgramStart(new Date(instant)))).toBe(1);
  });

  it("puts the persona in the twelfth week of their program", () => {
    // Not "roughly twelve weeks ago": it is the Monday eleven weeks before the
    // CURRENT week's Monday, so today always falls inside week twelve. FUEL-41
    // fills that window with history, and a start date that disagreed with it
    // would date weigh-ins before the program they belong to.
    const now = new Date("2026-08-25T09:00:00Z");
    const start = demoProgramStart(now);

    const weeksElapsed =
      (Date.parse("2026-08-24T00:00:00Z") - Date.parse(`${start}T00:00:00Z`)) /
      (7 * 24 * 60 * 60 * 1000);

    expect(weeksElapsed).toBe(DEMO_PROGRAM_WEEKS - 1);
  });

  it("moves forward with the calendar rather than sitting on a committed date", () => {
    // The whole reason this is a function. A hardcoded date passes every test
    // above on the day it is written and describes a stranger a year later.
    const earlier = demoProgramStart(new Date("2026-08-25T09:00:00Z"));
    const later = demoProgramStart(new Date("2027-08-25T09:00:00Z"));

    expect(later > earlier).toBe(true);
  });

  it("dates the profile in the persona's own zone", () => {
    // 00:30 in London on the 27th is 23:30 in New York on the 26th. A resolver
    // reading the server's zone gets the previous week whenever a provision
    // lands in those hours — one week of rotation, wrong, a few times a night.
    expect(demoProfile(new Date("2026-08-27T00:30:00Z")).programStartDate).toBe(
      demoProgramStart(new Date("2026-08-27T00:30:00Z")),
    );

    expect(demoProfile(new Date("2026-08-25T09:00:00Z")).timezone).toBe(DEMO_TIMEZONE);
  });
});
