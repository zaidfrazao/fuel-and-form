import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { reapExpiredDemos, type ReapLimits } from "@/lib/db/queries/demo";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll, userOwnedTables } from "./tables";

/**
 * The scheduled cleanup against a real Postgres — FUEL-42, PRD § P7.
 *
 * `src/app/api/cron/reap-demos/route.test.ts` proves WHO may run it, against
 * mocks. `src/lib/cron.test.ts` proves the token comparison, against a value.
 * Neither can prove the thing that actually matters, because both mock the
 * database: that the statement deletes the right rows, that everything beneath
 * them goes too, and — the one that would be catastrophic and silent — that the
 * owner's twelve tables are still there afterwards.
 *
 * All three are claims about SQL, so they are asserted against SQL.
 *
 * ## The cascade is not a formality here
 *
 * schema.ts carries a claim it says was "verified both ways against real
 * Postgres" by hand: the history tables hold `no action` foreign keys to `meals`
 * and `workouts` so a log can never be orphaned, and `no action` is checked at
 * END of statement, so a delete that removes the logs and the meals together
 * passes while `restrict` would abort. Nothing automated held that line until
 * now — and the failure mode if it changes is a reaper that throws on every run,
 * daily, while the rows it was added to remove accumulate.
 *
 * So the sweep below walks every user-owned table rather than a chosen few. An
 * empty table cannot prove a cascade, which is why it also fails when a table
 * comes back empty BEFORE the reap.
 */

const configured = Boolean(testDatabaseUrl());

/** Long after every fixture's expiry, so "expired" is not a near thing. */
const NOW = new Date("2026-06-01T00:00:00Z");

/** How many rows a table holds for one user. */
async function rowsFor(table: (typeof userOwnedTables)[number][1], userId: string) {
  return (await scope(userId, getDb()).select(table)).length;
}

/** How many `users` rows of a kind exist at all. */
async function usersOfKind(kind: "owner" | "demo") {
  const [row] = await getDb()
    .select({ count: count() })
    .from(schema.users)
    .where(eq(schema.users.kind, kind));

  return row?.count ?? 0;
}

/** Whether one user row survived. */
async function exists(userId: string) {
  const [row] = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return Boolean(row);
}

/**
 * Bare `users` rows, with no library beneath them.
 *
 * The batching and concurrency cases need more expired accounts than a fixture
 * would make it reasonable to seed — the reaper reads `users` and nothing else
 * to decide, so what hangs beneath a row is irrelevant to what it selects.
 * Where it matters that a FULL account is deleted, that is the sweep above,
 * asserted separately and against the fixture's real rows.
 */
async function seedExpiredDemos(howMany: number, expiresAt: Date) {
  await getDb()
    .insert(schema.users)
    .values(
      Array.from({ length: howMany }, (_unused, index) => ({
        kind: "demo" as const,
        displayName: `Expired ${index}`,
        expiresAt,
      })),
    );
}

