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
 * the same name taller. § Dynamic Type used to except "the week grid" from the
 * no-horizontal-scroll rule without qualifying the width; it now excepts the
 * wide shape only, and below 768px this screen scrolls sideways nowhere.
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
        className={
          cell.meal
            ? "text-slash font-medium text-text-primary"
            : "text-slash text-text-tertiary"
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
         * that separates it from the meal. The wide grid never had to say this
         * — an auto table grows a column to its content, and its `w-[86px]`
         * pinned column resolves to 99.3px in the browser for exactly that
         * reason. A fixed table grows nothing, so a number that merely looked
         * tight clipped the word instead.
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
                className="w-[72px] border-b border-border py-2 pr-2 align-top text-micro font-semibold uppercase text-text-secondary"
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
 * ## The pinned column, and the one fill that makes it work
 *
 * Seven days do not fit every width this shape runs at, so the table scrolls
 * inside its own container and the slot column is `sticky left-0`, which keeps
 * the question ("which meal is this?") on screen while the answer scrolls past.
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
     * scroll container, not of 375px, and this one still scrolls below ~1074px.
     */
    <div className="relative hidden overflow-x-auto md:block">
      {/*
       * That it scrolls, said visibly — FUEL-81's "no fade, shadow, or
       * affordance" finding. A fade at the right edge is the whole cue: content
       * passing under it rather than ending at it.
       *
       * Bounded to the widths where the table ACTUALLY overflows, because an
       * affordance for scrolling that is not possible is a worse lie than none.
       * The table is 86px + 7 × 132px plus its hairlines; § Spacing caps the
       * page at 1024px with a 28px gutter each side, so the last width that
       * overflows is about 1074px. Above that the grid fits and the fade goes.
       *
       * `z-20` clears the `z-10` on the pinned column, which is a scrolling
       * sibling and would otherwise paint over it at the moment it matters.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-20 hidden w-10 bg-gradient-to-l from-background to-transparent md:max-[1074px]:block"
      />

      <table
        data-shape="wide"
        className="w-max min-w-full border-separate border-spacing-0 text-left"
      >
        <caption className="sr-only">{CAPTION}</caption>

        <thead>
          <tr>
            {/* The corner. Empty to the eye — the row headers beneath say what
                the column holds — but named for assistive technology, which
                would otherwise announce a blank header for every row. */}
            <th
              scope="col"
              className="sticky left-0 z-10 w-[86px] min-w-[86px] border-b border-border bg-surface px-2.5 py-2"
            >
              <span className="sr-only">Meal slot</span>
            </th>

            {week.map((day) => (
              <th
                key={day.date}
                scope="col"
                className={`w-[132px] min-w-[132px] border-b border-l border-border px-2.5 py-2 text-micro uppercase ${
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
                className="sticky left-0 z-10 border-b border-border bg-surface px-2.5 py-2 align-middle text-micro font-semibold uppercase text-text-secondary"
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
