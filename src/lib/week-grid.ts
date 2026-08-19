import { type CalendarDate, type DayOfWeek, dayOfWeek } from "./date";
import type { MealSlot } from "./db/schema";
import { type PlanSource, SLOT_ORDER } from "./resolve-plan";
import { weekdayName } from "./template-plan";

/**
 * The weekly grid's shape — seven days of five slots, filled or not (FUEL-28).
 *
 * ## Why this is not `resolveWeek`'s output
 *
 * `resolveWeek` answers "what is planned", so it returns only the slots that
 * resolve to something: a weekend with no lunch entry comes back with three
 * meals, not five. That is the right answer to the question it is asked, and
 * the wrong shape for a table, whose rows have to line up across seven columns
 * whatever any one day happens to plan.
 *
 * More than alignment, though: the EMPTY cells are load-bearing here. An
 * unplanned slot is what the grid draws the 45° hatch on — § Materials'
 * "marks the absence of data without implying failure" — and a shaping that
 * omitted it would leave the screen with nothing to hatch and no cell to tap in
 * order to fill it. `template-plan.ts` makes the same argument one table across,
 * and for the same reason: "an empty row is the control for filling it".
 *
 * ## The same argument, a different key
 *
 * This is `templateWeek` shifted from weekdays to dates. They are deliberately
 * separate functions rather than one generalised over its key, because the two
 * answer different questions and the difference is the whole of P2: the
 * template screen edits a WEEKDAY, which recurs forever, and this one edits a
 * DATE, which happens once. Sharing an implementation would put those two
 * blast radii behind one signature, one argument apart — which is precisely the
 * confusion `/plan/template` is a separate route in order to avoid.
 *
 * ## Pure, and generic over the meal
 *
 * No database access and nothing imported from Drizzle at runtime — only types,
 * which are erased. The grid is a client component (a cell opens the swap
 * sheet), so a module it imports must not drag pg-core into that bundle;
 * `resolve-plan.ts` states the rule and restates `SLOT_ORDER` to keep it.
 *
 * Generic over the meal for the reason `templateWeek` is: `app/plan/page.tsx`
 * narrows the library before it crosses to the browser, so what arrives is not
 * a `Meal` row and a signature demanding one would force the page to send
 * columns the table never draws.
 */

/** One resolved slot, as much of it as the grid reads. `ResolvedMeal` fits. */
export type PlannedCell<M> = {
  slot: MealSlot;
  meal: M;
  source: PlanSource;
  entryId: string;
};

/** A date and what resolution put on it. `ResolvedDay` satisfies this. */
export type PlannedDay<M> = {
  date: CalendarDate;
  meals: readonly PlannedCell<M>[];
};

/**
 * One cell of the grid — a slot on a date, whether or not anything fills it.
 *
 * `meal: null` is an ordinary state, not a missing value: before the program
 * starts, on a day the template does not cover, and in a slot it never fills.
 * `source` and `entryId` go null with it, because there is no row to have come
 * from and none to revert.
 */
export type GridCell<M> = {
  slot: MealSlot;
  meal: M | null;
  source: PlanSource | null;
  entryId: string | null;
};

/**
 * One day column: its date, how it is headed, and its five cells.
 *
 * `isToday` is carried rather than left to the view because it decides the one
 * umber mark on the screen (§ The Four Rules), and "which column is today" is a
 * question about a timezone-derived date that a component holding no clock
 * cannot answer for itself.
 */
export type GridColumn<M> = {
  date: CalendarDate;
  dayOfWeek: DayOfWeek;
  /** The weekday in full — the column's accessible name. */
  name: string;
  isToday: boolean;
  cells: readonly GridCell<M>[];
};

/**
 * The days as columns of five cells each, in the order a day is eaten.
 *
 * The days are returned in the order they arrive. `resolveWeek` already emits
 * them Monday-first, and re-sorting here would be a second, weaker copy of a
 * decision `date.ts`'s `startOfWeek` already made — one that could disagree
 * with it the day either changed.
 *
 * `today` is compared as a STRING, exactly, which is the same match
 * `resolveSlot` uses to keep a swap one-off. Zero-padded 'YYYY-MM-DD' is
 * unambiguous, and no clock or zone is read here to make it otherwise: the
 * caller resolved the date in the user's own timezone, and this only asks
 * whether two of them are the same day.
 */
export function weekGrid<M>(
  days: readonly PlannedDay<M>[],
  today: CalendarDate,
): readonly GridColumn<M>[] {
  return days.map((day) => {
    // Parsed rather than trusted: `dayOfWeek` rejects a malformed date loudly,
    // which is what stops a bad string being rendered as a column headed
    // "Invalid Date" that quietly sorts wrong.
    const weekday = dayOfWeek(day.date);

    return {
      date: day.date,
      dayOfWeek: weekday,
      name: weekdayName(weekday),
      isToday: day.date === today,
      cells: SLOT_ORDER.map((slot) => {
        const planned = day.meals.find((candidate) => candidate.slot === slot);

        return planned
          ? {
              slot,
              meal: planned.meal,
              source: planned.source,
              entryId: planned.entryId,
            }
          : { slot, meal: null, source: null, entryId: null };
      }),
    };
  });
}
