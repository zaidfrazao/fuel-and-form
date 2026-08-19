import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { addDays, type CalendarDate, startOfWeek, todayIn } from "@/lib/date";
import {
  type Plan,
  type ResolvedDay,
  resolveWeek,
  templateDay,
} from "@/lib/resolve-plan";
import { getDb } from "../index";
import * as schema from "../schema";
import type { Meal, Profile } from "../schema";
import { scope } from "../scope";

/**
 * One week of the plan, fetched — the weekly grid's read (FUEL-28).
 *
 * `today.ts`'s sibling, and built to the same three rules it argues in full:
 * the resolvers are pure and take their data as arguments, something impure has
 * to go and get it, and the only directory allowed to bind a scope to a handle
 * is this one. What differs is the span — seven dates rather than one — and
 * every difference below follows from that.
 *
 * ## Which week, and why the caller does not simply say
 *
 * `anchor` is any date in the wanted week, or absent for the current one. It
 * cannot default to "this week" without a timezone, and the timezone lives on
 * the profile — so the date is derived here, after the profile is in hand, from
 * `todayIn`. A caller computing it instead would be reading a clock in a zone
 * it had not looked up, which is the exact bug `todayIn` exists to prevent and
 * the one the suite pins a non-UTC zone to catch.
 *
 * `startOfWeek` then snaps the anchor to its Monday, so `?week=2026-08-19`
 * (a Wednesday) and `?week=2026-08-17` name the same seven days. That is what
 * lets the URL carry a date a human might type without the screen becoming
 * sensitive to which day of the week they picked.
 *
 * ## Two round trips, and one narrowed table
 *
 * The profile has to land before the date is known, so it goes first and
 * everything else follows in one `Promise.all` — the same two sequential waits
 * `loadToday` counts, on Neon's HTTP driver where each query is a `fetch`.
 *
 * `day_plan_overrides` is narrowed to the seven dates and the other two tables
 * are fetched whole, which is `loadToday`'s division exactly: overrides grow
 * without bound as swaps accumulate, while PRD § Assumptions has the library at
 * "ten or so recipes". Narrowing the template instead would mean deciding in
 * SQL which rows resolution is going to want, which is resolution's job.
 *
 * A BETWEEN rather than seven equality tests: the dates are contiguous by
 * construction, `calendarDate` sorts chronologically as text, and the range is
 * one predicate that cannot fall out of step with the seven dates the grid
 * renders.
 *
 * ## Why the template answer comes back too
 *
 * `templateDays` is what each date would hold with its overrides ignored — the
 * "before" half of a swap, exactly as `loadToday` returns `templatePlan` and
 * for the same reason one step wider. The grid needs it because a revert is
 * optimistic: the cell has to show what it reverts TO on the frame the sheet
 * closes, and the browser cannot derive that without the whole template, which
 * is a table a screen showing seven days has no other reason to hold.
 *
 * Resolved here from the same `Plan` the week came from, so the two answers are
 * a matched pair rather than two reads that could disagree.
 */

/** What `/plan` needs to render, resolved. */
export type Week = {
  /** The Monday the seven days start on — the week's identity in a URL. */
  monday: CalendarDate;
  /** Today in the PROFILE's timezone, so the grid can mark its one column. */
  today: CalendarDate;
  profile: Profile;
  /** The seven days, Monday first, template plus overrides. */
  days: ResolvedDay[];
  /** The same seven dates with overrides ignored — what a revert restores. */
  templateDays: ResolvedDay[];
  /** The user's whole library — the picker's candidates. */
  meals: Meal[];
};

/**
 * Resolves one week for one user.
 *
 * `undefined` means no profile row, on `loadToday`'s reasoning: a user exists
 * before it is set up, and without a timezone there is no day boundary and so
 * no week to be in. The caller renders an empty state rather than inventing a
 * zone.
 *
 * `now` is an argument for the reason it is one everywhere else in this app —
 * the request is the only thing that genuinely knows the instant, and a view
 * whose correctness is about dates should not read a clock a test cannot reach.
 */
export async function loadWeek(
  userId: string,
  now: Date,
  anchor?: CalendarDate | null,
): Promise<Week | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  const today = todayIn(profile.timezone, now);
  const monday = startOfWeek(anchor ?? today);
  const sunday = addDays(monday, 6);

  const [meals, template, overrides] = await Promise.all([
    s.select(schema.meals),
    s.select(schema.planTemplateEntries),
    s.select(
      schema.dayPlanOverrides,
      and(
        gte(schema.dayPlanOverrides.date, monday),
        lte(schema.dayPlanOverrides.date, sunday),
      ),
    ),
  ]);

  const plan: Plan = {
    programStartDate: profile.programStartDate,
    template,
    overrides,
    meals,
  };

  const days = resolveWeek(plan, monday);

  return {
    monday,
    today,
    profile,
    meals,
    days,
    // Keyed off the resolved days rather than recomputing the seven dates, so
    // the two lists are the same dates in the same order by construction.
    templateDays: days.map(({ date }) => ({ date, meals: templateDay(plan, date) })),
  };
}
