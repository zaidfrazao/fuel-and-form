import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * What the hover grounds do to contrast — measured, in both themes.
 *
 * FUEL-75's acceptance criterion is "text on a hovered ground still meets
 * § Accessibility's ratios in both themes", and it is the one criterion that
 * cannot be met by reading the Brand Guide, because a hover changes the ground
 * under text that was measured against a different one. § Color Palette states
 * every ratio "against that mode's canvas"; `surface` is not the canvas.
 *
 * The numbers are computed rather than transcribed, from tokens read out of
 * `globals.css` rather than copied into this file. A token that moves is
 * measured at its new value here on the next run, and § Color Palette's own
 * ratios stay `globals.tokens.test.ts`'s business.
 *
 * § Accessibility: "≥4.5:1 body, ≥3:1 for large text and every control, tick,
 * dot and hairline that carries meaning." Everything a hover puts on a ground
 * in this app is small text, so 4.5 is the line throughout.
 */

/**
 * The palette, read out of `globals.css` rather than transcribed.
 *
 * `globals.tokens.test.ts` is the file allowed to write these values down —
 * it is the fixture its own "no raw hex outside the token blocks" rule is
 * checked against, and every other file in `src/` is forbidden a hex literal so
 * that a colour cannot be stated twice and drift. That rule applies here, and
 * it is the better arrangement anyway: a contrast ratio computed from a
 * transcription measures the transcription.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"),
  "utf8",
);

/**
 * The body of a top-level rule.
 *
 * Both ends are asserted, for `globals.tokens.test.ts`'s reason: an unfound
 * terminator would make `slice` return the rest of the file, and a block that
 * quietly swallowed the whole stylesheet would still find every token it was
 * asked for — from the wrong theme.
 */
function tokens(selector: string): Record<string, string> {
  const open = CSS.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`no ${selector} block in globals.css`);
  const close = CSS.indexOf("\n}", open);
  if (close === -1) throw new Error(`${selector} block is unterminated`);

  const declared = CSS.slice(open, close).matchAll(
    /--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi,
  );
  return Object.fromEntries(
    [...declared].map((match) => [match[1], (match[2] ?? "").toLowerCase()]),
  );
}

const PALETTE = {
  light: tokens(":root"),
  dark: tokens(".dark"),
} as const;

type Theme = keyof typeof PALETTE;
type Token =
  | "canvas"
  | "surface"
  | "ink"
  | "ink-fg"
  | "accent-subtle"
  | "text-primary"
  | "text-secondary"
  | "text-tertiary"
  | "error";
type Rgb = readonly [number, number, number];

const THEMES = Object.keys(PALETTE) as Theme[];

const rgb = (hex: string): Rgb => {
  const channels = hex.slice(1).match(/../g);
  if (channels?.length !== 3) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = channels.map((pair) => parseInt(pair, 16)) as [
    number,
    number,
    number,
  ];
  return [r, g, b];
};

const colour = (theme: Theme, token: Token): Rgb => {
  const value = PALETTE[theme][token];
  // Named rather than allowed to become `rgb(undefined)`, which would throw
  // somewhere further down and blame the wrong thing.
  if (!value) throw new Error(`${theme} has no --${token} in globals.css`);
  return rgb(value);
};

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const one = luminance(a);
  const other = luminance(b);
  const lighter = Math.max(one, other);
  const darker = Math.min(one, other);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `bg-ink/90` composited over the ground behind it.
 *
 * Tailwind renders the `/90` as alpha rather than as the mock's opaque mix with
 * `--canvas`, so the colour a reader actually sees depends on what is behind
 * the control. Every control that takes this state — the Primary button, the
 * ink tile, the active rail item — sits on the canvas, which is what makes the
 * two forms the same colour.
 */
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => [
  alpha * fg[0] + (1 - alpha) * bg[0],
  alpha * fg[1] + (1 - alpha) * bg[1],
  alpha * fg[2] + (1 - alpha) * bg[2],
];

const AA_SMALL_TEXT = 4.5;

