import { describe, expect, it } from "vitest";

import type { ShoppingGroup, ShoppingLine } from "./shopping-list";
import { quantity, shoppingText } from "./shopping-text";

/**
 * FUEL-45 — how a shopping line is written down, and the ways it can overclaim.
 *
 * Gated at 100% alongside `shopping-list.ts`, and for the adjacent reason. That
 * file's failures are arithmetic that prints a plausible number; this file's are
 * a plausible number printed without the qualifier that made it honest. A line
 * reading "300g" when the true answer is "at least 300g" is not a rendering
 * nit — it is a shop that comes up short, discovered in the kitchen.
 *
 * The three `grams` / `gramsPartial` states are therefore each asserted
 * separately rather than through one representative case: they are the whole
 * contract between this module and the aggregator, and two of them differ by a
 * single character.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A line with everything defaulted to the least interesting answer.
 *
 * Overridden per test, so each case names ONLY the fields it is about and a
 * reader can see the variable without diffing two object literals.
 */
const line = (over: Partial<ShoppingLine> = {}): ShoppingLine => ({
  key: "beef mince",
  name: "Beef mince",
  category: "meat",
  grams: 300,
  gramsPartial: false,
  measures: [],
  times: 1,
  ...over,
});

const group = (category: ShoppingGroup["category"], lines: ShoppingLine[]): ShoppingGroup => ({
  category,
  lines,
});

/* -------------------------------------------------------------------------- */
/* quantity                                                                   */
/* -------------------------------------------------------------------------- */

describe("quantity", () => {
  it("prints a complete weight as a bare figure", () => {
    expect(quantity(line({ grams: 300, gramsPartial: false }))).toBe("300g");
  });

  it("marks a weight some contributing row did not carry", () => {
    // The distinction the whole flag exists for: 20g of butter that is really
    // "20g and however much the unweighed row wanted".
    expect(quantity(line({ grams: 20, gramsPartial: true }))).toBe("20g +");
  });

  it("prints no weight at all rather than a zero when nothing was weighed", () => {
    // "0g" would be a claim that the shop needs none of it, which is the
    // opposite of what an unweighed ingredient means.
    expect(quantity(line({ grams: null, gramsPartial: true, measures: [] }))).toBe("");
  });

  it("groups thousands in a large weight", () => {
    // Through `figure`, so this file cannot come to its own view of how a
    // number is punctuated. 1200g of potatoes is a real weekly figure.
    expect(quantity(line({ grams: 1200 }))).toBe("1,200g");
  });

  it("keeps one decimal place on a fractional weight", () => {
    expect(quantity(line({ grams: 60.3 }))).toBe("60.3g");
  });

  it("prints a measure asked for once without a multiplier", () => {
    // "×1" is a count of one dressed as arithmetic.
    expect(
      quantity(line({ grams: null, measures: [{ text: "a big handful", times: 1 }] })),
    ).toBe("a big handful");
  });

  it("counts a repeated measure rather than multiplying it out", () => {
    expect(quantity(line({ grams: null, measures: [{ text: "1 clove", times: 5 }] }))).toBe(
      "1 clove ×5",
    );
  });

  it("lists several measures in the order the week asks for them", () => {
    expect(
      quantity(
        line({
          grams: null,
          measures: [
            { text: "1/2 tsp", times: 2 },
            { text: "to taste", times: 1 },
          ],
        }),
      ),
    ).toBe("1/2 tsp ×2 · to taste");
  });

  it("puts the weight before the measures when a line has both", () => {
    expect(
      quantity(
        line({ grams: 150, gramsPartial: true, measures: [{ text: "1 clove", times: 2 }] }),
      ),
    ).toBe("150g + · 1 clove ×2");
  });
});

/* -------------------------------------------------------------------------- */
/* shoppingText                                                               */
/* -------------------------------------------------------------------------- */

describe("shoppingText", () => {
  const GROUPS: ShoppingGroup[] = [
    group("produce", [
      line({ key: "onion", name: "Onion", category: "produce", grams: null, measures: [{ text: "2", times: 1 }] }),
      line({ key: "spinach", name: "Spinach", category: "produce", grams: 200 }),
    ]),
    group("meat", [line({ key: "beef mince", name: "Beef mince", category: "meat", grams: 300 })]),
  ];

  it("writes each aisle as a heading with its lines beneath", () => {
    expect(shoppingText(GROUPS, new Set())).toBe(
      [
        "PRODUCE",
        "- [ ] Onion  2",
        "- [ ] Spinach  200g",
        "",
        "MEAT",
        "- [ ] Beef mince  300g",
      ].join("\n"),
    );
  });

  it("carries the check state into the copied text", () => {
    // The point of the format: what is pasted says what the screen said.
    const text = shoppingText(GROUPS, new Set(["spinach"]));

    expect(text).toContain("- [x] Spinach  200g");
    expect(text).toContain("- [ ] Onion  2");
  });

  it("matches on the normalised key and not on the displayed name", () => {
    // The asymmetry the persistence depends on: the tick is stored against
    // "beef mince" while the line reads "Beef mince". A renderer that compared
    // display names would show every line unchecked and look merely empty.
    expect(shoppingText(GROUPS, new Set(["beef mince"]))).toContain("- [x] Beef mince");
  });

  it("leaves a line with no quantity as just its name", () => {
    // No trailing separator and no dash standing in for the absence: the name
    // is the whole instruction for salt.
    const salt = group("other", [
      line({ key: "salt", name: "Salt", category: "other", grams: null, measures: [] }),
    ]);

    expect(shoppingText([salt], new Set())).toBe("OTHER\n- [ ] Salt");
  });

  it("returns nothing at all for a week with nothing to shop for", () => {
    // Not a sentence — the screen's empty state owns that copy, and there is
    // nothing here to put on a clipboard.
    expect(shoppingText([], new Set())).toBe("");
  });

  it("ignores a checked key the list no longer contains", () => {
    // A tick left behind by a swap. It renders nowhere rather than reappearing
    // as a line the week does not need — see `shopping_checks` on why the row
    // is kept rather than swept.
    expect(shoppingText(GROUPS, new Set(["pork mince"]))).not.toContain("pork");
  });
});
