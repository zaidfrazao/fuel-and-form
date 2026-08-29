"use client";

import { type CSSProperties, startTransition, useOptimistic, useState } from "react";

import { repeatFromDate, revertOnDate, swapOnDate } from "@/app/actions/plan";
import { SwapSheet, type SwappableMeal } from "@/components/swap-sheet";
import { Button } from "@/components/ui/button";
import { WeekTotals } from "@/components/week-totals";
import { addDays, type CalendarDate } from "@/lib/date";
import type { MealSlot } from "@/lib/db/schema";
import type { MacroTarget } from "@/lib/macros";
import { dayLabel, slotLabel } from "@/lib/now-display";
import { SLOT_ORDER } from "@/lib/resolve-plan";
import { type GridCell, type GridColumn, type PlannedDay, weekGrid } from "@/lib/week-grid";
import { weekTotals } from "@/lib/week-totals";

/**
 * The weekly grid — PRD § P2's "7-day × slot table showing the resolved plan",
 * and FUEL-28's screen.
 *
 * ## Why it is a real table
 *
 * Thirty-five cells whose meaning is entirely positional: a cell says what it
 * says because of the column and the row it is in. A grid of divs would carry
 * that meaning in the layout alone, which is exactly the information a screen
 * reader cannot recover — so the day is a `<th>` scoped over its days (`col`
 * wide, `rowgroup` stacked), the slot is a `<th scope="row">`, and the
 * association is the markup's rather than the CSS's. FUEL-50's
 * accessible-summary work builds on this rather than replacing it.
 *
 * ## Two shapes, one week
 *
 * § The Week, Two Ways: below 768px the week is seven stacked day sections
 * (`WeekStack`), at 768px and up it is seven day columns (`WeekTable`). Both
 * are rendered and CSS picks one — the reasoning for that, rather than a
 * `matchMedia` read, is at the call site.
 *
 * FUEL-81 decided this, and the reason is the text rather than the layout: a
 * meal name reaches fifty characters and this screen never truncates one, so
 * seven columns at 375px give each about 45px and a narrower column only wraps
 * the same name taller.
 *
 * § Dynamic Type used to except "the week grid" from the no-horizontal-scroll
 * rule outright. FUEL-71 withdrew that: neither shape scrolls sideways at any
 * width from 320 to 1920. What replaced it is one measured case rather than a
 * blanket permission — under TEXT-ONLY 200%, where the root font size doubles
 * and the `px` boxes do not follow, the wide shape still overflows by 13px at
 * 768 and 6px at 820. None at 1024 and above. Ordinary browser zoom scales the
 * boxes too and is therefore just a narrower viewport, where nothing overflows
 * at all.
 *
 * `break-words` on the labels is most of why that residue is small: a fixed
 * table cannot grow its 100px slot column to the 179px "Breakfast" needs at
 * 200%, so the word wraps inside the column instead of forcing the table wide.
 * Without it the same measurement was 27px at 820 and 18px at 1024.
 *
 * What survives the rotation is the association: the stacked shape makes the
 * day a `<th scope="rowgroup">` and keeps the slot a `<th scope="row">`, so the
 * markup still carries what the layout alone could not. Every cell is the same
 * `GridButton` either way, over one `useOptimistic` state, so the two shapes
 * cannot disagree about what is in a slot.
 *
 * ## One umber mark
 *
 * § The Four Rules: "today's column header in the week grid" is named as one of
 * the five places the accent is allowed, and "one umber element per screen".
 * `isToday` comes from `lib/week-grid.ts`, which got it from the profile's
 * timezone — not from a clock read in the browser, which would put the marker
 * on the wrong column for anyone travelling.
 *
 * It marks today's day heading stacked and today's column header wide. Both
 * shapes are in the DOM, so the document holds two umber marks and a SCREEN
 * still shows one — `display: none` takes the losing shape out of the
 * accessibility tree as well as off the screen. `week-grid.test.tsx` counts per
 * shape for that reason, and counts rather than spot-checks because a second
 * accent inside one shape would not look wrong in a diff.
 *
 * Colour is not the only carrier: the heading also says "Today" to assistive
 * technology — and visibly, stacked, where there is room for the word —
 * because § Accessibility does not allow a fact to exist in a hue alone.
 *
 * ## Optimistic, on `template-editor.tsx`'s terms
 *
 * § Feedback is "optimistic by default". The overlay is a map from cell to
 * meal — `null` meaning reverted — laid over the shaped week, so a swapped cell
 * shows its new meal on the frame the sheet closes and reverts by itself when
 * the transition ends without the server having agreed.
 *
 * A revert needs to show what it reverts TO, which is the template's answer for
 * that date, which the browser cannot derive without the whole template. So
 * `loadWeek` sends `templateDays` alongside — the same matched pair `loadToday`
 * sends for the card on `/`.
 */

