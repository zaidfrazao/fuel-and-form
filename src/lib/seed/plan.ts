import type { DayOfWeek } from "@/lib/date";

import { BODYWEIGHT_CIRCUIT, type SeedKey, type SeedPlanEntry, type SeedTrainingEntry } from "./types";

/**
 * The recurring week — which recipe lands on which weekday, and which session.
 *
 * This is the `plan_template_entries` / `training_template_entries` half of the
 * seed: plan *shape*, not personal data, and therefore committed. See the note
 * on `SeedPlanEntry` in types.ts for where PRD § P7 draws that line.
 *
 * ## Provenance — what is pinned, and what was chosen
 *
 * The source plan documents that specify the week are not in this repository;
 * FUEL-14 transcribed the recipes from them and recorded the scheduling facts in
 * comments as it went. Everything below is either recovered from those comments
 * or derived, and each is marked:
 *
 * - **Breakfast** is pinned. meals.ts:64-70 — "the plan template names a specific
 *   flavour per weekday (Mon and Thu are Cinnamon Apple, Tue and Fri are PB
 *   Cocoa)". Wednesday is the one remaining flavour. meals.ts:442 gives the
 *   weekend: the lamb bangers are "the standing Saturday and Sunday breakfast".
 * - **Tuesday dinner** is pinned. PRD § Problem Statement: "The plan says Tuesday
 *   is Chicken & Rice", and P2's worked example — "ran out of chicken → Tuesday
 *   becomes Chilli" — says the same thing from the other side.
 * - **Training** is pinned. workouts.ts:71 heads the circuits "Mon / Wed / Fri",
 *   :162 heads the skipping session "Tue / Thu", and :221 the walk "every day,
 *   including weekends".
 * - **The other four dinners are a reconstruction.** See the block on
 *   `WEEKDAY_DINNER` below for what corroborates it and how to correct it.
 *
 * ## The weekend is deliberately half-empty
 *
 * Saturday and Sunday carry breakfast and the morning coffee, and nothing else.
 * That is not an omission: meals.ts:422-431 describes the treat recipes as
 * filling "the weekend Flex slots and cheat days", and a flex slot whose content
 * is decided on the day is precisely what `day_plan_overrides` is for (P2). A
 * treat is a one-off, so it belongs in an override, not in the recurring
 * template — templating a fixed Saturday steak would assert a routine the source
 * plan does not have.
 *
 * The visible consequence is that P1's "Right Now" has no lunch or dinner to
 * show at the weekend until one is chosen. If that reads as a gap rather than as
 * flexibility, adding the treats to `WEEKEND_MEALS` is a two-line change.
 */

/* -------------------------------------------------------------------------- */
/* Meals                                                                      */
/* -------------------------------------------------------------------------- */

/** Monday through Friday — the days the rotation actually covers. */
const WEEKDAYS = [1, 2, 3, 4, 5] as const satisfies readonly DayOfWeek[];

/** Saturday and Sunday. `0` is Sunday, matching `Date.prototype.getDay()`. */
const WEEKEND = [6, 0] as const satisfies readonly DayOfWeek[];

/** Pinned by meals.ts:64-70; Wednesday is the flavour those two lines leave over. */
const WEEKDAY_BREAKFAST = {
  1: "oats-cinnamon-apple",
  2: "oats-pb-cocoa",
  3: "oats-vanilla-berry",
  4: "oats-cinnamon-apple",
  5: "oats-pb-cocoa",
} as const satisfies Record<(typeof WEEKDAYS)[number], SeedKey>;

/**
 * The three dinners across five weekdays. Tuesday is pinned; the rest is a
 * reconstruction, and this comment is the record of that.
 *
 * Two independent checks corroborate it. FUEL-14's closing note, written before
 * this file existed and from the source documents rather than from it, states
 * that "the weekday template sums to 46–56g" of fat. This assignment sums to
 * 46.5–56.0g — the same range, to the gram at both ends. And the persona's
 * targets were chosen in FUEL-14 to sit "within ~3% of what the seeded meal
 * library actually delivers": every weekday here lands within 3.4% on kcal and
 * protein. `plan.test.ts` asserts both, so a wrong edit fails the suite.
 *
 * That is corroboration, not proof — other assignments could produce the same
 * range. If the source plan says otherwise, correct the four unpinned days here
 * and nothing else needs to change.
 */
const WEEKDAY_DINNER = {
  1: "beef-mince-chilli",
  2: "smoky-paprika-chicken-rice",
  3: "lemon-garlic-baked-fish",
  4: "smoky-paprika-chicken-rice",
  5: "beef-mince-chilli",
} as const satisfies Record<(typeof WEEKDAYS)[number], SeedKey>;