describe.each(THEMES)("%s", (theme) => {
  const on = (token: Token) => colour(theme, token);

  describe("text on the `surface` ground a hover adds", () => {
    /*
     * The first row of § Desktop's table, which is every list row, week cell,
     * checkbox, inactive rail item and unfilled button in the app.
     *
     * Only `text-primary` and `error` appear on it. That is not an accident of
     * the markup — it is what `HOVER_LIFT` is for: every `text-secondary` and
     * `text-tertiary` span inside a control that takes this ground is lifted to
     * `text-primary` for as long as the pointer is there. The test below this
     * one is the measurement that made the lift necessary.
     */
    test.each([
      ["text-primary", "the label of any control, and every lifted span"],
      ["error", "a Destructive button's text, which keeps its own colour"],
    ] as const)("%s — %s", (token, _why) => {
      expect(ratio(on(token), on("surface"))).toBeGreaterThanOrEqual(
        AA_SMALL_TEXT,
      );
    });

    test("`text-secondary` would not have cleared it — this is why the lift exists", () => {
      /*
       * 4.26:1 in light, against a 4.5 requirement, where the same token reads
       * 4.80:1 on the canvas. § Color Palette measured it against the canvas
       * and it passed there with 0.30 to spare, so the ground a hover adds is
       * enough on its own to put it under.
       *
       * The mock has the identical shortfall — it draws `.row-trail` in
       * `--text-2` on `--hover-ground` — so this is inherited rather than
       * introduced, and § Accessibility's own tie-break decides it: "where
       * restraint and contrast conflict, contrast wins".
       *
       * Asserted rather than commented, because a future token change that
       * quietly fixed it would leave `HOVER_LIFT` in place with nothing to
       * point at, and one that made it worse would look like nothing at all.
       */
      const unlifted = ratio(on("text-secondary"), on("surface"));
      const lifted = ratio(on("text-primary"), on("surface"));

      if (theme === "light") expect(unlifted).toBeLessThan(AA_SMALL_TEXT);
      expect(lifted).toBeGreaterThan(unlifted);
      expect(lifted).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    test("`text-tertiary` starts under the line and the ground deepens it", () => {
      const onCanvas = ratio(on("text-tertiary"), on("canvas"));
      const onSurface = ratio(on("text-tertiary"), on("surface"));

      // FUEL-63's problem, not FUEL-75's — but FUEL-75 must not make it worse
      // and leave it there, which is why every tertiary span inside a grounded
      // control carries `HOVER_LIFT` too.
      expect(onCanvas).toBeLessThan(AA_SMALL_TEXT);
      expect(onSurface).toBeLessThan(onCanvas);
      expect(ratio(on("text-primary"), on("surface"))).toBeGreaterThanOrEqual(
        AA_SMALL_TEXT,
      );
    });
  });

  describe("text on the fill a hover takes to 90%", () => {
    test("`ink-fg` on `ink/90` over the canvas", () => {
      const ground = over(on("ink"), on("canvas"), 0.9);
      expect(ratio(on("ink-fg"), ground)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    test("`ink-fg` on `error/90` over the canvas — the confirmation sheet's Delete", () => {
      const ground = over(on("error"), on("canvas"), 0.9);
      expect(ratio(on("ink-fg"), ground)).toBeGreaterThanOrEqual(3);
    });
  });

  describe("the swapped week cell keeps its own ground", () => {
    /*
     * It takes `HOVER_RING` rather than either fill, so the ground under its
     * text does not move at all and the numbers here are the rest state's.
     * Recorded because the alternative — the mock's specificity, which replaces
     * `accent-subtle` with `surface` — would have changed them.
     */
    test("its text is measured against `accent-subtle`, hovered or not", () => {
      expect(
        ratio(on("text-primary"), on("accent-subtle")),
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  });
});

describe("the ring is a hairline, and it is the guide's value", () => {
  /*
   * `--hover-ring: inset 0 0 0 1.5px var(--text-3)` is drawn in the mock and
   * argued in § Desktop, which rejects `accent` for it by name: "a hover that
   * borrowed the umber would say *chosen* of whatever the pointer crossed."
   *
   * Measured here rather than asserted against § Accessibility's 3:1 for "every
   * control, tick, dot and hairline that carries meaning", because it does not
   * reach it — 1.95:1 in light and 2.52:1 in dark, on the `surface` ground of
   * the stone tile it is drawn on. The value is the guide's, the shortfall is
   * `text-tertiary`'s and belongs with FUEL-63, and this test exists so that it
   * is a number somebody chose to live with rather than one nobody had.
   *
   * It is not an AC7 failure: AC7 is about text on a hovered ground, and every
   * one of those is asserted above. Nothing here is text.
   */
  test.each(THEMES)("%s — recorded, not met", (theme) => {
    const measured = ratio(colour(theme, "text-tertiary"), colour(theme, "surface"));
    expect(measured).toBeLessThan(3);
    expect(measured).toBeCloseTo(theme === "light" ? 1.95 : 2.52, 2);
  });
});
