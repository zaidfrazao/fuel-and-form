import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";

/**
 * The choke point every user-owned query passes through.
 *
 * The PRD promises strangers on a public URL that a demo session cannot reach
 * the owner's data (§ Security & Compliance). This file is what makes that
 * provable rather than aspirational: ownership lives in the WHERE clause of
 * every statement, composed here, never by the caller.
 *
 * Deliberately NOT `server-only`. It constructs queries and holds no
 * connection or secret — the executor carries those. Staying pure is what lets
 * the hermetic unit suite cover it at 100% and run that gate in CI, where no
 * database exists. See scope.test.ts.
 *
 * ## Why the caller passes a predicate instead of chaining `.where()`
 *
 * Drizzle removes `where` from a builder's TYPE once it has been called, so
 * `tsc` rejects a second call. The method still exists at runtime, and calling
 * it REPLACES the predicate rather than narrowing it:
 *
 *     .where(eq(t.userId, 'u1')).where(eq(t.kcal, 500))
 *       ->  where "kcal" = $1        -- the owner check is simply gone
 *
 * A single `as any` between a caller and that method leaks every row of every
 * user, with no error and nothing for a reviewer to notice. So every method
 * below takes the caller's extra condition as an ARGUMENT and performs the
 * `and()` itself. The builders handed back have `where` already spent and
 * type-removed; narrowing is only expressible through this file.
 */

/** Any table carrying a `user_id` column — i.e. every user-owned table. */
export type ScopedTable = PgTable & { userId: PgColumn };

/**
 * Insert values minus the column the scope owns.
 *
 * The caller cannot name `userId` at all: not to set it correctly, and not to
 * set it to someone else's. There is exactly one place it comes from.
 */
export type ScopedInsert<T extends ScopedTable> = Omit<T["$inferInsert"], "userId">;

/** Update values minus `userId`, so no update can hand a row to another user. */
export type ScopedUpdate<T extends ScopedTable> = Omit<PgUpdateSetSource<T>, "userId">;

/**
 * What the scope needs from a database handle.
 *
 * Both `getDb()` (neon-http) and a `getPool().transaction()` handle extend
 * `PgDatabase`, so demo provisioning — create the demo user, copy the owner's
 * meals in one commit — uses the same scope as every ordinary request rather
 * than a parallel unscoped path. That symmetry is the point: a second way to
 * write rows is a second way to get the scoping wrong.
 *
 * The three generics carry the driver's result types and its schema. They
 * differ between the HTTP driver and a transaction handle, and the scope reads
 * none of them, so pinning them here would exclude one of the two callers for
 * no gain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate; see above.
type Executor = PgDatabase<any, any, any>;

/**
 * Combines the ownership predicate with the caller's, ownership first.
 *
 * The cast is safe by construction: `and()` returns undefined only when every
 * argument is undefined, and `owner` is never undefined. Asserting that at
 * runtime would add a branch no test could reach.
 */
function scopedWhere(table: ScopedTable, userId: string, extra?: SQL): SQL {
  const owner = eq(table.userId, userId);

  return extra ? (and(owner, extra) as SQL) : owner;
}

/**
 * Binds a user to a database handle. Every query built from the result is
 * filtered to that user.
 *
 * Both arguments are required and neither is defaulted, so a scope cannot be
 * constructed without deciding whose data it reads and which connection it
 * runs on:
 *
 *     const s = scope(session.userId, getDb());
 *     const meals = await s.select(mealsTable);
 *
 *     await getPool().transaction(async (tx) => {
 *       await scope(demoUserId, tx).insert(mealsTable, rows);
 *     });
 *
 * ## On "not yours" versus "not there"
 *
 * There is no get-by-id-then-check-owner method here, and there must never be
 * one. That shape distinguishes "exists but belongs to someone else" from
 * "does not exist" — typically as 403 versus 404 — which lets a demo visitor
 * enumerate the owner's row ids by watching which error comes back. Because
 * ownership is part of the WHERE clause, both cases collapse to the same
 * answer: no rows. Callers render a single not-found and learn nothing.
 */
export function scope(userId: string, executor: Executor) {
  return {
    /**
     * Rows belonging to this user, optionally narrowed further.
     *
     * Returns a builder, so `.orderBy()`, `.limit()` and `.offset()` still
     * chain — but `where` is spent, so the ownership filter is not removable.
     *
     * `from<T>(table as never)`: `.from()` guards against selecting from a
     * data-modifying subquery with a conditional type, which TypeScript cannot
     * reduce while `T` is still generic, so passing `table` directly fails to
     * compile. Naming the type argument keeps full row inference — callers get
     * real column types, not `unknown` — and `never` satisfies the parameter.
     * The guard is irrelevant here anyway: `ScopedTable` is a table, never a
     * subquery.
     */
    select<T extends ScopedTable>(table: T, where?: SQL) {
      return executor
        .select()
        .from<T>(table as never)
        .where(scopedWhere(table, userId, where));
    },

    /**
     * At most one row, as `undefined` rather than a throw when there is none.
     *
     * This is the single-row read the app should reach for. Returning
     * `undefined` for both "absent" and "someone else's" is what keeps the two
     * indistinguishable to a caller — and therefore to a visitor.
     */
    async selectOne<T extends ScopedTable>(
      table: T,
      where?: SQL,
    ): Promise<T["$inferSelect"] | undefined> {
      const rows = await executor
        .select()
        .from<T>(table as never)
        .where(scopedWhere(table, userId, where))
        .limit(1);

      return rows.at(0) as T["$inferSelect"] | undefined;
    },

    /**
     * Writes rows as this user.
     *
     * `userId` is spread on LAST, so a value that arrives carrying one anyway —
     * from `JSON.parse`, a widened type, or a cast — is overwritten rather than
     * honoured. The type forbids it; this makes the type's absence survivable.
     */
    insert<T extends ScopedTable>(table: T, values: ScopedInsert<T> | ScopedInsert<T>[]) {
      const owned = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...row,
        userId,
      }));

      return executor.insert(table).values(owned as T["$inferInsert"][]);
    },

    /**
     * Updates only this user's rows.
     *
     * `userId` is stripped at runtime as well as in the type: an update that
     * could rewrite the owning column would be a way to hand a row to another
     * user, which is the same leak as reading one.
     */
    update<T extends ScopedTable>(table: T, set: ScopedUpdate<T>, where?: SQL) {
      const owned: Record<string, unknown> = { ...set };
      delete owned.userId;

      // Stripping user_id can empty the set — an update whose only field was
      // the one it is not allowed to touch. Drizzle would raise "No values to
      // set", which sends whoever hits it looking for a typo in their column
      // names rather than at the attempted reassignment. Say what happened.
      //
      // Safe to throw: this depends only on the caller's own argument, never on
      // whether a row exists, so it distinguishes nothing about the data.
      if (Object.keys(owned).length === 0) {
        throw new Error(
          "scope.update() was called with no updatable fields. `userId` is owned " +
            "by the scope and is removed from every update, so an update that " +
            "sets only `userId` sets nothing. Ownership cannot be reassigned here.",
        );
      }

      return executor
        .update(table)
        .set(owned as PgUpdateSetSource<T>)
        .where(scopedWhere(table, userId, where));
    },

    /** Deletes only this user's rows. Another user's row is simply not matched. */
    delete<T extends ScopedTable>(table: T, where?: SQL) {
      return executor.delete(table).where(scopedWhere(table, userId, where));
    },
  };
}

/** The bound scope — `ReturnType` so the shape has one definition, above. */
export type Scope = ReturnType<typeof scope>;
