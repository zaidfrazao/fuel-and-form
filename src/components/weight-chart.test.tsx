import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { WeightChart } from "@/components/weight-chart";
import type { Reading } from "@/lib/weight-chart";

/**
 * The weight chart's markup — FUEL-35, PRD § P5.
 *
 * Where the geometry lives in `lib/weight-chart.ts` and is tested as
 * arithmetic, five of this task's acceptance criteria are claims about the DOM
 * and are tested here: the accessible summary and its data table, the single
 * umber mark, the absence of any fill or gradient, gridlines that are
 * horizontal only, and the draw-in's suppression under reduced motion.
 *
 * dot-grid.test.tsx's discipline is kept — **no assertion re-states a Tailwind
 * class**. What is asserted is structure and the design tokens the criteria
 * name by name (`ink` for the trend, `accent` for the latest reading), because
 * those two ARE the criteria rather than a styling choice made near them.
 *
 * The pixel claims — legibility at 375px, and that the chart survives greyscale
 * — are not testable in jsdom and belong to `/dev/weight-chart` and the
 * Testing Strategy § 2.2 manual checklist.
 *
 * Invented figures throughout, per Testing Strategy § 1.5.
 */

const TODAY = "2026-08-20";
const START_KG = 84.2;
const TARGET_KG = 76;

const HISTORY: Reading[] = [
  { date: "2026-07-27", weightKg: 82.4 },
  { date: "2026-08-03", weightKg: 81.6 },
  { date: "2026-08-10", weightKg: 80.9 },
  { date: "2026-08-17", weightKg: 80.1 },
];

function draw(entries: readonly Reading[] = HISTORY) {
  return render(
    <WeightChart
      entries={entries}
      today={TODAY}
      startWeightKg={START_KG}
      targetWeightKg={TARGET_KG}
    />,
  );
}

describe("the accessible summary", () => {
  /**
   * Brand Guide § Accessibility: a graphic carries "an accessible summary plus
   * an adjacent data table", because "a mark on a screen is not the data".
   */
  test("the chart is one image with one sentence, not a pile of unnamed shapes", () => {
    draw();

    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /Weight trend, 4 weigh-ins/,
    );
  });

  test("the summary names the latest reading, the start and the target", () => {
    draw();

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    expect(summary).toContain("Latest 80.1 kg");
    expect(summary).toContain("Started at 84.2 kg");
    expect(summary).toContain("target 76 kg");
  });

  /**
   * The direction is the thing the line depicts. A summary that declined to say
   * which way it went would be describing an ornament — and P5's other progress
   * figures, kg remaining and the percentage of the way to target, are FUEL-36's
   * and belong beside the chart rather than inside its description.
   */
  test("the summary says which way the trend went", () => {
    draw();

    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Down 4.1 kg from the starting weight",
    );
  });

  test("a reading above the starting weight is described as up, not as a negative loss", () => {
    draw([{ date: "2026-08-17", weightKg: 86.5 }]);

    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Up 2.3 kg from the starting weight",
    );
  });

  /**
   * A true zero is a real outcome — a reading back at the starting weight — and
   * "Up 0 kg" would be a sentence about a direction that did not happen.
   * `format.ts` makes the same argument about `signed`.
   */
  test("a reading level with the starting weight is given no direction at all", () => {
    draw([{ date: "2026-08-17", weightKg: START_KG }]);

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    expect(summary).toContain("Level with the starting weight");
    expect(summary).not.toMatch(/Up 0|Down 0/);
  });

  /** "1 weigh-ins" reads as a bug in a sentence that is going to be read aloud. */
  test("a single reading is described in the singular", () => {
    draw([{ date: "2026-08-17", weightKg: 80.1 }]);

    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Weight trend, 1 weigh-in.",
    );
  });
});

