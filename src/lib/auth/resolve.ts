import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { users, type UserKind } from "@/lib/db/schema";
import { verify } from "./token";

/**
 * Turns a cookie value into a user, or into nothing.
 *
 * This is the request boundary — the point where an untrusted string becomes an
 * identity that scope.ts will trust completely. Everything downstream assumes
 * the `userId` it is handed was earned, so every reason to doubt one has to be
 * spent here.
 *
 * ## The ladder
 *
 *   1. signature valid?            no query yet
 *   2. payload not expired?        no query yet
 *   3. userId shaped like a uuid?  no query yet
 *   4. row exists?
 *   5. users.kind matches the cookie it arrived in?
 *   6. users.expires_at absent or still in the future?
 *
 * Rungs 1–3 are what "rejected before any query runs" means: a forged cookie
 * costs a hash, not a round trip, so flooding the app with them cannot be used
 * to hammer the database either.
 *
 * Every rung returns exactly `undefined`. Not a reason, not a discriminated
 * union, not a thrown error — nothing a caller could render differently and so
 * nothing a visitor could probe. Testing Strategy § 1.4 case 5 asks that a
 * forged or expired session be "rejected with no data returned"; the uniformity
 * is what makes "rejected" indistinguishable from "never had one".
 *
 * ## Why both expiry checks
 *
 * The token carries its own signed expiry AND the row carries `expires_at`. The
 * signed one is free and stops most stale cookies without touching Postgres.
 * The row is the authoritative one: it is what the P7 reaper reads, what demo
 * provisioning (FUEL-40) sets, and the only one that can be shortened after a
 * cookie has been issued. A token outliving its row must lose, so the row is
 * checked even when the token says it is fine.
 *
 * ## Why the secret and the clock are arguments
 *
 * Same reason as token.ts: this file has to be drivable by the integration
 * suite against the real test branch, which has no request context and reads no
 * `SESSION_SECRET`. src/lib/auth/session.ts is the single place that resolves
 * both from the environment.
 */

/** A caller's proven identity. The `userId` scope() may be built with. */
export type Session = {
  userId: string;
  kind: UserKind;
};

/**
 * Matches the canonical uuid text form.
 *
 * `users.id` is a `uuid` column, and Postgres raises a syntax error rather than
 * returning no rows when compared against text that is not one. That error
 * would escape as a 500 — an observable difference between a malformed identity
 * and an absent one, which is the exact distinction this file exists to erase.
 * Reachable only by someone holding the signing secret, and refused anyway: the
 * promise is that the gate never throws, not that it usually doesn't.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveSession(
  token: string | undefined,
  expectedKind: UserKind,
  options: { secret: string; now: number },
): Promise<Session | undefined> {
  const payload = verify(token, options.secret, options.now);

  if (!payload || !UUID.test(payload.userId)) return undefined;

  const [user] = await getDb()
    .select({ id: users.id, kind: users.kind, expiresAt: users.expiresAt })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user) return undefined;

  // The cookie NAME carries the kind, so a demo token replayed under the owner
  // cookie is refused here even though its signature is perfectly good. Without
  // this, the two cookies would differ only in name — a distinction the browser
  // enforces and the server did not.
  if (user.kind !== expectedKind) return undefined;

  // Null means "never expires", which is the owner. Deliberately not encoded as
  // a distant date, so an owner and a long-lived demo stay different states.
  if (user.expiresAt !== null && user.expiresAt.getTime() <= options.now) return undefined;

  return { userId: user.id, kind: user.kind };
}
