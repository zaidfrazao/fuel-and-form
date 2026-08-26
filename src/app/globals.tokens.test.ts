import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * Brand Guide § Color Palette, transcribed. This is the only place outside
 * globals.css where these values are written down, and the point of the
 * duplication is that a token cannot be changed by accident — only by editing
 * the guide's values here too, which is a deliberate act.
 *
 * Contrast ratios are measured and recorded in the guide; they hold as long as
 * the values do, which is what this asserts.
 */
const PALETTE: Record<string, { light: string; dark: string }> = {
  accent: { light: "#8a5a3b", dark: "#c89a6b" },
  "accent-subtle": { light: "#f3ebe3", dark: "#251b14" },
  ink: { light: "#1c1917", dark: "#f5f3f0" },
  "ink-fg": { light: "#ffffff", dark: "#1c1917" },
  canvas: { light: "#ffffff", dark: "#0c0b0a" },
  surface: { light: "#f4f1ec", dark: "#17150f" },
  raised: { light: "#ffffff", dark: "#1f1c19" },
  border: { light: "#e5e1db", dark: "#2a2724" },
  "text-primary": { light: "#1c1917", dark: "#f5f3f0" },
  "text-secondary": { light: "#78716c", dark: "#a8a29e" },
  "text-tertiary": { light: "#b5aea6", dark: "#5c5650" },
  success: { light: "#2f7d3e", dark: "#4ade80" },
  error: { light: "#a93226", dark: "#f0776b" },
};

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = join(dirname(THIS_FILE), "..");
const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

/**
 * The body of a top-level rule, e.g. `:root { ... }`. Blocks here are flat.
 *
 * Both ends are asserted. An unfound terminator would make `slice` return the
 * rest of the file, which the "no hex outside the blocks" test then subtracts —
 * so a formatting change could silently turn that test into a no-op. A drift
 * guard that passes wrongly is worse than no guard at all.
 */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block not found in globals.css`).toBeGreaterThan(
    -1,
  );

  const end = CSS.indexOf("\n}", start);
  expect(end, `${selector} block is not terminated by a \\n}`).toBeGreaterThan(
    start,
  );

  return CSS.slice(start, end);
}

const BLOCKS = { light: block(":root"), dark: block(".dark") };

describe("colour tokens", () => {
  test.each(Object.entries(PALETTE))(
    "%s is declared in both modes with the Brand Guide's values",
    (token, expected) => {
      for (const mode of ["light", "dark"] as const) {
        const declaration = new RegExp(`--${token}:\\s*(#[0-9a-f]{3,8});`, "gi");
        const matches = [...BLOCKS[mode].matchAll(declaration)];

        // Exactly one, not at least one: CSS applies the last declaration
        // wins, so a duplicate would let this assert a value the browser never
        // uses. The colon anchors the name, so `--ink:` cannot match
        // `--ink-fg:`.
        expect(
          matches.length,
          `--${token} should be declared exactly once for ${mode}`,
        ).toBe(1);
        expect(matches[0]?.[1]?.toLowerCase()).toBe(expected[mode]);
      }
    },
  );
});

/**
 * "No raw hex values anywhere outside the token definitions." A component says
 * `bg-surface`, never a hex — otherwise one of the two modes is wrong and only
 * one of them gets looked at.
 */
describe("no raw hex outside the token blocks", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
    });
  }

  const HEX = /#[0-9a-f]{3,8}\b/gi;

  test("globals.css declares hex only inside :root and .dark", () => {
    const outside = CSS.replace(BLOCKS.light, "").replace(BLOCKS.dark, "");

    expect(outside.match(HEX)).toBeNull();
  });

  /**
   * `app/manifest.ts` — the one consumer that cannot use a token, FUEL-47.
   *
   * A web app manifest is read by the OPERATING SYSTEM, not by the browser's
   * style engine. There is no `var(--canvas)` to resolve, no stylesheet in
   * scope, and no dark-mode swap to make: the spec takes one literal colour for
   * the splash screen and one for the system bar, and iOS and Android bake them
   * in at install time. A token there would ship the string "var(--canvas)" to
   * the launcher.
   *
   * Exempting it would leave those two values free to drift away from the
   * palette silently, which is the exact failure this whole describe block
   * exists to prevent — so the ban is replaced by a stronger rule rather than
   * lifted. The test below asserts the manifest's two colours ARE the palette's
   * light-mode canvas and ink. Change either token and the manifest goes red
   * until it follows.
   */
  const MANIFEST = join(SRC, "app/manifest.ts");

  test.each(
    walk(SRC).filter(
      (path) => path !== join(SRC, "app/globals.css") && path !== MANIFEST,
    ),
  )("%s uses tokens, not hex", (path) => {
    // This file transcribes the palette by design; it is the fixture the rule
    // is checked against, not a consumer of it.
    if (path === THIS_FILE) return;

    expect(readFileSync(path, "utf8").match(HEX)).toBeNull();
  });

  test("the manifest's literal colours are the palette's, not near it", () => {
    const source = readFileSync(MANIFEST, "utf8");

    const value = (key: string) =>
      source.match(new RegExp(`${key}:\\s*"(#[0-9a-f]{3,8})"`, "i"))?.[1]?.toLowerCase();

    // Light mode, both of them. A manifest has one value for each and the
    // install happens once, so there is no second mode to choose between —
    // and the splash screen an app opens on is the canvas it opens on.
    expect(value("background_color")).toBe(PALETTE.canvas?.light);
    expect(value("theme_color")).toBe(PALETTE.ink?.light);
  });

  test("the manifest declares no other hex", () => {
    // The exemption above is scoped to two known keys. Anything else creeping
    // into that file — an icon tinted by hand, a third colour — is caught here
    // rather than waved through by the filename.
    const found = readFileSync(MANIFEST, "utf8").match(HEX) ?? [];

    expect(found.map((hex) => hex.toLowerCase()).sort()).toEqual(
      [PALETTE.canvas?.light, PALETTE.ink?.light].sort(),
    );
  });
});
