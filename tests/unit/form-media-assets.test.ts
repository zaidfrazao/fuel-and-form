import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORM_MEDIA } from "@/lib/form-media";

/**
 * The manifest against the files it describes — § P10, FUEL-94.
 *
 * `form-media.test.ts` checks the manifest's SHAPE. This checks that it is true:
 * that every declared path is a file which exists, and that the width and height
 * beside it are the file's own.
 *
 * Worth a test rather than trusting the entry, because the failure is silent in
 * both directions. A path typo renders a broken image, which no unit test using
 * jsdom can see — jsdom does not fetch. And a wrong width or height reserves the
 * wrong box, which is layout shift in the sheet: nothing throws, nothing logs,
 * and the only symptom is a Lighthouse number moving on the screen FUEL-52
 * measures.
 *
 * It also does the work of the budget FUEL-94 set. A later asset dropped in over
 * the per-file cap fails here rather than being noticed in a pack size months
 * afterwards, by which point the history holds it either way.
 */

const PUBLIC = path.join(process.cwd(), "public");

/** The ticket's budget: ≤150KB for a still, ≤400KB for a clip. */
const BUDGET = { image: 150 * 1024, video: 400 * 1024 } as const;

/**
 * An SVG's declared size, or a PNG's from its IHDR.
 *
 * Deliberately not a dependency. Both formats put their dimensions in a fixed
 * place near the head of the file, and the alternative is an image library in
 * `devDependencies` to read sixteen bytes.
 */
function intrinsicSize(file: Buffer, ext: string): { width: number; height: number } | null {
  if (ext === ".png") {
    // IHDR is the first chunk: 8-byte signature, 4-byte length, 4-byte type,
    // then width and height as big-endian uint32.
    if (file.length < 24) return null;
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
  }

  if (ext === ".svg") {
    const head = file.subarray(0, 2048).toString("utf8");
    const width = head.match(/\bwidth="([\d.]+)"/)?.[1];
    const height = head.match(/\bheight="([\d.]+)"/)?.[1];
    if (!width || !height) return null;
    return { width: Math.round(Number(width)), height: Math.round(Number(height)) };
  }

  return null;
}

describe("the form media manifest against the bundle", () => {
  const entries = Object.entries(FORM_MEDIA);

  it("ships at least one asset, or every test below passes vacuously", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s exists, is sized as declared, and is within budget", (key, asset) => {
    const file = readFileSync(path.join(PUBLIC, asset.path.replace(/^\//, "")));

    expect(file.length, `${key} is empty`).toBeGreaterThan(0);
    expect(file.length, `${key} exceeds the ${asset.kind} budget`).toBeLessThanOrEqual(
      BUDGET[asset.kind],
    );

    const size = intrinsicSize(file, path.extname(asset.path));
    expect(size, `${key}: could not read a size from the file`).not.toBeNull();
    expect({ width: size!.width, height: size!.height }).toEqual({
      width: asset.width,
      height: asset.height,
    });
  });

  /*
   * Third-party SVG, served from the app's own origin. An ALLOWLIST, not a
   * denylist — and the difference is the whole point of the test.
   *
   * ## Why this is stricter than "no <script>"
   *
   * The component renders these through `<img>`, which browsers treat as a
   * secure static context: scripts do not run and external fetches are blocked.
   * That is not the exposure. The exposure is that `public/` serves them at
   * their own URL, so `/form/side-plank.svg` can be NAVIGATED to — and an SVG
   * loaded as a document is a document, where a script or an `onload` handler
   * executes on this app's origin, against this app's cookies.
   *
   * The first draft of this test listed the things not to have: `<script>`, an
   * external `href`, `<image>`, `@import`, `foreignObject`. It would have passed
   * a file carrying `<svg onload="…">` or an `xlink:href="javascript:…"`,
   * neither of which is exotic. A denylist can only refuse what somebody thought
   * of, and the author of the next asset is not required to have thought of
   * anything.
   *
   * So the shape is inverted. These are line drawings: `<svg>`, `<g>` and
   * `<path>` is the entire vocabulary they need, plus the two accessible-text
   * elements. Anything else fails, whether or not it is dangerous — which also
   * catches a well-meaning asset that arrives with an embedded raster or a
   * stylesheet, and is why the assertion prints what it found.
   */
  const SVG_ELEMENTS = new Set(["svg", "g", "path", "title", "desc"]);

  it.each(entries.filter(([, a]) => a.path.endsWith(".svg")))(
    "%s uses only inert drawing elements and carries no handler",
    (key, asset) => {
      const svg = readFileSync(path.join(PUBLIC, asset.path.replace(/^\//, ""))).toString("utf8");

      const used = [...svg.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)].map((m) => m[1]!.toLowerCase());
      const unexpected = [...new Set(used)].filter((tag) => !SVG_ELEMENTS.has(tag));
      expect(unexpected, `${key}: unexpected elements`).toEqual([]);

      /*
       * A processing instruction is not an element, so the allowlist above is
       * blind to it — `<?xml-stylesheet href="…"?>` sits before the root and
       * pulls a stylesheet into the document, on this app's origin, when the
       * file is navigated to. It is the one vector that survives an element
       * check, which is why it gets its own assertion rather than being folded
       * into the reference test below.
       */
      expect(svg, `${key}: XML processing instruction`).not.toMatch(/<\?/);

      // Attribute-level vectors, which no element allowlist can see.
      expect(svg, `${key}: inline event handler`).not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg, `${key}: javascript: URL`).not.toMatch(/javascript\s*:/i);
      // A DOCTYPE is the door to entity expansion; these files need neither.
      expect(svg, `${key}: DOCTYPE or ENTITY`).not.toMatch(/<!(DOCTYPE|ENTITY)/i);
      // Any scheme-bearing reference at all — the drawings reference nothing.
      expect(svg, `${key}: external reference`).not.toMatch(/(href|src)\s*=\s*["']?\s*(https?|data|\/\/)/i);
    },
  );
});