/** The meal fields this screen draws and hands to the sheet. */
export type GridMeal = SwappableMeal;

/** A cell's address — the date and slot it belongs to, never a row id. */
type Cell = { date: CalendarDate; slot: MealSlot };

/**
 * A tap, in the form the retry needs — `template-editor.tsx`'s `Attempt`.
 *
 * "Try again" has to re-run the SAME write, and by the time a refusal comes
 * back the sheet has closed, so the failure is stored as the attempt rather
 * than as a message.
 */
type Attempt =
  | { kind: "swap"; cell: Cell; meal: GridMeal }
  | { kind: "repeat"; cell: Cell; meal: GridMeal; days: number }
  | { kind: "revert"; cell: Cell };

/** § Tone of Voice: name what happened. A revert did not fail to "swap". */
function banner(failure: Attempt): string {
  return failure.kind === "revert"
    ? "Couldn’t revert that meal."
    : "Couldn’t save that meal.";
}

/**
 * The overlay key. A string because a `Map` compares object keys by identity,
 * and two `{ date, slot }` literals are never the same object.
 */
const cellKey = ({ date, slot }: Cell) => `${date}:${slot}`;

type Pending = ReadonlyMap<string, GridMeal | null>;

/**
 * The cells a tap changes, optimistically.
 *
 * A repeat covers a RUN of dates, so it writes one entry per date rather than
 * one for the cell that was tapped — otherwise the four days a user was just
 * told about would appear one round trip later than the first.
 *
 * The run is computed from the same `days` count the action validates, but not
 * through `repeatDates`: that returns `null` for a count out of range, and this
 * layer never sees one — the stepper is bounded by the same constants. Dates
 * are stepped here with plain arithmetic on the shaped week instead, so a run
 * spilling past Sunday simply has no cell to paint.
 */
function applyMove(current: Pending, attempt: Attempt): Pending {
  const next = new Map(current);

  if (attempt.kind === "repeat") {
    for (let offset = 0; offset < attempt.days; offset += 1) {
      next.set(
        cellKey({ date: addDays(attempt.cell.date, offset), slot: attempt.cell.slot }),
        attempt.meal,
      );
    }

    return next;
  }

  next.set(cellKey(attempt.cell), attempt.kind === "revert" ? null : attempt.meal);

  return next;
}

/** The write a tap asks for. All three answer rather than throwing. */
function perform(attempt: Attempt): Promise<{ ok: boolean }> {
  if (attempt.kind === "revert") {
    return revertOnDate(attempt.cell.date, attempt.cell.slot);
  }

  if (attempt.kind === "repeat") {
    return repeatFromDate(
      attempt.cell.date,
      attempt.cell.slot,
      attempt.meal.id,
      attempt.days,
    );
  }

  return swapOnDate(attempt.cell.date, attempt.cell.slot, attempt.meal.id);
}

/**
 * The 45° hatch — § Materials, quoted exactly.
 *
 * Inline rather than a Tailwind arbitrary value, on `day-ruler.tsx`'s
 * reasoning: a `repeating-linear-gradient` inside `bg-[...]` needs
 * underscore-escaped spaces and fails *silently* when it is wrong — a missing
 * background, not a build error. `var(--border)` keeps the hex inside the token
 * layer, so the pattern flips with the mode like everything else.
 *
 * A pattern, not a texture. It marks the absence of data without implying
 * failure, which is the right register for a slot nobody has planned yet.
 */
