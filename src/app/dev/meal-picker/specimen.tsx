"use client";

import { useState } from "react";

import { MealPicker, type PickableMeal } from "@/components/meal-picker";
import { Button } from "@/components/ui/button";
import type { MealSlot } from "@/lib/db/schema";

/**
 * The client half of the specimen: the state a controlled sheet needs.
 *
 * The picker takes `open` and `selectedMealId` from its caller — on the real
 * screen that caller is the swap flow (FUEL-23), and here it is this. Nothing
 * below is product code; it exists so the sheet can be opened and a tile tapped.
 */
export function PickerSpecimen({
  meals,
  slot,
  date,
  currentMealId,
}: {
  meals: readonly PickableMeal[];
  slot: MealSlot;
  date: string;
  currentMealId: string;
}) {
  const [open, setOpen] = useState(false);

  // Opens on the planned meal, which is also the ink tile — the state the mock
  // draws, where the ring and the ink coincide before anything is tapped.
  const [selected, setSelected] = useState<string>(currentMealId);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Swap
      </Button>

      <p className="text-slash text-text-secondary">
        Selected: {meals.find((meal) => meal.id === selected)?.name ?? "none"}
      </p>

      <MealPicker
        open={open}
        onOpenChange={setOpen}
        slot={slot}
        date={date}
        meals={meals}
        currentMealId={currentMealId}
        selectedMealId={selected}
        onSelect={setSelected}
      >
        {/* The totals and the confirm are FUEL-23's, and they now exist —
            see `components/swap-sheet.tsx`, which is this composition plus the
            preview arithmetic. This page stays as the PICKER's specimen: what
            it exercises is the sheet, the tiles and the slot filter on their
            own, without a day to total or an action to call. `/dev/right-now`
            is where the whole swap flow is opened and driven. */}
        <p className="text-slash text-text-tertiary">
          Day totals and the confirm sit here on the real screen — see
          /dev/right-now, case &ldquo;Swapped&rdquo;.
        </p>
      </MealPicker>
    </>
  );
}
