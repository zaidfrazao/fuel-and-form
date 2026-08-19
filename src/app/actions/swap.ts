"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { readCursor } from "@/lib/cursor-cookie";
import { deleteOverride, writeOverride, writeOverrides } from "@/lib/db/queries/swap";
import { repeatDates } from "@/lib/repeat";
import { loadToday } from "@/lib/db/queries/today";
import type { Today } from "@/lib/db/queries/today";
import type { ResolvedMeal } from "@/lib/resolve-plan";
import type { NowView } from "@/lib/resolve-now";

/**
 * Substituting today's meal, and repeating it forward — P2's two swap modes,
 * from the "Right Now" card.
 *
 * The sibling of `log.ts` and built on the same three rules, which are argued
 * there in full and only summarised here: a Server Action is a public endpoint,
 * so the session is resolved on this side rather than trusted from the caller;
 * every write goes through the `user_id`-scoped data layer; and nothing throws,
 * because § Feedback needs a value to render a banner from.
 *
 * ## What the client is allowed to name
 *
 * `log.ts` can take a key and NOTHING else, because everything a log records is
 * derivable from today's plan. A swap cannot: the whole point is a meal that is
 * *not* what today's plan says, so the chosen meal id has to cross the wire.
 * That makes this the first action in the app with a client-supplied value in
 * its write, and the split is drawn as narrowly as it can be:
 *
 *   - **The date and the slot are server-derived.** They come from re-resolving
 *     the item key, exactly as `logItem` does. A forged request cannot write an
 *     override onto an arbitrary date — say, next Tuesday, quietly making a
 *     swap permanent-looking — because no date is accepted from it.
 *   - **The meal id is validated, not trusted.** It must be in the caller's own
 *     scoped library and must not be archived. Underneath, the composite
 *     foreign key `(meal_id, user_id)` means Postgres refuses another user's
 *     meal regardless; checking first is what turns that from a 500 into an
 *     answer the screen can render.
 *
 * So the worst a hand-rolled POST can do is swap one of the user's own meals
 * into one of their own slots, today — which is the feature.
 *
 * ## The repeat widens that by exactly one number (FUEL-24)
 *
 * `repeatMeal` takes a third value, `days`, and it is a different KIND of
 * client input from the meal id: it does not pick which row is written, it
 * multiplies how MANY are. The date it starts from is still server-derived and
 * the slot is still re-resolved from the key, so the run can only ever move
 * forwards from today, in the caller's own slot, with the caller's own meal —
 * but without a bound, one request could write an unlimited number of rows.
 *
 * That bound lives in `lib/repeat.ts` rather than here, with the argument for
 * its size and for refusing rather than clamping. What this file is responsible
 * for is treating a count it will not act on the same way it treats a meal it
 * will not accept: an answer, not an exception.
 *
 * ## Why archived meals are refused here too
 *
 * `meal-picker.tsx` already filters them out, so no screen offers one. That is
 * a rendering decision, and a rendering decision is not a rule until the write
 * path agrees with it: without this, the two halves could disagree, and the way
 * anyone would find out is a retired meal reappearing on a plan.
 *
 * Resolution deliberately still RESOLVES archived meals (resolve-plan.ts), so a
 * swap made before a meal was retired keeps rendering and keeps exporting. The
 * rule is about scheduling something new, not about remembering something old.
 */

/** What the card renders from. Success carries nothing — see § Feedback. */
export type SwapResult = { ok: boolean };

const DONE: SwapResult = { ok: true };
const FAILED: SwapResult = { ok: false };

/**
 * The meal item a key names, scheduled or not.
 *
 * Meals only. A key naming a workout resolves to `undefined` rather than to an
 * item this action then has to decide what to do with — there is no such thing
 * as swapping a session (§ Seven screens gives the workout card no Swap
 * control), and `day_plan_overrides` has no column that could hold one.
 */
function mealFor(view: NowView, key: string): ResolvedMeal | undefined {
  const item =
    view.timeline.find((candidate) => candidate.key === key) ??
    view.anytime.find((candidate) => candidate.key === key);

  return item?.kind === "meal" ? item.meal : undefined;
}

