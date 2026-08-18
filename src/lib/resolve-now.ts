import type { MealSlot } from "./db/schema";
import {
  type CalendarDate,
  minutesOfDayIn,
  parseTimeOfDay,
  type TimeOfDay,
  todayIn,
} from "./date";
import { type Plan, type ResolvedMeal, resolveDay } from "./resolve-plan";
import { type ResolvedWorkout, resolveTraining, type TrainingPlan } from "./rotation";

/**
 * "Right Now" resolution — which item of the day is the active one.
 *
 * P1 is the screen the app exists for, and this is the question it asks: given
 * the plan, the configured slot times and the instant, what is happening now,
 * and what is next? Everything here is that question; the plan itself is
 * `resolve-plan.ts` and the training is `rotation.ts`, and neither rule is
 * restated below.
 *
 * ## Windows, and why they are half-open
 *
 * Each slot has a START time, from `profiles.slot_times`. The active item is the
 * one whose window contains the clock, and a window runs from its own start up
 * to — but not including — the next one: `[start_i, start_i+1)`. So the instant
 * lunch begins, lunch is active and breakfast is not. The alternative, picking
 * the NEAREST start, would make the second half of every window show the next
 * meal, which is the view being wrong at 15:00 about a snack at 16:00.
 *
 * ## Manual advance is a cursor, not a count
 *
 * The PRD's guarantee is that the view "is never wrong for longer than one tap".
 * The tap moves past the active item without logging anything, so resolution
 * needs to know where the taps have got to. A COUNT of taps would be wrong an
 * hour later: skip lunch at 12:00 and the count says "one past breakfast", but
 * once 13:00 arrives the clock says lunch and the count pushes it to a snack —
 * one tap, two items skipped. A cursor naming the item advanced past cannot
 * double-count, because `max(clock, cursor)` is the same answer no matter how
 * many times the clock catches up with it.
 *
 * The cursor carries the date it was set on, so it expires at the day boundary
 * with nothing having to clear it, and it names an item rather than an index, so
 * a swap that changes the day's shape underneath it cannot silently shift which
 * item it means.
 *
 * ## Pure, and the clock is an argument
 *
 * `now` is required — there is no `new Date()` default anywhere in this file,
 * unlike `todayIn`. A view whose correctness is entirely about what time it is
 * cannot be tested through a clock it reads for itself, and the one place that
 * genuinely knows the instant is the request. Same contract as the two resolvers
 * underneath: no database access, no `user_id`, no `server-only`, and only TYPE
 * imports from the schema, so P1's card can import this without pulling
 * Drizzle's pg-core into the bundle.
 *
 * ## What it does not do
 *
 * It does not log, and it does not know what has been logged. Advancing past an
 * item is not a claim that the item happened — the PRD's skip "advances without
 * logging completion, and records the skip", and the recording is the caller's,
 * one write, somewhere with a database. Keeping logs out is also what makes the
 * resolution reproducible: the same instant and the same plan give the same view
 * on the day, the next morning, and in a test.
 */

/**
 * When each slot starts, and where in the world.
 *
 * `slotTimes` is `profiles.slot_times` as stored, and `workoutTimes` is keyed by
 * `workouts.type`. Both are partial by design — a slot or a type with no time is
 * not scheduled, and lands in `anytime` rather than being forced into a window
 * it has no basis for.
 */
export type Schedule = {
  /** IANA zone from `profiles.timezone`. The day boundary and the clock. */
  timeZone: string;
  slotTimes: Partial<Record<MealSlot, TimeOfDay>>;
  /**
   * Keyed by `workouts.type`, which the schema keeps as text precisely so a
   * future 'strength' needs no migration. An unrecognised type therefore has to
   * mean something sane here: it means unscheduled, which is the same answer the
   * walk gets, and not a crash on the one screen the app exists for.
   *
   * `Partial` states that in the type. A bare `Record<string, TimeOfDay>` claims
   * every string maps to a time, so `schedule.workoutTimes[type]` typechecks as
   * a `TimeOfDay` and the `at === undefined` branch in `buildTimeline` reads as
   * dead code — the one branch that keeps the open vocabulary from throwing.
   */
  workoutTimes: Partial<Record<string, TimeOfDay>>;
};

