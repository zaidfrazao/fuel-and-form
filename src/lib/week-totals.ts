import type { CalendarDate } from "./date";
import {
  type DayTotals,
  type MacroBearing,
  type MacroTotals,
  round1,
  summariseDay,
  totalMacros,
} from "./macros";
import type { GridColumn } from "./week-grid";

/**
 * What the week adds up to, day by day, and on average (FUEL-33).
 *
 * ## Why this reads the GRID and not the plan
 *
 * `macros.ts` already has `dayTotals(plan, date)`, and totalling seven dates
 * with it would be the shorter route. It is the wrong one here. The week view
 * swaps meals optimistically — `components/week-grid.tsx` applies the pending
 * move to its columns before the server has answered — so the plan the browser
 * holds and the columns the reader is looking at disagree for as long as the
 * round trip takes. Totalling the plan would print figures for a grid that is
 * no longer on the screen, on the one screen whose purpose is showing what a
 * swap does to the numbers.
 *
 * Reading the columns instead makes the arithmetic follow the render by
 * construction. The columns are the resolved, post-override plan — that is what
 * `weekGrid` was handed — so the P4 criterion is satisfied through them rather
 * than around them, and there is still no cached sum anywhere to invalidate.
 *
 * ## The divisor is planned days, not seven
 *
 * A week can honestly contain days with nothing on them: `resolveSlot` returns
 * nothing at all for a date before `programStartDate`, and a template need not
 * fill every weekday. Dividing by seven in those weeks reports a day that does
 * not exist — three planned days of 2,000 kcal average to 857, which is not
 * what any of them looked like and not a figure to steer a week by.
 *
 * So the divisor is the number of days with something planned, and
 * `plannedDays` is returned alongside the average for the view to show. A
 * divisor the reader can see is a figure they can check; a hidden one reads as
 * a bug the first time a partial week makes it look wrong.
 *
 * ## Pure, and generic over the meal
 *
 * Same constraints as `week-grid.ts`, for the same reason: the caller is a
 * client component, so nothing here may drag pg-core into that bundle, and the
 * meal that arrives is `page.tsx`'s narrowing rather than a `Meal` row. The
 * bound is `MacroBearing` because four numbers are all this reads.
 */

/** One day's column, totalled. */
export type DayFigures = {
  date: CalendarDate;
  totals: DayTotals;
  /**
   * Whether the day has anything planned at all.
   *
   * Not `totals.kcal > 0`: a day whose only meal is untracked totals zero and
   * is still a planned day, and a zero-calorie plan is a plan. This is what
   * decides the average's divisor, and what separates "nothing here" from "we
   * cannot say" in the view.
   */
  planned: boolean;
};

/** The week, day by day, with the average of the days that have a plan. */
export type WeekFigures = {
  days: readonly DayFigures[];
  /** `null` when no day in the week has a plan — there is no mean of nothing. */
  average: MacroTotals | null;
  /** The average's divisor, for the view to state rather than imply. */
  plannedDays: number;
};

/**
 * Total each column, then average the ones that hold a plan.
 *
 * The days come back in the order they arrived, which `weekGrid` has already
 * left Monday-first. Ordering them again here would be a second copy of a
 * decision `startOfWeek` owns.
 */
export function weekTotals<M extends MacroBearing>(
  columns: readonly GridColumn<M>[],
): WeekFigures {
  const days = columns.map((column) => {
    // `flatMap` over a filter-then-map so the null cells drop and the type
    // narrows in one pass — `summariseDay` wants meals, not maybes.
    const planned = column.cells.flatMap((cell) =>
      cell.meal ? [{ slot: cell.slot, meal: cell.meal }] : [],
    );

    return {
      date: column.date,
      totals: summariseDay(planned),
      planned: planned.length > 0,
    };
  });

  const counted = days.filter((day) => day.planned);

  return {
    days,
    plannedDays: counted.length,
    average: counted.length === 0 ? null : mean(counted),
  };
}

/**
 * The mean of days already totalled.
 *
 * `totalMacros` does the summing rather than a second loop here: `DayTotals`
 * satisfies `MacroBearing`, so the one place that knows how to add four macros
 * up stays the only one. `round1` on the way out for the same reason it is
 * applied to a sum — a mean divides, so it produces the long decimals that a
 * sum of one-decimal figures never does, and 33.33333333333333 g of protein is
 * a precision the numbers going in never had.
 *
 * The divisor is taken from the list rather than passed in. The only correct
 * value is the length of what is being averaged, and a signature that let the
 * two arguments disagree would answer a plausible wrong number rather than
 * throw — which is the whole failure mode this module is gated against.
 *
 * ## kcal goes to a whole number, and the grams do not
 *
 * The two are stored differently and should read differently. Grams are
 * `numeric(6, 1)`, so a tenth of a gram is a figure the schema can hold and a
 * meal can genuinely be. `kcal` is an integer column, and a mean is the first
 * place in the app that could produce a fraction of one — `format.ts` says as
 * much where it explains why its decimal option "never fires on it", and 0.6 of
 * a calorie is noise dressed as precision either way.
 */
function mean(days: readonly DayFigures[]): MacroTotals {
  const divisor = days.length;
  const summed = totalMacros(days.map((day) => day.totals));

  return {
    kcal: Math.round(summed.kcal / divisor),
    proteinG: round1(summed.proteinG / divisor),
    fatG: round1(summed.fatG / divisor),
    carbG: round1(summed.carbG / divisor),
  };
}
