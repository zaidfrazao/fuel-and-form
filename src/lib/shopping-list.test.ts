import { describe, expect, it } from "vitest";

import type { DayPlanOverride, Meal, MealSlot, PlanTemplateEntry } from "./db/schema";
import { type Plan, resolveWeek } from "./resolve-plan";
import { seedMeals } from "./seed/meals";
import {
  normaliseKey,
  PANTRY,
  SHOPPING_CATEGORIES,
  SHOPPING_SECTIONS,
  type ShoppingIngredient,
  shoppingList,
} from "./shopping-list";
import type { PlannedDay } from "./week-grid";

/**
 * FUEL-44 — the week's shopping, and the ways it can be quietly wrong.
 *
 * Gated at 100% for the reason `macros.ts` and `week-totals.ts` are: every
 * failure here prints a plausible line rather than a crash. A dropped
 * occurrence, a merged pair of distinct spices, a total that silently omits the
 * rows with no amount, a pantry staple summed into a figure nobody buys — each
 * produces a list that looks like a list, and is
 * discovered in the kitchen rather than in a review.
 *
 * ## The fixtures
 *
 * Two layers, deliberately.
 *
 * The swap case runs through the REAL resolver: a template, a dated override,
 * and `resolveWeek` between them. The first acceptance criterion is about
 * overrides reaching the list, and a hand-built `PlannedDay[]` would assert that
 * the fixture contained what the fixture was written to contain. Going through
 * `resolveWeek` is what makes it evidence.
 *
 * Everything else builds days directly, because the property under test is the
 * fold and the resolver is noise in front of it.
 *
 * Quantities are chosen so a wrong answer names its own cause: no two gram
 * figures are equal and no two sum to a third, so 150 can only be one mince and
 * 300 can only be two.
 *
 * Dates are the resolver's own fixture week — Monday 9 March 2026 — so a date
 * read across suites means the same day in both.
 */

const USER = "user-owner";
const PROGRAM_START = "2026-03-02"; // a Monday

const MON = "2026-03-09";
const TUE = "2026-03-10";
const THU = "2026-03-12";

const MONDAY = 1;
const TUESDAY = 2;
const THURSDAY = 4;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

type TestMeal = { id: string };

const chilli: TestMeal = { id: "chilli" };
const curry: TestMeal = { id: "curry" };
const oats: TestMeal = { id: "oats" };
/** Macros but no recipe — PRD § Risks' promise, and every seeded treat. */
const treat: TestMeal = { id: "treat" };

type Shop = Partial<Pick<ShoppingIngredient, "shopName" | "shopQty" | "shopUnit" | "pantry">>;

const ingredient = (
  mealId: string,
  name: string,
  grams: number | null,
  category: string | null,
  shop: Shop = {},
): ShoppingIngredient => ({
  mealId,
  name,
  grams,
  category,
  shopName: null,
  shopQty: null,
  shopUnit: null,
  pantry: false,
  ...shop,
});

const INGREDIENTS: ShoppingIngredient[] = [
  // The chilli and the curry share mince, spinach and garlic under identical
  // names, which is the "combined into one line" criterion's evidence. Garlic
  // is counted in cloves and the two recipes ask for different counts, so a
  // sum that took one row twice cannot land on the right figure by accident.
  ingredient("chilli", "Beef mince, 5% fat", 150, "meat"),
  ingredient("chilli", "Baby spinach", 40, "produce"),
  ingredient("chilli", "Garlic", null, "produce", { shopQty: 1, shopUnit: "clove" }),
  ingredient("chilli", "Ground cumin", null, "dry goods", { pantry: true }),
  ingredient("curry", "Beef mince, 5% fat", 125, "meat"),
  ingredient("curry", "Baby spinach", 40, "produce"),
  ingredient("curry", "Garlic", null, "produce", { shopQty: 2, shopUnit: "clove" }),
  ingredient("curry", "Ground cumin", null, "dry goods", { pantry: true }),
  ingredient("oats", "Whole oats", 60, "dry goods"),
  ingredient("oats", "Milk", null, "dairy", { shopQty: 200, shopUnit: "ml" }),
];

