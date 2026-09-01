"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  clearSession,
  loadTraining,
  logSet,
  recordSession,
  removeSet,
} from "@/lib/db/queries/training";
import { type CalendarDate, parseCalendarDate } from "@/lib/date";
import { parseReps, parseSetIndex } from "@/lib/exercise-set";
import { parseSessionEntry } from "@/lib/session-entry";

/**
 * Recording a session on any date — P3's writes (FUEL-27).
 *
 * ## Why this is not another export on `actions/log.ts`
 *
 * The same distinction `plan.ts` draws against `swap.ts`, one table across, and
 * for the same reason: how the thing written is ADDRESSED.
 *
 *   - `log.ts` takes a `key` naming an item in TODAY'S resolved timeline. The
 *     date is never an argument at all — it re-resolves today and reads the
 *     date off its own answer — so it cannot name another day. That is a
 *     property of the module, and P1's card depends on it.
 *   - This module takes a `date`. The screen's whole point is that a past
 *     session is editable, so most of the dates it is given are not today.
 *
 * There is a second difference, and it is the one that matters more here.
 * `logItem` records a session by writing a row and refusing to write a second;
 * this records an OUTCOME, which can be changed. Marking a session done and
 * then correcting it to partial is one row twice, not two rows — see
 * `recordSession` and the unique index it collides on.
 *
 * ## The client sends an ENTRY id, never a workout id
 *
 * What crosses the wire is the `training_template_entries` id the screen
 * rendered, plus a date and the three fields of the entry. This action then
 * re-resolves that date on the server and takes `workout_id` from its OWN
 * answer.
 *
 * That is what closes the hole a `workoutId` parameter would open. The
 * composite foreign key stops another user's workout being named, but nothing
 * in the database stops a caller naming one of their own workouts that is not
 * on that date's plan — a row that would be stored, would never resolve onto a
 * screen, and would still reach the weekly export as evidence of a session that
 * was never scheduled. Re-resolving means the worst a forged request can do is
 * name an entry the date does not have, which is refused.
 *
 * The entry rather than the workout for the reason `resolve-training.ts` gives:
 * a rotated day's workout changes with the date, so the entry is the stable
 * thing for a screen to name, and the workout is the date's answer.
 *
 * ## Sessions only, and the walk deliberately not
 *
 * `actions/log.ts` searches the day's `anytime` items as well as its timeline,
 * on the grounds that "a log module that could only reach half the day's items
 * would be the wrong shape to hand the next task". That reasoning does not
 * survive being applied here, and the difference is what the SCREEN can show.
 *
 * A walk row written through this action would be a row this screen's controls
 * cannot edit and cannot clear, sitting in the weekly export as evidence. That
 * is the exact failure this module refuses for a workout the date does not
 * schedule, and it would be inconsistent to refuse one and allow the other
 * because the second happens to be on the plan.
 *
 * This comment used to say FUEL-29 would open the path by widening the filter
 * below. It did not: the walk got `actions/log-walk.ts`, and the filter stays as
 * it is. Widening it would have meant the client sending a `status` for a
 * control that offers exactly one — a value the user never chooses but a forged
 * request still could, making 'partial' and 'skipped' reachable states for an
 * item with no way to display them — and carrying a `note` onto a row that has
 * no control for one. The walk is loggable on both screens now; what it is not
 * is a session, and this filter is where that stays true.
 *
 * ## Nothing throws
 *
 * Every path returns `{ ok }`. A thrown Server Action is a 500 with nothing for
 * the client to render, and § Feedback asks for an inline banner with the value
 * reverted and a "Try again" — which needs something to come back. The failures
 * are deliberately not distinguished: "no session", "no such entry", "a note
 * too long" and "the database is down" are one answer, because the screen's
 * response to all four is identical.
 */

/** What the screen renders from. Success carries nothing — see § Feedback. */
export type TrainingResult = { ok: boolean };

const DONE: TrainingResult = { ok: true };
const FAILED: TrainingResult = { ok: false };

