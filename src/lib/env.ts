import "server-only";

/**
 * Server-side environment access.
 *
 * The guard above makes that a build error rather than a convention: a client
 * component importing this file fails to compile. Non-`NEXT_PUBLIC_` variables
 * are never inlined into a browser bundle, so this is defence in depth rather
 * than a plugged leak — but the Next data-security guide is explicit that only
 * the data-access layer should read `process.env`, and this enforces it.
 *
 * Every read is a function call, never a module-scope constant, so importing
 * this file can never throw at build time — only the code path that actually
 * needs a variable pays for its absence. That matters because `next build`
 * imports far more modules than any single request touches.
 *
 * Nothing here is prefixed `NEXT_PUBLIC_`, so none of it reaches the browser.
 */

/** Throws a message that names the variable and where to define it. */
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in (see README → Database).`,
    );
  }

  return value;
}

/**
 * The pooled Neon connection string — the `-pooler` host.
 *
 * Pooled is the default for everything at runtime: the PRD names Neon's cold
 * start as the main latency risk for the kitchen view, and the pooler is what
 * mitigates it. `drizzle.config.ts` deliberately uses the direct endpoint
 * instead, because DDL wants a real session rather than pgbouncer.
 */
export function databaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

/**
 * The owner's password, as typed.
 *
 * Not a hash. There is no user table to store one in and no registration flow
 * to produce one — the PRD's auth section is a single password in an env var,
 * and the threat a bcrypt hash defends against (a leaked database revealing a
 * password reused elsewhere) does not exist when the secret was never in the
 * database to leak.
 *
 * The value must never be interpolated into a log line, an error, or a rendered
 * response. `verifyOwnerPassword` in ./auth/password.ts is the only caller.
 */
export function ownerPassword(): string {
  return requireEnv("OWNER_PASSWORD");
}

/**
 * The bearer token Vercel's scheduler proves itself with — FUEL-42, § P7.
 *
 * `requireEnv` rather than a default, and the throw is the point. The route it
 * guards deletes rows and its path is published in `vercel.json` in a public
 * repository, so the alternatives to throwing are both worse than a 500:
 *
 *   - An empty default authorises `Authorization: Bearer `, which is an open
 *     delete endpoint that looks closed from every angle including this file.
 *   - Answering 401 when the variable is absent makes a job that has NEVER run
 *     indistinguishable from a job being probed. Nothing would report it, and
 *     the symptom — demo rows accumulating — is the thing this job exists to
 *     prevent, arriving weeks later with no obvious cause.
 *
 * Throwing puts the cause in the platform's log the first time the scheduler
 * fires, which is the only moment anyone is looking.
 */
export function cronSecret(): string {
  return requireEnv("CRON_SECRET");
}

/**
 * The key the session cookies are signed with.
 *
 * Read fresh on every call rather than captured at module scope, so rotating it
 * takes effect on the next request instead of the next deploy — and so this
 * file still imports cleanly during `next build`, where it is absent.
 */
export function sessionSecret(): string {
  return requireEnv("SESSION_SECRET");
}

/** What signing a push request needs. See `vapidKeys`. */
export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` URI a push service can contact — RFC 8292. */
  subject: string;
};

/**
 * The VAPID key pair, or `null` when this deployment has none — FUEL-47, § P9.
 *
 * The one function in this file that does not throw, and the asymmetry is the
 * whole point rather than an oversight.
 *
 * ## Why not `requireEnv`, when `cronSecret` right above it insists
 *
 * `cronSecret`'s argument is that a job which has never once run must not be
 * indistinguishable from a job being probed — because the symptom of the
 * reaper not running is demo rows accumulating until the free tier is full,
 * arriving weeks later with no obvious cause. Throwing puts the variable's name
 * in the platform's log at the first firing, which is the only moment anyone is
 * looking.
 *
 * None of that transfers. P9 requires that "push failure degrades silently to
 * the banner — no errors surfaced to the user", and the banner is not a
 * fallback that might not be there: it ships in FUEL-46, it is rendered from the
 * root layout, and it is the layer the PRD calls "cheap, reliable, always
 * built". A deployment with no VAPID keys is therefore not broken. It is the
 * app with one of P9's two layers switched off, which is exactly the state the
 * PRD anticipates when it designates this feature the first to cut.
 *
 * And the failure mode of throwing here would be the worse one. This is read by
 * a route that Vercel calls on a schedule; a throw would be a 500 every evening,
 * on a deployment where nothing is wrong, for a feature nobody configured —
 * noise in exactly the log `cronSecret` is trying to keep meaningful.
 *
 * ## All three, or none
 *
 * A public key with no private key cannot sign, and a private key with no public
 * key cannot be matched to any subscription a browser holds. Neither is a
 * working half, so a partial configuration answers `null` rather than a shape
 * whose caller would then have to re-check it. The one place that difference
 * could hide — a deployment that set two of the three and believes push is on —
 * is not silent: the settings control keys off the PUBLIC value, which is the
 * one reaching the browser, so a missing private key shows up as a subscription
 * that saves and a notification that never comes. That is the same symptom as
 * iOS being iOS, so `SUBJECT` and `PRIVATE_KEY` are named together with the
 * public one in `.env.example` for whoever goes looking.
 */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) return null;

  return { publicKey, privateKey, subject };
}
