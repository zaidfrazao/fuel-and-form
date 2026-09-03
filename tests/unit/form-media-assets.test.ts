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
   * These files are redistributed under CC BY-SA, which permits verbatim copies.
   * An SVG that pulled in a script or an external image would also be a file
   * fetching something at display time from an origin PRD § Integrations says
   * the app does not talk to — so this is two guarantees in one assertion.
   */
  it.each(entries.filter(([, a]) => a.path.endsWith(".svg")))(
    "%s contains no script and no external reference",
    (key, asset) => {
      const svg = readFileSync(path.join(PUBLIC, asset.path.replace(/^\//, ""))).toString("utf8");

      expect(svg, `${key}: <script>`).not.toMatch(/<script/i);
      expect(svg, `${key}: external href`).not.toMatch(/href\s*=\s*"https?:/i);
      expect(svg, `${key}: <image>`).not.toMatch(/<image\b/i);
      expect(svg, `${key}: @import`).not.toMatch(/@import/i);
      expect(svg, `${key}: foreignObject`).not.toMatch(/<foreignObject/i);
    },
  );
});
