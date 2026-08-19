"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  clearTemplateEntry,
  loadTemplate,
  writeTemplateEntry,
} from "@/lib/db/queries/template";
import { isDayOfWeek, isMealSlot } from "@/lib/template-plan";

/**
 * Editing the recurring week — PRD § P2's "editing the template itself is a
 * separate, explicit action", and FUEL-25's write.
 *
 * ## Why this is a separate file from actions/swap.ts
 *
 * Not tidiness. The two write different tables with different reaches, and the
 * separation is what keeps that difference from becoming an argument.
 *
 * A swap writes one row in `day_plan_overrides`: one date, one slot, reversible
 * from the card it was made on, and gone from the plan's meaning the moment it
 * is reverted. A template write is one row too — and it decides every future
 * occurrence of that weekday, for as long as nobody changes it back. There is
 * no date to revert it on, because it is not about a date.
 *
 * `swap.ts` already argues why `swapMeal` and `repeatMeal` are two entry points
 * rather than one with a defaulted `days`: an action that carries a parameter
 * widening what its callers can write means every existing call site has to be
 * re-read to confirm it does not pass one. That reasoning applies with more
 * force here, where the parameter would not multiply rows but change what KIND
 * of thing the write is. So there is no shared function, and no flag: a caller
 * that wants to change the recurring plan has to say so by name.
 *
 * It is also the machine-checkable half of the acceptance criterion "editing
 * the template is … never triggered accidentally". The screen's three defences
 * — a different route, different copy, an explicit confirm — are all things a
 * future edit could weaken. This one is not: `actions/swap.ts` imports nothing
 * from `queries/template.ts` and this file imports nothing from
 * `queries/swap.ts`, so neither flow can reach the other's table at all.
 *
 * ## The rules it shares with swap.ts
 *
 * Stated there in full and only summarised here, because they are the same
 * three rules and the day they diverge is the day one of them is wrong: a
 * Server Action is a public endpoint, so the session is resolved on this side
 * rather than trusted from the caller; every write goes through the
 * `user_id`-scoped data layer; and nothing throws, because § Feedback needs a
 * value to render a banner from.
 *
 * ## What the client is allowed to name, and why all three are checked
 *
 * Everything, unusually — the weekday, the slot and the meal all cross the
 * wire, where a swap derives its date and slot server-side by re-resolving an
 * item key. That is not a relaxation; it is that there is nothing to derive
 * them FROM. A swap is about today, and the server knows what today is. A
 * template edit is about "every Thursday", which exists nowhere but in the
 * request.
 *
 * So each of the three is checked rather than trusted:
 *
 *   - **The weekday** must be an integer 0-6. `day_of_week` carries a CHECK
 *     constraint, so Postgres would refuse an 8 regardless — checking first is
 *     what turns that from a 500 into an answer the screen can render.
 *   - **The slot** must be one of the five in the `meal_slot` enum, on the same
 *     terms.
 *   - **The meal** must be in the caller's own library and not archived. The
 *     composite foreign key `(meal_id, user_id)` means another user's meal is
 *     refused underneath whatever any caller checked; the archived half is the
 *     write path agreeing with `meal-picker.tsx`, because a rendering decision
 *     is not a rule until it does.
 *
 * So the worst a hand-rolled POST can do is set one of the caller's own meals
 * as one of their own weekday slots — which is the feature, and which they
 * could have done in two taps on the screen.
 *
 * ## Archived meals, again
 *
 * Refused here for the reason `swap.ts` gives: resolution deliberately still
 * resolves archived meals, so a plan made before a meal was retired keeps
 * rendering and keeps exporting. The rule is about scheduling something new,
 * not about remembering something old — and a template row is the most
 * "something new" a write in this app can be.
 */

/** What the editor renders from. Success carries nothing — see § Feedback. */
export type TemplateResult = { ok: boolean };

const DONE: TemplateResult = { ok: true };
const FAILED: TemplateResult = { ok: false };

/**
 * Sets what a weekday's slot recurs to — "Save to every Tuesday".
 *
 * The meal is validated against the caller's own library, fetched through the
 * scope rather than checked with a bare `SELECT ... WHERE id = $1`: the array
 * in hand is both the authoritative answer and the same one the picker was
 * rendered from, so a meal the screen could offer is a meal this accepts. The
 * same argument `swapMeal` makes, one table across.
 *
 * `refresh()` on the way out re-resolves the editor, at which point the cell
 * shows its new meal. `/` is re-resolved too, and it should be: a weekday whose
 * template changed is today whenever today is that weekday, and a slot with no
 * override on it will be showing the meal this call just replaced.
 */
export async function setTemplateMeal(
  dayOfWeek: number,
  slot: string,
  mealId: string,
): Promise<TemplateResult> {
  try {
    const session = await getSession();

    // No session. One answer for every refusal, as login/actions.ts argues: a
    // caller who could tell them apart learns something about the deployment
    // for nothing.
    if (!session) return FAILED;

    // A weekday or a slot this app will not write. Nothing the screen can
    // produce reaches here, so this is a forged request or a bug in the
    // control — and neither is worth a refresh, because both say nothing about
    // whether the browser's copy of the data is stale.
    if (!isDayOfWeek(dayOfWeek) || !isMealSlot(slot)) return FAILED;

    const { meals } = await loadTemplate(session.userId);
    const meal = meals.find((candidate) => candidate.id === mealId);

    // Refused, and the screen is reconciled on the way out — unlike the guards
    // above, and the difference is the reason those have no refresh. Both
    // failures here mean the browser's copy of the library disagrees with the
    // database, because the meal was archived or deleted in another tab.
    // Without a refresh the picker would go on offering the same meal, and
    // every retry would fail the same way with nothing to act on.
    if (!meal || meal.isArchived) {
      refresh();

      return FAILED;
    }

    await writeTemplateEntry(session.userId, { dayOfWeek, slot, mealId: meal.id });

    refresh();

    return DONE;
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a banner and a
    // "Try again", which is everything they can act on.
    console.error("Could not save the template entry.", error);

    return FAILED;
  }
}

/**
 * Stops the template planning anything for a weekday's slot.
 *
 * No meal to validate, so the two guards are the whole of it. The delete is
 * addressed by weekday and slot rather than by row id: the cell IS the address,
 * so no uuid has to cross the wire to be trusted.
 *
 * It removes ONE row — the one the screen was showing. A cell can hold more
 * than one (the seed's two snacks), and deleting a row the user never saw would
 * be unrecoverable through a UI that can only put one meal in a cell.
 * queries/template.ts argues it in full.
 *
 * A cell that was already empty answers `ok`, not failure, on the same terms
 * `revertSwap` does: the screen offers no Clear control in that state, so
 * reaching here means the screen was behind, and `refresh()` is the correction.
 * A banner would report a problem the user does not have.
 */
export async function clearTemplateMeal(
  dayOfWeek: number,
  slot: string,
): Promise<TemplateResult> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    if (!isDayOfWeek(dayOfWeek) || !isMealSlot(slot)) return FAILED;

    await clearTemplateEntry(session.userId, { dayOfWeek, slot });

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not clear the template entry.", error);

    return FAILED;
  }
}
