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
 * the hermetic unit suite cover it at 100% with no database and no credentials,
 * so the gate can run anywhere — including a CI job, once one exists. See
 * scope.test.ts.
 *
 * ## Why no method here returns a query builder
 *
 * Drizzle removes `where` from a builder's type once it has been called, so a
 * second call fails to compile. That is not enough on its own, twice over:
 *
 *   1. The method still exists at runtime. Calling it REPLACES the predicate
 *      rather than narrowing it, so `as any` in front of it silently drops the
 *      ownership filter.
 *   2. `.$dynamic()` restores the removed methods deliberately, and it needs no
 *      cast at all. Handed a builder, a caller could write:
 *
 *          scope(uid, db).delete(table).$dynamic().where(eq(table.kcal, 500))
 *
 *      which compiles cleanly and emits `delete from "t" where "kcal" = $1` —
 *      every user's rows, not just theirs.
 *
 * So these methods return results, never builders. Ordering and pagination are
 * arguments; there is no object left to reopen. Internally `$dynamic()` is used
 * to assemble the optional clauses, which is safe precisely because the builder
 * never leaves this file.
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
 * What an upsert collides on, and what it writes when it does.
 *
 * `target` names the columns of the unique index BESIDES `user_id` — the scope
 * supplies that one itself, see `upsert`. At least one is required, which is a
 * compile-time shape rather than a runtime check: no table in this schema has a
 * unique index on `user_id` alone, so a bare target could only ever be a
 * mistake, and catching it in the type costs no branch.
 */
export type ScopedConflict<T extends ScopedTable> = {
  target: readonly [PgColumn, ...PgColumn[]];
  set: ScopedUpdate<T>;
};

/** A column or expression to order by — what `asc()` and `desc()` return. */
type OrderBy = PgColumn | SQL;

/** Ordering and pagination, as arguments rather than chained calls. */
export type SelectOptions = {
  orderBy?: OrderBy | OrderBy[];
  limit?: number;
  offset?: number;
};

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

const asArray = (value: OrderBy | OrderBy[]): OrderBy[] =>
  Array.isArray(value) ? value : [value];

/**
 * The fields an update is allowed to write — everything but `userId`.
 *
 * Stripped at runtime as well as in the type: an update that could rewrite the
 * owning column would be a way to hand a row to another user, which is the same
 * leak as reading one.
 *
 * Stripping can empty the set — an update whose only field was the one it is
 * not allowed to touch. Drizzle would raise "No values to set", which sends
 * whoever hits it looking for a typo in their column names rather than at the
 * attempted reassignment. Say what happened instead.
 *
 * Safe to throw: this depends only on the caller's own argument, never on
 * whether a row exists, so it distinguishes nothing about the data.
 */
function updatable(set: Record<string, unknown>, method: string): Record<string, unknown> {
  const owned: Record<string, unknown> = { ...set };
  delete owned.userId;

  if (Object.keys(owned).length === 0) {
    throw new Error(
      `scope.${method}() was called with no updatable fields. \`userId\` is owned ` +
        "by the scope and is removed from every update, so an update that " +
        "sets only `userId` sets nothing. Ownership cannot be reassigned here.",
    );
  }

  return owned;
}

