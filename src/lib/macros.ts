import type { CalendarDate } from "./date";
import type { DayPlanOverride, Meal, MealSlot, Profile } from "./db/schema";
import { type Plan, resolveDay } from "./resolve-plan";

/**
 * Macro totalling — what a day actually adds up to, and how far that is from target.
 *
 * The rule, from PRD § P4, is one sentence: totals derive from the resolved
 * (post-override) plan for that specific date. So this module owns no notion of
 * what is planned; it asks `resolve-plan` and adds up the answer.
 *
 * ## Why this sits on top of the resolver rather than beside it
 *
 * P4's promise is that *"a swap that costs the day 30g of protein says so at the
 * moment of the swap"*. That is only true if the number under the swap button
 * and the number on tomorrow's day view were produced the same way. Summing
 * template rows here — or anywhere — would be a second, weaker copy of
 * resolution, and the first override would make the two disagree by exactly the
 * amount the user was trying to see.
 *
 * ## Pure, like the resolver it reads
 *
 * No database access, no `user_id`, no `server-only`. Everything arrives as an
 * argument, which is what makes `previewDayTotals` honest: a function with no
 * connection in reach cannot persist a hypothetical swap, so "without
 * persisting" is a property of the signature rather than a promise in a comment.
 *
 * ## What this module deliberately does NOT do
 *
 * It returns numbers, never strings. The Testing Strategy writes the delta
 * convention as `−21` rather than "21 under", and that minus sign is a rendering
 * decision — the Brand Guide's glyph, in the Brand Guide's typeface. A formatter
 * here would put half of the presentation layer in the arithmetic layer and
 * leave the other half wondering which of them owned the sign.
 *
 * There is no weekly aggregate either. P4 wants one, but Testing Strategy § 1.3
 * lists six cases and none of them is weekly, so it belongs to the view that
 * needs it, with cases of its own. `summariseDay` is exported so that view can
 * total `resolveWeek`'s output without resolving anything twice.
 */

/** kcal and the three macros, in the units the schema stores them in. */
export type MacroTotals = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
};

/**
 * Anything carrying macros — a `Meal`, or something that only looks like one.
 *
 * Narrower than `Meal` on purpose. Totalling needs four numbers, and a signature
 * demanding a whole row would force every caller with a hypothetical meal to
 * fabricate a `userId`, a `method` and an `isArchived` to add up two numbers.
 *
 * ## `isUntracked`, and why it is optional
 *
 * The weekend is deliberately looser — the PRD calls flexible meals *"a slot
 * type, not a failure state"* — and § 1.3 case 3 requires such a slot be left
 * out of the totals with the day flagged partial. But PRD Open Question 4 is
 * still open: whether those meals are real library rows with macros, or a
 * placeholder standing in for "not counted". Until it is answered there is no
 * `meals.is_untracked` column, so this flag reads `undefined` on every row the
 * database returns and no day is wrongly flagged in the meantime.
 *
 * It is declared here rather than inferred because the alternative is a sentinel
 * on zero macros, and the PRD's own coffee-and-MCT-oil ritual is a real item
 * with real, small numbers. A rule reading "0 kcal means we stopped counting"
 * cannot tell an honest zero from an absence, and would quietly flag a day
 * partial for drinking coffee.
 *
 * Adding the column is the follow-up that makes case 3 reachable in production;
 * this contract is what that column will plug into.
 */
export type MacroBearing = Pick<Meal, "kcal" | "proteinG" | "fatG" | "carbG"> & {
  isUntracked?: boolean;
};

/** The four target figures from the user's profile. */
export type MacroTarget = Pick<
  Profile,
  "targetKcal" | "targetProteinG" | "targetFatG" | "targetCarbG"
>;

/** A slot and what is in it — the part of `ResolvedMeal` that totalling reads. */
export type PlannedMacros = {
  slot: MealSlot;
  meal: MacroBearing;
};

/**
 * A day's totals, plus whether they tell the whole story.
 *
 * `partial` is what the strip renders; `untrackedSlots` is what a tooltip needs
 * in order to say WHICH slot is unaccounted for. `partial` is derived from the
 * array rather than tracked alongside it, so the badge and the explanation
 * cannot come to different conclusions.
 */
export type DayTotals = MacroTotals & {
  partial: boolean;
  untrackedSlots: MealSlot[];
};

/**
 * The entry id a previewed swap resolves to.
 *
 * A preview corresponds to no row, so there is nothing to revert and nothing to
 * delete. Named rather than left blank so that an id reaching the UI is
 * obviously a preview instead of a plausible-looking uuid.
 */
export const PREVIEW_ENTRY_ID = "preview";

/**
 * One decimal place, and never `-0`.
 *
 * Grams are `numeric(6, 1)`, which arrives as a JS number and then adds up like
 * one: three meals at 20.1g sum to 60.300000000000004, and a protein figure that
 * long is a bug the user can see. Rounding happens once, where a total is
 * produced — rounding each addition would compound exactly the error it is
 * there to remove.
 *
 * kcal is an integer column, so `Math.round` is identity on it. It goes through
 * the same helper anyway, because the `-0` clause has to apply to all four: a
 * delta of `-0` is a real JS value that renders as "−0", which reads as a
 * shortfall on a day that hit its target precisely.
 */