/**
 * The PRD § P1 table, as data.
 *
 * `extra` is the 06:00 coffee and MCT oil — the first thing in the day, which is
 * why the timeline cannot be ordered by `SLOT_ORDER`, where `extra` is last.
 *
 * The PRD's table lists two snacks, at 10:30 and 16:00, and the schema has one
 * `snack` slot for both. One time is the honest reduction of that today: a
 * second snack does not currently resolve at all (FUEL-55), and when it does it
 * shares this window — two items at 10:30, which the timeline already orders and
 * manual advance already walks through, one tap each.
 *
 * These are DEFAULTS, not the contract. The times below are the routine as
 * confirmed in FUEL-21, which closed PRD Open Question 3; the acceptance
 * criterion attached to them is that they are editable in settings, and what
 * makes that possible is that nothing below reads this constant.
 */
export const DEFAULT_SLOT_TIMES: Readonly<Record<MealSlot, TimeOfDay>> = {
  extra: "06:00",
  breakfast: "07:30",
  snack: "10:30",
  lunch: "12:30",
  dinner: "18:30",
};

/**
 * When training happens, by workout type.
 *
 * 06:30 puts the session inside the morning routine, between the 06:00 coffee
 * and breakfast at 07:30 — which is the ordering the timeline then produces,
 * and the reason `buildTimeline` sorts by the clock rather than by kind. The
 * PRD's original 17:30 was one of the figures Open Question 3 marked "to
 * confirm", and FUEL-21 confirmed it wrong: it fell inside a work block.
 *
 * The walk is deliberately absent. The PRD's table gives it "any time (logged,
 * not scheduled)", and it is on the template every single day — pinning it to a
 * window would make it the active item every evening, displacing dinner on the
 * five days that also have a real session.
 */
export const DEFAULT_WORKOUT_TIMES: Readonly<Record<string, TimeOfDay>> = {
  circuit: "06:30",
  intervals: "06:30",
};

/**
 * Merges stored times over defaults, dropping the keys cleared to `null`.
 *
 * The three states a stored key can be in, resolved into the two a `Schedule`
 * has. Absent takes the default; a time overrides it; and `null` — which only
 * settings writes — removes the key entirely, so the slot has NO time and lands
 * in `anytime` rather than in a window it was explicitly denied.
 *
 * `null` cannot simply be spread over the default, because `{ lunch: null }`
 * spread onto the defaults leaves the KEY present holding `null`, and
 * `schedule.slotTimes[slot]` is then `null` rather than `undefined` —
 * `buildTimeline` tests `at === undefined`, so the slot would fall through to
 * `parseTimeOfDay(null)` and throw on the one screen that has to render.
 *
 * ## Why the whole argument is guarded, and not just its values
 *
 * `jsonb NOT NULL` forbids a SQL NULL and permits a JSON one: `slot_times` can
 * hold the scalar `'null'::jsonb`, and so can an object, a string or a number.
 * The column's TypeScript type says otherwise, but a type is a claim about what
 * the app writes, not about what the row contains — and this row is reachable
 * by a hand-run migration, a seed script, or `psql`.
 *
 * That distinction is load-bearing here because iterating is less forgiving
 * than spreading. `{ ...null }` is `{}`, so the merge this replaced tolerated a
 * JSON null silently; `Object.entries(null)` throws, which would have turned
 * the same row into a 500 on `/` — a regression introduced by fixing the other
 * one. A non-object means "nothing configured", which is what an empty column
 * means anyway, and the day still renders.
 */
function mergeTimes<K extends string>(
  defaults: Readonly<Partial<Record<K, TimeOfDay>>>,
  stored: Readonly<Partial<Record<K, TimeOfDay | null>>> | null | undefined,
): Partial<Record<K, TimeOfDay>> {
  const merged: Partial<Record<K, TimeOfDay>> = { ...defaults };

  // Arrays and strings are objects and iterable by `Object.entries`, but their
  // keys are numeric indices, so they contribute nothing a slot name matches
  // and drop out below. Only the throw needs guarding against.
  if (typeof stored !== "object" || stored === null) return merged;

  for (const [key, time] of Object.entries(stored) as [K, TimeOfDay | null][]) {
    // Anything that is not a string is treated as "no time", for the same
    // reason the whole argument is: a number or a nested object here would
    // reach `parseTimeOfDay` and throw, and an unscheduled slot is the
    // degradation that keeps the screen up.
    if (typeof time === "string") merged[key] = time;
    else delete merged[key];
  }

  return merged;
}

