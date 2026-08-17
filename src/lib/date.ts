/**
 * Calendar arithmetic for an app pinned to one timezone.
 *
 * The PRD's highest-ranked correctness risk is *"plan resolution logic has
 * subtle date bugs — M/H"*, and the Testing Strategy spends two of its fourteen
 * resolver cases on daylight saving alone. This file is where that risk is
 * actually contained, so the containment is worth stating plainly.
 *
 * ## A calendar date is a string, and never a `Date`
 *
 * `schema.ts` stores every date as `date(mode: "string")` — 'YYYY-MM-DD' — and
 * argues why: a JS `Date` is an INSTANT, and an instant only becomes a calendar
 * day once you name a timezone. Reconstitute one carelessly and it lands on the
 * neighbouring day. This module is the other half of that decision: it does all
 * of its arithmetic on the string, so the app has no reason to build a `Date`
 * from a date it read out of the database.
 *
 * ## Where DST can reach, and where it cannot
 *
 * There are exactly four places a timezone can touch this system:
 *
 *   1. Turning an INSTANT into a calendar date — "what day is it for the user
 *      right now?". This is the only genuinely hard one.
 *   2. Turning an INSTANT into a wall-clock time — "is it lunch yet?". P1
 *      resolves the active slot against the clock, and the clock it has to mean
 *      is the one on the user's wall, not the one on the server's.
 *   3. Deriving `day_of_week` from a calendar date.
 *   4. Adding days to a calendar date, or counting the days between two — a
 *      repeat-across-days swap, stepping through a week grid, or the elapsed
 *      count the Circuit A/B rotation is derived from.
 *
 * (1) and (2) are the same question asked of the same formatter, and
 * `toCalendarDate` and `minutesOfDayIn` are the only functions here that take a
 * `Date` at all. They read different parts of one `formatToParts` output for one
 * zone, which is what keeps them from being able to disagree: a separate
 * time-only formatter could be built with a different zone or a different hour
 * cycle, and the failure would be a view that is confidently an hour or a day
 * out rather than one that throws.
 *
 * (3) and (4) go through `Date.UTC`, which has no daylight saving anywhere in
 * its definition. So a day is always exactly 24 hours in this file, the clocks
 * changing cannot reach the arithmetic, and the Testing Strategy's "exactly one
 * day, not 25 hours of two" holds by construction rather than by a special case
 * someone has to remember to keep. Every timezone-dependent decision in the
 * product therefore funnels through ONE cached formatter, which is the whole
 * reason any of this is testable.
 *
 * ## Lexicographic order is chronological order
 *
 * Because a calendar date is zero-padded and big-endian, `a < b` on the strings
 * is `a` before `b` on the calendar. Callers compare dates with `<`, `>=` and
 * `===` directly; there is deliberately no `isBefore` helper wrapping an
 * operator that already means the right thing. This is another thing a `Date`
 * would have made worse, not better — two `Date` objects for the same day
 * compare unequal under `===` and are never equal under `<=`.
 *
 * Pure and dependency-free, so the hermetic suite covers it at 100% with no
 * database, no network, and no reliance on the machine's own clock or zone.
 */

/**
 * A calendar date as 'YYYY-MM-DD' — exactly what Drizzle hands back for a
 * `date(mode: "string")` column, so no conversion happens at the boundary.
 *
 * An alias rather than a branded type on purpose: the schema's inferred row
 * types already type these columns as `string`, and a brand would mean casting
 * at every read — ceremony at the one place that is already safe, in exchange
 * for nothing. `parseCalendarDate` enforces the shape where it matters, at
 * runtime, on the way in.
 */
export type CalendarDate = string;

/** The three numbers behind a calendar date. `month` is 1-12, not 0-11. */
export type DateParts = { year: number; month: number; day: number };