describe.skipIf(!configured)("reaping expired demo sessions", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  describe("what it deletes", () => {
    it("deletes an expired demo session", async () => {
      const reaped = await reapExpiredDemos(NOW);

      expect(reaped).toEqual({ deleted: 1, complete: true });
      expect(await exists(fixture.expired.userId)).toBe(false);
    });

    it("takes every row beneath it, across every user-owned table", async () => {
      // The sweep. `user_id` cascades on all twelve, so nothing here names a
      // table — a table added by a later task is covered the day it exists.
      for (const [name, table] of userOwnedTables) {
        // An empty table cannot prove a cascade. This is the assertion that
        // stops the loop below passing vacuously.
        expect(await rowsFor(table, fixture.expired.userId), `${name} before`).toBeGreaterThan(0);
      }

      await reapExpiredDemos(NOW);

      for (const [name, table] of userOwnedTables) {
        expect(await rowsFor(table, fixture.expired.userId), `${name} after`).toBe(0);
      }
    });

    it("survives the history tables' `no action` foreign keys", async () => {
      // schema.ts's hand-verified claim, made automatic. `meal_logs`,
      // `day_plan_overrides` and `workout_logs` refuse to be orphaned; the
      // cascade removes them and the `meals` and `workouts` they name in ONE
      // statement, so the end-of-statement check finds nothing dangling.
      // Under `restrict` this line throws instead.
      await expect(reapExpiredDemos(NOW)).resolves.toEqual({ deleted: 1, complete: true });
    });
  });

  describe("what it leaves alone", () => {
    it("never touches the owner", async () => {
      await reapExpiredDemos(NOW);

      expect(await exists(fixture.alice.userId)).toBe(true);
      expect(await usersOfKind("owner")).toBe(1);
    });

    it("leaves every one of the owner's rows in place", async () => {
      // The catastrophic-and-silent case. A reaper that took the owner's rows
      // would look exactly like a reaper that worked.
      await reapExpiredDemos(NOW);

      for (const [name, table] of userOwnedTables) {
        expect(await rowsFor(table, fixture.alice.userId), name).toBeGreaterThan(0);
      }
    });

    it("never touches the owner even if their row carries a past expiry", async () => {
      // Proves `kind = 'demo'` is load-bearing rather than decorative. Without
      // it this row matches the comparison and the owner's whole history goes.
      await getDb()
        .update(schema.users)
        .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(schema.users.id, fixture.alice.userId));

      await reapExpiredDemos(NOW);

      expect(await exists(fixture.alice.userId)).toBe(true);
    });

    it("leaves a demo session that has not expired", async () => {
      expect(await exists(fixture.bob.userId)).toBe(true);

      await reapExpiredDemos(NOW);

      expect(await exists(fixture.bob.userId)).toBe(true);
    });

    it("leaves a demo session with no expiry at all", async () => {
      // `null <= now` is null rather than true, so such a row can never match.
      // Not reachable through provisioning — which always sets one — and
      // asserted because the second half of the predicate is what guarantees it.
      await getDb()
        .update(schema.users)
        .set({ expiresAt: null })
        .where(eq(schema.users.id, fixture.expired.userId));

      const reaped = await reapExpiredDemos(NOW);

      expect(reaped.deleted).toBe(0);
      expect(await exists(fixture.expired.userId)).toBe(true);
    });
  });

  describe("the expiry boundary", () => {
    it("deletes a session that expired exactly now", async () => {
      // `<=`, matching `resolveSession` — which refuses at exactly this instant
      // too. The two agreeing is what means the reapable rows are precisely the
      // already-refused ones.
      const expiresAt = new Date("2026-06-01T00:00:00Z");

      await getDb()
        .update(schema.users)
        .set({ expiresAt })
        .where(eq(schema.users.id, fixture.bob.userId));

      await reapExpiredDemos(expiresAt);

      expect(await exists(fixture.bob.userId)).toBe(false);
    });

    it("leaves a session that expires a millisecond later", async () => {
      const expiresAt = new Date("2026-06-01T00:00:00.001Z");

      await getDb()
        .update(schema.users)
        .set({ expiresAt })
        .where(eq(schema.users.id, fixture.bob.userId));

      await reapExpiredDemos(new Date("2026-06-01T00:00:00.000Z"));

      expect(await exists(fixture.bob.userId)).toBe(true);
    });
  });

  describe("running it more than once", () => {
    it("deletes nothing the second time", async () => {
      await reapExpiredDemos(NOW);

      // Idempotent: no state anywhere but the rows, and they are gone.
      expect(await reapExpiredDemos(NOW)).toEqual({ deleted: 0, complete: true });
    });

    it("deletes each expired account exactly once across concurrent runs", async () => {
      // `for update skip locked` is what makes two invocations take disjoint
      // batches instead of queueing. Both runs are started before either is
      // awaited, so they genuinely overlap.
      await seedExpiredDemos(24, new Date("2026-01-01T00:00:00Z"));

      const before = await usersOfKind("demo");

      const limits: ReapLimits = { batchSize: 5, maxBatches: 20 };

      const [first, second] = await Promise.all([
        reapExpiredDemos(NOW, limits),
        reapExpiredDemos(NOW, limits),
      ]);

      // 24 seeded plus the fixture's own expired session; Bob is live and stays.
      expect(first.deleted + second.deleted).toBe(25);
      expect(await usersOfKind("demo")).toBe(before - 25);
    });
  });

  describe("its batch budget", () => {
    it("keeps going past one batch", async () => {
      await seedExpiredDemos(9, new Date("2026-01-01T00:00:00Z"));

      // 10 expired accounts in batches of 4: three statements, the last short.
      expect(await reapExpiredDemos(NOW, { batchSize: 4, maxBatches: 20 })).toEqual({
        deleted: 10,
        complete: true,
      });
    });

    it("reports itself unfinished rather than silently doing half the job", async () => {
      await seedExpiredDemos(9, new Date("2026-01-01T00:00:00Z"));

      const reaped = await reapExpiredDemos(NOW, { batchSize: 4, maxBatches: 2 });

      // The signal an operator needs. Eight of ten deleted, and the response
      // says so rather than looking identical to a run with nothing left to do.
      expect(reaped).toEqual({ deleted: 8, complete: false });
    });

    it("leaves the rows it did not reach, for the next run", async () => {
      await seedExpiredDemos(9, new Date("2026-01-01T00:00:00Z"));

      await reapExpiredDemos(NOW, { batchSize: 4, maxBatches: 2 });

      // Progress is durable: each batch committed on its own, so a run cut off
      // here has still deleted eight and the next one finishes.
      expect(await reapExpiredDemos(NOW, { batchSize: 4, maxBatches: 20 })).toEqual({
        deleted: 2,
        complete: true,
      });
    });
  });
});
