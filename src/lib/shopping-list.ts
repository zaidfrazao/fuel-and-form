import type { MealIngredient } from "./db/schema";
import { round1 } from "./macros";
import type { PlannedDay } from "./week-grid";

/**
 * The week's shopping, aggregated out of its resolved plan — FUEL-44, PRD § P8.
 *
 * *"Aggregates ingredients across a selected week's resolved, post-swap plan
 * into a checkable list, combining duplicate ingredients across recipes and
 * grouping by rough category."* This file is that sentence. FUEL-45 owns the
 * screen, the check state, and the scoped read that feeds this; what is here is
 * the arithmetic underneath all three.
 *
 * ## Why the aggregation is the risky half
 *
 * Every other reader of the plan prints one meal's own figures, so a mistake
 * shows up beside the thing it is wrong about. This one collapses seventy-odd
 * ingredient rows into a couple of dozen lines, and a mistake in the collapse
 * prints a plausible number with nothing next to it to disagree with. Buying
 * 150g of mince for a week that needs 300g is not an error anyone catches in
 * review — it is caught in the kitchen on Thursday. Hence the gate, and hence
 * the length of what follows: the decisions below are the whole feature, and
 * each of them is a way to be quietly wrong.
 *
 * ## Occurrences, not recipes
 *
 * The unit of aggregation is a PLANNED SLOT, not a meal in the library. If the
 * chilli is planned for Tuesday and again for Thursday, its 150g of mince is
 * counted twice. Deduplicating by meal would produce a list that shops for the
 * recipe book rather than for the week — and the PRD's user value is the
 * opposite: *"a shop that matches what I'm actually going to cook"*.
 *
 * ## Post-swap by construction
 *
 * The first acceptance criterion — "reflecting all overrides" — is satisfied by
 * taking the RESOLVED days as input rather than the plan. `resolveWeek` has
 * already chosen the override over the template wherever one exists, so a
 * swapped Tuesday arrives here as the meal that will actually be cooked and
 * there is no second copy of the resolution rule in this file to disagree with
 * the first. `week-totals.ts` takes the same route to the same criterion.
 *
 * ## Pure, and generic over the meal
 *
 * No database access, no `user_id`, no `server-only`, and only TYPE imports from
 * the schema — `resolve-plan.ts` states the rule. Generic over the meal for the
 * reason `weekGrid` is: the page narrows its library before it crosses to the
 * browser, so what arrives need not be a `Meal` row. All this needs of a meal is
 * its id, which is what joins a planned slot to its ingredient rows.
 */

/**
 * The five rough aisles of PRD § P8, in the order a shop walks them.
 *
 * `meal_ingredients.category` is nullable `text` and not an enum, so unlike
 * `SLOT_ORDER` this list has no database counterpart to be checked against.
 * The seed library is the real vocabulary instead, and `shopping-list.test.ts`
 * asserts this list covers every category `seedMeals` actually uses: a sixth
 * aisle added there fails that test rather than silently landing in "other".
 *
 * The order is the PRD's own — produce / dairy / meat / dry goods / other — and
 * is fixed rather than derived so the list reads the same way every week. A
 * shop whose sections reshuffled when the plan changed would be re-learned on
 * every visit.
 */
export const SHOPPING_CATEGORIES = [
  "produce",
  "dairy",
  "meat",
  "dry goods",
  "other",
] as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

/** The fallback aisle, and the one an unrecognised or missing category takes. */
const OTHER: ShoppingCategory = "other";

/**
 * As much of an ingredient row as aggregation reads.
 *
 * `mealId` is the join back to the planned slot; the rest is what a line prints.
 * `sortOrder` is deliberately absent — it is a position WITHIN one recipe, and
 * once two recipes' rows are combined it describes nothing. Ordering below is
 * by name for that reason.
 */
export type ShoppingIngredient = Pick<
  MealIngredient,
  "mealId" | "name" | "grams" | "nonScaleMeasure" | "category"
>;

/**
 * One free-text measure, and how many times the week asks for it.
 *
 * Non-scale measures are never parsed and never summed. The seeded values are
 * things like "a big handful", "1/2–3/4 tsp" and "to taste, generously" — there
 * is no arithmetic that turns those into a quantity, and any that appeared to
 * would be inventing precision the kitchen does not have. Counting occurrences
 * is the honest aggregate: "1 clove ×5" is a shoppable instruction, where a
 * parsed "5 cloves" would be a guess that happens to be right for cloves and
 * wrong for handfuls.
 */
