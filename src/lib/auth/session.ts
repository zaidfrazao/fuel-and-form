import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { UserKind } from "@/lib/db/schema";
import { sessionSecret } from "@/lib/env";
import { COOKIE, cookieOptions, LIFETIME } from "./cookies";
import { resolveSession, type Session } from "./resolve";
import { sign } from "./token";

/**
 * Sessions, as the request sees them.
 *
 * The only file here that touches `next/headers`, and the only one that reads
 * `SESSION_SECRET`. Everything below it — token.ts, resolve.ts — takes the
 * secret and the clock as arguments, which is what makes them testable without
 * a request. Keeping that boundary in one small file is the point of the split.
 *
 * ## Two cookies, not one with a field in it
 *
 * The PRD asks for a separate signed cookie for demo sessions (§ Stack → Auth).
 * The cookie NAME carries the kind and the payload does not repeat it, so there
 * is one fact rather than two that could disagree. resolve.ts then checks the
 * name against `users.kind`, so a genuine demo token replayed in the owner jar
 * is refused despite a perfect signature.
 *
 * Separate cookies also make logging out of one leave the other alone, which is
 * what lets the owner try the demo on their own machine without being signed
 * out of their own account.
 */

/**
 * The current session, or `undefined`.
 *
 * Owner first: on a machine holding both cookies — the owner having tried their
 * own demo — the owner's own data is what they should see. This cannot be an
 * escalation path, because a demo visitor has no way to produce a valid owner
 * cookie; the ordering only decides which of two legitimate sessions wins.
 *
 * `cache` memoises this for one render pass, so a page, its layout and three
 * components asking who is signed in cost one database round trip rather than
 * five. It is per-request by construction — React discards the cache between
 * them — so no session can leak into another visitor's render.
 */
export const getSession = cache(async (): Promise<Session | undefined> => {
  const jar = await cookies();
  const options = { secret: sessionSecret(), now: Date.now() };

  return (
    (await resolveSession(jar.get(COOKIE.owner)?.value, "owner", options)) ??
    (await resolveSession(jar.get(COOKIE.demo)?.value, "demo", options))
  );
});

/**
 * Issues a session cookie. Call only after the caller has proven who they are.
 *
 * The cookie's own expiry is signed INTO the token as well as set on the
 * cookie, because the browser's copy is advisory: a client that keeps sending
 * an expired cookie is not misbehaving in any way the server can prevent, so
 * the server has to carry its own copy of the deadline.
 */
export async function startSession(userId: string, kind: UserKind): Promise<void> {
  const expiresAt = new Date(Date.now() + LIFETIME[kind]);
  const token = sign({ userId, expiresAt: expiresAt.getTime() }, sessionSecret());

  (await cookies()).set(COOKIE[kind], token, cookieOptions(expiresAt));
}

/**
 * Clears one kind of session.
 *
 * One kind, not both: signing out of a demo must not sign the owner out of
 * their own account on their own machine.
 *
 * ## Why `path` is passed to a delete
 *
 * A deletion is just a `Set-Cookie` that expires immediately, and the browser
 * only applies it to a cookie matching the same name AND path. `delete(name)`
 * sends no Path, which defaults to the path of the request that triggered it —
 * so signing out from anywhere other than `/` would expire a cookie scoped to
 * that route while the real one, set at `path: "/"`, survived untouched.
 *
 * The failure is silent and looks like nothing: the user is redirected to the
 * login screen, believes they are out, and is still signed in. Naming the path
 * matches what `cookieOptions` set.
 */
export async function endSession(kind: UserKind): Promise<void> {
  (await cookies()).delete({ name: COOKIE[kind], path: cookieOptions(new Date()).path });
}
