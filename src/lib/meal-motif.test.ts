import { describe, expect, test } from "vitest";

import { MOTIF_NAMES } from "@/components/motifs";
import { motifFor, type MotifBearing } from "@/lib/meal-motif";
import { seedMeals } from "@/lib/seed/meals";

/**
 * The derivation, checked against the library it was written for.
 *
 * `lib/seed/meals.ts` is the real committed recipe set, so it is the honest
 * fixture here: if a rule stops matching one of the seventeen, the tile for that
 * meal silently falls back to its slot's mark and nothing else would notice.
 */

const bearing = (name: string, slotType: MotifBearing["slotType"]): MotifBearing => ({
  name,
  slotType,
});

describe("motifFor", () => {
  test("gives every seeded meal one of the eight marks", () => {
    for (const meal of seedMeals) {
      expect(MOTIF_NAMES).toContain(motifFor(meal));
    }
  });

  test("never returns the walk mark, which is training's", () => {
    for (const meal of seedMeals) {
      expect(motifFor(meal)).not.toBe("walk");
    }
  });

  test.each([
    // The ordering cases. Each of these names two or three rules and only one
    // of them is right, so a reordered RULES array fails here rather than
    // showing the wrong mark on a tile nobody is looking closely at.
    ["Butter Chicken with Garlic Naan", "pot"],
    ["Lean Beef Mince Chilli", "bowl"],
    ["Smoky Paprika Chicken & Rice", "plate"],
    ["Loaded Nachos", "bowl"],
    ["French Toast + Bacon", "roll"],
    ["Whey Shake + Banana", "cup"],
    ["Fried Eggs + Lamb Bangers", "egg"],
  ])("%s is a %s", (name, motif) => {
    expect(motifFor(bearing(name, "dinner"))).toBe(motif);
  });

  test("matches whole words, so `egg` is not found inside `veggie`", () => {
    // The substring trap, and the reason every pattern is anchored. Without the
    // boundaries this would be `egg`, which is a mark for a dish with no egg in
    // it — a failure that looks exactly like a working function.
    expect(motifFor(bearing("Veggie Traybake", "dinner"))).toBe("plate");
    expect(motifFor(bearing("Barbecue Pulled Jackfruit", "lunch"))).toBe("roll");
  });

  test("falls back to the slot's mark when nothing in the name is recognised", () => {
    expect(motifFor(bearing("Flexible dinner", "extra"))).toBe("egg");
    expect(motifFor(bearing("Something Else Entirely", "breakfast"))).toBe("bowl");
    expect(motifFor(bearing("Something Else Entirely", "snack"))).toBe("bar");
    expect(motifFor(bearing("Something Else Entirely", "lunch"))).toBe("roll");
    expect(motifFor(bearing("Something Else Entirely", "dinner"))).toBe("plate");
  });

  test("is case-insensitive and stable across calls", () => {
    const shouted = motifFor(bearing("SMOKED PAPRIKA CHILLI", "dinner"));

    expect(shouted).toBe("bowl");
    expect(motifFor(bearing("smoked paprika chilli", "dinner"))).toBe(shouted);
  });
});