export type ShoppingMeasure = {
  text: string;
  times: number;
};

/** One combined line of the list. */
export type ShoppingLine = {
  /**
   * The normalised name: stable across regenerations, and the key FUEL-45's
   * check state hangs off.
   *
   * P8 requires that *"regenerating after a swap preserves existing check state
   * for unchanged items"*, which needs an identity that survives the swap. The
   * normalised name is exactly what does not change when Tuesday's dinner does
   * — a row id would not survive, and the position in the list survives even
   * less. The category is deliberately not part of it either, so that correcting
   * an ingredient's aisle in the seed moves the line without unchecking it.
   */
  key: string;
  /** The name as first encountered, casing and all. */
  name: string;
  category: ShoppingCategory;
  /** Summed over the rows that carry a weight; null when none of them did. */
  grams: number | null;
  /**
   * Whether some contributing row had no weight.
   *
   * A real case in the seeded library, not a hypothetical: butter appears once
   * with grams and once without. Printing the bare sum would understate the
   * shop by an unknown amount while looking exactly like a complete figure —
   * the failure mode this whole file is gated against. The flag lets the screen
   * say "20g +" and be believed.
   *
   * Read it WITH `grams` rather than alone, because the pair carries three
   * distinct states and only one of them is the interesting one:
   *
   *   grams: 20,   partial: false  -> a complete weight
   *   grams: 20,   partial: true   -> at least 20g; the rest is unweighed
   *   grams: null, partial: true   -> no weight at all, measures only
   *
   * The flag stays true in that last state deliberately. "Some row had no
   * weight" is a property of the rows, and a flag that silently flipped false
   * once ALL of them lacked one would be false in the case where the total is
   * least complete — a worse invariant to hand a renderer than a redundant
   * true, which it can simply not read when `grams` is null.
   */
  gramsPartial: boolean;
  /** Distinct non-scale measures, in the order the week first asks for them. */
  measures: readonly ShoppingMeasure[];
  /**
   * How many ingredient ROWS contributed to this line.
   *
   * Rows, not planned occurrences. The two coincide for every recipe in the
   * seeded library, because none of them names one ingredient twice — but a
   * recipe that did would contribute two rows from a single dinner, and a
   * comment claiming "occurrences" would then be quietly wrong in exactly the
   * place someone would be reading it to find out why a number looked high.
   */
  times: number;
};

/** One aisle's worth of lines. Absent entirely when the week needs nothing. */
export type ShoppingGroup = {
  category: ShoppingCategory;
  lines: readonly ShoppingLine[];
};

/**
 * Case-folded, whitespace-collapsed, trimmed — and nothing cleverer.
 *
 * This is the whole of what "identical ingredients" means here, and the
 * narrowness is deliberate. The seeded library contains "Olive oil", "Olive oil
 * (for the fish)" and "Olive oil (for the potatoes)", which stay three lines. A
 * matcher loose enough to merge those is loose enough to merge "Chilli flakes"
 * with "Chilli powder" — both are in there too, in the same recipe — and a
 * shopping list that silently drops one of a pair of distinct spices is worse
 * than one that prints an olive oil twice. Three honest lines cost a moment's
 * reading; a wrong merge costs the meal.
 *
 * Where the seed genuinely names one thing twice, the fix belongs in the seed.
 * That is a data edit with a visible diff, not a heuristic in the aggregator
 * that has to be right about every future ingredient nobody has typed yet.
 */
