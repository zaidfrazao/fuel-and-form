import { describe, expect, it } from "vitest";

import { LIFETIME } from "./auth/cookies";
import {
  DEMO_LIMITS,
  decideProvisioning,
  demoExpiry,
  hashClientIp,
  type ProvisioningLimits,
  rateLimitWindowStart,
} from "./demo";

/**
 * FUEL-40's refusals — the trust boundary of the one endpoint that needs no
 * credentials at all.
 *
 * Everything else in this app writes rows for someone who has already proved
 * who they are. Provisioning writes about two hundred rows for anyone who can
 * POST, which is why P7 asks for it to be "rate-limited, so crawlers cannot
 * mass-create sessions" and why every branch below is a refusal.
 *
 * The failure mode being guarded is silence, as it is in `repeat.test.ts` and
 * `weigh-in.test.ts`. A limit that is off by one does not throw and does not
 * look wrong on any screen: it is a fourth session for every three allowed,
 * forever, discovered when the database is full.
 *
 * Both secrets here are invented and local to this file.
 */

/** Halved and doubled from the shipped values, so no test can pass by matching them. */
const LIMITS: ProvisioningLimits = {
  client: { max: 2, windowMs: 5 * 60 * 1000 },
  concurrent: 4,
};

const SECRET = "unit-secret-not-a-real-one";

/** Nothing has been provisioned. The baseline every case varies one field from. */
const QUIET = { recentForClient: 0, liveSessions: 0 };

describe("who may provision a session", () => {
  it("allows a client that has provisioned nothing, on a quiet site", () => {
    // Non-empty first: every other case here asserts a refusal, and a function
    // that refused everything would satisfy all of them.
    expect(decideProvisioning(QUIET, LIMITS)).toEqual({ allowed: true });
  });

  it("allows a client one under its maximum", () => {
    expect(decideProvisioning({ ...QUIET, recentForClient: 1 }, LIMITS)).toEqual({
      allowed: true,
    });
  });

  it("refuses a client sitting exactly on its maximum", () => {
    // The boundary the whole limit turns on. The count is what has ALREADY
    // happened, so a client at its maximum has spent it — `>` rather than `>=`
    // here would hand out one extra session per window and nothing would say so.
    expect(decideProvisioning({ ...QUIET, recentForClient: 2 }, LIMITS)).toEqual({
      allowed: false,
      refusal: "rate-limited",
    });
  });

  it("refuses a client past its maximum", () => {
    expect(decideProvisioning({ ...QUIET, recentForClient: 9 }, LIMITS)).toEqual({
      allowed: false,
      refusal: "rate-limited",
    });
  });

  it("allows one more session when the site is one under capacity", () => {
    expect(decideProvisioning({ ...QUIET, liveSessions: 3 }, LIMITS)).toEqual({
      allowed: true,
    });
  });

  it("refuses when the site is exactly at capacity", () => {
    expect(decideProvisioning({ ...QUIET, liveSessions: 4 }, LIMITS)).toEqual({
      allowed: false,
      refusal: "at-capacity",
    });
  });

  it("refuses when the site is over capacity", () => {
    // Reachable: the counts are read outside the transaction that writes, so
    // two provisions can race past the same reading. The overshoot must refuse
    // rather than fall through a `=== capacity` comparison.
    expect(decideProvisioning({ ...QUIET, liveSessions: 5 }, LIMITS)).toEqual({
      allowed: false,
      refusal: "at-capacity",
    });
  });

  it("blames the client's own allowance when both walls are hit at once", () => {
    // The ordering, asserted rather than left to reading order. Both answers
    // are true here; only one of them tells the visitor that waiting two
    // minutes is enough. Swapping the two checks would pass every other case
    // in this file.
    expect(
      decideProvisioning({ recentForClient: 2, liveSessions: 4 }, LIMITS),
    ).toEqual({ allowed: false, refusal: "rate-limited" });
  });

  it("uses the shipped limits when none are given", () => {
    // The default argument, which is what the app actually runs on — an
    // untested default is a limit nobody checked.
    expect(
      decideProvisioning({ recentForClient: DEMO_LIMITS.client.max, liveSessions: 0 }),
    ).toEqual({ allowed: false, refusal: "rate-limited" });

    expect(
      decideProvisioning({ recentForClient: 0, liveSessions: DEMO_LIMITS.concurrent }),
    ).toEqual({ allowed: false, refusal: "at-capacity" });

    expect(decideProvisioning(QUIET)).toEqual({ allowed: true });
  });
});

