import { describe, expect, it } from "vitest";

import type { DayPlanOverride, Meal, MealSlot, PlanTemplateEntry } from "./db/schema";
import { type Plan, resolveWeek } from "./resolve-plan";
import { seedMeals } from "./seed/meals";
import {
  SHOPPING_CATEGORIES,
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
 * rows with no weight — each produces a list that looks like a list, and is
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

const ingredient = (
  mealId: string,
  name: string,
  grams: number | null,
  nonScaleMeasure: string | null,
  category: string | null,
): ShoppingIngredient => ({ mealId, name, grams, nonScaleMeasure, category });

const INGREDIENTS: ShoppingIngredient[] = [
  // The chilli and the curry share mince and spinach under identical names,
  // which is the "combined into one line" criterion's evidence.
  ingredient("chilli", "Beef mince, 5% fat", 150, "the size of your fist", "meat"),
  ingredient("chilli", "Baby spinach", 40, "a big handful", "produce"),
  ingredient("chilli", "Ground cumin", null, "1/2 tsp", "dry goods"),
  ingredient("curry", "Beef mince, 5% fat", 125, "a smaller fist", "meat"),
  ingredient("curry", "Baby spinach", 40, "a big handful", "produce"),
  ingredient("curry", "Ground cumin", null, "1 tsp", "dry goods"),
  ingredient("oats", "Whole oats", 60, "6 tbsp", "dry goods"),
  ingredient("oats", "Milk", 200, "just under 1 cup", "dairy"),
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
      category: group.category,
      name: line.name,
      grams: line.grams,
      gramsPartial: line.gramsPartial,
      measures: line.measures.map((measure) => `${measure.text} x${measure.times}`),
      times: line.times,
    })),
  );

