"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { saveSchedule, saveTargets } from "@/lib/db/queries/profile";
import {
  parseProfileTargets,
  supportedTimezones,
  type TargetErrors,
} from "@/lib/profile-targets";
import { parseSlotTimes, type SlotTimeErrors } from "@/lib/slot-times";

/**
 * Saving the slot times — FUEL-21's one write.
 *
 * ## Treated as a public endpoint, because it is one
 *
 * The same reading `actions/log.ts` and `login/actions.ts` both start from: a
 * Server Action is reachable by anyone who can POST to the app, whatever the
 * form on screen offers. So the session is resolved HERE rather than trusted
 * from the caller, the submitted values go through `parseSlotTimes` before they
 * are anywhere near the row, and the write goes through the `user_id`-scoped
 * data layer underneath.
 *
 * What makes this action's validation load-bearing rather than a nicety is where
 * the failure would otherwise land. `profiles.slot_times` is free-shaped jsonb
 * with no CHECK, and `parseTimeOfDay` throws. An unvalidated "7am" written here
 * would not break the settings screen — it would break `/`, on every request
 * after, for as long as the row said so. See slot-times.ts.
 *
 * ## Nothing throws
 *
 * A thrown Server Action is a 500 with no value for the form to render, and
 * Brand Guide § Feedback asks for an inline message at the point of action. So
 * every path returns state, and the catch logs for whoever runs the app.
 */

/**
 * What the form renders. `undefined` before the first submission.
 *
 * `saved` carries a timestamp rather than a boolean so that two identical
 * successful saves are two different states: React bails out of a re-render when
 * the new state is `Object.is`-equal to the old, and a bare `{ saved: true }`
 * would make the second save silently show nothing. The value is only ever
 * compared, never displayed.
 */
export type SettingsState =
  | { status: "saved"; at: number }
  | { status: "invalid"; errors: SlotTimeErrors }
  | { status: "failed" }
  | undefined;

const FAILED: SettingsState = { status: "failed" };

export async function saveSlotTimes(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    // Before the session is used for anything else: an invalid submission is
    // refused whole, so nothing partial reaches the row. The per-field errors
    // go back to the form, which is the only place they mean anything.
    const parsed = parseSlotTimes(form);

    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    // False when the user has no profile row — nothing to attach times to, and
    // settings has no height or macro targets with which to invent one.
    if (!(await saveSchedule(session.userId, parsed.update))) return FAILED;

    // The acceptance criterion's "take effect immediately". `/` is dynamic — it
    // reads cookies — and nothing in the app uses `use cache`, so there is no
    // tag to invalidate and this is the whole of it: the next render of the
    // Right Now view resolves against the times just written.
    refresh();

    return { status: "saved", at: Date.now() };
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a message and
    // the values still in the form, which is everything they can act on.
    console.error("Could not save the slot times.", error);

    return FAILED;
  }
}

/**
 * What the targets form renders — the same four states as `SettingsState`, with
 * the targets' own error map. A second type rather than a union of error maps,
 * so neither form can be handed the other's field names.
 */
export type TargetsState =
  | { status: "saved"; at: number }
  | { status: "invalid"; errors: TargetErrors }
  | { status: "failed" }
  | undefined;

const TARGETS_FAILED: TargetsState = { status: "failed" };

/**
 * Saving the targets, the weights, the pace, the height and the zone — FUEL-136.
 *
 * `saveSlotTimes`' contract in every respect: the session is resolved here, the
 * values are parsed before anything touches the row, the write is scoped, and
 * nothing throws. A demo visitor rewrites their own profile or none.
 *
 * A separate action and a separate form, because the two halves fail
 * separately. One action would mean a mistyped slot time refusing a new kcal
 * target the person had typed correctly, with the error half a screen away from
 * the field they were looking at.
 */
export async function saveProfileTargets(
  _previous: TargetsState,
  form: FormData,
): Promise<TargetsState> {
  try {
    const session = await getSession();

    if (!session) return TARGETS_FAILED;

    const parsed = parseProfileTargets(form, supportedTimezones());

    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    if (!(await saveTargets(session.userId, parsed.update))) return TARGETS_FAILED;

    // "Effective immediately on /, /plan and /weight" — the ticket's first
    // criterion. All three are dynamic and read the profile per request, so
    // the next render of any of them is against the row just written.
    refresh();

    return { status: "saved", at: Date.now() };
  } catch (error) {
    console.error("Could not save the targets.", error);

    return TARGETS_FAILED;
  }
}