/** 0 = Sunday through 6 = Saturday, matching `plan_template_entries.day_of_week`. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * A wall-clock time of day as 'HH:MM', 24-hour — exactly the shape
 * `profiles.slot_times` stores (`{ breakfast: "07:30" }`).
 *
 * A local time, deliberately carrying no date and no zone. A slot start is a
 * statement about the routine — breakfast is at seven — that stays true across
 * a DST transition precisely because it is not pinned to an instant. Storing an
 * instant instead would make "07:00" mean 06:00 for half the year.
 */
export type TimeOfDay = string;

/** Minutes in a day. The clock's modulus, and the day-complete sentinel. */
export const MINUTES_PER_DAY = 24 * 60;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 'HH:MM', with the ranges in the pattern rather than in a follow-up check.
 *
 * The hour alternation is what rejects '24:00' and '7:30'. Doing it here means
 * `parseTimeOfDay` has exactly one rejection branch to cover instead of three,
 * and no arithmetic that could accept a time and then produce a minute count
 * outside the day.
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

const pad = (value: number, width: number) => String(value).padStart(width, "0");

const formatParts = ({ year, month, day }: DateParts): CalendarDate =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/** UTC midnight for a calendar date. UTC because it is the zone without DST. */
const toUtcMillis = ({ year, month, day }: DateParts): number =>
  Date.UTC(year, month - 1, day);

const fromUtcMillis = (millis: number): CalendarDate => {
  const utc = new Date(millis);

  return formatParts({
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  });
};

/**
 * Validates a calendar date and splits it into numbers.
 *
 * Two things get rejected, both loudly:
 *
 *   - Anything that is not four digits, a dash, two digits, a dash, two digits.
 *   - A date that parses but does not exist — '2026-02-30', '2026-13-01'. The
 *     round trip through `Date.UTC` catches these for free, because UTC
 *     normalises overflow: February 30th comes back as March 2nd, which is not
 *     the string that went in. It also catches two-digit years, which
 *     `Date.UTC` would otherwise map into the 1900s ('0026' → 1926).
 *
 * The supported range is therefore years 0100-9999, which is not a general-
 * purpose date parser's range and is deliberately more than this app's: a
 * fitness program that started in the year 99 is a bug, not a use case.
 *
 * Throwing is right here where the resolver returns `null` elsewhere. A slot
 * with no meal is an ordinary state of the data; a malformed date is a bug in
 * the caller, and letting it through would put it somewhere further away — a
 * silently empty day, or a string comparison against a program start date that
 * quietly answers the wrong question.
 */
export function parseCalendarDate(date: CalendarDate): DateParts {
  if (!CALENDAR_DATE.test(date)) {
    throw new Error(
      `Not a calendar date: ${JSON.stringify(date)}. Dates are 'YYYY-MM-DD' ` +
        `strings throughout — see src/lib/date.ts.`,
    );
  }

  const parts: DateParts = {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };

  if (fromUtcMillis(toUtcMillis(parts)) !== date) {
    throw new Error(`No such date: ${JSON.stringify(date)}.`);
  }

  return parts;
}

/**
 * A 'HH:MM' wall-clock time as minutes since local midnight.
 *
 * Minutes, not a `Date` and not a pair of numbers, because every use is a
 * comparison: P1 asks which slot's window contains the clock, and that is `<=`
 * on two integers. Reducing both sides to one number is what keeps the
 * comparison from needing a date to hang the times off — two `Date` objects
 * built for "07:00 today" and "now" would drag DST and a calendar back into a
 * question that has neither.
 *
 * Throws on a malformed time, for the same reason `parseCalendarDate` does: a
 * slot start comes from `profiles.slot_times`, which is free-shaped JSON with no
 * database constraint behind it, so this parser is the only thing standing
 * between a typo in a settings form and a window that silently never opens.
 */
