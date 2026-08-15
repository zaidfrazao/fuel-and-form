import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { scope } from "./scope";

/**
 * Unit tests for the scope layer — hermetic, no database.
 *
 * Drizzle builds SQL without touching the network, so `.toSQL()` shows exactly
 * what would have been sent. That makes the guarantee this file exists to
 * defend — the ownership predicate is in every statement, and the caller's
 * condition can only narrow it — checkable in milliseconds, on every push,
 * with no credentials. This is the suite the 100% coverage gate measures
 * (vitest.config.mts); tests/integration/scope.test.ts then proves the same
 * statements behave correctly against a real Postgres.
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

// Never connects: every assertion below inspects the built query instead of
// executing it. The client is only here because drizzle() demands one.
const executor = drizzle({ client: (async () => {}) as never });

const OWNER = "user-owner";
const OTHER = "user-other";

const owned = () => scope(OWNER, executor);

describe("scope", () => {
  describe("select", () => {
    it("filters by user_id", () => {
      const { sql: text, params } = owned().select(fixture).toSQL();

      expect(text).toContain('"fixture"."user_id" = $1');
      expect(params).toEqual([OWNER]);
    });

    it("AND-narrows with the caller's condition rather than replacing it", () => {
      const { sql: text, params } = owned()
        .select(fixture, eq(fixture.kcal, 500))
        .toSQL();

      // Both predicates, joined by AND — the ownership check survives.
      expect(text).toContain('where ("fixture"."user_id" = $1 and "fixture"."kcal" = $2)');
      expect(params).toEqual([OWNER, 500]);
    });

    it("keeps the filter when the caller chains orderBy and limit", () => {
      const { sql: text, params } = owned()
        .select(fixture)
        .orderBy(fixture.label)
        .limit(10)
        .toSQL();

      expect(text).toContain('"fixture"."user_id" = $1');
      expect(text).toContain("limit");
      expect(params).toContain(OWNER);
    });

    it("scopes to whichever user the scope was built with", () => {
      expect(scope(OTHER, executor).select(fixture).toSQL().params).toEqual([OTHER]);
    });
  });

  describe("selectOne", () => {
    /**
     * selectOne awaits, so it needs a client that answers. The neon-http driver
     * asks for `fullResults`, hence the `{ rows, fields }` envelope.
     *
     * It always answers with no rows — which is the case that matters, because
     * it is what reading someone else's row produces. Mapping a populated row
     * back into an object is the driver's job, not this file's, and it is
     * proved end to end in tests/integration/scope.test.ts against real
     * Postgres rather than against a hand-built imitation of the wire format.
     */
    const empty = () => {
      const seen: { query: string; params: unknown[] }[] = [];
      const client = drizzle({
        client: (async (query: string, params: unknown[]) => {
          seen.push({ query, params });
          return { rows: [], fields: [] };
        }) as never,
      });

      return { client, seen };
    };

    it("limits to one row and filters by user_id", async () => {
      const { client, seen } = empty();

      await scope(OWNER, client).selectOne(fixture);

      expect(seen.at(0)?.query).toContain('"fixture"."user_id" = $1');
      expect(seen.at(0)?.query).toContain("limit");
      expect(seen.at(0)?.params).toEqual([OWNER, 1]);
    });

    it("returns undefined rather than throwing when there is no row", async () => {
      // The row being absent and the row belonging to someone else produce the
      // same value here. That is the point: neither tells the caller which.
      const { client } = empty();

      await expect(scope(OWNER, client).selectOne(fixture)).resolves.toBeUndefined();
    });

    it("AND-narrows with the caller's condition", async () => {
      const { client, seen } = empty();

      await scope(OWNER, client).selectOne(fixture, eq(fixture.id, "a"));

      expect(seen.at(0)?.query).toContain(
        'where ("fixture"."user_id" = $1 and "fixture"."id" = $2)',
      );
    });
  });

  describe("insert", () => {
    it("stamps the scope's user_id onto a single row", () => {
      const { params } = owned()
        .insert(fixture, { id: "a", label: "Oats", kcal: 500 })
        .toSQL();

      expect(params).toContain(OWNER);
    });

    it("stamps every row of a batch", () => {
      const { params } = owned()
        .insert(fixture, [
          { id: "a", label: "Oats", kcal: 500 },
          { id: "b", label: "Eggs", kcal: 300 },
        ])
        .toSQL();

      expect(params.filter((p) => p === OWNER)).toHaveLength(2);
    });

    it("overwrites a user_id smuggled past the type system", () => {
      // The type forbids naming userId. This is what happens when the type is
      // not there to help: a row off JSON.parse, or through a cast.
      const smuggled = { id: "a", label: "Oats", kcal: 500, userId: OTHER } as unknown as {
        id: string;
        label: string;
        kcal: number;
      };

      const { params } = owned().insert(fixture, smuggled).toSQL();

      expect(params).toContain(OWNER);
      expect(params).not.toContain(OTHER);
    });
  });

  describe("update", () => {
    it("filters by user_id", () => {
      const { sql: text, params } = owned().update(fixture, { label: "Eggs" }).toSQL();

      expect(text).toContain('"fixture"."user_id" = $2');
      expect(params).toEqual(["Eggs", OWNER]);
    });

    it("AND-narrows with the caller's condition", () => {
      const { sql: text } = owned()
        .update(fixture, { label: "Eggs" }, eq(fixture.id, "a"))
        .toSQL();

      expect(text).toContain('where ("fixture"."user_id" = $2 and "fixture"."id" = $3)');
    });

    it("refuses to reassign ownership, even when user_id is smuggled in", () => {
      // Rewriting user_id would hand the row to another user — the same leak as
      // reading theirs, in the opposite direction.
      const smuggled = { label: "Eggs", userId: OTHER } as unknown as { label: string };

      const { sql: text, params } = owned().update(fixture, smuggled).toSQL();

      expect(text).not.toContain('set "user_id"');
      expect(params).not.toContain(OTHER);
    });

    it("refuses an update whose only field was the smuggled user_id", () => {
      // Stripping user_id leaves nothing to set. Rather than Drizzle's bare
      // "No values to set", which reads as a typo in a column name, the scope
      // names the real cause. The throw depends only on the caller's argument,
      // so it distinguishes nothing about whether any row exists.
      const onlyUserId = { userId: OTHER } as unknown as { label: string };

      expect(() => owned().update(fixture, onlyUserId)).toThrowError(
        /Ownership cannot be reassigned/,
      );
    });
  });

  describe("delete", () => {
    it("filters by user_id", () => {
      const { sql: text, params } = owned().delete(fixture).toSQL();

      expect(text).toContain('"fixture"."user_id" = $1');
      expect(params).toEqual([OWNER]);
    });

    it("AND-narrows with the caller's condition", () => {
      const { sql: text, params } = owned().delete(fixture, eq(fixture.id, "a")).toSQL();

      expect(text).toContain('where ("fixture"."user_id" = $1 and "fixture"."id" = $2)');
      expect(params).toEqual([OWNER, "a"]);
    });
  });

  describe("the guarantee", () => {
    it("puts user_id in every statement the scope can build", () => {
      const s = owned();
      const statements = [
        s.select(fixture).toSQL(),
        s.insert(fixture, { id: "a", label: "Oats", kcal: 500 }).toSQL(),
        s.update(fixture, { label: "Eggs" }).toSQL(),
        s.delete(fixture).toSQL(),
      ];

      for (const { params } of statements) {
        expect(params).toContain(OWNER);
      }
    });

    it("cannot be built without a user and an executor", () => {
      // Compile-time, really — both arguments are required and neither is
      // defaulted, so there is no zero-argument scope to accidentally reach for.
      // @ts-expect-error -- no executor
      expect(() => scope(OWNER)).not.toThrow();
      // @ts-expect-error -- no user
      expect(() => scope()).not.toThrow();
    });

    it("documents that a raw condition cannot reach the executor unscoped", () => {
      // A caller holding only a Scope has no way to run `sql` of their own: the
      // executor is closed over, never exposed. The lint rule in
      // eslint.config.mjs is what stops them importing getDb() to get one.
      const s = owned() as unknown as Record<string, unknown>;

      expect(Object.keys(s).sort()).toEqual([
        "delete",
        "insert",
        "select",
        "selectOne",
        "update",
      ]);
      expect(s.executor).toBeUndefined();
    });

    it("leaves an unscoped query obviously unscoped, for contrast", () => {
      // Not a guarantee — a demonstration of what the lint rule exists to
      // prevent. Nothing in this statement mentions a user.
      const raw = executor.select().from(fixture).where(sql`true`).toSQL();

      expect(raw.sql).not.toContain("user_id\" = $");
    });
  });
});
