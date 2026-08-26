import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { getPool } from "@/lib/db/pool";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll, userOwnedTables } from "./tables";

/**
 * Demo isolation against a real Postgres — Testing Strategy § 1.4.
 *
 * `src/lib/db/scope.test.ts` proves the ownership predicate is in every
 * statement the scope builds. That is a claim about SQL text. This file proves
 * the claim means what we think it means once Postgres executes it, against the
 * real twelve tables: user A's reads return none of B's rows, and A's writes
 * leave B's untouched.
 *
 * The PRD makes this promise to strangers on a public URL (§ Security &
 * Compliance, P7), which is why it is Tier 1 and why it is here rather than
 * deferred to Phase 2.
 *
 * ## Why the real tables now
 *
 * FUEL-7 wrote this file against a throwaway `scope_fixture` table, because the
 * schema did not exist yet and the boundary under test is `user_id` scoping
 * rather than any particular table. FUEL-13 has since landed the twelve, and
 * they carry constraints a generic fixture table cannot express — above all the
 * composite `(id, user_id)` foreign keys, which are the difference between "a
 * demo visitor cannot read the owner's meal" and "a demo visitor cannot read the
 * owner's meal unless they name its id". That case is asserted below and could
 * not have been before.
 *
 * ## What is deliberately not here
 *
 * § 1.4 case 5 has two halves. The data half — what a forged or expired identity
 * can still reach — is asserted below. Rejecting a forged SIGNATURE or an
 * expired cookie at the request boundary belongs to the session module that
 * FUEL-12 builds; there is nothing to test here yet, and asserting it against a
 * stand-in session would prove only that the stand-in works.
 */

/**
 * Resolved through the shared helper, not read off `process.env` directly.
 *
 * `setup.ts` is what loads `.env.local`, and it happens to run before this
 * module is evaluated — so reading the raw variable works today, by ordering the
 * config does not promise. If that ordering ever changed, this suite would
 * report SKIPPED on a machine that is fully configured, which the README already
 * warns reads like success. Asking the resolver removes the dependency: it loads
 * the file itself if nobody has yet, and applies the same-database guard.
 */
const configured = Boolean(testDatabaseUrl());

/**
 * Reads the owning column off a row whose table is only known as `ScopedTable`.
 *
 * The sweep in case 3 walks the schema module, so the row type there is generic.
 * `schema.test.ts` has already proved every one of these tables exposes a
 * non-null `userId`.
 */
const ownerOf = (row: unknown) => (row as { userId: string }).userId;

/** Postgres' class 23 code for a foreign key violation. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Why Postgres refused a statement — its SQLSTATE and the constraint by name.
 *
 * Drizzle wraps driver errors, so the top-level message is only ever "Failed
 * query: insert into ...". The reason is on `cause`, as a NeonDbError. Asserting
 * against these two fields rather than a message pins the assertion to the
 * constraint that is actually doing the work: a test that merely required "some
 * rejection" would keep passing if the composite foreign key were replaced by a
 * plain one and a NOT NULL happened to fire instead.
 *
 * Throws when the statement succeeds, so "it was rejected" is asserted here too
 * and cannot be lost by a caller that only compares fields.
 */
async function refusal(statement: Promise<unknown>) {
  try {
    await statement;
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;

    return { code: cause?.code, constraint: cause?.constraint };
  }

  throw new Error("Expected Postgres to refuse the statement, but it succeeded.");
}