export function parseTimeOfDay(time: TimeOfDay): number {
  const match = TIME_OF_DAY.exec(time);

  if (!match) {
    throw new Error(
      `Not a time of day: ${JSON.stringify(time)}. Times are 24-hour 'HH:MM' ` +
        `strings throughout — see src/lib/date.ts.`,
    );
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * One `Intl.DateTimeFormat` per zone, kept.
 *
 * Constructing one loads the zone's transition table, which is expensive enough
 * to matter when the "Right Now" view asks what day it is on every render. The
 * app configures a single timezone per user, so this map holds one entry.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  // The locale is pinned, and with it the calendar AND the numbering system:
  // this formatter's output is parsed, never shown to anyone. `-ca-gregory`
  // keeps a non-Gregorian default calendar from reaching it, and `-nu-latn`
  // keeps the digits ASCII — a runtime whose ICU resolved another numbering
  // system would otherwise emit '٢٠٢٦-٠٣-٢٩', which every regex and every date
  // comparison downstream would reject, in production only.
  // Date AND time in one formatter, because `toCalendarDate` and
  // `minutesOfDayIn` are two readings of one question — "where in the day is
  // this user?" — and a second formatter is a second chance to get the zone
  // wrong. `toCalendarDate` ignores the hour parts; it selects the parts it
  // wants by type rather than by position, so widening this is free.
  //
  // `hourCycle: "h23"` rather than `hour12: false`: the latter resolves to h24
  // on some ICU builds, where midnight formats as '24' and a naive read of it
  // lands 24 hours into a day that has 23 more minutes to run. h23 is the cycle
  // that runs 00-23, which is what a minute count since midnight means.
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  formatters.set(timeZone, formatter);

  return formatter;
}

/**
 * The calendar date an instant falls on, in the given IANA timezone.
 *
 * The one function here that has to know about daylight saving, and the reason
 * every other one does not. Two wrong answers it exists to rule out:
 *
 *   - `instant.toISOString().slice(0, 10)` — UTC. In London during BST, every
 *     instant between midnight and 01:00 reports yesterday. In New York, every
 *     evening after 20:00 reports tomorrow. Both are the day view showing the
 *     wrong day at exactly the times someone is most likely to be looking at it
 *     — late at night, or first thing.
 *   - `instant.toLocaleDateString()` — the SERVER's zone. Vercel's functions run
 *     UTC and a laptop does not, so this is a bug that cannot reproduce
 *     locally. The PRD's acceptance criterion is explicit that the day boundary
 *     follows the CONFIGURED timezone, which is a column on `profiles`.
 *
 * Reading the parts back one at a time, rather than parsing a formatted string,
 * is what keeps the output independent of how the locale happens to arrange
 * them (`en-US` emits month, day, year — in that order).
 */
export function toCalendarDate(instant: Date, timeZone: string): CalendarDate {
  let year = "";
  let month = "";
  let day = "";

  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }

  return `${year.padStart(4, "0")}-${month}-${day}`;
}

/**
 * Today, for a user in the given timezone.
 *
 * `now` is an argument with a default rather than a call to `new Date()` inside
 * the body, so every test of everything downstream can name the instant it
 * means instead of mocking the clock.
 */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDate {
  return toCalendarDate(now, timeZone);
}

/**
 * The wall-clock time an instant falls on in a zone, as minutes since local
 * midnight.
 *
 * The clock P1 resolves its active slot against. The wrong answers it exists to
 * rule out are the time-of-day halves of `toCalendarDate`'s two:
 * `instant.getHours()` reads the SERVER's zone — one hour out in London for half
 * the year and five in New York, which is the difference between lunch and a
 * snack — and `instant.getUTCHours()` is the same bug pinned to a zone nobody
 * lives in.
 *
 * Reading the parts back rather than parsing a formatted string is what keeps
 * this independent of how the locale arranges them, and of whether it emits a
 * narrow no-break space before an AM marker. The `% 24` is not defending against
 * a real hour of 24 — `hourCycle: "h23"` rules that out — but against an ICU
 * build that ignores it; it costs no branch, and midnight reading as 1440
 * instead of 0 would put the day-complete state on a view at breakfast.
 *
 * Minutes are the resolution the product needs: slot starts are 'HH:MM', so a
 * second is below the precision of everything it gets compared against.
 */
