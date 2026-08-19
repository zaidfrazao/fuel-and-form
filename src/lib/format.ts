/**
 * How a number is written down — the Brand Guide's § Content Guidelines, in two
 * functions.
 *
 * Extracted from `day-complete.tsx`, which had both to itself until the swap
 * (FUEL-23) needed the same two: once for the note under a swapped card, once
 * for the day totals inside the picker sheet. Three copies of a sign convention
 * is three chances for one of them to print a hyphen where the guide asks for a
 * minus sign, and the difference is invisible until someone looks at the two
 * side by side.
 *
 * Deliberately not `server-only` and importing nothing: both the server-rendered
 * summary and the client-side live preview call these, and the answer has to be
 * the same on both sides of the wire or the value will visibly change as the
 * page hydrates.
 */

/**
 * Grouped thousands, at most one decimal — `1,715`, `32.5`.
 *
 * A fixed locale rather than the visitor's: `Intl` with no locale reads the
 * runtime's, which would print `1.715` for a European browser against a brand
 * voice written in English, and would make the suite's assertions depend on the
 * machine running them. It is also what keeps the server's render and the
 * browser's agreeing, since those are two different runtimes.
 *
 * One decimal because that is what the grams columns store (`numeric(6, 1)`).
 * kcal is an integer column, so the option never fires on it.
 */
const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/** A figure, grouped and rounded for display. */
export function figure(value: number): string {
  return NUMBER.format(value);
}

/**
 * A delta, with the Brand Guide's sign in front of it.
 *
 * U+2212 MINUS SIGN, not a hyphen: it is the glyph the guide writes the
 * convention in (`−21`, never "21 under") and the one that lines up under
 * tabular figures. Zero carries no sign at all — `+0` and `−0` both read as a
 * near miss on a day that hit the target exactly, and `macros.ts` already
 * guarantees the value is a true zero rather than JavaScript's `-0`.
 */
export function signed(value: number): string {
  if (value === 0) return "0";

  return value > 0 ? `+${NUMBER.format(value)}` : `−${NUMBER.format(-value)}`;
}
