import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { UserKind } from "@/lib/db/schema";
import { sessionSecret } from "@/lib/env";
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

/** The cookie a session of each kind travels in. */
const COOKIE = {
  owner: "ff_owner",
  demo: "ff_demo",
} as const satisfies Record<UserKind, string>;

/**
 * How long each kind of session lasts.
 *
 * The owner's is long because re-typing a password on a phone in a kitchen is
 * the friction the PRD's "<1.5s, one thumb" view exists to avoid. A demo's is
 * short because it is a visit, not an account, and because P7 reaps the rows
 * behind them — a cookie outliving its row is refused anyway (see resolve.ts),
 * so a long demo cookie would only produce confusing dead sessions.
 *
 * FUEL-40 sets `users.expires_at` when it provisions a demo user; this is the
 * cookie-side half and should be kept no longer than that.
 */
const LIFETIME = {
  owner: 30 * 24 * 60 * 60 * 1000,
  demo: 2 * 60 * 60 * 1000,
} as const satisfies Record<UserKind, number>;

/**
 * The flags every session cookie carries, defined once.
 *
 * Written as a function of the expiry rather than spread at each call site, so
 * `httpOnly` cannot be present on one cookie and forgotten on the other — the
 * failure mode of a copied options object, and one nothing would report.
 *
 * - `httpOnly` — no script reads it, so an XSS cannot lift the session.
 * - `sameSite: "lax"` — not sent on cross-site POSTs, which is what stands in
 *   for CSRF tokens here. Top-level GET navigations still carry it, so a link
 *   into the app from anywhere still lands signed in.
 * - `secure` — https only. Off ONLY in `next dev`, where the app is served over
 *   http://localhost and a Secure cookie would be dropped by the browser with
 *   no error at all: login would appear to succeed and simply not work. It is
 *   on in production and in every other NODE_ENV, including test.
 * - `path: "/"` — one session for the whole app; a narrower path would silently
 *   sign the user out on routes it does not cover.
 */
const cookieOptions = (expiresAt: Date) =>
  ({
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  }) as const;

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
 */
export async function endSession(kind: UserKind): Promise<void> {
  (await cookies()).delete(COOKIE[kind]);
}
