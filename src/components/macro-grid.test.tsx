import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  isMaterialOverage,
  MacroGrid,
  MealDayGrid,
  OVERAGE_TOLERANCE,
} from "@/components/macro-grid";
import type { MacroTarget, MacroTotals } from "@/lib/macros";

/**
 * FUEL-31's presentation criteria, as assertions about what reaches the screen.
 *
 * The arithmetic underneath is `lib/macros.ts`, covered at 100% by FUEL-10, and
 * nothing here re-checks a sum. What is checkable here is what the component
 * does with four numbers it is handed: which of them is bold, which of them is
 * red, what sign is in front of them, and which glyph that sign is.
 *
 * Round targets so a delta in an assertion is obviously the subtraction under
 * test rather than a coincidence — Testing Strategy § 1.5, and the same choice
 * `right-now.test.tsx` makes.
 */
const TARGET: MacroTarget = {
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbG: 200,
};

/** A day that hits every target exactly, before a case moves one of them. */
const ON_TARGET: MacroTotals = {
  kcal: 2000,
  proteinG: 150,
  fatG: 60,
  carbG: 200,
};

const totals = (fields: Partial<MacroTotals> = {}): MacroTotals => ({
  ...ON_TARGET,
  ...fields,
});

const grid = (fields: Partial<MacroTotals> = {}) =>
  render(<MacroGrid totals={totals(fields)} target={TARGET} />);

/** The calories delta, which is the only figure that can take a colour. */
const caloriesDelta = (text: string) => screen.getByText(text);

describe("the four figures", () => {
  test("shows each value against its target with a signed delta", () => {
    const { container } = grid({ kcal: 1800, proteinG: 128, fatG: 66, carbG: 200 });

    const dl = container.querySelector("dl");

    expect(within(dl!).getByText("1,800")).toBeDefined();
    // The calories delta is its own element, because it is the one figure that
    // can take a colour — so the line it sits on is asserted either side of it.
    expect(within(dl!).getByText(/of 2,000 ·/)).toBeDefined();
    expect(within(dl!).getByText("−200")).toBeDefined();

    expect(within(dl!).getByText("128 g")).toBeDefined();
    expect(within(dl!).getByText(/of 150 · −22/)).toBeDefined();

    expect(within(dl!).getByText("66 g")).toBeDefined();
    expect(within(dl!).getByText(/of 60 · \+6/)).toBeDefined();

    expect(within(dl!).getByText("200 g")).toBeDefined();
    // A figure that landed exactly on target carries no sign at all: `+0` and
    // `−0` both read as a near miss on a day that did not miss.
    expect(within(dl!).getByText(/of 200 · 0/)).toBeDefined();
  });

  test("names all four, so a column can be read without a heading above it", () => {
    grid();

    for (const label of ["Calories", "Protein", "Fat", "Carbs"]) {
      expect(screen.getByText(label).tagName).toBe("DT");
    }
  });

  test("writes the delta with the brand's minus sign, not a hyphen", () => {
    // § Voice writes the convention as `−21`, never "21 under", and the glyph is
    // U+2212 — the one that lines up under tabular figures.
    grid({ kcal: 1800 });

    expect(caloriesDelta("−200").textContent).toBe("−200");
  });
});

describe("emphasis", () => {
  test("sets protein in 700 and its neighbours in 600", () => {
    // § Typography: "protein stays emphasised by weight, not colour", because
    // colour is spoken for.
    grid({ proteinG: 128, fatG: 66 });

    expect(screen.getByText("128 g").className).toContain("font-bold");
    expect(screen.getByText("66 g").className).not.toContain("font-bold");
  });

  test("gives protein no colour, however far over target it is", () => {
    // Over target on protein is the day going well. A rule that painted every
    // positive delta red would report a good day as a fault.
    const { container } = grid({ proteinG: 300 });

    const protein = within(container.querySelector("dl")!).getByText(/of 150 · \+150/);

    expect(protein.className).not.toContain("text-error");
  });
});

