import { describe, expect, it } from "vitest";

import { MAX_MACRO_G } from "./profile-targets";
import {
  blankIngredient,
  draftOf,
  type IngredientDraft,
  MAX_GRAMS,
  MAX_INGREDIENTS,
  MAX_MEAL_KCAL,
  MAX_NAME,
  MAX_PAYLOAD,
  MAX_PROSE,
  MAX_SHOP_QTY,
  MAX_UNIT,
  parseRecipeEdit,
  type RecipeDraft,
} from "./recipe-edit";

/**
 * The recipe edit's trust boundary — FUEL-147.
 *
 * The draft arrives as JSON from a Server Action anyone can POST to, so every
 * test here goes in as the string the form would send, not as an object.
 */

const ROW_ID = "3f2b8c1e-7d4a-4b9e-8c1f-2a6d5e4b3c21";

const ingredient = (over: Partial<IngredientDraft> = {}): IngredientDraft => ({
  ...blankIngredient(),
  id: ROW_ID,
  name: "Garlic",
  nonScaleMeasure: "2 cloves, minced",
  grams: "6",
  shopQty: "2",
  shopUnit: "clove",
  category: "produce",
  ...over,
});

const draft = (over: Partial<RecipeDraft> = {}): RecipeDraft => ({
  name: "Lean Beef Mince Chilli",
  kcal: "612",
  proteinG: "48.5",
  fatG: "14",
  carbG: "62",
  method: "Brown the mince.\nAdd the beans.\n\nJars keep 4 days.",
  notes: "",
  ingredients: [ingredient()],
  ...over,
});

const parse = (value: unknown) => parseRecipeEdit(JSON.stringify(value));

const errorsOf = (value: unknown) => {
  const result = parse(value);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors;
};

const editOf = (value: unknown) => {
  const result = parse(value);
  if (!result.ok) throw new Error(`expected a pass: ${JSON.stringify(result.errors)}`);
  return result.edit;
};

describe("parseRecipeEdit — the meal", () => {
  it("reads a valid draft into the columns' types", () => {
    expect(editOf(draft()).meal).toEqual({
      name: "Lean Beef Mince Chilli",
      kcal: 612,
      proteinG: 48.5,
      fatG: 14,
      carbG: 62,
      method: "Brown the mince.\nAdd the beans.\n\nJars keep 4 days.",
      notes: null,
    });
  });

  it("trims the name and refuses a blank or overlong one", () => {
    expect(editOf(draft({ name: "  Chilli  " })).meal.name).toBe("Chilli");
    expect(errorsOf(draft({ name: "   " }))).toHaveProperty("name");
    expect(errorsOf(draft({ name: "x".repeat(MAX_NAME + 1) }))).toHaveProperty("name");
    expect(editOf(draft({ name: "x".repeat(MAX_NAME) })).meal.name).toHaveLength(MAX_NAME);
  });

  it("takes calories as a whole number within the bound", () => {
    expect(editOf(draft({ kcal: "0" })).meal.kcal).toBe(0);
    expect(editOf(draft({ kcal: String(MAX_MEAL_KCAL) })).meal.kcal).toBe(MAX_MEAL_KCAL);

    for (const kcal of [String(MAX_MEAL_KCAL + 1), "612.5", "", "-1", "6l2"]) {
      expect(errorsOf(draft({ kcal })), kcal).toHaveProperty("kcal");
    }
  });

  it("takes either separator and rounds macros to one decimal before bounding them", () => {
    const meal = editOf(draft({ proteinG: "48,46", fatG: "14.05", carbG: "0" })).meal;

    expect(meal.proteinG).toBe(48.5);
    expect(meal.fatG).toBe(14.1);
    expect(meal.carbG).toBe(0);

    expect(editOf(draft({ carbG: String(MAX_MACRO_G) })).meal.carbG).toBe(MAX_MACRO_G);
    expect(errorsOf(draft({ carbG: "1000" }))).toHaveProperty("carbG");
    expect(errorsOf(draft({ fatG: "" }))).toHaveProperty("fatG");
    expect(errorsOf(draft({ proteinG: "1.2.3" }))).toHaveProperty("proteinG");
  });

  it("stores prose with \\n endings, trailing space dropped, and blank as null", () => {
    const meal = editOf(draft({ method: "  Step one.\r\nStep two.\r\n\r\n", notes: " \n " })).meal;

    // Leading indentation is the author's, and is kept.
    expect(meal.method).toBe("  Step one.\nStep two.");
    expect(meal.notes).toBeNull();
  });

  it("refuses prose over the cap", () => {
    expect(errorsOf(draft({ method: "x".repeat(MAX_PROSE + 1) }))).toHaveProperty("method");
    expect(errorsOf(draft({ notes: "x".repeat(MAX_PROSE + 1) }))).toHaveProperty("notes");
  });

  it("reports every bad field at once, keyed by field", () => {
    expect(Object.keys(errorsOf(draft({ name: "", kcal: "", fatG: "x" }))).sort()).toEqual([
      "fatG",
      "kcal",
      "name",
    ]);
  });
});

