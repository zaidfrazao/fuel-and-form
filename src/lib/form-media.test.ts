import { describe, expect, it } from "vitest";

import {
  creditFor,
  FORM_MEDIA,
  type FormMediaAsset,
  type FormMediaColumns,
  LICENCES,
  MEDIA_KINDS,
  resolveFormMedia,
} from "@/lib/form-media";

/** A row with media, which individual tests then break in one way each. */
const row = (over: Partial<FormMediaColumns> = {}): FormMediaColumns => ({
  mediaKey: "side-plank",
  mediaKind: "image",
  mediaAlt: "A side plank, propped on one forearm with the feet stacked.",
  mediaCredit: null,
  ...over,
});

describe("resolveFormMedia", () => {
  it("resolves a complete row against the manifest", () => {
    const resolved = resolveFormMedia(row());

    expect(resolved).not.toBeNull();
    expect(resolved?.frames).toEqual(FORM_MEDIA["side-plank"].frames);
    expect(resolved?.kind).toBe("image");
    // Two of them — a movement, not a still. See FUEL-107.
    expect(resolved?.frames.length).toBeGreaterThanOrEqual(2);
  });

  /*
   * The ticket's criterion, and the reason the column is a key.
   *
   * Not merely "returns null": the assertion is that nothing resembling a path
   * survives. A resolver that passed the stored string through as `path` would
   * satisfy a null check on a DIFFERENT input and still hand an `<img>` an
   * attacker's URL on this one.
   */
  it("refuses a key the manifest does not have, and yields no path at all", () => {
    for (const key of [
      "no-such-exercise",
      "https://evil.example/pixel.gif",
      "//evil.example/pixel.gif",
      "/form/../../etc/passwd",
      "data:image/svg+xml,<svg onload=alert(1)>",
    ]) {
      expect(resolveFormMedia(row({ mediaKey: key }))).toBeNull();
    }
  });

  /*
   * `FORM_MEDIA[key]` on a plain object reaches Object.prototype, and every one
   * of these names returns a truthy FUNCTION from a bare lookup. A resolver
   * testing only for truthiness would then read `.path` off it and pass
   * `undefined` to an `<img>`, which the browser resolves against the current
   * URL — so the failure is a request to the app's own origin, not a visible
   * blank. `Object.hasOwn` is what makes these misses.
   */
  it("refuses inherited Object.prototype keys", () => {
    for (const key of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "__defineGetter__",
    ]) {
      expect(resolveFormMedia(row({ mediaKey: key }))).toBeNull();
    }
  });

  it("refuses a row with no key, which is the ordinary case", () => {
    expect(resolveFormMedia(row({ mediaKey: null }))).toBeNull();
    expect(resolveFormMedia(row({ mediaKey: "   " }))).toBeNull();
  });

  /*
   * § Accessibility: the description is the content, so media without one is
   * not shippable. Whitespace is not a description.
   */
  it("refuses a row whose description is missing or blank", () => {
    expect(resolveFormMedia(row({ mediaAlt: null }))).toBeNull();
    expect(resolveFormMedia(row({ mediaAlt: "   " }))).toBeNull();
  });

  it("refuses a row whose kind disagrees with its asset", () => {
    expect(resolveFormMedia(row({ mediaKind: "video" }))).toBeNull();
  });

  /*
   * A key with no kind is a half-populated row. The database's pairing CHECK
   * forbids it, so the two rules only differ where the CHECK is absent — a
   * partially applied migration, a dump restored from before it, a manual edit.
   * A resolver weaker than the constraint it mirrors would render such a row
   * anyway and the integrity fault would surface somewhere else entirely.
   */
  it("refuses a key with no kind, matching the database's pairing rule", () => {
    expect(resolveFormMedia(row({ mediaKind: null }))).toBeNull();
  });

  it("trims the description it returns", () => {
    expect(resolveFormMedia(row({ mediaAlt: "  A side plank.  " }))?.alt).toBe(
      "A side plank.",
    );
  });
});

