"use client";

import { startTransition, useOptimistic, useState } from "react";

import { clearTemplateMeal, setTemplateMeal } from "@/app/actions/template";
import { MealPicker, type PickableMeal } from "@/components/meal-picker";
import { SlashMeta } from "@/components/kv-grid";
import { Button } from "@/components/ui/button";
import type { DayOfWeek } from "@/lib/date";
import type { MealSlot } from "@/lib/db/schema";
import { slotLabel } from "@/lib/now-display";
import {
  templateWeek,
  weekdayName,
  type TemplateRow,
} from "@/lib/template-plan";

/**
 * The template editor — PRD § P2's "editing the template itself is a separate,
 * explicit action", and FUEL-25's screen.
 *
 * ## What makes it separate, and not merely elsewhere
 *
 * The acceptance criterion has two halves — reachable, and never triggered
 * accidentally — and the second one is the hard one, because the swap flow and
 * this one both end in "choose a meal for a slot". Three things keep them
 * apart, and they are deliberately independent of each other:
 *
 *   1. **A different route.** Nothing on `/` opens this. The Swap button, the
 *      swap sheet and the repeat control all write dated overrides and cannot
 *      reach a template row at all — `actions/template.ts` is a separate module
 *      from `actions/swap.ts`, and neither imports the other's data layer.
 *   2. **Different words in the two places a user reads before committing.**
 *      The sheet is headed "Every Tuesday · Dinner", not "Swap dinner", and the
 *      confirm says "Save to every Tuesday" rather than "Swap". The blast
 *      radius is in the button's own label, which is the last thing read before
 *      a tap — the same reasoning the repeat control's "Repeat for 3 days"
 *      follows.
 *   3. **Nothing writes on the first tap.** Tapping a row opens the picker;
 *      choosing a tile arms the confirm; the write needs the confirm. So no
 *      single mis-tap anywhere on this screen changes the plan.
 *
 * ## Why it is not the swap sheet with different copy
 *
 * `SwapSheet` exists to answer "what will this cost me today" — it previews the
 * day's totals against target, because a substitution happens inside a day that
 * has a calorie budget. A template edit has no day: it changes every future
 * Tuesday, and there is no single set of totals that is the answer. Reusing the
 * sheet would mean showing figures for one arbitrary date, which is worse than
 * showing none.
 *
 * What IS shared is `MealPicker` — the tile grid, the slot filter and the
 * "Show all meals" toggle — because "which meal goes here" genuinely is the
 * same question. Sharing it means the two flows cannot drift on the rule that
 * matters: archived meals are not offered, in either.
 *
 * ## Optimistic, on the same terms as `/`
 *
 * § Feedback is "optimistic by default", and this screen is no exception even
 * though it is not the one with the 300ms budget. The overlay is a map from
 * cell to meal — `null` meaning cleared — laid over the shaped week, so a saved
 * row shows its new meal on the frame the sheet closes and reverts by itself
 * when the transition ends without the server having agreed.
 */

/** The meal fields this screen draws and hands to the picker. */
export type EditableMeal = PickableMeal;

/** A cell's address. The unique constraint makes it a primary key. */
type Cell = { dayOfWeek: DayOfWeek; slot: MealSlot };

/**
 * A tap, in the form the retry needs — `right-now.tsx`'s `Attempt`, one screen
 * across. "Try again" has to re-run the SAME write, and by the time a refusal
 * comes back the sheet has closed, so the failure is stored as the attempt
 * rather than as a message.
 */
type Attempt =
  | { kind: "set"; cell: Cell; meal: EditableMeal }
  | { kind: "clear"; cell: Cell };

/** § Tone of Voice: name what happened. A clear did not fail to "save". */
function banner(failure: Attempt): string {
  return failure.kind === "clear"
    ? "Couldn’t clear that slot."
    : "Couldn’t save that to the template.";
}

/**
 * The overlay key. A string because a `Map` compares object keys by identity,
 * and two `{ dayOfWeek: 2, slot: "dinner" }` literals are not the same object.
 */
const cellKey = ({ dayOfWeek, slot }: Cell) => `${dayOfWeek}:${slot}`;

type Pending = ReadonlyMap<string, EditableMeal | null>;

