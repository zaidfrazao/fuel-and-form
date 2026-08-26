import { figure } from "./format";
import type { ShoppingGroup, ShoppingLine } from "./shopping-list";

/**
 * How a shopping line reads, on the screen and in the clipboard — FUEL-45.
 *
 * `shopping-list.ts` decides WHAT the week needs; this decides how each line is
 * written down. The split matters because the two answers have different
 * consumers: the aggregate is arithmetic that a wrong answer hides inside a
 * plausible number, while this is prose, and the failure here is a line that
 * reads as more certain than the data behind it.
 *
 * ## One renderer, two destinations
 *
 * P8's last criterion is copy-to-clipboard, and the obvious way to build it is
 * a second pass that walks the same groups and writes them out again. That is
 * two places where "20g +" is decided, and they diverge on the first change to
 * either — at which point the list someone pastes into their notes disagrees
 * with the list they were just reading, in a way neither screen reveals.
 *
 * So `quantity` is the single sentence, and both the row and the text file call
 * it. What the clipboard adds is the frame around the lines, not the lines.
 *
 * ## Pure, and no schema types
 *
 * Called from a client component (the copy button) and from a server-rendered
 * row, so nothing here may drag `pg-core` into the browser bundle —
 * `shopping-list.ts` states the rule and this file inherits it by importing
 * only that module's own types.
 */

/**
 * What one line asks the shop for — `300g`, `20g +`, `1 clove ×5`.
 *
 * ## Why the plus sign is not decoration
 *
 * `gramsPartial` says some contributing row carried no weight, and
 * `shopping-list.ts` argues at length why printing the bare sum would be the
 * worst available answer: it understates the shop by an unknown amount while
 * looking exactly like a complete figure. The trailing `+` is the smallest
 * mark that turns "300g" into "at least 300g", and it is the reason the flag
 * exists at all.
 *
 * ## The three states, and why the last one is not "0g"
 *
 * A line with no weight anywhere — salt to taste, a handful of spinach — prints
 * its measures alone. Not "0g +", which claims the shop needs none of it, and
 * not an empty string, which would leave a bare name that reads as an item
 * nobody finished typing. Where there is neither a weight nor a measure the
 * name IS the whole instruction, and an em dash would be an absence dressed up
 * as information.
 *
 * ## Occurrences are counted, never multiplied out
 *
 * `1 clove ×5` rather than `5 cloves`. The measures are free text the recipes
 * wrote — "a big handful", "1/2–3/4 tsp", "to taste, generously" — and there is
 * no arithmetic that turns those into a quantity. Multiplying the ones that
 * happen to start with a digit would be right for cloves and wrong for
 * handfuls, and the reader cannot tell from the result which of the two they
 * are holding. A count is honest about being a count.
 *
 * A measure asked for exactly once carries no multiplier, because "×1" is a
 * count of one dressed as arithmetic.
 */
export function quantity(line: ShoppingLine): string {
  const parts: string[] = [];

  if (line.grams !== null) {
    parts.push(line.gramsPartial ? `${figure(line.grams)}g +` : `${figure(line.grams)}g`);
  }

  for (const measure of line.measures) {
    parts.push(measure.times > 1 ? `${measure.text} ×${measure.times}` : measure.text);
  }

  // A middle dot rather than a comma: the parts are alternative ways of saying
  // the same amount rather than a list of separate things to buy, and § Slash
  // Metadata already uses a separator of this weight for exactly that reading.
  return parts.join(" · ");
}

/**
 * A line as one row of plain text — `- [x] Beef mince  300g`.
 *
 * Two spaces between name and quantity rather than one, so a run of lines has a
 * visible seam down it in a monospaced pane without any alignment arithmetic
 * that a proportional font would then throw away.
 *
 * The name keeps its display casing (`ShoppingLine.name`, as first encountered)
 * while the tick was stored against the normalised key. That asymmetry is the
 * whole design: what is compared is not what is read.
 */
function textLine(line: ShoppingLine, checked: boolean): string {
  const box = checked ? "- [x]" : "- [ ]";
  const amount = quantity(line);

  return amount ? `${box} ${line.name}  ${amount}` : `${box} ${line.name}`;
}

/**
 * The whole list as plain text — P8's copy-to-clipboard.
 *
 * ## A task list, because the ticks are worth carrying
 *
 * `- [ ]` / `- [x]` is the one plain-text convention for a checkable list that
 * is legible with no renderer at all and still becomes a real checklist in the
 * places this gets pasted. Copying the check state — rather than dropping it,
 * or silently omitting the ticked lines — means the pasted copy says the same
 * thing the screen did. A copy that quietly left items out would be
 * indistinguishable from a shorter week.
 *
 * ## Aisle headings in caps, and no other markup
 *
 * Upper case rather than `##`, because the destination is a notes app or a
 * message and not necessarily a Markdown renderer. Caps read as a heading
 * everywhere, including where nothing is interpreting the text at all.
 *
 * ## An empty list is an empty string
 *
 * Not "Nothing to buy" — a sentence would be this module inventing copy, and
 * the screen's own empty state (§ Tone of Voice: describe what will appear) has
 * already said it better in context. There is also nothing to copy, and the
 * caller is the right place to decide that the button should not be offered.
 */
export function shoppingText(
  groups: readonly ShoppingGroup[],
  checked: ReadonlySet<string>,
): string {
  return groups
    .map((group) =>
      [
        group.category.toUpperCase(),
        ...group.lines.map((line) => textLine(line, checked.has(line.key))),
      ].join("\n"),
    )
    .join("\n\n");
}
