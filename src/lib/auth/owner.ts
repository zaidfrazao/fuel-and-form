import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * The owner's `users.id`, creating the row if this is the first sign-in.
 *
 * ## Why this touches a raw handle
 *
 * `users` is the one table `scope()` cannot read: it carries no `user_id`,
 * because its own `id` IS the user (see the note on the table in schema.ts).
 * Resolving an identity necessarily happens before there is an identity to
 * scope by, so the auth layer is the one place an unscoped handle is correct —
 * and eslint.config.mjs names these files individually rather than exempting a
 * directory, so a future file here cannot quietly inherit the permission.
 *
 * Every query below is against `users` alone. Nothing user-owned is read here.
 *
 * ## Why the row is created rather than required
 *
 * The session cookie carries a uuid, so a row must exist before anyone can be
 * signed in as anybody. Seeding the owner's real profile and library is
 * FUEL-15; creating the bare row here is what lets a fresh deployment accept a
 * correct password instead of failing in a way indistinguishable from a wrong
 * one.
 *
 * The caller must have verified the password first — see src/app/login/actions.ts.
 * Nothing unauthenticated reaches this.
 *
 * ## Why the insert comes first, and why it cannot duplicate
 *
 * The obvious shape — select, and insert if absent — is a race: two logins on a
 * fresh deployment both read "no owner" and both insert, leaving two owner
 * identities with nothing to choose between them. No error is raised and the
 * damage is silent, which is the worst kind.
 *
 * `users_single_owner_key`, a partial unique index on `kind = 'owner'`, makes
 * one owner a fact Postgres enforces. `onConflictDoNothing` then turns the
 * loser of a race into an empty `returning()` rather than an exception, and the
 * select below picks up the row the winner made. Attempting the insert FIRST is
 * what removes the window entirely: there is no gap between deciding the row is
 * absent and creating it, because the database decides both at once.
 *
 * Steady state — every login after the first — costs one extra no-op insert.
 * That is a fair price for a correctness property that cannot be got in
 * application code at any price.
 */
export async function ownerUserId(): Promise<string> {
  const db = getDb();

  // A placeholder FUEL-15 overwrites. Nothing personal is committed to this
  // repository, and the display name authenticates nothing.
  const [created] = await db
    .insert(users)
    .values({ kind: "owner", displayName: "Owner" })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (created) return created.id;

  // Empty `returning()` means the row already existed — either from an earlier
  // login or from the other side of a race that has now committed.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.kind, "owner"))
    .limit(1);

  // Neither branch produced a row: the insert was refused and the select found
  // nothing. That is a broken database, not a wrong password, and it says so
  // rather than surfacing as a null-property error somewhere later.
  if (!existing) throw new Error("Could not resolve or create the owner account.");

  return existing.id;
}
