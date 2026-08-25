import { type CalendarDate, parseCalendarDate } from "./date";

/**
 * What `?week=` means — one reading, for the two places that read it.
 *
 * Lifted out of `app/plan/page.tsx`, which had it to itself until FUEL-38 gave
 * `/api/export/week` the same parameter. The screen and the file it downloads
 * have to agree about which seven days a URL names, and the way to guarantee
 * that is one function rather than two that currently match.
 *
 * ## It never throws
 *
 * `parseCalendarDate` throws on a malformed date, and this is a query parameter
 * — the one input a stranger fully controls. The honest answer to a value we do
 * not recognise is the answer to no value at all: `null`, which both callers
 * turn into the current week. `parseCursor` makes the same call for the same
 * reason, and the alternative is an edited URL that 500s.
 *
 * ## A repeated parameter is refused rather than resolved
 *
 * `?week=2026-08-17&week=2026-09-01` arrives as an array. Picking one of the
 * values would be answering a question that was not asked — a URL saying two
 * different things has not named a week — so it falls to `null` like any other
 * value this cannot read.
 *
 * ## The date is not otherwise constrained
 *
 * Any real date names a real week, including one before the program started or
 * years out. `resolveSlot` answers `null` for a date before
 * `program_start_date`, so those render as seven empty columns and export as a
 * file with three empty sections — which is true, and better than an error page
 * for a week that simply has nothing in it.
 */
export function requestedWeek(
  value: string | string[] | undefined,
): CalendarDate | null {
  if (typeof value !== "string") return null;

  try {
    parseCalendarDate(value);

    return value;
  } catch {
    return null;
  }
}
