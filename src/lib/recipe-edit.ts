import type { Meal, MealIngredient } from "./db/schema";
import { MAX_MACRO_G } from "./profile-targets";
import { isMealId } from "./recipe";
import { SHOPPING_CATEGORIES, type ShoppingCategory } from "./shopping-list";
import { DECIMAL } from "./weigh-in";

/**
 * A recipe as the edit sheet holds it, and the refusal between that and the
 * rows — FUEL-147, Brand Guide § Recipe, *Editing, for the owner only*.
 *
 * ## A draft of strings, and one JSON field
 *
 * The sheet edits a list whose length the person changes — ingredients are
 * added, removed and moved — so the form is not a fixed set of named inputs.
 * The client holds a `RecipeDraft` in state and submits it as one JSON field;
 * every figure in it is the text that was typed, so "12,5" and "" arrive as
 * typed and are judged here rather than by a browser's number input.
 *
 * ## The trust boundary, for `profile-targets.ts`'s reason
 *
 * The draft crosses a Server Action, which anyone who can POST can reach. So
 * `parseRecipeEdit` takes `unknown`, and nothing it returns came through
 * without being read field by field: a wrong type, a missing key and an extra
 * one all end at a refusal or a value this module chose. What is bounded is
 * what the columns would otherwise round or refuse with a 500 — `numeric(6,1)`
 * macros, `numeric(7,1)` grams, `numeric(7,2)` and `> 0` shop counts, and the
 * CHECK that a unit needs a count.
 *
 * ## All or nothing, per field
 *
 * One bad field refuses the whole submission, and the errors come back keyed
 * by field — `ingredients.3.grams` for the fourth row's weight — so the sheet
 * can put each under the input it names. A recipe half-written would be a
 * method that disagrees with its ingredients.
 *
 * ## Pure, and safe for the browser
 *
 * Only type imports from the schema, and modules already free of pg-core: the
 * sheet reads the bounds and the draft's shape from here.
 */

/** One ingredient as typed. `id` is the stored row's, or null for a new one. */
export type IngredientDraft = {
  id: string | null;
  name: string;
  nonScaleMeasure: string;
  grams: string;
  shopName: string;
  shopQty: string;
  shopUnit: string;
  /** One of `SHOPPING_CATEGORIES`, or "" for none. */
  category: string;
  pantry: boolean;
};

export type RecipeDraft = {
  name: string;
  kcal: string;
  proteinG: string;
  fatG: string;
  carbG: string;
  method: string;
  notes: string;
  ingredients: IngredientDraft[];
};

/** The meal columns an edit writes. `slot_type` is not one of them. */
export type MealEdit = Pick<
  Meal,
  "name" | "kcal" | "proteinG" | "fatG" | "carbG" | "method" | "notes"
>;

/** An ingredient row as it will be written, less `meal_id` and `sort_order`. */
export type IngredientEdit = Pick<
  MealIngredient,
  | "name"
  | "nonScaleMeasure"
  | "grams"
  | "category"
  | "shopName"
  | "shopQty"
  | "shopUnit"
  | "pantry"
> & {
  /**
   * The stored row this was, when it was one. A claim, not a fact: the write
   * reuses it only if the meal really owns that row — see `saveRecipe`.
   */
  id: string | null;
};

export type RecipeEdit = { meal: MealEdit; ingredients: IngredientEdit[] };

/** Field key → what is wrong with it. `form` is the submission as a whole. */
export type RecipeErrors = Record<string, string>;

export type RecipeParseResult =
  | { ok: true; edit: RecipeEdit }
  | { ok: false; errors: RecipeErrors };

/** The form's one field, carrying the draft as JSON. */
export const RECIPE_FIELD = "recipe";

/**
 * Bounds. Each buys the typo, as `profile-targets.ts`'s do, and none is a
 * judgement about a meal: a dropped or doubled digit lands outside.
 */
export const MAX_MEAL_KCAL = 5000;
export const MAX_GRAMS = 9999.9;
export const MAX_SHOP_QTY = 9999.99;
export const MAX_INGREDIENTS = 60;
export const MAX_NAME = 120;
export const MAX_UNIT = 24;
export const MAX_PROSE = 20_000;

/**
 * The longest submission read at all — every field at its cap, with room for
 * the JSON around it. Checked on the raw string, before `JSON.parse` spends
 * anything on it.
 */
