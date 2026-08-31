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

/**
 * Renders the chart, and leaves exactly one of its two drawings in the DOM.
 *
 * FUEL-78 gave `/weight`'s chart a second shape — the measure's 320×170 box
 * below 1272, the frame's 968×300 at it. Both are rendered, one hidden by
 * `xl:hidden` and the other by `hidden xl:block`, because the geometry depends
 * on the box's aspect and is computed on a server that cannot know the
 * viewport. In a browser exactly one is displayed, and `display: none` also
 * removes the other from the accessibility tree — so there is one `role="img"`
 * carrying one `aria-label` at every width.
 *
 * jsdom applies no stylesheet, so neither is hidden here and both are exposed:
 * `screen.getByRole("img")` finds two, and every `querySelectorAll` over the
 * container counts twice. That is an artefact of the environment rather than
 * anything the component does, so this helper removes the drawing the width
 * under test would have hidden, and every assertion below goes on meaning what
 * it says — about ONE chart, in the box its coordinates were written against.
 *
 * `drawBoth` is what the pair itself is tested with.
 */
function draw(entries: readonly Reading[] = HISTORY, references: References = {}) {
  const result = drawBoth(entries, references);

  result.container.querySelector('[data-chart-shape="frame"]')?.remove();

  return result;
}

/** The profile's two figures, where a test needs them to be something else. */
type References = { startWeightKg?: number; targetWeightKg?: number };