/**
 * A schedule from a profile row, with the defaults filling the gaps.
 *
 * `slot_times` and `workout_times` are free-shaped JSON that start out empty, so
 * an absent key means "not configured yet" rather than "deliberately
 * unscheduled", and P1 has to render something on day one. Settings (FUEL-21)
 * is what distinguishes the two: a field cleared there writes an explicit
 * `null`, which `mergeTimes` removes rather than defaults — the way this file
 * previously had no way to express.
 *
 * `workoutTimes` widens the defaults rather than replacing them, so a type the
 * profile says nothing about keeps its default window, and one the profile
 * clears loses it. An unrecognised type still resolves to `undefined` and lands
 * in `anytime`, which is what keeps the open `workouts.type` vocabulary safe
 * here.
 */
export function scheduleFor(profile: {
  timeZone: string;
  slotTimes: Partial<Record<MealSlot, TimeOfDay | null>>;
  workoutTimes?: Record<string, TimeOfDay | null>;
}): Schedule {
  return {
    timeZone: profile.timeZone,
    slotTimes: mergeTimes(DEFAULT_SLOT_TIMES, profile.slotTimes),
    workoutTimes: mergeTimes(DEFAULT_WORKOUT_TIMES, profile.workoutTimes ?? {}),
  };
}

/** A meal or a session, with what resolved it. The union P1's card renders. */
export type NowItem =
  | { kind: "meal"; meal: ResolvedMeal }
  | { kind: "workout"; workout: ResolvedWorkout };

/**
 * An item with a place on the clock.
 *
 * `at` is kept alongside `minutes` because both have a caller: the card shows
 * "13:00" and the resolution compares integers, and deriving either from the
 * other at the point of use would put a parse or a format in a render.
 */
export type ScheduledItem = NowItem & {
  /**
   * Stable identity, and what the cursor names.
   *
   * Built from the ENTRY id, never the meal or workout id: a swap changes which
   * meal a slot holds while leaving the entry alone, so an item keyed by meal
   * would look like a different item after a swap and lose the cursor pointing
   * at it. Two entries in one slot — the two snacks — are two entry ids, so they
   * stay distinguishable.
   */
  key: string;
  at: TimeOfDay;
  /** `at` as minutes since local midnight, in the schedule's zone. */
  minutes: number;
};

/** An item with no window: the daily walk, and any slot with no time set. */
export type AnytimeItem = NowItem & { key: string };

/**
 * Everything true of the day regardless of where it has got to.
 *
 * Exported because `positionAt` takes one, and P1's card holds one across an
 * optimistic advance: the day's shape does not change when a tap moves the
 * cursor, only the position within it does.
 */
export type NowViewBase = {
  /** The date in the configured timezone, which is the day being resolved. */
  date: CalendarDate;
  /** The clock, as minutes since local midnight. */
  minutesOfDay: number;
  /** Everything with a window, in the order the day happens. */
  timeline: ScheduledItem[];
  /** Loggable whenever — offered alongside the active card, never as it. */
  anytime: AnytimeItem[];
};

/**
 * Where the day has got to.
 *
 * Three states, and the distinction between them is only ever "is there an
 * active item, and if not, why not" — a union rather than a nullable `active`
 * field so the day-complete summary and the nothing-planned case cannot be
 * rendered by accident from the same branch.
 */
export type NowView = NowViewBase &
  (
    | {
        state: "active";
        /** Index of `active` in `timeline`. */
        index: number;
        active: ScheduledItem;
        /**
         * Everything after `active`, in order. P1 shows the next two; the slice
         * is the view's, because "two" is a layout decision and this is not the
         * layout.
         */
        upcoming: ScheduledItem[];
      }
    | { state: "day-complete" }
    | { state: "nothing-planned" }
  );

/**
 * How far the manual advance has got, and on which day.
 *
 * Held by the caller — a URL parameter, a cookie, a `useState` — and handed back
 * on the next resolution. It is not persisted anywhere near the plan: it is a
 * fact about one person looking at one screen on one day, and the day boundary
 * is where it stops meaning anything.
 */
export type Cursor = {
  date: CalendarDate;
  /** The `key` of the item advanced past. */
  advancedPast: string;
};

export type NowInput = {
  plan: Plan;
  training: TrainingPlan;
  schedule: Schedule;
  /** The instant. Required — see the module comment. */
  now: Date;
  /** The manual advance so far, if any. */
  cursor?: Cursor | null;
};

const mealKey = (meal: ResolvedMeal) => `meal:${meal.entryId}`;

const workoutKey = (workout: ResolvedWorkout) => `workout:${workout.entryId}`;

/** An item and its start time, before the two buckets are known. */
type Candidate = { item: NowItem; key: string; at: TimeOfDay | undefined };