function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;

  return rounded === 0 ? 0 : rounded;
}

/**
 * Adds up whatever it is given, skipping anything untracked.
 *
 * An empty list totals zero rather than nothing: the accumulators start at 0, so
 * a day before the program starts and a day nobody has planned yet both return
 * four zeroes instead of `NaN` (§ 1.3 case 4). `NaN` is the failure that matters
 * here, because it propagates silently through a delta and a week average before
 * surfacing as "NaN g" somewhere far from its cause.
 */
export function totalMacros(meals: readonly MacroBearing[]): MacroTotals {
  let kcal = 0;
  let proteinG = 0;
  let fatG = 0;
  let carbG = 0;

  for (const meal of meals) {
    if (meal.isUntracked) continue;

    kcal += meal.kcal;
    proteinG += meal.proteinG;
    fatG += meal.fatG;
    carbG += meal.carbG;
  }

  return {
    kcal: round1(kcal),
    proteinG: round1(proteinG),
    fatG: round1(fatG),
    carbG: round1(carbG),
  };
}

/**
 * Totals for a day that has already been resolved.
 *
 * The entry point for the week view, which has a `ResolvedDay[]` in hand and
 * should not pay to resolve any of it a second time. `ResolvedMeal` satisfies
 * `PlannedMacros` structurally, so `resolveWeek(...).map(day => summariseDay(day.meals))`
 * type-checks without a cast.
 */
export function summariseDay(planned: readonly PlannedMacros[]): DayTotals {
  const untrackedSlots = planned.filter((item) => item.meal.isUntracked).map((item) => item.slot);

  return {
    ...totalMacros(planned.map((item) => item.meal)),
    partial: untrackedSlots.length > 0,
    untrackedSlots,
  };
}

/**
 * What one date adds up to, after overrides.
 *
 * The P4 acceptance criterion, in one line: resolve the date, total what came
 * back. Because resolution is the only source of "what is planned", totals
 * recompute correctly on a swap, a revert, or a template edit for free — there
 * is no cached sum anywhere to invalidate.
 */
export function dayTotals(plan: Plan, date: CalendarDate): DayTotals {
  return summariseDay(resolveDay(plan, date));
}

/**
 * What the day WOULD total if this meal were swapped in — without writing anything.
 *
 * P4 requires the cost of a swap be visible before it is confirmed, and the only
 * safe way to answer that is to ask the question the confirmed swap would ask.
 * So this builds the plan a confirmed swap would produce — an override row for
 * `(date, slot)`, in memory — and hands it to `dayTotals`. One code path, so a
 * preview cannot promise a total the real swap then fails to deliver.
 *
 * The synthetic row is PREPENDED, which is what makes previewing over an
 * existing swap work: `resolveSlot` takes the first override matching the date
 * and slot, so the candidate wins over whatever is already there rather than
 * being shadowed by it.
 *
 * `plan` is spread, never mutated, so the caller's arrays are the same arrays
 * afterwards — a preview that quietly edited the plan it was handed would be the
 * persistence this function exists to avoid, just in memory.
 *
 * A date before `program_start_date` previews as zeroes, because that is what
 * confirming the swap would produce: `resolveSlot` refuses the date before it
 * consults any table, and a preview that disagreed would be advertising a meal
 * the app will not serve.
 */
export function previewDayTotals(
  plan: Plan,
  date: CalendarDate,
  candidate: { slot: MealSlot; meal: Meal },
): DayTotals {
  const hypothetical: DayPlanOverride = {
    id: PREVIEW_ENTRY_ID,
    // From the meal rather than invented: resolution never reads this column,
    // and the candidate came out of the caller's own scoped library, so this is
    // the one user id in reach that cannot be the wrong one.
    userId: candidate.meal.userId,
    date,
    slot: candidate.slot,
    mealId: candidate.meal.id,
    // Fixed rather than `new Date()`: nothing reads it, and a clock reading here
    // would make an otherwise pure function return a different object each call.
    createdAt: new Date(0),
  };

  return dayTotals({
    ...plan,
    overrides: [hypothetical, ...plan.overrides],
    // Prepended too, so a candidate the caller fetched from the picker rather
    // than from `plan.meals` still hydrates. A duplicate id is harmless — the
    // lookup takes the first match, and both are the same meal.
    meals: [candidate.meal, ...plan.meals],
  }, date);
}

/**
 * How far a day is from target, signed.
 *
 * `actual − target`, so under-target is negative and over-target positive, for
 * all four figures. The convention is the whole point: § 1.3 case 5 asks for
 * `−21` rather than "21 under" because a signed number needs no sentence around
 * it to be read correctly, and because the same number then drives the colour,
 * the arrow, and the sort without anyone re-deriving its direction.
 *
 * Computed from already-rounded totals so that the strip and the delta beneath
 * it cannot differ by a floating hair — the delta is exactly the difference
 * between the number shown and the target shown.
 */
export function deltaFromTarget(totals: MacroTotals, target: MacroTarget): MacroTotals {
  return {
    kcal: round1(totals.kcal - target.targetKcal),
    proteinG: round1(totals.proteinG - target.targetProteinG),
    fatG: round1(totals.fatG - target.targetFatG),
    carbG: round1(totals.carbG - target.targetCarbG),
  };
}
