import { describe, expect, test } from "vitest";

import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_BAND_GRAPHIC,
  PAGE_BAND_SPAN,
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

describe("a redefined breakpoint does not cascade the way it reads", () => {
  /*
   * The trap FUEL-77 fell into, pinned so the next person meets it as a failing
   * test rather than as two day rulers in a screenshot.
   *
   * Tailwind v4 emits a breakpoint that the app redefines **before** the ones it
   * did not, whatever order they are declared in and wherever in `@theme` the
   * declaration sits — both were tried. So the emitted order is `xl` (1272),
   * then `sm`, `md`, `lg`, `2xl` in the ascending order one expects.
   *
   * The consequence is the whole reason this is worth a test: on one element,
   * for one property, **`xl:` loses to `md:` and `lg:`** — the opposite of what
   * every developer reading the class string will assume. `hidden md:block
   * xl:hidden` is a copy that never stands down, and the way it fails is silent:
   * both copies draw, and on `/` that meant two day rulers and two umber NOW
   * markers against § The Four Rules' "one umber element per screen".
   *
   * The app's answer is to stop relying on the cascade rather than to fight the
   * order — a bounded `md:max-xl:` variant is one rule true in one band, with
   * nothing to override. This test does not enforce that; it enforces that the
   * reason for it is still true, so that a Tailwind release which sorts these
   * properly is noticed here rather than assumed anywhere.
   */
  test("`xl` is emitted ahead of the framework's own breakpoints", async () => {
    const css = await build(["md:block", "lg:block", "xl:block"]);

    /*
     * Matched on the WIDTH rather than on the whole prelude — raised by the
     * FUEL-77 precommit review. The claim here is about order; pinning
     * `@media (width >= 48rem)` verbatim would also fail the day Tailwind or
     * lightningcss emits `min-width`, which would be a failure for the wrong
     * reason and would teach the next reader to distrust the test.
     */
    const at = (width: string) => {
      const index = css.search(new RegExp(`@media[^{]*${width.replace(".", "\\.")}`));
      expect(index, `no media block emitted for ${width}`).toBeGreaterThan(-1);
      return index;
    };

    expect(at("1272px"), "xl before md").toBeLessThan(at("48rem"));
    expect(at("48rem"), "md before lg").toBeLessThan(at("64rem"));
  });

  test("a bounded variant nests instead of racing", async () => {
    // What `RULER_AT.wide` and the ruler's own head clearance use instead. One
    // rule, one band, no second rule to be ordered against.
    const css = await build(["md:max-xl:block"]);

    expect(css).toMatch(
      /@media \(width >= 48rem\) \{\s*@media \(width < 1272px\) \{/,
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

    // Row three since FUEL-86 put the header band in row one. Still the row
    // after the measure's sections; what changed is what is above them.
    expect(css).toContain("grid-row-start: 3");

    // And the two utilities that stop it paying for the aside's height — the
    // auto margin zeroed so the bar sits at the TOP of its row, and the stretch
    // released so its box is its own height rather than the row's. `frame.ts`
    // carries the argument; this is that the CSS actually says it.
    expect(css).toContain("margin-top: 0");
    expect(css).toContain("align-self: flex-start");
  });

  test("the rows are declared, and the last one takes the aside's surplus", async () => {
    const css = await build(utilities(PAGE_ASIDE_GRID));

    // Three `auto` tracks split a spanning aside's surplus evenly, so the
    // measure's row grows for a reason that has nothing to do with the measure
    // and the bar goes down with it — measured at 183px on `/` before this.
    // A flexible last track confines the surplus to the bar's row, below it.
    expect(css).toContain("grid-template-rows: auto auto 1fr");
  });
});

describe("the tablet band is bounded rather than fluid — FUEL-79", () => {
  /*
   * § Desktop claims 768–1023 for "the phone's navigation and the desktop's
   * content shapes", and FUEL-85 released graphics, figures, folios and tables
   * from the measure. Doing both without a ceiling produces a regression rather
   * than a gain, and `/plan` was the proof: it has spanned since FUEL-71 with
   * nothing capping it, and measured **967px at 1023 and 776px at 1024**,
   * because below `lg` there is no rail and at `lg` the rail and its gutter take
   * 248px back. One pixel of window cost 191px of table.
   *
   * These tests hold the two halves of the answer: the band is capped at what
   * `lg` will give it, and the cap is released when `lg` arrives. Both are
   * `max-width`, both are on `<main>`, and the second is the one easy to lose —
   * without it the 776 would still be standing at 1920, which is the same shape
   * of fault as a `max-w-none` that was never written.
   */
  test("the band's cap and its release are both emitted, in that order", async () => {
    const css = await build(utilities(PAGE_BAND_SPAN));

    expect(css).toContain("max-width: var(--frame-band-max)");
    expect(css).toContain("max-width: var(--frame-span)");

    // `lg` after `md`, so the release is the later rule and wins. This is the
    // one ordering in the app that resolves the way it reads — an `xl:` here
    // would not, which is what the emission-order test above is about.
    const at = (width: string) => css.search(new RegExp(`@media[^{]*${width}`));
    expect(at("48rem"), "md before lg").toBeLessThan(at("64rem"));
  });

  /*
   * The bleed is two rules because the spare width is not in the same place at
   * both ends of the band: below `lg` `<main>` is centred and the width is split
   * either side, and at `lg` it is the frame's second track and the width is all
   * to its right. A symmetric bleed at `lg` puts the graphic's left edge at
   * x=208, inside the 220px rail.
   *
   * Both halves are bounded by `max-xl`, and that is the assertion that matters:
   * at 1272 these graphics are placed by the header band and are already
   * spanning the frame, so a bleed still standing would push them off the right
   * of the window. An `xl:` cancel would NOT work — Tailwind emits `xl` first,
   * so it would be the earlier rule — which is why the bound is on the variant
   * rather than on an override.
   */
  test("the graphic's bleed stands down at the frame's cap", async () => {
    for (const utility of utilities(PAGE_BAND_GRAPHIC)) {
      const atRules = enclosingAtRules(await build([utility]), utility).join(" ");

      expect(atRules, `${utility} is not bounded above`).toMatch(/width < 1272px/);
    }
  });

  test("the bleed is symmetric below the rail and rightward once it arrives", async () => {
    const css = await build(utilities(PAGE_BAND_GRAPHIC));

    // Half the difference each side below `lg`; the whole of it to the right at
    // `lg`, with the symmetric half zeroed first. Both derive from the same pair
    // of declarations, so the band's width is stated once and the escapes follow
    // it — a bleed written as a number would be 68 and 136 with nothing saying
    // where either came from.
    //
    // Read as the emitted property rather than as the authored value: Tailwind
    // negates an arbitrary margin by wrapping it in `calc(… * -1)`, so asserting
    // the class string back would pass on a rule that never reached CSS.
    expect(css).toContain(
      "margin-inline: calc(calc((var(--frame-band-inset) - var(--frame-measure-inset)) / 2) * -1)",
    );
    expect(css).toContain(
      "margin-right: calc(calc(var(--frame-band-inset) - var(--frame-measure-inset)) * -1)",
    );

    // The `lg` half zeroes the symmetric margin before taking the whole
    // difference rightward. Without it the two would add up and the graphic
    // would keep a left bleed under the rail.
    expect(css).toContain("margin-inline: 0px");
  });

  /*
   * § Density's amendment is "four-across on a measure and stays 2×2 in an
   * aside", and it closes by insisting the count "is decided by the content, and
   * so it is not a width rule". An `xl:` variant made it one: the measure is
   * 584px at every width from 768 up, so the identical column drew this grid 2×2
   * at 820 and four-across at 1272.
   */
  test("the four-macro grid takes its four where the measure becomes 584", async () => {
    const css = await build(["md:grid-cols-4"]);
    const atRules = enclosingAtRules(css, "md:grid-cols-4").join(" ");

    expect(atRules).toMatch(/48rem/);
    expect(atRules).not.toMatch(/1272px/);
  });
});