export const MAX_PAYLOAD =
  2 * MAX_PROSE + MAX_INGREDIENTS * (4 * MAX_NAME + MAX_UNIT + 400) + 2_000;

const INTEGER = /^\d+$/;

const round = (value: number, places: number): number => {
  const factor = 10 ** places;

  return Math.round(value * factor) / factor;
};

/** A decimal on `parseWeightKg`'s grammar, rounded before it is bounded. */
function decimal(value: string, places: number, min: number, max: number): number | undefined {
  const trimmed = value.trim();

  if (!DECIMAL.test(trimmed)) return undefined;

  const number = round(Number(trimmed.replace(",", ".")), places);

  return number >= min && number <= max ? number : undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Prose as stored: line endings made `\n`, trailing space dropped, and an
 * empty one null — the column's "no method", which the screen draws as
 * *No method recorded.* Lines are not trimmed: indentation is the author's.
 */
const prose = (value: string): string | null => {
  const normalised = value.replace(/\r\n?/g, "\n").trimEnd();

  return normalised.trim() === "" ? null : normalised;
};

/** A short optional field: trimmed, and empty is null. */
const optional = (value: string): string | null => value.trim() || null;

/**
 * The recipe in a submission, or what is wrong with it.
 *
 * `raw` is the form field as it arrived — a string of JSON, or anything else a
 * hand-rolled POST sent. A shape it cannot read is one `form` error, since no
 * field on screen is to blame.
 */
export function parseRecipeEdit(raw: unknown): RecipeParseResult {
  const malformed: RecipeParseResult = {
    ok: false,
    errors: { form: "The recipe could not be read." },
  };

  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD) return malformed;

  let draft: unknown;

  try {
    draft = JSON.parse(raw);
  } catch {
    return malformed;
  }

  if (!isRecord(draft) || !Array.isArray(draft.ingredients)) return malformed;

  const errors: RecipeErrors = {};

  const name = text(draft.name)?.trim();
  if (!name) errors.name = "Give the meal a name.";
  else if (name.length > MAX_NAME) errors.name = `At most ${MAX_NAME} characters.`;

  const kcalText = text(draft.kcal)?.trim() ?? "";
  const kcal = INTEGER.test(kcalText) ? Number(kcalText) : undefined;
  if (kcal === undefined || kcal > MAX_MEAL_KCAL) {
    errors.kcal = `A whole number from 0 to ${MAX_MEAL_KCAL}.`;
  }

  const grams = {} as Record<"proteinG" | "fatG" | "carbG", number | undefined>;
  for (const key of ["proteinG", "fatG", "carbG"] as const) {
    grams[key] = decimal(text(draft[key]) ?? "", 1, 0, MAX_MACRO_G);
    if (grams[key] === undefined) errors[key] = `From 0 to ${MAX_MACRO_G}g.`;
  }

  const method = text(draft.method);
  const notes = text(draft.notes);
  if (method === undefined || notes === undefined) return malformed;
  if (method.length > MAX_PROSE) errors.method = `At most ${MAX_PROSE} characters.`;
  if (notes.length > MAX_PROSE) errors.notes = `At most ${MAX_PROSE} characters.`;

  if (draft.ingredients.length > MAX_INGREDIENTS) {
    errors.ingredients = `At most ${MAX_INGREDIENTS} ingredients.`;
  }

  const ingredients: IngredientEdit[] = [];

  for (const [i, row] of draft.ingredients.slice(0, MAX_INGREDIENTS).entries()) {
    const parsed = parseIngredient(row, `ingredients.${i}`, errors);
    if (parsed === undefined) return malformed;
    ingredients.push(parsed);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    edit: {
      meal: {
        // Every one of these was checked above; `errors` is empty.
        name: name!,
        kcal: kcal!,
        proteinG: grams.proteinG!,
        fatG: grams.fatG!,
        carbG: grams.carbG!,
        method: prose(method),
        notes: prose(notes),
      },
      ingredients,
    },
  };
}

/**
 * One ingredient, writing its errors under `at`. Undefined when the row is not
 * a draft at all — the submission is then malformed rather than mistyped.
 */
