import { parseCalendarDate } from "./date";
import type { Cursor } from "./resolve-now";

/**
 * The manual advance, as a cookie — the storage half of `resolve-now.ts`'s
 * cursor.
 *
 * `resolve-now.ts` deliberately leaves this open: the cursor is "held by the
 * caller — a URL parameter, a cookie, a `useState`". This file makes the choice
 * for P1, and the choice is a cookie, because the guarantee the PRD attaches to
 * a tap is that the view "is never wrong for longer than one tap" — a promise
 * that has to survive the phone being locked and the screen being reopened.
 * Client state would lose it on the next render; a URL parameter would put a
 * view position into a link that could then be shared or bookmarked wrong.
 *
 * Pure, and deliberately NOT `server-only`, for the same reason `auth/cookies.ts`
 * is not: the parsing here handles untrusted input, and something that only ever
 * runs behind a real request is something no test can hold still.
 * `cursor-cookie.ts` is what applies it to an actual cookie jar.
 *
 * ## Why it is not signed, when the session cookie is
 *
 * A session cookie is a claim about WHO you are, so forging one has to be
 * impossible. This is a claim about where in your own day you have got to, and
 * the only thing forging one achieves is the same screen you would get by
 * tapping Skip. There is nothing here to protect, so a signature would be
 * ceremony that implies a threat that does not exist.
 *
 * It is still `httpOnly`: no script needs to read it, and the narrower the
 * surface the less there is to reason about later.
 *
 * ## Why it has no expiry
 *
 * The cursor carries the date it was set on, and `resolveNow` ignores one whose
 * date is not today — so a stale cursor is already inert without anything having
 * to remove it. An `expires` here would be a second, weaker copy of that rule,
 * and one that could disagree with it: the day boundary is the user's configured
 * timezone, which a cookie deadline set on a server has no access to.
 */

/** The cookie the cursor travels in. */
export const CURSOR_COOKIE = "ff_cursor";

/**
 * The two fields, separated by a byte that cannot occur in either.
 *
 * A pipe rather than JSON: the value is `date` and an item key, both of which
 * are `[A-Za-z0-9:-]` by construction (`YYYY-MM-DD`, and `meal:<uuid>` /
 * `workout:<uuid>` from `resolve-now.ts`). JSON would mean a parse that can
 * throw on input a stranger controls, for a value with exactly one shape.
 */
const SEPARATOR = "|";

/** The cursor as a cookie value. */
export function serialiseCursor(cursor: Cursor): string {
  return `${cursor.date}${SEPARATOR}${cursor.advancedPast}`;
}

/**
 * A cookie value back to a cursor, or `null` for anything else.
 *
 * Never throws. Every branch here is reachable by anyone who can edit a cookie,
 * and the honest answer to a value this does not recognise is the same as the
 * answer to no cookie at all: no manual advance, and the clock decides. A throw
 * would turn a malformed cookie into a 500 on `/` — the one screen that must
 * render.
 *
 * The date is validated through `parseCalendarDate` rather than a pattern of its
 * own, so '2026-02-30' is rejected here exactly as it is everywhere else. The
 * key is checked only for being non-empty: an item key the day does not hold is
 * already handled by `cursorIndex`, which falls back to the clock, and a second
 * opinion about what a valid key looks like would be one more thing to keep in
 * agreement with `resolve-now.ts`.
 */
export function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;

  const separator = raw.indexOf(SEPARATOR);

  if (separator === -1) return null;

  const date = raw.slice(0, separator);
  const advancedPast = raw.slice(separator + 1);

  if (!advancedPast) return null;

  try {
    parseCalendarDate(date);
  } catch {
    return null;
  }

  return { date, advancedPast };
}

/** What `cookies().set()` is handed. Structural, so nothing has to be imported. */
export type CursorCookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
};

/**
 * The flags the cursor cookie carries.
 *
 * The same shape as `auth/cookies.ts` minus `expires` (see above), and `secure`
 * is conditional there for the same reason it is here: a browser silently
 * DISCARDS a `Secure` cookie over `http://localhost`, so on `next dev` every tap
 * would appear to work and the view would snap back on the next render.
 */
export function cursorCookieOptions(): CursorCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
  };
}