/** Just the names, aisle by aisle — for the ordering cases. */
const shape = (days: readonly PlannedDay<TestMeal>[], rows = INGREDIENTS) =>
  shoppingList(days, rows).map(
    (group) => `${group.category}: ${group.lines.map((line) => line.name).join(", ")}`,
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
      category: "meat",
      name: "Beef mince, 5% fat",
      grams: 450,
      gramsPartial: false,
      measures: ["the size of your fist x3"],
      times: 3,
    });
  });

  it("shops for the swapped-in meal and not the one it replaced", () => {
    // Tuesday's chilli becomes the curry. Two chillis and one curry: 300g of
    // mince from the chillis plus 125g from the curry.
    const swapped = resolveWeek(plan([override(TUE, "dinner", "curry")]), MON);

    expect(find(swapped, "Beef mince, 5% fat")).toEqual({
      category: "meat",
      name: "Beef mince, 5% fat",
      grams: 425,
      gramsPartial: false,
      measures: ["the size of your fist x2", "a smaller fist x1"],
      times: 3,
    });

    // And the curry's own spice reaches the list at all, which is the half of
    // the criterion that a mince total alone would not prove.
    expect(find(swapped, "Ground cumin")?.measures).toEqual(["1/2 tsp x2", "1 tsp x1"]);
  });

  it("drops an ingredient entirely when the swap removes its only meal", () => {
    // Every chilli overridden away. Nothing left in the week needs mince.
    const overrides = [MON, TUE, THU].map((date) => override(date, "dinner", "curry"));
    const swapped = resolveWeek(plan(overrides), MON);

    expect(find(swapped, "Beef mince, 5% fat")?.grams).toBe(375);
    expect(find(swapped, "Ground cumin")?.measures).toEqual(["1 tsp x3"]);
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
      category: "produce",
      name: "Baby spinach",
      grams: 80,
      gramsPartial: false,
      measures: ["a big handful x2"],
      times: 2,
    });
  });

  it("matches on name regardless of casing and surrounding whitespace", () => {
    const rows = [
      ingredient("chilli", "Baby spinach", 40, "a big handful", "produce"),
      ingredient("curry", "  BABY   spinach ", 30, "a big handful", "produce"),
    ];

    // One line, with the first-seen casing on it — the second row's shouting is
    // a data entry accident, not a second ingredient.
    expect(lines(week, rows)).toEqual([
      {
        category: "produce",
        name: "Baby spinach",
        grams: 70,
        gramsPartial: false,
        measures: ["a big handful x2"],
        times: 2,
      },
    ]);
  });

  it("keeps ingredients whose names merely resemble each other apart", () => {
    // The deliberate limitation, pinned so it cannot be "fixed" by accident.
    // The seeded library really does contain all three olive oils and both
    // chillis; a matcher loose enough to merge the oils merges the chillis too,
    // and silently dropping one of a pair of distinct spices is worse than
    // printing an oil twice. The fix, when it comes, is a seed edit.
    const rows = [
      ingredient("chilli", "Olive oil", null, "1 tsp", "other"),
      ingredient("chilli", "Olive oil (for the fish)", null, "1 tsp", "other"),
      ingredient("chilli", "Chilli flakes", null, "1/2 tsp", "dry goods"),
      ingredient("chilli", "Chilli powder", null, "1 tsp", "dry goods"),
    ];

    expect(shape([day(MON, [chilli])], rows)).toEqual([
      "dry goods: Chilli flakes, Chilli powder",
      "other: Olive oil, Olive oil (for the fish)",
    ]);
  });

  it("ignores ingredient rows whose meal the week does not plan", () => {
    // The read is one unqualified scoped select over the whole library, so the
    // filtering has to happen here. A list that shopped for meals nobody
    // planned would be wrong in the most expensive direction.
    expect(shape([day(MON, [oats])])).toEqual(["dairy: Milk", "dry goods: Whole oats"]);
  });

  it("ignores a row whose name is blank or only whitespace", () => {
    const rows = [
      ingredient("oats", "   ", 999, "a mystery", "produce"),
      ingredient("oats", "Milk", 200, "just under 1 cup", "dairy"),
    ];

    // An unnamed line is unshoppable, and folding them together under "" would
    // combine every blank row in the library into one nonsense entry.
    expect(shape([day(MON, [oats])], rows)).toEqual(["dairy: Milk"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 3 — grams and non-scale measures                                 */
/* -------------------------------------------------------------------------- */

describe("quantities", () => {
  const week = [day(MON, [chilli])];

  it("sums the rows that carry a weight and flags the ones that do not", () => {
    // The real case: the seeded library has butter both with grams and without.
    // A bare "20g" would look exactly like a complete figure while understating
    // the shop by an unknown amount.
    const rows = [
      ingredient("chilli", "Butter", 20, "a knob", "dairy"),
      ingredient("chilli", "Butter", null, "for the pan", "dairy"),
    ];

    expect(find(week, "Butter", rows)).toEqual({
      category: "dairy",
      name: "Butter",
      grams: 20,
      gramsPartial: true,
      measures: ["a knob x1", "for the pan x1"],
      times: 2,
    });
  });

  it("reports no weight at all when nothing that contributed had one", () => {
    expect(find(week, "Ground cumin")).toEqual({
      category: "dry goods",
      name: "Ground cumin",
      grams: null,
      gramsPartial: true,
      measures: ["1/2 tsp x1"],
      times: 1,
    });
  });

  it("keeps a summed weight to one decimal place", () => {
    // `grams` is numeric(_, 1), so three 20.1g rows sum to 60.300000000000004
    // in JS and a shopping list can print it.
    const rows = Array.from({ length: 3 }, () =>
      ingredient("chilli", "Chia seeds", 20.1, "1 tbsp", "dry goods"),
    );

    expect(find(week, "Chia seeds", rows)?.grams).toBe(60.3);
  });

  it("counts a repeated measure rather than pretending to add it up", () => {
    // "a big handful x3" is shoppable. A parsed "3 handfuls" would be a guess
    // that happens to read well for handfuls and not at all for "to taste".
    const rows = [ingredient("chilli", "Salt and pepper", null, "to taste", "other")];

    const week = [day(MON, [chilli]), day(TUE, [chilli]), day(THU, [chilli])];

    expect(find(week, "Salt and pepper", rows)).toEqual({
      category: "other",
      name: "Salt and pepper",
      grams: null,
      gramsPartial: true,
      measures: ["to taste x3"],
      times: 3,
    });
  });

  it("lists distinct measures separately, in the order the week asks for them", () => {
    const rows = [
      ingredient("chilli", "Salt and pepper", null, "to taste, generously", "other"),
      ingredient("curry", "Salt and pepper", null, "to taste", "other"),
    ];

    expect(find([day(MON, [chilli]), day(TUE, [curry])], "Salt and pepper", rows)?.measures).toEqual(
      ["to taste, generously x1", "to taste x1"],
    );
  });

  it("carries no measure at all when the recipe defines none", () => {
    const rows = [ingredient("chilli", "Beef mince, 5% fat", 150, null, "meat")];

    expect(find(week, "Beef mince, 5% fat", rows)?.measures).toEqual([]);
  });

  it("treats a whitespace-only measure as no measure", () => {
    const rows = [ingredient("chilli", "Beef mince, 5% fat", 150, "   ", "meat")];

    expect(find(week, "Beef mince, 5% fat", rows)?.measures).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion 4 — the aisles                                                   */
/* -------------------------------------------------------------------------- */

describe("grouping", () => {
  it("groups the lines by category, in aisle order, names sorted within each", () => {
    expect(shape([day(MON, [oats, chilli]), day(TUE, [curry])])).toEqual([
      "produce: Baby spinach",
      "dairy: Milk",
      "meat: Beef mince, 5% fat",
      "dry goods: Ground cumin, Whole oats",
    ]);
  });

  it("omits an aisle the week needs nothing from", () => {
    // A heading with nothing under it reads as a section that failed to load.
    expect(shape([day(MON, [oats])])).toEqual(["dairy: Milk", "dry goods: Whole oats"]);
  });

  it("sorts within an aisle by name and not by the order the week plans meals", () => {
    // Tuesday's dinner is not a location in a shop. The apple planned last
    // still comes first.
    const rows = [
      ingredient("chilli", "Rocket", 30, "a handful", "produce"),
      ingredient("curry", "Apple", 100, "1 medium", "produce"),
    ];

    expect(shape([day(MON, [chilli]), day(TUE, [curry])], rows)).toEqual([
      "produce: Apple, Rocket",
    ]);
  });

  it("sorts without consulting the ambient locale", () => {
    // `localeCompare` would order these by the collation of whatever machine
    // ran it, which is a list that reads differently in the shop than it did on
    // the laptop that planned the week.
    const rows = [
      ingredient("chilli", "apple", 100, "1", "produce"),
      ingredient("chilli", "Banana", 120, "1", "produce"),
      ingredient("chilli", "Apricot", 60, "2", "produce"),
    ];

    // Code-point order on the normalised name: apple, apricot, banana.
    expect(shape([day(MON, [chilli])], rows)).toEqual(["produce: apple, Apricot, Banana"]);
  });

  it("files an ingredient with no category under other", () => {
    const rows = [ingredient("chilli", "Worcestershire sauce", null, "1 tsp", null)];

    expect(find([day(MON, [chilli])], "Worcestershire sauce", rows)?.category).toBe("other");
  });

  it("files an unrecognised category under other rather than inventing an aisle", () => {
    const rows = [ingredient("chilli", "Cod fillet", 165, "1 fillet", "fishmonger")];

    expect(find([day(MON, [chilli])], "Cod fillet", rows)?.category).toBe("other");
  });

  it("reads a category regardless of its casing and padding", () => {
    const rows = [ingredient("chilli", "Cheddar", 30, "a slice", "  DAIRY ")];

    expect(find([day(MON, [chilli])], "Cheddar", rows)?.category).toBe("dairy");
  });

  it("keeps one line in its first-seen aisle when two rows disagree", () => {
    // No such clash exists in the seed today. First-seen at least makes the
    // answer deterministic instead of dependent on the order Postgres returned
    // the rows in — and it stays ONE line, which is what the criterion asks.
    const rows = [
      ingredient("chilli", "Potatoes", 100, "1 small", "produce"),
      ingredient("curry", "Potatoes", 250, "2 medium", "dry goods"),
    ];

    expect(lines([day(MON, [chilli]), day(TUE, [curry])], rows)).toEqual([
      {
        category: "produce",
        name: "Potatoes",
        grams: 350,
        gramsPartial: false,
        measures: ["1 small x1", "2 medium x1"],
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
