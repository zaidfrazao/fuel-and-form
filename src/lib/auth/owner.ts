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
 */
export async function ownerUserId(): Promise<string> {
  const db = getDb();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.kind, "owner"))
    .limit(1);

  if (existing) return existing.id;

  // A placeholder FUEL-15 overwrites. Nothing personal is committed to this
  // repository, and the display name is not used to authenticate anything.
  const [created] = await db
    .insert(users)
    .values({ kind: "owner", displayName: "Owner" })
    .returning({ id: users.id });

  // `noUncheckedIndexedAccess` makes Drizzle's array return honest. An insert
  // that produced no row is a broken database, not a wrong password, and the
  // message says so rather than surfacing as a null-property error later.
  if (!created) throw new Error("Could not create the owner account.");

  return created.id;
}