/**
 * Today, resolved, together with whose day it is.
 *
 * `undefined` when there is no session or no profile row — nothing is resolved
 * in either case, so there is no slot to act on. Both actions below need the
 * same four lines and need them to fail the same way; sharing them is what
 * stops one of the two growing a subtly different idea of what "no session"
 * means.
 *
 * The user id is returned alongside rather than read again at the write, so
 * every statement an action runs is scoped to the identity that was resolved
 * once, at the top, from the cookie.
 */
async function today(): Promise<{ userId: string; day: Today } | undefined> {
  const session = await getSession();

  if (!session) return undefined;

  const day = await loadToday(session.userId, new Date(), await readCursor());

  return day && { userId: session.userId, day };
}

/**
 * Writes the dated override for the slot the key names.
 *
 * The acceptance criterion, in one call: `writeOverride` touches
 * `day_plan_overrides` and nothing else, so the template is unchanged and next
 * week's same weekday still resolves to the template meal. Neither of those is
 * enforced here — they are properties of the statement, covered against real
 * Postgres in tests/integration/swap.test.ts.
 *
 * The cursor is deliberately not moved. A swap changes WHAT the active item is,
 * not whether it is done, and advancing past a meal the user just chose would
 * be the screen answering a question nobody asked. `refresh()` re-resolves the
 * day, at which point the card shows the new meal with its Swapped tag.
 */
export async function swapMeal(key: string, mealId: string): Promise<SwapResult> {
  try {
    const resolved = await today();

    // No session, or no profile row — nothing is resolved, so there is no slot
    // to swap. One answer for both, as login/actions.ts argues: a caller who
    // could tell them apart learns something about the deployment for nothing.
    if (!resolved) return FAILED;

    const { userId, day } = resolved;
    const planned = mealFor(day.view, key);

    // A key today's plan does not hold, or one naming a workout. Either a
    // forged request, or a genuine tap on a card the plan changed underneath —
    // a swap made in another tab. Both are refused; the second is also a screen
    // that is out of date, and `refresh()` is what corrects it. It has to be
    // called HERE rather than left to the one at the end, because this path
    // returns before reaching it.
    if (!planned) {
      refresh();

      return FAILED;
    }

    // The one client-supplied value, checked against the caller's own library.
    // `find` rather than a database round trip: `loadToday` has already fetched
    // every meal this user owns, through the scope, so the array in hand is
    // both the authoritative answer and the same one the picker was rendered
    // from — a meal the screen could offer is a meal this accepts.
    const meal = day.meals.find((candidate) => candidate.id === mealId);

    // Refused, and the screen is reconciled on the way out.
    //
    // The optimistic value reverts on its own — React discards it when the
    // transition ends, with or without this. What `refresh()` fixes is the
    // OTHER half: both refusals here mean the browser's copy of the library
    // disagrees with the database, because the meal was archived or deleted in
    // another tab. Without a refresh the picker would go on offering the same
    // meal, and every retry would fail the same way with nothing to act on.
    if (!meal || meal.isArchived) {
      refresh();

      return FAILED;
    }

    await writeOverride(userId, {
      // The resolved day, not the clock. `loadToday` derived this date from the
      // user's configured timezone at the top of the request; reading the clock
      // again here could land on the other side of midnight and file the
      // override against a date the screen never showed.
      date: day.view.date,
      slot: planned.slot,
      mealId: meal.id,
    });

    refresh();

    return DONE;
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a banner and a
    // "Try again", which is everything they can act on.
    console.error("Could not swap the meal.", error);

    return FAILED;
  }
}

