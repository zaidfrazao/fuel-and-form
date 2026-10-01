import "server-only";

import { and, isNotNull, not, type SQL, sql } from "drizzle-orm";

import * as schema from "../schema";
import type { Scope } from "../scope";

/**
 * Takes back a session's record and keeps its sets — FUEL-134.
 *
 * The two ways back from a recorded session — `/`'s Undo (`deleteLog`) and
 * `/training`'s Clear (`clearSession`) — both used to delete the `workout_logs`
 * row. That row is also the parent of the session's sets, and the foreign key
 * cascades, so taking back a VERDICT on some training erased the training.
 * `exercise_sets`' schema comment once called that "no third option": a set
 * whose log is gone has nothing to hang off. FUEL-134 made the third option —
 * a row with no status is the sets' parent and records nothing — so this is it.
 *
 * A row with sets under it keeps them and loses its status, note and duration:
 * every reader draws a row with no status as unrecorded, so a note left on it
 * would be invisible, and the next mark would overwrite it unseen. A row with
 * no sets is deleted, as before, which is every walk and every session that was
 * only ever tapped.
 *
 * One function so the two controls cannot come to disagree about what taking
 * a record back means. Two statements, each guarded on its own case, so neither
 * can do the other's job: the update touches only a MARKED row with sets, and
 * the delete only a row with none. A row with sets and no status is matched by
 * neither — there is no record to take back, and the answer is `false`, which
 * is what a second Clear or a raced Undo has always been told. Without the
 * delete's own guard, that row would fall through to it and cascade.
 */
export async function takeBackRecord(s: Scope, where: SQL): Promise<boolean> {
  const hasSets = sql`exists (select 1 from ${schema.exerciseSets} where ${schema.exerciseSets.workoutLogId} = ${schema.workoutLogs.id})`;

  const unmarked = await s.update(
    schema.workoutLogs,
    { status: null, note: null, durationMin: null },
    and(where, isNotNull(schema.workoutLogs.status), hasSets),
  );

  if (unmarked.length > 0) return true;

  const removed = await s.delete(schema.workoutLogs, and(where, not(hasSets)));

  return removed.length > 0;
}
