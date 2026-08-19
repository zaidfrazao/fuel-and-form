import { addDays, type CalendarDate } from "./date";

/**
 * How many days a repeat covers, and which ones — PRD § P2's "Repeat for N
 * days".
 *
 * The second of P2's two swap modes. Substitute (FUEL-23) replaces one date's
 * meal; repeat pushes the same meal onto a run of consecutive dates, because
 * the thing that actually happens in a kitchen is thawing too much mince and
 * eating chilli on Tuesday *and* Wednesday.
 *
 * ## Why this is its own module rather than four lines in the action
 *
 * `days` is the first value in this app that a client can name and that
 * controls HOW MANY ROWS a request writes. Every other client-supplied value so
 * far picks WHICH row — a meal id, a cursor position, an item key — and the
 * worst a forged one can do is name something that does not exist. This one is
 * a multiplier, so validating it is a security boundary and not a form nicety:
 * unbounded, `repeatMeal(key, mealId, 100000)` is one request that writes a
 * hundred thousand override rows into the caller's own plan, and nothing
 * downstream would refuse it. `day_plan_overrides` is unique on
 * `(user_id, date, slot)`, so they would not even collide — they would all be
 * valid, and someone would have to delete them by hand.
 *
 * Extracting it also puts the bound and the control that offers it in one file.
 * `REPEAT_COUNTS` is derived from the same two constants the validator checks
 * against, so the sheet cannot offer a count the endpoint refuses, and widening
 * the range is one edit rather than two that have to agree.
 *
 * ## Pure, and it does no calendar arithmetic of its own
 *
 * Every date comes from `date.ts`'s `addDays`, which goes through `Date.UTC`
 * and is therefore already correct across a week end, a month end, a year end,
 * a leap day and a daylight-saving transition. That is the whole reason this
 * module is short: the task's acceptance criterion about week and month
 * boundaries is INHERITED from arithmetic that is already gated at 100%, rather
 * than re-implemented here where it could disagree.
 *
 * No database, no session, no clock — the start date is an argument, so the
 * boundary cases are named dates in a test rather than a mocked calendar.
 */

/**
 * The shortest run that is a repeat at all.
 *
 * Two, not one: a "repeat" of a single day is exactly the substitute FUEL-23
 * already ships, so accepting it would give the app two endpoints that do the
 * same write and two controls that mean the same thing. Refusing it keeps the
 * two modes distinguishable in the code as they are in the PRD.
 *
 * It is also what makes the button's copy honest. The Brand Guide's own example
 * of the Text variant is "Repeat for 2 days", and its story is chilli on
 * Tuesday and Wednesday — so N counts the START date plus the following ones,
 * and "2 days" writes two rows. Reading N as "days in ADDITION to today" would
 * make the guide's own example produce three dinners from a button that says
 * two.
 */
export const REPEAT_MIN = 2;

/**
 * The longest, and the reason there is a limit at all.
 *
 * A week. The PRD is explicit that "editing the template itself is a separate,
 * explicit action", and a repeat that could cover a month would be a way to
 * rewrite the recurring plan through a control that is deliberately tertiary —
 * the divergence would stop being "a single dated divergence" and become the
 * plan. Seven days is the longest run that still plainly means *this batch of
 * mince* rather than *this is what I eat now*.
 *
 * It doubles as the bound on write amplification described above: the most one
 * request can create is seven rows, which is a number the user could have
 * produced by hand with seven taps.
 */
export const REPEAT_MAX = 7;

/**
 * The counts the sheet's stepper offers, derived rather than written out.
 *
 * A literal `[2, 3, 4, 5, 6, 7]` in the component would be a second statement
 * of the range that could fall out of step with the one `repeatDates` enforces
 * — and the way anyone would find out is a control offering a count the server
 * refuses, which reads as the button being broken rather than as a bound being
 * hit.
 */
export const REPEAT_COUNTS: readonly number[] = Array.from(
  { length: REPEAT_MAX - REPEAT_MIN + 1 },
  (_, index) => REPEAT_MIN + index,
);

/**
 * The consecutive dates a repeat of `days` days starting at `from` covers, or
 * `null` if `days` is not a count this app will act on.
 *
 * `null` rather than a throw. `parseCalendarDate` throws on a malformed date
 * and is right to — a bad date is a bug in the caller. A bad `days` is not: it
 * arrives from outside, over the wire, and the caller is a Server Action whose
 * entire contract is that it answers `{ ok: false }` instead of throwing (see
 * app/actions/swap.ts). A throw here would be the one path that broke that,
 * turning a refusal into a 500.
 *
 * Refused rather than clamped, which is the other tempting shape. Clamping a 30
 * to a 7 would write a different number of days from the one the control named,
 * and the control's entire job is to say how many — a user who asked for 30 and
 * silently got 7 has been told nothing, and one who asked for 1.5 and got 2 has
 * been told something false. Nothing in the product can produce an
 * out-of-range value, so anything that reaches here is either a forged request
 * or a bug, and both are better answered than accommodated.
 *
 * `Number.isInteger` is doing four jobs in one call: it rejects NaN, both
 * infinities, and any fraction, alongside the obvious non-numbers a widened
 * type or a `JSON.parse` could deliver. Written as `days % 1 !== 0` it would
 * accept `Infinity`, which then makes `Array.from({ length: Infinity })` throw
 * — the exact failure this returns `null` to avoid.
 *
 * `from` is deliberately NOT validated here beyond what `addDays` does. It is
 * server-derived — the resolved day, from the user's configured timezone — and
 * never crosses the wire, so a malformed one is a bug in this codebase and
 * should throw where `parseCalendarDate` throws rather than be quietly reported
 * as a refused repeat.
 */
export function repeatDates(from: CalendarDate, days: number): CalendarDate[] | null {
  if (!Number.isInteger(days) || days < REPEAT_MIN || days > REPEAT_MAX) {
    return null;
  }

  // Starting at offset 0, so the run INCLUDES `from` — see `REPEAT_MIN`. The
  // dates are therefore strictly increasing and distinct by construction, which
  // is what lets the batch write be a single ON CONFLICT statement: Postgres
  // refuses one that would touch the same row twice, and two equal dates in one
  // batch is the only way that could happen.
  return Array.from({ length: days }, (_, offset) => addDays(from, offset));
}
