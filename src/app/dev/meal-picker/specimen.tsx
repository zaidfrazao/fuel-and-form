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
        {/* Where FUEL-32's day totals and FUEL-23's confirm will sit. Neither
            exists yet, and a disabled button standing in for them would claim
            this task ships a swap it does not. */}
        <p className="text-slash text-text-tertiary">
          Day totals and the confirm button land here — FUEL-32, then FUEL-23.
        </p>
      </MealPicker>
    </>
  );
}
