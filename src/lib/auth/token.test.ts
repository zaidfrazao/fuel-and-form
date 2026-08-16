import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sign, verify } from "./token";

/**
 * The request-boundary half of Testing Strategy § 1.4 case 5, at the level of
 * the signature itself: what a forged, tampered, or stale cookie is worth.
 *
 * Hermetic by construction — the module under test takes its secret and its
 * clock as arguments, so this needs no server, no request, and no configured
 * environment. That is why it can be gated at 100% in vitest.config.mts.
 *
 * Every assertion here is `toBeUndefined()` on purpose. A test that merely
 * required "some rejection" would keep passing if a future edit started
 * throwing on a bad signature, and a thrown error is exactly what tells a
 * visitor apart from a forged cookie and no cookie at all. The uniformity of
 * the answer IS the property under test, so it is asserted, not assumed.
 *
 * The secrets below are invented. Nothing real is in this file.
 */

const SECRET = "test-secret-not-a-real-one";
const OTHER_SECRET = "a-different-secret-entirely";

/** A fixed clock. Nothing here reads the wall clock, so nothing here can flake. */
const NOW = Date.UTC(2026, 2, 21, 12, 0, 0);

const HOUR = 60 * 60 * 1000;

const payload = { userId: "8f14e45f-ceea-467a-9b8a-1cbf03c4e2d1", expiresAt: NOW + HOUR };

/**
 * Signs an arbitrary encoded segment the way the module does.
 *
 * This is the forger's tool: it lets a test get PAST the signature check with a
 * payload the module never produced, which is the only way to reach the parse
 * and shape guards behind it. Those guards exist for the case where the secret
 * has leaked, so proving they work requires holding the secret.
 */
