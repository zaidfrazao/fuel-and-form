import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageMain } from "@/components/page-main";
import { RecipeView } from "@/components/recipe-view";
import { getSession } from "@/lib/auth/session";
import { loadRecipe } from "@/lib/db/queries/recipe";
import { requestedWeek } from "@/lib/week-param";

/**
 * `/recipe/[mealId]` — a meal's recipe. PRD § P12, Brand Guide § Recipe
 * (FUEL-143).
 *
 * Level 2 under `/plan` (§ Navigation's route table), and the mock's Meal
 * detail frame: one column on the measure, the aside left standing empty at
 * ≥1272 as the D3 frame draws it.
 *
 * ## The 404s
 *
 * Three addresses get the same answer: an id that is not a uuid, a uuid that
 * names no meal, and a meal another account owns. `loadRecipe` returns nothing
 * for all three — the last because `scope()` never selects the row — so there
 * is no branch here that could tell a stranger which of the three it was.
 *
 * ## `?date=`
 *
 * The plan's date, when the recipe was opened from `/` or `/plan`. It sends the
 * up-link back to that week, and it is what FUEL-144's tick lists will key by.
 * Validated as a calendar date and otherwise dropped: a bad date is the
 * library's view of the meal, not an error.
 */
export const metadata: Metadata = {
  title: "Recipe · Fuel & Form",
  robots: { index: false, follow: false },
};

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ mealId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();

  if (!session) redirect("/login");

  const [{ mealId }, { date }] = await Promise.all([params, searchParams]);

  const recipe = await loadRecipe(session.userId, mealId);

  if (!recipe) notFound();

  return (
    <PageMain className="gap-7 py-8">
      <RecipeView recipe={recipe} date={requestedWeek(date)} />
    </PageMain>
  );
}
