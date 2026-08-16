import { describe, expect, it } from "vitest";

import type { TrainingTemplateEntry, Workout } from "@/lib/db/schema";
import { type TrainingPlan, rotationWorkout } from "@/lib/rotation";

import { seedMeals } from "./meals";
import { BODYWEIGHT_CIRCUIT } from "./types";
import { seedWorkouts } from "./workouts";

/**
 * The seed libraries are data, not logic, so these are not behaviour tests —
 * they pin the claims FUEL-14's acceptance criteria make about the data, which
 * is the part a later edit can quietly break.
 *
 * The one that earns its keep is the rotation suite: AC3 says "rotation_group
 * set so A/B alternation resolves", and that is a claim about this data meeting
 * rotation.ts halfway. A typo in `rotationIndex`, or both circuits landing on
 * index 0, would schedule Circuit A forever with no error anywhere — the exact
 * silent failure the module comment in rotation.ts warns about.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A Monday, which is where the program's Mon/Wed/Fri week starts. */
const PROGRAM_START = "2026-08-10";

const USER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Materialise the seed workouts into library rows, standing in for what the
 * loader will do at insert time. Ids are derived from the key so they are
 * stable within a test run without pretending to be real uuids.
 */
const library: Workout[] = seedWorkouts.map((workout, index) => ({
  id: `w${String(index).padStart(2, "0")}`,
  userId: USER_ID,
  name: workout.name,
  type: workout.type,
  description: workout.description ?? null,
  rotationGroup: workout.rotationGroup ?? null,
  rotationIndex: workout.rotationIndex ?? null,
}));

/** Mon, Wed and Fri name the group rather than a workout — the rotated days. */
const template: TrainingTemplateEntry[] = [1, 3, 5].map((dayOfWeek, index) => ({
  id: `t${String(index).padStart(2, "0")}`,
  userId: USER_ID,
  dayOfWeek,
  workoutId: null,
  rotationGroup: BODYWEIGHT_CIRCUIT,
  sortOrder: 0,
}));

const plan: TrainingPlan = {
  programStartDate: PROGRAM_START,
  template,
  workouts: library,
};

const circuitOn = (date: string) =>
  rotationWorkout(plan, BODYWEIGHT_CIRCUIT, date)?.name ?? null;

/* -------------------------------------------------------------------------- */
/* AC3 — rotation                                                             */
/* -------------------------------------------------------------------------- */