function parseIngredient(
  row: unknown,
  at: string,
  errors: RecipeErrors,
): IngredientEdit | undefined {
  if (!isRecord(row)) return undefined;

  const fields = {
    name: text(row.name),
    nonScaleMeasure: text(row.nonScaleMeasure),
    grams: text(row.grams),
    shopName: text(row.shopName),
    shopQty: text(row.shopQty),
    shopUnit: text(row.shopUnit),
    category: text(row.category),
  };

  if (Object.values(fields).some((value) => value === undefined)) return undefined;
  if (typeof row.pantry !== "boolean") return undefined;

  // Narrowed by the check above; TypeScript does not follow it through
  // `Object.values`.
  const f = fields as Record<keyof typeof fields, string>;

  // A claim about which stored row this was. Anything but a uuid is no claim —
  // the row is new — rather than an error the person could do nothing about.
  const id = typeof row.id === "string" && isMealId(row.id) ? row.id : null;

  const name = f.name.trim();
  if (!name) errors[`${at}.name`] = "Name the ingredient, or remove it.";
  else if (name.length > MAX_NAME) errors[`${at}.name`] = `At most ${MAX_NAME} characters.`;

  for (const key of ["nonScaleMeasure", "shopName"] as const) {
    if (f[key].trim().length > MAX_NAME) errors[`${at}.${key}`] = `At most ${MAX_NAME} characters.`;
  }

  // Blank is "no weight" — "salt to taste" has none, and inventing one is worse.
  // Zero is refused: a weight of nothing is a blank typed as a number.
  const grams = f.grams.trim() === "" ? null : decimal(f.grams, 1, 0.1, MAX_GRAMS);
  if (grams === undefined) errors[`${at}.grams`] = `Blank, or from 0.1 to ${MAX_GRAMS}g.`;

  const shopQty = f.shopQty.trim() === "" ? null : decimal(f.shopQty, 2, 0.01, MAX_SHOP_QTY);
  if (shopQty === undefined) errors[`${at}.shopQty`] = `Blank, or from 0.01 to ${MAX_SHOP_QTY}.`;

  const shopUnit = optional(f.shopUnit);
  if (shopUnit && shopUnit.length > MAX_UNIT) {
    errors[`${at}.shopUnit`] = `At most ${MAX_UNIT} characters.`;
  } else if (shopUnit && shopQty === null) {
    // `meal_ingredients_shop_unit_needs_qty`, said where it can be fixed.
    errors[`${at}.shopUnit`] = "A unit needs a count.";
  }

  const category = f.category.trim().toLowerCase();
  if (category !== "" && !SHOPPING_CATEGORIES.includes(category as ShoppingCategory)) {
    errors[`${at}.category`] = "Choose an aisle from the list.";
  }

  return {
    id,
    name,
    nonScaleMeasure: optional(f.nonScaleMeasure),
    grams: grams ?? null,
    shopName: optional(f.shopName),
    shopQty: shopQty ?? null,
    shopUnit,
    category: category || null,
    pantry: row.pantry,
  };
}

/** A stored figure as the field shows it: `12.5`, and nothing for null. */
const figure = (value: number | null): string => (value === null ? "" : String(value));

/**
 * The stored recipe as the sheet opens on it.
 *
 * An aisle the list does not know is shown as the one it is shelved in —
 * `shopping-list.ts` files it under "other" — so the select never holds a
 * value it has no option for, and saving does not move the line.
 */
export function draftOf(
  meal: MealEdit,
  ingredients: readonly (IngredientEdit & { id: string })[],
): RecipeDraft {
  return {
    name: meal.name,
    kcal: String(meal.kcal),
    proteinG: String(meal.proteinG),
    fatG: String(meal.fatG),
    carbG: String(meal.carbG),
    method: meal.method ?? "",
    notes: meal.notes ?? "",
    ingredients: ingredients.map((row) => ({
      id: row.id,
      name: row.name,
      nonScaleMeasure: row.nonScaleMeasure ?? "",
      grams: figure(row.grams),
      shopName: row.shopName ?? "",
      shopQty: figure(row.shopQty),
      shopUnit: row.shopUnit ?? "",
      category: aisleOf(row.category),
      pantry: row.pantry,
    })),
  };
}

function aisleOf(category: string | null): string {
  if (category === null || category.trim() === "") return "";

  const normalised = category.trim().toLowerCase();

  return SHOPPING_CATEGORIES.includes(normalised as ShoppingCategory) ? normalised : "other";
}

/** A blank ingredient, as `Add ingredient` appends it. */
export const blankIngredient = (): IngredientDraft => ({
  id: null,
  name: "",
  nonScaleMeasure: "",
  grams: "",
  shopName: "",
  shopQty: "",
  shopUnit: "",
  category: "",
  pantry: false,
});