/**
 * A day's cell for one slot, always — an unplanned one when the day has none.
 *
 * Looked up by slot rather than by position. `weekGrid` builds every column
 * from `SLOT_ORDER`, so the two are aligned by construction and an index would
 * work today; addressing by the thing itself is what keeps it working if either
 * list ever gains a slot, and it is what lets this return a real cell instead
 * of an `undefined` the callers would each have to handle.
 */
function cellFor(day: { cells: readonly GridCell<GridMeal>[] }, slot: MealSlot) {
  return (
    day.cells.find((candidate) => candidate.slot === slot) ?? {
      slot,
      meal: null,
      source: null,
      entryId: null,
    }
  );
}

const HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, var(--border) 0 1px, transparent 1px 5px)",
};

/**
 * One cell — a slot on a date, and the control that opens its picker.
 *
 * The accessible name carries the date AND the slot, because thirty-five
 * buttons reading "Dinner" would give a screen-reader user no way to tell which
 * Tuesday they were about to change. `template-editor.tsx` makes the same
 * choice with the weekday.
 *
 * "Swapped" is spoken rather than only tinted. `accent-subtle` is the palette's
 * named ground for a swapped cell, but a tint is a colour, and § Accessibility
 * does not let a fact live in one alone — `right-now.tsx` pairs the same ground
 * with a visible tag, which there is no room for in thirty-five cells at 375px.
 *
 * 44px minimum per § Touch Targets, and the whole cell is the target.
 */
