"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { deleteOverride, writeOverride, writeOverrides } from "@/lib/db/queries/swap";
import { loadWeek, type Week } from "@/lib/db/queries/week";
import type { MealSlot } from "@/lib/db/schema";
import { type CalendarDate, parseCalendarDate } from "@/lib/date";
import { repeatDates } from "@/lib/repeat";
import { isMealSlot } from "@/lib/template-plan";

/**
 * Swapping, repeating and reverting on ANY date — the weekly grid's writes
 * (FUEL-28).
 *
 * ## Why this is not three more exports on `actions/swap.ts`
 *
 * That module and this one write the same table through the same two query
 * functions, so the temptation to merge them is real. What separates them is
 * how a slot is ADDRESSED, and the difference is not cosmetic:
 *
 *   - `swap.ts` takes a `key` naming an item in TODAY'S resolved timeline. It
 *     routes every action through a private `today()` helper — `loadToday` plus
 *     the cursor — so the date is never an argument at all. It cannot name
 *     another day, and that is a property of the module rather than an
 *     oversight: the card it serves is the one thing happening now.
 *   - This module takes a `date` and a `slot`. Both come off the wire, so both
 *     are validated here, and the date is the whole point — the grid's cells
 *     are dates a user is looking at, most of which are not today.
 *
 * Adding a date parameter to `swapMeal` would make `today()` conditional in a
 * file whose every guarantee assumes it, and would leave one function serving
 * two screens whose refusals differ. Two modules, one query layer underneath,
 * and the acceptance criterion that matters holds in both by construction:
 * `queries/swap.ts` names `day_plan_overrides` and has no statement capable of
 * touching `plan_template_entries`.
 *
 * ## The three checks every write here runs
 *
 * A Server Action is a public endpoint. Everything below is reachable by anyone
 * who can POST to this app, so nothing arriving as an argument is trusted:
 *
 *   1. **The session**, resolved on this side from the cookie, never taken from
 *      the caller. Every statement is scoped to that identity.
 *   2. **The address** — `parseCalendarDate` rejects a malformed date and
 *      `isMealSlot` rejects a slot the enum does not have. Both already exist
 *      and are gated at 100% for exactly this reason.
 *   3. **The meal**, looked up in the caller's OWN library and refused when it
 *      is archived. `meal-picker.tsx` filters archived rows from the tiles, but
 *      a rendering decision is not a rule until the write path agrees with it —
 *      `actions/swap.ts` argues this at length and this module applies the same
 *      rule to a different date.
 *
 * Underneath all three, the composite foreign key `(meal_id, user_id)` means
 * Postgres refuses another user's meal regardless of what any caller checked.
 *
 * ## Every action answers rather than throwing
 *
 * `{ ok: false }` and a banner, never an exception — the contract `swap.ts` and
 * `log.ts` both keep, and the reason the grid can offer "Try again" at all.
 */

/** What the grid renders from. Success carries nothing — see § Feedback. */
export type PlanResult = { ok: boolean };

const DONE: PlanResult = { ok: true };
const FAILED: PlanResult = { ok: false };

/**
 * The week a date falls in, and whose week it is.
 *
 * `undefined` for no session, no profile row, or a date this app will not act
 * on. One answer for all three, on `login/actions.ts`'s reasoning: a caller who
 * could tell them apart learns something about the deployment for nothing.
 *
 * The week rather than the day, because `loadWeek` is the read this screen
 * already makes and it returns the three things every action here needs — the
 * resolved slot, the library to check the meal against, and the user id the
 * write is scoped to. Fetching a week's overrides to write one is the same
 * query the grid ran a moment ago, against a table narrowed to seven dates.
 *
 * The user id is returned alongside rather than read again at the write, so
 * every statement runs against the identity resolved once, at the top.
 */
async function planFor(
  date: CalendarDate,
): Promise<{ userId: string; week: Week } | undefined> {
  const session = await getSession();

  if (!session) return undefined;

  // Before anything is fetched. `parseCalendarDate` throws on a malformed date
  // and the catch in every caller would turn that into `{ ok: false }` anyway —
  // but it would do so after a round trip to Postgres, and a refusal that costs
  // a query is a refusal an attacker can use to make the database work.
  parseCalendarDate(date);

  const week = await loadWeek(session.userId, new Date(), date);

  return week && { userId: session.userId, week };
}

/**
 * Whether a date is one this plan can hold anything on.
 *
 * `resolveSlot` checks `program_start_date` FIRST, before it consults overrides
 * — so a row written to an earlier date is stored and then never resolves. It
 * would not appear on the grid, would not reach the export, and could not be
 * reverted through the UI, because a revert re-derives the row from what
 * resolution returns and resolution returns nothing. An orphan, in other words,
 * created by a tap that appeared to work.
 *
 * `/` could not reach this state: it addresses today, which is after the start
 * by construction. The grid is the first screen that can name an arbitrary
 * date, which is why the check has to exist here and did not before.
 *
 * Refused rather than clamped, on `repeat.ts`'s reasoning: writing to the
 * program's first day because someone asked for the week before it would be
 * answering a question nobody asked.
 */
function isScheduled(week: Week, date: CalendarDate): boolean {
  return date >= week.profile.programStartDate;
}

/** What resolution currently puts in a cell — `undefined` when nothing does. */
function cellIn(week: Week, date: CalendarDate, slot: MealSlot) {
  return week.days
    .find((day) => day.date === date)
    ?.meals.find((meal) => meal.slot === slot);
}

