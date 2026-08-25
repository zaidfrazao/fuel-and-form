/**
 * The demo banner's copy, its link, and the cookie that hides it — FUEL-42,
 * PRD § P7, Brand Guide § UI Copy.
 *
 * P7 asks for "a persistent, dismissible banner [that] marks the session as a
 * demo and links to the repository". Persistent and dismissible pull against
 * each other, and the whole of this file is where that tension is resolved: the
 * banner is on every screen for as long as the session lasts, dismissing it
 * lasts for that session, and the next visit — which is a different account —
 * sees it again.
 *
 * Pure, and deliberately NOT `server-only`, for the reason `auth/cookies.ts`
 * and `cursor.ts` are not: a cookie flag that is only ever exercised by a
 * running browser is a flag no test can hold still, and losing one looks
 * identical until someone reads the cookie. `app/actions/demo-banner.ts` is
 * what applies these to an actual cookie jar.
 */

/**
 * The sentence, exactly as the Brand Guide writes it.
 *
 * Split into the statement and the link's own text, because they are one
 * sentence with a link at the end rather than a sentence and a button. The
 * table in § UI Copy pairs it with what it must not be — "Welcome to the demo!
 * Feel free to explore! 👋" — so this constant is checked character for
 * character by its test. Voice is the kind of thing that erodes one friendly
 * edit at a time, and a string nobody asserts is where that starts.
 *
 * The dash is an em dash with spaces around it, matching every other `/ `
 * secondary fact in the app.
 */
export const BANNER_COPY = {
  statement: "Demo session — your changes are temporary.",
  link: "View the source.",
} as const;

/**
 * Where the link goes.
 *
 * Hard-coded rather than an environment variable. The repository URL is the one
 * fact about this deployment that is already public — it is in `package.json`,
 * in the README, and on the page this link sits on — so a variable would add a
 * per-deployment configuration step whose only failure mode is a portfolio piece
 * whose "View the source" link goes nowhere.
 */
export const REPOSITORY_URL = "https://github.com/zaidfrazao/fuel-and-form";

/** The cookie a dismissal is remembered in. */
export const DEMO_BANNER_COOKIE = "ff_demo_banner";

/**
 * Whether the banner has been dismissed for THIS session.
 *
 * ## Why the cookie holds a user id rather than a flag
 *
 * A flag would answer "has this browser ever dismissed the banner", which is the
 * wrong question. P7's own criterion is that "each visit provisions an
 * independent demo account", so a returning visitor is a NEW session whose
 * changes are newly temporary — and a flag set a fortnight ago would suppress
 * the one sentence that says so.
 *
 * Storing the id makes the dismissal expire exactly when the thing it was about
 * does, with no second lifetime to keep in step with `LIFETIME.demo` and no
 * cleanup of its own. A stale cookie naming an account that no longer exists
 * simply does not match, which is the same answer as no cookie at all.
 *
 * ## Why an id in a cookie is not a leak
 *
 * The value is a demo account's uuid, which the visitor's own signed session
 * token already carries and which names an account that expires in two hours and
 * holds an invented persona's data. `scope()` is what makes an id useless to
 * anyone else: possessing one buys nothing without a signed cookie naming it.
 *
 * ## Never throws
 *
 * Every branch is reachable by anyone who can edit a cookie in their own
 * browser. The honest answer to a value this does not recognise is the answer to
 * no cookie at all — show the banner — and a throw would turn a malformed cookie
 * into a 500 on every screen, because this is read from the root layout.
 */
export function isBannerDismissed(raw: string | undefined, userId: string): boolean {
  return Boolean(raw) && raw === userId;
}

/** What `cookies().set()` is handed. Structural, so nothing has to be imported. */
export type DemoBannerCookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
};

/**
 * The flags a dismissal carries.
 *
 * `httpOnly` because nothing in the browser reads it: the banner is rendered on
 * the server, which is what keeps it out of the first paint rather than removing
 * it after one. `path: "/"` because the banner is on every screen, and a
 * narrower path would mean dismissing it on `/plan` and finding it back on `/`.
 *
 * `secure` is conditional for the reason `auth/cookies.ts` and `cursor.ts` give:
 * a browser silently DISCARDS a `Secure` cookie over `http://localhost`, so on
 * `next dev` the banner would reappear on the next navigation and the dismiss
 * button would look broken.
 *
 * ## Why it has no expiry
 *
 * The same argument `cursor.ts` makes. The value carries the account it was
 * dismissed for, so a cookie belonging to a session that has ended is already
 * inert without anything having to remove it — `isBannerDismissed` simply does
 * not match. An `expires` would be a second, weaker copy of that rule, and one
 * that could disagree with it: the session's real deadline lives in
 * `users.expires_at`, which a cookie set here would have to guess at.
 *
 * Left as a browser-session cookie instead, so the browser clears it and a
 * visitor does not accumulate one dead dismissal per visit forever.
 */
export function demoBannerCookieOptions(): DemoBannerCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
  };
}
