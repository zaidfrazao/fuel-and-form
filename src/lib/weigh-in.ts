import { type CalendarDate, daysBetween, parseCalendarDate } from "./date";
import { parseNote } from "./session-entry";

/**
 * What a weigh-in is allowed to say — FUEL-34's refusals, PRD § P5.
 *
 * Every value here arrives from a Server Action, which is to say from anyone who
 * can POST to this app, and this is where they are checked. It is a module
 * rather than three lines inside `actions/weight.ts` for the reason
 * `session-entry.ts`, `slot-times.ts` and `repeat.ts` all give: a refusal
 * exercised only through a Server Action is one no hermetic test can hold
 * still, and these refusals fail silently.
 *
 * Silently is the word that matters. An unchecked status reaches Postgres as an
 * invalid enum and throws, which is at least visible; an unchecked WEIGHT is
 * stored. `numeric(5, 2)` accepts 774 as readily as 77.4, rounds a third
 * decimal without saying so, and the row then sits in the history looking
 * exactly like a measurement. P5 calls this "the single number the whole
 * program is judged on", FUEL-35 draws a chart from it and FUEL-36 computes a
 * trailing rate from it — one fat-fingered row flattens the first and skews the
 * second, and nothing on either screen says which point is the bad one.
 *
 * ## Pure, and given its clock
 *
 * No database, no session, no `Date.now()`. Today is an argument, the
 * arrangement `resolve-now.ts`, `today.ts` and `loadTraining` all keep, and the
 * reason the date a test asks for is the date it gets. Only a type import from
 * `date.ts` and one function from `session-entry.ts`, so a client component can
 * import `MIN_KG` and `MAX_KG` without dragging pg-core into the browser
 * bundle.
 *
 * ## One answer for every refusal
 *
 * `parseWeighIn` returns `null` for a weight out of range, a date that does not
 * exist, a date in the future and a note too long alike. `actions/training.ts`'s
 * reasoning: the screen's response to all of them is identical, and a caller
 * who could tell one from another learns something about the deployment for
 * nothing.
 */

/**
 * The lightest and heaviest weigh-in that will be stored, in kilograms.
 *
 * Not a judgement about bodies. `weight_logs.weight_kg` is `numeric(5, 2)`, so
 * the column's own ceiling is 999.99 — these are tighter, and what they buy is
 * the typo. The two ways a scale reading gets mistyped are a dropped separator
 * (`774` for `77.4`) and a doubled digit (`777.4`), and both land outside this
 * range while every real reading lands inside it.
 *
 * Wide enough that no one is ever refused: the range covers a small child and
 * the heaviest human on record, and the PRD's persona starts at 84.2kg heading
 * for 76. A bound that could plausibly refuse a real weigh-in would be a bound
 * that loses data, which is worse than the typo it prevents.
 */
export const MIN_KG = 20;
export const MAX_KG = 400;

/** A validated row's worth of weigh-in — what `recordWeighIn` takes. */
export type WeighIn = {
  date: CalendarDate;
  weightKg: number;
  note: string | null;
};