export function minutesOfDayIn(timeZone: string, now: Date): number {
  let hour = "";
  let minute = "";

  for (const part of formatterFor(timeZone).formatToParts(now)) {
    if (part.type === "hour") hour = part.value;
    else if (part.type === "minute") minute = part.value;
  }

  return (Number(hour) % 24) * 60 + Number(minute);
}

/**
 * The day of the week, 0 = Sunday, matching the `day_of_week` column.
 *
 * `getUTCDay()`, never `getDay()`: the latter reads the machine's zone, so west
 * of Greenwich `new Date("2026-03-29").getDay()` is the Saturday before the
 * Sunday the string names. That off-by-one would silently serve the wrong day's
 * meals to anyone whose server is not UTC — which is every developer, and no
 * deployment, so it would not show up until it shipped.
 */
export function dayOfWeek(date: CalendarDate): DayOfWeek {
  const day = new Date(toUtcMillis(parseCalendarDate(date))).getUTCDay();

  // getUTCDay is 0-6 by definition; the cast names that for the type system
  // rather than adding a range check no test could ever fail.
  return day as DayOfWeek;
}

/**
 * `date` shifted by `days`, which may be negative.
 *
 * `Date.UTC` normalises overflow, so month and year ends need no special case:
 * day 32 of January is February 1st, and day 0 of March is the last of
 * February, leap year included. And because it is UTC, one day is always 24
 * hours — the spring-forward day is not 23 hours long here, so stepping across
 * it cannot land twice on the same date or skip one.
 *
 * It counts CALENDAR days, which for one exotic case is not the same as days a
 * given zone actually had: Samoa skipped 2011-12-30 entirely when it crossed
 * the date line, and this would still count through it. Harmless here — the
 * PRD configures one zone per user with no travel handling, and plan rows are
 * keyed by calendar date — but it is the assumption, so it is written down.
 */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const { year, month, day } = parseCalendarDate(date);

  return fromUtcMillis(Date.UTC(year, month - 1, day + days));
}

/** Milliseconds in a UTC day. Always exactly this, which is the whole point. */
const DAY_MILLIS = 24 * 60 * 60 * 1000;

/**
 * Whole days from `from` to `to`. Negative when `to` is the earlier date.
 *
 * The inverse of `addDays`, and the counting half of the Circuit A/B rotation:
 * `rotation.ts` needs to know how many days have elapsed since
 * `program_start_date` before it can count how many of them were training days.
 *
 * Exact by construction rather than by rounding. Both dates become UTC midnight,
 * and a UTC day is always 86,400,000 milliseconds, so the subtraction is a whole
 * number of days with no remainder to lose — no `Math.round` papering over a
 * 23-hour day, which is what the same subtraction on local midnights would need
 * twice a year. Over the spring-forward weekend a local-time version returns
 * 0.958 of a day; this returns 1.
 */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const start = toUtcMillis(parseCalendarDate(from));
  const end = toUtcMillis(parseCalendarDate(to));

  return (end - start) / DAY_MILLIS;
}

/**
 * The Monday of the week containing `date`.
 *
 * Monday-first is a DISPLAY convention — the Testing Strategy's week grid runs
 * Monday to Sunday — while storage stays 0 = Sunday to match `getUTCDay()` and
 * the migrated `day_of_week` column. Keeping the two apart here means neither
 * has to bend: nothing reinterprets stored rows, and the grid still starts
 * where the PRD's mockup starts.
 */
export function startOfWeek(date: CalendarDate): CalendarDate {
  // Sunday is 0 but belongs at the END of a Monday-first week, so it steps back
  // six days rather than none: (0 + 6) % 7 = 6.
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}
