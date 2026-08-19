import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

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

/**
 * Sets what a weekday's slot recurs to, replacing whatever it held.
 *
 * An upsert on `plan_template_entries_user_day_slot_key`, the constraint
 * FUEL-25 added for exactly this. The alternative — delete the old row, insert
 * the new one — has a window between the two statements in which that weekday
 * has no dinner at all, and a request that failed in the middle would leave it
 * that way permanently. One statement has no middle.
 *
 * `sortOrder` is deliberately not written. It defaults to 0 on insert and is
 * left alone on update, so an entry that was ordered by hand keeps its position
 * when its meal changes: this function answers "what is eaten", and reordering
 * a day is a different question with no control on this screen yet.
 */
export async function writeTemplateEntry(
  userId: string,
  { dayOfWeek, slot, mealId }: TemplateEntry,
): Promise<void> {
  const s = scope(userId, getDb());

  await s.upsert(
    schema.planTemplateEntries,
    { dayOfWeek, slot, mealId },
    {
      // `userId` is deliberately absent: `scope.upsert` prepends it and throws
      // if a caller names it, because ownership is always part of the arbiter
      // index. The two columns here are the rest of that unique constraint.
      target: [schema.planTemplateEntries.dayOfWeek, schema.planTemplateEntries.slot],
      // Only the meal, and from `excluded` rather than from the captured
      // argument — Postgres's name for the row PROPOSED for insertion, which is
      // how queries/swap.ts writes the same clause. Identical here, where the
      // batch is always one row, and identical for a reason: two upserts in the
      // codebase written two different ways is an invitation for the batching
      // one to be edited into the shape of the singular one.
      set: { mealId: sql`excluded.meal_id` },
    },
  );
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
 * server-side so a forged request cannot name an arbitrary row; here there is
 * no id to derive — the constraint guarantees at most one row matches, so the
 * cell itself is the address.
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
    and(
      eq(schema.planTemplateEntries.dayOfWeek, dayOfWeek),
      eq(schema.planTemplateEntries.slot, slot),
    ),
  );

  return removed.length > 0;
}
