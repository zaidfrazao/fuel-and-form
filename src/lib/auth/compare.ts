import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Comparing two secrets without saying how far they matched.
 *
 * `===` on a string stops at the first differing character, so the time it
 * takes reveals the length of the shared prefix. Given enough samples that is
 * enough to recover a secret one character at a time. Both callers here — the
 * cookie signature and the owner's password — compare an attacker-supplied
 * value against a real one, which is exactly the shape that matters.
 *
 * Pure, and deliberately not `server-only`: the hermetic suite covers it at
 * 100%, same as token.ts and scope.ts.
 */

/** A fixed key. This is a comparison, not a signature — see the note below. */
const COMPARISON_KEY = "constant-time-comparison";

/**
 * Whether two values are equal, in time that does not depend on how they differ.
 *
 * ## Why hash first
 *
 * `timingSafeEqual` THROWS on buffers of unequal length rather than returning
 * false — so comparing a 12-character guess against a 20-character password
 * would crash instead of rejecting, and crash *only* when the lengths differ,
 * which is itself the length oracle it was meant to close. Hashing both sides
 * makes every input exactly 32 bytes, so the throw is unreachable and the
 * comparison is constant-time over any input at all, including the empty
 * string and a megabyte of junk.
 *
 * The key is fixed and public because nothing here is being authenticated: the
 * hash exists to normalise length, not to protect the values. Both sides go
 * through the same transform, so equal inputs stay equal and unequal inputs
 * stay unequal — which is the whole contract.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digest = (value: string) =>
    createHmac("sha256", COMPARISON_KEY).update(value).digest();

  return timingSafeEqual(digest(a), digest(b));
}