describe("the overage rule", () => {
  test("leaves an under-target day grey, however far under", () => {
    // § Semantic Colors: the semantic tokens are "never for an under-target
    // figure". § Voice puts `−8g protein` in text-secondary and `You missed your
    // protein goal` in red under Avoid.
    grid({ kcal: 500 });

    expect(caloriesDelta("−1,500").className).not.toContain("text-error");
  });

  test("leaves an overage inside the tolerance alone", () => {
    // 2,000 × 5% = 100, so +99 is a day that went slightly over rather than a
    // day that went over.
    grid({ kcal: 2099 });

    expect(caloriesDelta("+99").className).not.toContain("text-error");
  });

  test("colours an overage past the tolerance", () => {
    // § Voice: `+220 kcal` in `error` — the guide's own worked example, which is
    // 12% of the day it is written against.
    grid({ kcal: 2220 });

    expect(caloriesDelta("+220").className).toContain("text-error");
  });

  test("colours nothing on a day that landed exactly on target", () => {
    grid();

    expect(caloriesDelta("0").className).not.toContain("text-error");
  });

  test("scales the threshold with the target rather than fixing it", () => {
    // The reason it is a proportion: PRD § P5 recalibrates the target every 5kg,
    // and the same overage should not change colour because of a constant
    // chosen against a target that has since moved.
    expect(isMaterialOverage(80, 1400)).toBe(true);
    expect(isMaterialOverage(80, 2400)).toBe(false);

    // The boundary itself is inside the tolerance — the rule is "past", not "at".
    expect(isMaterialOverage(2000 * OVERAGE_TOLERANCE, 2000)).toBe(false);
  });

  test("never colours a negative delta, whatever the target", () => {
    expect(isMaterialOverage(-500, 2000)).toBe(false);
    expect(isMaterialOverage(0, 2000)).toBe(false);
  });

  test("colours nothing when there is no target to be over", () => {
    // Overage is a claim about a target. With none set, the multiplication
    // alone would answer `delta > 0` and paint every figure red on precisely
    // the profile that has not said what it is aiming at — so the case is
    // decided here rather than inherited from the arithmetic.
    expect(isMaterialOverage(500, 0)).toBe(false);
    expect(isMaterialOverage(500, -100)).toBe(false);
  });

  test("reports a day against a zero target without colouring it", () => {
    // The whole grid, not just the helper: the figures are still shown and
    // still carry their signs — it is only the colour that is withheld.
    const { container } = render(
      <MacroGrid
        totals={totals({ kcal: 900 })}
        target={{ targetKcal: 0, targetProteinG: 0, targetFatG: 0, targetCarbG: 0 }}
      />,
    );

    expect(caloriesDelta("+900").className).not.toContain("text-error");
    expect(within(container.querySelector("dl")!).getByText("900")).toBeDefined();
  });
});

describe("the day-complete arrangement", () => {
  test("shows the target in the calories cell when the actual is printed above", () => {
    const { container } = render(
      <MacroGrid totals={totals({ kcal: 1510 })} target={TARGET} calories="target" />,
    );

    const dl = container.querySelector("dl");

    // The value is the target and the delta stands alone: the summary prints
    // 1,510 at 76px Display immediately above this grid, so a cell repeating it
    // would spend a column restating the largest thing on the screen.
    expect(within(dl!).getByText("Target").tagName).toBe("DT");
    expect(within(dl!).getByText("2,000")).toBeDefined();
    expect(within(dl!).getByText("−490")).toBeDefined();
    expect(within(dl!).queryByText("1,510")).toBeNull();
  });

  test("applies the same overage rule in either arrangement", () => {
    render(<MacroGrid totals={totals({ kcal: 2220 })} target={TARGET} calories="target" />);

    expect(caloriesDelta("+220").className).toContain("text-error");
  });
});

describe("stability", () => {
  test("sets tabular figures on the grid itself, not by inheritance", () => {
    // The criterion is that the grid does not reflow as digits change. `body`
    // already carries `font-variant-numeric: tabular-nums`, but a grid relying
    // on that would pass or fail on an edit to globals.css mentioning none of
    // this.
    const { container } = grid();

    expect(container.querySelector("dl")!.className).toContain("tabular-nums");
  });

  test("holds its column tracks whatever lands in them", () => {
    // `grid-cols-2` is `repeat(2, minmax(0, 1fr))`: the tracks are a proportion
    // of the row, so a four-digit kcal replacing a three-digit one cannot widen
    // its column and push the page sideways.
    const { container } = grid();

    expect(container.querySelector("dl")!.className).toContain("grid-cols-2");
  });
});

