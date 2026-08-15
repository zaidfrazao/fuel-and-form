import type { DayPlanOverride, Meal, MealSlot, PlanTemplateEntry } from "./db/schema";
import {
  addDays,
  type CalendarDate,
  dayOfWeek,
  parseCalendarDate,
  startOfWeek,
} from "./date";

/**
 * Plan resolution — what is actually eaten on a given date.
 *
 * The rule, from PRD § Plan resolution, is one sentence: for any `(date, slot)`
 * the answer is the `day_plan_overrides` row if one exists, and otherwise the
 * `plan_template_entries` row for that date's `day_of_week`. Everything below
 * is that sentence plus the edges the Testing Strategy insists on.
 *
 * ## Why this is the file the project tests hardest
 *
 * The template is the recurring intent; an override is a single dated
 * divergence from it. Because a swap writes an override and never touches the
 * template, next Tuesday is unaffected by what happened this Tuesday — *"one-off
 * by construction rather than by discipline"*. That guarantee is only as real as
 * this resolver: a resolver that matched an override too loosely would leak a
 * swap into future weeks, and one that matched too tightly would lose it the
 * moment the clocks changed. Both failures look like data corruption to whoever
 * is holding the phone, and neither is visible in a code review.
 *
 * ## Pure, and given its data rather than fetching it
 *
 * No database access, no `user_id`, no `server-only`. The caller has already
 * been through `scope()`, so every row reaching this function belongs to one
 * user by construction — re-filtering here would be a second, weaker copy of a
 * guarantee that already holds, and the kind of copy that later disagrees.
 *
 * Being pure is also what makes the fourteen cases cheap enough to be
 * exhaustive: they run in milliseconds with no credentials, which is why the
 * 100% gate on this file is a real gate rather than an aspiration.
 *
 * ## One meal per slot
 *
 * `day_plan_overrides` is unique on `(user_id, date, slot)`, the PRD's weekly
 * grid is a "7-day × slot table" whose cells open a meal picker, and a swap
 * writes exactly one row. So a slot holds one meal, and `resolveSlot` returns
 * one or nothing. `plan_template_entries` has no matching unique constraint —
 * worth adding, and flagged as a follow-up rather than assumed here, so until it
 * exists a duplicated template entry resolves deterministically (lowest
 * `sort_order`, then id) instead of by whatever order the rows came back in.
 */

/** Which table an answer came from — an override is rendered as a swap (P2). */
export type PlanSource = "template" | "override";

/** One resolved slot: the meal that is planned, and what put it there. */
export type ResolvedMeal = {
  slot: MealSlot;
  meal: Meal;
  source: PlanSource;

  /**
   * The id of the row that won — the override's when `source` is "override".
   *
   * P2 requires an override be revertible "in one tap", and a revert is a
   * DELETE of that row. Returning the id costs nothing here and saves the UI
   * re-deriving something resolution already knew.
   */
  entryId: string;
};

/** A date and everything planned on it, in the order it is eaten. */
export type ResolvedDay = {
  date: CalendarDate;
  meals: ResolvedMeal[];
};

/**
 * Everything resolution needs, for one user, already fetched.
 *
 * `meals` is the user's library — tens of rows for one person — so the lookups
 * below scan it rather than building an index. An index per call would be more
 * code for a saving that does not exist at this size.
 */
export type Plan = {
  /** `profiles.program_start_date`. Nothing is planned before it. */
  programStartDate: CalendarDate;
  template: PlanTemplateEntry[];
  overrides: DayPlanOverride[];
  meals: Meal[];
};

/**
 * The order a day is eaten in — the `meal_slot` enum's order, restated.
 *
 * Deliberately NOT `sort_order`: `day_plan_overrides` has no such column, so any
 * ordering that read it would have to invent one for a swapped slot, and the
 * day would visibly reshuffle itself the moment something was swapped. The slot
 * position is defined for template and override alike.
 *
 * Written out rather than read from `mealSlot.enumValues` so that this module
 * imports NOTHING from the schema at runtime — only types, which are erased.
 * P2's weekly grid is interactive and may well be a client component, and a
 * resolver it can import should not drag Drizzle's pg-core into that bundle to
 * read five strings. The cost of restating them is that the two could drift, so
 * resolve-plan.test.ts asserts this list against the enum: drift is a failing
 * test rather than a slot that quietly stops resolving.
 */
export const SLOT_ORDER: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "snack",
  "dinner",
  "extra",
];

/**
 * Whether `date` is on or after the program start.
 *
 * Both dates are parsed rather than compared as they arrive: the comparison
 * itself is a string comparison — correct, because zero-padded 'YYYY-MM-DD'
 * sorts lexicographically exactly as it does chronologically — but a malformed
 * string would still compare, and quietly return an answer instead of an error.
 */
function isScheduled(plan: Plan, date: CalendarDate): boolean {
  parseCalendarDate(date);
  parseCalendarDate(plan.programStartDate);

  return date >= plan.programStartDate;
}