/**
 * Writes the same meal into this slot on `days` consecutive dates, starting
 * today — PRD § P2's "Repeat", and the thawed-too-much-mince case.
 *
 * ## It is `swapMeal` with a different number of dates, on purpose
 *
 * Every check above is repeated here in the same order and with the same
 * refusal, because a repeat is a swap that happens more than once and any
 * divergence between the two would be a way to reach one of them through the
 * other's validation. The two are not merged into one action with a defaulted
 * `days`, though, and that is deliberate: `swapMeal` would then carry a
 * parameter that widens what its callers can write, and every existing call
 * site would have to be read to confirm it does not pass one. Two entry points
 * that share their checks are easier to hold than one whose blast radius
 * depends on an argument.
 *
 * ## The dates
 *
 * The run starts at `day.view.date` — the day `loadToday` resolved from the
 * user's configured timezone — and never at `new Date()`. Reading the clock
 * again here could land on the other side of midnight and start the run on a
 * date the screen never showed, which for a repeat is worse than for a swap: it
 * would be off by one on every date in the run rather than on one of them.
 *
 * Week ends, month ends, leap days and daylight saving are `addDays`'s problem
 * and were solved before this task existed, which is why there is no calendar
 * arithmetic in this file.
 *
 * ## One statement, and N individually revertible rows
 *
 * `writeOverrides` sends one `INSERT ... ON CONFLICT`, so the acceptance
 * criterion's "in one action" is true of the database and not only of the tap:
 * there is no state in which Tuesday and Wednesday were written and Thursday
 * was not. And because each date is its own row, "each created override is
 * individually revertible" needs nothing further — `revertSwap` already removes
 * exactly one, and reverting Wednesday leaves Tuesday and Thursday alone.
 *
 * Today's is revertible immediately, from the card, through the control that is
 * already there. The later dates become revertible when they arrive — and from
 * the weekly grid once FUEL-28 renders one, which is where a control for a date
 * that is not today can exist at all.
 *
 * Dates already carrying an override are UPDATED rather than duplicated, by the
 * same unique constraint that makes swapping dinner twice an upsert. Repeating
 * across a day that was already swapped is an ordinary thing to do — it is what
 * "I made too much, ignore what I said about Wednesday" means.
 */
export async function repeatMeal(
  key: string,
  mealId: string,
  days: number,
): Promise<SwapResult> {
  try {
    const resolved = await today();

    if (!resolved) return FAILED;

    const { userId, day } = resolved;
    const planned = mealFor(day.view, key);

    if (!planned) {
      refresh();

      return FAILED;
    }

    const meal = day.meals.find((candidate) => candidate.id === mealId);

    if (!meal || meal.isArchived) {
      refresh();

      return FAILED;
    }

    const dates = repeatDates(day.view.date, days);

    // A count this app does not act on: out of range, fractional, or not a
    // number at all. Nothing the sheet can produce reaches here, so this is a
    // forged request or a bug in the control.
    //
    // No `refresh()`, unlike the two refusals above, and the difference is the
    // whole reason those have one. They mean the BROWSER'S COPY of the data
    // disagrees with the database — a meal archived in another tab, a plan
    // changed underneath — so re-resolving is what makes a retry able to
    // succeed. A bad `days` says nothing about the data; the screen is already
    // correct, and refreshing it would cost a re-render to fix nothing.
    if (!dates) return FAILED;

    await writeOverrides(
      userId,
      // The server's slot and the validated meal on every date. Neither is
      // taken from the client per-date — there is one slot and one meal in a
      // repeat, which is what makes it a repeat.
      dates.map((date) => ({ date, slot: planned.slot, mealId: meal.id })),
    );

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not repeat the meal.", error);

    return FAILED;
  }
}

/**
 * Takes the slot back to the template — § Feedback's "any log or swap is
 * revertible from where it was performed, for the rest of that day".
 *
 * Nothing has to be restored, because nothing was overwritten: the template
 * entry has been sitting in `plan_template_entries` the whole time, and
 * `resolveSlot` finds it again the moment the override row is gone. That is the
 * override model paying for itself — a revert is a delete, not an undo log.
 *
 * The row id comes from re-resolving the key, never from the client. It is
 * already on the resolved item as `entryId` (resolve-plan.ts returns it for
 * exactly this), so the browser holds it too — but accepting it from there
 * would mean accepting an arbitrary uuid and deleting whatever it named. The
 * scope would still refuse another user's row; it would not refuse this user's
 * OTHER rows, and "delete any one of my overrides, on any date" is a wider
 * capability than the button offers.
 *
 * A slot that is not overridden is `ok`, not a failure: the card offers no
 * Revert control in that state, so reaching here means the screen was behind,
 * and `refresh()` is the correction. A banner would report a problem the user
 * does not have.
 */
export async function revertSwap(key: string): Promise<SwapResult> {
  try {
    const resolved = await today();

    if (!resolved) return FAILED;

    const { userId, day } = resolved;
    const planned = mealFor(day.view, key);

    if (!planned) {
      refresh();

      return FAILED;
    }

    if (planned.source === "override") {
      await deleteOverride(userId, planned.entryId);
    }

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not revert the swap.", error);

    return FAILED;
  }
}
