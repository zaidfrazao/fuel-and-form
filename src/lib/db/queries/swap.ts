import "server-only";

import { eq, sql } from "drizzle-orm";

import type { CalendarDate } from "@/lib/date";
import { getDb } from "../index";
import * as schema from "../schema";
import type { MealSlot } from "../schema";
import { scope } from "../scope";

/**
 * Substituting a meal on one date — P2's swap.
 *
 * Two statements, and the shape of the pair is the whole feature: a swap
 * INSERTS into `day_plan_overrides`, and a revert DELETES from it. Neither one
 * names `plan_template_entries` at all. That is what makes "the template is
 * physically unchanged" true by construction rather than by discipline — there
 * is no statement in this module capable of touching it, so no future edit here
 * can break the guarantee by accident.
 *
 * In `queries/` for the reason log.ts gives: `getDb()` hands back an unscoped
 * handle, and the eslint rule in eslint.config.mjs makes reaching for one
 * outside `src/lib/db/` an error. A module here runs scoped statements and
 * returns ROWS — never a handle, never a `Scope`.
 *
 * ## Why the meal id is not checked against the library here
 *
 * It is checked in `app/actions/swap.ts`, before this is reached, because that
 * is where the refusal has somewhere to go — an unknown meal is `{ ok: false }`
 * and a banner, not an exception. Underneath, the composite foreign key
 * `(meal_id, user_id)` on `day_plan_overrides` means Postgres refuses another
 * user's meal regardless of what any caller checked. Repeating the lookup here
 * would be a second, weaker copy of a guarantee the database already holds.
 */

/** One substitution: this meal, on this date, in this slot. */
export type Override = {
  date: CalendarDate;
  slot: MealSlot;
  mealId: string;
};

/**
 * Writes overrides for a set of date/slot pairs, replacing any already there.
 *
 * An upsert rather than an insert because `day_plan_overrides` is unique on
 * `(user_id, date, slot)` — the constraint schema.ts describes as "what makes
 * 'the row' singular, and what lets a second swap of the same slot be an upsert
 * rather than a duplicate that resolution would then have to break a tie
 * between". Swapping dinner twice in one evening is an ordinary thing to do,
 * and so is repeating a meal across days one of which was already swapped.
 *
 * The conflict target is `(date, slot)`; `scope.upsert` prepends `user_id`
 * itself, which is what makes the arbiter index the right one and the colliding
 * row necessarily this user's.
 *
 * `created_at` is deliberately not set on the update half. It records when the
 * slot first diverged from the template, and a second swap of the same slot is
 * a correction to that divergence rather than a new one.
 *
 * ## One statement, N rows — FUEL-24
 *
 * The repeat writes a run of consecutive dates, and it does so as a single
 * `INSERT ... ON CONFLICT`. A loop would be interruptible between iterations,
 * which is a plan half-way through a change the user was told had happened:
 * chilli on Tuesday and Wednesday but not Thursday, with nothing on the screen
 * to say so. One statement makes the repeat atomic without a transaction, which
 * is what keeps this module free of the pool handle.
 *
 * Every row is a SEPARATE row, deliberately — no range column, no run id. That
 * is what makes the task's "each created override is individually revertible"
 * true by construction: `deleteOverride` takes one row id and removes one date,
 * so reverting Wednesday leaves Tuesday and Thursday exactly where they were.
 * A range representation would have made a single-day revert a split operation,
 * and the weekly grid (FUEL-28) would have had to understand it.
 *
 * The caller must not pass two rows with the same `(date, slot)`: Postgres
 * refuses one statement that would affect a row twice. `repeatDates` returns
 * distinct dates and the repeat fixes the slot, so it cannot happen from here.
 */
export async function writeOverrides(
  userId: string,
  overrides: readonly Override[],
): Promise<void> {
  // Nothing to write, and no statement to run. Reaching this with an empty
  // batch would otherwise be `INSERT ... VALUES` with no tuples, which is a
  // syntax error rather than a no-op — a failure mode with no useful message,
  // in the one shape a caller is most likely to produce by accident.
  if (overrides.length === 0) return;

  const s = scope(userId, getDb());

  await s.upsert(
    schema.dayPlanOverrides,
    overrides.map(({ date, slot, mealId }) => ({ date, slot, mealId })),
    {
      target: [schema.dayPlanOverrides.date, schema.dayPlanOverrides.slot],
      // `excluded`, not a captured value. It is Postgres's name for the row
      // that was PROPOSED for insertion, so each conflicting row updates to its
      // own meal — which is the only correct answer once a batch can carry more
      // than one. A literal lifted from the first override would compile, and
      // would quietly write that meal onto every colliding date in the run.
      set: { mealId: sql`excluded.meal_id` },
    },
  );
}

/**
 * Writes the override for one date and slot — the substitute (FUEL-23).
 *
 * The singular case of `writeOverrides`, delegating rather than running its own
 * statement. Two statement shapes in one module is two places for the conflict
 * target to be written, and the day they disagree is the day a swap and a
 * repeat resolve differently for the same slot.
 */
export async function writeOverride(userId: string, override: Override): Promise<void> {
  await writeOverrides(userId, [override]);
}

/**
 * Removes one override — revert to template.
 *
 * A hard delete, for the reason `deleteLog` gives about logs: an override that
 * was reverted did not happen, and a soft-deleted row would have to be filtered
 * out of resolution, of the totals, and of the export from here on — a filter
 * someone eventually forgets. What the slot reverts TO needs no lookup, because
 * nothing was ever overwritten: the template entry is still sitting there, and
 * `resolveSlot` finds it again the moment this row is gone.
 *
 * Returns whether anything was removed, so the caller can tell a genuine revert
 * from one that raced another tab. The scoped delete returns no rows for an
 * override already gone AND for one that was never the caller's, which are the
 * same answer on purpose — see scope.ts on "not yours" versus "not there".
 */
export async function deleteOverride(userId: string, id: string): Promise<boolean> {
  const s = scope(userId, getDb());

  const removed = await s.delete(
    schema.dayPlanOverrides,
    eq(schema.dayPlanOverrides.id, id),
  );

  return removed.length > 0;
}
