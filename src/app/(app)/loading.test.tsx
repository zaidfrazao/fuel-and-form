import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { APP_ACTION_BAR } from "@/components/action-bar";
import { RULER_AT } from "@/components/day-ruler";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_ASIDE_UNWRAP,
  PAGE_MEASURE_COLUMN,
  PAGE_MEASURE_FOOT,
} from "@/lib/frame";

import Loading from "./loading";

/**
 * The `/` skeleton, against the layout it stands in for — FUEL-77.
 *
 * § Feedback: "skeletons matching final layout. **No spinner on `/` ever.**"
 * The first half of that had never been asserted by anything, and it is the half
 * that rots: `right-now.tsx` changed shape at 768 in FUEL-82 and again at 1272
 * here, and a skeleton drawn for one width shifts on swap-in at the others —
 * which is precisely the failure a skeleton is chosen over a spinner to avoid.
 *
 * What this file can hold is structure: the same columns, the same shape
 * variants, the same ruler positions, the same bar. It cannot hold pixels, and
 * it does not pretend to — the block heights are transcriptions and stay
 * transcriptions. What it stops is a screen that gains a column while its
 * skeleton keeps one.
 */

const skeleton = () => {
  const { container } = render(<Loading />);
  return container;
};

describe("the skeleton stands in the same frame as the screen", () => {
  test("takes the page grid from the same constants", () => {
    const main = skeleton().querySelector("main")!;

    // Not a copy of the class names: the same string `right-now.tsx` wears, so
    // the two cannot be given different columns by an edit to one of them.
    for (const utility of PAGE_ASIDE_GRID.split(" ")) {
      expect(main.className).toContain(utility);
    }
  });

  test("groups its blocks into the same two columns", () => {
    const container = skeleton();

    expect(container.querySelector('[data-column="measure"]')!.className).toBe(
      PAGE_MEASURE_COLUMN,
    );
    expect(container.querySelector('[data-column="aside"]')!.className).toBe(
      PAGE_ASIDE_COLUMN,
    );
    // The wrapper that dissolves at the cap, so the two groups become `<main>`'s
    // own grid items rather than a box inside it.
    expect(
      container.querySelector('[data-column="measure"]')!.parentElement!.className,
    ).toContain(PAGE_ASIDE_UNWRAP);
  });

  test("draws the ruler in all three of its positions", () => {
    /*
     * The one element on the screen that moves between bands, and so the one
     * most able to make the skeleton jump. Read from `RULER_AT` rather than
     * matched against literals, because the point is that the screen and the
     * skeleton take the same declaration — a test that restated the strings
     * would pass just as happily on two files that had drifted apart.
     */
    const container = skeleton();

    for (const [at, variant] of Object.entries(RULER_AT)) {
      expect(container.querySelector(`[data-ruler="${at}"]`)!.className).toBe(variant);
    }
  });

  test("the wide copy is in the measure and the other two are in the aside", () => {
    // Which is where `/` puts them: 768–1271 the ruler precedes the figures in
    // the first column, and at the cap it is the top of the second.
    const container = skeleton();

    const columnOf = (at: string) =>
      container
        .querySelector(`[data-ruler="${at}"]`)!
        .closest("[data-column]")!
        .getAttribute("data-column");

    expect(columnOf("wide")).toBe("measure");
    expect(columnOf("phone")).toBe("aside");
    expect(columnOf("aside")).toBe("aside");
  });

  test("carries both macro shapes, at the row gaps each uses", () => {
    // Below 768 the meal and the day are one grid of three-line cells at a 14px
    // row gap — `macro-grid.tsx` — and above it they are two named sections of
    // four cells at 22. A skeleton with one grid was 40px short at one width and
    // a whole section short at the other.
    const container = skeleton();

    const merged = container.querySelector('[data-shape="merged"]')!;
    const split = container.querySelector('[data-shape="split"]')!;

    expect(merged.className).toBe("md:hidden");
    expect(merged.querySelector(".grid")!.className).toContain("gap-y-[14px]");

    expect(split.className).toContain("hidden");
    expect(split.querySelectorAll(".grid")).toHaveLength(2);
    expect(split.querySelector(".grid")!.className).toContain("gap-y-[22px]");
  });

  test("the bar is the shared string and the shared placement", () => {
    // FUEL-83's whole point, plus FUEL-77's half of it. A skeleton bar that
    // disagreed with the real one about either would move the primary on
    // swap-in — 86px if it disagreed about the pinning, a column if it
    // disagreed about the placement.
    const container = skeleton();

    const bar = [...container.querySelectorAll("div")].find((node) =>
      node.className.includes("action-bar-fade"),
    )!;

    expect(bar.className).toBe(`${APP_ACTION_BAR} ${PAGE_MEASURE_FOOT}`);
  });

  test("opens at the head clearance the screen opens at", () => {
    // FUEL-82 took `/` to 12px below 768 and left this file at 22, so the swap-
    // in moved everything up 10px on a phone. Both now say the same thing.
    const main = skeleton().querySelector("main")!;

    expect(main.className).toContain("pt-3");
    expect(main.className).toContain("md:pt-[22px]");
  });

  test("says the one useful thing, and nothing else", () => {
    // The blocks are `aria-hidden` under a live region: a screen reader reading
    // out a dozen empty boxes is worse than silence. Unchanged by this ticket
    // and asserted because the wrappers it added are inside that boundary.
    const container = skeleton();

    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "Loading today’s plan.",
    );

    for (const column of container.querySelectorAll("[data-column]")) {
      expect(column.closest("[aria-hidden]")).not.toBeNull();
    }
  });

  test("draws no spinner", () => {
    // § Feedback, in the file's own words: "No spinner on `/` ever." Nothing
    // animates, so nothing needs a `prefers-reduced-motion` guard either.
    const container = skeleton();

    expect(container.innerHTML).not.toMatch(/animate-|spin/);
  });
});
