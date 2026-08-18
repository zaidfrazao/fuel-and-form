import "server-only";

import { cookies } from "next/headers";

import { CURSOR_COOKIE, cursorCookieOptions, parseCursor, serialiseCursor } from "./cursor";
import type { Cursor } from "./resolve-now";

/**
 * The cursor, as the request sees it.
 *
 * The only file that puts `cursor.ts` together with a cookie jar, exactly as
 * `auth/session.ts` is the only file that puts `auth/cookies.ts` together with
 * one. Everything about the VALUE — its shape, its flags, how a malformed one is
 * refused — lives next door and is testable without a request; this is the
 * twelve lines that cannot be.
 *
 * Read by `app/page.tsx` on the way in and written by `app/actions/log.ts` on
 * the way out, which is the whole of its use.
 */

/** The manual advance so far, or `null` — no cookie, or one that is not a cursor. */
export async function readCursor(): Promise<Cursor | null> {
  return parseCursor((await cookies()).get(CURSOR_COOKIE)?.value);
}

/**
 * Moves the cursor, or clears it when there is none to write.
 *
 * `null` clears deliberately: `retreat()` returns `null` for "back to the start
 * of the day", which is expressed by having advanced past nothing rather than by
 * a cursor pointing at something. Undo therefore hands whatever it got straight
 * to this function and the two cases need no branch at the call site.
 *
 * ## Why the delete names a path
 *
 * A deletion is a `Set-Cookie` that expires immediately, and the browser applies
 * it only to a cookie matching the same name AND path. `delete(name)` sends no
 * Path, so it defaults to the path of the request that triggered it — which for
 * a Server Action is whatever route invoked it. The cookie was set at `path: "/"`,
 * so a mismatched delete would silently leave it in place and undo would appear
 * to work while the view stayed put. Same trap as `endSession`; same fix.
 */
export async function writeCursor(cursor: Cursor | null): Promise<void> {
  const jar = await cookies();
  const options = cursorCookieOptions();

  if (!cursor) {
    jar.delete({ name: CURSOR_COOKIE, path: options.path });

    return;
  }

  jar.set(CURSOR_COOKIE, serialiseCursor(cursor), options);
}
