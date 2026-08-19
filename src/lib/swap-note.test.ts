import { describe, expect, it } from "vitest";

import type { MacroBearing } from "./macros";
import { swapNote } from "./swap-note";

/**
 * The one sentence a swap prints.
 *
 * Every case here is a claim about the Brand Guide rather than about the
 * arithmetic: the exact glyph of the minus sign, the order of the clauses, the
 * absence of an apology, and the two states — no change, nothing displaced —
 * where the obvious sentence would say something untrue.
 */

const macros = (fields: Partial<MacroBearing> = {}): MacroBearing => ({
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  ...fields,
});

describe("swapNote", () => {
  it("prints the Brand Guide's sentence, verbatim", () => {
    // docs/BRAND_GUIDE.md § UI Copy Examples, the Swap row. The 21 and the 140
    // are the guide's own figures, so this is the copy example itself rather
    // than a paraphrase of it.
    const from = macros({ proteinG: 45, kcal: 700 });
    const to = macros({ proteinG: 24, kcal: 560 });

    expect(swapNote(from, to)).toBe("Swapped. −21g protein, −140 kcal today.");
  });

  it("uses U+2212 MINUS SIGN, not a hyphen", () => {
    // The two are indistinguishable in most editors and a hyphen is what a
    // careless edit produces. It is also visibly shorter beside a figure.
    const note = swapNote(macros({ proteinG: 45 }), macros({ proteinG: 24 }));

    expect(note).toContain("−");
    expect(note).not.toContain("-");
  });

  it("signs a gain with a plus", () => {
    const from = macros({ proteinG: 24, kcal: 560 });
    const to = macros({ proteinG: 45, kcal: 700 });

    expect(swapNote(from, to)).toBe("Swapped. +21g protein, +140 kcal today.");
  });

  it("states an unwelcome consequence as plainly as a welcome one", () => {
    // § Content Guidelines: "State consequences factually and immediately,
    // including unwelcome ones." Losing 21g of protein reads the same way as
    // gaining it, in the same shape of sentence.
    const lost = swapNote(macros({ proteinG: 45 }), macros({ proteinG: 24 }));
    const gained = swapNote(macros({ proteinG: 24 }), macros({ proteinG: 45 }));

    expect(lost).toBe("Swapped. −21g protein today.");
    expect(gained).toBe("Swapped. +21g protein today.");
  });

  it("puts protein before kcal", () => {
    const note = swapNote(macros({ proteinG: 45, kcal: 700 }), macros({ proteinG: 24, kcal: 560 }));

    expect(note.indexOf("protein")).toBeLessThan(note.indexOf("kcal"));
  });

  it("drops a clause whose delta is zero", () => {
    const sameKcal = swapNote(
      macros({ proteinG: 45, kcal: 700 }),
      macros({ proteinG: 24, kcal: 700 }),
    );
    const sameProtein = swapNote(
      macros({ proteinG: 45, kcal: 700 }),
      macros({ proteinG: 45, kcal: 560 }),
    );

    expect(sameKcal).toBe("Swapped. −21g protein today.");
    expect(sameProtein).toBe("Swapped. −140 kcal today.");
  });

  it("says only 'Swapped.' when neither figure moved", () => {
    // Two meals with the same numbers. "−0g protein" would report a change
    // that did not happen, and there is nothing else honest to add.
    expect(swapNote(macros(), macros({ fatG: 99 }))).toBe("Swapped.");
  });

  it("counts the whole meal when the template plans nothing for the slot", () => {
    // A swap into an empty slot is an extra meal, today only. The day gains all
    // of it, and `null` is the template saying so rather than a missing value.
    expect(swapNote(null, macros({ proteinG: 38, kcal: 610 }))).toBe(
      "Swapped. +38g protein, +610 kcal today.",
    );
  });

  it("reads a swap to an untracked meal as the loss of what it displaced", () => {
    // `totalMacros` skips untracked meals, so the day really does lose the
    // whole of the displaced one. An unexplained zero would be the alternative.
    const from = macros({ proteinG: 45, kcal: 700 });
    const to = macros({ proteinG: 45, kcal: 700, isUntracked: true });

    expect(swapNote(from, to)).toBe("Swapped. −45g protein, −700 kcal today.");
  });

  it("keeps one decimal place and never prints a floating-point tail", () => {
    // 40.2 − 61.5 is −21.299999999999997 in binary floating point.
    const note = swapNote(macros({ proteinG: 61.5 }), macros({ proteinG: 40.2 }));

    expect(note).toBe("Swapped. −21.3g protein today.");
  });

  it("groups thousands in a large kcal swing", () => {
    const note = swapNote(macros({ kcal: 1800, proteinG: 45 }), macros({ kcal: 500, proteinG: 45 }));

    expect(note).toBe("Swapped. −1,300 kcal today.");
  });

  it("never apologises, reassures, or exclaims", () => {
    // § Content Guidelines "Don't": praise, commiserate, anthropomorphise, or
    // use an exclamation mark anywhere.
    const notes = [
      swapNote(macros({ proteinG: 45 }), macros({ proteinG: 24 })),
      swapNote(macros(), macros()),
      swapNote(null, macros()),
    ];

    for (const note of notes) {
      expect(note).not.toMatch(/!|sorry|no problem|don't worry|we|you|great|nice/i);
    }
  });
});
