import "server-only";

import { desc, eq, lt } from "drizzle-orm";

import { type CalendarDate, todayIn } from "@/lib/date";
import type { WeighIn } from "@/lib/weigh-in";
import { getDb } from "../index";
import * as schema from "../schema";
import type { WeightLog } from "../schema";
import { scope } from "../scope";

/**
 * The weigh-in history, read and written — P5's database access (FUEL-34).
 *
 * In `lib/db/queries/` for the reason `today.ts` and `training.ts` both set out:
 * `getDb()` hands back an unscoped handle and the eslint rule makes reaching for
 * one outside `src/lib/db/` an error. A module here runs scoped statements and
 * returns ROWS — never a handle, never a `Scope` — which is what makes importing
 * one from `app/` safe.
 *
 * ## The date is the address
 *
 * `weight_logs` is unique on `(user_id, date)` and schema.ts argues why: two
 * readings on one morning are the same measurement taken twice, and "re-weighing
 * is an update". So there is no `id` in this module's vocabulary at all. A
 * weigh-in is named by its date, an edit is an upsert that collides with the row
 * it corrects, and a delete is a scoped delete at that date.
 *
 * That is what lets the screen above have ONE form rather than a create form and
 * an edit form. A separate edit form would need a mutable date, and saving it
 * onto a date that already held a weigh-in would update that row while leaving
 * the original behind — a silent duplicate of a number the whole program is
 * judged on. Here the case cannot arise: there is nothing to move, because the
 * date is not a field of the row so much as the name of it.
 *
 * ## The whole history, and where FUEL-84 bounded it
 *
 * `loadWeighIns` still fetches every row rather than a window, unlike
 * `training.ts` which narrows `workout_logs` to six weeks — because the CHART
 * renders every row. FUEL-35 asks for "the full history" by acceptance
 * criterion, and § Accessibility obliges the chart to carry "an adjacent data
 * table", which `weight-chart.tsx` does: one `<tr>` per reading, every one of
 * them. A narrowed fetch here would be a second query for the same rows, or a
 * limit the chart would have to know about and undo.
 *
 * What FUEL-84 bounded is what CROSSES to the browser, and it is bounded in
 * `app/(app)/weight/page.tsx` rather than here. Every reading goes over as a
 * date and a weight, because the chart and its table draw all of them; only the
 * newest `RECENT_WEIGH_INS` carry a `note`, because the history list is the one
 * thing that renders a note and the list is the thing that was unbounded. A
 * note is `MAX_NOTE_LENGTH` — 500 characters — so at a year of daily weighing
 * the notes are the payload, and the ones nothing draws are the ones that go.
 *
 * The rest of the history reaches the screen through `loadEarlierWeighIns` and
 * `loadWeighInOn` below, a page at a time, when the reader asks for it.
 */

/** What `/weight` needs to render. */
export type WeighInHistory = {
  /**
   * Today in the user's own zone — the form's default date, its `max`, and the
   * bound the action refuses a future weigh-in against.
   *
   * Derived here from `profiles.timezone` and the request's instant, so nothing
   * downstream reads a clock. The contract `resolve-now.ts`, `today.ts` and
   * `training.ts` all keep, and the reason the date a test asks for is the date
   * it gets.
   */
  today: CalendarDate;
  /** Every weigh-in, most recent first. */
  entries: WeightLog[];
  /**
   * `profiles.start_weight_kg` and `profiles.target_weight_kg` — FUEL-35's two
   * reference lines.
   *
   * Carried on the history rather than fetched by the chart, because the profile
   * row is already in hand: `loadWeighIns` selects it for the timezone two lines
   * up, so these are two fields off a row that has been read rather than a
   * second round trip on Neon's HTTP driver.
   *
   * They are also what the chart must never assume. P5 recalibrates the target
   * every 5kg and P7 gives the demo persona different body metrics entirely, so
   * a figure written into a component would be wrong twice over — and the
   * owner's own numbers are among the ones § Security keeps out of a public
   * repository.
   */
  startWeightKg: number;
  targetWeightKg: number;
  /**
   * `profiles.goal_pace_kg_per_week` — the figure FUEL-36's trailing rate is
   * judged against, and the first read of this column anywhere in the app.
   *
   * Here rather than written into `weight-stats.ts` for the reason the two
   * above are carried: the pace is per-user configuration, P5 recalibrates on
   * it every 5kg, and P7's demo persona cuts at its own rate. A constant in a
   * module would be the owner's own program shown to a visitor — and a band
   * that never moved when the profile did.
   */
  goalPaceKgPerWeek: number;
};

