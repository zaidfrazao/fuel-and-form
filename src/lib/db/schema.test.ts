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

    /**
     * The constraint `day_plan_overrides` has and this table must NOT — FUEL-25
     * added it, found out, and took it back off.
     *
     * `lib/seed/plan.ts` puts two snacks on every weekday deliberately, and
     * seed/plan.test.ts asserts that shape. A unique index on
     * `(user_id, day_of_week, slot)` refuses the second row, so the migration
     * would fail against any database holding the app's own seed.
     *
     * Asserted rather than left as a comment because the absence LOOKS like an
     * oversight: the two tables sit next to each other, one is unique on its
     * (date, slot) pair, and "make them match" is the obvious tidy-up. This is
     * the test that says the mismatch is the design.
     */
    it("plan_template_entries allows a weekday's slot to hold more than one meal", () => {
      const { indexes } = getTableConfig(schema.planTemplateEntries);

      expect(indexes.some((index) => index.config.unique)).toBe(false);
    });

    it("weight_logs allows one weigh-in per (user, date)", () => {
      const { indexes } = getTableConfig(schema.weightLogs);
      const unique = indexes.find((index) => index.config.unique);

      expect(columnNames(unique?.config.columns ?? [])).toEqual(["user_id", "date"]);
    });
  });

  describe("cross-user references are impossible", () => {
    /**
     * `scope()` owns `user_id`, but `meal_id` and `workout_id` arrive from the
     * request. A single-column foreign key only proves the meal EXISTS — not
     * that it is yours — so a demo visitor could swap in the owner's meal id and
     * have the day view render the owner's food. Accepting valid ids while
     * rejecting invalid ones also turns the insert into an id-enumeration
     * oracle. Pairing user_id into the key removes another user's rows from the
     * candidate set entirely.
     *
     * Asserted over every table rather than a list, so a new reference added
     * later cannot quietly reintroduce the single-column form.
     */
    it.each(userOwned)("%s references sibling tables by (id, user_id)", (_name, table) => {
      const { foreignKeys } = getTableConfig(table);

      for (const key of foreignKeys) {
        const { columns, foreignColumns } = key.reference();

        // The owning user_id -> users.id key is the one legitimate single-column
        // reference: it is what the demo reaper cascades through.
        const [firstColumn] = columns;
        const [firstTarget] = foreignColumns;

        const isOwnerKey =
          columns.length === 1 &&
          firstColumn?.name === "user_id" &&
          firstTarget !== undefined &&
          getTableName(firstTarget.table) === "users";

        if (isOwnerKey) continue;

        expect(columns.map((c) => c.name)).toContain("user_id");
        expect(foreignColumns.map((c) => c.name)).toContain("user_id");
      }
    });
  });

  describe("history survives a deleted library entry", () => {
    /**
     * The export is the backup (P6), so a log must outlive the meal or workout
     * it names. A cascade here would make hard-deleting one library row erase
     * every record of having eaten or done it — silently, with no error, and
     * only noticed at a check-in when the evidence is already gone.
     *
     * `no action` refuses that delete while still letting the demo reaper's
     * `delete from users` through, because each row's own `user_id` cascade
     * removes it within the same statement. `restrict` would abort the reaper;
     * `cascade` would lose the history. Neither is a safe substitute.
     */
    // Column names before the table, so vitest's printf-style titles interpolate
    // two short strings rather than dumping an entire PgTable into the name.
    const onDeleteFor = (table: PgTable, column: string) =>
      getTableConfig(table)
        .foreignKeys.filter((key) => key.reference().columns.some((c) => c.name === column))
        .map((key) => key.onDelete);

    it.each([
      ["meal_logs", "meal_id", schema.mealLogs],
      ["workout_logs", "workout_id", schema.workoutLogs],
      ["day_plan_overrides", "meal_id", schema.dayPlanOverrides],
    ] as const)("%s.%s does not cascade", (_table, column, table) => {
      const behaviours = onDeleteFor(table, column);

      expect(behaviours).toHaveLength(1);
      expect(behaviours[0]).not.toBe("cascade");
    });

    it("the owning user_id still cascades, so the demo reaper works", () => {
      const key = getTableConfig(schema.mealLogs).foreignKeys.find((k) =>
        k.reference().columns.some((c) => c.name === "user_id"),
      );

      expect(key?.onDelete).toBe("cascade");
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