/**
 * The slots that do not vary by weekday.
 *
 * One lunch recipe exists, and both snacks are eaten every weekday — that is
 * what makes the day total land on the persona's protein target. Dropping either
 * snack costs 18-30g of protein against a 148g goal, so they are not optional
 * extras but load-bearing parts of the day.
 */
const WEEKDAY_MEALS: readonly { slot: SeedPlanEntry["slot"]; mealKey: SeedKey }[] = [
  { slot: "lunch", mealKey: "red-pepper-provolone-ciabatta" },
  { slot: "snack", mealKey: "greek-yogurt-berries" },
  { slot: "snack", mealKey: "whey-shake-banana" },
  { slot: "extra", mealKey: "black-coffee-mct" },
];

/** The weekend's two fixed points. Lunch and dinner stay flex — see above. */
const WEEKEND_MEALS: readonly { slot: SeedPlanEntry["slot"]; mealKey: SeedKey }[] = [
  { slot: "breakfast", mealKey: "fried-eggs-lamb-bangers" },
  { slot: "extra", mealKey: "black-coffee-mct" },
];

/**
 * Numbers the entries a single (day, slot) holds, so the two snacks have a
 * defined order rather than whichever Postgres returns first.
 */
const withSortOrder = (entries: readonly SeedPlanEntry[]): SeedPlanEntry[] => {
  const seen = new Map<string, number>();

  return entries.map((entry) => {
    const slotKey = `${entry.dayOfWeek}:${entry.slot}`;
    const sortOrder = seen.get(slotKey) ?? 0;

    seen.set(slotKey, sortOrder + 1);

    return { ...entry, sortOrder };
  });
};

/**
 * The recurring weekly meal plan.
 *
 * Assembled from the tables above rather than written out as 26 literals: the
 * repeated slots are repeated *because* they are the same every day, and a
 * hand-written list would let one of the five ciabattas drift from the others
 * with nothing to catch it.
 */
export const seedPlanTemplate: readonly SeedPlanEntry[] = withSortOrder([
  ...WEEKDAYS.flatMap((dayOfWeek): SeedPlanEntry[] => [
    { dayOfWeek, slot: "breakfast", mealKey: WEEKDAY_BREAKFAST[dayOfWeek] },
    ...WEEKDAY_MEALS.map(({ slot, mealKey }) => ({ dayOfWeek, slot, mealKey })),
    { dayOfWeek, slot: "dinner", mealKey: WEEKDAY_DINNER[dayOfWeek] },
  ]),
  ...WEEKEND.flatMap((dayOfWeek): SeedPlanEntry[] =>
    WEEKEND_MEALS.map(({ slot, mealKey }) => ({ dayOfWeek, slot, mealKey })),
  ),
]);

/* -------------------------------------------------------------------------- */
/* Training                                                                   */
/* -------------------------------------------------------------------------- */

/** Mon / Wed / Fri — workouts.ts:71. */
const CIRCUIT_DAYS = [1, 3, 5] as const satisfies readonly DayOfWeek[];

/** Tue / Thu — workouts.ts:162. */
const CARDIO_DAYS = [2, 4] as const satisfies readonly DayOfWeek[];

/** Every day, weekends included — workouts.ts:221. */
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly DayOfWeek[];

/**
 * The recurring training week.
 *
 * The circuit days name the rotation GROUP, not a workout: which of Circuit A
 * and B falls on a given Monday is computed from `profiles.program_start_date`
 * by `rotationWorkout()`, so the alternation carries across weeks and a skipped
 * session does not shift what comes next. Naming a workout here instead would
 * pin Monday to Circuit A forever — the silent failure rotation.ts warns about.
 *
 * The walk sorts after the session on days that have one: it is the day's second
 * activity, not its headline, and P3 renders them in this order.
 */
export const seedTrainingTemplate: readonly SeedTrainingEntry[] = [
  ...CIRCUIT_DAYS.map((dayOfWeek) => ({
    dayOfWeek,
    rotationGroup: BODYWEIGHT_CIRCUIT,
    sortOrder: 0,
  })),
  ...CARDIO_DAYS.map((dayOfWeek) => ({
    dayOfWeek,
    workoutKey: "skipping-intervals-core",
    sortOrder: 0,
  })),
  ...ALL_DAYS.map((dayOfWeek) => ({
    dayOfWeek,
    workoutKey: "daily-walk",
    sortOrder: 1,
  })),
];