describe("the adjacent data table", () => {
  test("every plotted reading has a row, oldest first", () => {
    draw();

    const table = within(screen.getByRole("table"));

    // One header row, then the readings.
    expect(table.getAllByRole("row")).toHaveLength(HISTORY.length + 1);
    expect(table.getAllByRole("rowheader")[0]?.textContent).toBe("Mon 27 Jul");
  });

  /**
   * The third column is what the graphic encodes that a date and a weight do
   * not: which point the umber dot is on. A table that omitted it would describe
   * the data but not the picture.
   */
  test("the table says which reading carries the mark", () => {
    draw();

    const marked = within(screen.getByRole("table"))
      .getAllByRole("row")
      .filter((row) => within(row).queryByText("Latest reading") !== null);

    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain("Mon 17 Aug");
  });

  /**
   * The history has no window — `lib/weigh-in.ts` sets no lower bound on a
   * weigh-in's date on purpose, so the first reading may predate the program by
   * years and two rows could otherwise both read "Mon 17 Aug".
   */
  test("a reading from another year carries its year", () => {
    draw([
      { date: "2025-08-18", weightKg: 88 },
      { date: "2026-08-17", weightKg: 80.1 },
    ]);

    expect(
      within(screen.getByRole("table")).getAllByRole("rowheader")[0]?.textContent,
    ).toBe("Mon 18 Aug 2025");
  });
});

describe("the ink the criteria name", () => {
  /** § Color Palette gives `ink` to "the trend line", by name. */
  test("the trend line is ink", () => {
    const { container } = draw();

    expect(container.querySelector("polyline")?.getAttribute("stroke")).toBe(
      "var(--ink)",
    );
  });

  /**
   * § Rule 2: "One umber element per screen", and on this chart it is the latest
   * reading. Counted across the whole graphic rather than checked on one
   * element, because the criterion is about how MANY there are.
   */
  test("exactly one mark is umber, and it is the latest reading", () => {
    const { container } = draw();

    const accented = [...container.querySelectorAll("*")].filter((node) =>
      ["fill", "stroke"].some((attribute) =>
        node.getAttribute(attribute)?.includes("--accent"),
      ),
    );

    expect(accented).toHaveLength(1);
    expect(accented[0]?.tagName.toLowerCase()).toBe("circle");
  });

  /** No markers except the latest point — so one circle on the whole chart. */
  test("no other reading carries a marker", () => {
    const { container } = draw();

    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });
});

describe("what the chart refuses to draw", () => {
  /**
   * § Deliberately Absent: "area fills and gradients under charts". Asserted as
   * an absence across the whole graphic rather than as a prop on one element,
   * because the criterion is that there is no such thing anywhere.
   */
  test("nothing under the trend is filled", () => {
    const { container } = draw();

    for (const shape of container.querySelectorAll("polyline, path, polygon")) {
      expect(shape.getAttribute("fill")).toBe("none");
    }
  });

  test("there is no gradient anywhere to fill it with", () => {
    const { container } = draw();

    expect(
      container.querySelectorAll("linearGradient, radialGradient, defs"),
    ).toHaveLength(0);
  });

  /**
   * "Horizontal gridlines only" — every rule on the chart has one y. There is no
   * vertical rule at all: time is continuous and a weigh-in is a moment in it,
   * so a vertical gridline would be an edge the data does not have.
   */
  test("every rule is horizontal", () => {
    const { container } = draw();

    const lines = [...container.querySelectorAll("line")];

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line.getAttribute("y1")).toBe(line.getAttribute("y2"));
    }
  });
});

