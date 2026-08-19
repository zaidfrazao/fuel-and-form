"use client";

import { useState } from "react";

import { KeyValueGrid } from "@/components/kv-grid";
import { MealPicker, type PickableMeal } from "@/components/meal-picker";
import { Button } from "@/components/ui/button";
import type { MealSlot } from "@/lib/db/schema";
import { figure, signed } from "@/lib/format";
import {
  deltaFromTarget,
  type MacroBearing,
  type MacroTarget,
  summariseDay,
} from "@/lib/macros";
import { dayLabel } from "@/lib/now-display";
import type { CalendarDate } from "@/lib/date";

/**
 * The swap flow — FUEL-23, wrapping FUEL-22's picker in the two things it left
 * to this task: the resulting day totals, and the confirm that writes.
 *
 * ## Everything below the tiles is P4's criterion, not decoration
 *
 * *"A swap preview shows the resulting day totals BEFORE the swap is
 * confirmed"*, and § Progressive Disclosure puts them "*inside* the sheet, above
 * the confirm button". So the grid sits between the two, and it is the whole
 * reason the swap is safe to make: PRD § Problem Statement names "swaps silently
 * break macros" as one of the four problems the app exists for.
 *
 * ## The preview costs no round trip, and no `Plan` crosses the wire
 *
 * The obvious implementation asks the server what the day would total. It is
 * also the wrong one: the figures have to move on the frame the tile is tapped,
 * and a request per tap over a kitchen connection is exactly the latency the
 * PRD's 300ms budget rules out.
 *
 * The way out is that the browser already holds the answer's inputs. Every meal
 * planned today is on the resolved view — `right-now.tsx` renders their names
 * and macros — and `ResolvedMeal` satisfies `macros.ts`'s `PlannedMacros`
 * structurally. So the preview is `summariseDay` over today's meals with the
 * chosen one substituted: the same arithmetic, from the same module, that the
 * server would run. Nothing is fetched, and the day's plan — template rows,
 * override rows, the program start date — stays where it is.
 *
 * The substitution is done here rather than through `previewDayTotals`, which
 * takes a whole `Plan` and would therefore require shipping one. Both build the
 * same list and hand it to the same summariser; this one starts from a resolved
 * day instead of resolving one.
 *
 * ## One umber element
 *
 * None here. § The Four Rules allows the picker exactly one — the selection ring
 * `Tile` draws — and this component adds no colour of its own: the confirm is
 * `ink`, the totals are text, and an over-target kcal figure takes `error` on
 * the same terms the day-complete summary gives it.
 */

/**
 * A meal already planned for today, as the resolved view carries it.
 *
 * `PlannedMacros` plus the meal's id, which totalling does not need and the
 * picker does: the meal currently in the slot is the sheet's ink anchor, and it
 * is identified by id rather than by position. `ResolvedMeal` satisfies this as
 * it stands, so `right-now.tsx` passes its resolved items through unchanged.
 */
export type PlannedMeal = {
  slot: MealSlot;
  meal: MacroBearing & { id: string; name: string };
};

/**
 * A candidate the sheet can both DRAW and TOTAL.
 *
 * The picker needs a name, a slot type and the two headline figures; the
 * preview needs all four macros. Neither type is a superset of the other, so
 * the sheet asks for both rather than casting one into the other — a cast here
 * would compile against a row missing `fatG` and produce a totals grid that was
 * quietly wrong in two of its four columns.
 */
export type SwappableMeal = PickableMeal & MacroBearing;

export type SwapSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The slot being swapped, for the sheet's title and the picker's filter. */
  slot: MealSlot;
  /** The date the swap lands on — the resolved day, not the browser's clock. */
  date: CalendarDate;
  /** Every meal planned today, in slot order. The base the preview edits. */
  planned: readonly PlannedMeal[];
  /** The whole library. Archived rows are filtered by the picker. */
  meals: readonly SwappableMeal[];
  /** The four target figures, so the preview can show a signed delta. */
  target: MacroTarget;
  /**
   * The chosen meal, once the confirm is tapped.
   *
   * The sheet writes nothing itself. It asks a question and reports the answer;
   * `right-now.tsx` owns every call to a Server Action, which is what keeps the
   * optimistic layer and the "Try again" banner in one place — a retry has to
   * re-run the same swap, and only the screen holding the failure knows how.
   *
   * It also means this component can be rendered by a test without mocking a
   * Server Action, which is the same reason `right-now.tsx` takes a resolved
   * view rather than fetching one.
   */
  onConfirm: (meal: SwappableMeal) => void;
};

/**
 * What the day would total with `mealId` in `slot`.
 *
 * The chosen meal REPLACES the slot's current entry rather than being appended,
 * which is what makes this a swap and not an extra meal. When the slot holds
 * nothing today — the template leaves it empty and this swap is filling it — the
 * meal is added, and the totals go up by the whole of it. Both cases fall out of
 * the same fold rather than needing a branch, because a slot that is not present
 * simply never matches.
 */