const day = (date: string, meals: TestMeal[]): PlannedDay<TestMeal> => ({
  date,
  meals: meals.map((meal, index) => ({
    slot: (["breakfast", "lunch", "dinner"] as const)[index % 3] as MealSlot,
    meal,
    source: "template",
    entryId: `entry-${date}-${index}`,
  })),
});

/** The list, flattened to the shape every assertion below reads. */
const lines = (days: readonly PlannedDay<TestMeal>[], rows = INGREDIENTS) =>
  shoppingList(days, rows).flatMap((group) =>
    group.lines.map((line) => ({
      section: group.section,
      key: line.key,
      name: line.name,
      amounts: line.amounts.map((amount) => `${amount.qty} ${amount.unit ?? "×"}`),
      partial: line.partial,
      times: line.times,
    })),
  );

/** Just the names, section by section — for the ordering cases. */
const shape = (days: readonly PlannedDay<TestMeal>[], rows = INGREDIENTS) =>
  shoppingList(days, rows).map(
    (group) => `${group.section}: ${group.lines.map((line) => line.name).join(", ")}`,
  );

const find = (days: readonly PlannedDay<TestMeal>[], name: string, rows = INGREDIENTS) =>
  lines(days, rows).find((line) => line.name === name);

/* -------------------------------------------------------------------------- */
/* The categories                                                             */
/* -------------------------------------------------------------------------- */

describe("SHOPPING_CATEGORIES", () => {
  it("covers every category the seeded library actually uses", () => {
    // `meal_ingredients.category` is nullable text with no enum behind it, so
    // there is no schema counterpart to check against the way SLOT_ORDER is
    // checked against `mealSlot`. The seed is the vocabulary instead: a sixth
    // aisle typed there would otherwise land silently in "other", which is a
    // shopping list that quietly stops having a section.
    const used = new Set(
      seedMeals.flatMap((meal) =>
        meal.ingredients.map((row) => row.category?.trim().toLowerCase() ?? "other"),
      ),
    );

    expect([...used].sort()).toEqual([...SHOPPING_CATEGORIES].sort());
  });

  it("lists the aisles in the order PRD § P8 names them", () => {
    expect(SHOPPING_CATEGORIES).toEqual(["produce", "dairy", "meat", "dry goods", "other"]);
  });

  it("draws the pantry after every aisle", () => {
    expect(SHOPPING_SECTIONS).toEqual([...SHOPPING_CATEGORIES, PANTRY]);
  });
});

/* -------------------------------------------------------------------------- */
/* The seeded library — FUEL-137's criteria, held on the real data            */
/* -------------------------------------------------------------------------- */