function GridButton({
  date,
  cell,
  onOpen,
}: {
  date: CalendarDate;
  cell: GridCell<GridMeal>;
  onOpen: () => void;
}) {
  const swapped = cell.source === "override";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${dayLabel(date)} ${slotLabel(cell.slot).toLowerCase()}: ${
        cell.meal ? cell.meal.name : "not planned"
      }${swapped ? ", swapped" : ""}`}
      style={cell.meal ? undefined : HATCH}
      className={`flex h-full min-h-11 w-full flex-col justify-center gap-0.5 px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        swapped ? "bg-accent-subtle" : "hover:bg-surface"
      }`}
    >
      {/* An empty cell says what it is, not nothing — § Tone of Voice asks an
          empty state to describe what will appear, and this one is also the
          control for making it appear. `aria-hidden` because the button's own
          label already says it, and saying it twice is worse than not at all. */}
      <span
        aria-hidden="true"
        // `break-words` because neither shape can grow. Both tables are
        // `table-fixed` now, so a token wider than the column no longer widens
        // it — it spills over the hairline into the next day. The margin is
        // thin rather than theoretical: at 768px the day column is 87.4px, or
        // 67.4px of content, and "Peppercorn" already renders at 64.6px. This
        // wraps the word instead, which is what § The Week, Two Ways specifies
        // ("Column width, wraps") and is still not a truncation — the rule the
        // whole two-shape design exists to keep.
        className={
          cell.meal
            ? "text-slash font-medium break-words text-text-primary"
            : "text-slash break-words text-text-tertiary"
        }
      >
        {cell.meal ? cell.meal.name : "Not planned"}
      </span>

      {cell.meal && (
        <span aria-hidden="true" className="text-micro uppercase text-text-secondary tabular-nums">
          {cell.meal.kcal} kcal
        </span>
      )}
    </button>
  );
}

/** What both shapes draw: the week already shaped and overlaid. */
type WeekColumns = readonly GridColumn<GridMeal>[];

/** Opening the sheet — the one thing a cell does, in either shape. */
type OpenCell = (cell: Cell) => void;

/** The caption, written once because both tables are the same table. */
const CAPTION = "The week’s plan, by day and meal slot. Swapped meals are marked.";

/**
 * The day heading's two halves, shared so the shapes cannot drift apart.
 *
 * The eye gets the short form the column header has always shown. Assistive
 * technology gets the weekday in full, the date, and the word "today" — because
 * § Accessibility does not let a fact live in a hue alone, and `isToday` is
 * otherwise carried by the accent only.
 */
function DayName({ day, marked }: { day: GridColumn<GridMeal>; marked: boolean }) {
  return (
    <>
      <span aria-hidden="true">
        {dayLabel(day.date)}
        {marked && day.isToday ? " · Today" : ""}
      </span>
      <span className="sr-only">
        {day.name} {day.date}
        {day.isToday ? ", today" : ""}
      </span>
    </>
  );
}

/**
 * The week as seven stacked day sections — the shape below 768px.
 *
 * ## Still a table
 *
 * The obvious phone shape is a list of divs per day, and it is the one thing
 * this cannot be: a cell means what it means because of the day and the slot it
 * belongs to, and a div carries that in the layout alone. So the day becomes a
 * `<th scope="rowgroup">` over its own `<tbody>` and the slot stays a
 * `<th scope="row">`, which is the same association the wide grid makes with
 * `scope="col"` — rotated, not dropped. The caption comes with it.
 *
 * ## Why the week turns ninety degrees at all
 *
 * Not because seven columns are too many, but because the text in them is too
 * long: a meal name reaches fifty characters and this screen never truncates
 * one. Seven columns at 375px give each about 45px, and a narrower column does
 * not fit more of the week — it wraps the same name taller. Stacked, every name
 * has the full width of the screen and nothing scrolls sideways.
 *
 * The trade is written down rather than hidden: comparing Tuesday's dinner
 * against Thursday's at a glance is the wide grid's, and is what ≥768px is for.
 *
 * `table-fixed` is load-bearing. An auto table sizes its columns to their
 * content, and one fifty-character name would push the slot column to a sliver
 * and the layout would shift from day to day. Fixed, the slot column is 72px on
 * every row of every section, and the meal column takes the rest.
 */
function WeekStack({ week, onOpen }: { week: WeekColumns; onOpen: OpenCell }) {
  return (
    <table
      // Both shapes carry the same caption, because a reader is only ever
      // offered one and it is the same week either way. This is what lets a
      // test address one shape without inventing a difference the screen would
      // have to show.
      data-shape="stacked"
      className="w-full table-fixed border-collapse text-left md:hidden"
    >
      <caption className="sr-only">{CAPTION}</caption>

      {/*
       * The column widths, and the only place they can be stated.
       *
       * `table-fixed` takes its widths from the FIRST ROW, and the first row of
       * this table is a day heading spanning both columns — so a width on the
       * slot `th` below is read from a row that no longer decides anything and
       * is silently ignored. Measured at 375px before this was here: the slot
       * column took 165.5px of 331, half the screen, against the 72px it asks
       * for. That is worse than the 23% the wide grid spent on its pinned
       * column, which is the thing this shape exists to stop spending.
       *
       * A `<col>` is read before any row, so it holds regardless of what the
       * first row happens to be. It has no accessible meaning and adds none.
       */}
      <colgroup>
        {/*
         * 88px is "Breakfast" and nothing more: the longest slot label is
         * 79.3px at `text-micro`'s 10.5px and 0.16em tracking, plus the 8px
         * that separates it from the meal. A fixed table grows nothing, so a
         * number that merely looked tight clipped the word instead.
         *
         * The wide grid did not have to say this while it was an auto table —
         * it grew its own pinned column to 99.3px for exactly this reason, and
         * the `w-[86px]` on it was decorative. FUEL-71 made that table fixed
         * too, and the first thing it cost was this: 86 stopped being a number
         * the browser quietly corrected and started clipping, so the wide slot
         * column is now 100px, set from the same measurement as this one. The
         * two differ because the cells differ — 20px of `px-2.5` there against
         * the 8px separation here — not because the word does.
         */}
        <col className="w-[88px]" />
        <col />
      </colgroup>

      {week.map((day) => (
        // One `tbody` per day. The grouping is the point: it is what gives the
        // day heading a `rowgroup` to scope over, so the five rows beneath it
        // are its rows rather than merely the next five.
        <tbody key={day.date}>
          <tr>
            <th
              scope="rowgroup"
              colSpan={2}
              className={`border-b pt-5 pb-1.5 text-micro uppercase ${
                day.isToday
                  ? "border-accent text-accent"
                  : "border-text-tertiary text-text-secondary"
              }`}
            >
              <DayName day={day} marked />
            </th>
          </tr>

          {SLOT_ORDER.map((slot) => (
            <tr key={slot}>
              <th
                scope="row"
                // No width here on purpose — the `colgroup` above states it,
                // and a second number in this spot would be dead the moment it
                // disagreed, which is how the 72px that never applied survived
                // long enough to ship half the screen to the slot column.
                className="border-b border-border py-2 pr-2 align-top text-micro font-semibold uppercase text-text-secondary"
              >
                {slotLabel(slot)}
              </th>

              <td className="border-b border-border p-0 align-top">
                <GridButton
                  date={day.date}
                  cell={cellFor(day, slot)}
                  onOpen={() => onOpen({ date: day.date, slot })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

/**
 * The week as seven day columns — the shape at 768px and up.
 *
 * ## All seven days, at every width this shape runs at — FUEL-71
 *
 * This table used to scroll sideways at EVERY desktop width, 1920 included, and
 * the cause was three faults that each looked like someone else's:
 *
 *   1. **It was an auto table.** `w-[86px]` and `w-[132px]` are minimums a
 *      column grows past, so the slot column resolved to 99.3px and the table to
 *      ~1023.3px. It was never the width its own columns said it was.
 *   2. **The 28px gutter was counted twice.** § Desktop's frame already spends
 *      one between its columns — the mock draws `.dbody` with no horizontal
 *      padding for exactly this reason, "the two 28px gutters are the grid's own
 *      rather than a box's padding" — and `PageMain` then spent another one
 *      INSIDE the column as `px-7`. 1024 − 56 = 968 against a 1023.3px table is
 *      the ~55px of overflow that no viewport width could remove.
 *   3. **The rail's 248px was unabsorbed.** Fixed columns cannot give anything
 *      back, so crossing 1024px — where the pill becomes the rail — took the
 *      scroller from 967px to 720px and cost 1.87 days of the week. Widening the
 *      window made the week smaller.
 *
 * All three answer to one change: the width is a CONSEQUENCE now, not a
 * constant. `table-fixed` with a `<colgroup>` makes the declared widths real,
 * the day columns declare no width at all and split whatever is left, and the
 * table is capped at § Spacing's 1024 rather than built up to it. At ≥1272 the
 * frame gives all 1024 and 924 ÷ 7 lands on 132px exactly — the width the day
 * columns declared all along, arrived at rather than asserted;
 * below it the columns narrow instead of the week being cut off. Nothing
 * scrolls, so nothing can be lost by widening — fault 3 has nowhere to live.
 *
 * ## The pinned column, and the one fill that makes it work
 *
 * The slot column is `sticky left-0`, which kept the question ("which meal is
 * this?") on screen while the answer scrolled past. Nothing scrolls now, so it
 * holds nothing in place — it is kept because the scroll container is kept, and
 * for the same reason: both are cheap, and both are what stands between an
 * unforeseen overflow and the silent failures below.
 *
 * Two mechanics that are easy to get wrong and fail quietly:
 *
 *   - `border-separate`, not `border-collapse`. A collapsed table hands its
 *     borders to the table itself, and a sticky cell then scrolls out from
 *     under its own hairlines — so the borders sit on the cells and the spacing
 *     is zeroed to keep the grid tight. (The stacked shape collapses freely: it
 *     pins nothing.)
 *   - The pinned cells need an OPAQUE ground or the columns scroll visibly
 *     through them. That ground is `bg-surface`, which is also the AC's "one of
 *     only two components permitted a `surface` fill" (§ Color Palette: "stone
 *     tiles only — the one fill permitted outside sheets", the other being
 *     `Tile`). The brand permission and the mechanic want the same pixel.
 */
function WeekTable({ week, onOpen }: { week: WeekColumns; onOpen: OpenCell }) {
  return (
    /*
     * `relative` is load-bearing and was missing until FUEL-65. An `overflow`
     * clip only applies to descendants whose CONTAINING BLOCK is inside the
     * scroll container, and this table holds nine `sr-only` cells — the caption
     * and each day's full date — which `sr-only` makes `position: absolute`.
     * With the wrapper `static`, their containing block was the initial one, so
     * they were never clipped: they sat out at the table's true width and the
     * whole PAGE scrolled sideways to reach them. Measured at 375×667 before
     * the fix: `documentElement.scrollWidth` 1004 against a 375px viewport, and
     * 629px of pan into a region that painted blank, because `sr-only` hides
     * them with `clip-path`. `relative` makes this element their containing
     * block, and the clip that was already here starts applying to them.
     *
     * It does not disturb the pinned column: a `sticky` cell positions against
     * the nearest scrollport, which is this element either way.
     *
     * The measurement above is a phone width this shape no longer runs at, and
     * the reasoning is kept anyway: the escape is a property of an unpositioned
     * scroll container, not of 375px. The table fits at every width this shape
     * is drawn at now, so the clip should never fire — which is precisely why
     * both halves of it stay. A containment that only matters when something
     * has already gone wrong is not worth deleting for two classes.
     *
     * ## Why the scroller survives but its fade did not
     *
     * These look inconsistent and are not. The fade said "there is more to the
     * right", and at default type there is no longer anywhere to pan at any
     * width from 320 to 1920 — so it had become the same dishonesty it was
     * added to cure, pointing the other way. `overflow-x-auto` says something
     * weaker and still true: if content ever does exceed this box, pan it here
     * rather than dragging the page sideways.
     *
     * One case still reaches it, and it is stated rather than hidden: under
     * text-only 200% the table overflows by 13px at 768 and 6px at 820, and
     * that pan has no visual cue. Judged acceptable against re-adding a
     * gradient the guide bans outside one recorded exception, for a 6-13px
     * pan where the fade was written for 55px. § Accessibility carries the
     * numbers.
     *
     * ## `lg:-mx-7` — the second of the two 28px gutters, given back
     *
     * `PageMain` insets its content by `px-7`, and at `lg` that inset sits
     * INSIDE a frame column that already has a 28px gutter beside it. The grid
     * is the one element that cannot afford to pay twice: 1024 − 56 leaves 968,
     * and 968 is not a number § Desktop's arithmetic ever mentions.
     *
     * So the grid alone bleeds back out, exactly as the phone's full-bleed
     * scroller does — this is the same device at the other end of the scale.
     * The header, the week nav and the totals keep the inset and stay aligned
     * with the notice bands above them, which is what § Desktop requires of
     * them; only the table spans its full column. That is what makes "1272 is a
     * sum rather than a round number" true at the pixel instead of nearly.
     */
    <div className="relative hidden overflow-x-auto md:block lg:-mx-7">
      <table
        data-shape="wide"
        /*
         * `table-fixed` is what makes every number here real, and `max-w`
         * rather than `w` is what keeps them reachable. See the header comment:
         * an auto table treats a column width as a floor and grows past it, so
         * this table measured 1023.3px while its columns summed to 1010 and the
         * page offered 968. Fixed, it is what it says.
         *
         * The cap is § Spacing's 1024 — the one max-content-width exception in
         * the guide, because a table has no reading measure to keep. Below the
         * width that allows it, `w-full` means the columns share less rather
         * than the week losing days off its right edge.
         */
        className="w-full max-w-[1024px] table-fixed border-separate border-spacing-0 text-left"
      >
        <caption className="sr-only">{CAPTION}</caption>

        {/*
         * The column widths, and — as in the stacked shape — the only place they
         * can be stated. A `<col>` is read before any row, so it holds whatever
         * the first row turns out to be; a width on a `th` is read from the
         * first row alone and is dead the moment a later row disagrees.
         *
         * 100px is the slot column, and it is 100 rather than FUEL-67's 86 for
         * a reason worth stating, because 86 was tried first and was wrong.
         *
         * A fixed table grows nothing. "Breakfast" measures 79.3px at
         * `text-micro`'s 10.5px and 0.16em tracking, and this cell spends 20px
         * on `px-2.5`, so the label needs 99.3px — and at 86 it spilled 3px over
         * the hairline into Monday. Which means the auto table's 99.3px pinned
         * column was never the bloat it was read as: it was the column fitting
         * its own content, the one thing an auto table does well. The mock's 86
         * is honest THERE — it draws this table at 9.5px with 9px of padding,
         * where the same word needs 71px. Two type scales, two answers, and the
         * app has to use the app's.
         *
         * The seven day columns declare NO width, and that is the whole
         * mechanism rather than an omission. A fixed table splits what is left
         * equally among the columns that ask for nothing, so the day column is
         * whatever the page can afford: 924 ÷ 7 = 132.0px at the 1024px cap,
         * and less than that below without a day ever leaving the screen.
         * Naming 132 here would put the ceiling back and bring the sideways
         * scroll with it — and note what 132 is. It is the width the day columns
         * declared all along. That number was never the fault; the 86 that was
         * really 99.3, and the gutter that was paid for twice, were.
         */}
        <colgroup>
          <col className="w-[100px]" />
          {week.map((day) => (
            <col key={day.date} />
          ))}
        </colgroup>

        <thead>
          <tr>
            {/* The corner. Empty to the eye — the row headers beneath say what
                the column holds — but named for assistive technology, which
                would otherwise announce a blank header for every row. */}
            <th
              scope="col"
              // No width here on purpose — the `colgroup` above states it. The
              // `min-w-` that used to sit beside it was worse than redundant:
              // on a fixed table a minimum is not a thing a column can have, and
              // on the auto table it replaced it was the floor the column grew
              // off. Stating it twice is how the two numbers came to disagree.
              className="sticky left-0 z-10 border-b border-border bg-surface px-2.5 py-2"
            >
              <span className="sr-only">Meal slot</span>
            </th>

            {week.map((day) => (
              <th
                key={day.date}
                scope="col"
                className={`border-b border-l border-border px-2.5 py-2 text-micro uppercase ${
                  day.isToday ? "text-accent" : "text-text-secondary"
                }`}
              >
                <DayName day={day} marked={false} />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {SLOT_ORDER.map((slot) => (
            <tr key={slot}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-border bg-surface px-2.5 py-2 align-middle text-micro font-semibold uppercase break-words text-text-secondary"
              >
                {slotLabel(slot)}
              </th>

              {week.map((day) => (
                <td
                  key={day.date}
                  className="border-b border-l border-border p-0 align-top"
                >
                  <GridButton
                    date={day.date}
                    cell={cellFor(day, slot)}
                    onOpen={() => onOpen({ date: day.date, slot })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeekGrid({
  today,
  days,
  templateDays,
  meals,
  target,
}: {
  /** Today in the profile's timezone — the one umber column. */
  today: CalendarDate;
  /** The seven days resolved, Monday first, narrowed in the page. */
  days: readonly PlannedDay<GridMeal>[];
  /** The same seven dates with overrides ignored — what a revert restores. */
  templateDays: readonly PlannedDay<GridMeal>[];
  /** The whole library. Archived rows are filtered by the picker. */
  meals: readonly GridMeal[];
  /** The four target figures, so the sheet can preview a signed delta. */
  target: MacroTarget;
}) {
  const [pending, move] = useOptimistic<Pending, Attempt>(new Map(), applyMove);
  const [failure, setFailure] = useState<Attempt | null>(null);
  const [editing, setEditing] = useState<Cell | null>(null);

  /*
   * Shaped here rather than in the page so the optimistic overlay has something
   * to overlay — `template-editor.tsx`'s reasoning exactly. `weekGrid` is pure
   * and the rows are already narrowed, so this costs a pass over thirty-five
   * cells on a screen that re-renders when one of them changes.
   */
  // Keyed by cell address rather than paired off by position, so a revert
  // cannot paint the wrong date if the two lists ever arrive ordered
  // differently. `loadWeek` derives one from the other, so today they cannot —
  // this is what stops that being a thing to remember.
  const template = new Map(
    weekGrid(templateDays, today).flatMap((column) =>
      column.cells.map(
        (cell) => [cellKey({ date: column.date, slot: cell.slot }), cell] as const,
      ),
    ),
  );

  const week = weekGrid(days, today).map((column) => ({
    ...column,
    cells: column.cells.map((cell) => {
      const key = cellKey({ date: column.date, slot: cell.slot });

      if (!pending.has(key)) return cell;

      const meal = pending.get(key) ?? null;

      // A revert shows what the TEMPLATE says for this date, not an empty cell:
      // the override is being removed, and resolution will find the template
      // entry again the moment it is gone. Anything else would flash "Not
      // planned" over a slot that is planned.
      //
      // The fallback is unreachable while both grids cover the same seven
      // dates, and is an empty cell rather than a throw because a screen that
      // crashed over a missing template entry would be a worse answer than one
      // that showed the slot as unplanned — which is what a missing template
      // entry MEANS.
      if (!meal) {
        return (
          template.get(key) ?? { slot: cell.slot, meal: null, source: null, entryId: null }
        );
      }

      // A pending swap is an override by definition — that is the only row
      // either write produces. `entryId` stays null until the server answers,
      // and nothing reads it before then: the revert control re-derives the id
      // server-side anyway.
      return { ...cell, meal, source: "override" as const, entryId: null };
    }),
  }));

  // The day being edited, read back out of the shaped week rather than
  // remembered when the sheet opened, so an optimistic swap made while the
  // sheet is still open leaves the picker's ink anchor on the meal now in the
  // slot rather than the one that was there when it was tapped.
  const column = editing
    ? week.find((candidate) => candidate.date === editing.date)
    : undefined;

  const cell = editing && column ? cellFor(column, editing.slot) : undefined;

  /*
   * What the sheet totals against: every meal planned on the cell's OWN date.
   * A grid cell is a day with its own calorie budget, and previewing a swap
   * against today's totals when the cell is Thursday's would answer a question
   * nobody asked.
   */
  const planned = column
    ? column.cells.flatMap((candidate) =>
        candidate.meal ? [{ slot: candidate.slot, meal: candidate.meal }] : [],
      )
    : [];

  function act(attempt: Attempt) {
    setFailure(null);
    setEditing(null);

    startTransition(async () => {
      move(attempt);

      // The `try` covers the CALL, not the action. All three actions catch
      // everything themselves and answer `{ ok: false }` — but reaching them is
      // a network request, and a request can fail on its own. Those reject
      // rather than resolve, and without this the rejection would escape the
      // transition: no banner, no "Try again", and the optimistic value
      // silently reverting with nothing said.
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
    <div className="flex flex-col gap-[14px]">
      {/*
       * § Feedback: "inline banner at the point of action, value reverted, 'Try
       * again'. Never a modal." The point of action is the grid — the sheet has
       * closed by the time an answer arrives — so the banner sits above it,
       * where the eye returns after the sheet goes.
       */}
      {failure && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-border pb-3"
        >
          <p className="text-slash text-error">{banner(failure)}</p>
          <Button variant="link" size="xs" onClick={() => act(failure)}>
            Try again
          </Button>
        </div>
      )}

      {/*
       * Two shapes, one week — § The Week, Two Ways.
       *
       * Below 768px the week is seven stacked day sections; at 768px and up it
       * is the seven-column grid. Both are rendered, and CSS picks one. The
       * alternative was a `matchMedia` read, which cannot work here: this is
       * server-rendered into one HTML for every viewport, so the server would
       * have to guess a width and every phone would paint the wide grid for a
       * frame before hydration swapped it.
       *
       * `display: none` — which is what `hidden` and `md:hidden` compile to —
       * takes the losing shape out of the accessibility tree as well as off the
       * screen, so a screen reader is offered exactly one table, never two.
       *
       * The cost is 35 more buttons in the DOM. They share `pending`,
       * `setEditing` and `act` with the visible ones, so the two shapes cannot
       * disagree about what is in a slot: there is one state, drawn twice.
       */}
      <WeekStack week={week} onOpen={setEditing} />
      <WeekTable week={week} onOpen={setEditing} />

      {/* Totalled from `week` rather than from `days`, so the figures carry the
          pending swap the cells above are already showing. Passing the props
          through to the server and totalling there would print the week as it
          was until revalidation lands — a stale number under a changed grid,
          which is the one thing this block must never be. */}
      <WeekTotals figures={weekTotals(week)} />

      {editing && (
        <SwapSheet
          open
          onOpenChange={(open) => !open && setEditing(null)}
          slot={editing.slot}
          date={editing.date}
          planned={planned}
          meals={meals}
          target={target}
          onConfirm={(meal) => act({ kind: "swap", cell: editing, meal })}
          onRepeat={(meal, days) => act({ kind: "repeat", cell: editing, meal, days })}
          // Offered only for a cell that HAS an override. A cell resolved from
          // the template has nothing to revert, and a control that silently
          // does nothing is worse than one that is not there.
          onRevert={
            cell?.source === "override"
              ? () => act({ kind: "revert", cell: editing })
              : undefined
          }
        />
      )}
    </div>
  );
}
