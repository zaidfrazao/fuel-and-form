import type { Scope } from "@/lib/db/scope";
import * as schema from "@/lib/db/schema";

import { seedMeals } from "./meals";
import { seedPlanTemplate, seedTrainingTemplate } from "./plan";
import type { SeedKey } from "./types";
import { seedWorkouts } from "./workouts";

/**
 * Writes the committed seed libraries and the weekly template into one user.
 *
 * The whole of this file is deliberately user-agnostic: it takes a `Scope` and
 * never learns whose it is. That is what lets the owner's gitignored script
 * (FUEL-15) and the demo provisioner (FUEL-40, src/lib/db/queries/demo.ts)
 * load the same library into
 * different users without a second copy of this logic — the arrangement
 * types.ts:24-31 describes, now with something on the other end of it.
 *
 * Because it takes a `Scope` rather than a handle, it also inherits the
 * ownership guarantee rather than restating it: every insert below goes through
 * `scope.insert`, which stamps `user_id` and refuses to let a caller name one.
 * There is no path through this file that writes an unscoped row.
 *
 * ## Pass it a transaction
 *
 * A half-loaded library is a broken one — template entries pointing at meals
 * that exist, and slots pointing at meals that do not. Every caller should build
 * its scope on a transaction handle:
 *
 *     await getPool().transaction(async (tx) => {
 *       await loadSeedLibraries(scope(userId, tx));
 *     });
 *
 * This function does not open one itself, precisely so the caller can put the
 * user row's creation inside the same commit.
 */

/** What a caller needs to reach the rows it just wrote. */
export type LoadedSeed = {
  /** Seed key → the generated `meals.id`. */
  meals: ReadonlyMap<SeedKey, string>;
  /** Seed key → the generated `workouts.id`. */
  workouts: ReadonlyMap<SeedKey, string>;
  /**
   * Rows written, per table, for a caller that wants to report what it did.
   *
   * Keyed by the table's SQL name rather than typed as `Record<string, number>`:
   * the loose form makes every lookup `number | undefined` under
   * `noUncheckedIndexedAccess`, which pushes a non-null assertion onto every
   * caller for a set of keys that is fixed and known here.
   */
  counts: Readonly<{
    meals: number;
    meal_ingredients: number;
    workouts: number;
    workout_exercises: number;
    plan_template_entries: number;
    training_template_entries: number;
  }>;
};

/**
 * Pairs the rows an insert returned back to the seed entries that produced them.
 *
 * Postgres returns `RETURNING` rows in the order of the `VALUES` list for a
 * plain multi-row insert, which is what makes a positional zip correct — and
 * that is a documented property of the statement, not an incidental one.
 *
 * It is still verified rather than assumed. The names are checked pair by pair,
 * so if the ordering were ever to differ the failure is this message, naming the
 * table, rather than a library silently wired to the wrong uuids — meals whose
 * ingredients belong to a different recipe and a template that schedules the
 * wrong dinner, with no error anywhere and nothing in the data that looks wrong.
 * The check costs one string comparison per row.
 */
function mapKeysToIds<T extends { key: SeedKey; name: string }>(
  seeds: readonly T[],
  rows: readonly { id: string; name: string }[],
  table: string,
): Map<SeedKey, string> {
  if (rows.length !== seeds.length) {
    throw new Error(
      `Seeding ${table}: inserted ${seeds.length} rows but ${rows.length} came back.`,
    );
  }

  return new Map(
    seeds.map((seed, index) => {
      const row = rows[index];

      if (!row || row.name !== seed.name) {
        throw new Error(
          `Seeding ${table}: row ${index} came back as "${row?.name ?? "nothing"}" ` +
            `but should be "${seed.name}". The insert returned its rows out of ` +
            `order, so keys cannot be matched to ids positionally.`,
        );
      }

      return [seed.key, row.id] as const;
    }),
  );
}

/** Looks up a generated id, failing by name rather than inserting a null. */
function idFor(map: ReadonlyMap<SeedKey, string>, key: SeedKey, what: string): string {
  const id = map.get(key);

  if (!id) {
    throw new Error(
      `The ${what} template names "${key}", which is not in the seed library. ` +
        `Check the key against src/lib/seed/${what === "training" ? "workouts" : "meals"}.ts.`,
    );
  }

  return id;
}

/**
 * Loads meals, workouts, their children, and the weekly template.
 *
 * Ordering is dictated by the composite foreign keys in schema.ts: a child row
 * names `(parent_id, user_id)` and the pair must already exist, so parents go
 * first and their generated ids come back before anything can reference them.
 */
export async function loadSeedLibraries(s: Scope): Promise<LoadedSeed> {
  /* ---- Meals, then their ingredients ---------------------------------- */

  const mealRows = await s.insert(
    schema.meals,
    // `key` and `ingredients` exist only in the seed file — the first is the
    // slug this loader resolves to a uuid, the second a separate table. What is
    // left is exactly the column set, so a field added to `SeedMeal` reaches the
    // insert without an edit here.
    seedMeals.map(({ key, ingredients, ...meal }) => meal),
  );

  const meals = mapKeysToIds(seedMeals, mealRows, "meals");

  // `sortOrder` is the position within its own meal, so the index resets per
  // recipe — it orders one shopping list, not all seventeen at once.
  const ingredients = seedMeals.flatMap((meal) =>
    meal.ingredients.map((ingredient, sortOrder) => ({
      ...ingredient,
      mealId: idFor(meals, meal.key, "meal"),
      sortOrder,
    })),
  );

  if (ingredients.length > 0) await s.insert(schema.mealIngredients, ingredients);

  /* ---- Workouts, then their exercises --------------------------------- */

  const workoutRows = await s.insert(
    schema.workouts,
    seedWorkouts.map(({ key, exercises, ...workout }) => workout),
  );

  const workouts = mapKeysToIds(seedWorkouts, workoutRows, "workouts");

  const exercises = seedWorkouts.flatMap((workout) =>
    workout.exercises.map((exercise, sortOrder) => ({
      ...exercise,
      workoutId: idFor(workouts, workout.key, "workout"),
      sortOrder,
    })),
  );

  if (exercises.length > 0) await s.insert(schema.workoutExercises, exercises);

  /* ---- The weekly template -------------------------------------------- */

  await s.insert(
    schema.planTemplateEntries,
    seedPlanTemplate.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      slot: entry.slot,
      mealId: idFor(meals, entry.mealKey, "meal"),
      sortOrder: entry.sortOrder ?? 0,
    })),
  );

  await s.insert(
    schema.trainingTemplateEntries,
    seedTrainingTemplate.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      // Exactly one of these is set — the union in types.ts makes the other a
      // compile error — which is what the schema's check constraint wants.
      workoutId: entry.workoutKey ? idFor(workouts, entry.workoutKey, "training") : null,
      rotationGroup: entry.rotationGroup ?? null,
      sortOrder: entry.sortOrder ?? 0,
    })),
  );

  return {
    meals,
    workouts,
    counts: {
      meals: mealRows.length,
      meal_ingredients: ingredients.length,
      workouts: workoutRows.length,
      workout_exercises: exercises.length,
      plan_template_entries: seedPlanTemplate.length,
      training_template_entries: seedTrainingTemplate.length,
    },
  };
}