/** Both drawings, as the component renders them. */
function drawBoth(entries: readonly Reading[] = HISTORY, references: References = {}) {
  return render(
    <WeightChart
      entries={entries}
      today={TODAY}
      startWeightKg={references.startWeightKg ?? START_KG}
      targetWeightKg={references.targetWeightKg ?? TARGET_KG}
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

  /**
   * The same rounding trap as the merged reference label, on the sentence that
   * is read aloud. A reading 40 grams from the starting weight is a non-zero
   * change that formats as "0", so testing the raw float would produce "Down
   * 0 kg from the starting weight" — the exact wording the branch exists to
   * prevent.
   */
  test("a change too small to display is described as level, not as zero", () => {
    draw([{ date: "2026-08-17", weightKg: START_KG - 0.04 }]);

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    expect(summary).toContain("Level with the starting weight");
    expect(summary).not.toMatch(/Down 0|Up 0/);
  });

  /** "1 weigh-ins" reads as a bug in a sentence that is going to be read aloud. */
  test("a single reading is described in the singular", () => {
    draw([{ date: "2026-08-17", weightKg: 80.1 }]);

    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Weight trend, 1 weigh-in.",
    );
  });

  /**
   * Every word drawn inside the graphic is hidden from the accessibility tree.
   * `role="img"` is supposed to prune its descendants, but dot-grid.tsx records
   * that Chrome lists them anyway and day-ruler.tsx hit the same thing with its
   * scale — so without this a screen reader reads "Start 84.2", "Target 76" and
   * both dates a second time, after a summary that has already said all four.
   */
  test("no word drawn inside the graphic is read a second time", () => {
    const { container } = draw();

    const exposed = [...container.querySelectorAll("text")].filter(
      (node) => !node.closest("[aria-hidden]"),
    );

    expect(exposed).toHaveLength(0);
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
    draw([
              { date: "2026-08-10", weightKg: 76 },
              { date: "2026-08-17", weightKg: 76 },
            ], {
      startWeightKg: 76,
      targetWeightKg: 76,
    });

    expect(screen.getByText("Start · Target 76").tagName.toLowerCase()).toBe("text");
    expect(screen.queryByText("Target 76")).toBeNull();
    expect(screen.queryByText("Start 76")).toBeNull();
  });

  /**
   * The column stores two decimals and `figure` prints one, so 76.04 and 76.01
   * are different numbers that both display as "76". Comparing the raw floats
   * would spell both out and render "Start 76 · Target 76" — a whole line spent
   * printing one figure twice in order to say the two are different.
   */
  test("references that merely display the same are labelled once", () => {
    draw([{ date: "2026-08-17", weightKg: 76 }], {
      startWeightKg: 76.04,
      targetWeightKg: 76.01,
    });

    expect(screen.getByText("Start · Target 76").tagName.toLowerCase()).toBe("text");
    expect(screen.queryByText("Start 76 · Target 76")).toBeNull();
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
    draw([
              { date: "2016-08-17", weightKg: 120 },
              { date: "2026-08-17", weightKg: 70 },
            ], {
      startWeightKg: 84.2,
      targetWeightKg: 84,
    });

    expect(screen.getByText("Start 84.2 · Target 84").tagName.toLowerCase()).toBe(
      "text",
    );
  });

  /**
   * Both rules are drawn whether or not their labels merged. The line is the
   * data; the label is only how it is named.
   */
  test("both rules are drawn even when one label names them", () => {
    const { container } = draw([{ date: "2026-08-17", weightKg: 76 }], {
      startWeightKg: 76,
      targetWeightKg: 76,
    });

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
    const { container } = draw([
              { date: "2026-08-10", weightKg: 79 },
              { date: "2026-08-17", weightKg: 78 },
            ], {
      startWeightKg: 80,
      targetWeightKg: 76,
    });

    const start = [...container.querySelectorAll("text")].find((node) =>
      node.textContent?.startsWith("Start"),
    );

    // The rule's own height, as a percentage of the box, and then a positive
    // offset from it: a `dy` below the baseline is the flip, and a negative one
    // would be the lift that gets clipped. Since FUEL-76 the two are in separate
    // attributes because they are in separate units — see `labelOffset`.
    expect(start?.getAttribute("y")).toMatch(/^\d+(\.\d+)?%$/);
    expect(Number(start?.getAttribute("dy"))).toBeGreaterThan(0);
  });

  /**
   * Never a literal 64. P5 recalibrates the target every 5kg, and P7 gives the
   * demo persona different body metrics — a figure written into the component
   * would draw the owner's goal across a visitor's chart.
   */
  test("the labels follow the profile's own figures", () => {
    draw(HISTORY, {
      startWeightKg: 91,
      targetWeightKg: 64,
    });

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
 * FUEL-76 — the type scale does not inflate with the column.
 *
 * The chart's viewBox scales with its container, and everything drawn inside it
 * used to scale too: on a 584px column the factor is 1.825, so the 10.5px Micro
 * labels painted at 19.2px — larger than Body, on a screen whose § Typography
 * opens with "the ratio is the rule". The fix is structural rather than a set of
 * numbers, so it is tested structurally: the words and the mark are drawn in a
 * layer that has no viewBox to scale them, and they are positioned in
 * percentages so they still land on the geometry that does scale.
 *
 * The pixel claims themselves — 10.5px at 375, 1280 and 1920 — are measured in
 * `tests/visual/chart-scale.spec.ts`, because jsdom applies no CSS and lays
 * nothing out. What is asserted here is the structure those measurements depend
 * on, which is the part a later edit could quietly undo.
 */
describe("the two layers", () => {
  /** Every word on the chart, wherever it is drawn. */
  function words(container: HTMLElement) {
    return [...container.querySelectorAll("text")];
  }

  test("the words and the mark are drawn in a layer with nothing to scale them", () => {
    const { container } = draw();

    const unscaled = [...words(container), container.querySelector("circle")].map(
      (node) => node?.closest("svg"),
    );

    expect(unscaled.length).toBeGreaterThan(1);
    for (const layer of unscaled) {
      // No viewBox is the whole claim: the layer's user units are CSS pixels, so
      // a 10.5px label is 10.5px and a 4px disc is 4px however wide the column
      // gets. The geometry's layer has one, which is what lets it scale.
      expect(layer?.getAttribute("viewBox")).toBeNull();
    }
  });

  /**
   * The layer itself carries the `aria-hidden`, and that is the claim rather
   * than each word carrying one.
   *
   * "No word is read twice" is asserted above by looking for an `aria-hidden`
   * ancestor on every `<text>`, which a future edit could satisfy by wrapping
   * the words in an aria-hidden group while leaving the layer around them
   * exposed — and then anything ADDED to the layer would be read. The layer is
   * the boundary, so the layer is what is pinned.
   */
  test("the unscaled layer is hidden whole, not word by word", () => {
    const { container } = draw();
    const layer = container.querySelector("circle")?.closest("svg");

    expect(layer?.getAttribute("viewBox")).toBeNull();
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    // And it is not the layer carrying the summary — that one stays the image.
    expect(layer?.getAttribute("role")).toBeNull();
  });

  test("the geometry is still drawn in a layer that does scale", () => {
    const { container } = draw();

    const geometry = container.querySelector("polyline")?.closest("svg");

    expect(geometry?.getAttribute("viewBox")).toBe("0 0 320 170");
    // The plate and every rule belong to it too — the shapes ARE the data, and
    // a chart that stopped filling its column would be a worse bug than the one
    // FUEL-76 fixed.
    expect(geometry?.querySelectorAll("line").length).toBeGreaterThan(0);
    expect(geometry?.querySelector("rect")).not.toBeNull();
  });

  /**
   * The unscaled layer would drift off the geometry if it were positioned in
   * anything but percentages — they are what makes the two agree at every width
   * without either of them being measured.
   */
  test("everything in the unscaled layer is positioned as a percentage", () => {
    const { container } = draw();
    const layer = container.querySelector("circle")?.closest("svg");

    const placed = [...(layer?.querySelectorAll("text, circle") ?? [])];

    expect(placed).toHaveLength(5); // Two references, two dates, one mark.
    for (const node of placed) {
      for (const attribute of ["x", "y", "cx", "cy"]) {
        const value = node.getAttribute(attribute);
        if (value !== null) expect(value).toMatch(/%$/);
      }
    }
  });

  /**
   * § Data Display gives the mark "a 4px disc with a 2px ring", and those are
   * the numbers the overlay draws because they are pixels in it. In the scaled
   * layer the same two numbers painted at 7.3px and 3.65px on a 584px column.
   */
  test("the mark is the specified disc and ring", () => {
    const { container } = draw();
    const mark = container.querySelector("circle");

    expect(mark?.getAttribute("r")).toBe("4");
    expect(mark?.getAttribute("stroke-width")).toBe("2");
  });

  /**
   * § Materials' hairlines, held to their width at every column width. This was
   * already true before FUEL-76 and is pinned here because the ticket that fixed
   * the labels is also the one that would have removed it: a rule drawn at 1 unit
   * in a box scaled 1.825× is not a hairline, and `vector-effect` is the only
   * thing standing between the two.
   */
  test("every rule is a hairline that does not thicken with the column", () => {
    const { container } = draw();
    const rules = [...container.querySelectorAll("line")];

    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.getAttribute("stroke-width")).toBe("1");
      expect(rule.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });

  /** § Color Palette's trend line, at the width it is specified at. */
  test("the trend is drawn at two pixels", () => {
    const { container } = draw();

    expect(container.querySelector("polyline")?.getAttribute("stroke-width")).toBe("2");
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
   * The draw-in is a clip wipe, and the two halves of that are asserted
   * together because neither is safe without the other — FUEL-76.
   *
   * `vector-effect="non-scaling-stroke"` is what holds the trend to 2px at every
   * column width, and it is also what made a dash reveal impossible: under it a
   * browser normalises `pathLength="1"` against the path in user units and then
   * paints that as CSS pixels, which on a 584px column covered 55% of the line
   * and left the trend permanently half-drawn. So `pathLength` is gone, and its
   * return alongside the vector-effect would be the half-drawn line again.
   */
  test("the trend is wiped in rather than dashed in, because its stroke does not scale", () => {
    const { container } = draw();
    const trend = container.querySelector("polyline");

    expect(trend?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(trend?.getAttribute("pathLength")).toBeNull();
    expect(CSS).toMatch(
      /@keyframes weight-chart-draw\s*\{[^@]*clip-path:\s*inset\(0 100% 0 0\)/,
    );
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
   * The trend is revealed by a `clip-path` that starts fully closed; left in
   * place with the animation gone, the line stays permanently part-drawn. The
   * mark's animation carries `both`, which without an override holds it at its
   * `from` opacity of nought — hiding the one mark the chart has. Suppressing an
   * animation must not remove the thing it was animating.
   */
  test("reduced motion leaves the trend whole and the mark visible", () => {
    expect(REDUCED).toMatch(/\.weight-chart-trend\s*\{[^}]*clip-path:\s*none/);
    expect(REDUCED).toMatch(/\.weight-chart-latest\s*\{[^}]*opacity:\s*1/);
  });
});

describe("the two drawings", () => {
  /*
   * FUEL-78. `/weight`'s chart takes the frame at ≥1272, and the geometry
   * depends on the box's aspect — so the same readings are laid out twice, on
   * the server, and CSS shows one. These are the claims that arrangement rests
   * on; `page-columns.spec.ts` is where a browser confirms only one is seen.
   */
  test("both shapes are drawn, in their own boxes", () => {
    const { container } = drawBoth();

    const boxes = [...container.querySelectorAll("[data-chart-shape]")];

    expect(boxes.map((box) => box.getAttribute("data-chart-shape"))).toEqual([
      "measure",
      "frame",
    ]);
  });

  test("the frame's drawing carries the frame's viewBox", () => {
    const { container } = drawBoth();

    const frame = container.querySelector('[data-chart-shape="frame"] svg[viewBox]');
    const measure = container.querySelector('[data-chart-shape="measure"] svg[viewBox]');

    expect(frame?.getAttribute("viewBox")).toBe("0 0 968 300");
    expect(measure?.getAttribute("viewBox")).toBe("0 0 320 170");
  });

  /*
   * The measure's drawing is hidden at the cap and the frame's below it, which
   * is `display: none` in both directions — so exactly one graphic is in the
   * accessibility tree at any width, and the summary is heard once.
   *
   * The classes are asserted here rather than the rendered visibility because
   * jsdom applies no stylesheet. This is the one place in this file that names
   * a Tailwind class, and it does so because the class IS the mechanism: the
   * pair is only correct if each is hidden exactly where the other is shown.
   */
  test("each drawing is hidden exactly where the other is shown", () => {
    const { container } = drawBoth();

    const measure = container.querySelector('[data-chart-shape="measure"]');
    const frame = container.querySelector('[data-chart-shape="frame"]');

    expect(measure?.className).toContain("xl:hidden");
    expect(measure?.className).not.toContain("hidden xl:block");
    expect(frame?.className).toContain("hidden");
    expect(frame?.className).toContain("xl:block");
  });

  /*
   * § Accessibility's data table is the chart's other half, and it belongs to
   * the readings rather than to a box. Rendered twice it would read every
   * weigh-in out a second time — the failure `aria-hidden` on the overlay was
   * added to prevent, one level up.
   */
  test("the readings are tabled once, outside both drawings", () => {
    const { container } = drawBoth();

    const tables = container.querySelectorAll("table");

    expect(tables).toHaveLength(1);
    expect(tables[0]?.closest("[data-chart-shape]")).toBeNull();
  });

  test("both drawings plot every reading, and mark only the latest in each", () => {
    const { container } = drawBoth();

    for (const shape of ["measure", "frame"]) {
      const box = container.querySelector(`[data-chart-shape="${shape}"]`);

      // § Rule 2's one umber mark, per drawing rather than per document.
      expect(box?.querySelectorAll("circle")).toHaveLength(1);
      expect(box?.querySelectorAll("polyline")).toHaveLength(1);
    }
  });
});
