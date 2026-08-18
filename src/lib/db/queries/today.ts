import "server-only";

import { asc, eq } from "drizzle-orm";

import { todayIn } from "@/lib/date";
import { type Cursor, type NowView, resolveNow, scheduleFor } from "@/lib/resolve-now";
import { getDb } from "../index";
import * as schema from "../schema";
import type { Profile, WorkoutExercise } from "../schema";
import { scope } from "../scope";

/**
 * Today, fetched — the one impure step between Postgres and `resolveNow`.
 *
 * `resolve-now.ts`, `resolve-plan.ts` and `rotation.ts` are pure by design and
 * take their data as arguments. Something has to go and get it, and this is
 * that something: the whole of P1's database access, in one file, so the screen
 * itself never touches a connection and stays renderable from a test with a
 * hand-built fixture.
 *
 * ## Why it lives in `lib/db/queries/`
 *
 * `getDb()` hands back an unscoped handle, and the eslint rule in
 * eslint.config.mjs makes reaching for one outside `src/lib/db/` an error — the
 * machine-checked half of the PRD's promise that no query path bypasses the
 * scope. This is the first request-path read in the app, so it is the first
 * file that has to bind a scope to a handle, and the only directory allowed to
 * do that is this one.
 *
 * `queries/` is the category the rule then lets the app import: a module here
 * runs scoped statements and returns ROWS. Never a handle, never a builder,
 * never a `Scope` — the same line `scope()` itself draws, one level up. That is
 * what makes importing one safe from `app/`, and it is why the allowance is a
 * directory rather than this filename: P2's week loader and P4's totals will be
 * files beside this one, not further edits to a lint rule.
 *
 * ## Everything, rather than only what today needs
 *
 * The queries below fetch the user's whole meal and workout library rather than
 * narrowing to the rows today happens to name. That is a deliberate reading of
 * PRD § Assumptions — *"ten or so recipes cover the rotation; the library will
 * grow slowly, not explode"* — and of the resolvers' own contract, which asks
 * for "every meal the template and overrides name, archived ones included".
 * Narrowing would mean deciding in SQL which rows resolution is going to want,
 * which is resolution's job and would be a second, weaker copy of it here.
 *
 * The one exception is `day_plan_overrides`, which is narrowed to a single date
 * — that table grows without bound as swaps accumulate, and today's row is the
 * only one today's answer can depend on.
 *
 * ## Two round trips, not seven
 *
 * The date has to come from `profiles.timezone` before overrides can be asked
 * for, so the profile is fetched first and everything else follows in one
 * `Promise.all`. On Neon's HTTP driver each query is a `fetch`, so the shape
 * that matters is the number of sequential waits, and there are two.
 *
 * ## Scoped, without restating why
 *
 * Every read goes through `scope()`. There is no path here that names a
 * `user_id` itself or reaches `getDb()` for anything but handing it to the
 * scope — the arrangement scope.ts exists to enforce, and the reason a demo
 * visitor cannot reach the owner's plan through this screen.
 */

/** What `/` needs to render, resolved. */
export type Today = {
  view: NowView;
  profile: Profile;
  /**
   * `workouts.id` → its exercises, in prescribed order.
   *
   * A map rather than exercises hung off `ResolvedWorkout`, because
   * `rotation.ts` returns the workout row and nothing else, and widening its
   * return type would put a table it does not read into a resolver that is
   * gated at 100% for not reading tables. The view asks this map for the list
   * it needs; nothing about the rotation changes.
   */
  exercises: ReadonlyMap<string, WorkoutExercise[]>;
};

/**
 * Groups exercises by the workout they belong to, order preserved.
 *
 * Ordered by the query, not here: `sort_order` then id, which is total, so two
 * exercises sharing a position still list the same way on every request.
 */
function byWorkout(rows: WorkoutExercise[]): Map<string, WorkoutExercise[]> {
  const grouped = new Map<string, WorkoutExercise[]>();

  for (const row of rows) {
    const list = grouped.get(row.workoutId);

    if (list) list.push(row);
    else grouped.set(row.workoutId, [row]);
  }

  return grouped;
}

/**
 * Resolves what is happening now for one user.
 *
 * `undefined` means the user has no profile row. That is not an error — a user
 * exists before it is set up, and the owner's seed script (FUEL-15) is what
 * writes one — but it does leave nothing to resolve against: no timezone, so no
 * day boundary, so no clock. The caller renders an empty state rather than
 * inventing a zone.
 *
 * `now` is an argument for the same reason it is one in `resolve-now.ts`: the
 * request is the one thing that genuinely knows the instant, and a view whose
 * correctness is entirely about what time it is should not read the clock in a
 * place a test cannot reach.
 */
export async function loadToday(
  userId: string,
  now: Date,
  cursor?: Cursor | null,
): Promise<Today | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  // The date the whole answer is about. `resolveNow` derives the same date from
  // the same zone and the same instant, so the row this narrows to is exactly
  // the one resolution will look for — one clock, read once.
  const date = todayIn(profile.timezone, now);

  const [meals, planTemplate, overrides, workouts, trainingTemplate, exerciseRows] =
    await Promise.all([
      s.select(schema.meals),
      s.select(schema.planTemplateEntries),
      s.select(schema.dayPlanOverrides, eq(schema.dayPlanOverrides.date, date)),
      s.select(schema.workouts),
      s.select(schema.trainingTemplateEntries),
      s.select(schema.workoutExercises, undefined, {
        orderBy: [asc(schema.workoutExercises.sortOrder), asc(schema.workoutExercises.id)],
      }),
    ]);

  const view = resolveNow({
    plan: {
      programStartDate: profile.programStartDate,
      template: planTemplate,
      overrides,
      meals,
    },
    training: {
      programStartDate: profile.programStartDate,
      template: trainingTemplate,
      workouts,
    },
    schedule: scheduleFor({ timeZone: profile.timezone, slotTimes: profile.slotTimes }),
    now,
    cursor,
  });

  return { view, profile, exercises: byWorkout(exerciseRows) };
}
