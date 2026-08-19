import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { DayOfWeek } from "@/lib/date";
import { getDb } from "../index";
import * as schema from "../schema";
import type { Meal, MealSlot, PlanTemplateEntry } from "../schema";
import { scope } from "../scope";

/**
 * Editing the recurring week — P2's "editing the template itself is a separate,
 * explicit action", and FUEL-25's half of it.
 *
 * ## The mirror image of queries/swap.ts
 *
 * That module's opening claim is that it names `day_plan_overrides` and never
 * `plan_template_entries`, so "the template is physically unchanged by a swap"
 * holds by construction rather than by discipline. This module makes the same
 * promise from the other side: every statement here names
 * `plan_template_entries`, and there is no statement capable of touching
 * `day_plan_overrides` — so an edit to the recurring intent cannot leave a
 * dated divergence behind, however this file is later changed.
 *
 * The two halves of the guarantee are worth stating separately because they
 * fail in opposite directions and both failures are silent. A swap that wrote
 * the template would make every future Tuesday follow one evening's substitute.
 * A template edit that wrote an override would change today and nothing else,
 * and the user would find out next week when the plan reverted to what it said
 * before.
 *
 * ## Why the meal is not checked here
 *
 * Same division queries/swap.ts draws: `app/actions/template.ts` checks the
 * meal against the caller's own library, because that is where a refusal has
 * somewhere to go — `{ ok: false }` and a banner, not an exception. Underneath,
 * the composite foreign key `(meal_id, user_id)` means Postgres refuses another
 * user's meal regardless of what any caller checked.
 *
 * In `queries/` for the reason log.ts gives: `getDb()` hands back an unscoped
 * handle, and the eslint rule in eslint.config.mjs makes reaching for one
 * outside `src/lib/db/` an error. A module here runs scoped statements and
 * returns ROWS — never a handle, never a `Scope`.
 */

/** One recurring entry: this meal, every week, on this weekday in this slot. */
export type TemplateEntry = {
  dayOfWeek: DayOfWeek;
  slot: MealSlot;
  mealId: string;
};

/** Which weekday and slot an edit is about, without naming a meal. */
export type TemplateCell = Pick<TemplateEntry, "dayOfWeek" | "slot">;

/** What the template editor renders from: the recurring week, and the library. */
export type Template = {
  entries: PlanTemplateEntry[];
  meals: Meal[];
};

/**
 * The whole recurring week, and every meal that could fill a slot in it.
 *
 * Both in one round trip. The screen shows seven days at once and offers the
 * library on every one of them, so there is no narrowing available that the
 * page would not immediately undo — and the same reading of PRD § Assumptions
 * that lets `loadToday` fetch the whole library applies here: "ten or so
 * recipes cover the rotation".
 *
 * Ordered in SQL rather than in the browser. `(day_of_week, sort_order, id)` is
 * total, so two entries sharing a position still come back the same way on
 * every request — which is what stops a screen that is rebuilt on every
 * `refresh()` from reshuffling itself under the reader.
 */
export async function loadTemplate(userId: string): Promise<Template> {
  const s = scope(userId, getDb());

  const [entries, meals] = await Promise.all([
    s.select(schema.planTemplateEntries, undefined, {
      orderBy: [
        asc(schema.planTemplateEntries.dayOfWeek),
        asc(schema.planTemplateEntries.sortOrder),
        asc(schema.planTemplateEntries.id),
      ],
    }),
    s.select(schema.meals),
  ]);

  return { entries, meals };
}

/** Everything in one cell — at most two rows in practice. See `writeTemplateEntry`. */
const inCell = ({ dayOfWeek, slot }: TemplateCell) =>
  and(
    eq(schema.planTemplateEntries.dayOfWeek, dayOfWeek),
    eq(schema.planTemplateEntries.slot, slot),
  );

