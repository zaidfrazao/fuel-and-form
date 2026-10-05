"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { saveRecipe } from "@/lib/db/queries/recipe";
import { isMealId } from "@/lib/recipe";
import {
  MEAL_FIELD,
  parseRecipeEdit,
  RECIPE_FIELD,
  type RecipeErrors,
} from "@/lib/recipe-edit";

/**
 * Editing a recipe — FUEL-147, PRD § P12, Brand Guide § Recipe.
 *
 * `settings.ts`'s contract: a Server Action is a public endpoint, so the
 * session is resolved here rather than trusted from the caller, the submission
 * is parsed whole before anything touches a row, the write is `user_id`-scoped,
 * and nothing throws — the sheet needs a state to render.
 *
 * ## Owner only, decided here
 *
 * A demo session is shown no Edit control, and that is a courtesy, not the
 * rule. The rule is this check: a demo visitor can POST to this action as
 * easily as the owner can, and the meals in a demo account are copies of the
 * owner's program that the visit is there to read. So a demo session is
 * refused before its submission is even parsed.
 *
 * The meal is named by the form, which is the one thing a client must say —
 * there is no "today's meal" to derive it from. It is not trusted for that:
 * `saveRecipe`'s scoped update is the ownership check, and another account's
 * meal id is refused with the same answer as one that names nothing.
 */

/**
 * What the sheet renders. `undefined` before the first submission.
 *
 * `saved` carries a timestamp for `SettingsState`'s reason: two identical
 * saves must be two states, or the second closes nothing. `refused` is a demo
 * session, or a meal that is not this user's — the same answer for both, and
 * one the owner's sheet only meets if the meal was archived away under it.
 */
export type RecipeEditState =
  | { status: "saved"; at: number }
  | { status: "invalid"; errors: RecipeErrors }
  | { status: "refused" }
  | { status: "failed" }
  | undefined;

const FAILED: RecipeEditState = { status: "failed" };
const REFUSED: RecipeEditState = { status: "refused" };

export async function editRecipe(
  _previous: RecipeEditState,
  form: FormData,
): Promise<RecipeEditState> {
  try {
    const session = await getSession();

    if (!session) return FAILED;
    if (session.kind !== "owner") return REFUSED;

    const mealId = form.get(MEAL_FIELD);

    // Checked here as well as by `saveRecipe`, so a malformed id is refused
    // before the submission is parsed rather than after.
    if (typeof mealId !== "string" || !isMealId(mealId)) return REFUSED;

    const parsed = parseRecipeEdit(form.get(RECIPE_FIELD));

    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    if (!(await saveRecipe(session.userId, mealId, parsed.edit))) return REFUSED;

    // The recipe, `/plan`, `/` and `/shopping` all read the meal per request,
    // so the next render of any of them is the edited recipe.
    refresh();

    return { status: "saved", at: Date.now() };
  } catch (error) {
    console.error("Could not save the recipe.", error);

    return FAILED;
  }
}
