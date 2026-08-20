import type { CalendarDate } from "./date";
import type { Workout, WorkoutExercise } from "./db/schema";
import {
  type ResolvedWorkout,
  resolveTraining,
  type TrainingPlan,
  type TrainingSource,
} from "./rotation";

/**
 * A date's training, in the shape P3 renders it — FUEL-26, PRD § P3.
 *
 * `rotation.ts` answers which WORKOUT a date lands on. That is the hard half and
 * it is finished, but it is not what a training screen draws: the screen needs
 * the day's sessions in the order the template puts them, each with the exercise
 * list and prescriptions beneath it, and it needs to tell the daily walk from
 * the session it sits under. This file is that shaping, and nothing else.
 *
 * ## Why it wraps `rotation.ts` rather than widening it
 *
 * The obvious alternative is to hang `exercises` off `ResolvedWorkout` and
 * delete this file. It would put `workout_exercises` — a table rotation.ts does
 * not read and has no reason to — inside the one module gated at 100% for
 * reading no tables at all. The gate on rotation.ts is there to make a shortcut
 * that consults history impossible to add unnoticed; every field added to its
 * return type is a reason to touch it again, and the module comment there spells
 * out that its `TrainingPlan` has three fields precisely so a caller "cannot
 * pass session history in even by mistake".
 *
 * So the join happens one layer out. `db/queries/today.ts` already implies this
 * arrangement — it builds a `workouts.id` → exercises map for exactly this
 * reason and says so — and the map it builds is the second argument below,
 * unchanged. A caller that already has a `Today` passes `today.exercises`
 * straight in.
 *
 * ## Weekends need no branch here either
 *
 * "Weekends show walk-only" is a criterion about the TEMPLATE, not about this
 * function: the seeded week (src/lib/seed/plan.ts) puts the circuit on Mon / Wed
 * / Fri, the intervals on Tue / Thu, and the walk on all seven days, so a
 * Saturday resolves to a walk and nothing else without anything here knowing
 * which days are weekends. `resolve-now.ts` makes the same argument for the same
 * reason. A `dayOfWeek(date) === 0 || === 6` test would be a second, weaker copy
 * of the template — one that would keep insisting on a rest day for someone who
 * later trains on a Saturday.
 *
 * ## `kind` is derived, and only two values wide
 *
 * The walk is a different KIND of thing from a session: PRD § P3 makes it "a
 * separate, always-present item logged with a single tap", against a session
 * that carries a status, a note and a duration. That distinction has to be
 * derivable here, because the screen renders the two differently and the walk is
 * what a weekend has instead of a session.
 *
 * It is read off `workouts.type`, which schema.ts is explicit about: the column
 * is "a rendering discriminator, not a contract", deliberately text rather than
 * an enum so the gym restart adds rows and not a migration, and "the UI must
 * handle a value it does not recognise". So the test is for the one value that
 * changes the rendering, and everything else — 'circuit', 'intervals', a
 * 'strength' that does not exist yet — is a session. A three-way union would put
 * this file in the way of that promise: adding a type would mean editing a
 * resolver, its tests and its coverage gate before the row could be seen at all.
 *
 * ## Pure, like everything it reads
 *
 * No database access, no `user_id`, no `server-only`, and only TYPE imports from
 * the schema — the contract `resolve-plan.ts` and `rotation.ts` both keep, and
 * the reason P3's screen can import this without pulling Drizzle's pg-core into
 * the browser bundle. The caller has already been through `scope()`, so every
 * row here belongs to one user.
 */

/** Whether the day's item is the daily walk or a training session. */
export type SessionKind = "session" | "walk";

/**
 * The `workouts.type` that is not a session.
 *
 * Exported because the walk is a thing other layers have to name — FUEL-29 logs
 * it with one tap — and a second spelling of the string is a second thing to get
 * wrong. It is a value, not a type: see the module comment on why the column
 * stays open.
 */
export const WALK_TYPE = "walk";

/** One of a date's sessions: what it is, what put it there, and its exercises. */
export type TrainingSession = {
  workout: Workout;
  /** 'fixed' or 'rotation' — straight from `resolveTraining`. */
  source: TrainingSource;
  /**
   * The `training_template_entries` row that produced it, never the workout —
   * for the reason `ResolvedWorkout` gives: a rotated day's workout changes with
   * the date, and the entry is the stable thing to name.
   */
  entryId: string;
  kind: SessionKind;
  /**
   * The workout's exercises, in `sort_order`.
   *
   * Empty is ordinary rather than missing data. The daily walk has no exercise
   * rows at all — src/lib/seed/workouts.ts calls an empty array "the honest
   * model, not a missing one" — and `right-now.tsx` already renders that case as
   * "No exercises listed." rather than a gap.
   */
  exercises: readonly WorkoutExercise[];
};

/** A date and everything the template trains on it. Mirrors `ResolvedDay`. */
export type TrainingDay = {
  date: CalendarDate;
  sessions: TrainingSession[];
};

/**
 * Attaches the exercises and the rendering kind to one resolved workout.
 *
 * The lookup misses in exactly one ordinary case — a workout with no exercise
 * rows, which is what the walk is — and in one bug: a caller that passed a map
 * built from a narrower query than the template needs. Both come back as an
 * empty list rather than a throw, because the two are indistinguishable from
 * here and the first is the common one. That is the opposite of the call
 * `resolveTraining` makes on a missing WORKOUT, and deliberately so: a workout
 * the template names is guaranteed by a foreign key, so its absence is a bug and
 * nothing else, while `workout_exercises` has no row a workout is required to
 * have.
 */
function withExercises(
  resolved: ResolvedWorkout,
  exercises: ReadonlyMap<string, readonly WorkoutExercise[]>,
): TrainingSession {
  return {
    workout: resolved.workout,
    source: resolved.source,
    entryId: resolved.entryId,
    kind: resolved.workout.type === WALK_TYPE ? "walk" : "session",
    exercises: exercises.get(resolved.workout.id) ?? [],
  };
}

/**
 * What is trained on `date` — today's session, the walk, or on a weekend just
 * the walk.
 *
 * Order is `resolveTraining`'s and therefore the template's: `sort_order`, ties
 * broken by id. The seed relies on it — the walk is given `sortOrder: 1` on days
 * that have a session, because "it is the day's second activity, not its
 * headline" — so re-sorting here by `kind`, to float the walk or sink it, would
 * quietly overrule the one place that ordering is configured.
 *
 * A date before `program_start_date` resolves to no sessions, and a date the
 * template does not cover resolves to no sessions; both are `resolveTraining`'s
 * answers, unchanged. Neither is an error, and the day still comes back — the
 * screen needs a date to head an empty state with.
 *
 * @param exercises `workouts.id` → its exercises in `sort_order`. `Today`
 *   exposes exactly this map, so a caller with one passes it straight through.
 */
export function trainingDay(
  plan: TrainingPlan,
  exercises: ReadonlyMap<string, readonly WorkoutExercise[]>,
  date: CalendarDate,
): TrainingDay {
  return {
    date,
    sessions: resolveTraining(plan, date).map((resolved) =>
      withExercises(resolved, exercises),
    ),
  };
}