describe("creditFor", () => {
  /*
   * A synthetic asset, not a shipped one. Every asset FUEL-107 ships is
   * `unlicense-declared`, which requires no attribution — so testing the
   * attribution path against the manifest would assert nothing today and would
   * start asserting something different the moment a CC BY asset was added.
   */
  const attributed = {
    kind: "image",
    frames: [{ path: "/form/x-1.jpg", width: 1, height: 1, label: "Start" }],
    author: "A Photographer",
    licence: "cc-by-sa-3.0",
    source: "https://example.org/x",
    retrieved: "2026-09-03",
  } as const satisfies FormMediaAsset;

  it("derives an attribution where the licence requires one", () => {
    expect(LICENCES[attributed.licence].requiresAttribution).toBe(true);
    expect(creditFor(attributed, null)).toBe("A Photographer · CC BY-SA 3.0");
  });

  it("prefers an explicit credit over the derived one", () => {
    expect(creditFor(attributed, "Someone else")).toBe("Someone else");
    // Whitespace is not an override; it falls back rather than rendering blank.
    expect(creditFor(attributed, "   ")).toBe("A Photographer · CC BY-SA 3.0");
  });

  /*
   * The shipped case, and the one that matters for what renders: an upstream
   * declaration asks for no attribution, so the sheet shows no credit line
   * rather than inventing one. Naming a creator we cannot identify would be
   * worse than naming none — see `unlicense-declared` in form-media.ts.
   */
  it("renders no credit for an asset whose licence requires none", () => {
    for (const [key, asset] of Object.entries(FORM_MEDIA)) {
      if (LICENCES[asset.licence].requiresAttribution) continue;
      expect(creditFor(asset, null), `${key}`).toBeNull();
    }
  });
});

describe("the manifest", () => {
  /*
   * Criterion 1, asserted rather than reviewed. A licence key that is not in
   * LICENCES cannot be written — `satisfies` catches that at compile time — but
   * a missing author or source is a runtime-shaped gap in the provenance record,
   * and the record is what makes the assets shippable in a public repository.
   */
  it("records complete provenance for every asset", () => {
    for (const [key, asset] of Object.entries(FORM_MEDIA)) {
      expect(asset.author.trim(), `${key} author`).not.toBe("");
      expect(asset.source, `${key} source`).toMatch(/^https:\/\//);
      expect(asset.retrieved, `${key} retrieved`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(LICENCES[asset.licence], `${key} licence`).toBeDefined();
    }
  });

  it("points every frame at a bundled path and a known kind", () => {
    for (const [key, asset] of Object.entries(FORM_MEDIA)) {
      expect(MEDIA_KINDS, `${key} kind`).toContain(asset.kind);

      for (const [i, frame] of asset.frames.entries()) {
        // Relative into the bundle. Not a URL, not protocol-relative, no
        // traversal — the properties the renderer relies on rather than
        // re-checks.
        expect(frame.path, `${key} frame ${i} path`).toMatch(
          /^\/form\/[a-z0-9-]+\.(jpg|svg|png|webp|avif|mp4)$/,
        );
        expect(frame.width, `${key} frame ${i} width`).toBeGreaterThan(0);
        expect(frame.height, `${key} frame ${i} height`).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Provenance honesty, asserted. FUEL-107 ships on an upstream declaration the
   * project does not fully believe; the mitigation is that every such asset says
   * so. An entry that claimed a real author under this licence key would be the
   * one that quietly makes the risk invisible again.
   */
  it("names no author for an asset whose provenance ends at a declaration", () => {
    for (const [key, asset] of Object.entries(FORM_MEDIA)) {
      if (asset.licence !== "unlicense-declared") continue;
      expect(asset.author, `${key}`).toBe("Not documented upstream");
    }
  });
});
