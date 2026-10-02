import type { Metadata } from "next";
import Link from "next/link";

import { PageMain } from "@/components/page-main";
import { RecipeView } from "@/components/recipe-view";
import type { Recipe } from "@/lib/db/queries/recipe";
import { FRAME } from "@/lib/frame";
import { FOCUS_RING, HOVER_GROUND } from "@/lib/pointer";
import { seedMeals } from "@/lib/seed/meals";

/**
 * The recipe specimen — FUEL-143.
 *
 * The demo fixture's meals are the seed library's, and every one of them has a
 * method, ingredients and notes, so `/recipe/[mealId]`'s empty states can never
 * be photographed there; jsdom can say the words are present but not how they
 * sit. This page draws them through the same `RecipeView` the route renders.
 *
 * The full cases are seed meals, not invented ones: the seed is public, holds
 * no body metric, and is the text the screen actually has to fit. The chilli
 * is the common shape and the longest ingredient list; the steak is the one
 * method that numbers its own steps under a table.
 */
export const metadata: Metadata = {
  title: "Recipe specimen",
  robots: { index: false, follow: false },
};

function fromSeed(key: string): Recipe {
  const seed = seedMeals.find((meal) => meal.key === key);
  if (!seed) throw new Error(`no seeded meal ${key}`);

  return {
    meal: {
      id: `specimen-${key}`,
      name: seed.name,
      slotType: seed.slotType,
      kcal: seed.kcal,
      proteinG: seed.proteinG,
      fatG: seed.fatG,
      carbG: seed.carbG,
      method: seed.method ?? null,
      notes: seed.notes ?? null,
    },
    ingredients: (seed.ingredients ?? []).map((row, i) => ({
      id: `${key}-${i}`,
      name: row.name,
      grams: row.grams ?? null,
      nonScaleMeasure: row.nonScaleMeasure ?? null,
    })),
  };
}

const CHILLI = fromSeed("beef-mince-chilli");

const CASES: Record<string, { label: string; note: string; recipe: Recipe }> = {
  chilli: {
    label: "Steps and a variant",
    note: "The seed's own shape: a line is a step, and the baked-potato variant after the blank line is prose under the steps.",
    recipe: CHILLI,
  },
  steak: {
    label: "Numbered, with a table",
    note: "The one method that numbers its own steps. The heat guide is read before step 1; '### Steps' is dropped because the Method label already says it.",
    recipe: fromSeed("steak-chips-peppercorn"),
  },
  "no-method": {
    label: "No method",
    note: "Ingredients and figures, no method. The section stays and says so — quietly, not as an error.",
    recipe: { ...CHILLI, meal: { ...CHILLI.meal, method: null } },
  },
  empty: {
    label: "Macros only",
    note: "PRD § Risks has always allowed a meal with macros and nothing else. Both sections say so, Notes is absent, and the tile has no slash line.",
    recipe: { ...CHILLI, meal: { ...CHILLI.meal, method: null, notes: null }, ingredients: [] },
  },
};

const DEFAULT_CASE = "chilli";

export default async function RecipeSpecimen({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const requested = (await searchParams).case ?? DEFAULT_CASE;
  const key = requested in CASES ? requested : DEFAULT_CASE;
  const current = CASES[key]!;

  return (
    <>
      {/* The screen first and the switcher after it, as `/dev/right-now` does
          and for its reason: nothing sits above the screen under test. The
          frame without the shell, so ≥1272 draws the measure where the route
          does and leaves the aside standing empty. */}
      <div className={FRAME}>
        <PageMain className="gap-7 py-8">
          <RecipeView recipe={current.recipe} userId="specimen" date="2026-03-11" />
        </PageMain>
      </div>

      <footer className="mx-auto flex max-w-[640px] flex-col gap-3 border-t border-border px-[22px] py-6">
        <p className="text-slash text-text-secondary">{current.note}</p>
        <nav aria-label="Cases" className="flex flex-wrap gap-2">
          {Object.entries(CASES).map(([id, { label }]) => (
            <Link
              key={id}
              href={`/dev/recipe?case=${id}`}
              aria-current={id === key ? "page" : undefined}
              className={`rounded-sm border border-border px-2 py-1 text-micro uppercase text-text-secondary aria-[current=page]:bg-ink aria-[current=page]:text-ink-fg ${HOVER_GROUND} hover:text-text-primary aria-[current=page]:hover:bg-ink/90 ${FOCUS_RING}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </footer>
    </>
  );
}