/**
 * The workout a template entry resolves to on a date, for the caller's own user.
 *
 * `undefined` for no session, no profile row, a malformed date, or an entry the
 * date does not hold. One answer for all four — see the module comment.
 *
 * The date is parsed before anything is fetched, on `plan.ts`'s reasoning: the
 * catch would turn a throw into `{ ok: false }` anyway, but only after a round
 * trip, and a refusal that costs a query is a refusal that can be used to make
 * the database work.
 */
async function resolveSession(
  date: CalendarDate,
  entryId: string,
): Promise<
  { userId: string; workoutId: string; exerciseIds: Set<string> } | undefined
> {
  const session = await getSession();

  if (!session) return undefined;

  parseCalendarDate(date);

  const training = await loadTraining(session.userId, date, new Date());

  // No sessions is the answer for a date before `program_start_date` and for
  // one the template does not cover, so both are refused here without a
  // separate check: there is no entry to match, so nothing matches.
  const resolved = training?.day.sessions.find(
    (item) => item.entryId === entryId && item.kind === "session",
  );

  return (
    resolved && {
      userId: session.userId,
      workoutId: resolved.workout.id,
      /*
       * The exercises this session actually holds — FUEL-91.
       *
       * The same argument the module comment makes about `workoutId`, one level
       * down. The composite foreign key stops another user's exercise being
       * named, but nothing in the database stops a caller naming one of their
       * OWN exercises belonging to a different workout: the row would store, it
       * would never resolve onto a screen, and it would still reach the export
       * as evidence of a set performed in a session that never contained that
       * movement. Taking the candidates from the server's own resolution is
       * what closes it, exactly as re-resolving the workout does above.
       */
      exerciseIds: new Set(resolved.exercises.map((exercise) => exercise.id)),
    }
  );
}

/**
 * Sets a session's status, with its optional note and duration.
 *
 * Done, partial and skipped go through this one function rather than three, and
 * the note travels with the status rather than in a save of its own. Both are
 * § Progressive Disclosure's "one question per screen" applied to a write: the
 * question is "how did that session go", and a status saved separately from the
 * note it explains would leave a screen where tapping Partial and then closing
 * the app loses the sentence that said why.
 *
 * A repeated tap on the status a session already has is an ordinary update
 * writing the same values. It is not refused, because the note or the duration
 * beside it may have changed, and because a caller cannot tell the difference
 * between a no-op and a failure from `{ ok: false }`.
 */
export async function setSessionStatus(input: {
  date: CalendarDate;
  entryId: string;
  status: unknown;
  note?: unknown;
  durationMin?: unknown;
}): Promise<TrainingResult> {
  try {
    // Before the session is resolved, because it costs no query. Every branch
    // of it is reachable by anyone who can POST here — see `session-entry.ts`.
    const entry = parseSessionEntry(input);

    if (!entry) return FAILED;

    const resolved = await resolveSession(input.date, input.entryId);

    // An entry that date does not hold. Either a forged request, or a screen
    // whose plan changed underneath it — a template edited in another tab.
    // `refresh()` is what corrects the second, and it has to happen here
    // because this path returns before reaching the one below.
    if (!resolved) {
      refresh();

      return FAILED;
    }

    await recordSession(resolved.userId, {
      date: input.date,
      workoutId: resolved.workoutId,
      ...entry,
    });

    refresh();

    return DONE;
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a banner and a
    // "Try again", which is everything they can act on.
    console.error("Could not record the session.", error);

    return FAILED;
  }
}

/**
 * Takes the record back, leaving the date unlogged — § Feedback's "any log is
 * revertible from where it was performed".
 *
 * Not "for the rest of that day" but for as long as the date is reachable,
 * which on this screen is always. The undo on `/` is a stack over today because
 * the card cannot name yesterday; here the row has an address, so taking it
 * back is deleting the row at that address.
 *
 * Removing a record that is already gone is `ok`, not a failure. The screen
 * offers no revert in that state, so reaching here means it was behind, and
 * `refresh()` is the correction — a banner would report a problem the user does
 * not have.
 */
export async function clearSessionStatus(input: {
  date: CalendarDate;
  entryId: string;
}): Promise<TrainingResult> {
  try {
    const resolved = await resolveSession(input.date, input.entryId);

    if (!resolved) {
      refresh();

      return FAILED;
    }

    await clearSession(resolved.userId, input.date, resolved.workoutId);

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not clear the session.", error);

    return FAILED;
  }
}

