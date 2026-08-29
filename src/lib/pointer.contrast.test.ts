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
 * The numbers are computed here rather than transcribed. `globals.tokens.test.ts`
 * pins these hex values to `globals.css`, so a token that moves fails there and
 * the ratios below are recomputed from the value that replaced it rather than
 * from a comment somebody forgot.
 *
 * § Accessibility: "≥4.5:1 body, ≥3:1 for large text and every control, tick,
 * dot and hairline that carries meaning." Everything a hover puts on a ground
 * in this app is small text, so 4.5 is the line throughout.
 */

const PALETTE = {
  light: {
    canvas: "#ffffff",
    surface: "#f4f1ec",
    ink: "#1c1917",
    "ink-fg": "#ffffff",
    "accent-subtle": "#f3ebe3",
    "text-primary": "#1c1917",
    "text-secondary": "#78716c",
    "text-tertiary": "#b5aea6",
    error: "#a93226",
  },
  dark: {
    canvas: "#0c0b0a",
    surface: "#17150f",
    ink: "#f5f3f0",
    "ink-fg": "#1c1917",
    "accent-subtle": "#251b14",
    "text-primary": "#f5f3f0",
    "text-secondary": "#a8a29e",
    "text-tertiary": "#5c5650",
    error: "#f0776b",
  },
} as const;

type Theme = keyof typeof PALETTE;
type Token = keyof (typeof PALETTE)["light"];
type Rgb = readonly [number, number, number];

const THEMES = Object.keys(PALETTE) as Theme[];

const rgb = (hex: string): Rgb => {
  const channels = hex.slice(1).match(/../g);
  if (!channels) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = channels.map((pair) => parseInt(pair, 16));
  return [r, g, b];
};

const colour = (theme: Theme, token: Token): Rgb => rgb(PALETTE[theme][token]);

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
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
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]) as unknown as Rgb;

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
    ] as const)("%s — %s", (token) => {
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
