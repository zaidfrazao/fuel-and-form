import type { UserKind } from "@/lib/db/schema";

/**
 * The shape of a session cookie: its name, its lifetime, and its flags.
 *
 * Pure, and deliberately not `server-only`, for the same reason token.ts is
 * not: these are the security properties the PRD names explicitly (§ Security &
 * Compliance — "Session cookies are HTTP-only, `Secure`, and `SameSite=Lax`"),
 * and a property that is only ever exercised by a running browser is one no
 * test can hold still. Separated out, the hermetic suite asserts them and the
 * coverage gate keeps every branch measured.
 *
 * session.ts is what applies these to an actual cookie jar.
 */

/** The cookie a session of each kind travels in. */
export const COOKIE = {
  owner: "ff_owner",
  demo: "ff_demo",
} as const satisfies Record<UserKind, string>;

/**
 * How long each kind of session lasts, in milliseconds.
 *
 * The owner's is long because re-typing a password on a phone in a kitchen is
 * the friction the PRD's "<1.5s, one thumb" view exists to avoid. A demo's is
 * short because it is a visit, not an account, and because P7 reaps the rows
 * behind them — a cookie outliving its row is refused anyway (see resolve.ts),
 * so a longer demo cookie would only produce confusing dead sessions.
 *
 * FUEL-40 sets `users.expires_at` when it provisions a demo user; this is the
 * cookie-side half and must be kept no longer than that.
 */
export const LIFETIME = {
  owner: 30 * 24 * 60 * 60 * 1000,
  demo: 2 * 60 * 60 * 1000,
} as const satisfies Record<UserKind, number>;

/** What `cookies().set()` is handed. Structural, so nothing has to be imported. */
export type SessionCookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
};

/**
 * The flags every session cookie carries, built in one place.
 *
 * A function of the expiry rather than an object spread at each call site, so
 * `httpOnly` cannot end up present on one cookie and forgotten on the other —
 * the failure mode of a copied options object, and one nothing would report.
 *
 * - `httpOnly` — no script reads it, so an XSS cannot lift the session.
 * - `sameSite: "lax"` — not sent on cross-site POSTs, which is what stands in
 *   for CSRF tokens here. Top-level GET navigations still carry it, so a link
 *   into the app from anywhere still arrives signed in.
 * - `secure` — https only, and the one conditional here. See below.
 * - `path: "/"` — one session for the whole app; a narrower path would sign the
 *   user out on routes it did not cover, silently.
 *
 * ## The one conditional
 *
 * `next dev` serves over `http://localhost`, where a browser DISCARDS a Secure
 * cookie without an error of any kind — login would appear to succeed and
 * simply not work, which is a worse failure than an insecure local cookie. So
 * `secure` is off in development and on everywhere else, test and production
 * alike. The deviation is narrow, deliberate, and asserted in cookies.test.ts
 * rather than left as a comment.
 */
export function cookieOptions(expiresAt: Date): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  };
}
