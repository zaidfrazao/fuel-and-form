import { describe, expect, it } from "vitest";

import { constantTimeEquals } from "./compare";

/**
 * The comparison behind both the cookie signature and the owner's password.
 *
 * Timing itself is not asserted here — a wall-clock assertion on a hashed
 * comparison is a flaky test that measures the CI runner, not the code. What
 * IS asserted is the property that makes constant time achievable: that no
 * input, of any length, sends this down a different path or out through a
 * throw. The `timingSafeEqual` length throw is the specific bug this file
 * exists to keep closed.
 *
 * Every value here is invented.
 */

describe("constantTimeEquals", () => {
  it("is true for identical values", () => {
    expect(constantTimeEquals("correct horse battery", "correct horse battery")).toBe(true);
  });

  it("is false for values differing in one character", () => {
    expect(constantTimeEquals("correct horse battery", "correct horse batterY")).toBe(false);
  });

  it("is false for values sharing a long prefix", () => {
    // The shape a character-by-character guess takes. It must be worth no more
    // than a wild one, which is what constant time buys.
    expect(constantTimeEquals("s3cret-value-here", "s3cret-value-herf")).toBe(false);
  });

  it("is false for values sharing nothing", () => {
    expect(constantTimeEquals("abc", "xyz")).toBe(false);
  });

  describe("does not throw on mismatched lengths", () => {
    // `timingSafeEqual` throws rather than returning false when its buffers
    // differ in length. Every case below would crash without the hash step —
    // and crash only for wrong-length input, which is itself a length oracle.

    it("handles a much shorter guess", () => {
      expect(constantTimeEquals("a", "a-considerably-longer-secret")).toBe(false);
    });

    it("handles a much longer guess", () => {
      expect(constantTimeEquals("x".repeat(10_000), "short")).toBe(false);
    });

    it("handles an empty guess", () => {
      expect(constantTimeEquals("", "not-empty")).toBe(false);
    });

    it("handles an empty expected value", () => {
      expect(constantTimeEquals("not-empty", "")).toBe(false);
    });

    it("calls two empty strings equal", () => {
      // Degenerate but worth pinning: it means an unset secret compared against
      // empty input would MATCH. `requireEnv` is what stops an empty
      // OWNER_PASSWORD ever reaching here, and this records why that matters.
      expect(constantTimeEquals("", "")).toBe(true);
    });
  });

  it("is unaffected by argument order", () => {
    expect(constantTimeEquals("alpha", "beta")).toBe(constantTimeEquals("beta", "alpha"));
    expect(constantTimeEquals("same", "same")).toBe(constantTimeEquals("same", "same"));
  });

  it("compares by exact bytes, not by normalised text", () => {
    // "é" precomposed versus "e" + combining accent: the same string to a human
    // and to some database collations, different secrets here. Anything that
    // started normalising input would make two different passwords equivalent.
    expect(constantTimeEquals("café", "café")).toBe(false);
  });
});
