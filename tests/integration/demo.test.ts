import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { provisionDemoUser } from "@/lib/db/queries/demo";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { DEMO_LIMITS, hashClientIp } from "@/lib/demo";

import { testDatabaseUrl } from "./env";
import { seedFixture, type Fixture } from "./fixtures";
import { truncateAll, userOwnedTables } from "./tables";

/**
 * Demo provisioning against a real Postgres — FUEL-40, PRD § P7.
 *
 * `src/lib/demo.test.ts` proves the limits DECIDE correctly given counts.
 * `src/app/actions/demo.test.ts` proves the action wires them in the right
 * order. Neither can prove the thing that actually matters, because both mock
 * the database: that the counts are COUNTING the right rows, that a provisioned
 * account is complete, and that two of them cannot see each other.
 *
 * All three are claims about SQL, so they are asserted against SQL.
 *
 * ## The isolation sweep is not a formality here
 *
 * FUEL-11 proved the scope isolates two hand-seeded users. This asks the same
 * question of two accounts the APPLICATION built, over the same walk of every
 * user-owned table — because the fixture writes one row per table by hand,
 * while `loadSeedLibraries` writes a hundred and fifty through a code path with
 * its own opportunities to get ownership wrong. An empty table cannot leak, so
 * the sweep also fails when a table comes back empty.
 *
 * ## Why the cheap rows
 *
 * Several cases need a client sitting exactly on its allowance, or a site at
 * capacity. Getting there by provisioning is a hundred transactions and two
 * hundred rows each; the counting queries read `users` and nothing else, so the
 * rows they count are inserted directly. Where it matters that a REAL provision
 * is counted too — that `ip_hash` is actually written — that is asserted
 * separately and explicitly.
 */

/**
 * A switch for failing the seed load, so rollback can be asserted at all.
 *
 * Passthrough by default — every other test in this file runs the real loader.
 * Only the two cases that set `fail` see anything different, and they set it
 * back through `beforeEach`. Mocking the loader outright would have made the
 * rest of the file assert nothing about the library it claims to provision.
 */
const seeding = vi.hoisted(() => ({ fail: false }));

vi.mock("@/lib/seed/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seed/load")>();

  return {
    loadSeedLibraries: (s: Parameters<typeof actual.loadSeedLibraries>[0]) =>
      seeding.fail
        ? Promise.reject(new Error("Seeding failed, deliberately."))
        : actual.loadSeedLibraries(s),
  };
});

/** See the note in scope.test.ts: resolved through the helper, not process.env. */
const configured = Boolean(testDatabaseUrl());

const SECRET = "integration-secret-not-a-real-one";

const CLIENT = hashClientIp("203.0.113.7", SECRET);
const OTHER_CLIENT = hashClientIp("203.0.113.8", SECRET);

const HOUR = 60 * 60 * 1000;

/**
 * `users` rows that exist only to be counted.
 *
 * Deliberately bare: no profile, no library. They stand in for sessions whose
 * contents the limit queries never look at.
 */
async function seedDemoRows(
  count: number,
  options: { ipHash?: string; createdAt?: Date; expiresAt?: Date | null },
): Promise<void> {
  if (count === 0) return;

  await getDb()
    .insert(schema.users)
    .values(
      Array.from({ length: count }, (_, index) => ({
        kind: "demo" as const,
        displayName: `Counted ${index}`,
        ipHash: options.ipHash ?? null,
        createdAt: options.createdAt,
        expiresAt: options.expiresAt === undefined ? null : options.expiresAt,
      })),
    );
}

