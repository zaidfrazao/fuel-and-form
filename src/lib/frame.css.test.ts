import { describe, expect, test } from "vitest";

import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_MEASURE_COLUMN,
  PAGE_MEASURE_FOOT,
} from "./frame";
import { build, enclosingAtRules, utilities } from "./tailwind-build.test-helper";

/**
 * The page's second column, compiled rather than read — FUEL-77.
 *
 * `frame.test.tsx` asserts that the right elements wear these strings. It
 * cannot tell you what the strings mean, and every failure this file is here
 * for is one that leaves a green suite behind it:
 *
 *   - **The breakpoint.** § Desktop redefines `xl` from Tailwind's 1280 to
 *     1272, "because the frame is a sum of its columns and 1280 would leave 8px
 *     belonging to no column". Delete that declaration and every `xl:` in the
 *     app keeps working — 8px late. The aside would be absent at exactly the
 *     width the mock is drawn at and present everywhere above it, which is a
 *     regression whose only witness is a screenshot at 1272.
 *   - **The tracks.** `grid-cols-[var(--frame-measure-inset)_minmax(0,1fr)]` is
 *     an arbitrary value, and a class name Tailwind declines to generate is not
 *     a build error. It is a `<main>` with `display: grid` and no columns, which
 *     stacks the two groups and looks like a screen that simply has no aside.
 *   - **The variable.** `--frame-measure-inset` is referenced by name. A
 *     renamed or deleted token compiles to `var(--frame-measure-inset)` against
 *     nothing, and an unresolved custom property in `grid-template-columns`
 *     makes the declaration invalid at computed-value time — again, one column.
 */

describe("§ Desktop's xl is 1272, not the 1280 it resembles", () => {
  /*
   * The width is read out of the emitted media query rather than out of
   * globals.css, so the assertion covers the whole path: the declaration, the
   * `@theme` block it has to be inside to become a variant at all, and
   * Tailwind's own translation of it.
   *
   * Tailwind v4 emits range syntax — `@media (width >= 1272px)`. Matched
   * loosely enough to survive a serializer that prefers `min-width`, and
   * strictly enough that 1280 fails.
   */
  test.each(utilities(PAGE_ASIDE_GRID))("%s is scoped to 1272px", async (utility) => {
    const css = await build([utility]);
    const atRules = enclosingAtRules(css, utility).join(" ");

    expect(atRules).toMatch(/1272px/);
    expect(atRules).not.toMatch(/1280px/);
  });

  /*
   * The control for the test above. If `enclosingAtRules` ever stopped finding
   * the query, "does not contain 1280px" would pass on an empty string and the
   * regression this file exists for would go through unremarked.
   */
  test("an xl: utility is inside a media query at all", async () => {
    const css = await build(["xl:grid"]);
    expect(enclosingAtRules(css, "xl:grid")).toContainEqual(
      expect.stringContaining("@media"),
    );
  });
});

describe("the page's own columns emit what they claim", () => {
  test("the reading column is the measure less its own gutters", async () => {
    const css = await build(utilities(PAGE_ASIDE_GRID));

    // 584 and 356 are never written down. The first track is the declared
    // inset; the second is what is left, which at the cap is the frame's third
    // track exactly — the same derivation globals.css uses for the aside.
    expect(css).toContain(
      "grid-template-columns: var(--frame-measure-inset) minmax(0,1fr)",
    );
  });

  test("the rows are packed at the top rather than spread down the viewport", async () => {
    const css = await build(utilities(PAGE_ASIDE_GRID));

    // Without this `<main>`'s full-height stretch is distributed across the two
    // rows and the action bar ends up at the foot of the window — the posture
    // FUEL-72 removed, arriving again from the other direction.
    expect(css).toContain("align-content: flex-start");
  });

  test("the columns gap by the frame's gutter and not by a number", async () => {
    const css = await build(utilities(PAGE_ASIDE_GRID));
    expect(css).toContain("column-gap: var(--frame-gutter)");
  });

  test("there is no row gap, because the bar brings its own", async () => {
    const css = await build(utilities(PAGE_ASIDE_GRID));

    // `action-bar.ts` carries `pt-[30px]`. A 30px row gap here would draw 60
    // between the last figure and the primary action, at one width only.
    expect(css).not.toContain("row-gap:");
  });

  test("the aside spans both rows so the bar stays with its figures", async () => {
    const css = await build(utilities(PAGE_ASIDE_COLUMN));

    // Confined to row one, the aside would make that row as tall as whichever
    // column was longer and push the action bar an arbitrary distance below the
    // measure's content.
    expect(css).toContain("grid-row: span 2 / span 2");
  });

  test("both groups are boxless below the breakpoint", async () => {
    // `contents` is what lets one DOM serve both shapes: below `xl` these
    // wrappers generate no box, so the phone's column is the sections
    // themselves in the order they are written, with the gap it already had.
    for (const group of [PAGE_MEASURE_COLUMN, PAGE_ASIDE_COLUMN]) {
      expect(utilities(group)[0]).toBe("contents");

      const css = await build(["contents"]);
      expect(css).toContain("display: contents");
    }
  });

  test("the action bar is placed rather than left to fall where it may", async () => {
    const css = await build(utilities(PAGE_MEASURE_FOOT));
    expect(css).toContain("grid-column-start: 1");
    expect(css).toContain("grid-row-start: 2");
  });
});
