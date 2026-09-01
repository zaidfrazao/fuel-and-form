import "server-only";

import { eq } from "drizzle-orm";

import { type CalendarDate, todayIn } from "@/lib/date";
import type { ExportAccount, ExportTables } from "@/lib/export";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";

/**
 * Every row the account owns, read once — FUEL-37's half of P6.
 *
 * In `lib/db/queries/` for the reason the whole directory exists: `getDb()`
 * hands back an UNSCOPED handle, and only a module here may hold one. What
 * comes out is rows — never a handle, never a `Scope` — which is what makes
 * this importable from a route handler at all.
 *
 * ## Every read is scoped, and that is the acceptance criterion
 *
 * "The export runs against the logged-in account only — demo sessions export
 * demo data" is not a feature of this file so much as the absence of a way to
 * write it otherwise: `scope(userId, getDb())` prepends `user_id = $1` to all
 * twelve statements, and `scope.select` refuses a caller-supplied `user_id`
 * that would let one be widened. Testing Strategy § 1.4 case 3 is the test that
 * a demo session's export holds demo rows and zero owner rows, and it passes
 * because there is no unscoped statement here to get wrong.
 *
 * `users` is the single exception, and it is the same one `resolveSession`
 * relies on: that table has no `user_id` because its own `id` IS the owner, so
 * `scope()` cannot read it and it is fetched by primary key instead.
 * `schema.test.ts` names it as the sole exemption, so a table that ever forgets
 * `user_id` fails that suite rather than quietly arriving here unscoped.
 *
 * ## Two waves, not twelve round trips
 *
 * The profile decides whether there is anything to export at all, and it
 * carries the timezone the filename's date comes from — so it and the `users`
 * row go first, together. The remaining ten tables depend on nothing but the
 * `user_id` already in hand, so they run through `Promise.all`: on Neon's HTTP
 * driver each statement is its own request, and ten of them in sequence is the
 * difference between a fast tap and a slow one.
 *
 * ## The snapshot is not transactional, knowingly
 *
 * Neon's HTTP driver has no interactive transaction, so these statements are
 * twelve independent reads. A write landing between two of them could produce a
 * file where a `meal_log` names a meal the earlier query did not return. The
 * window is milliseconds, the export is a deliberate tap by the only person who
 * can also be writing, and the consequence is a backup one row out of date —
 * so this is recorded rather than engineered around. `db.batch()` over
 * neon-http is the fix if it ever matters, and it would need `scope()` to grow
 * a batching API first.
 */

/** What the route needs: who, what, and the date that names the file. */
export type ExportPayload = {
  account: ExportAccount;
  tables: ExportTables;
  /** Today in the user's own zone — the filename's date, and nothing else. */
  today: CalendarDate;
};

/**
 * One account, whole.
 *
 * `undefined` when there is no profile row — the contract `loadWeighIns`,
 * `loadTraining` and `loadToday` all keep. It means the user exists but has
 * never been set up: no timezone, so no date to name the file with, and the app
 * does not take one from the server's clock instead. The route answers 404, and
 * the settings screen does not offer the link in the first place.
 */
export async function loadExport(
  userId: string,
  now: Date,
): Promise<ExportPayload | undefined> {
  const db = getDb();
  const s = scope(userId, db);

  const [user, profile] = await Promise.all([
    db
      .select({ id: schema.users.id, kind: schema.users.kind, displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
      .then((rows) => rows[0]),
    s.selectOne(schema.profiles),
  ]);

  if (!user || !profile) return undefined;

  const [
    meals,
    mealIngredients,
    planTemplateEntries,
    dayPlanOverrides,
    mealLogs,
    workouts,
    workoutExercises,
    trainingTemplateEntries,
    workoutLogs,
    exerciseSets,
    weightLogs,
    shoppingChecks,
  ] = await Promise.all([
    s.select(schema.meals),
    s.select(schema.mealIngredients),
    s.select(schema.planTemplateEntries),
    s.select(schema.dayPlanOverrides),
    s.select(schema.mealLogs),
    s.select(schema.workouts),
    s.select(schema.workoutExercises),
    s.select(schema.trainingTemplateEntries),
    s.select(schema.workoutLogs),
    s.select(schema.exerciseSets),
    s.select(schema.weightLogs),
    s.select(schema.shoppingChecks),
  ]);

  return {
    account: {
      id: user.id,
      kind: user.kind,
      displayName: user.displayName,
      // On the account rather than left inside `profile`, where it also
      // appears. Every `date` in the file was recorded against this zone, and a
      // reader deciding what "2026-08-10" meant should not have to know that
      // the app keeps its timezone on the profile table.
      timezone: profile.timezone,
    },
    // Unordered on purpose: `buildExport` sorts every array, and a second
    // ordering here would be a second place to keep that decision.
    tables: {
      profile,
      meals,
      mealIngredients,
      planTemplateEntries,
      dayPlanOverrides,
      mealLogs,
      workouts,
      workoutExercises,
      trainingTemplateEntries,
      workoutLogs,
      exerciseSets,
      weightLogs,
      shoppingChecks,
    },
    today: todayIn(profile.timezone, now),
  };
}
