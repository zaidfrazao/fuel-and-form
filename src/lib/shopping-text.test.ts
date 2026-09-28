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
 * The `amounts` / `partial` states are therefore each asserted separately
 * rather than through one representative case: they are the whole contract
 * between this module and the aggregator, and two of them differ by a single
 * character.
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
  section: "meat",
  amounts: [{ qty: 300, unit: "g" }],
  partial: false,
  times: 1,
  ...over,
});

const group = (section: ShoppingGroup["section"], lines: ShoppingLine[]): ShoppingGroup => ({
  section,
  lines,
});

/** One amount, for the cases about how a single figure reads. */
const one = (qty: number, unit: string | null) => line({ amounts: [{ qty, unit }] });

/* -------------------------------------------------------------------------- */
/* quantity                                                                   */
/* -------------------------------------------------------------------------- */

describe("quantity", () => {
  it("prints a complete weight as a bare figure", () => {
    expect(quantity(one(300, "g"))).toBe("300g");
  });

  it("marks an amount some contributing row did not carry", () => {
    // The distinction the whole flag exists for: 20g of butter that is really
    // "20g and however much the unmeasured row wanted".
    expect(quantity(line({ amounts: [{ qty: 20, unit: "g" }], partial: true }))).toBe("20g +");
  });

  it("prints nothing rather than a zero when nothing carried an amount", () => {
    // "0g" would be a claim that the shop needs none of it, which is the
    // opposite of what an unmeasured ingredient means. The flag alone does not
    // conjure a "+" out of no figure.
    expect(quantity(line({ amounts: [], partial: true }))).toBe("");
  });

  it("groups thousands in a large weight", () => {
    // Through `figure`, so this file cannot come to its own view of how a
    // number is punctuated. 1200g of potatoes is a real weekly figure.
    expect(quantity(one(1200, "g"))).toBe("1,200g");
  });

  it("keeps one decimal place on a fractional weight", () => {
    expect(quantity(one(60.3, "g"))).toBe("60.3g");
  });

  it("writes every metric unit straight onto the figure", () => {
    expect([one(935, "ml"), one(1.5, "l"), one(2, "kg")].map(quantity)).toEqual([
      "935ml",
      "1.5l",
      "2kg",
    ]);
  });

  it("sums a counted unit into one figure, pluralised above one", () => {
    // FUEL-137: "5 cloves", where this printed "1 clove ×5".
    expect(quantity(one(5, "clove"))).toBe("5 cloves");
    expect(quantity(one(1, "slice"))).toBe("1 slice");
  });

  it("keeps a counted unit singular at a fraction of one", () => {
    expect(quantity(one(0.5, "slice"))).toBe("½ slice");
  });

  it("prints a bare count with no unit at all", () => {
    // "Eggs 4", as the shop reads it.
    expect(quantity(one(4, null))).toBe("4");
  });

  it("prints quarters as the glyphs a recipe would", () => {
    expect([0.25, 0.5, 0.75, 1.5, 2.25].map((qty) => quantity(one(qty, null)))).toEqual([
      "¼",
      "½",
      "¾",
      "1½",
      "2¼",
    ]);
  });

  it("falls back to a decimal for a fraction that is not a quarter", () => {
    expect(quantity(one(0.3, null))).toBe("0.3");
    expect(quantity(one(2.6, "clove"))).toBe("2.6 cloves");
  });

  it("joins two units with a plus rather than adding them", () => {
    expect(
      quantity(
        line({
          amounts: [
            { qty: 45, unit: "g" },
            { qty: 2, unit: "slice" },
          ],
          partial: true,
        }),
      ),
    ).toBe("45g + 2 slices +");
  });
});

/* -------------------------------------------------------------------------- */
/* shoppingText                                                               */
/* -------------------------------------------------------------------------- */

describe("shoppingText", () => {
  const GROUPS: ShoppingGroup[] = [
    group("produce", [
      line({ key: "onion", name: "Onion", section: "produce", amounts: [{ qty: 2, unit: null }] }),
      line({ key: "spinach", name: "Spinach", section: "produce", amounts: [{ qty: 200, unit: "g" }] }),
    ]),
    group("meat", [line({ key: "beef mince", name: "Beef mince", section: "meat" })]),
    group("pantry", [line({ key: "salt", name: "Salt", section: "pantry", amounts: [] })]),
  ];

  it("writes each section as a heading with its lines beneath, the pantry last", () => {
    expect(shoppingText(GROUPS, new Set())).toBe(
      [
        "PRODUCE",
        "- [ ] Onion  2",
        "- [ ] Spinach  200g",
        "",
        "MEAT",
        "- [ ] Beef mince  300g",
        "",
        "PANTRY",
        "- [ ] Salt",
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
      line({ key: "salt", name: "Salt", section: "other", amounts: [], partial: true }),
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