function applyMove(current: Pending, attempt: Attempt): Pending {
  const next = new Map(current);

  next.set(cellKey(attempt.cell), attempt.kind === "clear" ? null : attempt.meal);

  return next;
}

/** The write a tap asks for. Both of these answer rather than throwing. */
function perform(attempt: Attempt): Promise<{ ok: boolean }> {
  return attempt.kind === "clear"
    ? clearTemplateMeal(attempt.cell.dayOfWeek, attempt.cell.slot)
    : setTemplateMeal(attempt.cell.dayOfWeek, attempt.cell.slot, attempt.meal.id);
}

/**
 * One slot of one weekday — a row, and the control that opens its picker.
 *
 * § Lists: rows on the canvas separated by hairlines, no card and no fill. 54px
 * rather than the dense 46px, because this is the tap target for the widest
 * write in the app and § Touch Targets' minimum is a floor, not a target.
 *
 * The accessible name carries the weekday as well as the slot. Every day
 * renders a row called "Dinner", so a name that stopped at the slot would give
 * a screen-reader user seven identical buttons and no way to tell which
 * Tuesday's dinner they were about to change.
 */
function SlotRow({
  dayOfWeek,
  slot,
  meal,
  onOpen,
}: {
  dayOfWeek: DayOfWeek;
  slot: MealSlot;
  meal: EditableMeal | null;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${weekdayName(dayOfWeek)} ${slotLabel(slot).toLowerCase()}: ${
          meal ? meal.name : "not planned"
        }`}
        className="flex min-h-[54px] w-full items-center justify-between gap-4 border-b border-border py-[10px] text-left transition-colors duration-150 last:border-b-0 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-micro uppercase text-text-secondary">
            {slotLabel(slot)}
          </span>
          {/* An empty cell says what it is, not nothing. § Tone of Voice asks an
              empty state to describe what will appear, and this one is also the
              control for making it appear. */}
          <span className={meal ? "text-body text-text-primary" : "text-body text-text-tertiary"}>
            {meal ? meal.name : "Not planned"}
          </span>
        </span>

        {meal && (
          <SlashMeta className="shrink-0">
            {meal.kcal} kcal · P {meal.proteinG}
          </SlashMeta>
        )}
      </button>
    </li>
  );
}

export function TemplateEditor({
  entries,
  meals,
}: {
  /** The user's `plan_template_entries`, narrowed in the page. */
  entries: readonly TemplateRow[];
  /**
   * The whole library. Archived rows may be present — `MealPicker` filters them
   * from the tiles, and `actions/template.ts` refuses them again on the way in,
   * while a template row that already NAMES one still renders (see
   * `templateWeek`).
   */
  meals: readonly EditableMeal[];
}) {
  const [pending, move] = useOptimistic<Pending, Attempt>(new Map(), applyMove);
  const [failure, setFailure] = useState<Attempt | null>(null);
  const [editing, setEditing] = useState<Cell | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * Shaped here rather than in the page so the optimistic overlay has something
   * to overlay. `templateWeek` is pure and the rows are already narrowed, so
   * this costs a pass over a few dozen entries on a screen that re-renders when
   * a slot changes — against the alternative, which is the server round trip
   * § Feedback's optimistic default exists to hide.
   */
  const week = templateWeek(entries, meals).map((day) => ({
    ...day,
    cells: day.cells.map((cell) => {
      const key = cellKey({ dayOfWeek: day.dayOfWeek, slot: cell.slot });

      return pending.has(key) ? { ...cell, meal: pending.get(key) ?? null } : cell;
    }),
  }));

  // The cell being edited, read back out of the shaped week rather than
  // remembered when the sheet opened: an optimistic save while the sheet is
  // still open should leave the picker's ink anchor on the meal now in the
  // slot, not on the one that was there when it was tapped.
  const current = editing
    ? (week
        .find((day) => day.dayOfWeek === editing.dayOfWeek)
        ?.cells.find((cell) => cell.slot === editing.slot)?.meal ?? null)
    : null;

  const selected = meals.find((meal) => meal.id === selectedId);

  function close(open: boolean) {
    if (open) return;

    setEditing(null);
    // Cleared with the sheet, as the swap sheet's selection is: a picker
    // reopened on another slot must not start with the choice abandoned on the
    // last one still ringed.
    setSelectedId(null);
  }

  function act(attempt: Attempt) {
    setFailure(null);
    close(false);

    startTransition(async () => {
      move(attempt);

      // The `try` covers the CALL, not the action. Both actions catch
      // everything themselves and answer `{ ok: false }` — but reaching them is
      // a network request, and a request can fail on its own. Those reject
      // rather than resolve, and without this the rejection would escape the
      // transition: no banner, no "Try again", and the optimistic value
      // silently reverting with nothing said. `right-now.tsx` argues it in
      // full.
      try {
        const result = await perform(attempt);

        // The transition wrapper is not optional: React does not treat a state
        // update after an `await` as part of the transition it was started in,
        // so without it the banner would paint a frame before the optimistic
        // value reverts.
        if (!result.ok) startTransition(() => setFailure(attempt));
      } catch {
        startTransition(() => setFailure(attempt));
      }
    });
  }

  return (
    <div className="flex flex-col gap-[30px]">
      {/*
       * § Feedback: "inline banner at the point of action, value reverted, 'Try
       * again'. Never a modal." The point of action is the list — the sheet has
       * closed by the time an answer arrives — so the banner sits above it,
       * where the eye returns after the sheet goes.
       *
       * `role="alert"` so the refusal is heard and not merely coloured.
       */}
      {failure && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-border pb-3"
        >
          <p className="text-caption text-error">{banner(failure)}</p>
          <Button variant="link" size="xs" onClick={() => act(failure)}>
            Try again
          </Button>
        </div>
      )}

      {week.map((day) => (
        <section key={day.dayOfWeek} className="flex flex-col gap-[14px]">
          <h2 className="text-micro uppercase text-text-secondary">{day.name}</h2>

          <ul className="flex flex-col">
            {day.cells.map((cell) => (
              <SlotRow
                key={cell.slot}
                dayOfWeek={day.dayOfWeek}
                slot={cell.slot}
                meal={cell.meal}
                onOpen={() => setEditing({ dayOfWeek: day.dayOfWeek, slot: cell.slot })}
              />
            ))}
          </ul>
        </section>
      ))}

      {editing && (
        <MealPicker
          open
          onOpenChange={close}
          slot={editing.slot}
          // Neither word the swap sheet uses. This is the first of the two
          // places a user reads before committing — see the block at the top.
          title={`Every ${weekdayName(editing.dayOfWeek)}`}
          date={slotLabel(editing.slot)}
          meals={meals}
          currentMealId={current?.id}
          selectedMealId={selectedId}
          onSelect={setSelectedId}
        >
          <div className="flex flex-col gap-5 border-t border-border pt-5">
            {/*
             * The one primary action in the sheet — § Buttons, ink fill — and
             * the second place the blast radius is stated. "Save to every
             * Tuesday" is a sentence about the future; "Swap" is a sentence
             * about tonight, and the two controls must not be able to be
             * mistaken for one another.
             *
             * Disabled until a tile is chosen, because there is nothing to save
             * before then. Disabled rather than absent, on the reasoning the
             * swap sheet's confirm gives: a control that silently does nothing
             * when tapped is worse than one that says it cannot be used yet.
             */}
            <Button
              type="button"
              className="w-full"
              disabled={!selected}
              onClick={() =>
                selected && editing && act({ kind: "set", cell: editing, meal: selected })
              }
            >
              Save to every {weekdayName(editing.dayOfWeek)}
            </Button>

            {/*
             * Tertiary, so the Text variant, and present only while the slot
             * HOLDS something — the state itself is what offers the control, so
             * it survives a reload without anything having to remember it. The
             * same rule `/` applies to Revert.
             *
             * Not `destructive`: § Buttons reserves that for Delete and
             * discard, and clearing a template slot destroys nothing — the
             * meal stays in the library, and the slot can be refilled from this
             * same sheet.
             */}
            {current && (
              <Button
                type="button"
                variant="link"
                className="self-start px-0"
                onClick={() => editing && act({ kind: "clear", cell: editing })}
              >
                Clear this slot
              </Button>
            )}
          </div>
        </MealPicker>
      )}
    </div>
  );
}