/**
 * Sets what a weekday's slot recurs to, replacing whatever it held.
 *
 * ## Why this is not an upsert
 *
 * It was, briefly. `plan_template_entries` has no unique constraint on
 * `(user_id, day_of_week, slot)` to conflict on, and FUEL-25 added one before
 * discovering it cannot exist: `lib/seed/plan.ts` puts two snacks on every
 * weekday on purpose, so the index refuses the app's own seed. schema.ts
 * carries the full reasoning.
 *
 * So the cell is read, then written — an UPDATE of the row that is already
 * there, or an INSERT when the cell is empty. Two round trips rather than one,
 * on a screen where that is not the constraint the 300ms budget is about: the
 * optimistic layer has already redrawn the row by the time either statement
 * runs.
 *
 * ## Which row, when a cell holds two
 *
 * The one the RESOLVER would serve: lowest `sort_order`, then id, which is the
 * total order `resolve-plan.ts` uses. The editor shows one meal per cell
 * because resolution answers with one meal per slot, so the row it offers to
 * change has to be the row that is actually eaten. Any other choice would let
 * someone change a snack and watch the screen keep serving the other one.
 *
 * ## The gap between the read and the write
 *
 * Two statements, so two requests editing the same cell at the same instant
 * could both find no row and both insert. The result is a duplicate the
 * resolver already tie-breaks — the same state the seed's two snacks are in,
 * not a corruption — and reaching it needs one person to tap two devices in the
 * same few milliseconds. Worth naming, not worth a transaction: this is a
 * single-owner app, and the alternative would put a lock in the path of a
 * screen that is otherwise two selects and an update.
 *
 * `sortOrder` is deliberately not written on either path. It defaults to 0 on
 * insert and is left alone on update, so a day ordered by hand keeps its order
 * when a meal in it changes: this function answers "what is eaten", and
 * reordering a day is a different question with no control on this screen.
 */
export async function writeTemplateEntry(
  userId: string,
  { dayOfWeek, slot, mealId }: TemplateEntry,
): Promise<void> {
  const s = scope(userId, getDb());

  const existing = (
    await s.select(schema.planTemplateEntries, inCell({ dayOfWeek, slot }), {
      // The resolver's tie-break, run by Postgres. Ordering on the uuid rather
      // than on its text is the same order: the canonical form is those bytes
      // hex-encoded with hyphens at fixed positions, so it sorts identically to
      // the string comparison `resolve-plan.ts` does in memory.
      orderBy: [
        asc(schema.planTemplateEntries.sortOrder),
        asc(schema.planTemplateEntries.id),
      ],
      limit: 1,
    })
  ).at(0);

  if (existing) {
    await s.update(
      schema.planTemplateEntries,
      { mealId },
      eq(schema.planTemplateEntries.id, existing.id),
    );

    return;
  }

  await s.insert(schema.planTemplateEntries, { dayOfWeek, slot, mealId });
}

/**
 * Empties a weekday's slot — the template stops planning anything there.
 *
 * A DELETE rather than a row holding a null meal, because "nothing is planned"
 * is already how this table says it: `plan_template_entries` is sparse, and
 * resolve-plan.ts treats a missing row as an ordinary state rather than an
 * error. PRD § P2's weekend is exactly that — breakfast and coffee, and no
 * lunch entry at all.
 *
 * Scoped by weekday and slot rather than by row id, which is the same choice
 * `revertSwap` makes for the opposite reason. There, the id is re-derived
 * server-side so a forged request cannot name an arbitrary row; here the cell
 * itself is the address, and no uuid has to cross the wire to be trusted.
 *
 * ## It removes EVERY row in the cell, and that is a decision
 *
 * A weekday's snack slot can hold two rows (see schema.ts), and deleting only
 * the one the resolver serves would leave the other behind — so "Clear this
 * slot" would empty the row on screen and then fill it again from a meal the
 * user cannot see, which reads as the control not working. "The template plans
 * nothing here" is what the words say, so it is what the statement does.
 *
 * The meals themselves are untouched: this deletes plan rows, and the library
 * is where a meal lives. § Buttons reserves the destructive variant for Delete
 * and discard, and this is neither — the slot can be refilled from the same
 * sheet, with the same meal.
 *
 * Returns whether anything was removed. A cell that was already empty is not a
 * failure: the caller was looking at a screen, and a screen can be behind.
 */
export async function clearTemplateEntry(
  userId: string,
  { dayOfWeek, slot }: TemplateCell,
): Promise<boolean> {
  const s = scope(userId, getDb());

  const removed = await s.delete(
    schema.planTemplateEntries,
    inCell({ dayOfWeek, slot }),
  );

  return removed.length > 0;
}
