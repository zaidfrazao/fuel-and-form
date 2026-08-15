import { type SQL, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as schema from "@/lib/db/schema";
import type { ScopedTable } from "@/lib/db/scope";

/**
 * The schema's tables, walked rather than listed.
 *
 * Testing Strategy § 1.4 case 3 asks whether an export can reach another user's
 * data. An export is, at bottom, "read everything this user owns" — so the
 * honest way to ask it is over EVERY user-owned table, not a hand-picked few.
 * Walking the module means a table added in a later task is swept the moment it
 * is exported, which a checklist someone must remember to extend would not be.
 *
 * `src/lib/db/schema.test.ts` performs the same walk, hermetically, to assert
 * every table carries `user_id` in the first place. The duplication is
 * deliberate: that file must not import from `tests/`, and this one must not
 * depend on a unit test having run.
 */

/**
 * Tables that legitimately have no `user_id`, and so cannot go through `scope()`.
 *
 * `users` is the only one: its own `id` IS the owner, and resolving a session
 * cookie to a user necessarily happens before there is a user to scope by. Kept
 * in step with the same set in `schema.test.ts` — widening either is a
 * deliberate widening of the demo-isolation boundary.
 */
const EXEMPT = new Set(["users"]);

/**
 * Every `pgTable` the schema module exports, paired with its SQL name.
 *
 * Widened to `unknown[]` first: the module also exports enums, and TypeScript
 * will not narrow a union of specific table types down to the generic `PgTable`
 * the drizzle helpers want.
 */
export const allTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => [getTableName(table), table] as const);

/**
 * The tables a scope can reach — i.e. everything an export would read.
 *
 * Cast to `ScopedTable` because `schema.test.ts` has already proved, without a
 * database, that every one of them carries a non-null `user_id` exposed as
 * `userId`. Re-deriving that here would be asserting the same thing twice and
 * would still need the cast to satisfy `scope()`.
 */
export const userOwnedTables = allTables
  .filter(([name]) => !EXEMPT.has(name))
  .map(([name, table]) => [name, table as ScopedTable] as const);

/** The narrowest thing that can run a statement — both drivers satisfy it. */
type Executes = { execute: (query: SQL) => Promise<unknown> };

/**
 * Empties every table, in one statement.
 *
 * `cascade` because the tables reference each other; `restart identity` so a run
 * cannot pass by coincidence on sequence values left by the previous one. One
 * statement rather than a loop means no ordering to get wrong — and truncating
 * unconditionally, rather than deleting by `user_id`, keeps the teardown from
 * assuming the scoping it is about to test.
 */
export async function truncateAll(db: Executes): Promise<void> {
  // The walk finding nothing would emit `truncate table  restart identity
  // cascade` and fail as a syntax error, sending whoever hits it to the SQL
  // rather than to the export shape it actually came from.
  if (allTables.length === 0) {
    throw new Error("Found no tables to truncate — the walk over the schema module found none.");
  }

  const names = allTables.map(([name]) => `"${name}"`).join(", ");

  await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}
