import type { WorkoutLog } from "./db/schema";
import type { DayLogs } from "./log-intent";
import type { NowItem } from "./resolve-now";
import { WALK_TYPE } from "./resolve-training";

/**
 * The daily walk, as the layers that are not the walk's own have to see it —
 * FUEL-29, PRD § P3.
 *
 * The walk is the one item on the plan that is neither on the timeline nor a
 * session: it has no window, so `resolve-now.ts` puts it in `anytime` on every
 * day of the week; it has no exercises, no note and no three-way status, so
 * `session-entry.ts`'s vocabulary is wider than it needs. What it does have is a
 * `workout_logs` row like any other, and that row has to be told apart from the
 * session's by three separate callers who would otherwise each write their own
 * `type === "walk"` test.
 *
 * This file is that test, written once, plus the two things that follow from it.
 *
 * ## Why the undo stack has to know
 *
 * `/`'s Undo is a stack over the day's logs (`log-intent.ts`'s `latestLog`), and
 * every entry in it was put there by the action bar, which walks the TIMELINE.
 * The walk is not on the timeline. Two things break if its row is left in that
 * stack:
 *
 *   1. `undoLastLog` moves the cursor back whenever a row goes. The walk never
 *      moved it forward, so undoing a walk would step the card back past an item
 *      that is still logged — the "one tap, one item" guarantee broken by a tap
 *      on something that is not an item of the timeline at all.
 *   2. The Undo control would silently retarget. A user who logs dinner, then
 *      the walk, then taps Undo meaning dinner would take back the walk.
 *
 * Brand Guide § Feedback asks for a log to be "revertible from where it was
 * performed", and the walk is performed on its own row — so that row carries its
 * own revert (`components/walk-row.tsx`) and the bar's stack is narrowed to what
 * the bar itself wrote. `withoutWalks` is that narrowing.
 *
 * ## Pure, and given its values
 *
 * No database access, no `user_id`, no `server-only`, and only TYPE imports from
 * the schema — the contract `resolve-now.ts`, `resolve-training.ts` and
 * `log-intent.ts` all keep, and the reason a client component can import
 * `WALK_PRESETS` from here without dragging pg-core into the browser bundle.
 *
 * The walk's own identity comes from `WALK_TYPE` in `resolve-training.ts`, which
 * is where the column's open vocabulary is argued. Nothing here spells "walk".
 */

/**
 * Whether a resolved item is the daily walk rather than a session or a meal.
 *
 * A type predicate, and generic over the item, so that narrowing survives the
 * `key` a `ScheduledItem` or an `AnytimeItem` carries: a caller that has just
 * established an item is the walk goes on to read `item.workout.entryId` off it,
 * and a plain `boolean` would leave that a compile error solved by a cast.
 */
export function isWalk<T extends NowItem>(
  item: T,
): item is Extract<T, { kind: "workout" }> {
  return item.kind === "workout" && item.workout.workout.type === WALK_TYPE;
}

/**
 * The `workouts.id` of every walk on the day, from the day's own resolution.
 *
 * A set rather than a single id because nothing in the schema forbids two walk
 * entries on one weekday — `training_template_entries` has no unique constraint
 * on `(user_id, day_of_week)` and could not have one, since the walk already
 * shares every day with a session. The seed schedules one; a caller that assumed
 * so would be a caller that silently left the second walk's row in the stack.
 *
 * Taken from the RESOLVED items rather than from the workout library, so a walk
 * that is no longer on today's plan is not in the set — and its log row is
 * therefore left in the undo stack, which is right. That row has no row on the
 * screen to revert it from, so the bar is the only way back to it.
 *
 * ## Callers pass `view.anytime`, and not the whole day
 *
 * The question this answers is not "is this a walk" — `isWalk` is that — but
 * "does this walk have a row of its own to be reverted from", and the row is
 * rendered from the anytime list. So the anytime list is the honest input.
 *
 * It matters in one state, which no screen can reach: `settings` offers no time
 * for the walk (see `EDITABLE_WORKOUT_TYPES`), but a hand-edited
 * `profiles.workout_times` would give it a window and move it onto the TIMELINE,
 * where it is the active card and is logged from the action bar like anything
 * else. Scanning the whole day there would take the bar's own log out of the
 * bar's own undo stack and leave it unreachable from anywhere. Scanning the
 * anytime list leaves it exactly where it was logged from.
 *
 * Both callers — `app/page.tsx`, which decides whether Undo is OFFERED, and
 * `actions/log.ts`, which decides what it TAKES BACK — must be given the same
 * set. A screen offering a control the server will not act on, or hiding one it
 * would have performed, is the drift this being one function exists to prevent.
 */
