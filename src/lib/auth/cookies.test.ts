import { afterEach, describe, expect, it, vi } from "vitest";

import { COOKIE, LIFETIME, cookieOptions } from "./cookies";

/**
 * The cookie flags the PRD names in § Security & Compliance.
 *
 * These are the sort of property that is easy to write once, easy to lose in a
 * later edit, and invisible when lost — a cookie missing `httpOnly` behaves
 * identically until the day someone reads it from script. Asserting them keeps
 * them from being merely intended.
 *
 * `NODE_ENV` is stubbed rather than read, because the interesting case is the
 * one this suite does NOT run in: the test process is not `development`, so
 * without stubbing, the development branch would never be measured and the
 * coverage gate would pass while the only conditional here went unchecked.
 */

const expiry = new Date("2026-09-01T00:00:00.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cookieOptions", () => {
  it("is HttpOnly, so script cannot read the session", () => {
    // The flag that makes an XSS unable to lift the cookie. Verified in a real
    // browser too, but asserted here so it cannot regress unnoticed.
    expect(cookieOptions(expiry).httpOnly).toBe(true);
  });

  it("is SameSite=Lax, which is what stands in for CSRF tokens here", () => {
    expect(cookieOptions(expiry).sameSite).toBe("lax");
  });

  it("covers the whole app", () => {
    // A narrower path would sign the user out on routes it did not cover, with
    // no error to explain why.
    expect(cookieOptions(expiry).path).toBe("/");
  });

  it("carries the expiry it was given", () => {
    expect(cookieOptions(expiry).expires).toEqual(expiry);
  });

  describe("secure", () => {
    it("is set in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      expect(cookieOptions(expiry).secure).toBe(true);
    });

    it("is set in test", () => {
      // Named explicitly: the deviation below is for `next dev` only, and a
      // future edit widening it to "not production" would fail here.
      vi.stubEnv("NODE_ENV", "test");

      expect(cookieOptions(expiry).secure).toBe(true);
    });

    it("is off in development, where a Secure cookie would be silently dropped", () => {
      // The whole of the deviation, in one assertion. `next dev` serves over
      // http://localhost, where a browser discards a Secure cookie with no
      // error — login would appear to work and simply not.
      vi.stubEnv("NODE_ENV", "development");

      expect(cookieOptions(expiry).secure).toBe(false);
    });
  });
});

describe("COOKIE", () => {
  it("gives each kind of session its own name", () => {
    // The names must differ: the kind is carried BY the name, and resolve.ts
    // checks `users.kind` against it. One shared name would make the two
    // sessions the same cookie and the check meaningless.
    expect(COOKIE.owner).not.toBe(COOKIE.demo);
  });

  it("namespaces both, so nothing else on the origin collides", () => {
    expect(COOKIE.owner).toMatch(/^ff_/);
    expect(COOKIE.demo).toMatch(/^ff_/);
  });
});

describe("LIFETIME", () => {
  it("keeps a demo session far shorter than the owner's", () => {
    // A demo is a visit, not an account. This is also the cookie-side half of
    // the expiry FUEL-40 will write to `users.expires_at`.
    expect(LIFETIME.demo).toBeLessThan(LIFETIME.owner);
  });

  it("is stated in milliseconds, the unit Date arithmetic uses", () => {
    // Pinned because the failure mode of getting this wrong is a session that
    // expires in two seconds or in eighty-three years, neither of which looks
    // like a bug in a diff.
    expect(LIFETIME.owner).toBe(30 * 24 * 60 * 60 * 1000);
    expect(LIFETIME.demo).toBe(2 * 60 * 60 * 1000);
  });
});