/**
 * Binds a user to a database handle. Every query it runs is filtered to that
 * user.
 *
 * Both arguments are required and neither is defaulted, so a scope cannot be
 * constructed without deciding whose data it reads and which connection it
 * runs on:
 *
 *     const s = scope(session.userId, getDb());
 *
 *     const meals = await s.select(meals, undefined, { orderBy: asc(meals.at) });
 *     await s.insert(meals, { name: "Oats", kcal: 500 });
 *
 *     await getPool().transaction(async (tx) => {
 *       await scope(demoUserId, tx).insert(meals, rows);
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
    /** This user's rows, optionally narrowed, ordered and paginated. */
    async select<T extends ScopedTable>(
      table: T,
      where?: SQL,
      options?: SelectOptions,
    ): Promise<T["$inferSelect"][]> {
      // `from<T>(table as never)`: `.from()` guards against selecting from a
      // data-modifying subquery with a conditional type, which TypeScript
      // cannot reduce while `T` is still generic, so passing `table` directly
      // fails to compile. Naming the type argument keeps full row inference.
      // The guard is moot here — a ScopedTable is a table, never a subquery.
      let query = executor
        .select()
        .from<T>(table as never)
        .where(scopedWhere(table, userId, where))
        .$dynamic();

      if (options?.orderBy) query = query.orderBy(...asArray(options.orderBy));
      if (options?.limit !== undefined) query = query.limit(options.limit);
      if (options?.offset !== undefined) query = query.offset(options.offset);

      return (await query) as T["$inferSelect"][];
    },

    /**
     * At most one row, as `undefined` rather than a throw when there is none.
     *
     * This is the single-row read the app should reach for. Returning
     * `undefined` for both "absent" and "someone else's" is what keeps the two
     * indistinguishable to a caller — and therefore to a visitor.
     *
     * Pass `orderBy` when more than one row can match: without it, "the one
     * row" is whichever Postgres happens to return first, which is not stable.
     */
    async selectOne<T extends ScopedTable>(
      table: T,
      where?: SQL,
      options?: Pick<SelectOptions, "orderBy">,
    ): Promise<T["$inferSelect"] | undefined> {
      const rows = await this.select(table, where, { ...options, limit: 1 });

      return rows.at(0);
    },

    /**
     * Writes rows as this user and returns them.
     *
     * `userId` is spread on LAST, so a value that arrives carrying one anyway —
     * from `JSON.parse`, a widened type, or a cast — is overwritten rather than
     * honoured. The type forbids it; this makes the type's absence survivable.
     */
    async insert<T extends ScopedTable>(
      table: T,
      values: ScopedInsert<T> | ScopedInsert<T>[],
    ): Promise<T["$inferSelect"][]> {
      const owned = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...row,
        userId,
      }));

      return (await executor
        .insert(table)
        .values(owned as T["$inferInsert"][])
        .returning()) as T["$inferSelect"][];
    },

    /**
     * Writes rows, updating any already occupying their unique slots.
     *
     * The write behind a swap (FUEL-23): `day_plan_overrides` is unique on
     * `(user_id, date, slot)`, so swapping the same slot twice has to land on
     * the row that is already there rather than beside it. Doing that as
     * "update, and insert if nothing changed" would leave a window between the
     * two statements in which a second swap of the same slot inserts, so the
     * first one's insert then violates the constraint. `ON CONFLICT` closes the
     * window because Postgres resolves it inside one statement.
     *
     * ## The scope owns the conflict target
     *
     * `conflict.target` names the columns BESIDES `user_id`, and `userId` is
     * prepended here. That is the whole security argument, and it is why the
     * target is not simply passed through: an arbiter index that omitted
     * `user_id` would collide one user's row with another's and quietly
     * overwrite it — a leak that looks like nothing at all in review, since the
     * statement still carries a `user_id` in its VALUES.
     *
     * Because the inferred index necessarily includes `user_id`, a row that
     * conflicts is by construction this user's own. So the DO UPDATE half needs
     * no ownership predicate of its own: there is no reachable state in which it
     * could touch someone else's row.
     *
     * Postgres infers the arbiter from the SET of columns rather than their
     * order, so prepending rather than appending changes nothing about which
     * index is matched.
     *
     * ## One row or many, in ONE statement
     *
     * The array form is FUEL-24's repeat: the same meal onto a run of
     * consecutive dates. It takes the union `insert` already takes, so the
     * scope's two write methods do not disagree with each other about their own
     * shape, and `userId` is stamped onto EVERY row rather than onto the first.
     *
     * A batch is one statement rather than a loop for a reason the caller
     * cannot supply itself: a loop can be interrupted between iterations, so a
     * repeat could land on Tuesday and Wednesday and not Thursday, leaving a
     * plan that is half of what the button said. One statement is atomic, so a
     * repeat either happens or does not — and it needs no transaction wrapper
     * to be so, which keeps `queries/` free of the pool handle.
     *
     * The one thing a caller must guarantee: the rows in a batch must not
     * collide with EACH OTHER on the arbiter. Postgres refuses a single
     * `INSERT ... ON CONFLICT DO UPDATE` that would affect the same row twice —
     * "cannot affect row a second time" — and it is a runtime error, not a
     * type error. For the repeat the slot is fixed and `repeatDates` returns
     * strictly increasing distinct dates, so no two rows share `(date, slot)`
     * and the case is unreachable; `repeat.test.ts` asserts that distinctness
     * explicitly rather than leaving it as an assumption about a helper.
     */
    async upsert<T extends ScopedTable>(
      table: T,
      values: ScopedInsert<T> | ScopedInsert<T>[],
      conflict: ScopedConflict<T>,
    ): Promise<T["$inferSelect"][]> {
      const set = updatable(conflict.set, "upsert");

      // The scope supplies ownership; the caller must not. Passing it too would
      // emit `on conflict ("user_id","user_id",…)`, which Postgres rejects with
      // a message about the SQL rather than about the mistake — and a caller
      // reading this signature could reasonably think naming it is required.
      // Same reasoning as `updatable`'s throw: say what happened, and do it
      // from the caller's own argument so nothing about the data leaks.
      if (conflict.target.some((column) => column === table.userId)) {
        throw new Error(
          "scope.upsert() was given `userId` in its conflict target. The scope " +
            "prepends it, so ownership is always part of the arbiter index — " +
            "name only the other columns of the unique constraint.",
        );
      }

      // Normalised exactly as `insert` does, and for the same reason: one code
      // path stamps ownership, so the singular case cannot acquire a guarantee
      // the batch case lacks.
      const owned = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...row,
        // Spread last, exactly as `insert` does, so a smuggled `userId` is
        // overwritten rather than honoured — on every row, not just the first.
        userId,
      }));

      return (await executor
        .insert(table)
        .values(owned as T["$inferInsert"][])
        .onConflictDoUpdate({
          target: [table.userId, ...conflict.target],
          set: set as PgUpdateSetSource<T>,
        })
        .returning()) as T["$inferSelect"][];
    },

    /**
     * Updates only this user's rows and returns those it changed.
     *
     * `userId` is stripped from the set — see `updatable`, which is also what
     * gives `upsert` the same guarantee from the same code.
     */
    async update<T extends ScopedTable>(
      table: T,
      set: ScopedUpdate<T>,
      where?: SQL,
    ): Promise<T["$inferSelect"][]> {
      return (await executor
        .update(table)
        .set(updatable(set, "update") as PgUpdateSetSource<T>)
        .where(scopedWhere(table, userId, where))
        .returning()) as T["$inferSelect"][];
    },

    /**
     * Deletes only this user's rows and returns those it removed.
     *
     * Another user's row is not matched, so even an unqualified delete stops at
     * the scope boundary rather than emptying the table.
     */
    async delete<T extends ScopedTable>(table: T, where?: SQL): Promise<T["$inferSelect"][]> {
      return (await executor
        .delete(table)
        .where(scopedWhere(table, userId, where))
        .returning()) as T["$inferSelect"][];
    },
  };
}

/** The bound scope — `ReturnType` so the shape has one definition, above. */
export type Scope = ReturnType<typeof scope>;
