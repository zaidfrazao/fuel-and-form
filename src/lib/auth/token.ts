import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed value carried in a session cookie.
 *
 * ## Why not a JWT
 *
 * There is exactly one issuer and one consumer of this token, both of them this
 * app, so nothing here has to negotiate an algorithm. A JWT would carry an
 * `alg` header saying how to verify it — a field supplied by whoever presents
 * the token, which is the root of the alg-confusion family of bugs and which
 * this file would then have to spend code refusing to honour. Fixing the
 * algorithm in the verifier and shipping no header at all removes the question
 * rather than answering it. The PRD budgets "roughly 40 lines" for the whole
 * auth layer (§ Stack → Auth); this is what fits.
 *
 * Deliberately NOT `server-only`, and it reads no environment variable: the
 * secret and the clock are both arguments. That is what lets the hermetic unit
 * suite cover it at 100% with no server, no request, and no secret configured —
 * the same reasoning as src/lib/db/scope.ts, and the same reason the coverage
 * gate can include it. The one file that resolves the real secret is
 * src/lib/auth/session.ts.
 *
 * ## What signing does and does not buy
 *
 * The payload is signed, not encrypted: anyone holding the cookie can read the
 * user id and expiry inside it. That is fine, and deliberate — a user id is not
 * a secret, it is the thing scope.ts assumes an attacker may know. What the
 * signature buys is that they cannot CHANGE it. Nothing sensitive may be added
 * to this payload later on the assumption that it is hidden.
 */

/** What a session cookie asserts: who, and until when. */
export type SessionPayload = {
  /** The `users.id` this session belongs to. */
  userId: string;
  /** Expiry, as epoch milliseconds. Compared against a caller-supplied clock. */
  expiresAt: number;
};

/** Separates the encoded payload from its signature. Not valid base64url. */
const SEPARATOR = ".";

/**
 * HMAC-SHA256 of the encoded payload, base64url.
 *
 * The digest covers the ENCODED payload rather than the raw JSON, so verifying
 * never has to re-encode — two encoders that disagree about key order or
 * whitespace would otherwise produce a valid token that fails to verify.
 */
function signature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/**
 * Compares two signatures without leaking, through timing, how far they matched.
 *
 * `timingSafeEqual` THROWS on buffers of unequal length rather than returning
 * false, so a token carrying a short signature would crash the request instead
 * of being rejected. Hashing both sides first makes both inputs exactly 32
 * bytes, so the length check can never fire and the comparison stays constant-
 * time over any input at all — including a signature made of the wrong number
 * of bytes, which is the case a naive length guard would answer early.
 */
function signaturesMatch(a: string, b: string): boolean {
  const digest = (value: string) => createHmac("sha256", "compare").update(value).digest();

  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Encodes and signs a payload.
 *
 * The result is safe in a cookie value: base64url plus a dot, no padding, no
 * characters needing quoting.
 */
export function sign(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${encoded}${SEPARATOR}${signature(encoded, secret)}`;
}

/**
 * The payload a token carries, or `undefined` if it cannot be trusted.
 *
 * ## One answer for every failure
 *
 * Absent, malformed, mis-signed, signed with a rotated secret, and expired all
 * return exactly `undefined`. Nothing distinguishes them — not the return
 * value, not a thrown error, not a log line. A caller therefore CANNOT report
 * "invalid session" differently from "no session", because it is never told
 * which it had. That is the request-boundary half of Testing Strategy § 1.4
 * case 5, and the same argument scope.ts makes for collapsing "not yours" into
 * "not there": a difference a visitor can observe is a difference they can
 * probe with.
 *
 * `now` is a parameter rather than a `Date.now()` call so expiry is testable
 * without faking timers, and so a single request cannot straddle the boundary
 * by asking twice.
 */
export function verify(
  token: string | undefined,
  secret: string,
  now: number,
): SessionPayload | undefined {
  if (!token) return undefined;

  // `indexOf`, not `split`: a token with two separators must be rejected, not
  // silently read as its first two segments.
  const separator = token.indexOf(SEPARATOR);
  if (separator === -1 || token.indexOf(SEPARATOR, separator + 1) !== -1) return undefined;

  const encoded = token.slice(0, separator);
  const presented = token.slice(separator + 1);

  if (!signaturesMatch(presented, signature(encoded, secret))) return undefined;

  // Past the signature check the payload is our own, so this parse is of a
  // string this app produced. The guard stays because "our own" assumes the
  // secret was never shared — cheap insurance against a crash on a path whose
  // whole job is to reject bad input calmly.
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  } catch {
    return undefined;
  }

  if (!isSessionPayload(payload)) return undefined;

  // Expiry is `<=` so a token is dead AT its expiry rather than one millisecond
  // after it, which is what "expires at" says.
  if (payload.expiresAt <= now) return undefined;

  return payload;
}

/** Narrows a parsed payload, so a shape change cannot be read as a session. */
function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;

  const { userId, expiresAt } = value as Partial<SessionPayload>;

  return typeof userId === "string" && userId.length > 0 && typeof expiresAt === "number";
}