describe("the seeded library", () => {
  // Every seeded meal on one day: each row reaches the fold exactly once.
  const everything = [day(MON, seedMeals.map((meal) => ({ id: meal.key })))];
  const rows: ShoppingIngredient[] = seedMeals.flatMap((meal) =>
    meal.ingredients.map((row) => ({
      mealId: meal.key,
      name: row.name,
      grams: row.grams ?? null,
      category: row.category ?? null,
      shopName: row.shopName ?? null,
      shopQty: row.shopQty ?? null,
      shopUnit: row.shopUnit ?? null,
      pantry: row.pantry ?? false,
    })),
  );
  const list = lines(everything, rows);

  it("gives every line at most one amount, in one unit", () => {
    // Two units on a line print as "2 slices + 45g" — honest, and not a
    // count anyone can shop from. The seed is held to never producing one.
    expect(list.filter((line) => line.amounts.length > 1)).toEqual([]);
  });

  it("leaves no line outside the pantry partially counted", () => {
    // "20g +" is the right print for data that has a gap, and the seed should
    // not have gaps: every row of a counted line carries its amount.
    expect(list.filter((line) => line.amounts.length > 0 && line.partial)).toEqual([]);
  });

  it("agrees with itself about each shop name's pantry flag and aisle", () => {
    // First-seen decides a disagreement, which makes the answer depend on
    // which recipe the week happens to plan first. The seed must not disagree.
    const seen = new Map<string, string>();
    const clashes: string[] = [];

    for (const row of rows) {
      const key = normaliseKey(row.shopName ?? row.name);
      const where = row.pantry ? PANTRY : (row.category ?? "other");
      const first = seen.get(key);

      if (first === undefined) seen.set(key, where);
      else if (first !== where) clashes.push(`${key}: ${first} / ${where}`);
    }

    expect(clashes).toEqual([]);
  });

  it("merges the variants the ticket named into one line each", () => {
    const names = list.map((line) => line.name);

    for (const variant of [
      "Olive oil (for the fish)",
      "Olive oil (for the potatoes)",
      "Chilli flakes or cayenne",
      "Hot sauce (optional)",
      "Hot sauce or sriracha",
      "Berries, fresh or frozen",
      "Plain yoghurt",
    ]) {
      expect(names).not.toContain(variant);
    }

    for (const line of ["Olive oil", "Chilli flakes", "Hot sauce", "Frozen berries", "Plain Greek yoghurt"]) {
      expect(names.filter((name) => name === line)).toHaveLength(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 1 — the resolved, post-swap week                                 */
/* -------------------------------------------------------------------------- */

describe("a week containing a swap", () => {
  const meal = (id: string): Meal => ({
    id,
    userId: USER,
    name: id,
    slotType: "dinner",
    kcal: 500,
    proteinG: 40,
    fatG: 15,
    carbG: 45,
    method: null,
    notes: null,
    isArchived: false,
  });

  let nextEntry = 0;

  const entry = (dayOfWeek: number, slot: MealSlot, mealId: string): PlanTemplateEntry => {
    nextEntry += 1;

    return { id: `entry-${nextEntry}`, userId: USER, dayOfWeek, slot, mealId, sortOrder: 0 };
  };

  const override = (date: string, slot: MealSlot, mealId: string): DayPlanOverride => ({
    id: `override-${date}-${slot}`,
    userId: USER,
    date,
    slot,
    mealId,
    createdAt: new Date("2026-03-01T12:00:00Z"),
  });

  // Chilli on Monday, Tuesday and Thursday; nothing at the weekend.
  const TEMPLATE = [MONDAY, TUESDAY, THURSDAY].map((weekday) =>
    entry(weekday, "dinner", "chilli"),
  );

  const plan = (overrides: DayPlanOverride[] = []): Plan => ({
    programStartDate: PROGRAM_START,
    template: TEMPLATE,
    overrides,
    meals: [meal("chilli"), meal("curry")],
  });

  it("counts a meal once per planned occurrence, not once per recipe", () => {
    // Three chilli dinners is 450g of mince, not 150g. Deduplicating by meal
    // would shop for the recipe book instead of for the week.
    expect(find(resolveWeek(plan(), MON), "Beef mince, 5% fat")).toEqual({
      section: "meat",
      key: "beef mince, 5% fat",
      name: "Beef mince, 5% fat",
      amounts: ["450 g"],
      partial: false,
      times: 3,
    });
  });

  it("shops for the swapped-in meal and not the one it replaced", () => {
    // Tuesday's chilli becomes the curry. Two chillis and one curry: 300g of
    // mince from the chillis plus 125g from the curry.
    const swapped = resolveWeek(plan([override(TUE, "dinner", "curry")]), MON);

    expect(find(swapped, "Beef mince, 5% fat")?.amounts).toEqual(["425 g"]);

    // And the curry's own count reaches the sum: a clove from each chilli and
    // two from the curry. 3 would mean the swap was ignored; 6, that it was
    // added on top of the meal it replaced.
    expect(find(swapped, "Garlic")?.amounts).toEqual(["4 clove"]);
  });

  it("drops an ingredient's contribution when the swap removes its meal", () => {
    // Every chilli overridden away. Three curries.
    const overrides = [MON, TUE, THU].map((date) => override(date, "dinner", "curry"));
    const swapped = resolveWeek(plan(overrides), MON);

    expect(find(swapped, "Beef mince, 5% fat")?.amounts).toEqual(["375 g"]);
    expect(find(swapped, "Garlic")?.amounts).toEqual(["6 clove"]);
  });

  it("plans nothing for a week entirely before the program starts", () => {
    // `resolveSlot` returns nothing at all before `programStartDate`, so the
    // list is empty rather than a throw — the same defined behaviour § 1.1
    // case 9 pins one level down.
    expect(shoppingList(resolveWeek(plan(), "2026-02-16"), INGREDIENTS)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 2 — combining across recipes                                     */
/* -------------------------------------------------------------------------- */

describe("combining identical ingredients", () => {
  const week = [day(MON, [oats, chilli]), day(TUE, [curry])];

  it("combines one ingredient across two different recipes into one line", () => {
    expect(find(week, "Baby spinach")).toEqual({
      section: "produce",
      key: "baby spinach",
      name: "Baby spinach",
      amounts: ["80 g"],
      partial: false,
      times: 2,
    });
  });

  it("matches on name regardless of casing and surrounding whitespace", () => {
    const rows = [
      ingredient("chilli", "Baby spinach", 40, "produce"),
      ingredient("curry", "  BABY   spinach ", 30, "produce"),
    ];

    // One line, with the first-seen casing on it — the second row's shouting is
    // a data entry accident, not a second ingredient.
    expect(lines(week, rows)).toEqual([
      {
        section: "produce",
        key: "baby spinach",
        name: "Baby spinach",
        amounts: ["70 g"],
        partial: false,
        times: 2,
      },
    ]);
  });

  it("prints a padded name trimmed, even when the padded row is the first seen", () => {
    // First-seen casing is kept; first-seen PADDING is not. The name is
    // rendered, and a leading space in a shopping list is a misaligned row that
    // looks like a rendering bug. Asserted with the padded row first because
    // with it second the trim is unreachable — the case above would pass
    // against a version that never trimmed the displayed name at all.
    const rows = [
      ingredient("chilli", "  BABY   spinach ", 30, "produce"),
      ingredient("curry", "Baby spinach", 40, "produce"),
    ];

    // Trimmed, not otherwise rewritten: the inner run of spaces is left alone,
    // because collapsing it would be this file editing a name rather than
    // matching one, and `normalise` already handles the matching.
    expect(lines(week, rows).map((line) => [line.name, line.amounts])).toEqual([
      ["BABY   spinach", ["70 g"]],
    ]);
  });

  it("keeps ingredients whose names merely resemble each other apart", () => {
    // The deliberate limitation, pinned so it cannot be "fixed" by accident.
    // A matcher loose enough to merge "Olive oil (for the fish)" into "Olive
    // oil" merges the chillis too, and silently dropping one of a pair of
    // distinct spices is worse than printing an oil twice. The fix is a seed
    // edit — `shop_name` — and the case below is that fix.
    const rows = [
      ingredient("chilli", "Olive oil", null, "other"),
      ingredient("chilli", "Olive oil (for the fish)", null, "other"),
      ingredient("chilli", "Chilli flakes", null, "dry goods"),
      ingredient("chilli", "Chilli powder", null, "dry goods"),
    ];

    expect(shape([day(MON, [chilli])], rows)).toEqual([
      "dry goods: Chilli flakes, Chilli powder",
      "other: Olive oil, Olive oil (for the fish)",
    ]);
  });

  it("merges rows that name one shop item, under the shop name", () => {
    // FUEL-137. The variant keys and prints as its `shop_name`; the recipe's
    // own name, "(for the fish)" and all, stays in the recipe.
    const rows = [
      ingredient("chilli", "Olive oil", null, "other", { shopQty: 5, shopUnit: "ml" }),
      ingredient("curry", "Olive oil (for the fish)", null, "other", {
        shopName: "Olive oil",
        shopQty: 10,
        shopUnit: "ml",
      }),
    ];

    expect(lines(week, rows)).toEqual([
      {
        section: "other",
        key: "olive oil",
        name: "Olive oil",
        amounts: ["15 ml"],
        partial: false,
        times: 2,
      },
    ]);
  });

  it("names the line by its shop name even when the first row seen is the variant", () => {
    const rows = [
      ingredient("chilli", "Plain yoghurt", null, "dairy", {
        shopName: "  Plain Greek yoghurt ",
        shopQty: 15,
        shopUnit: "g",
      }),
      ingredient("curry", "Plain Greek yoghurt", 160, "dairy"),
    ];

    expect(lines(week, rows).map((line) => [line.key, line.name, line.amounts])).toEqual([
      ["plain greek yoghurt", "Plain Greek yoghurt", ["175 g"]],
    ]);
  });

  it("falls back to the name when the shop name is blank", () => {
    // Nullable, and an empty string there is a null nobody typed. Keying the
    // line on "" would fold every such row in the library into one.
    const rows = [
      ingredient("chilli", "Rocket", 10, "produce", { shopName: "  " }),
      ingredient("chilli", "Apple", null, "produce", { shopName: "", shopQty: 1 }),
    ];

    expect(shape([day(MON, [chilli])], rows)).toEqual(["produce: Apple, Rocket"]);
  });

  it("ignores ingredient rows whose meal the week does not plan", () => {
    // The read is one unqualified scoped select over the whole library, so the
    // filtering has to happen here. A list that shopped for meals nobody
    // planned would be wrong in the most expensive direction.
    expect(shape([day(MON, [oats])])).toEqual(["dairy: Milk", "dry goods: Whole oats"]);
  });

  it("ignores a row whose name is blank or only whitespace", () => {
    const rows = [
      ingredient("oats", "   ", 999, "produce"),
      ingredient("oats", "Milk", null, "dairy", { shopQty: 200, shopUnit: "ml" }),
    ];

    // An unnamed line is unshoppable, and folding them together under "" would
    // combine every blank row in the library into one nonsense entry.
    expect(shape([day(MON, [oats])], rows)).toEqual(["dairy: Milk"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 3 — summed amounts                                               */
/* -------------------------------------------------------------------------- */

describe("amounts", () => {
  const week = [day(MON, [chilli])];
  const three = [day(MON, [chilli]), day(TUE, [chilli]), day(THU, [chilli])];

  it("sums a counted amount into one figure rather than counting occurrences", () => {
    // FUEL-137's first criterion: "5 cloves", never "1 clove ×5".
    const rows = [ingredient("chilli", "Garlic", null, "produce", { shopQty: 1, shopUnit: "clove" })];

    expect(find(three, "Garlic", rows)).toEqual({
      section: "produce",
      key: "garlic",
      name: "Garlic",
      amounts: ["3 clove"],
      partial: false,
      times: 3,
    });
  });

  it("keeps a bare count unit-less, and adds fractions", () => {
    // Half a lemon twice is a lemon.
    const rows = [
      ingredient("chilli", "Lemon", null, "produce", { shopQty: 0.5 }),
      ingredient("curry", "Lemon", null, "produce", { shopQty: 0.5, shopUnit: "  " }),
    ];

    expect(find([day(MON, [chilli, curry])], "Lemon", rows)?.amounts).toEqual(["1 ×"]);
  });

  it("prefers the shop amount to the weight where a row has both", () => {
    // Butter's "1 tbsp for the base, plus 20g to finish" weighs 20 and shops
    // for 35. The weight is the recipe's; the shop amount is what to buy.
    const rows = [
      ingredient("chilli", "Butter", 20, "dairy", { shopQty: 35, shopUnit: "g" }),
      ingredient("curry", "Butter", 20, "dairy"),
    ];

    expect(find([day(MON, [chilli, curry])], "Butter", rows)?.amounts).toEqual(["55 g"]);
  });

  it("flags a row with no amount, and still sums the ones that have one", () => {
    // A bare "20g" would look exactly like a complete figure while understating
    // the shop by an unknown amount.
    const rows = [
      ingredient("chilli", "Butter", 20, "dairy"),
      ingredient("chilli", "Butter", null, "dairy"),
    ];

    expect(find(week, "Butter", rows)).toMatchObject({ amounts: ["20 g"], partial: true, times: 2 });
  });

  it("reports no amount at all when nothing that contributed had one", () => {
    const rows = [ingredient("chilli", "Fresh coriander", null, "produce")];

    expect(find(week, "Fresh coriander", rows)).toMatchObject({ amounts: [], partial: true });
  });

  it("keeps two units apart rather than adding them", () => {
    // Not a case the seed has — its test above forbids it — but the fold must
    // not add 2 slices to 45g, and must not drop either.
    const rows = [
      ingredient("chilli", "Ham", 45, "meat"),
      ingredient("curry", "Ham", null, "meat", { shopQty: 2, shopUnit: "slice" }),
      ingredient("oats", "Ham", 30, "meat"),
    ];

    expect(find([day(MON, [chilli, curry, oats])], "Ham", rows)?.amounts).toEqual([
      "75 g",
      "2 slice",
    ]);
  });

  it("keeps a summed amount to two decimal places", () => {
    // `grams` is numeric(_, 1) and `shop_qty` numeric(_, 2); float addition
    // over either prints 60.300000000000004, and a shopping list would.
    const grams = [ingredient("chilli", "Chia seeds", 20.1, "dry goods")];
    const counts = [ingredient("chilli", "Onion", null, "produce", { shopQty: 0.1 })];

    expect(find(three, "Chia seeds", grams)?.amounts).toEqual(["60.3 g"]);
    expect(find(three, "Onion", counts)?.amounts).toEqual(["0.3 ×"]);
  });
});

/* -------------------------------------------------------------------------- */
/* The pantry — FUEL-137                                                      */
/* -------------------------------------------------------------------------- */

describe("the pantry", () => {
  const week = [day(MON, [oats, chilli]), day(TUE, [curry])];

  it("shelves a pantry row after every aisle, whatever its category", () => {
    expect(shape(week)).toEqual([
      "produce: Baby spinach, Garlic",
      "dairy: Milk",
      "meat: Beef mince, 5% fat",
      "dry goods: Whole oats",
      "pantry: Ground cumin",
    ]);
  });

  it("sums nothing for a pantry line, and does not call it partial", () => {
    // Seven teaspoons of olive oil is not an amount anybody buys. What the
    // pantry asks is whether there is some — so no figure, and no "+" either.
    const rows = [
      ingredient("chilli", "Olive oil", null, "other", { pantry: true, shopQty: 5, shopUnit: "ml" }),
      ingredient("curry", "Olive oil", 10, "other", { pantry: true }),
    ];

    expect(lines([day(MON, [chilli, curry])], rows)).toEqual([
      { section: PANTRY, key: "olive oil", name: "Olive oil", amounts: [], partial: false, times: 2 },
    ]);
  });

  it("takes the pantry flag from the first row seen, like the aisle", () => {
    // Deterministic rather than right — the seed test above keeps the data
    // from disagreeing. A pantry line stays amount-free even when a later row
    // without the flag carries one.
    const pantryFirst = [
      ingredient("chilli", "Honey", null, "dry goods", { pantry: true }),
      ingredient("curry", "Honey", null, "dry goods", { shopQty: 1 }),
    ];
    const aisleFirst = [
      ingredient("chilli", "Honey", null, "dry goods", { shopQty: 1 }),
      ingredient("curry", "Honey", null, "dry goods", { pantry: true }),
    ];
    const both = [day(MON, [chilli, curry])];

    expect(find(both, "Honey", pantryFirst)).toMatchObject({ section: PANTRY, amounts: [] });
    expect(find(both, "Honey", aisleFirst)).toMatchObject({
      section: "dry goods",
      amounts: ["1 ×"],
      partial: true,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 4 — the aisles                                                   */
/* -------------------------------------------------------------------------- */

describe("grouping", () => {
  it("omits a section the week needs nothing from", () => {
    // A heading with nothing under it reads as a section that failed to load.
    expect(shape([day(MON, [oats])])).toEqual(["dairy: Milk", "dry goods: Whole oats"]);
  });

  it("sorts within an aisle by name and not by the order the week plans meals", () => {
    // Tuesday's dinner is not a location in a shop. The apple planned last
    // still comes first.
    const rows = [
      ingredient("chilli", "Rocket", 30, "produce"),
      ingredient("curry", "Apple", 100, "produce"),
    ];

    expect(shape([day(MON, [chilli]), day(TUE, [curry])], rows)).toEqual([
      "produce: Apple, Rocket",
    ]);
  });

  it("sorts by code point rather than by the ambient locale's collation", () => {
    // The fixture is chosen to DISCRIMINATE, which the obvious one does not:
    // apple / Apricot / Banana come out in the same order either way, so a test
    // built from them passes just as happily against `localeCompare` and pins
    // nothing. A leading accent is where the two rules part company — ICU files
    // "éclair" under E, ahead of the milk; code point puts U+00E9 after every
    // ASCII letter, behind it.
    //
    // Code point is the rule, for `resolve-plan.ts`'s reason: `localeCompare`
    // reads the ambient collation, so a list ordered by it reads differently on
    // the phone in the shop than it did on the laptop that planned the week.
    // An éclair at the bottom of the aisle is a smaller cost than a list whose
    // order depends on where it is being read.
    const rows = [
      ingredient("chilli", "Éclair", 60, "dairy"),
      ingredient("chilli", "Milk", 200, "dairy"),
      ingredient("chilli", "butter", 20, "dairy"),
    ];

    expect(shape([day(MON, [chilli])], rows)).toEqual(["dairy: butter, Milk, Éclair"]);
  });

  it("files an ingredient with no category under other", () => {
    const rows = [ingredient("chilli", "Worcestershire sauce", null, null)];

    expect(find([day(MON, [chilli])], "Worcestershire sauce", rows)?.section).toBe("other");
  });

  it("files an unrecognised category under other rather than inventing an aisle", () => {
    const rows = [ingredient("chilli", "Cod fillet", 165, "fishmonger")];

    expect(find([day(MON, [chilli])], "Cod fillet", rows)?.section).toBe("other");
  });

  it("reads a category regardless of its casing and padding", () => {
    const rows = [ingredient("chilli", "Cheddar", 30, "  DAIRY ")];

    expect(find([day(MON, [chilli])], "Cheddar", rows)?.section).toBe("dairy");
  });

  it("keeps one line in its first-seen aisle when two rows disagree", () => {
    // First-seen at least makes the answer deterministic instead of dependent
    // on the order Postgres returned the rows in — and it stays ONE line,
    // which is what the criterion asks.
    const rows = [
      ingredient("chilli", "Potatoes", 100, "produce"),
      ingredient("curry", "Potatoes", 250, "dry goods"),
    ];

    expect(lines([day(MON, [chilli]), day(TUE, [curry])], rows)).toEqual([
      {
        section: "produce",
        key: "potatoes",
        name: "Potatoes",
        amounts: ["350 g"],
        partial: false,
        times: 2,
      },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 5 — the empty and the absent                                     */
/* -------------------------------------------------------------------------- */

describe("weeks with nothing to shop for", () => {
  it("returns an empty list for a week with no planned meals", () => {
    expect(shoppingList([day(MON, []), day(TUE, [])], INGREDIENTS)).toEqual([]);
  });

  it("returns an empty list for no days at all", () => {
    expect(shoppingList([], INGREDIENTS)).toEqual([]);
  });

  it("returns an empty list when the library has no ingredient rows", () => {
    // PRD § Risks: "schema accepts a meal with macros and no ingredient rows,
    // so P8 can be seeded later without blocking P1-P6". A recipe-less library
    // is an empty list, not a crash.
    expect(shoppingList([day(MON, [oats, chilli])], [])).toEqual([]);
  });

  it("skips a planned meal that has no ingredient rows of its own", () => {
    // Every seeded treat is this shape today.
    expect(shape([day(MON, [treat, oats])])).toEqual(["dairy: Milk", "dry goods: Whole oats"]);
  });
});
