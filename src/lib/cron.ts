import { constantTimeEquals } from "@/lib/auth/compare";

/**
 * Who is allowed to run a scheduled job — FUEL-42, PRD § P7.
 *
 * A Vercel cron job is an ordinary HTTPS request to an ordinary route, which
 * means the reaper's URL is as public as every other route in this app and this
 * repository is where anyone can read it. The only thing separating "the
 * platform's scheduler" from "someone who read vercel.json on GitHub" is the
 * bearer token below.
 *
 * Pure, and deliberately NOT `server-only`: the secret and the header are both
 * arguments, exactly as in src/lib/auth/token.ts and src/lib/demo.ts. Every
 * branch here is a rejection, so an unmeasured one is a way past the gate that
 * nobody looked at — and the hermetic suite can only measure them if this file
 * needs neither a request nor an environment to run.
 *
 * ## Why it does not decide what happens when the secret is missing
 *
 * This function is handed a secret. Resolving one — and failing loudly when
 * there is none — belongs to `cronSecret()` in src/lib/env.ts, so that an
 * unconfigured deployment throws rather than quietly answering 401 to its own
 * scheduler forever. The route's doc comment argues that at length.
 */

/**
 * The scheme Vercel sends. Case-insensitive per RFC 7235, and matched that way
 * below: a scheme that arrives as `bearer` is the same credential.
 */
const SCHEME = "bearer";

/**
 * Whether an `Authorization` header carries the cron secret.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on every cron invocation
 * once that variable is set on the project. Nothing else about the request is
 * trusted: `x-vercel-cron` is a platform header rather than a credential, and a
 * check that read it would be satisfied by anyone willing to send it.
 *
 * ## The comparison is constant-time
 *
 * `===` stops at the first differing byte, so its timing reveals the length of
 * the shared prefix — and a scheduled endpoint is a thing an attacker may probe
 * as often as they like, with no lockout and nobody watching. That is the exact
 * shape `constantTimeEquals` exists for, and it is already the comparison
 * guarding the session signature and the owner's password.
 *
 * The token is compared even when it is obviously wrong (empty, or the whole
 * header absent) rather than short-circuited on length, because the hash inside
 * `constantTimeEquals` normalises every input to 32 bytes. A `!token` guard
 * here would be a length oracle reintroduced above the defence.
 *
 * An empty `secret` is refused outright and before the comparison. Otherwise a
 * deployment whose `CRON_SECRET` resolved to `""` would authorise a request
 * carrying `Authorization: Bearer ` — an open endpoint that looks, from the
 * outside and from this code, exactly like a closed one.
 */
export function isAuthorizedCron(header: string | null | undefined, secret: string): boolean {
  if (!secret) return false;

  const [scheme, ...rest] = (header ?? "").split(" ");

  if (scheme?.toLowerCase() !== SCHEME) return false;

  // Rejoined rather than taking `rest[0]`: a token containing a space is not a
  // valid credential, but silently comparing only the part before the space
  // would authorise a prefix of the real secret. Whatever followed the scheme
  // is compared whole, and fails as a whole.
  return constantTimeEquals(rest.join(" "), secret);
}
