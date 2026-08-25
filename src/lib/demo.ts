import { createHmac } from "node:crypto";

import { LIFETIME } from "@/lib/auth/cookies";

/**
 * What provisioning a demo session is allowed to cost — PRD § P7 (FUEL-40).
 *
 * P7 asks for a demo that "requires no credentials", which is the same thing as
 * an endpoint that writes roughly two hundred rows for anyone who can POST to
 * it. The two limits below are what keep that from being a way to fill the
 * database, and this file is the whole of the decision.
 *
 * Deliberately NOT `server-only`, and it reads no environment variable: the
 * secret and the clock are both arguments. That is the same discipline as
 * src/lib/auth/token.ts and src/lib/db/scope.ts, and it is what lets the
 * hermetic suite cover every branch with no request, no database and no secret
 * configured — see the note beside this file in vitest.config.mts.
 *
 * ## Why the counting happens in Postgres
 *
 * Nothing here holds state between calls. An in-process counter would be the
 * obvious shape and would count nothing: Vercel runs each invocation in its own
 * memory, so a crawler spread across instances is never seen twice by the same
 * counter, and the limit that looked strictest in review would be the one that
 * never fired. The counts are read from `users` and handed in — see
 * src/lib/db/queries/demo.ts — and this file only decides what they mean.
 */

/** How many sessions one client may provision, and over what window. */
export type ClientLimit = {
  max: number;
  windowMs: number;
};

/** Both limits, as one value so a caller cannot pass half of them. */
export type ProvisioningLimits = {
  client: ClientLimit;
  /** The most demo sessions that may be alive at once, site-wide. */
  concurrent: number;
};

/**
 * The limits the app actually runs with.
 *
 * Three per client per ten minutes: enough that a visitor who wants to see the
 * demo fresh can, few enough that a loop is stopped in seconds. A hundred live
 * sessions at once, against a two-hour lifetime, is far more than a portfolio
 * link attracts and still a bounded number of rows.
 *
 * Constants rather than environment variables on purpose. An env var here would
 * be a third thing to configure per deployment, and its failure mode is a demo
 * that quietly refuses everyone because a value was mistyped somewhere no test
 * can see. These are two numbers with a comment; changing them is a commit.
 */
export const DEMO_LIMITS: ProvisioningLimits = {
  client: { max: 3, windowMs: 10 * 60 * 1000 },
  concurrent: 100,
};

/** What the counts say, as the caller reads them out of `users`. */
export type ProvisioningCounts = {
  /** Sessions this client provisioned inside `client.windowMs`. */
  recentForClient: number;
  /** Demo sessions site-wide whose `expires_at` is still in the future. */
  liveSessions: number;
};

/**
 * Why a provision was refused. Rendered as two different sentences.
 *
 * ## Why these are distinguished, when login's failures are not
 *
 * src/app/login/actions.ts collapses every failure into one message, because a
 * message that varies is a password oracle: guess wrong and see the form, guess
 * right and see something else, and now you know. Nothing of the kind applies
 * here. There is no secret to guess, no account to enumerate, and both answers
 * are facts about load rather than about anyone's data. Telling a visitor which
 * wall they hit is the difference between "wait two minutes" and "come back
 * later", and neither sentence is worth anything to an attacker.
 *
 * The asymmetry is deliberate and is recorded here so it does not read as an
 * oversight by whoever compares the two files.
 */
export type Refusal = "rate-limited" | "at-capacity";

/** Allowed, or refused with a reason. */
export type ProvisioningDecision = { allowed: true } | { allowed: false; refusal: Refusal };

const ALLOWED: ProvisioningDecision = { allowed: true };