/**
 * Records one set against an exercise of the date's session — § P10, FUEL-91.
 *
 * ## Addressed the same way a status is, and validated one level further
 *
 * The client sends the entry id, the exercise id and the ordinal; the server
 * re-resolves the date, takes the workout from its own answer, and checks that
 * the exercise is one that session holds. See `resolveSession` for why the last
 * of those is not something the composite foreign key already does.
 *
 * ## Not refused for a past date, and that is not an oversight
 *
 * Brand Guide § Desktop gives the session state to today alone — "a past date is
 * a record", and you cannot start Tuesday's session on Thursday. That is a rule
 * about the STATE, which is a composition, and the screen is where it is
 * enforced. It is not a rule about the row: PRD § P3 has always had past
 * sessions "viewable and editable by date", the set of a session performed on
 * Tuesday belongs to Tuesday whenever it is entered, and an action that refused
 * the date would be a refusal the export and any later correction feature would
 * each have to unlearn. The refusal this action does make is the one at the
 * other end of the calendar, and it is `resolveSession`'s: a date before
 * `program_start_date` resolves no sessions, so there is no entry to name.
 *
 * ## What a repeat tap does
 *
 * Logging a set that is already logged is an ordinary update writing the same
 * reps — see `logSet`, which collides on the unique index rather than inserting
 * beside it. It is not refused, for `setSessionStatus`'s reason: a caller cannot
 * tell a no-op from a failure through `{ ok }`, and correcting eight to six is
 * the same statement as entering eight twice.
 */
export async function logExerciseSet(input: {
  date: CalendarDate;
  entryId: string;
  exerciseId: string;
  setIndex: unknown;
  reps: unknown;
}): Promise<TrainingResult> {
  try {
    // Before anything is fetched, on `setSessionStatus`'s reasoning: a refusal
    // that costs a query is a refusal that can be used to make the database
    // work, and both of these are reachable by anyone who can POST here.
    const setIndex = parseSetIndex(input.setIndex);
    const reps = parseReps(input.reps);

    if (setIndex === undefined || reps === undefined) return FAILED;

    const resolved = await resolveSession(input.date, input.entryId);

    // An entry the date does not hold, or an exercise the session does not.
    // One answer for both, and `refresh()` for the same reason
    // `setSessionStatus` gives: the second most likely cause is a screen whose
    // plan changed underneath it, and this path returns before reaching the
    // refresh below.
    if (!resolved || !resolved.exerciseIds.has(input.exerciseId)) {
      refresh();

      return FAILED;
    }

    await logSet(resolved.userId, {
      date: input.date,
      workoutId: resolved.workoutId,
      exerciseId: input.exerciseId,
      setIndex,
      reps,
    });

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not record the set.", error);

    return FAILED;
  }
}

/**
 * Takes one set back — the tick, untapped.
 *
 * Removing a set that is already gone is `ok`, not a failure, on
 * `clearSessionStatus`'s reasoning: the screen offers no tick to untick in that
 * state, so reaching here means it was behind, and `refresh()` is the
 * correction rather than a banner about a problem the reader does not have.
 *
 * The session's own record is deliberately untouched, even when this removes
 * the last set of the session — see `removeSet`. Nothing about the status is
 * derived from set data, and a status the reader chose is not something a set
 * removal may take away.
 */
export async function removeExerciseSet(input: {
  date: CalendarDate;
  entryId: string;
  exerciseId: string;
  setIndex: unknown;
}): Promise<TrainingResult> {
  try {
    const setIndex = parseSetIndex(input.setIndex);

    if (setIndex === undefined) return FAILED;

    const resolved = await resolveSession(input.date, input.entryId);

    if (!resolved || !resolved.exerciseIds.has(input.exerciseId)) {
      refresh();

      return FAILED;
    }

    await removeSet(resolved.userId, {
      date: input.date,
      workoutId: resolved.workoutId,
      exerciseId: input.exerciseId,
      setIndex,
    });

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not remove the set.", error);

    return FAILED;
  }
}
