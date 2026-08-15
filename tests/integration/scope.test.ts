import { asc, eq, sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { getPool } from "@/lib/db/pool";
import { scope } from "@/lib/db/scope";

/**
 * Demo isolation against a real Postgres — Testing Strategy § 1.4.
 *
 * src/lib/db/scope.test.ts proves the ownership predicate is in every statement.
 * That is a claim about SQL text. This file proves the claim means what we
 * think it means once Postgres executes it: user A's reads return none of B's
 * rows, and A's writes leave B's untouched.
 *
 * ## Why its own table
 *
 * `scope_fixture` is created and dropped by this suite rather than borrowing
 * the application schema. The boundary under test is `user_id` scoping, not any
 * particular table — the scope is generic, so one table exercises it as well as
 * twelve. It also means FUEL-13 can land the real nine tables without touching
 * this file, and a schema change can never quietly weaken the isolation proof.
 *
 * ## What is deliberately not here
 *
 * Testing Strategy § 1.4 lists five cases. Three are provable now. Export
 * (case 3) and a forged or expired cookie (case 5) need features that do not
 * exist yet, and belong to FUEL-11 alongside them. Asserting them here would
 * mean asserting against stand-ins for the real thing.
 */

// Mirrors the shape every user-owned table shares: a key, an owner, some data.
const fixture = pgTable("scope_fixture", {
  id: text().primaryKey(),
  userId: text("user_id").notNull(),
  label: text().notNull(),
  kcal: integer().notNull(),
});

const configured = Boolean(process.env.DATABASE_URL_TEST);

const ALICE = "user-alice";
const BOB = "user-bob";

describe.skipIf(!configured)("scope — isolation against real Postgres", () => {
  const db = () => getDb();
  const alice = () => scope(ALICE, getDb());
  const bob = () => scope(BOB, getDb());

  beforeAll(async () => {
    await db().execute(sql`
      create table if not exists scope_fixture (
        id text primary key,
        user_id text not null,
        label text not null,
        kcal integer not null
      )
    `);
  });

  afterAll(async () => {
    await db().execute(sql`drop table if exists scope_fixture`);
  });

  beforeEach(async () => {
    // Truncate rather than delete-where-user: the point is to start from a
    // known empty table, and scoping it would assume the thing under test.
    await db().execute(sql`truncate table scope_fixture`);

    await alice().insert(fixture, [
      { id: "a1", label: "Alice oats", kcal: 500 },
      { id: "a2", label: "Alice eggs", kcal: 300 },
    ]);
    await bob().insert(fixture, { id: "b1", label: "Bob steak", kcal: 700 });
  });

  describe("reads", () => {
    it("returns only the caller's rows", async () => {
      const rows = await alice().select(fixture).orderBy(asc(fixture.id));

      expect(rows.map((r) => r.id)).toEqual(["a1", "a2"]);
      expect(rows.every((r) => r.userId === ALICE)).toBe(true);
    });

    it("round-trips the row's real column types", async () => {
      // The unit suite stubs the driver, so this is where mapping is proved.
      const row = await alice().selectOne(fixture, eq(fixture.id, "a1"));

      expect(row).toMatchObject({ id: "a1", label: "Alice oats", kcal: 500 });
    });

    it("returns nothing for another user's row, by its exact id", async () => {
      // b1 exists. Alice asking for it by primary key gets the same answer she
      // would get for an id that was never issued — see below.
      const stolen = await alice().selectOne(fixture, eq(fixture.id, "b1"));

      expect(stolen).toBeUndefined();
    });

    it("cannot distinguish another user's row from one that does not exist", async () => {
      // This is the guarantee in full: the two cases are indistinguishable, so
      // no sequence of requests reveals which ids the owner holds.
      const theirs = await alice().selectOne(fixture, eq(fixture.id, "b1"));
      const absent = await alice().selectOne(fixture, eq(fixture.id, "never-issued"));

      expect(theirs).toEqual(absent);
      expect(theirs).toBeUndefined();
    });

    it("resolves rather than rejects when reaching for another user's row", async () => {
      // A rejection would be a signal in itself, however the caller mapped it.
      // Asserted as settle-state rather than `.resolves.not.toThrow`, which is
      // a property access that asserts nothing if the parentheses are missed.
      const settled = await alice()
        .selectOne(fixture, eq(fixture.id, "b1"))
        .then(() => "resolved" as const)
        .catch(() => "rejected" as const);

      expect(settled).toBe("resolved");
    });
  });

  describe("writes", () => {
    it("stamps inserts with the caller's user_id", async () => {
      await alice().insert(fixture, { id: "a3", label: "Alice rice", kcal: 400 });

      const row = await alice().selectOne(fixture, eq(fixture.id, "a3"));

      expect(row?.userId).toBe(ALICE);
    });

    it("leaves another user's row untouched on update", async () => {
      const updated = await alice()
        .update(fixture, { label: "hijacked" }, eq(fixture.id, "b1"))
        .returning();

      expect(updated).toHaveLength(0);

      const bobsRow = await bob().selectOne(fixture, eq(fixture.id, "b1"));
      expect(bobsRow?.label).toBe("Bob steak");
    });

    it("leaves another user's row untouched on delete", async () => {
      const deleted = await alice().delete(fixture, eq(fixture.id, "b1")).returning();

      expect(deleted).toHaveLength(0);
      await expect(bob().selectOne(fixture, eq(fixture.id, "b1"))).resolves.toBeDefined();
    });

    it("does not let an unqualified update reach beyond the caller", async () => {
      // No condition at all — the widest write the API can express. It still
      // stops at the scope boundary.
      await alice().update(fixture, { label: "mine" });

      const bobsRow = await bob().selectOne(fixture, eq(fixture.id, "b1"));
      expect(bobsRow?.label).toBe("Bob steak");
    });

    it("does not let an unqualified delete reach beyond the caller", async () => {
      await alice().delete(fixture);

      expect(await alice().select(fixture)).toHaveLength(0);
      expect(await bob().select(fixture)).toHaveLength(1);
    });
  });

  describe("two concurrent sessions", () => {
    it("never see each other's writes", async () => {
      // Testing Strategy § 1.4 case 4. Interleaved on purpose: the isolation
      // must not depend on the two users taking turns.
      await Promise.all([
        alice().insert(fixture, { id: "a9", label: "Alice late", kcal: 100 }),
        bob().insert(fixture, { id: "b9", label: "Bob late", kcal: 200 }),
      ]);

      const [aliceRows, bobRows] = await Promise.all([
        alice().select(fixture),
        bob().select(fixture),
      ]);

      expect(aliceRows.map((r) => r.id).sort()).toEqual(["a1", "a2", "a9"]);
      expect(bobRows.map((r) => r.id).sort()).toEqual(["b1", "b9"]);
    });
  });

  describe("over a transaction", () => {
    it("scopes writes the same way it does outside one", async () => {
      // Demo provisioning is the motivating case for getPool() (see pool.ts):
      // create the demo user, copy the owner's rows, commit or roll back as a
      // unit. It goes through the same scope, so there is no second write path
      // with its own chance of getting the scoping wrong.
      await getPool().transaction(async (tx) => {
        await scope(ALICE, tx).insert(fixture, { id: "a-tx", label: "In a tx", kcal: 50 });
      });

      expect(await alice().selectOne(fixture, eq(fixture.id, "a-tx"))).toBeDefined();
      expect(await bob().selectOne(fixture, eq(fixture.id, "a-tx"))).toBeUndefined();
    });

    it("rolls back without leaving a partly-scoped row behind", async () => {
      const boom = new Error("deliberate rollback");

      await expect(
        getPool().transaction(async (tx) => {
          await scope(ALICE, tx).insert(fixture, {
            id: "a-rollback",
            label: "Should vanish",
            kcal: 50,
          });
          throw boom;
        }),
      ).rejects.toThrow(boom);

      expect(await alice().selectOne(fixture, eq(fixture.id, "a-rollback"))).toBeUndefined();
    });
  });
});

describe.skipIf(configured)("scope isolation (unconfigured)", () => {
  it.skip("needs DATABASE_URL_TEST — see README → Database", () => {});
});