describe("A/B alternation", () => {
  // Doc 17: "Circuits alternate A/B/A one week, then B/A/B the next, so over a
  // fortnight each gets equal time." This is that sentence, executable.
  it("runs A/B/A in week one and B/A/B in week two", () => {
    const weekOne = ["2026-08-10", "2026-08-12", "2026-08-14"].map(circuitOn);
    const weekTwo = ["2026-08-17", "2026-08-19", "2026-08-21"].map(circuitOn);

    expect(weekOne).toEqual([
      "Bodyweight Circuit A",
      "Bodyweight Circuit B",
      "Bodyweight Circuit A",
    ]);
    expect(weekTwo).toEqual([
      "Bodyweight Circuit B",
      "Bodyweight Circuit A",
      "Bodyweight Circuit B",
    ]);
  });

  it("puts Circuit A on the program start date itself", () => {
    expect(circuitOn(PROGRAM_START)).toBe("Bodyweight Circuit A");
  });

  it("gives each circuit equal time across the fortnight", () => {
    const dates = [
      "2026-08-10", "2026-08-12", "2026-08-14",
      "2026-08-17", "2026-08-19", "2026-08-21",
    ];
    const names = dates.map(circuitOn);

    expect(names.filter((n) => n === "Bodyweight Circuit A")).toHaveLength(3);
    expect(names.filter((n) => n === "Bodyweight Circuit B")).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* AC2 — the library covers the program                                       */
/* -------------------------------------------------------------------------- */

describe("workout library", () => {
  it("holds both circuits, the interval session and the walk", () => {
    expect(seedWorkouts.map((w) => w.key)).toEqual([
      "bodyweight-circuit-a",
      "bodyweight-circuit-b",
      "skipping-intervals-core",
      "daily-walk",
    ]);
  });

  it("pairs rotation group and index, or omits both", () => {
    // The schema's `workouts_rotation_pair` check enforces this in Postgres.
    // Asserting it here means a bad row fails in the unit suite rather than at
    // insert time, when the failure is a constraint violation in a seed script.
    for (const workout of seedWorkouts) {
      expect(workout.rotationGroup === null).toBe(workout.rotationIndex === null);
    }
  });

  it("gives the two circuits distinct indices in one group", () => {
    const circuits = seedWorkouts.filter((w) => w.rotationGroup === BODYWEIGHT_CIRCUIT);

    expect(circuits).toHaveLength(2);
    expect(circuits.map((w) => w.rotationIndex).sort()).toEqual([0, 1]);
  });

  it("gives every workout a unique name", () => {
    // Same argument as the meal names above — `loadSeedLibraries` matches these
    // positionally too, and guards it the same way.
    const names = seedWorkouts.map((w) => w.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every exercise a prescription", () => {
    for (const workout of seedWorkouts) {
      for (const exercise of workout.exercises) {
        expect(exercise.prescription.trim()).not.toBe("");
      }
    }
  });

  it("models the walk as a session with no exercise list", () => {
    // AC4's structural claim, in its workout form: a parent row is valid with no
    // children. The walk is the case that proves it — one activity, logged with
    // a single tap, with nothing to step through.
    const walk = seedWorkouts.find((w) => w.key === "daily-walk");

    expect(walk?.exercises).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* AC1 — the rotation's ten meals                                             */
/* -------------------------------------------------------------------------- */

/** The weekday rotation, as distinct from the treat entries seeded alongside. */
const ROTATION_KEYS = [
  "oats-cinnamon-apple",
  "oats-pb-cocoa",
  "oats-vanilla-berry",
  "red-pepper-provolone-ciabatta",
  "greek-yogurt-berries",
  "whey-shake-banana",
  "beef-mince-chilli",
  "smoky-paprika-chicken-rice",
  "lemon-garlic-baked-fish",
  "black-coffee-mct",
];

describe("meal library", () => {
  it("holds all ten meals of the weekday rotation", () => {
    const keys = new Set(seedMeals.map((m) => m.key));

    for (const key of ROTATION_KEYS) expect(keys).toContain(key);
    expect(ROTATION_KEYS).toHaveLength(10);
  });

  it("gives every meal a unique key", () => {
    const keys = seedMeals.map((m) => m.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every meal a unique name", () => {
    // Not cosmetic. `loadSeedLibraries` maps a seed key to its generated uuid by
    // zipping this array against the rows `RETURNING` hands back, and guards
    // that positional match by comparing names pair by pair. Two meals sharing
    // a name would let a mis-ordered result satisfy the guard — which is the
    // one failure mode the guard exists for, and it is silent: ingredients
    // attached to the wrong recipe, and a template scheduling the wrong dinner,
    // with no error and nothing in the data that looks wrong.
    const names = seedMeals.map((m) => m.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every meal a full set of macros", () => {
    // All four columns are NOT NULL, so a meal missing one cannot be inserted at
    // all. Catching it here beats catching it in a half-finished seed run.
    for (const meal of seedMeals) {
      expect(Number.isFinite(meal.kcal)).toBe(true);
      expect(Number.isFinite(meal.proteinG)).toBe(true);
      expect(Number.isFinite(meal.fatG)).toBe(true);
      expect(Number.isFinite(meal.carbG)).toBe(true);
    }
  });

  it("gives every meal a method", () => {
    for (const meal of seedMeals) {
      expect(meal.method?.trim()).toBeTruthy();
    }
  });

  it("gives every rotation meal at least one ingredient", () => {
    // Scoped to the rotation deliberately. AC1 requires ingredients for these
    // ten; the type contract in types.ts explicitly permits `ingredients: []`
    // so a meal can be seeded with macros alone, which is what lets P1–P6 ship
    // before P8 has any data. Asserting non-empty across ALL meals would
    // contradict that promise and fail the first macro-only meal someone adds.
    const byKey = new Map(seedMeals.map((m) => [m.key, m]));

    for (const key of ROTATION_KEYS) {
      expect(byKey.get(key)!.ingredients.length).toBeGreaterThan(0);
    }
  });

  it("supplies grams or a non-scale measure for every ingredient", () => {
    // The owner has no kitchen scale, so an ingredient with neither is unusable.
    // Both null is the real failure mode; grams alone is merely inconvenient.
    for (const meal of seedMeals) {
      for (const ingredient of meal.ingredients) {
        expect(
          ingredient.grams !== null || Boolean(ingredient.nonScaleMeasure),
        ).toBe(true);
      }
    }
  });

  it("flags every meal whose macros were estimated rather than supplied", () => {
    // The five rotation meals that arrived without usable macros, plus all seven
    // treats. If a later edit replaces an estimate with a measured figure, this
    // list is what has to shrink with it.
    const estimated = seedMeals
      .filter((m) => m.notes?.includes("ESTIMATED"))
      .map((m) => m.key)
      .sort();

    expect(estimated).toEqual(
      [
        "butter-chicken-naan",
        "french-toast-bacon",
        "fried-eggs-lamb-bangers",
        "greek-yogurt-berries",
        "korean-fried-chicken",
        "loaded-nachos",
        "oats-cinnamon-apple",
        "oats-pb-cocoa",
        "oats-vanilla-berry",
        "smash-burger",
        "steak-chips-peppercorn",
        "whey-shake-banana",
      ].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Data integrity — macros against their own kcal                             */
/* -------------------------------------------------------------------------- */

describe("macro arithmetic", () => {
  /** 4 kcal per gram of protein and carb, 9 per gram of fat. */
  const fromMacros = (m: { proteinG: number; fatG: number; carbG: number }) =>
    m.proteinG * 4 + m.fatG * 9 + m.carbG * 4;

  /**
   * The supplied recipes are hand-estimated rather than lab-measured, so exact
   * agreement is not the bar — 8% absorbs honest rounding across a dozen
   * ingredients.
   *
   * The ciabatta is the one meal that misses it, by 12.6%: 540 kcal stated
   * against 472 from its own macros. It is listed rather than excluded so the
   * discrepancy stays visible and this test starts passing cleanly the moment
   * the recipe is corrected.
   */
  const TOLERANCE = 0.08;
  const KNOWN_DISCREPANCIES = new Set(["red-pepper-provolone-ciabatta"]);

  it("reconciles each meal's macros with its stated kcal", () => {
    const failures = seedMeals
      .filter((m) => !KNOWN_DISCREPANCIES.has(m.key))
      .filter((m) => Math.abs(m.kcal - fromMacros(m)) / m.kcal > TOLERANCE)
      .map((m) => `${m.key}: ${m.kcal} stated, ${fromMacros(m).toFixed(0)} from macros`);

    expect(failures).toEqual([]);
  });

  it("still shows the ciabatta as out of tolerance", () => {
    const ciabatta = seedMeals.find((m) => m.key === "red-pepper-provolone-ciabatta")!;

    // Guards the exemption above: when the recipe is fixed this test fails,
    // which is the prompt to delete both it and the KNOWN_DISCREPANCIES entry.
    expect(Math.abs(ciabatta.kcal - fromMacros(ciabatta)) / ciabatta.kcal).toBeGreaterThan(
      TOLERANCE,
    );
  });
});
