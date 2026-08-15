import { describe, expect, it } from "vitest";

import {
  dayTotals,
  deltaFromTarget,
  type MacroTarget,
  PREVIEW_ENTRY_ID,
  previewDayTotals,
  summariseDay,
  totalMacros,
} from "./macros";
import type { DayPlanOverride, Meal, MealSlot, PlanTemplateEntry } from "./db/schema";
import { type Plan, resolveDay } from "./resolve-plan";

/**
 * Testing Strategy § 1.3 — the six cases, in order, each named by number.
 *
 * ## Why these fixtures are not resolve-plan.test.ts's
 *
 * That suite's fixture week is built to make date bugs visible: its meals differ
 * by weekday, and their macros are incidental. These cases are arithmetic, and
 * every number below was chosen so a wrong answer names its own cause — the four
 * figures of any one meal cannot be confused for another's, and no two meals sum
 * to a third. Sharing one fixture would mean serving both purposes badly, and
 * would couple two suites that fail for entirely different reasons.
 *
 * ## The fixture week
 *
 *   Mon-Fri  breakfast oats | lunch salad | dinner chilli
 *   Sat      breakfast oats | lunch flexible (UNTRACKED) | dinner curry
 *   Sun      nothing at all
 *
 * Saturday is case 3's day and Sunday is case 4's. Program start is Monday
 * 2026-03-02, so 2026-03-01 is case 4's other empty shape: a date the program
 * has not reached rather than one the template does not cover.
 */

const USER = "user-owner";
const PROGRAM_START = "2026-03-02"; // a Monday

const MONDAY_DATE = "2026-03-09";
const SATURDAY_DATE = "2026-03-07";
const SUNDAY_DATE = "2026-03-08";
const BEFORE_START_DATE = "2026-03-01";

const SATURDAY = 6;
const WEEKDAYS = [1, 2, 3, 4, 5];

function meal(id: string, fields: Partial<Meal> = {}): Meal {
  return {
    id,
    userId: USER,
    name: id,
    slotType: "dinner",
    kcal: 500,
    proteinG: 40,
    fatG: 15,
    carbG: 45,
    method: null,
    notes: null,
    isArchived: false,
    ...fields,
  };
}

/**
 * Deliberately awkward numbers.
 *
 * The grams end in .1, .3 and .7 rather than whole numbers because
 * `numeric(6, 1)` really does come back as a float and really does drift:
 * 41.3 + 38.7 + 52.1 is 132.10000000000002 before rounding. Whole-gram fixtures
 * would pass against an implementation that never rounds at all.
 */
const OATS = meal("oats", { slotType: "breakfast", kcal: 420, proteinG: 41.3, fatG: 12.7, carbG: 48.1 });
const SALAD = meal("salad", { slotType: "lunch", kcal: 480, proteinG: 38.7, fatG: 18.1, carbG: 30.3 });
const CHILLI = meal("chilli", { kcal: 700, proteinG: 52.1, fatG: 24.3, carbG: 61.7 });
const CURRY = meal("curry", { kcal: 760, proteinG: 45.9, fatG: 31.2, carbG: 70.4 });

/**
 * The weekend's flexible lunch — case 3's subject.
 *
 * `isUntracked` is not a column on `meals` yet (PRD Open Question 4), so it is
 * set here as the extra property `MacroBearing` allows. Its macros are non-zero
 * and large on purpose: if the implementation ever counted it, every assertion
 * about Saturday would be out by an amount impossible to mistake for rounding.
 */
const FLEXIBLE_LUNCH: Meal & { isUntracked: true } = {
  ...meal("flexible-lunch", {
    slotType: "lunch",
    kcal: 9999,
    proteinG: 99.9,
    fatG: 99.9,
    carbG: 99.9,
  }),
  isUntracked: true,
};

const MEALS = [OATS, SALAD, CHILLI, CURRY, FLEXIBLE_LUNCH];

let nextEntryId = 0;

function entry(day: number, slot: MealSlot, mealId: string): PlanTemplateEntry {
  nextEntryId += 1;

  return { id: `entry-${nextEntryId}`, userId: USER, dayOfWeek: day, slot, mealId, sortOrder: 0 };
}

const TEMPLATE: PlanTemplateEntry[] = [
  ...WEEKDAYS.flatMap((day) => [
    entry(day, "breakfast", "oats"),
    entry(day, "lunch", "salad"),
    entry(day, "dinner", "chilli"),
  ]),
  entry(SATURDAY, "breakfast", "oats"),
  entry(SATURDAY, "lunch", "flexible-lunch"),
  entry(SATURDAY, "dinner", "curry"),
  // Sunday has no entries at all — case 4's "a date the template does not cover".
];