/**
 * The day's items, split by whether they have a window, and ordered.
 *
 * Exported because P2's day view wants the same list without the clock, and
 * because it is the half of the resolution worth reading on its own: the
 * ordering, and the two ways an item ends up unscheduled.
 */
export function buildTimeline(
  plan: Plan,
  training: TrainingPlan,
  schedule: Schedule,
  date: CalendarDate,
): { timeline: ScheduledItem[]; anytime: AnytimeItem[] } {
  // Meals first, then training, which is the order a tie between the two breaks
  // in. Both halves keep the order their own resolver returned.
  const candidates: Candidate[] = [
    ...resolveDay(plan, date).map(
      (meal): Candidate => ({
        item: { kind: "meal", meal },
        key: mealKey(meal),
        at: schedule.slotTimes[meal.slot],
      }),
    ),
    ...resolveTraining(training, date).map(
      (workout): Candidate => ({
        item: { kind: "workout", workout },
        key: workoutKey(workout),
        at: schedule.workoutTimes[workout.workout.type],
      }),
    ),
  ];

  const scheduled: ScheduledItem[] = [];
  const anytime: AnytimeItem[] = [];

  for (const { item, key, at } of candidates) {
    if (at === undefined) anytime.push({ ...item, key });
    else scheduled.push({ ...item, key, at, minutes: parseTimeOfDay(at) });
  }

  // Ordered by the clock, ties broken by the order the resolvers gave — which is
  // SLOT_ORDER then sort_order for meals, and sort_order then id for workouts.
  //
  // The tie-break is an explicit ordinal rather than a reliance on `sort` being
  // stable. It is, since ES2019, but the two snacks sharing a window is a real
  // case here rather than a hypothetical one, and a total comparator says so
  // where a comment about engine guarantees would have to be believed.
  const timeline = scheduled
    .map((item, ordinal) => ({ item, ordinal }))
    .sort((a, b) => a.item.minutes - b.item.minutes || a.ordinal - b.ordinal)
    .map(({ item }) => item);

  return { timeline, anytime };
}

/**
 * The index of the item whose window contains `minutesOfDay`.
 *
 * Two edges, both of which the PRD names by implication:
 *
 *   - BEFORE the first start, it clamps to the first item. At 05:00 the honest
 *     answer is "nothing yet", but the view P1 promises is a single dominant
 *     card, and the first thing in the day with its own start time on it is a
 *     better answer than an empty screen with an explanation.
 *   - Where several items share a start — the two snacks — it returns the FIRST
 *     of them. The clock cannot distinguish them, so manual advance is what
 *     walks through the group, one tap each, which is the same mechanism it uses
 *     everywhere else.
 */
function clockIndex(timeline: ScheduledItem[], minutesOfDay: number): number {
  let latestStarted: number | null = null;

  // Ascending, so the last start that has passed is the greatest one that has.
  for (const item of timeline) {
    if (item.minutes <= minutesOfDay) latestStarted = item.minutes;
  }

  if (latestStarted === null) return 0;

  return timeline.findIndex((item) => item.minutes === latestStarted);
}

/**
 * How far the cursor has pushed the day, as an index into `timeline`.
 *
 * Zero — no advance — in all three of the ways a cursor can stop applying: there
 * is none, it was set on another date, or it names an item the day no longer
 * has. The last is what makes it safe against a swap: a cursor pointing at
 * something gone falls back to the clock rather than to a neighbour it was never
 * about.
 */
function cursorIndex(
  timeline: ScheduledItem[],
  date: CalendarDate,
  cursor: Cursor | null | undefined,
): number {
  if (!cursor || cursor.date !== date) return 0;

  // -1 for a key the day no longer holds, and -1 + 1 is no advance at all.
  return timeline.findIndex((item) => item.key === cursor.advancedPast) + 1;
}

/**
 * What is happening now.
 *
 * The date and the clock both come from the CONFIGURED zone, through the one
 * formatter in `date.ts`, which is the PRD's "day boundary respects the
 * configured timezone, not the server's" — the criterion that cannot be
 * satisfied halfway, because a date from one zone and a clock from another is a
 * view that is wrong twice.
 *
 * Weekends need no branch here. The training template puts only the walk on
 * Saturday and Sunday, so `resolveTraining` returns walk-only and the walk is
 * unscheduled: the weekend resolves to meals plus a walk that can be logged
 * whenever, without this file knowing which days are weekends.
 */
