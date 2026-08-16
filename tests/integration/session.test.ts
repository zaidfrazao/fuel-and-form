import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveSession } from "@/lib/auth/resolve";
import { sign } from "@/lib/auth/token";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * The request boundary — Testing Strategy § 1.4 case 5, second half.
 *
 * `scope.test.ts` asserted the DATA half: an identity nobody was issued reads
 * zero rows and cannot write. It left this half to FUEL-12 explicitly, because
 * asserting it needed the session module that did not exist yet. This file is
 * that half — the cookie never becomes an identity in the first place.
 *
 * `src/lib/auth/token.test.ts` covers the signature and the signed expiry with
 * no database at all. What can only be proved here is the part that reads a
 * row: a signature can be immaculate and the session still dead, because
 * `users.expires_at` moved after the cookie was issued. That is a claim about
 * Postgres, so it is asserted against Postgres.
 *
 * Every rejection below asserts `toBeUndefined()`. Asserting merely "falsy", or
 * catching a throw, would let the two failure modes drift apart — and a caller
 * that can tell "forged" from "no session" is one a visitor can ask.
 *
 * The secret is invented and local to this file. Nothing real is here.
 */

const SECRET = "integration-secret-not-a-real-one";

/** See the note in scope.test.ts: resolved through the helper, not process.env. */
const configured = Boolean(testDatabaseUrl());

/** A fixed clock, so nothing here depends on how long the suite takes to run. */
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

const HOUR = 60 * 60 * 1000;