function normalise(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A category the list has an aisle for, or "other" for anything else. */
function toCategory(value: string | null): ShoppingCategory {
  const found = SHOPPING_CATEGORIES.find((category) => category === value?.trim().toLowerCase());

  return found ?? OTHER;
}

/**
 * Three-way string comparison, without a branch and without a locale.
 *
 * The same rule and the same reasoning as `resolve-plan.ts`'s: a list whose
 * order depends on the ambient collation is a list that reads differently on
 * the phone in the shop than it did on the laptop that planned the week.
 * Restated rather than exported across, because it is three tokens and the
 * import would couple the shopping list to the resolver's internals.
 */
const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/** The accumulator behind one line, before it is frozen into a `ShoppingLine`. */
type Tally = {
  key: string;
  name: string;
  category: ShoppingCategory;
  grams: number | null;
  gramsPartial: boolean;
  measures: Map<string, ShoppingMeasure>;
  times: number;
};

/**
 * Fold one ingredient row into its line, creating the line if it is the first.
 *
 * Category and display name are taken from whichever row arrives first and are
 * not revisited. Two rows that name one ingredient but disagree about its aisle
 * is a data problem with no correct resolution here — the seed has no such
 * clash today — and first-seen at least makes the answer deterministic rather
 * than dependent on the order Postgres happened to return.
 */
function fold(tally: Tally | undefined, key: string, row: ShoppingIngredient): Tally {
  const line: Tally = tally ?? {
    key,
    name: row.name.trim(),
    category: toCategory(row.category),
    grams: null,
    gramsPartial: false,
    measures: new Map(),
    times: 0,
  };

  line.times += 1;

  // Nullable and genuinely used: "salt to taste" has no weight, and the column
  // was made nullable precisely so the seed would not have to invent one.
  if (row.grams === null) {
    line.gramsPartial = true;
  } else {
    line.grams = (line.grams ?? 0) + row.grams;
  }

  const measure = row.nonScaleMeasure?.trim();

  if (measure) {
    const seen = line.measures.get(measure);

    if (seen) seen.times += 1;
    else line.measures.set(measure, { text: measure, times: 1 });
  }

  return line;
}

/**
 * The week's shopping list, grouped by aisle.
 *
 * `days` is the resolved, post-override week — `resolveWeek`'s output, or the
 * grid's columns once FUEL-45 decides which the screen holds. `ingredients` is
 * every ingredient row for the user's library; rows whose meal the week does
 * not plan are ignored rather than filtered by the caller, so the read stays a
 * single unqualified scoped select.
 *
 * A meal with no ingredient rows contributes nothing and does not throw. That
 * is the promise PRD § Risks makes in order to let P1–P6 ship without recipe
 * data — *"schema accepts a meal with macros and no ingredient rows"* — and it
 * is still true of every treat and every weekend placeholder.
 *
 * Empty aisles are omitted rather than returned empty. A heading with nothing
 * under it reads as a section that failed to load, and § Materials reserves the
 * hatch for a genuine absence of data rather than an absence of chicken.
 */
export function shoppingList<M extends { id: string }>(
  days: readonly PlannedDay<M>[],
  ingredients: readonly ShoppingIngredient[],
): readonly ShoppingGroup[] {
  // Built once and indexed, unlike the library scans in `resolve-plan.ts`: that
  // one looks up tens of meals a handful of times, this one looks up hundreds
  // of ingredient rows once per planned slot, and the nested scan would be
  // quadratic in the only place here where the row count is not small.
  const byMeal = new Map<string, ShoppingIngredient[]>();

  for (const row of ingredients) {
    const rows = byMeal.get(row.mealId);

    if (rows) rows.push(row);
    else byMeal.set(row.mealId, [row]);
  }

  // Insertion-ordered, which is what makes `measures` first-seen order and the
  // name tie-break below stable: both follow the week, Monday first.
  const tallies = new Map<string, Tally>();

  for (const day of days) {
    for (const cell of day.meals) {
      for (const row of byMeal.get(cell.meal.id) ?? []) {
        const name = normalise(row.name);

        if (!name) continue;

        tallies.set(name, fold(tallies.get(name), name, row));
      }
    }
  }

  const grouped = new Map<ShoppingCategory, ShoppingLine[]>();

  for (const tally of tallies.values()) {
    const lines = grouped.get(tally.category) ?? [];

    lines.push({
      key: tally.key,
      name: tally.name,
      category: tally.category,
      // Rounded once, here, where the total is produced — `round1` argues the
      // case: grams is `numeric(_, 1)`, so three 20.1g rows sum to
      // 60.300000000000004 and a shopping list can print it.
      grams: tally.grams === null ? null : round1(tally.grams),
      gramsPartial: tally.gramsPartial,
      measures: [...tally.measures.values()],
      times: tally.times,
    });

    grouped.set(tally.category, lines);
  }

  const groups: ShoppingGroup[] = [];

  for (const category of SHOPPING_CATEGORIES) {
    const lines = grouped.get(category);

    if (!lines) continue;

    // By name rather than by the order the week happens to plan its meals: the
    // list is read while walking an aisle, and Tuesday's dinner is not a
    // location. `key` carries the already-normalised name, so the comparison
    // sorts on what the eye reads rather than on the casing the seed used.
    lines.sort((a, b) => compareStrings(a.key, b.key));

    groups.push({ category, lines });
  }

  return groups;
}
