"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { getSession } from "@/lib/auth/session";
import { DEMO_BANNER_COOKIE, demoBannerCookieOptions } from "@/lib/demo-banner";

/**
 * Dismissing the demo banner — FUEL-42, PRD § P7.
 *
 * The banner is rendered on the server so it is either in the first paint or
 * not at all; this is the other half of that arrangement, and the reason the
 * dismissal is a cookie rather than a `useState`. Client state would lose the
 * dismissal on the next full load, and `localStorage` would mean the banner is
 * painted and then removed — a flash on every screen, on the one session type
 * where the app is being judged in sixty seconds.
 *
 * `lib/demo-banner.ts` owns the cookie's name, its flags and what counts as
 * dismissed. This file is the four lines that need a cookie jar, exactly as
 * `cursor-cookie.ts` is for the cursor and `auth/session.ts` is for the session.
 *
 * ## Treated as a public endpoint, because it is one
 *
 * A Server Action is reachable by anyone who can POST to the app, whatever the
 * screen offers — the reasoning `actions/log.ts` and `login/actions.ts` both set
 * out. So the session is resolved HERE rather than taken from the caller, and
 * nothing about which account to write is sent over the wire. There is no
 * parameter to tamper with because there is no parameter.
 */

/**
 * Remembers that this visitor has dismissed the banner.
 *
 * ## Why it refuses a non-demo caller
 *
 * The owner has no banner to dismiss, so a call arriving on an owner session is
 * either a stray POST or a bug. Writing the cookie anyway would be harmless
 * today and would quietly become the mechanism by which some later banner is
 * suppressed for the owner before it is ever shown. Nothing is written, and the
 * caller is told nothing either — see below.
 *
 * ## Why it returns nothing, and never throws
 *
 * There is no failure a visitor could act on. A cookie that did not get written
 * means the banner is still there, which is the state they started in and can
 * simply dismiss again; a message about it would be a report of a problem they
 * do not have. Brand Guide § Feedback reserves an inline banner for a failure
 * that cost the user something, and this one costs nothing.
 *
 * It cannot throw either: `getSession` reads a cookie and, for a demo visitor,
 * one row. A thrown Server Action is a 500, and a 500 from the DISMISS button on
 * every screen would be a far worse outcome than a banner that stayed put.
 *
 * ## `refresh()` rather than a redirect or a revalidate
 *
 * The layout that renders the banner has to be re-rendered for it to disappear
 * on a client without JavaScript. `refresh()` is what asks the router for that
 * — the same call `actions/log.ts` uses when the screen has fallen behind the
 * database. Where JavaScript IS running, the button has already hidden itself
 * optimistically and this only makes the server agree.
 */
export async function dismissDemoBanner(): Promise<void> {
  try {
    const session = await getSession();

    if (session?.kind !== "demo") return;

    // The VALUE is the account it was dismissed for, so the next visit — a
    // different account — is told again that its changes are temporary. See the
    // note on `isBannerDismissed`.
    (await cookies()).set(DEMO_BANNER_COOKIE, session.userId, demoBannerCookieOptions());

    // Asks the router to re-render the layout that holds the banner. Only the
    // no-JavaScript path depends on it — everywhere else the button has already
    // hidden itself, and this is what makes the server agree rather than serve
    // the banner back on the next navigation.
    refresh();
  } catch (error) {
    // Named for whoever runs the app, and nothing for the visitor: the banner
    // simply stays, which is a state they can act on without being told.
    console.error("Could not dismiss the demo banner.", error);
  }
}