export function walkWorkoutIds(items: readonly NowItem[]): ReadonlySet<string> {
  return new Set(
    items.flatMap((item) => (isWalk(item) ? [item.workout.workout.id] : [])),
  );
}

/**
 * The day's logs with the walk's rows removed — what `/`'s undo stack acts on.
 *
 * Meals are passed through untouched rather than copied out: there is no such
 * thing as a walk in `meal_logs`, and a filter over that array would be a line
 * whose condition is never false.
 */
export function withoutWalks(logs: DayLogs, ids: ReadonlySet<string>): DayLogs {
  return {
    meals: logs.meals,
    workouts: logs.workouts.filter((log) => !ids.has(log.workoutId)),
  };
}

/** What the walk's row draws about itself. `null` until the walk is logged. */
export type WalkEntryView = { durationMin: number | null };

/**
 * What is recorded against each of the day's walks, keyed by TEMPLATE ENTRY id.
 *
 * A map rather than a single answer, for the reason `walkWorkoutIds` is a set:
 * nothing forbids two walk entries on one weekday, and a function that returned
 * "the walk's duration" would hand the same figure to both rows — the second
 * showing the first's minutes, with no way for a reader to tell. The seed
 * schedules one; the shape that only works for one is the one that fails
 * silently if that changes.
 *
 * Keyed by the entry rather than the workout because the entry is what a row
 * holds and what a write names — `resolve-training.ts` gives the reason: a
 * rotated day's workout changes with the date, so the entry is the stable name.
 *
 * A missing key is "not logged yet", which is also the answer for a plan with no
 * walk on it; the row does not need to tell those apart, because it is rendered
 * from the ITEM being present in the day's `anytime` list and this says only
 * what state that item is in.
 *
 * The status is deliberately not carried. `logWalk` writes exactly one —
 * 'done' — so a status here would be a field with one value that a screen could
 * still branch on, and the branch would be dead code pretending to be a
 * decision. A walk that did not happen is a walk with no row.
 */
export function walkEntries(
  items: readonly NowItem[],
  logs: readonly WorkoutLog[],
): ReadonlyMap<string, WalkEntryView> {
  const byWorkout = new Map(logs.map((log) => [log.workoutId, log]));
  const entries = new Map<string, WalkEntryView>();

  for (const item of items) {
    if (!isWalk(item)) continue;

    const log = byWorkout.get(item.workout.workout.id);

    if (log) entries.set(item.workout.entryId, { durationMin: log.durationMin });
  }

  return entries;
}

/**
 * The durations the row offers, in minutes.
 *
 * PRD § Persona has the walk at "30–45 minutes every day including weekends",
 * and 60 is there for the day that ran long. Presets rather than the numeric
 * field `/training` gives a session, because the criterion attached to this
 * feature is ONE TAP: a keyboard between the tap and the row would be a second
 * question asked of someone who has just come in from a walk, and § Progressive
 * Disclosure's answer to "one question per screen" is not to ask the optional
 * one at all until the first is answered.
 *
 * The bound they have to stay inside is `MAX_DURATION_MIN`, which
 * `session-entry.ts`'s `parseDuration` enforces on the way in regardless of what
 * is listed here — the presets are what the screen offers, not what the action
 * trusts.
 */
export const WALK_PRESETS: readonly number[] = [30, 45, 60];