function override(date: string, slot: MealSlot, mealId: string): DayPlanOverride {
  return {
    id: `override-${date}-${slot}`,
    userId: USER,
    date,
    slot,
    mealId,
    createdAt: new Date("2026-03-01T12:00:00Z"),
  };
}

function plan(overrides: DayPlanOverride[] = [], fields: Partial<Plan> = {}): Plan {
  return {
    programStartDate: PROGRAM_START,
    template: TEMPLATE,
    overrides,
    meals: MEALS,
    ...fields,
  };
}

/**
 * Invented targets. Round numbers, so a delta is readable at a glance.
 *
 * Deliberately NOT the owner's real figures. This repository is public, and
 * Testing Strategy § 1.5 fails the pre-publish scan on any real kcal or macro
 * target found outside `docs/` — a test fixture is exactly the kind of place
 * those numbers get copied to and then forgotten. Nothing here needs them to be
 * real: the arithmetic is the same against any target.
 */
const TARGET: MacroTarget = {
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbG: 200,
};

/** The four figures alone, for asserting a total without its partial flag. */
const macrosOf = (totals: { kcal: number; proteinG: number; fatG: number; carbG: number }) => ({
  kcal: totals.kcal,
  proteinG: totals.proteinG,
  fatG: totals.fatG,
  carbG: totals.carbG,
});

/* -------------------------------------------------------------------------- */
/* The six cases                                                              */
/* -------------------------------------------------------------------------- */

describe("§ 1.3 case 1 — a full day with no overrides", () => {
  it("totals the template's meals", () => {
    // Monday: oats + salad + chilli. Every figure computed by hand from the
    // fixture rather than from the implementation.
    expect(dayTotals(plan(), MONDAY_DATE)).toEqual({
      kcal: 1600, // 420 + 480 + 700
      proteinG: 132.1, // 41.3 + 38.7 + 52.1
      fatG: 55.1, // 12.7 + 18.1 + 24.3
      carbG: 140.1, // 48.1 + 30.3 + 61.7
      partial: false,
      untrackedSlots: [],
    });
  });

  it("rounds the sum rather than letting the float through", () => {
    // 48.1 + 30.3 + 61.7 is 140.10000000000002 in IEEE 754, and Saturday's
    // 41.3 + 45.9 is 87.19999999999999 — drift in both directions, from
    // one-decimal figures a `numeric(6, 1)` column really does return. These
    // are the assertions that fail the day the rounding is removed as
    // redundant, and "140.10000000000002 g carbs" is what the user would see.
    expect(OATS.carbG + SALAD.carbG + CHILLI.carbG).not.toBe(140.1);
    expect(dayTotals(plan(), MONDAY_DATE).carbG).toBe(140.1);

    expect(OATS.proteinG + CURRY.proteinG).not.toBe(87.2);
    expect(dayTotals(plan(), SATURDAY_DATE).proteinG).toBe(87.2);
  });

  it("totals a bare list of meals the same way", () => {
    expect(totalMacros([OATS, SALAD, CHILLI])).toEqual(macrosOf(dayTotals(plan(), MONDAY_DATE)));
  });
});

describe("§ 1.3 case 2 — a day with one override", () => {
  // Monday's chilli swapped for curry: +60 kcal, −6.2g protein.
  const swapped = plan([override(MONDAY_DATE, "dinner", "curry")]);

  it("uses the override's macros, not the template's", () => {
    expect(dayTotals(swapped, MONDAY_DATE)).toEqual({
      kcal: 1660, // 420 + 480 + 760
      proteinG: 125.9, // 41.3 + 38.7 + 45.9
      fatG: 62, // 12.7 + 18.1 + 31.2
      carbG: 148.8, // 48.1 + 30.3 + 70.4
      partial: false,
      untrackedSlots: [],
    });
  });

  it("differs from the un-swapped day, so the swap is visibly what moved it", () => {
    // Without this the case above would pass against an implementation that
    // ignored overrides entirely, if the two meals happened to weigh the same.
    const before = dayTotals(plan(), MONDAY_DATE);
    const after = dayTotals(swapped, MONDAY_DATE);

    expect(after.kcal - before.kcal).toBe(60);
    expect(after.proteinG - before.proteinG).toBeCloseTo(-6.2, 10);
  });

  it("leaves next week's same weekday alone", () => {
    // P4's totals inherit P2's guarantee: an override is one date. If a swap
    // leaked into the template, this is where it would show up as a number.
    expect(dayTotals(swapped, "2026-03-16")).toEqual(dayTotals(plan(), MONDAY_DATE));
  });
});

