"use client";

import { useState } from "react";

import { TINTED_TEXT } from "@/components/kv-grid";
import { MacroGrid } from "@/components/macro-grid";
import { MealPicker, type PickableMeal } from "@/components/meal-picker";
import { Button } from "@/components/ui/button";
import { REPEAT_MAX, REPEAT_MIN } from "@/lib/repeat";
import type { MealSlot } from "@/lib/db/schema";
import { type MacroBearing, type MacroTarget, summariseDay } from "@/lib/macros";
import { dayLabel } from "@/lib/now-display";
import { cn } from "@/lib/utils";
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
 * The panel is FUEL-32's, finished here rather than in the picker it hangs in:
 * FUEL-23 built the arithmetic and the placement, and FUEL-32 gave it the
 * `accent-subtle` ground and the greys that ground needs. "Above the confirm,
 * never after it" is an ORDER, so it is pinned by a test that reads document
 * position rather than by one that finds both elements on the screen.
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
 * Still the picker's. § The Four Rules allows exactly one — the selection ring
 * `Tile` draws — and nothing added here competes with it: the confirm is `ink`,
 * the figures are text, and an over-target kcal takes `error` on the same terms
 * the day-complete summary gives it.
 *
 * The preview panel's `accent-subtle` ground is not the exception it looks like.
 * A tinted GROUND is not the accent — `right-now.tsx` settles that for the
 * Swapped tag, which sits on the same token beside a screen whose one umber
 * element is the NOW marker — and § Color Palette names `accent-subtle` for
 * "swapped cells and the Swapped tag" specifically. This panel is the third of
 * those: the other two mark a swap that happened, and this one marks the swap
 * being considered.
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
  /**
   * The same meal, on this date and the `days - 1` after it — FUEL-24.
   *
   * Optional, and absent means the control is not rendered at all. That is what
   * lets the dev specimen page and the picker's own tests mount this sheet
   * without acquiring an opinion about a repeat — and it will matter again when
   * the weekly grid (FUEL-28) reuses the sheet for a cell whose date is not
   * today, where "repeat forward from here" may need a different answer.
   *
   * `days` counts the date the sheet is showing as the first of the run, so it
   * is the number the button prints. See `lib/repeat.ts` on why.
   */
  onRepeat?: (meal: SwappableMeal, days: number) => void;

  /**
   * Take this slot back to the template — P2's revert, offered in the sheet.
   *
   * Optional on the same terms as `onRepeat`, and absent means the control is
   * not rendered: `/` offers Revert on the card beside Undo, where the swap was
   * performed, so the sheet it opens has no need of a second one.
   *
   * The weekly grid (FUEL-28) is where this earns its place. A cell has no card
   * beneath it to carry the control and no room for one at 375px, so the sheet
   * the cell already opens is the only place a revert can live. That makes it
   * two taps there against one on `/` — § Feedback scopes "revertible in one
   * tap" to "from where it was performed", and a swap made on `/` is still one
   * tap on `/`.
   *
   * Unlike the confirm and the repeat, this is live WITHOUT a selection. A
   * revert is not a choice between meals; it removes the override and lets
   * resolution find the template again, so requiring a tile to be ringed first
   * would be asking for an answer to a question it does not pose.
   */
  onRevert?: () => void;
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

/**
 * "Repeat for N days", and the count it names — FUEL-24.
 *
 * ## Why it is a text button and the confirm is not
 *
 * § Buttons gives the Text variant to tertiary actions and names "Repeat for 2
 * days" as its own example, which settles the question the task's acceptance
 * criterion also settles: this is NOT a second filled button. Two filled
 * buttons in one sheet would be two primaries, and the screen would have
 * stopped saying which action it is for. A repeat is the uncommon case — the
 * common one is swapping today's dinner and nothing else — so it gets the
 * weight of a Revert rather than the weight of a Swap.
 *
 * ## The stepper is not a third button
 *
 * It adjusts the count the one text button will act on; it commits nothing. So
 * the sheet still has exactly one primary and one tertiary ACTION, and the
 * criterion's "a text button" stays literally true. The count lives in the
 * button's own label rather than only in the stepper, because the label is what
 * the user reads before tapping and a control that said "Repeat" while a
 * separate number said "5" would be asking them to assemble the sentence.
 *
 * The bounds come from `lib/repeat.ts` — the same two constants the Server
 * Action validates against. A stepper that could reach a count the endpoint
 * refuses would read as the button being broken rather than as a limit.
 *
 * `days` is at least two, so the noun is always plural and there is no singular
 * case to get right. That is a property of `REPEAT_MIN`, which exists because a
 * repeat of one day is the substitute this sheet already offers.
 */