const forge = (encoded: string, secret = SECRET) =>
  `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;

/** Encodes a value as the payload segment, whether or not it is a valid one. */
const encodeSegment = (value: unknown) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

describe("sign", () => {
  it("round-trips a payload through verify", () => {
    expect(verify(sign(payload, SECRET), SECRET, NOW)).toEqual(payload);
  });

  it("produces a token safe to put in a cookie value verbatim", () => {
    // base64url and a dot: no padding, no quoting, no percent-encoding. A token
    // needing to be escaped would round-trip through `sign`/`verify` in a test
    // and still break in a browser, where the cookie jar does the escaping.
    expect(sign(payload, SECRET)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("signs rather than encrypts — the payload is readable by whoever holds it", () => {
    // Asserted so the property is deliberate rather than incidental. A user id
    // is not a secret; scope.ts already assumes an attacker may know one. This
    // test is here to fail loudly if anyone later adds something to the payload
    // believing it to be hidden.
    const [encoded] = sign(payload, SECRET).split(".");

    expect(JSON.parse(Buffer.from(encoded, "base64url").toString())).toEqual(payload);
  });
});

describe("verify", () => {
  describe("rejects anything it cannot vouch for, always the same way", () => {
    it("rejects an absent cookie", () => {
      expect(verify(undefined, SECRET, NOW)).toBeUndefined();
    });

    it("rejects an empty cookie", () => {
      expect(verify("", SECRET, NOW)).toBeUndefined();
    });

    it("rejects a value with no signature at all", () => {
      expect(verify(encodeSegment(payload), SECRET, NOW)).toBeUndefined();
    });

    it("rejects a value with more than one separator", () => {
      // `split(".")` would read this as its first two segments and verify a
      // token that was never issued. `indexOf` twice is what refuses it.
      expect(verify(`${sign(payload, SECRET)}.extra`, SECRET, NOW)).toBeUndefined();
    });

    it("rejects a tampered payload", () => {
      const [, signature] = sign(payload, SECRET).split(".");
      const elevated = encodeSegment({ ...payload, userId: "someone-else" });

      expect(verify(`${elevated}.${signature}`, SECRET, NOW)).toBeUndefined();
    });

    it("rejects a tampered signature", () => {
      const [encoded, signature] = sign(payload, SECRET).split(".");
      // Flip one character, keeping the length identical, so what fails is the
      // comparison itself rather than a length check standing in front of it.
      const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);

      expect(verify(`${encoded}.${flipped}`, SECRET, NOW)).toBeUndefined();
    });

    it("rejects a truncated signature without throwing", () => {
      // The case that makes hashing before comparison necessary:
      // `timingSafeEqual` THROWS on unequal lengths, and a throw here would
      // crash the request instead of rejecting the cookie — and would announce,
      // by crashing, that the cookie was malformed rather than merely wrong.
      const [encoded, signature] = sign(payload, SECRET).split(".");

      expect(verify(`${encoded}.${signature.slice(0, 8)}`, SECRET, NOW)).toBeUndefined();
    });

    it("rejects a signature of wildly the wrong length without throwing", () => {
      const [encoded] = sign(payload, SECRET).split(".");

      expect(verify(`${encoded}.x`, SECRET, NOW)).toBeUndefined();
      expect(verify(`${encoded}.${"x".repeat(500)}`, SECRET, NOW)).toBeUndefined();
    });

    it("rejects a token signed with a different secret", () => {
      // Also the rotation path: changing SESSION_SECRET invalidates every live
      // session, which is how a session is revoked when there is no store to
      // delete it from.
      expect(verify(sign(payload, OTHER_SECRET), SECRET, NOW)).toBeUndefined();
    });
  });

  describe("rejects a correctly signed payload it cannot read", () => {
    it("rejects a validly signed segment that is not JSON", () => {
      expect(verify(forge(encodeSegment("not json at all")), SECRET, NOW)).toBeUndefined();
    });

    it("rejects a validly signed JSON value that is not an object", () => {
      expect(verify(forge(encodeSegment(42)), SECRET, NOW)).toBeUndefined();
    });

    it("rejects a validly signed null", () => {
      // `typeof null === "object"`, so this reaches the destructuring guard and
      // would throw there if the null check were dropped.
      expect(verify(forge(encodeSegment(null)), SECRET, NOW)).toBeUndefined();
    });

    it("rejects a validly signed object missing userId", () => {
      expect(verify(forge(encodeSegment({ expiresAt: NOW + HOUR })), SECRET, NOW)).toBeUndefined();
    });

    it("rejects a validly signed empty userId", () => {
      // An empty string is a string. Left unguarded it would reach scope(), and
      // an empty user id matches no row — but "harmless further down" is not a
      // reason to admit it here, where the identity is decided.
      const empty = encodeSegment({ userId: "", expiresAt: NOW + HOUR });

      expect(verify(forge(empty), SECRET, NOW)).toBeUndefined();
    });

    it("rejects a validly signed expiresAt that is not a number", () => {
      // A string expiry would compare against `now` with `<=` and silently
      // never expire.
      const stringy = encodeSegment({ userId: payload.userId, expiresAt: "9999999999999" });

      expect(verify(forge(stringy), SECRET, NOW)).toBeUndefined();
    });
  });

  describe("expiry", () => {
    it("accepts a token one millisecond before it expires", () => {
      expect(verify(sign(payload, SECRET), SECRET, payload.expiresAt - 1)).toEqual(payload);
    });

    it("rejects a token exactly at its expiry", () => {
      // "Expires at" means dead AT that instant, not one millisecond after it.
      expect(verify(sign(payload, SECRET), SECRET, payload.expiresAt)).toBeUndefined();
    });

    it("rejects a long-expired token", () => {
      expect(verify(sign(payload, SECRET), SECRET, payload.expiresAt + HOUR)).toBeUndefined();
    });

    it("rejects an expired token before considering anything else about it", () => {
      // Expiry is checked in this pure module, so it costs no query — the half
      // of "rejected before any query runs" that does not need a database.
      const stale = sign({ userId: payload.userId, expiresAt: NOW - HOUR }, SECRET);

      expect(verify(stale, SECRET, NOW)).toBeUndefined();
    });
  });
});