describe("the client bucket", () => {
  it("gives one client the same value every time", () => {
    // The counting is a `where ip_hash = $1`. An unstable digest would give
    // every request its own bucket, which is a limit that never fires.
    expect(hashClientIp("203.0.113.7", SECRET)).toBe(hashClientIp("203.0.113.7", SECRET));
  });

  it("gives two clients different values", () => {
    expect(hashClientIp("203.0.113.7", SECRET)).not.toBe(
      hashClientIp("203.0.113.8", SECRET),
    );
  });

  it("stores no address", () => {
    // The point of the column. base64url of an HMAC, with nothing of the input
    // left in it — this repository is public and P7's subject is what does not
    // reach it.
    const hash = hashClientIp("203.0.113.7", SECRET);

    expect(hash).not.toContain("203");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("gives a different value under a different key", () => {
    // What "keyed" buys: four billion IPv4 addresses is minutes of hashing, so
    // an unkeyed digest is reversible. It also means one deployment's column
    // cannot be lined up against another's.
    expect(hashClientIp("203.0.113.7", SECRET)).not.toBe(
      hashClientIp("203.0.113.7", "a-different-secret"),
    );
  });

  it("reads the client from the first entry, not the proxies after it", () => {
    // `x-forwarded-for` grows by one hop per proxy. Taking the last entry — or
    // the whole string — would bucket every visitor behind one proxy together,
    // so the first of them to click would spend everyone's allowance.
    expect(hashClientIp("203.0.113.7, 198.51.100.2, 198.51.100.9", SECRET)).toBe(
      hashClientIp("203.0.113.7", SECRET),
    );
  });

  it("ignores the whitespace a proxy leaves after its comma", () => {
    expect(hashClientIp("  203.0.113.7  ", SECRET)).toBe(hashClientIp("203.0.113.7", SECRET));
  });

  it("reads one IPv6 address as one client whatever case it arrives in", () => {
    // Hexadecimal has two spellings and two hops may disagree. Unnormalised
    // they are two buckets, which is two allowances for one visitor.
    expect(hashClientIp("2001:DB8::1", SECRET)).toBe(hashClientIp("2001:db8::1", SECRET));
  });

  it("still produces a bucket when there is no header at all", () => {
    // `next dev` sets nothing. Returning early instead would disable the limit
    // for exactly the caller that declined to identify itself.
    expect(hashClientIp(undefined, SECRET)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashClientIp(null, SECRET)).toBe(hashClientIp(undefined, SECRET));
  });

  it("puts every unidentifiable client in ONE bucket, so the limit still bites", () => {
    expect(hashClientIp("", SECRET)).toBe(hashClientIp(undefined, SECRET));
    expect(hashClientIp("   ", SECRET)).toBe(hashClientIp(undefined, SECRET));
    expect(hashClientIp(",", SECRET)).toBe(hashClientIp(undefined, SECRET));
  });
});

describe("when a session runs out", () => {
  const NOW = Date.UTC(2026, 7, 25, 9, 0, 0);

  it("expires exactly one demo lifetime after it was provisioned", () => {
    expect(demoExpiry(NOW).getTime()).toBe(NOW + LIFETIME.demo);
  });

  it("takes its lifetime from the cookie's own constant", () => {
    // Restating the two hours here rather than importing them is how the row
    // and the cookie drift apart — and a cookie outliving its row is a session
    // that resolves to nothing, which looks like a bug in the app rather than
    // an expiry.
    expect(demoExpiry(NOW).getTime() - NOW).toBe(LIFETIME.demo);
  });
});

describe("the rate-limit window", () => {
  const NOW = Date.UTC(2026, 7, 25, 9, 0, 0);

  it("opens one window before now", () => {
    expect(rateLimitWindowStart(NOW, LIMITS).getTime()).toBe(NOW - LIMITS.client.windowMs);
  });

  it("uses the shipped window when none is given", () => {
    expect(rateLimitWindowStart(NOW).getTime()).toBe(NOW - DEMO_LIMITS.client.windowMs);
  });

  it("opens before it closes", () => {
    // A sign error here inverts the query's range: `created_at > now() + 10min`
    // matches nothing, every count comes back zero, and the limit is off with
    // no error anywhere.
    expect(rateLimitWindowStart(NOW).getTime()).toBeLessThan(NOW);
  });
});
