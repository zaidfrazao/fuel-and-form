"use client";

import { type ReactNode, useState } from "react";

import { motifFor } from "@/lib/meal-motif";
import { Sheet } from "@/components/ui/sheet";
import { Tile } from "@/components/tile";
import { Button } from "@/components/ui/button";
import type { Meal, MealSlot } from "@/lib/db/schema";
import { slotLabel } from "@/lib/now-display";

/**
 * The meal picker — PRD § P2, Brand Guide § Seven screens → Swap.
 *
 * A bottom sheet of candidate meals as flat bento tiles, opened from a grid cell
 * (FUEL-28) or from Swap on `/`. Choosing one is all this does: the dated
 * override is FUEL-23's write, and the resulting day totals are FUEL-32's panel.
 * Both land in `children`, which is the foot of the sheet — § Progressive
 * Disclosure puts the totals *inside* the sheet, above the confirm button.
 *
 * ## Controlled, and given its meals
 *
 * No database handle, no session, no server action. It takes the library it
 * should show and reports which tile was tapped, for the same reason
 * `right-now.tsx` takes a resolved view: every acceptance criterion here is
 * about what ends up on the screen, and a component that fetched its own rows
 * could not be rendered by the hermetic suite at all.
 *
 * ## The two rules the ticket leaves implicit
 *
 * **Which tile is ink.** § Tiles allows `ink` or `surface` and the mock draws
 * exactly one ink tile per sheet, so something has to choose it. It is the meal
 * currently planned for the slot — the one being swapped *away from* — and it
 * stays ink as the selection moves, because it is an anchor and not an echo of
 * the selection. When the planned meal is not in the visible list (archived, or
 * filtered out under the slot filter) the first tile takes ink instead, so
 * "exactly one ink tile" holds in every state rather than in the common one.
 *
 * **One umber element** (§ The Four Rules). That element is the selection ring,
 * which `Tile` draws as a 1.5px `accent` inset — never a fill, so an ink tile
 * stays ink under it. Nothing else in this sheet may reach for `accent`; the
 * filter toggle is a Text button and the confirm the caller passes in is ink.
 *
 * ## Archived meals
 *
 * Excluded here, unconditionally, before the slot filter — a retired meal is not
 * a candidate. It is *not* excluded from history: `resolve-plan.ts` resolves
 * archived meals by design, which is what lets last month's export still name
 * the dinner that was eaten. `meals.is_archived` exists precisely so a library
 * entry can be retired without deleting the record of having eaten it
 * (schema.ts), and this component is the half of that which makes retiring
 * visible.
 */

/** What the picker needs of a meal. The library rows satisfy it as they are. */
export type PickableMeal = Pick<
  Meal,
  "id" | "name" | "slotType" | "kcal" | "proteinG" | "isArchived"
>;

export type MealPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The slot being filled. Sets the default filter and names the sheet. */
  slot: MealSlot;
  /** The right of the topbar — `Mon 10 Aug`, from `dayLabel`. */
  date?: ReactNode;
  /** The whole library. Archived rows may be included; they are filtered here. */
  meals: readonly PickableMeal[];
  /** What is planned for this slot today. The ink anchor. */
  currentMealId?: string | null;
  /** The chosen tile, if any. Controlled by the caller. */
  selectedMealId?: string | null;
  onSelect: (mealId: string) => void;
  /** The foot of the sheet: FUEL-32's day totals, then FUEL-23's confirm. */
  children?: ReactNode;
};

export function MealPicker({
  open,
  onOpenChange,
  slot,
  date,
  meals,
  currentMealId,
  selectedMealId,
  onSelect,
  children,
}: MealPickerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Swap ${slotLabel(slot).toLowerCase()}`}
      meta={date}
    >
      {/* Its own component so that its `showAll` state unmounts with the sheet.
          Radix drops the portal's subtree on close, so reopening starts back at
          the slot filter — which is what "by default" in the acceptance
          criterion means. State hoisted into MealPicker would survive the close
          and quietly stop defaulting after the first time the toggle was used. */}
      <Candidates
        slot={slot}
        meals={meals}
        currentMealId={currentMealId}
        selectedMealId={selectedMealId}
        onSelect={onSelect}
      />

      {children}
    </Sheet>
  );
}

function Candidates({
  slot,
  meals,
  currentMealId,
  selectedMealId,
  onSelect,
}: Pick<
  MealPickerProps,
  "slot" | "meals" | "currentMealId" | "selectedMealId" | "onSelect"
>) {
  const [showAll, setShowAll] = useState(false);

  const label = slotLabel(slot).toLowerCase();
  const library = meals.filter((meal) => !meal.isArchived);
  const visible = showAll ? library : library.filter((meal) => meal.slotType === slot);

  // The anchor, resolved once. `findIndex` rather than a comparison per tile so
  // that the fallback to the first tile is a single decision — comparing ids
  // inside the map would leave no ink tile at all whenever the planned meal is
  // filtered out, which is exactly the case the fallback exists for.
  const anchor = visible.findIndex((meal) => meal.id === currentMealId);
  const inkIndex = anchor === -1 ? 0 : anchor;

  return (
    <div className="flex flex-col gap-5">
      {visible.length > 0 ? (
        <div role="group" aria-label={`Meals for ${label}`} className="grid grid-cols-2 gap-[10px]">
          {visible.map((meal, index) => (
            <Tile
              key={meal.id}
              as="button"
              name={meal.name}
              motif={motifFor(meal)}
              material={index === inkIndex ? "ink" : "surface"}
              meta={`${meal.kcal} kcal · P ${meal.proteinG}`}
              // Passed for every tile, selected or not: `Tile` maps this to
              // `aria-pressed`, and omitting it on the unselected ones would
              // announce them as ordinary buttons beside one pressed toggle.
              selected={meal.id === selectedMealId}
              onClick={() => onSelect(meal.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-body text-text-secondary">
          {showAll
            ? "No meals in the library yet."
            : `No ${label} meals in the library yet.`}
        </p>
      )}

      {/* A Text button, not tabs — § Progressive Disclosure has no tabs within a
          screen, and this is one control with two states rather than two peers.
          `self-start` keeps its 46px box off the full width so the tap target
          sits under the grid rather than spanning it. */}
      <Button
        variant="link"
        className="self-start px-0"
        aria-pressed={showAll}
        onClick={() => setShowAll((all) => !all)}
      >
        {showAll ? `Show ${label} only` : "Show all meals"}
      </Button>
    </div>
  );
}