/**
 * Four digits, an optional separator, and digits — nothing else.
 *
 * A pattern rather than `Number(value)` because `Number` is far too willing:
 * `Number("")` and `Number(" ")` are both 0, `Number("0x4d")` is 77, `Number
 * ("1e2")` is 100, and each of those is a string a probe can send and a number
 * this file would then have to argue about. The pattern refuses all of them,
 * along with signs — a negative weigh-in is not a reading — before any
 * arithmetic happens.
 *
 * A leading digit is required, so `.5` is refused. It is out of range anyway;
 * refusing it here means the range check never has to explain itself for a
 * string nobody types on purpose.
 */
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/**
 * The scale reading as it will be stored, or `undefined` for one that will not.
 *
 * ## Both separators, one meaning
 *
 * FUEL-34's criterion: `77.4` and `77,4` are the same reading. A German or
 * French keyboard's numeric pad puts a comma where an English one puts a full
 * stop, and iOS's decimal pad follows the phone's locale — so the separator a
 * user gets is a property of their device, not a thing they chose, and refusing
 * one of them would make the app unusable on a phone with the wrong locale
 * while looking like a validation bug.
 *
 * A string carrying BOTH is refused rather than interpreted. `1,234.5` is a
 * thousands separator in English and `1.234,5` is the same number in German,
 * and there is no way to tell from the string alone which convention a person
 * was following. Guessing is how 1234.5 kg gets stored, and the guess would be
 * wrong exactly half the time.
 *
 * ## Rounded here, not by Postgres
 *
 * `numeric(5, 2)` rounds a third decimal on the way in and says nothing about
 * it, so 77.456 comes back from the database as 77.46 — a number the user never
 * typed, arriving with no explanation. The rounding happens here instead: the
 * app is then the thing that decided, the decision is one line, and a test can
 * assert it. Two decimals is more precision than any bathroom scale has.
 *
 * The range is checked AFTER rounding, because the rounded value is what would
 * be stored and a bound that tested a number the database never sees would be
 * testing the wrong thing.
 */
export function parseWeightKg(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();

  // Before the pattern, which accepts a single separator of either kind and so
  // cannot tell `1,234.5` apart from a reading on its own.
  if (trimmed.includes(",") && trimmed.includes(".")) return undefined;

  if (!DECIMAL.test(trimmed)) return undefined;

  const kilograms = Math.round(Number(trimmed.replace(",", ".")) * 100) / 100;

  return kilograms >= MIN_KG && kilograms <= MAX_KG ? kilograms : undefined;
}

/**
 * The date a weigh-in can be recorded against, or `undefined` for one it cannot.
 *
 * ## Not in the future
 *
 * A measurement that has not been taken is not a measurement. The screen's date
 * input carries `max`, which is what stops it happening by accident, but an
 * input attribute is a suggestion to a browser and this is a Server Action — so
 * the refusal has to exist somewhere a POST cannot skip, and this is it.
 *
 * ## No lower bound
 *
 * Deliberately unlike `actions/plan.ts`, which refuses dates before
 * `program_start_date`. A plan has nothing to say about a day before the program
 * existed; a weigh-in from before it started is the starting weight, which is
 * the number every later one is measured against. P5 asks for progress "as a
 * percentage of the start -> target journey", so the history is allowed to reach
 * back further than the plan does.
 *
 * @param today today in the user's own zone, from `profiles.timezone`. Given
 *   rather than read, so "the future" means the user's midnight and not the
 *   server's — a weigh-in logged at 08:00 in Johannesburg is not tomorrow.
 */
export function parseWeighInDate(
  value: unknown,
  today: CalendarDate,
): CalendarDate | undefined {
  if (typeof value !== "string") return undefined;

  try {
    // Throws on a shape that is not 'YYYY-MM-DD' and on a date that does not
    // exist ('2026-02-30'). Caught rather than propagated: this function's
    // contract is one answer for every refusal, and the action above it must
    // never throw.
    parseCalendarDate(value);
  } catch {
    return undefined;
  }

  return daysBetween(today, value) > 0 ? undefined : value;
}

/**
 * The weigh-in a request is asking to record, or `null` if it is not a valid one.
 *
 * One function rather than three guards at the call site, on `session-entry.ts`'s
 * reasoning: the three fields are written together in one statement, so they are
 * refused together. A caller made to remember three separate checks would
 * eventually remember two, and the one it forgot would be the weight.
 */
export function parseWeighIn(
  input: { date: unknown; weight: unknown; note?: unknown },
  today: CalendarDate,
): WeighIn | null {
  const date = parseWeighInDate(input.date, today);
  const weightKg = parseWeightKg(input.weight);
  const note = parseNote(input.note);

  if (date === undefined || weightKg === undefined || note === undefined) return null;

  return { date, weightKg, note };
}
