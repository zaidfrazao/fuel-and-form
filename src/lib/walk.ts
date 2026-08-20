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
 * What is recorded against the day's walk, for the row that renders it.
 *
 * `null` covers both "no walk on this plan" and "not logged yet", which the row
 * does not need to tell apart: it is rendered from the ITEM being present in the
 * day's `anytime` list, and this answers only what the item's state is.
 *
 * The status is deliberately not carried. `logWalk` writes exactly one —
 * 'done' — so a status on this type would be a field with one value that a
 * screen could still branch on, and the branch would be dead code pretending to
 * be a decision. A walk that did not happen is a walk with no row.
 */
export function walkEntryFor(
  items: readonly NowItem[],
  logs: readonly WorkoutLog[],
): WalkEntryView | null {
  const ids = walkWorkoutIds(items);
  const log = logs.find((row) => ids.has(row.workoutId));

  return log ? { durationMin: log.durationMin } : null;
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