function RepeatRow({
  days,
  onDays,
  onRepeat,
  disabled,
}: {
  days: number;
  onDays: (days: number) => void;
  onRepeat: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="link" disabled={disabled} onClick={onRepeat}>
        Repeat for {days} days
      </Button>

      {/*
       * Grouped and labelled, because the two buttons are meaningless apart:
       * "minus" on its own says nothing about what it takes one away from.
       *
       * Live whether or not a meal has been chosen, unlike the text button
       * beside it. The stepper COMMITS nothing — it adjusts how many days the
       * one action would cover — and disabling a setting because the action it
       * feeds is not ready yet makes the row look broken rather than pending.
       * Someone who knows they cooked four portions can say so and then pick
       * the meal; the order the two are given in does not matter.
       */}
      <div role="group" aria-label="Days to repeat" className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="One day fewer"
          disabled={days <= REPEAT_MIN}
          onClick={() => onDays(days - 1)}
        >
          {/* A minus SIGN, not a hyphen — the hyphen sits above the digits'
              optical centre and reads as a dash between two controls. */}
          &minus;
        </Button>

        {/*
         * Live, because the number changes without the focus moving: the
         * stepper button keeps focus while the value under it changes, so
         * without this a screen-reader user would hear nothing at all until
         * they navigated back to the text button.
         *
         * The digit is hidden from assistive technology and a worded copy is
         * announced instead. A bare "3" is ambiguous read aloud — three what —
         * and the visible glyph has the tabular figures the rest of the app
         * uses, which the worded version would break.
         */}
        <span aria-live="polite" className="min-w-5 text-center text-body tabular-nums">
          <span aria-hidden="true">{days}</span>
          <span className="sr-only">{days} days</span>
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="One day more"
          disabled={days >= REPEAT_MAX}
          onClick={() => onDays(days + 1)}
        >
          +
        </Button>
      </div>
    </div>
  );
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
  onRepeat,
  onRevert,
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

  /*
   * How many days a repeat would cover, held beside the selection and cleared
   * with it. Starting at `REPEAT_MIN` every time the sheet opens is the same
   * decision the selection makes: a sheet reopened after a cancelled swap that
   * still read "Repeat for 6 days" would be offering a count the user chose in
   * a conversation they abandoned.
   */
  const [days, setDays] = useState(REPEAT_MIN);

  const selected = meals.find((meal) => meal.id === selectedId);

  // What is planned for the slot right now — the ink anchor in the picker, and
  // the meal a confirm would displace.
  const current = planned.find((item) => item.slot === slot)?.meal;

  const totals = selected ? previewOf(planned, slot, selected) : summariseDay(planned);

  function close(next: boolean) {
    onOpenChange(next);

    // Cleared on the way out rather than on the way in: Radix keeps the portal
    // mounted through the close transition, so resetting at open would be
    // visible as the ring disappearing a frame before the sheet does.
    if (!next) {
      setSelectedId(null);
      setDays(REPEAT_MIN);
    }
  }

  function revert() {
    if (!onRevert) return;

    // Closed before the write, as the confirm and the repeat are, and for the
    // reason argued there. The banner for a refused revert lands on the grid
    // beneath, which is where the sheet was opened from.
    onRevert();
    close(false);
  }

  function repeat() {
    if (!selected || !onRepeat) return;

    // Closed before the write, exactly as `confirm` is, and for the reason
    // argued there. The banner for a refused repeat lands on the card beneath,
    // which is where the sheet was opened from.
    onRepeat(selected, days);
    close(false);
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
        <div
          aria-live="polite"
          aria-label={selected ? "Day totals after the swap" : "Day totals"}
          // The tint — FUEL-32's acceptance criterion, and the argument for it
          // is in the docblock's § One umber element.
          //
          // `rounded-lg` to match the tiles above rather than the sheet's own
          // 26px top radius: it is a block inside the sheet, not a second sheet.
          className="rounded-lg bg-accent-subtle px-4 py-[18px]"
        >
          {/*
           * The same grid the day itself carries on `/`, and that is the point
           * of it being one component: this previews the day a swap would
           * produce, and the card underneath shows the day as it stands. Two
           * copies of the rule deciding which overage is coloured would let the
           * sheet preview a swap as safe and the card paint the identical number
           * red the moment it was confirmed.
           *
           * `tinted` is what keeps that true through the ground change. The
           * grid's greys are `text-secondary`, which is measured against the
           * untinted grounds and lands at 4.07:1 on this one — under §
           * Accessibility's AA floor. See `TINTED_TEXT` in kv-grid.tsx.
           */}
          <MacroGrid totals={totals} target={target} tinted />

          {/*
           * The one caveat the figures cannot carry themselves. An untracked
           * meal contributes nothing to a total, so a day containing one is a
           * floor rather than a sum — and a preview that said so only in a
           * tooltip would be hiding it from the reader who most needs it.
           *
           * `TINTED_TEXT` rather than `text-secondary` for the reason the grid
           * beside it takes `tinted`, and imported rather than retyped so the
           * sentence and the figures above it cannot come out different greys.
           */}
          {totals.partial && (
            <p className={cn("pt-3 text-caption", TINTED_TEXT)}>
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

        {/*
         * Beneath the confirm, and only when the caller has somewhere to send
         * it. Disabled until a tile is chosen for the same reason the confirm
         * is: there is no meal to push forward yet, and a control that silently
         * does nothing when tapped is worse than one that says it cannot be
         * used yet.
         */}
        {onRepeat && (
          <RepeatRow
            days={days}
            onDays={setDays}
            onRepeat={repeat}
            disabled={!selected}
          />
        )}

        {/*
         * § Buttons gives Revert the Text variant by name. Last in the sheet
         * and never disabled: it is the one control here that acts on what is
         * already true rather than on what has been chosen.
         *
         * Not the destructive variant. § Buttons reserves that for Delete and
         * discard, and a revert destroys nothing — the template entry it
         * returns to has been sitting there the whole time.
         */}
        {onRevert && (
          <Button type="button" variant="link" onClick={revert}>
            Revert to template
          </Button>
        )}
      </div>
    </MealPicker>
  );
}
