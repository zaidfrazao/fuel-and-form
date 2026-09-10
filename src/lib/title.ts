/**
 * A name as a Title sets it — FUEL-117.
 *
 * Headings balance (`globals.css`), and balancing chooses among the break
 * opportunities the text offers. A spaced dash offers one on each side, so the
 * library's variant names — "Overnight Oats — PB Cocoa" — were free to open
 * their second line with the dash: "Overnight Oats / — PB Cocoa" at 375. The
 * dash separates the dish from its variant and belongs at the end of the dish's
 * line, which is where the ticket found the one good break it reported.
 *
 * A no-break space before the dash removes the break in front of it and leaves
 * the one after. Measured against the same 258 cases as the balance rule: all
 * three variants then break "Overnight Oats — / …" at every width where they
 * wrap, and still no Title is taller.
 *
 * Em and en dashes, and only when spaced on both sides — a dash set as
 * punctuation between two phrases. An unspaced one joins what is either side
 * of it and offers no break in front, and a hyphen, as in "Lemon-Garlic", is a
 * different character that is never touched. `+` is left alone — "Greek Yogurt /
 * + Berries" reads as an addition, and a greedy wrap already set "Skipping
 * Intervals / + Core" that way before balancing existed.
 *
 * Only the rendered text changes; the stored name is untouched, and a screen
 * reader reads U+00A0 as the space it replaces. A test is the one reader that
 * can tell: Testing Library matches a role's `name` exactly, so a heading
 * query spelling the dash with an ordinary space will not find it.
 */
export function titleText(name: string): string {
  return name.replace(/ ([—–]) /g, "\u00A0$1 ");
}