describe("§ 1.3 case 3 — a day containing an untracked/flexible slot", () => {
  it("excludes it from the totals and flags the day partial", () => {
    // Saturday: oats + FLEXIBLE LUNCH + curry. The flexible lunch's 9999 kcal
    // must be nowhere in this answer.
    expect(dayTotals(plan(), SATURDAY_DATE)).toEqual({
      kcal: 1180, // 420 + 760
      proteinG: 87.2, // 41.3 + 45.9
      fatG: 43.9, // 12.7 + 31.2
      carbG: 118.5, // 48.1 + 70.4
      partial: true,
      untrackedSlots: ["lunch"],
    });
  });

  it("still resolves the slot — it is excluded from the sum, not from the day", () => {
    // The meal is planned and must keep rendering; only its macros are unknown.
    // A resolver that dropped it would silently turn "flexible" into "nothing".
    expect(resolveDay(plan(), SATURDAY_DATE).map((item) => item.meal.id)).toEqual([
      "oats",
      "flexible-lunch",
      "curry",
    ]);
  });

  it("does not flag a day whose meals are all tracked", () => {
    expect(dayTotals(plan(), MONDAY_DATE).partial).toBe(false);
    expect(dayTotals(plan(), MONDAY_DATE).untrackedSlots).toEqual([]);
  });

  it("names every untracked slot when there is more than one", () => {
    // A second untracked meal in the same day. The tooltip has to be able to
    // say both, in the order the day is eaten.
    expect(
      summariseDay([
        { slot: "breakfast", meal: OATS },
        { slot: "lunch", meal: FLEXIBLE_LUNCH },
        { slot: "dinner", meal: { ...CURRY, isUntracked: true } },
      ]),
    ).toEqual({
      kcal: 420,
      proteinG: 41.3,
      fatG: 12.7,
      carbG: 48.1,
      partial: true,
      untrackedSlots: ["lunch", "dinner"],
    });
  });
});

describe("§ 1.3 case 4 — an empty day", () => {
  it("returns zeroes for a date the template does not cover", () => {
    expect(dayTotals(plan(), SUNDAY_DATE)).toEqual({
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      partial: false,
      untrackedSlots: [],
    });
  });

  it("returns zeroes for a date before the program starts", () => {
    expect(macrosOf(dayTotals(plan(), BEFORE_START_DATE))).toEqual({
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
    });
  });

  it("never returns NaN", () => {
    // The failure this case exists for. NaN propagates through a delta and a
    // week average in silence, and surfaces as "NaN g" a long way from its cause.
    for (const date of [SUNDAY_DATE, BEFORE_START_DATE]) {
      for (const value of Object.values(macrosOf(dayTotals(plan(), date)))) {
        expect(Number.isNaN(value)).toBe(false);
      }
    }

    expect(totalMacros([])).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 });
  });

  it("does not flag an empty day partial", () => {
    // Nothing is unaccounted for on a day with nothing on it. Partial means
    // "some of this day's food has no macros", not "this day is incomplete".
    expect(dayTotals(plan(), SUNDAY_DATE).partial).toBe(false);
  });
});

describe("§ 1.3 case 5 — the delta against target", () => {
  it("is negative when the day falls short", () => {
    // Monday against the fixture targets: 1600 kcal against 2000, 132.1g
    // protein against 150. The convention is `−21`, not "21 under".
    expect(deltaFromTarget(dayTotals(plan(), MONDAY_DATE), TARGET)).toEqual({
      kcal: -400,
      proteinG: -17.9,
      fatG: -4.9,
      carbG: -59.9,
    });
  });

  it("is positive when the day goes over", () => {
    const modest: MacroTarget = {
      targetKcal: 1000,
      targetProteinG: 100,
      targetFatG: 40,
      targetCarbG: 100,
    };

    expect(deltaFromTarget(dayTotals(plan(), MONDAY_DATE), modest)).toEqual({
      kcal: 600,
      proteinG: 32.1,
      fatG: 15.1,
      carbG: 40.1,
    });
  });

  it("is zero — not minus zero — when the day lands exactly on target", () => {
    // `-0` is a real JS value and it formats as "−0", which reads as a shortfall
    // on the one day that hit its numbers precisely.
    const onTarget = deltaFromTarget(dayTotals(plan(), MONDAY_DATE), {
      targetKcal: 1600,
      targetProteinG: 132.1,
      targetFatG: 55.1,
      targetCarbG: 140.1,
    });

    expect(onTarget).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 });

    for (const value of Object.values(onTarget)) {
      expect(Object.is(value, -0)).toBe(false);
    }
  });

  it("is zero — not minus zero — when a shortfall rounds away to nothing", () => {
    // The case that actually produces `-0`. The test above cannot: `a − a` is
    // `+0` in IEEE 754, so it passes with or without the normalisation.
    //
    // A shortfall smaller than half a decimal place is what rounds to a
    // negative zero: Math.round(-0.4) is `-0`, and -0 / 10 stays `-0`. It
    // reaches this function the moment a candidate meal's macros are computed
    // rather than read from a `numeric(6, 1)` column — which is exactly what a
    // P4 swap preview does — and it renders as "−0", a shortfall on a day that
    // is not short.
    const barelyUnder = deltaFromTarget(
      { kcal: 0, proteinG: 0.16, fatG: 0, carbG: 0 },
      { targetKcal: 0, targetProteinG: 0.2, targetFatG: 0, targetCarbG: 0 },
    );

    expect(Object.is(barelyUnder.proteinG, -0)).toBe(false);
    expect(barelyUnder.proteinG).toBe(0);
  });

  it("measures the post-override day, not the template's", () => {
    // The delta is what P4 shows next to the swap. Reading it off the template
    // would tell the user the cost of a meal they are not eating.
    const swapped = plan([override(MONDAY_DATE, "dinner", "curry")]);

    expect(deltaFromTarget(dayTotals(swapped, MONDAY_DATE), TARGET).proteinG).toBe(-24.1);
  });
});

