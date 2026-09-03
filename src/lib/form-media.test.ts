import { describe, expect, it } from "vitest";

import {
  creditFor,
  FORM_MEDIA,
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
    expect(resolved?.path).toBe(FORM_MEDIA["side-plank"].path);
    expect(resolved?.kind).toBe("image");
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

  it("trims the description it returns", () => {
    expect(resolveFormMedia(row({ mediaAlt: "  A side plank.  " }))?.alt).toBe(
      "A side plank.",
    );
  });
});

describe("creditFor", () => {
  it("derives an attribution where the licence requires one", () => {
    const asset = FORM_MEDIA["side-plank"];

    expect(LICENCES[asset.licence].requiresAttribution).toBe(true);
    expect(creditFor(asset, null)).toBe("Everkinetic · CC BY-SA 3.0");
  });

  it("prefers an explicit credit over the derived one", () => {
    expect(creditFor(FORM_MEDIA["side-plank"], "Someone else")).toBe("Someone else");
    // Whitespace is not an override; it falls back rather than rendering blank.
    expect(creditFor(FORM_MEDIA["side-plank"], "   ")).toBe("Everkinetic · CC BY-SA 3.0");
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

  it("points every asset at a bundled path and a known kind", () => {
    for (const [key, asset] of Object.entries(FORM_MEDIA)) {
      // Relative into the bundle. Not a URL, not protocol-relative, no traversal
      // — the properties the renderer relies on rather than re-checks.
      expect(asset.path, `${key} path`).toMatch(/^\/form\/[a-z0-9-]+\.(svg|png|webp|avif|mp4)$/);
      expect(MEDIA_KINDS, `${key} kind`).toContain(asset.kind);
      expect(asset.width, `${key} width`).toBeGreaterThan(0);
      expect(asset.height, `${key} height`).toBeGreaterThan(0);
    }
  });
});
