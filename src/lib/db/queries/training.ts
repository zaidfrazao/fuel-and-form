import "server-only";

import { and, asc, between, eq, sql } from "drizzle-orm";

import { adherenceWeeks, adherenceWindow } from "@/lib/adherence";
import type { Week } from "@/components/dot-grid";
import { type CalendarDate, todayIn } from "@/lib/date";
import { type TrainingDay, trainingDay } from "@/lib/resolve-training";
import type { TrainingPlan } from "@/lib/rotation";
import { getDb } from "../index";
import * as schema from "../schema";
import type { WorkoutLog, WorkoutLogStatus } from "../schema";
import { scope } from "../scope";
import { byWorkout } from "./today";

/**
 * A date's training, fetched and written — P3's whole database access.
 *
 * The read counterpart of `today.ts` for a different question. That file asks
 * "what is happening now", which is a question about an instant; this one asks
 * "what is trained on this date, and what was recorded against it", which is a
 * question about a date — most of them not today. `/training` is a place, the
 * way `/plan` is, and the date comes off the URL rather than out of a cookie.
 *
 * In `lib/db/queries/` for the reason today.ts sets out at length: `getDb()`
 * hands back an unscoped handle and the eslint rule makes reaching for one
 * outside `src/lib/db/` an error. A module here runs scoped statements and
 * returns ROWS — never a handle, never a `Scope`.
 *
 * ## Two round trips, and one of them fetches six weeks
 *
 * The timezone has to come from `profiles` before "today" exists, so the
 * profile is fetched first and everything else follows in one `Promise.all` —
 * two sequential waits, the shape that matters on Neon's HTTP driver.
 *
 * `workout_logs` is the one table narrowed by date, because it is the one that
 * grows without bound. It is narrowed to the GRID's window rather than to the
 * viewed date, which is a single query serving both readers: the dot grid needs
 * all six weeks, and the date's own rows are a filter over what already
 * arrived. The window comes from `adherenceWindow`, so the range fetched and
 * the range drawn cannot drift apart.
 *
 * The library — workouts, template entries, exercises — is fetched whole, on
 * the same reading of PRD § Assumptions that today.ts gives: narrowing would
 * mean deciding in SQL which rows resolution is going to want, which is
 * resolution's job.
 */

/** What `/training` needs to render, resolved. */
export type Training = {
  /** The date being viewed — the URL's, or today when it asked for nothing. */
  date: CalendarDate;
  /**
   * Today in the user's own zone.
   *
   * Carried separately because the screen needs both: the date decides what is
   * rendered, and today decides which dot is umber and whether the "Today"
   * control is worth offering. Derived here from `profiles.timezone` and the
   * request's instant, so nothing downstream reads a clock — the contract
   * `resolve-now.ts` and `today.ts` both keep.
   */
  today: CalendarDate;
  /** The date's sessions, in template order, with their exercises. */
  day: TrainingDay;
  /**
   * What is recorded against THIS date, both the session's row and the walk's.
   *
   * Filtered from the window rather than fetched again: the viewed date is
   * inside its own six-week window by construction, so the rows are already
   * here and a second query would be a second answer that could disagree.
   */
  logs: WorkoutLog[];
  /** Six weeks of dots, shaped — Brand Guide § The Dot Grid. */
  adherence: Week[];
};

/**
 * What one write says. The address is a date and a workout; the rest is what
 * happened.
 *
 * `note` and `durationMin` are `null` rather than optional, so clearing them is
 * expressible: a session corrected from "45 min" to nothing must write the
 * absence, and an optional field that is simply missing from the object would
 * leave the old value in place on the update. Both are already nullable
 * columns; this is the caller being made to say which it means.
 */
export type SessionRecord = {
  date: CalendarDate;
  workoutId: string;
  status: WorkoutLogStatus;
  note: string | null;
  durationMin: number | null;
};

