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
 * 5. Every one of today's walks already has a `workout_logs` row. One more.
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
  /**
   * The walks with no row against them, named, in the day's own order —
   * FUEL-98.
   *
   * The sentence names them (`reminderStatement`), so the query that knows which
   * they are is the one that has to say. Never empty: an empty list is not a
   * reminder, and this whole value is `undefined` in that case.
   */
  outstanding: readonly string[];
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

  const outstanding = await unloggedWalks(s, today, profile.programStartDate);

  return outstanding.length > 0 ? { at, outstanding } : undefined;
}

/**
 * Which of `date`'s planned walks have no row against them — stages 4 and 5,
 * extracted. Names, in the day's own order.
 *
 * Exported for FUEL-47's scheduled job, which asks the same question about the
 * same day from a place with no request and no session. The extraction is the
 * point rather than a saving: P9's two layers must agree about what "the walk is
 * unlogged" MEANS, and two copies of "find today's walk workouts, then look for
 * a log" would drift the first time one of them learned about a new kind of
 * walk entry. A notification that arrived about a walk the banner did not
 * mention — or the reverse — is the failure this shape rules out.
 *
 * EMPTY for every reason there is nothing to say, exactly as `loadWalkReminder`
 * collapses its five: before the program began, no walk planned today, or every
 * walk already logged. All three mean the same thing to both callers.
 *
 * ## Every, not any — the bug FUEL-98 found here
 *
 * This asked whether ANY of the day's walks had a row, and answered "nothing
 * outstanding" if one did. That was indistinguishable from correct while there
 * was one walk. With two it is the ticket's own defect repeating a layer up: a
 * morning walk logged at 10:30 bought silence for the evening about an
 * afternoon walk nobody took, and the banner P9 exists for would never have
 * appeared on the day it was most needed.
 *
 * One statement still, and still a single indexed read — the difference is that
 * the logged ids are subtracted from the planned ones rather than merely
 * counted. `selectOne` became `select` and nothing else about the cost changed:
 * a day holds two walks, so the row count is bounded by the template.
 *
 * ## Why names and not ids
 *
 * Because the sentence names them, and the workout row is where a name lives.
 * Returning ids would put a second read in both callers to turn them back into
 * words, and the two would then be free to disagree about the order they were
 * listed in — which is the drift the whole extraction is against.
 */
export async function unloggedWalks(
  s: ReturnType<typeof scope>,
  date: CalendarDate,
  programStartDate: CalendarDate,
): Promise<string[]> {
  // Before the program began there is no plan at all, which is what
  // `resolveTraining` answers for such a date. Checked here rather than left to
  // the template read, which would otherwise happily match a weekday row on a
  // date the resolver renders as empty.
  if (date < programStartDate) return [];

  const walks = await walksFor(s, date);

  if (walks.length === 0) return [];

  const logs = await s.select(
    schema.workoutLogs,
    and(
      eq(schema.workoutLogs.date, date),
      inArray(
        schema.workoutLogs.workoutId,
        walks.map((walk) => walk.id),
      ),
    ),
  );

  const logged = new Set(logs.map((log) => log.workoutId));

  return walks.flatMap((walk) => (logged.has(walk.id) ? [] : [walk.name]));
}

/**
 * Every walk the template trains on `date` — its id and its name, in the order
 * the template puts them.
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
 *
 * ## Ordered by `sort_order`, and the reason is the sentence
 *
 * Two walks since FUEL-98, and the banner lists whichever are outstanding. A
 * list whose order came out of Postgres unbidden would name them one way this
 * evening and the other way tomorrow, for no reason a reader could see. The
 * template already configures the order — the morning walk is 1 and the
 * afternoon walk is 2, exactly as `resolveTraining` reads them for the screen —
 * so it is sorted by the same key here, ties broken by id so the comparator is
 * total.
 *
 * This does NOT go through `resolveTraining`. That resolver takes a whole
 * `TrainingPlan` and answers rotation, which is a page's worth of reading to
 * order two rows this module has already fetched — and a walk names a fixed
 * `workout_id` outright, so there is no rotation here to resolve.
 */
async function walksFor(
  s: ReturnType<typeof scope>,
  date: CalendarDate,
): Promise<{ id: string; name: string }[]> {
  const [walks, entries] = await Promise.all([
    s.select(schema.workouts, eq(schema.workouts.type, WALK_TYPE)),
    s.select(
      schema.trainingTemplateEntries,
      eq(schema.trainingTemplateEntries.dayOfWeek, dayOfWeek(date)),
    ),
  ]);

  if (walks.length === 0) return [];

  const byId = new Map(walks.map((walk) => [walk.id, walk]));

  // `workoutId` is null on a row that names a rotation group instead, and a
  // rotation group is never a walk — the seed gives each walk a fixed workout
  // on every day it appears, because there is nothing for it to alternate with.
  // So a null here is a session's row and is skipped by the same test that
  // skips another workout's.
  const seen = new Set<string>();

  return entries
    .flatMap((entry) => {
      const walk = entry.workoutId === null ? undefined : byId.get(entry.workoutId);

      return walk ? [{ entry, walk }] : [];
    })
    .sort(
      (a, b) =>
        a.entry.sortOrder - b.entry.sortOrder || (a.walk.id < b.walk.id ? -1 : 1),
    )
    .flatMap(({ walk }) => {
      // Deduplicated by WORKOUT, because the sentence is about walks and not
      // about template rows. Nothing forbids two entries on one weekday naming
      // the same walk — the table has no unique constraint on
      // `(user_id, day_of_week, workout_id)` and could not have one — and one
      // row logs both of them anyway, the log being keyed by workout. Left in,
      // the count would be two where the day holds one walk, so the banner
      // would say "Walks not logged" about a single unlogged walk and would
      // never reach the branch that names it.
      if (seen.has(walk.id)) return [];

      seen.add(walk.id);

      return [{ id: walk.id, name: walk.name }];
    });
}