describe("parseRecipeEdit — ingredients", () => {
  it("reads a row into the columns' types, in the order given", () => {
    const edit = editOf(
      draft({
        ingredients: [
          ingredient({ name: " Garlic ", shopName: " Garlic bulb " }),
          ingredient({ id: null, name: "Salt", nonScaleMeasure: "to taste", grams: "", shopQty: "", shopUnit: "", category: "", pantry: true }),
        ],
      }),
    );

    expect(edit.ingredients).toEqual([
      {
        id: ROW_ID,
        name: "Garlic",
        nonScaleMeasure: "2 cloves, minced",
        grams: 6,
        shopName: "Garlic bulb",
        shopQty: 2,
        shopUnit: "clove",
        category: "produce",
        pantry: false,
      },
      {
        id: null,
        name: "Salt",
        nonScaleMeasure: "to taste",
        grams: null,
        shopName: null,
        shopQty: null,
        shopUnit: null,
        category: null,
        pantry: true,
      },
    ]);
  });

  it("accepts an empty list — a meal with macros and nothing else", () => {
    expect(editOf(draft({ ingredients: [] })).ingredients).toEqual([]);
  });

  it("refuses a nameless row under that row's key", () => {
    const errors = errorsOf(draft({ ingredients: [ingredient(), ingredient({ name: " " })] }));

    expect(errors).toEqual({ "ingredients.1.name": expect.any(String) });
  });

  it("bounds grams: blank is no weight, zero and overflow are refused, one decimal kept", () => {
    const at = (grams: string) => draft({ ingredients: [ingredient({ grams })] });

    expect(editOf(at("12,34")).ingredients[0]?.grams).toBe(12.3);
    expect(editOf(at(String(MAX_GRAMS))).ingredients[0]?.grams).toBe(MAX_GRAMS);
    expect(errorsOf(at("0"))).toHaveProperty(["ingredients.0.grams"]);
    expect(errorsOf(at("10000"))).toHaveProperty(["ingredients.0.grams"]);
    expect(errorsOf(at("a handful"))).toHaveProperty(["ingredients.0.grams"]);
  });

  it("bounds the shop count above zero, at two decimals", () => {
    const at = (shopQty: string) => draft({ ingredients: [ingredient({ shopQty })] });

    expect(editOf(at("0.5")).ingredients[0]?.shopQty).toBe(0.5);
    expect(editOf(at(String(MAX_SHOP_QTY))).ingredients[0]?.shopQty).toBe(MAX_SHOP_QTY);
    expect(errorsOf(at("0"))).toHaveProperty(["ingredients.0.shopQty"]);
    expect(errorsOf(at("0.001"))).toHaveProperty(["ingredients.0.shopQty"]);
  });

  it("refuses a unit without a count, as the column's CHECK would", () => {
    const errors = errorsOf(draft({ ingredients: [ingredient({ shopQty: "", shopUnit: "clove" })] }));

    expect(errors).toEqual({ "ingredients.0.shopUnit": "A unit needs a count." });
    expect(editOf(draft({ ingredients: [ingredient({ shopUnit: "" })] })).ingredients[0]?.shopUnit).toBeNull();
    expect(errorsOf(draft({ ingredients: [ingredient({ shopUnit: "x".repeat(MAX_UNIT + 1) })] }))).toHaveProperty(["ingredients.0.shopUnit"]);
  });

  it("caps the measure and the shop name", () => {
    const long = "x".repeat(MAX_NAME + 1);

    expect(errorsOf(draft({ ingredients: [ingredient({ nonScaleMeasure: long })] }))).toHaveProperty(["ingredients.0.nonScaleMeasure"]);
    expect(errorsOf(draft({ ingredients: [ingredient({ shopName: long })] }))).toHaveProperty(["ingredients.0.shopName"]);
  });

  it("takes an aisle from the list, in any case, and refuses any other", () => {
    expect(editOf(draft({ ingredients: [ingredient({ category: "Dry Goods" })] })).ingredients[0]?.category).toBe("dry goods");
    expect(errorsOf(draft({ ingredients: [ingredient({ category: "frozen" })] }))).toHaveProperty(["ingredients.0.category"]);
  });

  it("drops an id that is not a uuid rather than refusing the row", () => {
    expect(editOf(draft({ ingredients: [ingredient({ id: "row-1" })] })).ingredients[0]?.id).toBeNull();
  });

  it("refuses more than the cap", () => {
    const many = Array.from({ length: MAX_INGREDIENTS + 1 }, () => ingredient());

    expect(errorsOf(draft({ ingredients: many }))).toHaveProperty("ingredients");
    expect(editOf(draft({ ingredients: many.slice(1) })).ingredients).toHaveLength(MAX_INGREDIENTS);
  });
});

