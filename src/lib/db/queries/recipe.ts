import "server-only";

import { asc, eq } from "drizzle-orm";

import { isMealId } from "@/lib/recipe";
import { draftOf, type RecipeDraft, type RecipeEdit } from "@/lib/recipe-edit";
import { getDb } from "../index";
import { getPool } from "../pool";
import * as schema from "../schema";
import { scope } from "../scope";

/**
 * One meal and its ingredients, for `/recipe/[mealId]` — PRD § P12.
 *
 * Both reads go through `scope()`, so a meal another account owns is simply not
 * found: there is no ownership check here to forget, because the row is never
 * selected. That is also why the ingredients are read by `meal_id` under the
 * same scope rather than joined — `meal_ingredients` carries `user_id` for
 * exactly this (see its comment in `schema.ts`).
 *
 * The ingredient fields that cross are the kitchen's reading only. `shop_name`,
 * `shop_qty`, `shop_unit` and `pantry` are § P8's sentence about the same row,
 * and this screen is the one that must never print it.
 *
 * Archived meals are returned: a meal is archived rather than deleted so that
 * history naming it still resolves, and a recipe is part of what it names.
 */
export type RecipeIngredient = Pick<
  schema.MealIngredient,
  "id" | "name" | "grams" | "nonScaleMeasure"
>;

export type Recipe = {
  meal: Pick<
    schema.Meal,
    "id" | "name" | "slotType" | "kcal" | "proteinG" | "fatG" | "carbG" | "method" | "notes"
  >;
  ingredients: RecipeIngredient[];
};

export async function loadRecipe(userId: string, mealId: string): Promise<Recipe | undefined> {
  const rows = await readRecipe(userId, mealId);

  return rows && recipeOf(rows);
}

/**
 * The recipe, and the draft the owner's edit sheet opens on — FUEL-147.
 *
 * One read for both, so the owner's screen costs no second round trip. The
 * draft carries the shop's reading of each row, which `Recipe` deliberately
 * does not: the sheet edits both readings of a row because they are one row,
 * and the screen still prints only the kitchen's.
 */
export async function loadEditableRecipe(
  userId: string,
  mealId: string,
): Promise<{ recipe: Recipe; draft: RecipeDraft } | undefined> {
  const rows = await readRecipe(userId, mealId);

  return rows && { recipe: recipeOf(rows), draft: draftOf(rows.meal, rows.ingredients) };
}

type RecipeRows = { meal: schema.Meal; ingredients: schema.MealIngredient[] };

async function readRecipe(userId: string, mealId: string): Promise<RecipeRows | undefined> {
  // A malformed id is a cast error in Postgres, which would surface as a 500.
  if (!isMealId(mealId)) return undefined;

  const s = scope(userId, getDb());

  const [meal, ingredients] = await Promise.all([
    s.selectOne(schema.meals, eq(schema.meals.id, mealId)),
    s.select(schema.mealIngredients, eq(schema.mealIngredients.mealId, mealId), {
      // `id` breaks a tie so two rows sharing a sort order still come back in
      // the same order on every read.
      orderBy: [asc(schema.mealIngredients.sortOrder), asc(schema.mealIngredients.id)],
    }),
  ]);

  return meal && { meal, ingredients };
}

function recipeOf({ meal, ingredients }: RecipeRows): Recipe {
  return {
    meal: {
      id: meal.id,
      name: meal.name,
      slotType: meal.slotType,
      kcal: meal.kcal,
      proteinG: meal.proteinG,
      fatG: meal.fatG,
      carbG: meal.carbG,
      method: meal.method,
      notes: meal.notes,
    },
    ingredients: ingredients.map(({ id, name, grams, nonScaleMeasure }) => ({
      id,
      name,
      grams,
      nonScaleMeasure,
    })),
  };
}

/**
 * Writes an edited recipe — FUEL-147. False when the meal is not this user's.
 *
 * ## One transaction, and the meal row first
 *
 * The meal and its ingredient rows are one recipe: a committed macro change
 * beside the old ingredient list, or an empty list after a failed insert, is a
 * recipe that never existed. So all of it is one transaction on `getPool()` —
 * the HTTP driver cannot hold one — under the same `scope()` every other write
 * uses.
 *
 * The meal is updated first because the update is the ownership check. It is
 * scoped, so another account's meal id matches no row, the function returns
 * false having written nothing, and the caller cannot tell "not yours" from
 * "not there" — `scope.ts`'s rule. The composite foreign key
 * `meal_ingredients_meal_fk` refuses a foreign meal underneath as well.
 *
 * ## Replaced whole, but a row keeps its id
 *
 * The ticket's "full replace": every ingredient row the meal had is deleted and
 * the list is inserted in the sheet's order, so add, remove and reorder are one
 * code path and `sort_order` is simply the position.
 *
 * A row that was already there is re-inserted under its old id, because
 * FUEL-144's "on the counter" tick is keyed by the row id, and an edit to the
 * garlic's grams should not untick the garlic. The id is the CLIENT's claim,
 * so it is honoured only if it is one of the rows this delete just removed —
 * from this meal, under this scope. Anything else, and a second claim on the
 * same id, gets a fresh one.
 *
 * ## The empty list
 *
 * A meal with no ingredient rows is allowed (PRD § Risks), and `scope.insert`
 * with an empty array fails at the driver rather than doing nothing — so the
 * insert is skipped, not sent.
 *
 * ## What it does not touch
 *
 * `meal_logs`: a log carries its own copy of the four figures (FUEL-146), so
 * history is unchanged by a macro edit. `shopping_checks`: keyed by the
 * normalised shop name and shared across meals, so a renamed shop name leaves
 * that week's tick under the old name — accepted, PRD § P12.
 */
export async function saveRecipe(
  userId: string,
  mealId: string,
  edit: RecipeEdit,
): Promise<boolean> {
  if (!isMealId(mealId)) return false;

  return getPool().transaction(async (tx) => {
    const s = scope(userId, tx);

    const [meal] = await s.update(schema.meals, edit.meal, eq(schema.meals.id, mealId));

    if (!meal) return false;

    const removed = await s.delete(
      schema.mealIngredients,
      eq(schema.mealIngredients.mealId, mealId),
    );

    const reusable = new Set(removed.map((row) => row.id));

    const rows = edit.ingredients.map(({ id, ...row }, sortOrder) => {
      // `delete` returns the set's only claim on an id; a second row claiming
      // it finds it gone.
      const kept = id !== null && reusable.delete(id);

      return { ...row, ...(kept ? { id } : {}), mealId, sortOrder };
    });

    if (rows.length > 0) await s.insert(schema.mealIngredients, rows);

    return true;
  });
}
