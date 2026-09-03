import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORM_MEDIA, type MediaFrame } from "@/lib/form-media";

/**
 * The manifest against the files it describes — § P10, FUEL-94, FUEL-107.
 *
 * `form-media.test.ts` checks the manifest's SHAPE. This checks that it is true:
 * that every declared frame is a file which exists, and that the width and
 * height beside it are the file's own.
 *
 * Worth a test rather than trusting the entries, because the failure is silent
 * in both directions. A path typo renders a broken image, which no unit test
 * using jsdom can see — jsdom does not fetch. And a wrong width or height
 * reserves the wrong box, which is layout shift in the sheet: nothing throws,
 * nothing logs, and the only symptom is a Lighthouse number moving on the screen
 * FUEL-52 measures. With two frames per exercise it would happen twice.
 *
 * It also enforces the per-file budget, so a later asset dropped in oversized
 * fails here rather than being noticed in a pack size months afterwards, by
 * which point the history holds it either way.
 */

const PUBLIC = path.join(process.cwd(), "public");

/** The budget: ≤150KB for a still, ≤400KB for a clip. */
const BUDGET = { image: 150 * 1024, video: 400 * 1024 } as const;

/**
 * A file's intrinsic size, read from its own header.
 *
 * Deliberately not a dependency. Each format puts its dimensions in a fixed
 * place near the head of the file, and the alternative is an image library in
 * `devDependencies` to read a handful of bytes.
 */
function intrinsicSize(file: Buffer, ext: string): { width: number; height: number } | null {
  if (ext === ".png") {
    // IHDR is the first chunk: 8-byte signature, 4-byte length, 4-byte type,
    // then width and height as big-endian uint32.
    if (file.length < 24) return null;
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
  }

  if (ext === ".jpg" || ext === ".jpeg") {
    // Walk the marker segments to the start-of-frame, which carries the size.
    // SOF0–SOF15 are 0xFFC0–0xFFCF except C4 (Huffman), C8 (JPG extension) and
    // CC (arithmetic coding), none of which is a frame header.
    let i = 2;
    while (i + 9 < file.length) {
      if (file[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = file[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: file.readUInt16BE(i + 5), width: file.readUInt16BE(i + 7) };
      }
      i += 2 + file.readUInt16BE(i + 2);
    }
    return null;
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

const read = (frame: MediaFrame) =>
  readFileSync(path.join(PUBLIC, frame.path.replace(/^\//, "")));

/** Every frame of every asset, flattened, so each is its own test case. */
const FRAMES = Object.entries(FORM_MEDIA).flatMap(([key, asset]) =>
  asset.frames.map((frame, index) => ({
    name: `${key} frame ${index + 1}`,
    kind: asset.kind,
    frame,
  })),
);

describe("the form media manifest against the bundle", () => {
  it("ships assets, or every test below passes vacuously", () => {
    expect(Object.keys(FORM_MEDIA).length).toBeGreaterThan(0);
    expect(FRAMES.length).toBeGreaterThan(0);
  });

  /*
   * Two frames, not one — FUEL-107. A single still cannot show a movement, which
   * is the whole reason the drawings were replaced. An asset that arrives with
   * one frame is a regression to the thing that did not work.
   */
  it.each(Object.entries(FORM_MEDIA))("%s shows at least two frames", (_key, asset) => {
    expect(asset.frames.length).toBeGreaterThanOrEqual(2);
  });

  it.each(FRAMES)("$name exists, is sized as declared, and is within budget", ({ kind, frame }) => {
    const file = read(frame);

    expect(file.length, "empty file").toBeGreaterThan(0);
    expect(file.length, `exceeds the ${kind} budget`).toBeLessThanOrEqual(BUDGET[kind]);

    const size = intrinsicSize(file, path.extname(frame.path));
    expect(size, "could not read a size from the file").not.toBeNull();
    expect({ width: size!.width, height: size!.height }).toEqual({
      width: frame.width,
      height: frame.height,
    });
  });

  it.each(FRAMES)("$name carries a label", ({ frame }) => {
    // The label is rendered under the photograph, so a blank one is a caption
    // slot drawn empty rather than an absent caption.
    expect(frame.label.trim()).not.toBe("");
  });

  /*
   * Third-party SVG, served from the app's own origin. An ALLOWLIST, not a
   * denylist — and the difference is the point of the test.
   *
   * FUEL-107 ships photographs, so this currently guards nothing. It is kept
   * because `public/` will serve whatever is put in it at its own URL: rendered
   * through `<img>` an SVG is inert, but `/form/x.svg` can be NAVIGATED to, and
   * an SVG loaded as a document executes handlers on this app's origin. The
   * guard belongs to the directory, not to the assets that happen to be in it
   * today — and a test that only exists while it has work to do is a test that
   * is absent on the commit that needs it.
   *
   * A denylist would only refuse what somebody thought of; the author of the
   * next asset is not required to have thought of anything.
   */
  const SVG_ELEMENTS = new Set(["svg", "g", "path", "title", "desc"]);
  const svgFrames = FRAMES.filter((f) => f.frame.path.endsWith(".svg"));

  it.skipIf(svgFrames.length === 0).each(svgFrames)(
    "$name uses only inert drawing elements and carries no handler",
    ({ frame }) => {
      const svg = read(frame).toString("utf8");

      const used = [...svg.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)].map((m) => m[1]!.toLowerCase());
      expect([...new Set(used)].filter((tag) => !SVG_ELEMENTS.has(tag))).toEqual([]);

      // A processing instruction is not an element, so the allowlist is blind to
      // it: `<?xml-stylesheet href="…"?>` sits before the root and pulls a
      // stylesheet into the document on this app's origin.
      expect(svg, "XML processing instruction").not.toMatch(/<\?/);
      expect(svg, "inline event handler").not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg, "javascript: URL").not.toMatch(/javascript\s*:/i);
      expect(svg, "DOCTYPE or ENTITY").not.toMatch(/<!(DOCTYPE|ENTITY)/i);
      expect(svg, "external reference").not.toMatch(
        /(href|src)\s*=\s*["']?\s*(https?|data|\/\/)/i,
      );
    },
  );
});
