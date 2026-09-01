import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { APP_ACTION_BAR } from "@/components/action-bar";
import { RULER_AT } from "@/components/day-ruler";
import { KV_GRID_COLUMNS } from "@/components/kv-grid";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_ASIDE_UNWRAP,
  PAGE_HEADER_BAND,
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
    // `filter(Boolean)`, because `split(" ")` on a string that has picked up a
    // double space yields `""` and `toContain("")` is true of everything — the
    // one assertion meant to stop the screen and the skeleton drifting would
    // then pass on any element at all.
    for (const utility of PAGE_ASIDE_GRID.split(" ").filter(Boolean)) {
      expect(main.className).toContain(utility);
    }
  });

  test("groups its blocks into the same three zones", () => {
    const container = skeleton();

    // The band takes the constant plus the caption gap the screen gives it —
    // `toContain` rather than identity for that one reason, and the gap is
    // named so a second class cannot arrive here unnoticed.
    expect(container.querySelector('[data-column="header"]')!.className).toBe(
      `${PAGE_HEADER_BAND} xl:gap-[2px]`,
    );
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

    // Three of `RULER_AT`'s four. The fourth, `belowCap`, is the copy a workout
    // card draws instead of the meal card's pair — a skeleton stands in for one
    // layout and the meal is the one it was drawn against, so it has no place
    // to put a variant that only exists on the other card.
    for (const at of ["phone", "wide", "header"] as const) {
      expect(container.querySelector(`[data-ruler="${at}"]`)!.className).toBe(
        RULER_AT[at],
      );
    }
  });

  test("each copy is in the zone `/` puts it in", () => {
    // 768–1271 the ruler precedes the figures in the measure, below 768 it
    // follows them in the aside group, and at the cap it is the header band's —
    // which is where FUEL-86 moved it from the aside.
    const container = skeleton();

    const columnOf = (at: string) =>
      container
        .querySelector(`[data-ruler="${at}"]`)!
        .closest("[data-column]")!
        .getAttribute("data-column");

    expect(columnOf("wide")).toBe("measure");
    expect(columnOf("phone")).toBe("aside");
    expect(columnOf("header")).toBe("header");
  });

  test("carries every macro shape, at the row gaps and counts each uses", () => {
    // Below 768 the meal and the day are one grid of three-line cells at a 14px
    // row gap — `macro-grid.tsx` — and above it they are two named sections of
    // four cells at 22. A skeleton with one grid was 40px short at one width and
    // a whole section short at the other.
    //
    // FUEL-86 split the pair across the two columns, so `split` is the meal's
    // alone and the day's is `day`, in the aside where the screen now puts it.
    const container = skeleton();

    const merged = container.querySelector('[data-shape="merged"]')!;
    const split = container.querySelector('[data-shape="split"]')!;
    const day = container.querySelector('[data-shape="day"]')!;

    expect(merged.className).toBe("md:hidden");
    expect(merged.querySelector(".grid")!.className).toContain("gap-y-[14px]");

    expect(split.className).toContain("hidden");
    expect(split.querySelectorAll(".grid")).toHaveLength(1);
    expect(split.querySelector(".grid")!.className).toContain("gap-y-[22px]");

    // The meal's goes four across on the measure and the day's does not, which
    // is the screen's own arrangement — `kv-grid.tsx` owns the rule.
    //
    // Read from that declaration rather than restated, since FUEL-79. This
    // asserted the literal `xl:grid-cols-4`, which meant the drift was the
    // thing the test PINNED: FUEL-79 moved the real grid to `md` — the measure
    // is 584px at both widths, so the count was never a width decision — this
    // file's copy stayed at `xl`, and the skeleton drew 2×2 against the
    // screen's four across for the whole of 768–1271. Green suite, and a shift
    // on swap-in at every width in the band.
    //
    // The comment above this block has claimed since FUEL-86 that "the two
    // cannot be given different columns by an edit to one of them". Naming the
    // constant is what finally makes that true rather than aspirational.
    // Utility by utility rather than as one substring: `cn` merges these class
    // strings and is free to reorder them, so asserting the map's value whole
    // would be asserting the merge's output order as well as the shape.
    for (const utility of KV_GRID_COLUMNS[4].split(" ")) {
      expect(split.querySelector(".grid")!.className).toContain(utility);
    }
    expect(day.querySelector(".grid")!.className).not.toMatch(/(md|lg|xl):grid-cols/);

    // Both gated at `md`, because below it the merged grid carries all four
    // figures and neither of these is drawn.
    expect(day.className).toContain("hidden");
    expect(day.querySelector(".grid")!.className).toContain("gap-y-[22px]");
  });

  test("draws the list each width shows, at that list's row height", () => {
    // `The day` at the cap and `Up next` below it — `right-now.tsx` carries the
    // argument for the pair. A skeleton with only one of them would swap in
    // against a different list at one of the two widths, which is the shift it
    // exists to prevent.
    const container = skeleton();

    const theDay = container.querySelector('[data-section="the-day"]')!;
    const upNext = container.querySelector('[data-section="up-next"]')!;

    expect(theDay.className).toContain("hidden");
    expect(theDay.className).toContain("xl:flex");
    expect(theDay.querySelectorAll(".min-h-\\[44px\\]")).toHaveLength(6);

    expect(upNext.className).toContain("xl:hidden");
    expect(upNext.querySelectorAll(".min-h-\\[54px\\]")).toHaveLength(2);
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

    // Two boundaries, asserted separately — the group's own and its wrapper's.
    // `closest` alone would now be satisfied by the element itself, which would
    // make this pass while the wrapper had quietly lost its attribute.
    for (const column of container.querySelectorAll("[data-column]")) {
      expect(column.getAttribute("aria-hidden")).toBe("true");
      expect(column.parentElement!.getAttribute("aria-hidden")).toBe("true");
    }
  });

  test("draws no spinner", () => {
    // § Feedback, in the file's own words: "No spinner on `/` ever." Nothing
    // animates, so nothing needs a `prefers-reduced-motion` guard either.
    const container = skeleton();

    expect(container.innerHTML).not.toMatch(/animate-|spin/);
  });
});