function previewOf(
  planned: readonly PlannedMeal[],
  slot: MealSlot,
  candidate: MacroBearing,
) {
  const replaced = planned.map((item) =>
    item.slot === slot ? { slot, meal: candidate } : item,
  );

  const holds = planned.some((item) => item.slot === slot);

  return summariseDay(holds ? replaced : [...replaced, { slot, meal: candidate }]);
}

export function SwapSheet({
  open,
  onOpenChange,
  slot,
  date,
  planned,
  meals,
  target,
  onConfirm,
}: SwapSheetProps) {
  /*
   * The selection, held here rather than in `right-now.tsx`.
   *
   * It is a question the sheet is asking and answers when it closes, so it has
   * no meaning outside one — and hoisting it would mean a sheet reopened after
   * a cancelled swap started with the abandoned choice still ringed, which
   * reads as the swap having half-happened.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = meals.find((meal) => meal.id === selectedId);

  // What is planned for the slot right now — the ink anchor in the picker, and
  // the meal a confirm would displace.
  const current = planned.find((item) => item.slot === slot)?.meal;

  const totals = selected ? previewOf(planned, slot, selected) : summariseDay(planned);

  const delta = deltaFromTarget(totals, target);

  function close(next: boolean) {
    onOpenChange(next);

    // Cleared on the way out rather than on the way in: Radix keeps the portal
    // mounted through the close transition, so resetting at open would be
    // visible as the ring disappearing a frame before the sheet does.
    if (!next) setSelectedId(null);
  }

  function confirm() {
    if (!selected) return;

    // Closed before the write, not after. § Feedback is "optimistic by default"
    // and the answer the sheet was asking for has been given — holding it open
    // over a round trip would make the swap feel slower than the log does, for
    // no information gained. A refusal surfaces on the card underneath, which
    // is § Feedback's "inline banner at the point of action": the point of
    // action is the card, and the sheet it was opened from is gone by then.
    onConfirm(selected);
    close(false);
  }

  return (
    <MealPicker
      open={open}
      onOpenChange={close}
      slot={slot}
      date={dayLabel(date)}
      meals={meals}
      currentMealId={current?.id}
      selectedMealId={selectedId}
      onSelect={setSelectedId}
    >
      <div className="flex flex-col gap-5 border-t border-border pt-5">
        {/*
         * Labelled as a region and marked live, because the numbers change
         * without the focus moving: a sighted user sees the grid update under
         * the tile they just tapped, and without this a screen-reader user
         * would tap through the whole library hearing nothing about the cost of
         * any of it — which is the entire question the sheet exists to answer.
         *
         * `polite` rather than `assertive`: it should be spoken after the
         * tile's own selected state, not cut across it.
         */}
        <div aria-live="polite" aria-label={selected ? "Day totals after the swap" : "Day totals"}>
          <KeyValueGrid
            items={[
              {
                label: "Calories",
                value: figure(totals.kcal),
                meta: (
                  <>
                    of {figure(target.targetKcal)} ·{" "}
                    {/* The one figure that takes a colour — § Tone of Voice writes
                        `+220 kcal` in `error` against `−8g protein` in
                        `text-secondary`. It stops at kcal: over target on protein
                        is the day going well, and a rule that painted every
                        positive delta red would report a good day as a fault. */}
                    <span className={delta.kcal > 0 ? "text-error" : undefined}>
                      {signed(delta.kcal)}
                    </span>
                  </>
                ),
              },
              {
                label: "Protein",
                value: `${figure(totals.proteinG)} g`,
                meta: <>of {figure(target.targetProteinG)} · {signed(delta.proteinG)}</>,
                // § Typography: "protein stays emphasised by weight, not
                // colour", because colour is spoken for by the accent.
                emphasis: true,
              },
              {
                label: "Fat",
                value: `${figure(totals.fatG)} g`,
                meta: <>of {figure(target.targetFatG)} · {signed(delta.fatG)}</>,
              },
              {
                label: "Carbs",
                value: `${figure(totals.carbG)} g`,
                meta: <>of {figure(target.targetCarbG)} · {signed(delta.carbG)}</>,
              },
            ]}
          />

          {/*
           * The one caveat the figures cannot carry themselves. An untracked
           * meal contributes nothing to a total, so a day containing one is a
           * floor rather than a sum — and a preview that said so only in a
           * tooltip would be hiding it from the reader who most needs it.
           */}
          {totals.partial && (
            <p className="pt-3 text-caption text-text-secondary">
              Excludes {totals.untrackedSlots.length} untracked{" "}
              {totals.untrackedSlots.length === 1 ? "meal" : "meals"}.
            </p>
          )}
        </div>

        {/*
         * The one primary action in the sheet — § Buttons, ink fill.
         *
         * Disabled until a tile is chosen, because there is no swap to confirm
         * before then. Disabled rather than absent for the reason FUEL-18 gave
         * the Swap button itself: a control that silently does nothing when
         * tapped is worse than one that says it cannot be used yet.
         */}
        <Button type="button" className="w-full" disabled={!selected} onClick={confirm}>
          Swap
        </Button>
      </div>
    </MealPicker>
  );
}
