import { Fragment, type ReactNode } from "react";

import { MealMacroGrid } from "@/components/macro-grid";
import { Tile } from "@/components/tile";
import { UpLink } from "@/components/up-link";
import type { CalendarDate } from "@/lib/date";
import { startOfWeek } from "@/lib/date";
import type { Recipe } from "@/lib/db/queries/recipe";
import { motifFor } from "@/lib/meal-motif";
import { slotLabel } from "@/lib/now-display";
import { type Block, type Inline, parseMethod, parseProse } from "@/lib/recipe";
import { cn } from "@/lib/utils";

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
 * Takes the `Recipe` shape the query returns, so the kitchen's reading of an
 * ingredient is the only one that can reach it: the shop's columns are not in
 * the type.
 */
export function RecipeView({
  recipe,
  date,
}: {
  recipe: Recipe;
  /** The plan's date, when opened from it. Carries the up-link to that week. */
  date?: CalendarDate | null;
}) {
  const { meal, ingredients } = recipe;
  const method = parseMethod(meal.method);
  const notes = parseProse(meal.notes);

  const counts = [
    ingredients.length > 0 && plural(ingredients.length, "ingredient"),
    method && plural(method.steps.length, "step"),
  ].filter(Boolean);

  return (
    <>
      <header className="flex flex-col gap-4">
        <UpLink pathname="/recipe/[mealId]" week={date ? startOfWeek(date) : undefined} />

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

      <Section label="Ingredients">
        {ingredients.length > 0 ? (
          <ul className="flex flex-col">
            {ingredients.map((row) => (
              <li
                key={row.id}
                className="flex min-h-[46px] items-start gap-3 border-b border-border py-[11.5px] last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-text-primary">{row.name}</span>
                  {row.nonScaleMeasure && (
                    <span className="text-body text-text-secondary">{row.nonScaleMeasure}</span>
                  )}
                </span>
                {row.grams !== null && (
                  <span className="shrink-0 text-body tabular-nums text-text-secondary">
                    {row.grams} g
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No ingredients recorded.</Quiet>
        )}
      </Section>

      <Section label="Method">
        {method ? (
          <div className="flex flex-col gap-5">
            {method.before.length > 0 && <Blocks blocks={method.before} />}

            <ol className="flex flex-col gap-3">
              {method.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-body text-text-primary">
                  {/* The number is its own column so a wrapped line hangs under
                      the step's text, not under its number. Hidden from the
                      tree: an `<ol>` already announces "1 of 10". */}
                  <span
                    aria-hidden
                    className="w-[2ch] shrink-0 text-right tabular-nums text-text-secondary"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Runs inline={step} />
                  </span>
                </li>
              ))}
            </ol>

            {method.after.length > 0 && <Blocks blocks={method.after} tone="secondary" />}
          </div>
        ) : (
          <Quiet>No method recorded.</Quiet>
        )}
      </Section>

      {notes.length > 0 && (
        <Section label="Notes">
          <Blocks blocks={notes} tone="secondary" />
        </Section>
      )}
    </>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A micro label over its content — 14px between, § Spacing & Layout. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[14px]">
      <h2 className="text-micro uppercase text-text-secondary">{label}</h2>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-body text-text-secondary">{children}</p>;
}

/** Bold and italic, and nothing else — `lib/recipe.ts`'s ceiling. */
function Runs({ inline }: { inline: readonly Inline[] }) {
  return inline.map((run, i) => {
    if (run.strong) return <strong key={i} className="font-semibold">{run.text}</strong>;
    if (run.em) return <em key={i}>{run.text}</em>;
    return <Fragment key={i}>{run.text}</Fragment>;
  });
}

function Blocks({
  blocks,
  tone = "primary",
}: {
  blocks: readonly Block[];
  tone?: "primary" | "secondary";
}) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <h3 key={i} className="text-micro uppercase text-text-secondary">
                {block.text}
              </h3>
            );

          case "paragraph":
            return (
              <p
                key={i}
                className={cn(
                  "text-body",
                  tone === "primary" ? "text-text-primary" : "text-text-secondary",
                )}
              >
                <Runs inline={block.inline} />
              </p>
            );

          case "table":
            return (
              <table key={i} className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    {block.head.map((cell, c) => (
                      <th
                        key={c}
                        scope="col"
                        className="pb-1 pr-3 text-micro font-normal uppercase text-text-secondary last:pr-0"
                      >
                        <Runs inline={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r} className="border-t border-border">
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className="py-[11.5px] pr-3 align-top text-body text-text-primary last:pr-0"
                        >
                          <Runs inline={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
        }
      })}
    </div>
  );
}
