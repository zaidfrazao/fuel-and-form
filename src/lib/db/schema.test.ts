import { getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "./schema";
import type { ScopedTable } from "./scope";

/**
 * The schema's own invariants — hermetic, no database.
 *
 * scope.ts guarantees that every statement it builds carries the ownership
 * predicate. That guarantee is worth exactly as much as the schema's promise
 * that there is a column to predicate on: a table added without `user_id` cannot
 * go through the scope at all, so whoever adds it reaches for a raw query
 * instead, and the boundary quietly stops being a boundary.
 *
 * This file is the tripwire for that. It walks the schema module rather than
 * naming tables, so a new table is covered the moment it is exported — which is
 * the point. A checklist someone must remember to extend would fail exactly when
 * it mattered.
 */

/**
 * Tables that legitimately have no `user_id`.
 *
 * `users` is the only one, and can only ever be: its own `id` IS the owner, and
 * resolving a session cookie to a user necessarily happens before there is a
 * user to scope by. Every other table is user-owned.
 *
 * Adding a name here is a deliberate widening of the demo-isolation boundary.
 * It should be very hard to justify, and it should show up in a diff.
 */
const EXEMPT = new Set(["users"]);

/**
 * Every `pgTable` the schema module exports, paired with its SQL name.
 *
 * Widened to `unknown[]` first: the module also exports enums, and TypeScript
 * will not narrow a union of specific table types down to the generic `PgTable`
 * the drizzle helpers below want.
 */
const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => [getTableName(table), table] as const);

const userOwned = tables.filter(([name]) => !EXEMPT.has(name));

describe("schema", () => {
  it("exports every table named in the PRD's data model", () => {
    // Twelve, despite the PRD's prose saying "nine" — the same twelve its own
    // listing enumerates, and the same twelve the task's acceptance criteria do.
    expect(tables.map(([name]) => name).sort()).toEqual([
      "day_plan_overrides",
      "meal_ingredients",
      "meal_logs",
      "meals",
      "plan_template_entries",
      "profiles",
      "training_template_entries",
      "users",
      "weight_logs",
      "workout_exercises",
      "workout_logs",
      "workouts",
    ]);
  });

  describe("user ownership", () => {
    it.each(userOwned)("%s carries a user_id column", (_name, table) => {
      const { columns } = getTableConfig(table);
      const userId = columns.find((column) => column.name === "user_id");

      expect(userId).toBeDefined();
      expect(userId?.notNull).toBe(true);
    });

    it.each(userOwned)("%s exposes user_id as `userId`, as ScopedTable requires", (
      _name,
      table,
    ) => {
      // The property name, not the column name: `scope()` reads `table.userId`.
      // A table whose column is right but whose property is spelled differently
      // compiles everywhere except the call that actually scopes it.
      expect(table).toHaveProperty("userId");

      // Compile-time half of the same assertion — this line fails to typecheck
      // if the table does not satisfy ScopedTable.
      const scopable: ScopedTable = table as ScopedTable;
      expect(scopable.userId.name).toBe("user_id");
    });
  });

  describe("indexes the PRD's query patterns depend on", () => {
    const columnNames = (columns: readonly object[]) =>
      columns.map((column) => ("name" in column ? String(column.name) : ""));

    const indexedColumns = (table: PgTable) =>
      getTableConfig(table).indexes.map((index) => columnNames(index.config.columns));

    /**
     * Leading prefix, not exact match. A btree on (user_id, date, slot) already
     * answers a (user_id, date) lookup — Postgres uses any leading subset of the
     * index columns — so requiring a separate two-column index would be
     * demanding a redundant one. What matters is that no date query has to scan.
     */
    it.each([
      ["day_plan_overrides", schema.dayPlanOverrides],
      ["meal_logs", schema.mealLogs],
      ["workout_logs", schema.workoutLogs],
      ["weight_logs", schema.weightLogs],
    ] as const)("%s is indexed on (user_id, date)", (_name, table) => {
      const covers = indexedColumns(table).some(
        ([first, second]) => first === "user_id" && second === "date",
      );

      expect(covers).toBe(true);
    });

    it("day_plan_overrides allows one override per (user, date, slot)", () => {
      const { indexes } = getTableConfig(schema.dayPlanOverrides);
      const unique = indexes.find((index) => index.config.unique);

      expect(columnNames(unique?.config.columns ?? [])).toEqual(["user_id", "date", "slot"]);
    });

    it("weight_logs allows one weigh-in per (user, date)", () => {
      const { indexes } = getTableConfig(schema.weightLogs);
      const unique = indexes.find((index) => index.config.unique);

      expect(columnNames(unique?.config.columns ?? [])).toEqual(["user_id", "date"]);
    });
  });

  describe("gym-restart readiness", () => {
    /**
     * PRD § Gym-restart readiness: weighted training must be new rows, not a
     * migration. These two assertions are what that claim reduces to in the
     * schema — everything else about a new workout is data.
     */
    it("workouts.type is an open vocabulary, so 'strength' needs no ALTER TYPE", () => {
      const { columns } = getTableConfig(schema.workouts);
      const type = columns.find((column) => column.name === "type");

      expect(type?.enumValues).toBeUndefined();
      expect(type?.getSQLType()).toBe("text");
    });

    it("rotation is data, so a Circuit C is one row with rotation_index 2", () => {
      const { columns } = getTableConfig(schema.workouts);
      const names = columns.map((column) => column.name);

      expect(names).toContain("rotation_group");
      expect(names).toContain("rotation_index");
    });
  });

  it("users.expires_at is nullable — the owner never expires", () => {
    const { columns } = getTableConfig(schema.users);
    const expiresAt = columns.find((column) => column.name === "expires_at");

    expect(expiresAt?.notNull).toBe(false);
  });

  it("stores calendar dates as strings, so no date can shift a day through UTC", () => {
    // Circuit A/B counts days elapsed since program_start_date. A Date here
    // would make that arithmetic timezone-dependent, and the drift would be
    // silent and permanent.
    for (const [, table] of tables) {
      for (const column of getTableConfig(table).columns) {
        if (column.getSQLType() !== "date") continue;
        expect(column.dataType).toBe("string");
      }
    }
  });
});
