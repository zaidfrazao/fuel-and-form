import type { Metadata } from "next";
import Link from "next/link";

import { PickerSpecimen } from "./specimen";
import type { PickableMeal } from "@/components/meal-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { motifFor } from "@/lib/meal-motif";
import { FOCUS_RING, HOVER_LINK } from "@/lib/pointer";

/**
 * The meal picker specimen.
 *
 * Four of FUEL-22's acceptance criteria are claims jsdom cannot evaluate: that
 * the tiles are flat with one ink among them, that selection reads as an umber
 * inset rule rather than a fill, that the sheet is the only thing casting a
 * shadow, and that none of it turns into a modal at 375px. This is the surface
 * they are checked on — the same arrangement /dev/primitives makes for the tile
 * itself, one level up, with the sheet around it.
 *
 * ## The fixture is invented
 *
 * Testing Strategy § 1.5 and PRD § Risks: the repository is public and the
 * owner's real library stays in `docs/`. Every meal below is made up. They are
 * chosen to exercise the motif rules rather than to be appetising — a stew, a
 * chilli, a roll, a shake and a bar between them reach five of the eight marks,
 * and "Flexible dinner" reaches the sixth by having no recognisable word in it
 * at all.
 *
 * Not a product screen. Delete it once the swap flow is covered end to end by
 * the Playwright specs in FUEL-48, as with /dev/tokens.
 */
export const metadata: Metadata = {
  title: "Meal picker",
  robots: { index: false, follow: false },
};

const meal = (
  id: string,
  name: string,
  slotType: PickableMeal["slotType"],
  kcal: number,
  proteinG: number,
  isArchived = false,
): PickableMeal => ({ id, name, slotType, kcal, proteinG, isArchived });

const MEALS: readonly PickableMeal[] = [
  meal("d1", "Harissa Chicken & Rice", "dinner", 591, 62),
  meal("d2", "Butterbean & Chorizo Stew", "dinner", 648, 51),
  meal("d3", "Smoked Paprika Chilli", "dinner", 612, 48),
  meal("d4", "Miso Salmon with Greens", "dinner", 574, 55),
  meal("b1", "Overnight Oats — Fig & Honey", "breakfast", 431, 32),
  meal("b2", "Fried Eggs on Sourdough", "breakfast", 468, 29),
  meal("l1", "Halloumi & Slaw Ciabatta Roll", "lunch", 522, 27),
  meal("s1", "Cocoa Whey Shake", "snack", 214, 31),
  meal("s2", "Oat & Date Bar", "snack", 189, 8),
  meal("x1", "Flexible dinner", "extra", 0, 0),

  // Retired, and therefore not a candidate — but still resolvable by
  // `resolve-plan.ts` wherever a past day names it. The picker is the only
  // place `is_archived` is allowed to hide a row.
  meal("d0", "Retired Sausage Pasta", "dinner", 704, 39, true),
];

export default function MealPickerSpecimenPage() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10">
      {/* Wraps, because the title and the toggle pill together exceed 375px
          minus the gutters — and a specimen page that scrolls sideways is the
          one thing that would make the § Accessibility check it exists for
          impossible to read. */}
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-title">Meal picker</h1>
        <ThemeToggle />
      </header>

      <p className="text-body text-text-secondary">
        Open the sheet and check it against the swap mock in{" "}
        <code className="text-slash">docs/BRAND_GUIDE.html</code>: one ink tile among stone
        ones, an umber inset rule on the selection, and a shadow on the sheet and nowhere
        else. The archived meal must not appear in either filter.
      </p>

      <PickerSpecimen meals={MEALS} slot="dinner" date="Mon 10 Aug" currentMealId="d1" />

      <section className="flex flex-col gap-[14px]">
        <h2 className="text-micro uppercase text-text-secondary">Derived motifs</h2>

        {/* The derivation is the one piece of this task with no visual claim to
            check, so it is listed rather than left to be inferred from the
            tiles — a wrong mark on a tile is hard to spot and obvious here. */}
        <ul className="flex flex-col gap-2">
          {MEALS.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline justify-between gap-4 border-b border-border pb-2 text-slash"
            >
              <span>{entry.name}</span>
              <span className="text-text-tertiary">{motifFor(entry)}</span>
            </li>
          ))}
        </ul>
      </section>

      <Link
        href="/dev/primitives"
        className={`text-slash underline decoration-text-tertiary ${HOVER_LINK} ${FOCUS_RING}`}
      >
        The tile on its own → /dev/primitives
      </Link>
    </main>
  );
}
