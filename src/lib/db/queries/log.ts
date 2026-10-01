import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { CalendarDate } from "@/lib/date";
import { type DayLogs, isMarked, type LoggedRow, type LogIntent } from "@/lib/log-intent";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";
import { takeBackRecord } from "./session-record";

/**
 * Writing down what happened — P1's "log eaten", "mark done" and "skip".
 *
 * The write-side counterpart to `today.ts`, and in this directory for the same
 * reason: `getDb()` hands back an unscoped handle, and the eslint rule in
 * eslint.config.mjs makes reaching for one outside `src/lib/db/` an error. A
 * module here runs scoped statements and returns ROWS — never a handle, never a
 * `Scope` — which is what makes importing one from `app/` safe.
 *
 * Every statement below goes through `scope()`, so `user_id` is in the WHERE
 * clause of the delete and in the VALUES of the insert without any caller being
 * able to name it. That is the PRD's § Security promise applied to the first
 * write path in the app: a demo visitor cannot log against the owner's plan, and
 * cannot delete the owner's log even holding its id — the row simply does not
 * match, and `delete` returns nothing rather than 403 versus 404.
 *
 * ## Why the meal id is not checked against the plan here
 *
 * It does not need to be, twice over. The intent is built from a RESOLVED item
 * (see log-intent.ts), so it can only name a meal today's plan already holds;
 * and the composite foreign key `(meal_id, user_id)` on `meal_logs` means
 * Postgres refuses another user's meal even if one were somehow named. The
 * check that is not written here is the one that could not be got wrong.
 */

/**
 * Today's logs, both kinds.
 *
 * Narrowed to one date because that is the whole question — what has been logged
 * today, for the undo affordance and for the duplicate guard. `meal_logs` and
 * `workout_logs` are both indexed on `(user_id, date)`, which the PRD names as
 * sufficient for every query this app will ever run.
 *
 * Two queries in one `Promise.all`: on Neon's HTTP driver each is a `fetch`, so
 * what matters is the number of sequential waits, and there is one.
 */
export async function logsFor(userId: string, date: CalendarDate): Promise<DayLogs> {
  const s = scope(userId, getDb());

  const [meals, workouts] = await Promise.all([
    s.select(schema.mealLogs, eq(schema.mealLogs.date, date)),
    s.select(schema.workoutLogs, eq(schema.workoutLogs.date, date)),
  ]);

  // A session with sets and no outcome is not a log of the session — FUEL-134,
  // and `MarkedWorkoutLog`. Left in, it read as logged on `/`, and it topped
  // Undo's stack, where taking it back deleted the sets under it.
  return { meals, workouts: workouts.filter(isMarked) };
}

/**
 * Records one log.
 *
 * `logged_at` is left to the column's `defaultNow()` rather than passed in: the
 * database's clock is the one that orders the day's rows for undo, and a client
 * or a server sending its own would let two rows disagree about which came
 * first. The date the row is FILED under is a different question, and that one
 * is decided in the user's configured timezone upstream — see `logIntent`.
 */
export async function recordLog(userId: string, intent: LogIntent): Promise<void> {
  const s = scope(userId, getDb());

  if (intent.kind === "meal") {
    await s.insert(schema.mealLogs, {
      date: intent.date,
      slot: intent.slot,
      mealId: intent.mealId,
      status: intent.status,
    });

    return;
  }

  // A session with sets logged already has its row, with no status (FUEL-134),
  // and `workout_logs` is unique on (user, date, workout) — so the insert below
  // would collide with it. Marking it is filling that status in, with
  // `logged_at` moved to now because the outcome is recorded now.
  //
  // `status is null` and not an unconditional upsert: a row that already holds
  // an outcome was marked somewhere else (`/training`, another tab), and a
  // stale `/` must not overwrite it. That case falls through to the insert and
  // fails on the index, as it always has.
  const [marked] = await s.update(
    schema.workoutLogs,
    { status: intent.status, loggedAt: sql`now()` },
    and(
      eq(schema.workoutLogs.date, intent.date),
      eq(schema.workoutLogs.workoutId, intent.workoutId),
      isNull(schema.workoutLogs.status),
    ),
  );

  if (marked) return;

  await s.insert(schema.workoutLogs, {
    date: intent.date,
    workoutId: intent.workoutId,
    status: intent.status,
  });
}

/**
 * Removes one log — undo.
 *
 * A hard delete, not a flag. A log that was taken back did not happen, and the
 * export (P6) reports what happened; a soft-deleted row would have to be
 * filtered out of every total from here on, which is a filter someone eventually
 * forgets. The row's own history is the tap that created it, and that tap has
 * been undone.
 *
 * Returns whether anything was removed, so the caller can tell a genuine undo
 * from one that raced another tab — the scoped delete returns no rows for a log
 * that is already gone AND for one that was never the caller's, which are the
 * same answer on purpose.
 */
export async function deleteLog(userId: string, row: LoggedRow): Promise<boolean> {
  const s = scope(userId, getDb());

  if (row.kind === "meal") {
    const removed = await s.delete(schema.mealLogs, eq(schema.mealLogs.id, row.log.id));

    return removed.length > 0;
  }

  // A session with sets under it loses the mark and keeps the sets — FUEL-134,
  // and `takeBackRecord`. Deleting the row would cascade: undoing a tap of
  // Mark done would erase the training it was a verdict on.
  return takeBackRecord(s, eq(schema.workoutLogs.id, row.log.id));
}
