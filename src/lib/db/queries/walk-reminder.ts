import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { type CalendarDate, dayOfWeek, minutesOfDayIn, todayIn } from "@/lib/date";
import { WALK_TYPE } from "@/lib/resolve-training";
import { isReminderDue } from "@/lib/walk-reminder";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";

/**
 * Whether this user should be looking at a walk reminder right now — FUEL-46,
 * PRD § P9.
 *
 * The banner is rendered from the root layout, so this runs on EVERY screen, on
 * every request, for as long as someone is signed in. That fact shapes the whole
 * module: the answer is assembled in stages, cheapest refusal first, and the
 * statements that cost something are only reached once the cheap ones have
 * failed to rule the banner out.
 *
 * ## The staging, and what each stage saves
 *
 * 1. No profile — no timezone, so no day and no clock. One statement.
 * 2. The reminder is switched off. Still one statement, and it is the whole of
 *    P9's "can be disabled entirely": nothing further is asked.
 * 3. It is before the reminder time in the USER's zone. Still one statement,
 *    and this is the branch most requests take — a reminder set for 19:00
 *    rules out five sixths of the day for the price of the profile row that
 *    was fetched to find the zone.
 * 4. The date is before `program_start_date`, or the template trains no walk on
 *    this weekday. Two small indexed reads, issued together.
 * 5. A `workout_logs` row exists for one of today's walks. One more.
 *
 * So an evening request costs four statements over three round trips, and every
 * other request costs one. `loadTraining` would have answered stages 4 and 5 in
 * one call and is deliberately not used: it fetches every workout, every
 * exercise row and a multi-week adherence window, which is a page's worth of
 * work to decide whether one sentence is shown above it.
 *
 * ## Why the template is consulted at all
 *
 * Because "the walk is unlogged" is only worth saying about a day the walk was
 * planned on. The seed puts it on all seven, and the PRD calls it "every day
 * including weekends" — but a template is editable, and a banner that nagged
 * about a walk nobody scheduled would be the app inventing an obligation. The
 * check is cheap here for one specific reason: walk entries name a `workout_id`
 * outright rather than a `rotation_group`, so no rotation has to be resolved to
 * know whether today holds one.
 *
 * ## Scoped, like everything else in this directory
 *
 * Every read goes through `scope()`, so `user_id` is in the WHERE clause without
 * this file naming it — a demo visitor gets their own reminder or none, and
 * never a signal about the owner's.
 */

/** What the banner draws. `undefined` when there is nothing to show. */
export type WalkReminder = {
  /** The configured time, for the sentence. Already known to be well-formed. */
  at: string;
};

/**
 * The reminder to show this user at `now`, or `undefined` for none.
 *
 * One answer for every reason there is no banner — no profile, reminder off, too
 * early, no walk planned, walk already logged — because the caller renders
 * nothing in all five cases and a distinction it cannot act on is a distinction
 * that would only ever be got wrong.
 *
 * @param now the request's instant. An argument rather than `new Date()` for
 *   `app/page.tsx`'s reason: the clock is read once, at the edge, so every layer
 *   beneath it is reproducible.
 */
export async function loadWalkReminder(
  userId: string,
  now: Date,
): Promise<WalkReminder | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  // Switched off, or the evening has not come round in the user's own zone.
  // `isReminderDue` narrows away the `null`, so `at` below needs no assertion.
  const at = profile.walkReminderAt;

  if (!isReminderDue(at, minutesOfDayIn(profile.timezone, now))) return undefined;

  const today: CalendarDate = todayIn(profile.timezone, now);

  // Before the program began there is no plan at all, which is what
  // `resolveTraining` answers for such a date. Checked here rather than left to
  // the template read, which would otherwise happily match a weekday row on a
  // date the resolver renders as empty.
  if (today < profile.programStartDate) return undefined;

  const walkIds = await walkWorkoutIdsFor(s, today);

  if (walkIds.length === 0) return undefined;

  const logged = await s.selectOne(
    schema.workoutLogs,
    and(
      eq(schema.workoutLogs.date, today),
      inArray(schema.workoutLogs.workoutId, walkIds),
    ),
  );

  return logged ? undefined : { at };
}

/**
 * The `workouts.id` of every walk the template trains on `date`.
 *
 * Empty means no banner: either this user has no walk in their library at all —
 * an account that has not been seeded — or the template does not put one on this
 * weekday.
 *
 * The two reads are issued together rather than one after the other, and that
 * is a deliberate reversal of the obvious order. Sequentially, the second is
 * skippable — a user with no walk workout has no walk entry either — which
 * saves a statement in the one case where this feature is silent anyway: an
 * account that has never been seeded. In parallel it costs that account one
 * wasted read of a small indexed table, and saves everyone else a network
 * round trip inside a layout that blocks the page shell. On a connection where
 * a round trip is tens of milliseconds, the trade is not close.
 */
async function walkWorkoutIdsFor(
  s: ReturnType<typeof scope>,
  date: CalendarDate,
): Promise<string[]> {
  const [walks, entries] = await Promise.all([
    s.select(schema.workouts, eq(schema.workouts.type, WALK_TYPE)),
    s.select(
      schema.trainingTemplateEntries,
      eq(schema.trainingTemplateEntries.dayOfWeek, dayOfWeek(date)),
    ),
  ]);

  if (walks.length === 0) return [];

  const ids = new Set(walks.map((walk) => walk.id));

  // `workoutId` is null on a row that names a rotation group instead, and a
  // rotation group is never the walk — the seed gives the walk a fixed workout
  // on every day it appears, because there is nothing for it to alternate with.
  // So a null here is a session's row and is skipped by the same test that
  // skips another workout's.
  return entries.flatMap((entry) =>
    entry.workoutId !== null && ids.has(entry.workoutId) ? [entry.workoutId] : [],
  );
}
