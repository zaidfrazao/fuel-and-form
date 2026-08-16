"use server";

import { redirect } from "next/navigation";

import { ownerUserId } from "@/lib/auth/owner";
import { verifyOwnerPassword } from "@/lib/auth/password";
import { endSession, getSession, startSession } from "@/lib/auth/session";

/**
 * The login gate.
 *
 * Treated as a public endpoint, because it is one: a Server Action is reachable
 * by anyone who can POST to the app, whatever the form on screen offers. So the
 * password check happens here and not in the component that renders the field.
 *
 * ## What is deliberately not returned
 *
 * One message, for every failure. Not "no such account", not "password too
 * short", not a different message when `OWNER_PASSWORD` is unset — each of
 * those is a fact about the deployment that a stranger on a public URL can read
 * off the response. The submitted value is never echoed back into the returned
 * state either, so it cannot end up in a re-rendered input, an error overlay,
 * or a browser's back-forward cache.
 *
 * The one log line on this path names a missing variable and nothing else. The
 * acceptance criterion is that no PASSWORD value reaches a log or an error, and
 * neither the submitted value nor the configured one is ever passed to it.
 *
 * ## Why every failure is caught
 *
 * "Wrong password" and "correct password, but something else broke" must look
 * the same from outside. They did not at first: a missing `OWNER_PASSWORD`, an
 * unreachable database, or a failed insert all threw, and a thrown action is a
 * 500 — a visibly different response, reachable ONLY by someone who guessed
 * correctly. That is a password oracle: guess wrong and get a form back, guess
 * right and get a server error, and now you know. The catch below closes it.
 */

/** What the form renders. `undefined` before the first submission. */
export type LoginState = { error: string } | undefined;

/**
 * One message for every way this can fail. Wrong password, absent password,
 * whitespace — a visitor learns only that they are not in.
 */
const REFUSED = "Incorrect password.";

export async function logIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const submitted = formData.get("password");

  try {
    // Not a string when the field is absent — a hand-rolled POST rather than
    // the form. Refused the same way, and before it reaches the comparison.
    //
    // `verifyOwnerPassword` reads OWNER_PASSWORD and THROWS when it is unset,
    // which is why it sits inside the try: a deployment missing its password
    // must refuse logins, not answer differently to the one correct guess.
    if (typeof submitted !== "string" || !verifyOwnerPassword(submitted)) {
      return { error: REFUSED };
    }

    await startSession(await ownerUserId(), "owner");
  } catch (error) {
    // Names the failure for whoever runs the app, and nothing else. `error` is
    // an env-var or database error here; no password value is in scope to leak,
    // and neither `submitted` nor the configured password is passed in.
    console.error("Login failed before a session could be issued.", error);

    return { error: REFUSED };
  }

  // OUTSIDE the try, deliberately: `redirect` works by throwing, so calling it
  // inside would land in the catch above and turn every successful login into
  // "Incorrect password." — a failure that would look exactly like a wrong
  // guess and pass a shallow manual test, since one wrong guess also shows the
  // form again. login.test.ts asserts a success does not return REFUSED.
  redirect("/");
}

/** Ends the owner's session. Leaves any demo cookie alone — see session.ts. */
export async function logOut(): Promise<void> {
  const session = await getSession();

  await endSession(session?.kind ?? "owner");
  redirect("/login");
}