describe("the reference lines", () => {
  /**
   * FUEL-35's "target line and starting weight both visible". Both are labelled
   * in text, which is also § Accessibility's "never colour alone": the two rules
   * share a stroke and are told apart by their words rather than by a second
   * accent, which § Deliberately Absent forbids.
   */
  test("the target and the start are both drawn and both labelled", () => {
    draw();

    // `getByText` throws when absent, so reaching the assertion is the claim;
    // the tag name is what says it was drawn as a label on the graphic.
    expect(screen.getByText("Target 76").tagName.toLowerCase()).toBe("text");
    expect(screen.getByText("Start 84.2").tagName.toLowerCase()).toBe("text");
  });

  /**
   * The maintenance case, and a real defect until FUEL-35 was looked at in a
   * browser: start and target are the same number from the day the goal is met
   * onwards, so the two labels sat on one baseline and overprinted into an
   * unreadable smear. The rules still both draw — coincident hairlines are the
   * same pixels as one — and it is only the words that merge.
   */
  test("references on the same weight are labelled once, not twice over", () => {
    render(
      <WeightChart
        entries={[
          { date: "2026-08-10", weightKg: 76 },
          { date: "2026-08-17", weightKg: 76 },
        ]}
        today={TODAY}
        startWeightKg={76}
        targetWeightKg={76}
      />,
    );

    expect(screen.getByText("Start · Target 76").tagName.toLowerCase()).toBe("text");
    expect(screen.queryByText("Target 76")).toBeNull();
    expect(screen.queryByText("Start 76")).toBeNull();
  });

  /**
   * Close but not equal. Closeness here is a distance in PIXELS rather than in
   * kilograms — two figures a fifth of a kilogram apart are far apart on a
   * fortnight's chart and touching on a decade's, because the domain is what
   * decides the scale. Hence the wide fixture: it is the only way the two
   * labels collide while naming different numbers.
   *
   * Both figures have to survive the merge. Collapsing them to one number the
   * way the equal case does would state something false.
   */
  test("references too close to label separately keep both figures", () => {
    render(
      <WeightChart
        entries={[
          { date: "2016-08-17", weightKg: 120 },
          { date: "2026-08-17", weightKg: 70 },
        ]}
        today={TODAY}
        startWeightKg={84.2}
        targetWeightKg={84}
      />,
    );

    expect(screen.getByText("Start 84.2 · Target 84").tagName.toLowerCase()).toBe(
      "text",
    );
  });

  /**
   * Both rules are drawn whether or not their labels merged. The line is the
   * data; the label is only how it is named.
   */
  test("both rules are drawn even when one label names them", () => {
    const { container } = render(
      <WeightChart
        entries={[{ date: "2026-08-17", weightKg: 76 }]}
        today={TODAY}
        startWeightKg={76}
        targetWeightKg={76}
      />,
    );

    const dashed = [...container.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke-dasharray") !== null,
    );

    expect(dashed).toHaveLength(2);
  });

  /**
   * A reference sitting on the top of the domain is at the plate's own ceiling,
   * and a label lifted above it is clipped by the viewBox — the `<svg>` clips at
   * its bounds, so half a word vanishes with nothing to say it did. The label
   * flips below the rule instead.
   *
   * The fixture is ordinary rather than contrived: the starting weight is the
   * heaviest figure on the chart and already a multiple of the gridline step,
   * which is most of the first fortnight of a program.
   */
  test("a label with no room above its rule is drawn below it", () => {
    const { container } = render(
      <WeightChart
        entries={[
          { date: "2026-08-10", weightKg: 79 },
          { date: "2026-08-17", weightKg: 78 },
        ]}
        today={TODAY}
        startWeightKg={80}
        targetWeightKg={76}
      />,
    );

    const start = [...container.querySelectorAll("text")].find((node) =>
      node.textContent?.startsWith("Start"),
    );

    // Below its own rule, and inside the box either way — which is the claim
    // that actually matters, since a negative baseline is the clipped case.
    expect(Number(start?.getAttribute("y"))).toBeGreaterThan(0);
  });

  /**
   * Never a literal 64. P5 recalibrates the target every 5kg, and P7 gives the
   * demo persona different body metrics — a figure written into the component
   * would draw the owner's goal across a visitor's chart.
   */
  test("the labels follow the profile's own figures", () => {
    render(
      <WeightChart
        entries={HISTORY}
        today={TODAY}
        startWeightKg={91}
        targetWeightKg={64}
      />,
    );

    expect(screen.getByText("Target 64").tagName.toLowerCase()).toBe("text");
    expect(screen.getByText("Start 91").tagName.toLowerCase()).toBe("text");
  });
});

