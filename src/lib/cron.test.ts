import { describe, expect, it } from "vitest";

import { isAuthorizedCron } from "./cron";

/**
 * The gate on the one route in this app that deletes rows — FUEL-42, § P7.
 *
 * `vercel.json` publishes the reaper's path in a public repository, so the
 * bearer token is the whole of the difference between the platform's scheduler
 * and a stranger with curl. Every branch below is a rejection, and a rejection
 * that stops working is silent: the job keeps running on schedule and nothing
 * anywhere reports that it also runs for anyone who asks.
 *
 * Timing is not asserted, for the reason compare.test.ts gives — a wall-clock
 * assertion measures the runner. What is asserted is that no input takes a
 * different path out, including the ones that would be tempting to
 * short-circuit.
 *
 * Every secret here is invented.
 */

const SECRET = "kc4Qh4mM1sPjxq7dVJ4C9Yz2R0aGm5tw";

describe("isAuthorizedCron", () => {
  it("accepts the secret under the Bearer scheme", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("accepts a lower-case scheme", () => {
    // RFC 7235 makes the scheme case-insensitive, so a proxy that normalises it
    // has not invalidated the credential.
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(true);
  });

  describe("refuses", () => {
    it("a wrong secret", () => {
      expect(isAuthorizedCron("Bearer not-the-secret", SECRET)).toBe(false);
    });

    it("a secret sharing a long prefix", () => {
      // What a byte-at-a-time guess looks like. It must be worth no more than a
      // wild guess — which is what the constant-time comparison buys, and what
      // an `===` here would give away.
      expect(isAuthorizedCron(`Bearer ${SECRET.slice(0, -1)}x`, SECRET)).toBe(false);
    });

    it("a missing header", () => {
      expect(isAuthorizedCron(null, SECRET)).toBe(false);
    });

    it("an undefined header", () => {
      expect(isAuthorizedCron(undefined, SECRET)).toBe(false);
    });

    it("an empty header", () => {
      expect(isAuthorizedCron("", SECRET)).toBe(false);
    });

    it("the secret with no scheme in front of it", () => {
      expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    });

    it("another scheme carrying the right secret", () => {
      expect(isAuthorizedCron(`Basic ${SECRET}`, SECRET)).toBe(false);
    });

    it("the scheme with nothing after it", () => {
      expect(isAuthorizedCron("Bearer", SECRET)).toBe(false);
    });

    it("the scheme with an empty token after it", () => {
      expect(isAuthorizedCron("Bearer ", SECRET)).toBe(false);
    });

    it("a prefix of the secret followed by a space", () => {
      // The reason the token is rejoined rather than read as the first word.
      // Taking `rest[0]` would compare `kc4Qh4mM1sPjxq7dVJ4C9Yz2R0aGm5tw` here
      // and authorise it — a credential nobody issued.
      expect(isAuthorizedCron(`Bearer ${SECRET} extra`, SECRET)).toBe(false);
    });
  });

  describe("with no secret configured", () => {
    // The failure this closes: a deployment where CRON_SECRET resolved to an
    // empty string, and an endpoint that deletes rows answers to anyone sending
    // an empty token. `cronSecret()` throws before this is reachable in the
    // app; the refusal is here as well because a gate should not depend on its
    // caller having checked.

    it("refuses an empty token against an empty secret", () => {
      expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    });

    it("refuses a real-looking token against an empty secret", () => {
      expect(isAuthorizedCron(`Bearer ${SECRET}`, "")).toBe(false);
    });

    it("refuses a missing header against an empty secret", () => {
      expect(isAuthorizedCron(null, "")).toBe(false);
    });
  });
});