/**
 * Whether this client may provision a session right now.
 *
 * ## The client's own limit is checked FIRST
 *
 * When both walls are hit at once the answer is "you have opened several
 * already", not "the demo is busy". A visitor who has just provisioned three
 * sessions caused their own refusal, and blaming site load for it would send
 * them away believing there is nothing they can do — when in fact the wait is a
 * couple of minutes. The order is the whole difference and costs nothing.
 *
 * `>=` rather than `>` in both: the counts are what has ALREADY happened, so a
 * client sitting exactly on its maximum has used it up. Off by one here is a
 * fourth session for every three allowed, silently.
 */
export function decideProvisioning(
  counts: ProvisioningCounts,
  limits: ProvisioningLimits = DEMO_LIMITS,
): ProvisioningDecision {
  if (counts.recentForClient >= limits.client.max) {
    return { allowed: false, refusal: "rate-limited" };
  }

  if (counts.liveSessions >= limits.concurrent) {
    return { allowed: false, refusal: "at-capacity" };
  }

  return ALLOWED;
}

/**
 * The bucket a client is counted in when its address cannot be read.
 *
 * Hashed like any other value, so `users.ip_hash` holds one kind of thing and a
 * reader cannot tell this case apart from a real one.
 *
 * Fails CLOSED: an unidentifiable client shares ONE bucket with every other
 * unidentifiable client, so the limit still bites. The alternative — skipping
 * the limit when the header is missing — would disable it for exactly the
 * caller who declined to be identified. This is the case behind `next dev`,
 * where nothing sets the header at all.
 */
const UNIDENTIFIED = "unidentified-client";

/**
 * The value stored in `users.ip_hash` — an HMAC of the client's address.
 *
 * ## Keyed, not merely hashed
 *
 * A bare SHA-256 of an IPv4 address is reversible by anyone with a laptop:
 * there are four billion of them, and hashing all four billion is minutes of
 * work. So the digest is an HMAC under `SESSION_SECRET`, which is not in this
 * repository and not in the database. Without it the column is unusable, and
 * because the key differs per deployment the same visitor cannot be matched
 * across two of them either.
 *
 * What is left is provenance — "these rows came from one client" — for as long
 * as the rows live, which is at most the session's two hours.
 *
 * ## Reading the header
 *
 * `x-forwarded-for` is a comma-separated list appended to by each hop, so the
 * FIRST entry is the client and the rest are proxies. On Vercel the platform
 * rewrites the header at the edge, so what arrives is trustworthy there; behind
 * a proxy that merely forwards what it was given, a client could name any first
 * entry it liked. That is why the concurrency cap in `decideProvisioning` reads
 * nothing from this function: a spoofable header degrades the per-client limit
 * and cannot touch the ceiling.
 *
 * Lowercased and trimmed before hashing. IPv6 is hexadecimal and two hops may
 * disagree about its case — `2001:DB8::1` and `2001:db8::1` are one address,
 * and unnormalised they would be two buckets, which is two allowances.
 */
export function hashClientIp(forwardedFor: string | null | undefined, secret: string): string {
  const client = forwardedFor?.split(",")[0]?.trim().toLowerCase();

  return createHmac("sha256", secret)
    .update(client || UNIDENTIFIED)
    .digest("base64url");
}

/**
 * When a session provisioned at `now` stops being valid.
 *
 * Taken from `LIFETIME.demo` rather than restated, so the row and the cookie
 * cannot drift apart — cookies.ts asks for exactly that ("FUEL-40 sets
 * `users.expires_at` when it provisions a demo user; this is the cookie-side
 * half and must be kept no longer than that").
 *
 * In practice the row expires a few milliseconds BEFORE the cookie, because
 * `startSession` reads its own clock after this one. That is the safe direction
 * and the intended one: resolve.ts treats the row as authoritative precisely so
 * a cookie can never outlive the session it names.
 */
export function demoExpiry(now: number): Date {
  return new Date(now + LIFETIME.demo);
}

/** The instant the rate-limit window opens, for a caller building its query. */
export function rateLimitWindowStart(
  now: number,
  limits: ProvisioningLimits = DEMO_LIMITS,
): Date {
  return new Date(now - limits.client.windowMs);
}
