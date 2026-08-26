import { getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { DEFAULT_WALK_REMINDER_AT } from "../walk-reminder";
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
    // Thirteen since FUEL-45: `shopping_checks` holds P8's per-week tick state,
    // which the PRD's data model describes no table for. Fourteen since
    // FUEL-47: `push_subscriptions` holds the address P9's notification is sent
    // to, which has to outlive the request that created it.
    expect(tables.map(([name]) => name).sort()).toEqual([
      "day_plan_overrides",
      "meal_ingredients",
      "meal_logs",
      "meals",
      "plan_template_entries",
      "profiles",
      "push_subscriptions",
      "shopping_checks",
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

    /**
     * FUEL-27. P3's "past sessions are editable by date" is only a coherent
     * claim if a date's session has ONE status — otherwise a correction is a
     * second row, and the screen, the dot grid and the export each need their
     * own rule for which of the two to believe.
     */
    it("workout_logs allows one status per (user, date, workout)", () => {
      const { indexes } = getTableConfig(schema.workoutLogs);
      const unique = indexes.find((index) => index.config.unique);

      expect(columnNames(unique?.config.columns ?? [])).toEqual([
        "user_id",
        "date",
        "workout_id",
      ]);
    });

    /**
     * The counterpart, and the reason the two log tables differ. A slot can
     * hold two meals — `lib/seed/plan.ts` puts two snacks on every weekday —
     * so `(user_id, date, slot)` is not unique here and duplicates are guarded
     * in `alreadyLogged` instead. Asserted for the same reason the
     * `plan_template_entries` case is: the absence looks like an oversight next
     * to the table above.
     */
    it("meal_logs allows a slot to be logged more than once on a date", () => {
      const { indexes } = getTableConfig(schema.mealLogs);

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

  describe("profiles.walk_reminder_at — FUEL-46, P9", () => {
    const column = () =>
      getTableConfig(schema.profiles).columns.find(
        (candidate) => candidate.name === "walk_reminder_at",
      );

    it("defaults to the time the app believes it defaults to", () => {
      // Written twice — a migration cannot import TypeScript — so this is what
      // stops the two drifting. If they did, settings would render a "default"
      // the database has never used, and a profile created by the seed would
      // remind at a time nothing in the code names.
      expect(column()?.default).toBe(DEFAULT_WALK_REMINDER_AT);
    });

    it("is nullable, because a reminder must be switchable off", () => {
      // P9's second criterion. A NOT NULL column would make "no reminder"
      // inexpressible, and the feature would need a second boolean to say the
      // same thing — one more state to disagree with this one.
      expect(column()?.notNull).toBe(false);
    });

    it("is text, so it holds the same 'HH:MM' every other time in the app is", () => {
      // A `time` column reads back as '19:00:00', which is not what `TimeOfDay`
      // means anywhere else — and the sentence on the banner prints it raw.
      expect(column()?.getSQLType()).toBe("text");
    });

    it("carries a CHECK, which slot_times cannot", () => {
      // The value is read from the ROOT LAYOUT. `slot-times.ts` sets out what
      // an unvalidated time costs in free-shaped jsonb — `/` broken on every
      // request — and this one would be every screen at once. The application
      // refuses a bad value on the way in; this is the half the database holds.
      const { checks } = getTableConfig(schema.profiles);

      expect(checks.map((c) => c.name)).toContain("profiles_walk_reminder_at_format");
    });
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