describe("parseRecipeEdit — a submission it cannot read", () => {
  const malformed = { form: expect.any(String) };

  it.each([
    ["not a string", 42],
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["no ingredient list", JSON.stringify({ ...draft(), ingredients: "none" })],
    ["a non-string method", JSON.stringify({ ...draft(), method: null })],
    ["a non-object row", JSON.stringify(draft({ ingredients: ["Garlic" as never] }))],
    ["a row missing a field", JSON.stringify({ ...draft(), ingredients: [{ ...ingredient(), grams: undefined }] })],
    ["a non-boolean pantry", JSON.stringify(draft({ ingredients: [ingredient({ pantry: "yes" as never })] }))],
    ["an oversized payload", " ".repeat(MAX_PAYLOAD + 1)],
  ])("refuses %s as the form, not a field", (_, raw) => {
    expect(parseRecipeEdit(raw)).toEqual({ ok: false, errors: malformed });
  });

  it("reads a missing figure as a mistyped field, not a malformed form", () => {
    const { kcal: _, ...rest } = draft();

    expect(errorsOf(rest)).toHaveProperty("kcal");
  });
});

describe("draftOf", () => {
  const meal = {
    name: "Chilli",
    kcal: 612,
    proteinG: 48.5,
    fatG: 14,
    carbG: 62,
    method: null,
    notes: "Freezes well.",
  };

  const row = {
    id: ROW_ID,
    name: "Garlic",
    nonScaleMeasure: null,
    grams: null,
    shopName: null,
    shopQty: 0.5,
    shopUnit: null,
    category: "Produce",
    pantry: false,
  };

  it("shows stored values as the text a field holds, and null as blank", () => {
    expect(draftOf(meal, [row])).toEqual({
      name: "Chilli",
      kcal: "612",
      proteinG: "48.5",
      fatG: "14",
      carbG: "62",
      method: "",
      notes: "Freezes well.",
      ingredients: [
        {
          id: ROW_ID,
          name: "Garlic",
          nonScaleMeasure: "",
          grams: "",
          shopName: "",
          shopQty: "0.5",
          shopUnit: "",
          category: "produce",
          pantry: false,
        },
      ],
    });
  });

  it("shows an aisle the list does not know as the one it is shelved in", () => {
    expect(draftOf(meal, [{ ...row, category: "frozen" }]).ingredients[0]?.category).toBe("other");
    expect(draftOf(meal, [{ ...row, category: " " }]).ingredients[0]?.category).toBe("");
  });

  it("round-trips: a stored recipe saved unchanged writes what it read", () => {
    const stored = { ...row, grams: 6, nonScaleMeasure: "2 cloves", category: "produce" };
    const edit = editOf(draftOf({ ...meal, method: "One.\nTwo." }, [stored]));

    expect(edit).toEqual({ meal: { ...meal, method: "One.\nTwo." }, ingredients: [stored] });
  });
});