describe.skipIf(!configured)("demo isolation — Testing Strategy § 1.4", () => {
  const db = () => getDb();
  const as = (user: { userId: string }) => scope(user.userId, getDb());

  let fixture: Fixture;
  let alice: ReturnType<typeof as>;
  let bob: ReturnType<typeof as>;

  beforeEach(async () => {
    // Truncate rather than delete-where-user: the point is to start from a known
    // empty database, and scoping the teardown would assume the thing under test.
    await truncateAll(db());

    fixture = await seedFixture();
    alice = as(fixture.alice);
    bob = as(fixture.bob);
  });

  describe("case 1 · reads", () => {
    it("returns only the caller's meals, logs and weigh-ins", async () => {
      const [meals, mealLogs, weightLogs] = await Promise.all([
        alice.select(schema.meals),
        alice.select(schema.mealLogs),
        alice.select(schema.weightLogs),
      ]);

      // Non-empty first: "zero of B's rows" is satisfied by reading nothing at
      // all, which a broken connection would also satisfy.
      expect(meals).toHaveLength(1);
      expect(mealLogs).toHaveLength(1);
      expect(weightLogs).toHaveLength(1);

      const owners = [...meals, ...mealLogs, ...weightLogs].map((row) => row.userId);
      expect(owners.every((id) => id === fixture.alice.userId)).toBe(true);
      expect(owners).not.toContain(fixture.bob.userId);
    });

    it("returns nothing for another user's row, by its exact id", async () => {
      // Bob's meal exists. Alice asking for it by primary key gets the same
      // answer she would get for an id that was never issued — see below.
      const stolen = await alice.selectOne(schema.meals, eq(schema.meals.id, fixture.bob.mealId));

      expect(stolen).toBeUndefined();
    });

    it("cannot distinguish another user's row from one that does not exist", async () => {
      // This is the guarantee in full: the two cases are indistinguishable, so
      // no sequence of requests reveals which ids the owner holds.
      const theirs = await alice.selectOne(schema.meals, eq(schema.meals.id, fixture.bob.mealId));
      const absent = await alice.selectOne(schema.meals, eq(schema.meals.id, randomUUID()));

      expect(theirs).toEqual(absent);
      expect(theirs).toBeUndefined();
    });

    it("resolves rather than rejects when reaching for another user's row", async () => {
      // A rejection would be a signal in itself, however the caller mapped it.
      // Asserted as settle-state rather than `.resolves.not.toThrow`, which is a
      // property access that asserts nothing if the parentheses are missed.
      const settled = await alice
        .selectOne(schema.meals, eq(schema.meals.id, fixture.bob.mealId))
        .then(() => "resolved" as const)
        .catch(() => "rejected" as const);

      expect(settled).toBe("resolved");
    });

    it("round-trips the row's real column types", async () => {
      // The unit suite stubs the driver, so this is where the mapping is proved
      // — specifically that the fixed-point numerics come back as numbers rather
      // than the strings `numeric` yields by default. Every total in P4 depends
      // on it, and "24" + "12" is a plausible-looking wrong answer, not a crash.
      const meal = await alice.selectOne(schema.meals);
      const weighIn = await alice.selectOne(schema.weightLogs);

      expect(meal).toMatchObject({ name: "Alice's porridge", kcal: 420, proteinG: 24 });
      expect(weighIn).toMatchObject({ weightKg: 79.4, date: fixture.alice.weighInDate });
    });
  });

  describe("case 2 · writes", () => {
    it("logs a meal as the caller, leaving the other user's logs untouched", async () => {
      const before = await bob.select(schema.mealLogs);

      await alice.insert(schema.mealLogs, {
        date: fixture.alice.weighInDate,
        slot: "dinner",
        mealId: fixture.alice.mealId,
        status: "eaten",
      });

      const mine = await alice.select(schema.mealLogs);
      expect(mine).toHaveLength(2);
      expect(mine.every((row) => row.userId === fixture.alice.userId)).toBe(true);

      expect(await bob.select(schema.mealLogs)).toEqual(before);
    });

    it("writes a swap as an override on the caller's day only", async () => {
      const before = await bob.select(schema.dayPlanOverrides);

      const written = await alice.insert(schema.dayPlanOverrides, {
        date: "2026-03-09",
        slot: "dinner",
        mealId: fixture.alice.mealId,
      });

      expect(written.at(0)?.userId).toBe(fixture.alice.userId);
      expect(await bob.select(schema.dayPlanOverrides)).toEqual(before);
    });

    it("persists a weigh-in to the caller only", async () => {
      await alice.insert(schema.weightLogs, { date: "2026-03-10", weightKg: 79.1 });

      const mine = await alice.select(schema.weightLogs, undefined, {
        orderBy: asc(schema.weightLogs.date),
      });

      expect(mine.map((row) => row.date)).toEqual([fixture.alice.weighInDate, "2026-03-10"]);
      expect(await bob.select(schema.weightLogs)).toHaveLength(1);
    });

    it("cannot update another user's row by its exact id", async () => {
      const updated = await alice.update(
        schema.meals,
        { name: "hijacked" },
        eq(schema.meals.id, fixture.bob.mealId),
      );

      expect(updated).toHaveLength(0);

      const theirs = await bob.selectOne(schema.meals, eq(schema.meals.id, fixture.bob.mealId));
      expect(theirs?.name).toBe("Bob's porridge");
    });

    it("cannot delete another user's row by its exact id", async () => {
      const deleted = await alice.delete(schema.meals, eq(schema.meals.id, fixture.bob.mealId));

      expect(deleted).toHaveLength(0);
      await expect(
        bob.selectOne(schema.meals, eq(schema.meals.id, fixture.bob.mealId)),
      ).resolves.toBeDefined();
    });

    it("does not let an unqualified update reach beyond the caller", async () => {
      // No condition at all — the widest write the API can express. It still
      // stops at the scope boundary.
      await alice.update(schema.meals, { name: "mine" });

      const theirs = await bob.selectOne(schema.meals);
      expect(theirs?.name).toBe("Bob's porridge");
    });

    it("does not let an unqualified delete reach beyond the caller", async () => {
      // Meals are referenced by history, which is `no action` on purpose (see
      // schema.ts) — so the deletable table here is the log itself.
      await alice.delete(schema.mealLogs);

      expect(await alice.select(schema.mealLogs)).toHaveLength(0);
      expect(await bob.select(schema.mealLogs)).toHaveLength(1);
    });

    it("cannot borrow another user's meal id to smuggle their data into view", async () => {
      // The attack the composite foreign key exists to stop, and the one case a
      // generic fixture table could not express. `meal_id` is an ordinary
      // argument from the request, so a demo visitor can pass the OWNER's meal
      // id: `user_id` is then honestly their own and the scope has no objection,
      // but the day view would render the owner's meal name and macros. Postgres
      // refuses the pair instead — and because an invalid id is rejected exactly
      // as a valid-but-foreign one is, the failure is not an oracle either.
      expect(
        await refusal(
          alice.insert(schema.mealLogs, {
            date: "2026-03-11",
            slot: "lunch",
            mealId: fixture.bob.mealId,
            status: "eaten",
          }),
        ),
      ).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint: "meal_logs_meal_fk" });

      expect(await alice.select(schema.mealLogs)).toHaveLength(1);
    });
  });

  describe("case 3 · export", () => {
    it("sweeps every user-owned table without returning another user's row", async () => {
      // An export is "read everything this user owns", so the boundary it must
      // respect is asserted over every table rather than the three P6 happens to
      // serialise today. FUEL-37 asserts the export's SHAPE; this asserts that
      // whatever shape it takes, it cannot reach across.
      //
      // Failures are collected by table name rather than asserted in a loop:
      // `expect` inside a `for` reports only the first table that leaks, and
      // "which tables" is the useful answer.
      const leaked: string[] = [];
      const empty: string[] = [];

      for (const [name, table] of userOwnedTables) {
        const rows = await alice.select(table);

        // An empty table cannot leak, so it would pass this sweep for the wrong
        // reason — and keep passing after a regression. A table with no fixture
        // row is a hole in the proof, not a pass.
        if (rows.length === 0) empty.push(name);
        if (rows.some((row) => ownerOf(row) !== fixture.alice.userId)) leaked.push(name);
      }

      expect(leaked).toEqual([]);
      expect(empty).toEqual([]);
    });

    it("covers every user-owned table the schema exports", () => {
      // The sweep above is only as wide as this list. Pinning the count means a
      // fourteenth table added later cannot silently go unswept — the walk picks
      // it up, and this assertion is where someone notices it needs a fixture.
      //
      // Twelve since FUEL-45 added `shopping_checks`, which is exactly what this
      // assertion is for: the walk swept the new table immediately, and the
      // count is what said out loud that it now needs a fixture row of its own
      // before the sweep over it could mean anything.
      expect(userOwnedTables).toHaveLength(12);
    });
  });

  describe("case 4 · two concurrent sessions", () => {
    it("never see each other's writes", async () => {
      // Interleaved on purpose: the isolation must not depend on the two users
      // taking turns.
      await Promise.all([
        alice.insert(schema.weightLogs, { date: "2026-03-20", weightKg: 78.8 }),
        bob.insert(schema.weightLogs, { date: "2026-03-20", weightKg: 91.2 }),
      ]);

      const [mine, theirs] = await Promise.all([
        alice.select(schema.weightLogs, undefined, { orderBy: asc(schema.weightLogs.date) }),
        bob.select(schema.weightLogs, undefined, { orderBy: asc(schema.weightLogs.date) }),
      ]);

      // Same date, same table, one weigh-in each — the unique index is on
      // `(user_id, date)`, so this pair is only legal if the rows are genuinely
      // owned separately.
      expect(mine.map((row) => row.weightKg)).toEqual([79.4, 78.8]);
      expect(theirs.map((row) => row.weightKg)).toEqual([79.4, 91.2]);
    });
  });

  describe("case 5 · a forged or expired session", () => {
    /**
     * A cookie that resolves to a user id nobody was issued.
     *
     * This is what a forged session looks like once it reaches the data layer:
     * the signature check is FUEL-12's, but if one is ever bypassed, the id it
     * yields still has to be inert. Here it is, twice over — it reads nothing,
     * and it cannot write, because every `user_id` references `users`.
     */
    const forged = () => scope(randomUUID(), getDb());

    it("reads nothing from any user-owned table under a forged id", async () => {
      const reached: string[] = [];

      for (const [name, table] of userOwnedTables) {
        if ((await forged().select(table)).length > 0) reached.push(name);
      }

      expect(reached).toEqual([]);
    });

    it("cannot write under a forged id, so no data is returned either", async () => {
      // Rejected by the foreign key to `users`, not by application code — which
      // is what makes it hold for a write path nobody has written yet.
      expect(
        await refusal(forged().insert(schema.weightLogs, { date: "2026-03-21", weightKg: 70 })),
      ).toEqual({
        code: FOREIGN_KEY_VIOLATION,
        constraint: "weight_logs_user_id_users_id_fk",
      });

      expect(await alice.select(schema.weightLogs)).toHaveLength(1);
      expect(await bob.select(schema.weightLogs)).toHaveLength(1);
    });

    it("confines an expired session to its own rows", async () => {
      // Expiry must not become a hole in isolation: a session that has run out
      // is still exactly as confined as a live one, so an expired cookie that
      // slips past the boundary check gains nothing by it.
      const rows = await as(fixture.expired).select(schema.weightLogs);

      expect(rows).toHaveLength(1);
      expect(rows.at(0)?.userId).toBe(fixture.expired.userId);
      expect(rows.at(0)?.userId).not.toBe(fixture.alice.userId);
    });

    it("records an expiry the session layer can reject on", async () => {
      // The data half of case 5 ends here. `expires_at` is what lets FUEL-12
      // tell a live demo session from one that has run out, and P7's reaper tell
      // which rows to delete — this asserts the column carries the instant, in
      // the past, and that the owner's row is null rather than merely far off.
      const [expired, owner] = await Promise.all([
        db().select().from(schema.users).where(eq(schema.users.id, fixture.expired.userId)),
        db().select().from(schema.users).where(eq(schema.users.id, fixture.alice.userId)),
      ]);

      const session = expired.at(0);

      expect(session?.kind).toBe("demo");
      expect(session?.expiresAt).toBeInstanceOf(Date);
      expect(session?.expiresAt?.getTime()).toBeLessThan(Date.now());

      // Null, not a distant date: "never expires" and "expires eventually" are
      // different states, and the reaper's partial index depends on it.
      expect(owner.at(0)?.expiresAt).toBeNull();
    });
  });

  describe("over a transaction", () => {
    it("scopes writes the same way it does outside one", async () => {
      // Demo provisioning is the motivating case for getPool() (see pool.ts):
      // create the demo user, copy the owner's rows, commit or roll back as a
      // unit. It goes through the same scope, so there is no second write path
      // with its own chance of getting the scoping wrong.
      await getPool().transaction(async (tx) => {
        await scope(fixture.alice.userId, tx).insert(schema.weightLogs, {
          date: "2026-03-22",
          weightKg: 78.2,
        });
      });

      const date = eq(schema.weightLogs.date, "2026-03-22");

      expect(await alice.selectOne(schema.weightLogs, date)).toBeDefined();
      expect(await bob.selectOne(schema.weightLogs, date)).toBeUndefined();
    });

    it("rolls back without leaving a partly-scoped row behind", async () => {
      const boom = new Error("deliberate rollback");

      await expect(
        getPool().transaction(async (tx) => {
          await scope(fixture.alice.userId, tx).insert(schema.weightLogs, {
            date: "2026-03-23",
            weightKg: 78.0,
          });
          throw boom;
        }),
      ).rejects.toThrow(boom);

      const rolledBack = eq(schema.weightLogs.date, "2026-03-23");
      expect(await alice.selectOne(schema.weightLogs, rolledBack)).toBeUndefined();
    });
  });
});

describe.skipIf(configured)("demo isolation (unconfigured)", () => {
  it.skip("needs DATABASE_URL_TEST — see README → Database", () => {});
});
