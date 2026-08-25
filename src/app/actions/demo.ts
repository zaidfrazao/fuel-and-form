"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { startSession } from "@/lib/auth/session";
import { provisionDemoUser } from "@/lib/db/queries/demo";
import { hashClientIp } from "@/lib/demo";
import { sessionSecret } from "@/lib/env";

/**
 * "Try the demo" — FUEL-40, PRD § P7.
 *
 * The one endpoint in this app that writes rows for someone who has proved
 * nothing at all. That is the product requirement — "requires no credentials
 * and lands directly on a populated Right Now view" — and it is also why the
 * limits behind it are not optional: every call here creates an account and
 * roughly two hundred rows beneath it.
 *
 * ## Why this is a Server Action and not a link
 *
 * P7 asks that provisioning be "a POST behind a user action, so crawlers cannot
 * mass-create sessions". A GET would be followed by every crawler, preview
 * fetcher and link-unfurler that ever saw the login page, each one provisioning
 * an account nobody asked for. A Server Action is a POST by construction, and
 * the session cookies are `SameSite=Lax` (see auth/cookies.ts), so a POST from
 * another origin does not carry one either.
 *
 * ## Why the failures are distinguished here, and not in login/actions.ts
 *
 * `logIn` collapses every failure into one sentence because a message that
 * varies with the password is an oracle. Nothing here is a secret: both
 * refusals are facts about load, and telling a visitor which one they hit is
 * the difference between "wait two minutes" and "come back later". The
 * asymmetry between the two files is deliberate — see the note on `Refusal` in
 * src/lib/demo.ts.
 *
 * A thrown failure is the exception, and it IS collapsed: a missing
 * `SESSION_SECRET`, an unreachable database and a seed library that no longer
 * matches its template are all "could not start", because a visitor can do
 * nothing with any of them and the detail belongs in the server's log.
 */

/** What the form renders. `undefined` before the first submission. */
export type DemoState = { error: string } | undefined;

/**
 * The three sentences this action can produce.
 *
 * Brand Guide § Voice: plain and direct, and each one says what to do next
 * rather than only what went wrong.
 */
const MESSAGE = {
  "rate-limited": "You have opened several demos already. Try again in a few minutes.",
  "at-capacity": "The demo is at capacity right now. Try again in a little while.",
  failed: "The demo could not be started. Try again.",
} as const;

/**
 * Provisions a fresh demo account and signs the visitor into it.
 *
 * ## A fresh account every time, deliberately
 *
 * P7's criterion is that "each visit provisions an independent demo account",
 * and clicking the button is an explicit request for one. So a visitor already
 * holding a live demo cookie gets a NEW session rather than their old one back;
 * the previous account is simply orphaned and reaped on schedule. What keeps
 * that from being a way to fill the database is the rate limit, not a reuse
 * check — and a reuse check would also mean a visitor who wanted to start over
 * had no way to.
 *
 * The owner's cookie is untouched either way, because `startSession` writes one
 * kind of cookie and leaves the other alone. The owner can try their own demo
 * without being signed out of their own account.
 */
export async function startDemo(
  _previous: DemoState,
  _formData: FormData,
): Promise<DemoState> {
  let userId: string;

  try {
    // `x-forwarded-for` is what identifies a client for the rate limit. Vercel
    // rewrites it at the edge, so the first entry is trustworthy in production;
    // where it is absent or forged, `hashClientIp` still returns a bucket and
    // the site-wide cap — which reads none of this — still holds.
    const forwardedFor = (await headers()).get("x-forwarded-for");

    const provisioned = await provisionDemoUser(
      hashClientIp(forwardedFor, sessionSecret()),
      new Date(),
    );

    if (!provisioned.ok) return { error: MESSAGE[provisioned.refusal] };

    userId = provisioned.userId;

    // Issued only after the account and its whole library have committed. The
    // reverse order would hand out a cookie naming a user that a rolled-back
    // transaction never created, and resolve.ts would then refuse it — a
    // visitor bounced back to the login screen with no explanation at all.
    await startSession(userId, "demo");
  } catch (error) {
    // Names the failure for whoever runs the app. Nothing about the visitor is
    // interpolated: `forwardedFor` is out of scope here on purpose, and the
    // hash of it is not something a log needs.
    console.error("Could not provision a demo session.", error);

    return { error: MESSAGE.failed };
  }

  // OUTSIDE the try, exactly as login/actions.ts is and for the same reason:
  // `redirect` works by throwing, so calling it inside would land in the catch
  // above and turn every successful provision into "could not be started" —
  // after an account had already been created and a cookie already set.
  redirect("/");
}