/* -------------------------------------------------------------------------- */
/* The merged grid — FUEL-82                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The phone's shape: the meal's four macros, each with the day's running total
 * on its slash line.
 *
 * These are the criteria that made the merge permissible rather than merely
 * shorter. PRD § P4 asks for "all four values shown against target with a
 * signed delta", and `MacroGrid` is the only place that criterion is met on a
 * phone — `week-totals.tsx` carries kcal and protein alone. So a merged shape
 * that dropped fat or carbs, or dropped a target, or dropped a delta, would
 * satisfy § P4 on no phone screen in the app. Each of those is pinned below.
 */
const MEAL = { kcal: 455, proteinG: 34.5, fatG: 16.5, carbG: 42.5 };

const merged = (fields: Partial<MacroTotals> = {}) =>
  render(<MealDayGrid meal={MEAL} totals={totals(fields)} target={TARGET} />);

describe("the merged meal-and-day grid", () => {
  test("shows the MEAL in the value and the DAY on the slash line", () => {
    // Which way round is the whole design: the `<h1>` above names the meal, so
    // the value slot describes the thing that was named, and the day is the
    // secondary fact § Slash Metadata exists for.
    const { container } = merged({ kcal: 1655 });

    const calories = within(container.querySelector("dl")!.children[0] as HTMLElement);

    expect(calories.getByText("455")).toBeTruthy();
    expect(calories.getByText(/day 1,655 of 2,000/)).toBeTruthy();
  });

  test("keeps all four macros, each against target with a signed delta", () => {
    // PRD § P4, and the reason the mock's two-figure summary was not adopted.
    const { container } = merged({ kcal: 1800, proteinG: 128, fatG: 66, carbG: 200 });

    const lines = [...container.querySelectorAll("dl > div")].map((cell) =>
      cell.textContent?.replace(/\s+/g, " ").trim(),
    );

    expect(lines).toEqual([
      "Calories455/ day 1,800 of 2,000 · −200",
      "Protein34.5 g/ day 128 g of 150 · −22",
      "Fat16.5 g/ day 66 g of 60 · +6",
      // A day that landed exactly on target reads `0`, not `+0` — `signed()`'s
      // convention, and the same one the two-grid shape prints.
      "Carbs42.5 g/ day 200 g of 200 · 0",
    ]);
  });

  test("emphasises the meal's protein by weight, like every other grid", () => {
    const { container } = merged();

    const values = [...container.querySelectorAll("dl > div")].map(
      (cell) => cell.querySelector("dd > span")!.className,
    );

    expect(values[1]).toContain("font-bold");
    expect(values[0]).not.toContain("font-bold");
    expect(values[2]).not.toContain("font-bold");
    expect(values[3]).not.toContain("font-bold");
  });

  test("colours a material calorie overage and nothing else", () => {
    // The same predicate `MacroGrid` uses — `isMaterialOverage` — reached from a
    // second callsite. The header on that function records what it cost when two
    // callers wrote the condition by hand and disagreed at 3 kcal over.
    const { container } = merged({ kcal: 2200, fatG: 90 });

    expect(screen.getByText("+200").className).toContain("text-error");
    expect(screen.getByText(/\+30/).className).not.toContain("text-error");

    expect(container.querySelectorAll(".text-error")).toHaveLength(1);
  });

  test("leaves an immaterial overage uncoloured", () => {
    // 5% of 2,000 is 100, so 2,050 is inside the tolerance and reported plainly.
    merged({ kcal: 2050 });

    expect(screen.getByText("+50").className).not.toContain("text-error");
  });

  test("sets tabular figures and a tighter row gap than the two-line grid", () => {
    // 14px rather than the grid's own 22: a merged cell is three lines, so the
    // rows read as blocks and 22 between them was tuned for the tighter pair.
    const { container } = merged();

    expect(container.querySelector("dl")!.className).toContain("tabular-nums");
    expect(container.querySelector("dl")!.className).toContain("gap-y-[14px]");
  });
});
