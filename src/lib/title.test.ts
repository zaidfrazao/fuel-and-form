import { describe, expect, it } from "vitest";

import { seedMeals } from "./seed/meals";
import { seedWorkouts } from "./seed/workouts";
import { titleText } from "./title";

/**
 * A name as a Title sets it — FUEL-117.
 *
 * jsdom has no stylesheet and does no line breaking, so nothing here can show
 * where a Title breaks; the visual suite and the measurement in `globals.css`
 * do that. What this can hold is the text the browser is given to break, which
 * is the half that decides whether a dash is allowed to open a line.
 */

const NBSP = "\u00A0";

describe("titleText", () => {
  it("binds a spaced em dash to the words in front of it", () => {
    expect(titleText("Overnight Oats — PB Cocoa")).toBe(`Overnight Oats${NBSP}— PB Cocoa`);
  });

  it("leaves the break after the dash, which is the one the Title wants", () => {
    // "Overnight Oats — / PB Cocoa" is the break the ticket reported as good.
    // Binding both sides would leave balancing no break there at all.
    expect(titleText("Overnight Oats — PB Cocoa")).toContain("— PB");
  });

  it("binds a spaced en dash the same way", () => {
    expect(titleText("Chicken – Rice")).toBe(`Chicken${NBSP}– Rice`);
  });

  it("binds every spaced dash in a name, not only the first", () => {
    expect(titleText("A — B — C")).toBe(`A${NBSP}— B${NBSP}— C`);
  });

  it.each([
    ["an unspaced dash, which offers no break in front", "Overnight Oats—PB Cocoa"],
    ["a hyphen, which is a different character", "Lemon-Garlic Herb Baked Fish"],
    ["a plus, which reads as an addition at the start of a line", "Greek Yogurt + Berries"],
    ["an ampersand", "Smoky Paprika Chicken & Rice"],
  ])("leaves %s alone", (_, name) => {
    expect(titleText(name)).toBe(name);
  });

  it("changes exactly the library's three variant names, and nothing else about them", () => {
    // Pinned against the seed rather than a hand-copied list, so a fourth
    // dashed name arriving in the library shows up here as a changed count
    // rather than as a Title nobody looked at.
    const names = [...seedMeals, ...seedWorkouts].map((item) => item.name);
    const changed = names.filter((name) => titleText(name) !== name);

    expect(changed).toEqual([
      "Overnight Oats — Cinnamon Apple",
      "Overnight Oats — PB Cocoa",
      "Overnight Oats — Vanilla Berry",
    ]);
    for (const name of changed) {
      expect(titleText(name).replaceAll(NBSP, " ")).toBe(name);
    }
  });
});