describe.skipIf(!configured)("session boundary — Testing Strategy § 1.4 case 5", () => {
  let fixture: Fixture;

  /** A well-formed, correctly signed, unexpired token for a given user. */
  const tokenFor = (userId: string) => sign({ userId, expiresAt: NOW + HOUR }, SECRET);

  const resolve = (token: string | undefined, kind: "owner" | "demo", now = NOW) =>
    resolveSession(token, kind, { secret: SECRET, now });

  beforeEach(async () => {
    await truncateAll(getDb());

    fixture = await seedFixture();
  });

  describe("what it admits", () => {
    it("resolves the owner from a valid owner cookie", async () => {
      // Non-empty first. Every other test here asserts undefined, and undefined
      // is also what a resolver that rejected everything would return — so the
      // suite needs one case proving the gate opens at all.
      expect(await resolve(tokenFor(fixture.alice.userId), "owner")).toEqual({
        userId: fixture.alice.userId,
        kind: "owner",
      });
    });

    it("resolves a live demo session from a valid demo cookie", async () => {
      expect(await resolve(tokenFor(fixture.bob.userId), "demo")).toEqual({
        userId: fixture.bob.userId,
        kind: "demo",
      });
    });

    it("keeps admitting the owner however long the session lasts", async () => {
      // `users.expires_at` is null for the owner. Asserted a year out, so a
      // future edit that encodes "never expires" as a distant date fails here
      // rather than on whatever day it silently arrives.
      const year = 365 * 24 * HOUR;
      const long = sign({ userId: fixture.alice.userId, expiresAt: NOW + year }, SECRET);

      expect(await resolve(long, "owner", NOW + year - 1)).toEqual({
        userId: fixture.alice.userId,
        kind: "owner",
      });
    });
  });

  describe("one owner, enforced by the database", () => {
    it("refuses a second owner row", async () => {
      // `ownerUserId()` provisions the owner on first correct login, and a
      // check-then-insert cannot be made race-free in application code: two
      // logins on a fresh deployment both read "no owner" and both insert.
      // `users_single_owner_key` is what makes one owner a fact rather than a
      // habit, so this asserts Postgres refuses — not that our code remembers.
      //
      // The fixture already seeded Alice as the owner.
      await expect(
        getDb().insert(schema.users).values({ kind: "owner", displayName: "Impostor" }),
      ).rejects.toThrow();
    });

    it("still allows many demo users", async () => {
      // The index is PARTIAL. A constraint that also limited demo rows would
      // break P7 entirely, and would do it only under concurrent visitors —
      // exactly when nobody is watching.
      await getDb()
        .insert(schema.users)
        .values([
          { kind: "demo", displayName: "Visitor one" },
          { kind: "demo", displayName: "Visitor two" },
        ]);

      const demos = await getDb()
        .select()
        .from(schema.users)
        .where(eq(schema.users.kind, "demo"));

      // Two seeded by the fixture (bob, expired) plus the two just added.
      expect(demos).toHaveLength(4);
    });

    it("lets a racing insert resolve to the winner's row rather than failing", async () => {
      // What `onConflictDoNothing` buys: the loser of the race gets an empty
      // returning() instead of an exception, then reads the row the winner
      // made. Both callers end up with the SAME id, which is the property that
      // matters — two owner identities is the failure being prevented.
      const attempt = async () => {
        const [created] = await getDb()
          .insert(schema.users)
          .values({ kind: "owner", displayName: "Owner" })
          .onConflictDoNothing()
          .returning({ id: schema.users.id });

        if (created) return created.id;

        const [existing] = await getDb()
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.kind, "owner"))
          .limit(1);

        return existing?.id;
      };

      const [first, second] = await Promise.all([attempt(), attempt()]);

      expect(first).toBe(fixture.alice.userId);
      expect(second).toBe(fixture.alice.userId);
    });
  });

  describe("what it refuses", () => {
    it("refuses an absent cookie", async () => {
      expect(await resolve(undefined, "owner")).toBeUndefined();
    });

    it("refuses a forged signature, indistinguishably from no cookie at all", async () => {
      // The forger knows a real user id — fixture.alice is the owner — and
      // still gets nothing, because the id was never the secret. This is the
      // request-boundary counterpart to scope.test.ts's forged-id sweep.
      const forged = sign({ userId: fixture.alice.userId, expiresAt: NOW + HOUR }, "wrong-secret");

      expect(await resolve(forged, "owner")).toBeUndefined();
      // Identical to the absent case above. Same value, no error, nothing to
      // tell the two apart from outside.
      expect(await resolve(forged, "owner")).toEqual(await resolve(undefined, "owner"));
    });

    it("refuses a valid signature over a user id nobody was issued", async () => {
      expect(await resolve(tokenFor(randomUUID()), "owner")).toBeUndefined();
    });

    it("refuses a valid signature over something that is not a uuid, without throwing", async () => {
      // `users.id` is a uuid column: comparing it against arbitrary text makes
      // Postgres raise a syntax error, and an escaping 500 would announce that
      // this cookie was malformed rather than merely wrong. Reachable only with
      // the signing secret, and refused all the same.
      expect(await resolve(tokenFor("not-a-uuid"), "owner")).toBeUndefined();
    });

    it("refuses a demo cookie replayed under the owner cookie name", async () => {
      // Bob's token is genuine — Bob signed in for a demo. The kind check is
      // what stops the same bytes being worth more in the other cookie jar.
      expect(await resolve(tokenFor(fixture.bob.userId), "owner")).toBeUndefined();
    });

    it("refuses an owner cookie replayed under the demo cookie name", async () => {
      expect(await resolve(tokenFor(fixture.alice.userId), "demo")).toBeUndefined();
    });

    it("refuses a session whose users.expires_at has passed, however good the cookie", async () => {
      // The case that needs a database. The token is freshly signed, correctly
      // signed, and unexpired by its own reckoning — the fixture's `expired`
      // user carries an `expires_at` in March 2026, and the row is what wins.
      const impeccable = tokenFor(fixture.expired.userId);

      expect(await resolve(impeccable, "demo")).toBeUndefined();
    });

    it("refuses an expired row identically to a forged cookie", async () => {
      const expired = await resolve(tokenFor(fixture.expired.userId), "demo");
      const forged = await resolve(
        sign({ userId: fixture.bob.userId, expiresAt: NOW + HOUR }, "wrong-secret"),
        "demo",
      );

      // The AC in full: "the response does not distinguish forged from no
      // session". Expiry joins that set — three different failures, one answer.
      expect(expired).toBeUndefined();
      expect(expired).toEqual(forged);
      expect(expired).toEqual(await resolve(undefined, "demo"));
    });

    it("refuses a session the moment its row expires, not a moment later", async () => {
      // Same live demo user, same token, two clocks either side of the row's
      // expiry — so what changes the answer is provably `expires_at` and not
      // anything about the cookie.
      const expiry = Date.UTC(2026, 6, 1);
      // Signed to OUTLIVE the row deliberately. A token expiring first would
      // pass this test while the row check did nothing, which is precisely the
      // regression it exists to catch.
      const token = sign({ userId: fixture.bob.userId, expiresAt: expiry + HOUR }, SECRET);

      // Set through raw SQL rather than a fixture option: the point is that the
      // row can move AFTER a cookie is issued, which is the whole reason the row
      // is checked when the token already claims to be valid.
      await getDb().execute(sql`
        update users set expires_at = ${new Date(expiry).toISOString()}
        where id = ${fixture.bob.userId}
      `);

      expect(await resolve(token, "demo", expiry - 1)).toEqual({
        userId: fixture.bob.userId,
        kind: "demo",
      });
      expect(await resolve(token, "demo", expiry)).toBeUndefined();
    });
  });
});
