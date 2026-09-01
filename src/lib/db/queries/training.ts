import "server-only";

import { and, asc, between, eq, inArray, sql } from "drizzle-orm";

import { adherenceWeeks, adherenceWindow } from "@/lib/adherence";
import type { Week } from "@/components/dot-grid";
import { type CalendarDate, todayIn } from "@/lib/date";
import { type TrainingDay, trainingDay } from "@/lib/resolve-training";
import type { TrainingPlan } from "@/lib/rotation";
import { getDb } from "../index";
import * as schema from "../schema";
import type { ExerciseSet, WorkoutLog, WorkoutLogStatus } from "../schema";
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
  /**
   * Every set performed on THIS date — § P10's per-set logging, FUEL-91.
   *
   * Narrowed to the date rather than to the window the logs use, and the
   * asymmetry is deliberate. The logs feed two readers: the dot grid needs all
   * six weeks, and the date's own row is a filter over what already arrived.
   * Nothing on this screen draws another date's SETS — the grid is a pattern of
   * statuses and says nothing about reps — so fetching six weeks of them would
   * be six weeks of rows crossing the wire to be thrown away, on the one table
   * here that grows fastest.
   *
   * Ordered by exercise and then by index, though `setsFor` sorts again for
   * itself: an ordering that survives a filter only by accident is one that
   * breaks the first time somebody adds a second reader.
   */
  sets: ExerciseSet[];
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
  const db = getDb();
  const s = scope(userId, db);

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  const today = todayIn(profile.timezone, now);
  const viewing = date ?? today;
  const window = adherenceWindow(viewing);

  const [workouts, template, exerciseRows, logs, sets] = await Promise.all([
    s.select(schema.workouts),
    s.select(schema.trainingTemplateEntries),
    s.select(schema.workoutExercises, undefined, {
      orderBy: [asc(schema.workoutExercises.sortOrder), asc(schema.workoutExercises.id)],
    }),
    s.select(schema.workoutLogs, between(schema.workoutLogs.date, window.from, window.to)),
    /*
     * The date's sets, addressed through the logs they hang off.
     *
     * A subquery rather than a third sequential await. The log ids are already
     * being fetched in this same `Promise.all`, but waiting for them would add
     * a third round trip to a module whose comment above says the shape that
     * matters on Neon's HTTP driver is the number of sequential waits — and
     * this is the read that happens on every tap of a set.
     *
     * The subquery names `user_id` explicitly, and the scope adds its own to
     * `exercise_sets` besides. Two independent filters where one would do, on
     * the principle scope.ts states: an inner query that a later edit got wrong
     * would still be unable to reach another user's rows, because the outer
     * WHERE clause is not written by hand at all.
     */
    s.select(
      schema.exerciseSets,
      inArray(
        schema.exerciseSets.workoutLogId,
        db
          .select({ id: schema.workoutLogs.id })
          .from(schema.workoutLogs)
          .where(
            and(
              eq(schema.workoutLogs.userId, userId),
              eq(schema.workoutLogs.date, viewing),
            ),
          ),
      ),
      {
        orderBy: [
          asc(schema.exerciseSets.exerciseId),
          asc(schema.exerciseSets.setIndex),
        ],
      },
    ),
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
    sets,
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

/**
 * What one set write says. The address is a log, an exercise and an ordinal.
 *
 * `reps` is the only thing that is not an address, which is why it is the only
 * field `exercise-set.ts` has to refuse. `loadKg` is deliberately absent: the
 * column ships dormant (§ Gym-restart readiness), and a parameter for a value
 * nothing sends is a parameter somebody eventually sends something wrong in.
 */
export type SetRecord = {
  date: CalendarDate;
  workoutId: string;
  exerciseId: string;
  setIndex: number;
  reps: number;
};

/**
 * Records one set, creating the session's log row if this is the first.
 *
 * ## The parent row, and the status it is born with
 *
 * `exercise_sets` hangs off `workout_logs`, and sets are logged BEFORE anyone
 * marks a session — so the first set of a session has no parent to hang off and
 * has to make one. It is written with status 'partial', `on conflict` leaving
 * whatever is already there untouched.
 *
 * That status is a DEFAULT AT CREATION and nothing recomputes it, in either
 * direction. A session marked done and then given a fourth set is still done. A
 * session whose last set is removed is still whatever it was marked. PRD § P10
 * requires that the status is never derived from set data, and § P3 calls
 * partial "a first-class outcome, not a failure state" — a status that drifted
 * with set completion would quietly turn the dot grid into a percentage, which
 * is the one thing the Brand Guide says that graphic exists to refuse.
 *
 * 'partial' rather than 'done' because it is the only one of the three that is
 * true of a session with one set in it, and rather than nothing at all because
 * `status` is `not null` and this task may not change an existing table's
 * constraints. The alternative — creating the row when the session state is
 * ENTERED — was considered and rejected: a tap on Start session that trains
 * nothing would then sit in the adherence grid as a partial session.
 *
 * ## Two statements, not a transaction
 *
 * The conflict clause is a no-op update naming the row's own workout, which
 * exists so `on conflict` has something to do and RETURNING hands back the row
 * that is already there. It deliberately does not touch `status`, `note`,
 * `duration_min` or `logged_at` — `recordSession` owns all four, and
 * `logged_at` means "when the outcome was recorded" rather than "when something
 * last happened here".
 *
 * If the second statement fails, a 'partial' row with no sets under it is left
 * behind. Worth naming, not worth a transaction: `queries/template.ts` makes
 * the same call, the interactive transaction needs the WebSocket pool rather
 * than the HTTP driver, and this is the write that happens on every tap of a
 * tick. The residue is a session marked partial, which the screen shows and the
 * reader can clear.
 */
export async function logSet(userId: string, record: SetRecord): Promise<void> {
  const s = scope(userId, getDb());

  const [log] = await s.upsert(
    schema.workoutLogs,
    {
      date: record.date,
      workoutId: record.workoutId,
      status: "partial",
    },
    {
      target: [schema.workoutLogs.date, schema.workoutLogs.workoutId],
      // The conflict target's own value. Status is absent on purpose — see
      // above; this clause exists to return the row, not to change it.
      set: { workoutId: record.workoutId },
    },
  );

  // Unreachable: an upsert either inserts or updates, and both return a row.
  // A throw rather than a `!` so it stays unreachable — the caller turns it
  // into the same `{ ok: false }` every other failure produces.
  if (!log) throw new Error("Upserting the session's log returned no row.");

  await s.upsert(
    schema.exerciseSets,
    {
      workoutLogId: log.id,
      exerciseId: record.exerciseId,
      setIndex: record.setIndex,
      reps: record.reps,
    },
    {
      // The unique index from schema.ts, minus the `user_id` the scope
      // prepends for itself. A correction collides with the set it corrects.
      target: [
        schema.exerciseSets.workoutLogId,
        schema.exerciseSets.exerciseId,
        schema.exerciseSets.setIndex,
      ],
      set: { reps: record.reps },
    },
  );
}

/**
 * Takes one set back — § Feedback's "any log is revertible from where it was
 * performed", at the scale of a single row.
 *
 * A hard delete, on `clearSession`'s reasoning: a set that was taken back did
 * not happen, and a soft-deleted row is a filter every future reader has to
 * remember. The absence of a row is what "not performed" means here — the same
 * predicate `shopping_checks` uses, where presence is the whole state.
 *
 * The session's log row is deliberately left behind, even when this removes the
 * last set of the session. Deriving nothing from set data cuts both ways: a
 * status the reader chose is not something a set removal may take away.
 *
 * Returns whether a row went, so a caller can tell a real revert from one that
 * raced another tab — and the scoped delete matches nothing both for a row that
 * is already gone and for one that was never the caller's, which are the same
 * answer on purpose.
 */
export async function removeSet(
  userId: string,
  address: { date: CalendarDate; workoutId: string; exerciseId: string; setIndex: number },
): Promise<boolean> {
  const s = scope(userId, getDb());

  const log = await s.selectOne(
    schema.workoutLogs,
    and(
      eq(schema.workoutLogs.date, address.date),
      eq(schema.workoutLogs.workoutId, address.workoutId),
    ),
  );

  // No log is no sets. Not an error: the screen offers no tick to untick in
  // that state, so reaching here means it was behind, and `refresh()` is the
  // correction rather than a banner about a problem the reader does not have.
  if (!log) return false;

  const removed = await s.delete(
    schema.exerciseSets,
    and(
      eq(schema.exerciseSets.workoutLogId, log.id),
      eq(schema.exerciseSets.exerciseId, address.exerciseId),
      eq(schema.exerciseSets.setIndex, address.setIndex),
    ),
  );

  return removed.length > 0;
}
