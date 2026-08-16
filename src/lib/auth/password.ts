import "server-only";

import { ownerPassword } from "@/lib/env";
import { constantTimeEquals } from "./compare";

/**
 * The whole of the owner's credential check.
 *
 * ## Why there is no hash in the database
 *
 * A stored password hash defends against a leaked database revealing a secret
 * the user reused elsewhere. There is no stored password to leak here: the
 * secret lives in the environment, has one holder, and is used for exactly one
 * thing. Hashing it into `users` would add a table, a write path and a
 * migration to defend against a threat the design has already removed. The PRD
 * settles this explicitly (§ Stack → Auth, and "Real user accounts, signup,
 * password reset" in Out of Scope).
 *
 * What that trade DOES cost is offline-guessing resistance if the environment
 * itself leaks — at which point the attacker also holds SESSION_SECRET and can
 * simply mint a cookie, so the hash would have bought nothing.
 *
 * ## What must never happen here
 *
 * The submitted value and the real one must not reach a log, an error message,
 * a thrown stack, or a rendered response. There is no `console` call in this
 * file and the return type is a bare boolean — there is nothing for a caller to
 * accidentally print. That is the acceptance criterion "no password value ever
 * appears in a log line or error message", enforced by having nothing to leak
 * rather than by remembering not to.
 */
export function verifyOwnerPassword(submitted: string): boolean {
  // Constant-time: `===` would leak the length of the matching prefix through
  // timing, and this is the one value in the app worth guessing character by
  // character. See compare.ts.
  return constantTimeEquals(submitted, ownerPassword());
}