/**
 * One user's weigh-ins, newest first, with today in their own zone.
 *
 * `undefined` means the user has no profile row — the same answer, for the same
 * reason, as `loadTraining` and `loadToday`: no timezone, so no day boundary, so
 * no "today" to default the form to and no zone to refuse a future date in. Not
 * an error; the caller renders an empty state rather than inventing one.
 *
 * Two sequential waits, which is the shape that matters on Neon's HTTP driver:
 * the timezone has to exist before "today" does, and the rows do not depend on
 * it, but there are only two round trips either way.
 *
 * Ordered newest first because that is the order the screen reads in — the last
 * weigh-in is the one being checked against, and the one an edit most often
 * means. FUEL-35's chart will reverse it for a time axis, which is a display
 * concern and cheap on a list this size.
 */
export async function loadWeighIns(
  userId: string,
  now: Date,
): Promise<WeighInHistory | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  const entries = await s.select(schema.weightLogs, undefined, {
    orderBy: desc(schema.weightLogs.date),
  });

  return {
    today: todayIn(profile.timezone, now),
    entries,
    startWeightKg: profile.startWeightKg,
    targetWeightKg: profile.targetWeightKg,
    goalPaceKgPerWeek: profile.goalPaceKgPerWeek,
  };
}

/**
 * The page of weigh-ins immediately older than a date — FUEL-84's "show earlier".
 *
 * Keyset, not offset. `before` is the oldest row the screen already holds, so a
 * page is "the next `limit` rows older than that one" and it stays correct while
 * the list underneath it moves: a weigh-in deleted from the window between two
 * taps shifts every offset by one and would make the next page skip a row, and a
 * weigh-in logged for an old date would make it repeat one. Neither can happen
 * against a date, which is this table's address anyway.
 *
 * No count of what is left comes back with it, deliberately. The screen already
 * knows how many weigh-ins exist — it holds every READING for the chart — so
 * "are there earlier entries" is `readings.length > rows.length` there and does
 * not need a second answer from here that could disagree with the first.
 *
 * Newest first, matching `loadWeighIns`, so a page appends to the list the
 * screen already has rather than being merged into it.
 */
export async function loadEarlierWeighIns(
  userId: string,
  before: CalendarDate,
  limit: number,
): Promise<WeightLog[]> {
  const s = scope(userId, getDb());

  return s.select(schema.weightLogs, lt(schema.weightLogs.date, before), {
    orderBy: desc(schema.weightLogs.date),
    limit,
  });
}

/**
 * The weigh-in on one date, or `undefined` — FUEL-84's other read.
 *
 * The screen's date field addresses a weigh-in by its date, and with the history
 * bounded that date can name an entry the list has not loaded. What is missing
 * in that case is the NOTE: the chart's readings carry a date and a weight, so
 * the form can already show the reading it is about to replace, but a note it
 * could not see is a note the upsert would overwrite with an empty one. This is
 * how it sees it.
 *
 * `selectOne` without an `orderBy` is safe here where the doc on it warns
 * otherwise: `weight_logs` is unique on `(user_id, date)`, so a scoped equality
 * on the date matches at most one row and "whichever Postgres returns first" is
 * the only row there is.
 *
 * `undefined` for a date with no weigh-in AND for another user's — the same
 * answer, which is the § Security promise `removeWeighIn` sets out below.
 */