export function resolveNow({ plan, training, schedule, now, cursor }: NowInput): NowView {
  const date = todayIn(schedule.timeZone, now);
  const minutesOfDay = minutesOfDayIn(schedule.timeZone, now);
  const { timeline, anytime } = buildTimeline(plan, training, schedule, date);

  // `max`, so the clock catching up with a tap changes nothing: one tap is one
  // item, however long ago it was tapped.
  return positionAt(
    { date, minutesOfDay, timeline, anytime },
    Math.max(clockIndex(timeline, minutesOfDay), cursorIndex(timeline, date, cursor)),
  );
}

/**
 * The day, viewed from one position in its timeline.
 *
 * The three states and the rules that separate them, in one place. `resolveNow`
 * computes a position from the clock and the cursor and calls this; P1's card
 * calls it again with an OPTIMISTIC position, so a tap can advance the screen on
 * the current frame without waiting for the server (FUEL-19).
 *
 * That second caller is the reason this is exported rather than inlined above.
 * The client cannot advance without deciding what "advanced" looks like — is the
 * next item active, or is the day complete? — and a copy of that decision living
 * in a component would be free to drift from this one, silently, in exactly the
 * case that is hardest to notice: the last item of the day. One rule, one place,
 * and the coverage gate on this file measures it once.
 *
 * The position is clamped at zero rather than trusted. It arrives from a
 * `useOptimistic` reducer over data that can change underneath it, and a
 * negative index would index the timeline into `undefined` — a crash on the one
 * screen the app exists for, in place of a view that is merely early.
 */
export function positionAt(base: NowViewBase, index: number): NowView {
  // Before `program_start_date`, on a date the template does not cover, and on a
  // day whose every item is unscheduled. Ordinary states of the data, all three,
  // and the walk in `anytime` is still there to be logged.
  if (base.timeline.length === 0) return { ...base, state: "nothing-planned" };

  // Only the cursor reaches here: the last window has no end, so the clock alone
  // runs it to midnight and the date rolls over instead. Advancing past the last
  // item is therefore the deliberate "I'm done" — which is what makes it a state
  // and not a timeout someone has to configure.
  if (index >= base.timeline.length) return { ...base, state: "day-complete" };

  const position = Math.max(0, index);

  return {
    ...base,
    state: "active",
    index: position,
    active: base.timeline[position]!,
    upcoming: base.timeline.slice(position + 1),
  };
}

/**
 * Where a view sits in its own timeline, including when nothing is active.
 *
 * Day-complete is one past the end, which is the position that produced it, and
 * nothing-planned is zero of zero. Having a number for all three states is what
 * lets the optimistic card advance from any of them without a branch per state.
 */
export function positionOf(view: NowView): number {
  return view.state === "active" ? view.index : view.timeline.length;
}

/**
 * The cursor that moves past whatever is active now.
 *
 * Returns the cursor rather than a view, so the caller decides where it lives —
 * and returns `null` when there is nothing to advance past, which is the two
 * states that already have no active item. Nothing is written and nothing is
 * logged; advancing is a statement about what the screen should show.
 */
export function advance(view: NowView): Cursor | null {
  if (view.state !== "active") return null;

  return { date: view.date, advancedPast: view.active.key };
}

/**
 * The cursor that steps one item BACK — what undo asks for.
 *
 * `null` here means "no cursor at all", not "nothing to do": stepping back to
 * the first item of the day is expressed by having advanced past nothing, and
 * the caller clears the cookie rather than writing one. That is the opposite
 * sense to `advance`'s `null`, which is genuinely "there is nothing to advance
 * past" — the asymmetry is why they are two functions and not one signed step.
 *
 * Works from a day-complete view as well as an active one, because undoing the
 * last log of the day is exactly the case that has no active item to read.
 *
 * ## What this does not promise
 *
 * `resolveNow` takes `max(clock, cursor)`, so a cursor that steps back BEHIND
 * the clock changes nothing on screen. Undo seconds after a tap — the case that
 * actually happens — is unaffected, because the clock has not moved. Undoing
 * something logged hours ago removes the row and leaves the card where the clock
 * says it belongs. That is deliberate: a cursor able to drag the view backwards
 * past the clock would let one stale tap make the screen wrong for the rest of
 * the day, which is the failure this file's whole cursor design exists to avoid.
 */
export function retreat(view: NowView): Cursor | null {
  // The item to bring back, which is the one before wherever the view sits.
  const target = positionOf(view) - 1;

  if (target <= 0) return null;

  return { date: view.date, advancedPast: view.timeline[target - 1]!.key };
}
