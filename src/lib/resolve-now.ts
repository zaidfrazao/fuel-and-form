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
   */
  workoutTimes: Record<string, TimeOfDay>;
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
 * These are DEFAULTS, not the contract. The PRD marks the table "to confirm",
 * and its acceptance criterion is that the times are editable in settings; what
 * makes that possible is that nothing below reads this constant.
 */
export const DEFAULT_SLOT_TIMES: Readonly<Record<MealSlot, TimeOfDay>> = {
  extra: "06:00",
  breakfast: "07:00",
  snack: "10:30",
  lunch: "13:00",
  dinner: "19:00",
};

/**
 * When training happens, by workout type.
 *
 * The walk is deliberately absent. The PRD's table gives it "any time (logged,
 * not scheduled)", and it is on the template every single day — pinning it to a
 * window would make it the active item every evening, displacing dinner on the
 * five days that also have a real session.
 */
export const DEFAULT_WORKOUT_TIMES: Readonly<Record<string, TimeOfDay>> = {
  circuit: "17:30",
  intervals: "17:30",
};

/**
 * A schedule from a profile row, with the defaults filling the gaps.
 *
 * `slot_times` is free-shaped JSON that starts out empty, so an absent slot here
 * means "not configured yet" rather than "deliberately unscheduled", and P1 has
 * to render something on day one. The limitation is the other half of that: with
 * the defaults merged in there is currently no way to say a slot has NO time.
 * Nothing needs to yet — the flexible weekend slots have no template entry to
 * schedule — and when settings can write times, a slot cleared to `null` is what
 * would express it.
 */
export function scheduleFor(profile: {
  timeZone: string;
  slotTimes: Partial<Record<MealSlot, TimeOfDay>>;
}): Schedule {
  return {
    timeZone: profile.timeZone,
    slotTimes: { ...DEFAULT_SLOT_TIMES, ...profile.slotTimes },
    workoutTimes: DEFAULT_WORKOUT_TIMES,
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

type NowViewBase = {
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

  const base = { date, minutesOfDay, timeline, anytime };

  // Before `program_start_date`, on a date the template does not cover, and on a
  // day whose every item is unscheduled. Ordinary states of the data, all three,
  // and the walk in `anytime` is still there to be logged.
  if (timeline.length === 0) return { ...base, state: "nothing-planned" };

  // `max`, so the clock catching up with a tap changes nothing: one tap is one
  // item, however long ago it was tapped.
  const index = Math.max(
    clockIndex(timeline, minutesOfDay),
    cursorIndex(timeline, date, cursor),
  );

  // Only the cursor reaches here: the last window has no end, so the clock alone
  // runs it to midnight and the date rolls over instead. Advancing past the last
  // item is therefore the deliberate "I'm done" — which is what makes it a state
  // and not a timeout someone has to configure.
  if (index >= timeline.length) return { ...base, state: "day-complete" };

  return {
    ...base,
    state: "active",
    index,
    active: timeline[index]!,
    upcoming: timeline.slice(index + 1),
  };
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