export async function loadWeighInOn(
  userId: string,
  date: CalendarDate,
): Promise<WeightLog | undefined> {
  const s = scope(userId, getDb());

  return s.selectOne(schema.weightLogs, eq(schema.weightLogs.date, date));
}

/**
 * Today in this user's zone, and nothing else — what a WRITE needs.
 *
 * The action has to refuse a future date, and "the future" is a question about
 * the user's midnight rather than the server's, so it needs the timezone. It
 * does not need the history: a save re-reads no rows, and `loadWeighIns` would
 * fetch every weigh-in the user has to answer a question about one column of
 * one row.
 *
 * Not `profile.ts`'s `loadSchedule` either, which would answer it. That function
 * carries `slot_times` and `workout_times` because settings edits them, and a
 * write path that pulled in the settings module for a timezone would make every
 * future change to the shape of settings a change that touches this action. The
 * cheaper dependency is four lines.
 *
 * `undefined` for no profile row, the contract every reader in this app keeps.
 */
export async function weighInToday(
  userId: string,
  now: Date,
): Promise<CalendarDate | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  return profile && todayIn(profile.timezone, now);
}

/**
 * Records a weigh-in, replacing the one already on that date if there is one.
 *
 * The create and the edit are one function because they are one statement. The
 * unique index on `(user_id, date)` means a correction collides with the row it
 * corrects and updates it — see schema.ts — so "log a weigh-in" and "edit a past
 * entry", the two halves of FUEL-34's first criterion, differ only in whether a
 * row happened to be there. `recordSession` makes the identical argument one
 * table across.
 *
 * `created_at` is deliberately NOT in the `set`, which is where this parts
 * company with `recordSession`'s `loggedAt: sql`now()``. The two columns mean
 * different things: `logged_at` means "when this was recorded", so a correction
 * moves it, and `latestLog` on `/` depends on that. `created_at` means when the
 * row came into existence, and a weigh-in corrected from 77.4 to 77.5 was still
 * first written when it was first written. Moving it would make the column a
 * second, worse copy of the date it already has.
 *
 * The values are already validated — `lib/weigh-in.ts` does it, in front of the
 * action, where a hand-rolled POST has to pass too.
 */
export async function recordWeighIn(userId: string, weighIn: WeighIn): Promise<void> {
  const s = scope(userId, getDb());

  await s.upsert(
    schema.weightLogs,
    {
      date: weighIn.date,
      weightKg: weighIn.weightKg,
      note: weighIn.note,
    },
    {
      // `user_id` is deliberately absent: the scope prepends it to the conflict
      // target itself, and naming it here is an error `scope.upsert` refuses by
      // name.
      target: [schema.weightLogs.date],
      set: { weightKg: weighIn.weightKg, note: weighIn.note },
    },
  );
}

/**
 * Removes the weigh-in on a date — FUEL-34's "delete any past entry".
 *
 * A hard delete, on `queries/log.ts`'s and `clearSession`'s reasoning: a
 * weigh-in that was taken back did not happen, and a soft-deleted row is a
 * filter that FUEL-35's chart and FUEL-36's trailing rate would each have to
 * remember separately. The one that forgot would draw a deleted number.
 *
 * Returns whether a row went, so the caller can tell a real delete from one that
 * raced another tab. The scoped delete matches nothing for a row that is already
 * gone AND for one that was never the caller's, which are the same answer on
 * purpose — the PRD's § Security promise, and the reason this cannot be used to
 * find out whether the owner weighed in on some date.
 */
export async function removeWeighIn(
  userId: string,
  date: CalendarDate,
): Promise<boolean> {
  const s = scope(userId, getDb());

  const removed = await s.delete(schema.weightLogs, eq(schema.weightLogs.date, date));

  return removed.length > 0;
}
