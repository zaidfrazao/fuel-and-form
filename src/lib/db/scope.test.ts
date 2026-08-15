import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { scope } from "./scope";

/**
 * Unit tests for the scope layer — hermetic, no database.
 *
 * The stub client records the SQL it is handed and answers with no rows, so
 * every assertion here is about the statement that would have been sent. That
 * makes the guarantee this file exists to defend — the ownership predicate is
 * in every statement, and the caller's condition can only narrow it —
 * checkable in milliseconds, on every push, with no credentials.
 *
 * This is the suite the 100% coverage gate measures (vitest.config.mts).
 * tests/integration/scope.test.ts then proves the same statements behave
 * correctly once a real Postgres executes them.
 */

// A stand-in for any user-owned table. The scope is generic over shape, so one
// fixture exercises it as well as twelve would — and this file keeps working
// unchanged when FUEL-13 lands the real schema.
const fixture = pgTable("fixture", {
  id: text().primaryKey(),
  userId: text("user_id").notNull(),
  label: text().notNull(),
  kcal: integer().notNull(),
});

const OWNER = "user-owner";
const OTHER = "user-other";

/**
 * A scope over a client that never connects: it records each statement and
 * answers with no rows. The neon-http driver asks for `fullResults`, hence the
 * `{ rows, fields }` envelope.
 *
 * Always answering empty is deliberate. It is what reading someone else's row
 * produces, and mapping a populated row back into an object is the driver's
 * job — proved end to end against real Postgres in the integration suite
 * rather than against a hand-built imitation of the wire format.
 */
function spy(userId = OWNER) {
  const seen: { query: string; params: unknown[] }[] = [];

  const executor = drizzle({
    client: (async (query: string, params: unknown[]) => {
      seen.push({ query, params });
      return { rows: [], fields: [] };
    }) as never,
  });

  const last = () => {
    const statement = seen.at(-1);
    if (!statement) throw new Error("no statement was recorded");
    return statement;
  };

  return { s: scope(userId, executor), seen, last };
}