/**
 * Resolves a date's training for one user.
 *
 * `undefined` means the user has no profile row — the same answer, for the same
 * reason, as `loadToday`: no timezone, so no day boundary, so no "today" to
 * default to and no zone to read a date in. Not an error; the caller renders an
 * empty state rather than inventing one.
 *
 * @param date the date to view, or `null` for today in the user's zone. Already
 *   validated by the caller — a malformed one is not this function's to refuse,
 *   and `app/training/page.tsx` turns it into `null` rather than a 500.
 */
export async function loadTraining(
  userId: string,
  date: CalendarDate | null,
  now: Date,
): Promise<Training | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  const today = todayIn(profile.timezone, now);
  const viewing = date ?? today;
  const window = adherenceWindow(viewing);

  const [workouts, template, exerciseRows, logs] = await Promise.all([
    s.select(schema.workouts),
    s.select(schema.trainingTemplateEntries),
    s.select(schema.workoutExercises, undefined, {
      orderBy: [asc(schema.workoutExercises.sortOrder), asc(schema.workoutExercises.id)],
    }),
    s.select(schema.workoutLogs, between(schema.workoutLogs.date, window.from, window.to)),
  ]);

  const plan: TrainingPlan = {
    programStartDate: profile.programStartDate,
    template,
    workouts,
  };

  return {
    date: viewing,
    today,
    day: trainingDay(plan, byWorkout(exerciseRows), viewing),
    logs: logs.filter((log) => log.date === viewing),
    adherence: adherenceWeeks(plan, logs, viewing),
  };
}

/**
 * Records a session's outcome, replacing whatever was recorded before.
 *
 * An upsert, not an insert, and that is the whole of P3's "past sessions are
 * viewable and EDITABLE by date". `workout_logs` is unique on
 * `(user_id, date, workout_id)` — see schema.ts — so a correction collides with
 * the row it corrects and updates it in one statement. Without that, every
 * change of mind would be another row, and the screen, the dot grid and the
 * weekly export would each need their own rule for which of them to believe.
 *
 * `logged_at` moves with the update. The column means "when this was recorded",
 * and after a correction the record was made at the correction — which is also
 * what keeps `latestLog` on `/` pointing at the thing that most recently
 * happened rather than at a first draft of it.
 *
 * Nothing here checks that the workout is on the date's plan. The caller
 * re-resolves the day and takes the id from its own answer (see
 * `app/actions/training.ts`), and underneath that the composite foreign key
 * `(workout_id, user_id)` means Postgres refuses another user's workout
 * regardless of what any caller checked — the same two-layer argument
 * `queries/log.ts` makes for meals.
 */
export async function recordSession(
  userId: string,
  record: SessionRecord,
): Promise<void> {
  const s = scope(userId, getDb());

  await s.upsert(
    schema.workoutLogs,
    {
      date: record.date,
      workoutId: record.workoutId,
      status: record.status,
      note: record.note,
      durationMin: record.durationMin,
    },
    {
      // `user_id` is deliberately absent: the scope prepends it, and naming it
      // here is an error scope.upsert refuses by name.
      target: [schema.workoutLogs.date, schema.workoutLogs.workoutId],
      set: {
        status: record.status,
        note: record.note,
        durationMin: record.durationMin,
        loggedAt: sql`now()`,
      },
    },
  );
}

/**
 * Removes a session's record — the way back from having logged anything at all.
 *
 * Brand Guide § Feedback asks for every log to be revertible "from where it was
 * performed", and on this screen that is the status itself: there is no undo
 * stack here, because the row is addressable by date and workout and can simply
 * be taken away. A hard delete, on `queries/log.ts`'s reasoning — a log that was
 * taken back did not happen, and a soft-deleted row is a filter every future
 * total has to remember.
 *
 * Returns whether a row went, so the caller can tell a real revert from one that
 * raced another tab. The scoped delete matches nothing for a row that is already
 * gone AND for one that was never the caller's, which are the same answer on
 * purpose.
 */
export async function clearSession(
  userId: string,
  date: CalendarDate,
  workoutId: string,
): Promise<boolean> {
  const s = scope(userId, getDb());

  const removed = await s.delete(
    schema.workoutLogs,
    and(eq(schema.workoutLogs.date, date), eq(schema.workoutLogs.workoutId, workoutId)),
  );

  return removed.length > 0;
}
