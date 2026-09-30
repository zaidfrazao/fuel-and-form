import type { SeedWorkout } from "./types";
import { seedWorkouts } from "./workouts";

/**
 * FUEL-130 — the kettlebell session as SQL literals, for `drizzle/0019`.
 *
 * A migration cannot import the seed, and an existing user's library was
 * loaded from the seed once and never again (the owner's by
 * `scripts/seed-local.ts`, which refuses to reload a library that has logs).
 * So 0019 carries the session's rows as literals, and these functions are
 * what renders them: `kettlebell-backfill.test.ts` asserts the migration
 * holds exactly this text, so an edit to the seed that the migration does not
 * carry fails there rather than leaving the owner's session and every new
 * demo's disagreeing about what Tuesday is. `shop-backfill.ts` is the same
 * arrangement for FUEL-137.
 */

/** The seed's swing session — the one workout 0019 writes. */
export function swingWorkout(workouts: readonly SeedWorkout[] = seedWorkouts): SeedWorkout {
  const workout = workouts.find((candidate) => candidate.key === "kettlebell-swings");

  if (!workout) throw new Error("The seed has no kettlebell-swings workout.");

  return workout;
}

/**
 * A SQL literal: `null`, a number, a boolean, or a quoted string with its
 * single quotes doubled. Never anything interpolated from outside this repo —
 * the inputs are the committed seed.
 */
function literal(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  return `'${value.replaceAll("'", "''")}'`;
}

/** The workout's own row: name, type and description, in that order. */
export function swingWorkoutValuesSql(workout: SeedWorkout = swingWorkout()): string {
  return `(${[workout.name, workout.type, workout.description].map(literal).join(", ")})`;
}

/**
 * One `VALUES` row per exercise, in session order, with `sort_order` as the
 * loader assigns it — the array index.
 *
 * Columns: sort_order, name, prescription, section, notes, target_sets,
 * target_reps_low, target_reps_high, target_seconds_low, target_seconds_high,
 * target_total_reps, takes_load. No media: the session ships none (see
 * `form-media.ts`), and a row naming a key would be a claim this migration
 * cannot check.
 */
export function swingExercisesValuesSql(workout: SeedWorkout = swingWorkout()): string {
  return workout.exercises
    .map((exercise, sortOrder) => {
      if (exercise.mediaKey != null) {
        throw new Error(`${exercise.name} names form media; 0019 writes none.`);
      }

      return `  (${[
        sortOrder,
        exercise.name,
        exercise.prescription,
        exercise.section ?? "work",
        exercise.notes,
        exercise.targetSets,
        exercise.targetRepsLow,
        exercise.targetRepsHigh,
        exercise.targetSecondsLow,
        exercise.targetSecondsHigh,
        exercise.targetTotalReps,
        exercise.takesLoad ?? false,
      ]
        .map(literal)
        .join(", ")})`;
    })
    .join(",\n");
}
