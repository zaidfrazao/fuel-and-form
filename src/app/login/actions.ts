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
 * There is no `console` call anywhere on this path. That is the acceptance
 * criterion "no password value ever appears in a log line or error message",
 * met by having nothing that logs rather than by remembering not to.
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

  // Not a string when the field is absent — a hand-rolled POST rather than the
  // form. Refused the same way, and before it can reach the comparison.
  if (typeof submitted !== "string" || !verifyOwnerPassword(submitted)) {
    return { error: REFUSED };
  }

  await startSession(await ownerUserId(), "owner");

  // Outside the try/catch shape entirely: `redirect` works by throwing, so any
  // wrapping here would swallow it and silently leave the user on the form.
  redirect("/");
}

/** Ends the owner's session. Leaves any demo cookie alone — see session.ts. */
export async function logOut(): Promise<void> {
  const session = await getSession();

  await endSession(session?.kind ?? "owner");
  redirect("/login");
}