describe("the edge states", () => {
  /**
   * P5's first. § UI Copy Examples writes the empty state as "No weigh-ins yet.
   * Your first entry starts the chart" — the guide's own sentence says there is
   * no chart yet, and `/weight` renders that sentence above where this would be.
   * Drawing an empty ruled plate here would contradict it and repeat it.
   */
  test("an empty history draws nothing at all", () => {
    const { container } = draw([]);

    expect(container.innerHTML).toBe("");
  });

  /**
   * P5's second, and the one that breaks charting libraries. The chart still
   * renders: a mark, both references, and the summary and table that describe
   * them.
   */
  test("a single reading still draws a chart", () => {
    const { container } = draw([{ date: "2026-08-17", weightKg: 80.1 }]);

    expect(screen.getByRole("img").tagName.toLowerCase()).toBe("svg");
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  /**
   * A polyline of one point has no segment. The element is omitted rather than
   * emitted empty, so the draw-in has nothing invisible to spend 400ms
   * revealing.
   */
  test("a single reading draws no trend line", () => {
    const { container } = draw([{ date: "2026-08-17", weightKg: 80.1 }]);

    expect(container.querySelector("polyline")).toBeNull();
  });

  /**
   * Two identical date labels at opposite ends of a chart with one point in the
   * middle would say the history spans from a date to itself.
   */
  test("a single reading carries no date axis", () => {
    const { container } = draw([{ date: "2026-08-17", weightKg: 80.1 }]);

    expect(container.querySelectorAll("text")).toHaveLength(2); // Start and Target
  });

  test("a full history labels both ends of the date axis", () => {
    const { container } = draw();
    const labels = [...container.querySelectorAll("text")].map(
      (node) => node.textContent,
    );

    expect(labels).toContain("Mon 27 Jul");
    expect(labels).toContain("Mon 17 Aug");
  });
});

/**
 * § Animation & Motion and § Accessibility: the chart draws in over 400ms, and
 * `prefers-reduced-motion: reduce` "drops the chart and ruler draw-in".
 *
 * jsdom evaluates no media queries, so the rule is asserted where it is written
 * — as text in globals.css. `globals.tokens.test.ts` established the technique
 * for the token layer; this is the same trade, and it is a better one than the
 * alternative: reading the signal with `matchMedia` would make the chart a
 * client component that renders differently before and after hydration, which
 * for an animation means it plays once regardless on the way past.
 */
describe("the draw-in", () => {
  const CSS = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"),
    "utf8",
  );

  const REDUCED = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));

  test("the trend and the mark are the elements that animate", () => {
    const { container } = draw();

    expect(container.querySelector(".weight-chart-trend")?.tagName.toLowerCase()).toBe(
      "polyline",
    );
    expect(container.querySelector(".weight-chart-latest")?.tagName.toLowerCase()).toBe(
      "circle",
    );
  });

  /**
   * `pathLength="1"` is what makes the draw-in pure CSS: it normalises the
   * line's length, so a dash of 1 covers it exactly and nothing has to measure
   * the path in a browser. Without it the animation runs against the line's real
   * length in user units and reveals a fraction of a percent of it.
   */
  test("the trend line's length is normalised so the dash can cover it", () => {
    const { container } = draw();

    expect(container.querySelector("polyline")?.getAttribute("pathLength")).toBe("1");
  });

  test("globals.css declares the draw-in at the guide's 400ms and easing", () => {
    expect(CSS).toMatch(
      /\.weight-chart-trend\s*\{[^}]*animation:[^;]*400ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/,
    );
  });

  test("reduced motion drops both animations", () => {
    expect(REDUCED).toMatch(/\.weight-chart-trend\s*\{[^}]*animation:\s*none/);
    expect(REDUCED).toMatch(/\.weight-chart-latest\s*\{[^}]*animation:\s*none/);
  });

  /**
   * The specific way suppressing this animation could go wrong, and the reason
   * the reduced-motion block is more than two `animation: none` lines.
   *
   * The trend carries `stroke-dasharray: 1` so the dash has something to cover;
   * left in place with the animation gone, the line stays permanently
   * half-drawn. The mark's animation carries `both`, which without an override
   * holds it at its `from` opacity of nought — hiding the one mark the chart
   * has. Suppressing an animation must not remove the thing it was animating.
   */
  test("reduced motion leaves the trend whole and the mark visible", () => {
    expect(REDUCED).toMatch(/\.weight-chart-trend\s*\{[^}]*stroke-dasharray:\s*none/);
    expect(REDUCED).toMatch(/\.weight-chart-latest\s*\{[^}]*opacity:\s*1/);
  });
});