describe("scope", () => {
  describe("select", () => {
    it("filters by user_id", async () => {
      const { s, last } = spy();
      await s.select(fixture);

      expect(last().query).toContain('"fixture"."user_id" = $1');
      expect(last().params).toEqual([OWNER]);
    });

    it("AND-narrows with the caller's condition rather than replacing it", async () => {
      const { s, last } = spy();
      await s.select(fixture, eq(fixture.kcal, 500));

      expect(last().query).toContain(
        'where ("fixture"."user_id" = $1 and "fixture"."kcal" = $2)',
      );
      expect(last().params).toEqual([OWNER, 500]);
    });

    it("adds no ordering or pagination when none is asked for", async () => {
      const { s, last } = spy();
      await s.select(fixture);

      expect(last().query).not.toContain("order by");
      expect(last().query).not.toContain("limit");
      expect(last().query).not.toContain("offset");
    });

    it("orders by a single column", async () => {
      const { s, last } = spy();
      await s.select(fixture, undefined, { orderBy: asc(fixture.label) });

      expect(last().query).toContain('order by "fixture"."label" asc');
    });

    it("orders by several columns", async () => {
      const { s, last } = spy();
      await s.select(fixture, undefined, {
        orderBy: [asc(fixture.label), desc(fixture.kcal)],
      });

      expect(last().query).toContain(
        'order by "fixture"."label" asc, "fixture"."kcal" desc',
      );
    });

    it("paginates with limit and offset, keeping the filter", async () => {
      const { s, last } = spy();
      await s.select(fixture, undefined, { limit: 10, offset: 20 });

      expect(last().query).toContain('"fixture"."user_id" = $1');
      expect(last().query).toContain("limit");
      expect(last().query).toContain("offset");
      expect(last().params).toEqual([OWNER, 10, 20]);
    });

    it("honours a limit of zero rather than treating it as absent", async () => {
      // The options are checked with `!== undefined`, not for truthiness, so a
      // deliberate `limit: 0` is passed through. Drizzle elides `offset: 0`
      // itself, since offsetting by nothing is a no-op.
      const { s, last } = spy();
      await s.select(fixture, undefined, { limit: 0, offset: 0 });

      expect(last().query).toContain("limit");
      expect(last().params).toEqual([OWNER, 0]);
    });

    it("scopes to whichever user the scope was built with", async () => {
      const { s, last } = spy(OTHER);
      await s.select(fixture);

      expect(last().params).toEqual([OTHER]);
    });
  });

  describe("selectOne", () => {
    it("limits to one row and filters by user_id", async () => {
      const { s, last } = spy();
      await s.selectOne(fixture);

      expect(last().query).toContain('"fixture"."user_id" = $1');
      expect(last().query).toContain("limit");
      expect(last().params).toEqual([OWNER, 1]);
    });

    it("returns undefined rather than throwing when there is no row", async () => {
      // The row being absent and the row belonging to someone else produce the
      // same value here. That is the point: neither tells the caller which.
      const { s } = spy();

      await expect(s.selectOne(fixture)).resolves.toBeUndefined();
    });

    it("AND-narrows with the caller's condition", async () => {
      const { s, last } = spy();
      await s.selectOne(fixture, eq(fixture.id, "a"));

      expect(last().query).toContain(
        'where ("fixture"."user_id" = $1 and "fixture"."id" = $2)',
      );
    });

    it("passes ordering through, so the one row can be made deterministic", async () => {
      const { s, last } = spy();
      await s.selectOne(fixture, undefined, { orderBy: desc(fixture.kcal) });

      expect(last().query).toContain('order by "fixture"."kcal" desc');
      expect(last().query).toContain("limit");
    });
  });

  describe("insert", () => {
    it("stamps the scope's user_id onto a single row", async () => {
      const { s, last } = spy();
      await s.insert(fixture, { id: "a", label: "Oats", kcal: 500 });

      expect(last().params).toContain(OWNER);
    });

    it("stamps every row of a batch", async () => {
      const { s, last } = spy();
      await s.insert(fixture, [
        { id: "a", label: "Oats", kcal: 500 },
        { id: "b", label: "Eggs", kcal: 300 },
      ]);

      expect(last().params.filter((p) => p === OWNER)).toHaveLength(2);
    });

    it("overwrites a user_id smuggled past the type system", async () => {
      // The type forbids naming userId. This is what happens when the type is
      // not there to help: a row off JSON.parse, or through a cast.
      const smuggled = { id: "a", label: "Oats", kcal: 500, userId: OTHER } as unknown as {
        id: string;
        label: string;
        kcal: number;
      };

      const { s, last } = spy();
      await s.insert(fixture, smuggled);

      expect(last().params).toContain(OWNER);
      expect(last().params).not.toContain(OTHER);
    });
  });

  describe("update", () => {
    it("filters by user_id", async () => {
      const { s, last } = spy();
      await s.update(fixture, { label: "Eggs" });

      expect(last().query).toContain('"fixture"."user_id" = $2');
      expect(last().params).toEqual(["Eggs", OWNER]);
    });

    it("AND-narrows with the caller's condition", async () => {
      const { s, last } = spy();
      await s.update(fixture, { label: "Eggs" }, eq(fixture.id, "a"));

      expect(last().query).toContain(
        'where ("fixture"."user_id" = $2 and "fixture"."id" = $3)',
      );
    });

    it("refuses to reassign ownership, even when user_id is smuggled in", async () => {
      // Rewriting user_id would hand the row to another user — the same leak as
      // reading theirs, in the opposite direction.
      const smuggled = { label: "Eggs", userId: OTHER } as unknown as { label: string };

      const { s, last } = spy();
      await s.update(fixture, smuggled);

      expect(last().query).not.toContain('set "user_id"');
      expect(last().params).not.toContain(OTHER);
    });

    it("refuses an update whose only field was the smuggled user_id", async () => {
      // Stripping user_id leaves nothing to set. Rather than Drizzle's bare
      // "No values to set", which reads as a typo in a column name, the scope
      // names the real cause. The throw depends only on the caller's argument,
      // so it distinguishes nothing about whether any row exists.
      const onlyUserId = { userId: OTHER } as unknown as { label: string };

      const { s } = spy();

      await expect(s.update(fixture, onlyUserId)).rejects.toThrow(
        /Ownership cannot be reassigned/,
      );
    });
  });

  describe("delete", () => {
    it("filters by user_id", async () => {
      const { s, last } = spy();
      await s.delete(fixture);

      expect(last().query).toContain('"fixture"."user_id" = $1');
      expect(last().params).toEqual([OWNER]);
    });

    it("AND-narrows with the caller's condition", async () => {
      const { s, last } = spy();
      await s.delete(fixture, eq(fixture.id, "a"));

      expect(last().query).toContain(
        'where ("fixture"."user_id" = $1 and "fixture"."id" = $2)',
      );
      expect(last().params).toEqual([OWNER, "a"]);
    });
  });

  describe("the guarantee", () => {
    it("puts user_id in every statement the scope can build", async () => {
      const { s, seen } = spy();

      await s.select(fixture);
      await s.selectOne(fixture);
      await s.insert(fixture, { id: "a", label: "Oats", kcal: 500 });
      await s.update(fixture, { label: "Eggs" });
      await s.delete(fixture);

      expect(seen).toHaveLength(5);
      for (const { params } of seen) {
        expect(params).toContain(OWNER);
      }
    });

    it("hands back rows, never a query builder", async () => {
      // Regression test. While these methods returned builders, a caller could
      // write `.delete(t).$dynamic().where(...)` — no cast, compiles cleanly —
      // and reopen the spent `where`, replacing the ownership filter and
      // deleting across every user. An array has nothing to reopen.
      const { s } = spy();

      for (const result of [
        await s.select(fixture),
        await s.insert(fixture, { id: "a", label: "Oats", kcal: 500 }),
        await s.update(fixture, { label: "Eggs" }),
        await s.delete(fixture),
      ]) {
        expect(Array.isArray(result)).toBe(true);
        const asObject = result as unknown as Record<string, unknown>;
        expect(asObject.$dynamic).toBeUndefined();
        expect(asObject.where).toBeUndefined();
      }
    });

    it("exposes nothing but the five scoped methods", async () => {
      // The executor is closed over, never a property, so holding a Scope gives
      // no way to run a statement of one's own. The lint rule in
      // eslint.config.mjs is what stops a caller importing getDb() to get one.
      const { s } = spy();
      const asObject = s as unknown as Record<string, unknown>;

      expect(Object.keys(s).sort()).toEqual([
        "delete",
        "insert",
        "select",
        "selectOne",
        "update",
      ]);
      expect(asObject.executor).toBeUndefined();
    });

    it("cannot be built without a user and an executor", () => {
      // Compile-time, really — both arguments are required and neither is
      // defaulted, so there is no zero-argument scope to reach for by accident.
      // @ts-expect-error -- no executor
      expect(() => scope(OWNER)).not.toThrow();
      // @ts-expect-error -- no user
      expect(() => scope()).not.toThrow();
    });
  });
});