/**
 * Three-way string comparison, without a branch and without a locale.
 *
 * Not `localeCompare`, which reads the ambient locale's collation: a tie-break
 * exists to give the same answer everywhere, and one that could sort
 * differently on another machine defeats its own purpose. Not a ternary either
 * — subtracting the two comparisons returns a proper 0 for equal operands,
 * where `a < b ? -1 : 1` would claim an order between a value and itself and
 * break `sort`'s contract.
 */
const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/** Lowest `sort_order` first, ties broken by id so the order is total. */
const bySortOrderThenId = (a: PlanTemplateEntry, b: PlanTemplateEntry) =>
  a.sortOrder - b.sortOrder || compareStrings(a.id, b.id);

/**
 * The template entry for a weekday and slot, if the template has one.
 *
 * `filter` returns a new array, so the `sort` cannot reorder the caller's
 * `plan.template` — the array a swap must leave untouched is not touched by
 * reading it either.
 */
function templateEntry(
  template: PlanTemplateEntry[],
  day: number,
  slot: MealSlot,
): PlanTemplateEntry | undefined {
  return template
    .filter((entry) => entry.dayOfWeek === day && entry.slot === slot)
    .sort(bySortOrderThenId)
    .at(0);
}

/**
 * Attaches the meal a row names.
 *
 * Resolution hands back the meal, not just its id, because every caller needs
 * it: P1's card shows name and macros, P4 totals them, P8 reads the ingredients
 * through it. Resolving to an id would push the same lookup into all three.
 *
 * `is_archived` is not consulted. Archiving retires a meal from the PICKER; a
 * template entry or a logged day that already names it must keep rendering, or
 * last month's export starts reading "meal deleted" (Testing Strategy § 1.1
 * case 14). The library's composite foreign keys are what make the meal
 * certain to exist, so a missing one means the caller fetched a `meals` array
 * that does not cover its own plan — a bug worth a name, and much worse as a
 * meal that silently vanishes from the day and from its macro totals.
 */
function hydrate(
  plan: Plan,
  slot: MealSlot,
  mealId: string,
  source: PlanSource,
  entryId: string,
): ResolvedMeal {
  const meal = plan.meals.find((candidate) => candidate.id === mealId);

  if (!meal) {
    throw new Error(
      `Plan references meal ${mealId}, which is not in the meals it was given. ` +
        `resolve-plan does not read the database — pass every meal the template ` +
        `and overrides name, archived ones included.`,
    );
  }

  return { slot, meal, source, entryId };
}

/**
 * The meal planned for one slot on one date, or `null` if none is.
 *
 * `null` covers three ordinary states — before the program starts, a slot the
 * template never fills, and a day the template does not cover — and none of
 * them is exceptional enough to throw over. A weekend has no lunch entry in a
 * plan that does not plan weekend lunches; that is data, not an error.
 *
 * Overrides are consulted FIRST and unconditionally, not as a replacement for
 * something already there. A swap into a slot the template leaves empty is a
 * real action — an extra meal, today only — and it resolves like any other.
 */
export function resolveSlot(
  plan: Plan,
  date: CalendarDate,
  slot: MealSlot,
): ResolvedMeal | null {
  if (!isScheduled(plan, date)) return null;

  // Matching on the date STRING, exactly. This is the line that keeps a swap
  // one-off: the same weekday next week is a different string, so it cannot
  // match, and no timezone or clock change can make it match either.
  const override = plan.overrides.find(
    (candidate) => candidate.date === date && candidate.slot === slot,
  );

  if (override) {
    return hydrate(plan, slot, override.mealId, "override", override.id);
  }

  const entry = templateEntry(plan.template, dayOfWeek(date), slot);

  return entry ? hydrate(plan, slot, entry.mealId, "template", entry.id) : null;
}

/**
 * Everything planned for a date, in the order it is eaten.
 *
 * Built slot by slot on `resolveSlot`, so the day view and the single-slot
 * lookup behind a swap cannot disagree about what is planned — there is one
 * rule, applied five times, rather than two implementations of it.
 *
 * Empty is a normal answer: before `program_start_date`, and for a date the
 * template does not cover.
 */
export function resolveDay(plan: Plan, date: CalendarDate): ResolvedMeal[] {
  const meals: ResolvedMeal[] = [];

  for (const slot of SLOT_ORDER) {
    const resolved = resolveSlot(plan, date, slot);

    if (resolved) meals.push(resolved);
  }

  return meals;
}

/**
 * The seven days of the week containing `date`, Monday first.
 *
 * The shape P2's weekly grid renders. Monday-first is the display convention;
 * the stored `day_of_week` stays 0 = Sunday (see `startOfWeek`).
 */
export function resolveWeek(plan: Plan, date: CalendarDate): ResolvedDay[] {
  const monday = startOfWeek(date);

  return Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(monday, offset);

    return { date: day, meals: resolveDay(plan, day) };
  });
}
