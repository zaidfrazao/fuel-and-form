import type { MealIngredient } from "./db/schema";
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
 * Where a line is shelved: one of the five aisles, or the pantry — FUEL-137.
 *
 * The pantry is not a sixth aisle and is not in `SHOPPING_CATEGORIES`, which
 * mirrors a column's vocabulary. It is a property of the ingredient
 * (`meal_ingredients.pantry`) that overrides the aisle: salt is shelved in
 * "other" and is still not something this week's shop buys. Drawn last, after
 * every aisle, because what is on it is mostly already in the cupboard.
 */
export const PANTRY = "pantry";

export type ShoppingSection = ShoppingCategory | typeof PANTRY;

/** Every section, in the order the list draws them. */
export const SHOPPING_SECTIONS: readonly ShoppingSection[] = [...SHOPPING_CATEGORIES, PANTRY];

/**
 * As much of an ingredient row as aggregation reads.
 *
 * `mealId` is the join back to the planned slot; the rest is what a line prints.
 * `sortOrder` is deliberately absent — it is a position WITHIN one recipe, and
 * once two recipes' rows are combined it describes nothing. Ordering below is
 * by name for that reason. `nonScaleMeasure` has been absent since FUEL-137:
 * it is the kitchen's sentence, prep note and all ("1 clove, minced"), and the
 * list reads the shop's instead — `shopQty` and `shopUnit`.
 */
export type ShoppingIngredient = Pick<
  MealIngredient,
  "mealId" | "name" | "grams" | "category" | "shopName" | "shopQty" | "shopUnit" | "pantry"
>;

/**
 * A summed amount in one unit: 5 cloves, 660ml, 2.25 onions (`unit: null`).
 *
 * ## Summed, where it used to be counted — FUEL-137
 *
 * This file refused to add up measures for as long as the measure was free
 * text, and printed "1 clove ×5": "a big handful" and "to taste, generously"
 * have no arithmetic, and parsing the ones that start with a digit would be
 * right for cloves and wrong for handfuls. That argument was sound and it was
 * about the INPUT. `shop_qty` and `shop_unit` are a number and a unit that the
 * seed wrote down on purpose, so what is summed is data rather than a guess at
 * what a sentence meant — and a row with nothing countable simply contributes
 * no amount, marking the line partial.
 */
export type ShoppingAmount = {
  qty: number;
  unit: string | null;
};

