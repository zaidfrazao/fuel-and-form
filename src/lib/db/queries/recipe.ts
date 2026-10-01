import "server-only";

import { asc, eq } from "drizzle-orm";

import { isMealId } from "@/lib/recipe";
import { getDb } from "../index";
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

  if (!meal) return undefined;

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