/**
 * A meal from the caller's own library that may still be scheduled.
 *
 * Archived rows are refused here rather than filtered, because the two are
 * different answers: filtering would silently write nothing and report success.
 */
function schedulable(week: Week, mealId: string) {
  const meal = week.meals.find((candidate) => candidate.id === mealId);

  return meal && !meal.isArchived ? meal : undefined;
}

/**
 * Writes the dated override for one cell — the grid's substitute.
 *
 * The acceptance criterion in one call, exactly as `swapMeal` makes it for
 * today: `writeOverride` touches `day_plan_overrides` and nothing else, so the
 * template is unchanged and the same weekday next week still resolves to the
 * template meal. Neither is enforced here — both are properties of the
 * statement, covered against real Postgres in tests/integration/week.test.ts.
 *
 * A cell the template leaves empty can be swapped INTO. `resolveSlot` consults
 * overrides first and unconditionally, so an override in an unplanned slot is
 * an ordinary extra meal on one date — which is why nothing here requires the
 * cell to already hold something.
 */
export async function swapOnDate(
  date: CalendarDate,
  slot: string,
  mealId: string,
): Promise<PlanResult> {
  try {
    if (!isMealSlot(slot)) return FAILED;

    const resolved = await planFor(date);

    if (!resolved) return FAILED;

    const { userId, week } = resolved;

    // Nothing is planned before the program starts, so nothing can be swapped
    // there either. No `refresh()`: the screen is already showing the empty
    // cells this refusal is about, and re-resolving would fix nothing.
    if (!isScheduled(week, date)) return FAILED;

    const meal = schedulable(week, mealId);

    // The browser's copy of the library disagrees with the database — a meal
    // archived or deleted in another tab. `refresh()` is what makes a retry
    // able to succeed, which is why this refusal has one and a malformed slot
    // does not: a bad slot says nothing about the data.
    if (!meal) {
      refresh();

      return FAILED;
    }

    await writeOverride(userId, { date, slot, mealId: meal.id });

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not swap the meal.", error);

    return FAILED;
  }
}

/**
 * The same meal on this date and the `days - 1` after it — FUEL-24, from a cell.
 *
 * One `INSERT ... ON CONFLICT`, so the run is atomic: a loop would be
 * interruptible between iterations, which is a plan half-way through a change
 * the user was told had happened. `queries/swap.ts` argues it in full.
 *
 * A run started near the end of a week SPILLS into the next one, deliberately.
 * Overrides are dated, not week-bound, and a repeat that stopped at Sunday
 * would silently write fewer days than the button named. The grid shows the
 * part of the run that falls in view; the rest is there when it is navigated
 * to.
 */
export async function repeatFromDate(
  date: CalendarDate,
  slot: string,
  mealId: string,
  days: number,
): Promise<PlanResult> {
  try {
    if (!isMealSlot(slot)) return FAILED;

    const resolved = await planFor(date);

    if (!resolved) return FAILED;

    const { userId, week } = resolved;

    // The run starts here and only moves forward, so a start on or after the
    // program start puts every date in it after the start too.
    if (!isScheduled(week, date)) return FAILED;

    const meal = schedulable(week, mealId);

    if (!meal) {
      refresh();

      return FAILED;
    }

    const dates = repeatDates(date, days);

    // Out of range, fractional, or not a number — nothing the stepper can
    // produce. No `refresh()`, unlike the refusal above: a bad count says
    // nothing about the data, so the screen is already correct and
    // re-resolving it would cost a re-render to fix nothing. `repeatMeal`
    // draws the same distinction.
    if (!dates) return FAILED;

    await writeOverrides(
      userId,
      // The validated slot and meal on every date. Neither is taken per-date —
      // there is one slot and one meal in a repeat, which is what makes it one.
      dates.map((on) => ({ date: on, slot, mealId: meal.id })),
    );

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not repeat the meal.", error);

    return FAILED;
  }
}

/**
 * Takes one cell back to the template — P2's revert, on any date.
 *
 * Nothing is restored, because nothing was overwritten: the template entry has
 * been in `plan_template_entries` the whole time and `resolveSlot` finds it
 * again the moment the override row is gone.
 *
 * ## The row id is re-derived, never accepted
 *
 * `resolve-plan.ts` returns `entryId` on every resolved meal, so the browser
 * holds it and could send it. Accepting it would mean deleting whatever uuid a
 * request named: the scope would refuse another user's row, but it would not
 * refuse this user's OTHER rows, and "delete any one of my overrides, on any
 * date" is a wider capability than a cell offers. `revertSwap` makes the same
 * choice for today, and the reasoning gets stronger here — this endpoint takes
 * a date, so a forged id would not even need to name a row from a visible week.
 *
 * A cell that is not overridden is `ok`, not a failure. The sheet offers no
 * Revert in that state, so reaching here means the screen was behind, and
 * `refresh()` is the correction — a banner would report a problem the user does
 * not have.
 */
export async function revertOnDate(
  date: CalendarDate,
  slot: string,
): Promise<PlanResult> {
  try {
    if (!isMealSlot(slot)) return FAILED;

    const resolved = await planFor(date);

    if (!resolved) return FAILED;

    const { userId, week } = resolved;
    const planned = cellIn(week, date, slot);

    if (planned?.source === "override") {
      await deleteOverride(userId, planned.entryId);
    }

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not revert the swap.", error);

    return FAILED;
  }
}
