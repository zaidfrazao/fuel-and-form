import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BANNER_COPY,
  DEMO_BANNER_COOKIE,
  demoBannerCookieOptions,
  isBannerDismissed,
  REPOSITORY_URL,
} from "./demo-banner";

/**
 * The banner's copy and the cookie that hides it — FUEL-42, § P7.
 *
 * Three things are asserted here that nothing else in the suite can hold still:
 *
 *   - the SENTENCE, character for character. § UI Copy pairs it with what it
 *     must not become, and voice is the kind of thing that erodes one friendly
 *     edit at a time. A string nobody asserts is where that starts.
 *   - the cookie FLAGS, which only a real browser otherwise exercises — losing
 *     `httpOnly` or `path` looks identical until someone reads the cookie, or
 *     until the banner comes back on the next screen.
 *   - that a value a stranger controls can never throw, because this is read
 *     from the root layout and a throw there is a 500 on every screen.
 *
 * The user ids below are invented.
 */

const USER_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_USER_ID = "99999999-8888-7777-6666-555555555555";

describe("the copy", () => {
  it("is the Brand Guide's sentence, exactly", () => {
    expect(`${BANNER_COPY.statement} ${BANNER_COPY.link}`).toBe(
      "Demo session — your changes are temporary. View the source.",
    );
  });

  it("has no exclamation mark, welcome or emoji", () => {
    // § Content Guidelines: "Use exclamation marks. Anywhere." is under Don't,
    // and the table's avoided example is "Welcome to the demo! Feel free to
    // explore! 👋". Asserted as a property rather than only by the string above
    // so that a rewrite has to break this deliberately.
    const sentence = `${BANNER_COPY.statement} ${BANNER_COPY.link}`;

    expect(sentence).not.toMatch(/[!]/);
    expect(sentence.toLowerCase()).not.toContain("welcome");
    expect(sentence).toMatch(/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u);
  });

  it("points at the repository", () => {
    expect(REPOSITORY_URL).toBe("https://github.com/zaidfrazao/fuel-and-form");
  });
});

describe("isBannerDismissed", () => {
  it("is true for the session it was dismissed for", () => {
    expect(isBannerDismissed(USER_ID, USER_ID)).toBe(true);
  });

  it("is false for a different session", () => {
    // The reason the cookie holds an id rather than a flag: the next visit is a
    // new account whose changes are newly temporary, and it must be told so.
    expect(isBannerDismissed(OTHER_USER_ID, USER_ID)).toBe(false);
  });

  it("is false with no cookie", () => {
    expect(isBannerDismissed(undefined, USER_ID)).toBe(false);
  });

  it("is false for an empty cookie", () => {
    // An empty value must not match an empty id. Reachable only through a
    // malformed cookie, and the failure would be a banner that never shows.
    expect(isBannerDismissed("", "")).toBe(false);
  });

  describe("does not throw on anything a browser can hold", () => {
    // Every case here is reachable by editing a cookie by hand. This value is
    // read from the ROOT layout, so a throw is a 500 on every screen in the app
    // rather than on one of them.

    it("handles junk", () => {
      expect(isBannerDismissed("}{not-a-uuid", USER_ID)).toBe(false);
    });

    it("handles a very long value", () => {
      expect(isBannerDismissed("x".repeat(10_000), USER_ID)).toBe(false);
    });

    it("handles a value that merely contains the id", () => {
      expect(isBannerDismissed(`${USER_ID} `, USER_ID)).toBe(false);
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demoBannerCookieOptions", () => {
  it("travels in ff_demo_banner", () => {
    expect(DEMO_BANNER_COOKIE).toBe("ff_demo_banner");
  });

  it("is unreadable by script", () => {
    expect(demoBannerCookieOptions().httpOnly).toBe(true);
  });

  it("covers every screen", () => {
    // A narrower path would mean dismissing it on /plan and finding it back
    // on /, which reads as a broken button rather than as a scoped cookie.
    expect(demoBannerCookieOptions().path).toBe("/");
  });

  it("is not sent on cross-site POSTs", () => {
    expect(demoBannerCookieOptions().sameSite).toBe("lax");
  });

  it("carries no expiry", () => {
    // Deliberate: the value names the account, so a cookie from an ended
    // session is already inert. An `expires` would be a second, weaker copy of
    // that rule — see the note in demo-banner.ts.
    expect(demoBannerCookieOptions()).not.toHaveProperty("expires");
  });

  it("is https-only in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(demoBannerCookieOptions().secure).toBe(true);
  });

  it("is https-only in test", () => {
    // Named explicitly, as cookies.test.ts names it: the deviation below is for
    // `next dev` only, and a future edit widening it to "not production" would
    // fail here rather than ship a cookie sent over plain http in CI.
    vi.stubEnv("NODE_ENV", "test");

    expect(demoBannerCookieOptions().secure).toBe(true);
  });

  it("is not https-only in development", () => {
    // A browser silently DISCARDS a Secure cookie over http://localhost, so on
    // `next dev` the dismissal would never stick and the button would look
    // broken with no error anywhere.
    vi.stubEnv("NODE_ENV", "development");

    expect(demoBannerCookieOptions().secure).toBe(false);
  });
});