describe.skipIf(!configured)("provisioning a demo account", () => {
  beforeEach(async () => {
    seeding.fail = false;
    await truncateAll(getDb());
  });

  const provision = (ipHash = CLIENT, now = new Date()) => provisionDemoUser(ipHash, now);

  /** Narrows the union, so a refusal fails HERE rather than on a missing id. */
  const provisioned = async (ipHash = CLIENT, now = new Date()): Promise<string> => {
    const result = await provision(ipHash, now);

    if (!result.ok) throw new Error(`Expected a demo account, was refused: ${result.refusal}`);

    return result.userId;
  };

  describe("the account it creates", () => {
    it("creates exactly one demo user", async () => {
      const userId = await provisioned();

      const rows = await getDb().select().from(schema.users);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(userId);
      expect(rows[0]?.kind).toBe("demo");
    });

    it("sets an expiry one demo lifetime out", async () => {
      // P7's "demo sessions carry an expiry", and the column FUEL-42's reaper
      // reads. Null here would be an immortal demo account that the reaper
      // never sees and `resolveSession` never refuses.
      const now = new Date();

      await provisioned(CLIENT, now);

      const [user] = await getDb().select().from(schema.users);

      expect(user?.expiresAt).not.toBeNull();
      expect(user?.expiresAt?.getTime()).toBeGreaterThan(now.getTime());
      expect(user?.expiresAt?.getTime()).toBeLessThanOrEqual(now.getTime() + 2 * HOUR);
    });

    it("records the client it was provisioned for, and no address", async () => {
      await provisioned();

      const [user] = await getDb().select().from(schema.users);

      expect(user?.ipHash).toBe(CLIENT);
      expect(user?.ipHash).not.toContain("203.0.113");
    });

    it("lands on a populated view rather than an empty one", async () => {
      // P7: "requires no credentials and lands directly on a populated Right
      // Now view". `/` renders "No plan yet" without a profile, so the profile
      // and the plan template are what make the difference between a demo and
      // a blank screen. Asserted per table, so a partially loaded library names
      // which half is missing.
      const userId = await provisioned();
      const owned = scope(userId, getDb());

      expect(await owned.selectOne(schema.profiles)).toBeDefined();

      for (const table of [
        schema.meals,
        schema.mealIngredients,
        schema.workouts,
        schema.workoutExercises,
        schema.planTemplateEntries,
        schema.trainingTemplateEntries,
      ]) {
        expect(await owned.select(table)).not.toHaveLength(0);
      }
    });

    it("gives the persona a program that started on a Monday", async () => {
      // The Circuit A/B alternation counts from this date. Committed as a
      // literal it would drift; resolved off a naive `new Date()` it would land
      // mid-week whenever the server's zone disagrees with the persona's.
      const userId = await provisioned();

      const profile = await scope(userId, getDb()).selectOne(schema.profiles);

      expect(new Date(`${profile?.programStartDate}T00:00:00Z`).getUTCDay()).toBe(1);
    });
  });

  describe("what one visitor can reach", () => {
    it("gives two visitors accounts that cannot see each other", async () => {
      // The sweep FUEL-11 introduced, asked of accounts the APPLICATION built
      // rather than of hand-seeded fixtures. Every user-owned table, in both
      // directions, and a non-empty check so no table passes vacuously.
      const first = await provisioned(CLIENT);
      const second = await provisioned(OTHER_CLIENT);

      expect(first).not.toBe(second);

      for (const [name, table] of userOwnedTables) {
        const mine = await scope(first, getDb()).select(table);
        const theirs = await scope(second, getDb()).select(table);

        // Both accounts were seeded identically, so a table empty in one is
        // empty in both — and an empty table cannot leak, which would make the
        // rest of this assertion mean nothing.
        if (mine.length === 0 && theirs.length === 0) continue;

        expect(mine.length, `${name} is empty for the first account`).toBeGreaterThan(0);
        expect(theirs.length, `${name} is empty for the second account`).toBeGreaterThan(0);

        const ids = new Set(theirs.map((row) => JSON.stringify(row)));

        for (const row of mine) {
          expect(ids.has(JSON.stringify(row)), `${name} leaked a row between accounts`).toBe(
            false,
          );
        }
      }
    });

    it("leaves the owner's data untouched", async () => {
      // The promise P7 makes to strangers on a public URL. Counted before and
      // after, because "cannot read" and "did not write over" are two claims
      // and provisioning is the one operation that writes a lot at once.
      const fixture: Fixture = await seedFixture();

      const before = await scope(fixture.alice.userId, getDb()).select(schema.meals);

      const demoUser = await provisioned();

      const after = await scope(fixture.alice.userId, getDb()).select(schema.meals);

      expect(after).toEqual(before);
      expect(await scope(demoUser, getDb()).select(schema.meals)).not.toEqual(before);
    });

    it("lets the visitor write — a weigh-in and a swap", async () => {
      // P7: "every write operation works in demo". A demo account that reads
      // beautifully and refuses every write is the failure mode a read-only
      // clone would have, and nothing about the seeding would look wrong.
      const userId = await provisioned();
      const owned = scope(userId, getDb());

      const [meal] = await owned.select(schema.meals, undefined, { limit: 1 });

      if (!meal) throw new Error("The provisioned account has no meals to swap to.");

      await owned.insert(schema.weightLogs, { date: "2026-08-24", weightKg: 80.8 });

      await owned.upsert(
        schema.dayPlanOverrides,
        { date: "2026-08-24", slot: "dinner", mealId: meal.id },
        {
          target: [schema.dayPlanOverrides.date, schema.dayPlanOverrides.slot],
          set: { mealId: meal.id },
        },
      );

      expect(await owned.select(schema.weightLogs)).toHaveLength(1);
      expect(await owned.select(schema.dayPlanOverrides)).toHaveLength(1);
    });
  });

  describe("what it refuses", () => {
    it("refuses a client that has used its allowance", async () => {
      await seedDemoRows(DEMO_LIMITS.client.max, { ipHash: CLIENT });

      await expect(provision(CLIENT)).resolves.toEqual({
        ok: false,
        refusal: "rate-limited",
      });
    });

    it("counts its own provisions against that allowance", async () => {
      // The half the cheap rows cannot prove: that a REAL provision writes an
      // `ip_hash` the next count actually sees. Without it the limit would
      // never fire in production no matter how correct its arithmetic.
      await provisioned(CLIENT);
      await seedDemoRows(DEMO_LIMITS.client.max - 1, { ipHash: CLIENT });

      await expect(provision(CLIENT)).resolves.toEqual({
        ok: false,
        refusal: "rate-limited",
      });
    });

    it("counts each client separately", async () => {
      // Otherwise the limit is site-wide, and one visitor in a loop closes the
      // demo for everybody — which is the denial of service the per-client key
      // exists to prevent.
      await seedDemoRows(DEMO_LIMITS.client.max, { ipHash: CLIENT });

      await expect(provision(OTHER_CLIENT)).resolves.toMatchObject({ ok: true });
    });

    it("forgets provisions older than the window", async () => {
      // A rate limit that never forgets is a ban. The window is what makes
      // "try again in a few minutes" true rather than a polite refusal.
      await seedDemoRows(DEMO_LIMITS.client.max * 2, {
        ipHash: CLIENT,
        createdAt: new Date(Date.now() - DEMO_LIMITS.client.windowMs - HOUR),
      });

      await expect(provision(CLIENT)).resolves.toMatchObject({ ok: true });
    });

    it("refuses everyone when the site is at capacity", async () => {
      await seedDemoRows(DEMO_LIMITS.concurrent, {
        expiresAt: new Date(Date.now() + HOUR),
      });

      await expect(provision(OTHER_CLIENT)).resolves.toEqual({
        ok: false,
        refusal: "at-capacity",
      });
    });

    it("does not count expired sessions towards capacity", async () => {
      // The cap is on LIVE sessions. Counting dead ones would fill the site
      // permanently the first time it was busy, since nothing reaps a row the
      // instant it expires.
      await seedDemoRows(DEMO_LIMITS.concurrent * 2, {
        expiresAt: new Date(Date.now() - HOUR),
      });

      await expect(provision(CLIENT)).resolves.toMatchObject({ ok: true });
    });

    it("does not count the owner towards capacity", async () => {
      // `expires_at` is null for the owner, and null fails every comparison —
      // but the query also filters on `kind`, and this is what says so. An
      // owner counted as a live demo session is one seat gone forever.
      await seedFixture();

      await expect(provision(CLIENT)).resolves.toMatchObject({ ok: true });
    });

    it("writes nothing at all when it refuses", async () => {
      // A refusal that still created the user row would defeat the limit by
      // filling the table with the very rows it counts.
      await seedDemoRows(DEMO_LIMITS.client.max, { ipHash: CLIENT });

      const [before] = await getDb()
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.users);

      await provision(CLIENT);

      const [after] = await getDb()
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.users);

      expect(after?.total).toBe(before?.total);
      expect(await getDb().select().from(schema.profiles)).toHaveLength(0);
    });
  });

  describe("when it cannot finish", () => {
    it("leaves no account behind at all", async () => {
      // The reason `getPool()` exists, and the one claim about provisioning
      // that cannot be made without breaking it on purpose. A user row whose
      // library never landed renders "No plan yet" — a stranger's first
      // impression of the app is a screen saying there is nothing here, with
      // no error anywhere and a perfectly valid session cookie.
      //
      // The seed load is failed AFTER the user row and the profile have been
      // written inside the same transaction, so a missing rollback leaves both.
      seeding.fail = true;

      await expect(provision(CLIENT)).rejects.toBeDefined();

      expect(await getDb().select().from(schema.users)).toHaveLength(0);
      expect(await getDb().select().from(schema.profiles)).toHaveLength(0);
    });

    it("leaves the next visitor's allowance untouched", async () => {
      // A rolled-back provision must not be counted either — otherwise a
      // database wobble spends a visitor's three attempts without ever giving
      // them a session, and the refusal that follows is unexplainable.
      seeding.fail = true;
      await expect(provision(CLIENT)).rejects.toBeDefined();

      seeding.fail = false;
      await expect(provision(CLIENT)).resolves.toMatchObject({ ok: true });
    });
  });
});