describe("§ 1.3 case 6 — a swap preview", () => {
  const candidate = { slot: "dinner" as MealSlot, meal: CURRY };

  it("totals the hypothetical day", () => {
    // Identical to case 2's confirmed swap, because it is the same question.
    expect(previewDayTotals(plan(), MONDAY_DATE, candidate)).toEqual(
      dayTotals(plan([override(MONDAY_DATE, "dinner", "curry")]), MONDAY_DATE),
    );
  });

  it("shows the cost of the swap before it is confirmed", () => {
    // The P4 acceptance criterion as a number: what this swap costs the day.
    const before = dayTotals(plan(), MONDAY_DATE);
    const after = previewDayTotals(plan(), MONDAY_DATE, candidate);

    expect(deltaFromTarget(after, TARGET).proteinG).toBe(-24.1);
    expect(after.proteinG - before.proteinG).toBeCloseTo(-6.2, 10);
  });

  it("persists nothing — the plan it was given is unchanged", () => {
    // "Without persisting" for a pure module means the caller's arrays are the
    // same arrays afterwards. There is no database in reach to check instead.
    const subject = plan();
    const before = structuredClone(subject);

    previewDayTotals(subject, MONDAY_DATE, candidate);

    expect(subject).toEqual(before);
    expect(subject.overrides).toHaveLength(0);
    // And the plan still answers as it did — the preview left no residue that
    // only shows up on the next read.
    expect(dayTotals(subject, MONDAY_DATE)).toEqual(dayTotals(plan(), MONDAY_DATE));
  });

  it("previews over an existing swap rather than being shadowed by it", () => {
    // Monday already swapped to curry; previewing chilli must answer with
    // chilli. An override appended after the existing row would lose to it.
    const alreadySwapped = plan([override(MONDAY_DATE, "dinner", "curry")]);

    expect(previewDayTotals(alreadySwapped, MONDAY_DATE, { slot: "dinner", meal: CHILLI })).toEqual(
      dayTotals(plan(), MONDAY_DATE),
    );
  });

  it("previews a meal that is not in the plan's library", () => {
    // The picker fetched it; `plan.meals` has never seen it. Hydration must
    // still find it, or the preview throws on the caller's happy path.
    const risotto = meal("risotto", { kcal: 640, proteinG: 28.4, fatG: 19.6, carbG: 82.5 });
    const library = plan([], { meals: [OATS, SALAD, CHILLI] });

    expect(previewDayTotals(library, MONDAY_DATE, { slot: "dinner", meal: risotto })).toEqual({
      kcal: 1540, // 420 + 480 + 640
      proteinG: 108.4,
      fatG: 50.4,
      carbG: 160.9,
      partial: false,
      untrackedSlots: [],
    });
  });

  it("previews as zeroes before the program starts", () => {
    // What confirming the swap would actually produce. A preview promising a
    // meal the app will not serve is worse than one that says nothing.
    expect(macrosOf(previewDayTotals(plan(), BEFORE_START_DATE, candidate))).toEqual({
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
    });
  });

  it("marks the synthetic row as a preview rather than a revertible swap", () => {
    expect(PREVIEW_ENTRY_ID).toBe("preview");
  });
});
