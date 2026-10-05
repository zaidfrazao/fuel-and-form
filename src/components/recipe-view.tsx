import type { ReactNode } from "react";

import { MealMacroGrid } from "@/components/macro-grid";
import { Blocks, Section } from "@/components/recipe-parts";
import { RecipePrep } from "@/components/recipe-prep";
import { Tile } from "@/components/tile";
import { UpLink } from "@/components/up-link";
import type { CalendarDate } from "@/lib/date";
import { startOfWeek } from "@/lib/date";
import type { Recipe } from "@/lib/db/queries/recipe";
import { motifFor } from "@/lib/meal-motif";
import { slotLabel } from "@/lib/now-display";
import { parseMethod, parseProse } from "@/lib/recipe";

/**
 * A meal's recipe — Brand Guide § Recipe, PRD § P12 (FUEL-143).
 *
 * The mock's Meal detail frame, top to bottom, with the method it never drew
 * continued below the ingredients. Kitchen order: the tile, the four figures,
 * the ingredients, the steps, the notes.
 *
 * A component rather than the page's body so `/dev/recipe` can render the
 * states the demo fixture never has — a meal with no method, no ingredients,
 * no notes — through exactly this code. Empty states are invisible to both the
 * visual suite (the fixture is always populated) and jsdom (no stylesheet).
 *
 * The ingredients and the method are `RecipePrep`'s, the one client island:
 * they tick (FUEL-144). Everything else here is drawn on the server.
 *
 * Takes the `Recipe` shape the query returns, so the kitchen's reading of an
 * ingredient is the only one that can reach it: the shop's columns are not in
 * the type.
 *
 * `edit` is the owner's Edit control (FUEL-147), passed in rather than built
 * here: it calls a Server Action, and importing one would drag `server-only`
 * into every test and specimen that renders this view.
 */
export function RecipeView({
  recipe,
  userId,
  date,
  edit,
}: {
  recipe: Recipe;
  /** Whose ticks — FUEL-144 keys the prep lists by the reader. */
  userId: string;
  /** The plan's date, when opened from it. Carries the up-link to that week. */
  date?: CalendarDate | null;
  /** The owner's Edit control, at the up-link row's right. Absent for a demo. */
  edit?: ReactNode;
}) {
  const { meal, ingredients } = recipe;
  const method = parseMethod(meal.method);
  const notes = parseProse(meal.notes);

  const upLink = (
    <UpLink pathname="/recipe/[mealId]" week={date ? startOfWeek(date) : undefined} />
  );

  const counts = [
    ingredients.length > 0 && plural(ingredients.length, "ingredient"),
    method && plural(method.steps.length, "step"),
  ].filter(Boolean);

  return (
    <>
      <header className="flex flex-col gap-4">
        {/* Wrapped only when there is a control to set beside the link, so a
            demo's header is the markup it always was. */}
        {edit ? (
          <div className="flex items-baseline justify-between gap-3">
            {upLink}
            {edit}
          </div>
        ) : (
          upLink
        )}

        {/* The mock's top bar: what the meal is, and what its figures are per. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-micro uppercase text-text-secondary">
            Meal · {slotLabel(meal.slotType)}
          </p>
          <p className="text-micro uppercase text-text-secondary">1 serving</p>
        </div>

        <Tile
          detail
          material="ink"
          name={meal.name}
          motif={motifFor(meal)}
          meta={counts.length > 0 ? counts.join(" · ") : undefined}
        />
      </header>

      <MealMacroGrid meal={meal} />

      <RecipePrep
        userId={userId}
        mealId={meal.id}
        date={date ?? null}
        ingredients={ingredients}
        method={method}
      />

      {notes.length > 0 && (
        <Section label="Notes">
          <Blocks blocks={notes} tone="secondary" />
        </Section>
      )}
    </>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