/** One combined line of the list. */
export type ShoppingLine = {
  /**
   * The normalised shop name: stable across regenerations, and the key
   * FUEL-45's check state hangs off.
   *
   * P8 requires that *"regenerating after a swap preserves existing check state
   * for unchanged items"*, which needs an identity that survives the swap. The
   * normalised name is exactly what does not change when Tuesday's dinner does
   * — a row id would not survive, and the position in the list survives even
   * less. The category is deliberately not part of it either, so that correcting
   * an ingredient's aisle in the seed moves the line without unchecking it.
   *
   * The SHOP name since FUEL-137 (`shop_name`, falling back to `name`), which
   * is what makes "Olive oil (for the fish)" and "Olive oil" one line. The
   * migration that introduced it moved the ticks stored under the old names.
   */
  key: string;
  /** The shop name as first encountered, casing and all. */
  name: string;
  section: ShoppingSection;
  /**
   * The week's total, one entry per unit, in first-seen order.
   *
   * One entry in every line the seed produces — `shopping-list.test.ts`
   * asserts that every key uses one unit. More than one is still printed
   * rather than dropped, because adding 2 slices to 45g is not a sum anyone
   * can do and leaving one of them out is the understated shop this file
   * exists to prevent. Always empty for a pantry line: what the pantry holds
   * is whether you have it, not how many teaspoons a week spends.
   */
  amounts: readonly ShoppingAmount[];
  /**
   * Whether some contributing row had no amount at all.
   *
   * A row the seed gave neither a shop amount nor a weight — "a small
   * handful, chopped" — still belongs on the list. Printing the bare sum of
   * its siblings would understate the shop by an unknown amount while looking
   * exactly like a complete figure — the failure mode this whole file is gated against. The
   * flag lets the screen say "100g +" and be believed. Where `amounts` is
   * empty, the flag is true and says only what the empty list already does.
   */
  partial: boolean;
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

/** One section's worth of lines. Absent entirely when the week needs nothing. */
export type ShoppingGroup = {
  section: ShoppingSection;
  lines: readonly ShoppingLine[];
};

/**
 * Case-folded, whitespace-collapsed, trimmed — and nothing cleverer.
 *
 * This is the whole of what "identical ingredients" means here, and the
 * narrowness is deliberate. The seeded library contains "Olive oil", "Olive oil
 * (for the fish)" and "Olive oil (for the potatoes)". A matcher loose enough to
 * merge those is loose enough to merge "Chilli flakes" with "Chilli powder" —
 * both are in there too, in the same recipe — and a shopping list that silently
 * drops one of a pair of distinct spices is worse than one that prints an olive
 * oil twice.
 *
 * Where the seed genuinely names one thing twice, the fix belongs in the seed.
 * That is a data edit with a visible diff, not a heuristic in the aggregator
 * that has to be right about every future ingredient nobody has typed yet —
 * and since FUEL-137 it is the edit that was made: the three olive oils carry
 * `shop_name: "Olive oil"` and meet as one line, while the two chillies do not.
 *
 * Exported since FUEL-45, because the check-state action has to arrive at the
 * same answer this does. A client sends the key it was rendered with, and the
 * action normalises it again before writing — so the one place that decides
 * what "the same ingredient" means is here. A second, matching implementation
 * over there would agree until the day one of them changed, and the way anyone
 * would find out is a tick that stopped sticking.
 */
export function normaliseKey(name: string): string {
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
  section: ShoppingSection;
  /** Insertion-ordered by unit; `null` is the bare-count unit, a real key. */
  amounts: Map<string | null, number>;
  partial: boolean;
  times: number;
};

/**
 * What one row asks the shop for, or null when it asks for nothing countable.
 *
 * `shop_qty` first: it is the amount the seed wrote down for the shop, and it
 * wins over `grams` where both exist — butter's "1 tbsp for the base, plus
 * 20g" has a weight of 20 and a shop amount of 35. Then `grams`, which is
 * already a sum-able amount and needs no second column to say so. A row with
 * neither is "a small handful, chopped": the line still lists it, and says it
 * is partial.
 */
function rowAmount(row: ShoppingIngredient): ShoppingAmount | null {
  if (row.shopQty !== null) return { qty: row.shopQty, unit: row.shopUnit?.trim() || null };

  if (row.grams !== null) return { qty: row.grams, unit: "g" };

  return null;
}

/**
 * Fold one ingredient row into its line, creating the line if it is the first.
 *
 * The aisle and display name are taken from whichever row arrives first and
 * are not revisited. Two rows that name one ingredient but disagree about its
 * aisle is a data problem with no correct resolution here —
 * `shopping-list.test.ts` holds the seed to agreeing — and first-seen at least
 * makes the answer deterministic rather than dependent on the order Postgres
 * happened to return.
 *
 * The pantry flag is the exception: ANY row carrying it makes the line a
 * pantry line, whichever order the rows arrive in. That is the rule
 * `loadShoppingWeek` reads ticks by — a key is a pantry key if any row says
 * so — and a first-seen rule here would let the two disagree about one line,
 * drawing it in an aisle while its tick was read from every week.
 */
function fold(tally: Tally | undefined, key: string, row: ShoppingIngredient): Tally {
  const line: Tally = tally ?? {
    key,
    name: (row.shopName?.trim() || row.name).trim(),
    section: row.pantry ? PANTRY : toCategory(row.category),
    amounts: new Map(),
    partial: false,
    times: 0,
  };

  line.times += 1;

  // A later pantry row promotes the line, and drops what the aisle rows before
  // it had summed: the pantry prints no amount, so there is nothing to keep.
  if (row.pantry && line.section !== PANTRY) {
    line.section = PANTRY;
    line.amounts.clear();
    line.partial = false;
  }

  // Nothing is summed for the pantry: a line saying 7 tsp of olive oil is an
  // amount nobody buys, and the question the pantry asks is only "is there
  // some". Checked against the LINE, not the row, so that a stray row without
  // the flag cannot give a pantry line an amount it then half-prints.
  if (line.section === PANTRY) return line;

  const amount = rowAmount(row);

  if (amount === null) {
    line.partial = true;
  } else {
    line.amounts.set(amount.unit, (line.amounts.get(amount.unit) ?? 0) + amount.qty);
  }

  return line;
}

/**
 * Rounded once, where the total is produced. `shop_qty` is `numeric(_, 2)` and
 * `grams` `numeric(_, 1)`, and float addition over either can print
 * 60.300000000000004 — `round1` in `macros.ts` argues the case for grams; two
 * places here because a quarter onion is a real amount.
 */
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The week's shopping list, grouped by aisle, with the pantry last.
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
 * Empty sections are omitted rather than returned empty. A heading with nothing
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

  // Insertion-ordered, which is what makes `amounts` first-seen order and the
  // name tie-break below stable: both follow the week, Monday first.
  const tallies = new Map<string, Tally>();

  for (const day of days) {
    for (const cell of day.meals) {
      for (const row of byMeal.get(cell.meal.id) ?? []) {
        // A blank shop name falls back rather than keying the line on "": the
        // column is nullable, and an empty string in it is a null nobody typed.
        const key = normaliseKey(row.shopName?.trim() || row.name);

        if (!key) continue;

        tallies.set(key, fold(tallies.get(key), key, row));
      }
    }
  }

  const grouped = new Map<ShoppingSection, ShoppingLine[]>();

  for (const tally of tallies.values()) {
    const lines = grouped.get(tally.section) ?? [];

    lines.push({
      key: tally.key,
      name: tally.name,
      section: tally.section,
      amounts: [...tally.amounts].map(([unit, qty]) => ({ qty: round2(qty), unit })),
      partial: tally.partial,
      times: tally.times,
    });

    grouped.set(tally.section, lines);
  }

  const groups: ShoppingGroup[] = [];

  for (const section of SHOPPING_SECTIONS) {
    const lines = grouped.get(section);

    if (!lines) continue;

    // By name rather than by the order the week happens to plan its meals: the
    // list is read while walking an aisle, and Tuesday's dinner is not a
    // location. `key` carries the already-normalised name, so the comparison
    // sorts on what the eye reads rather than on the casing the seed used.
    lines.sort((a, b) => compareStrings(a.key, b.key));

    groups.push({ section, lines });
  }

  return groups;
}
