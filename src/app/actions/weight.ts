"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  loadEarlierWeighIns,
  loadWeighInOn,
  recordWeighIn,
  removeWeighIn,
  weighInToday,
} from "@/lib/db/queries/weight";
import {
  RECENT_WEIGH_INS,
  type WeighInRow,
  narrowWeighIn,
  parseHistoryDate,
  parseWeighIn,
  parseWeighInDate,
} from "@/lib/weigh-in";

/**
 * Weigh-ins written and taken back — P5's writes (FUEL-34).
 *
 * ## Why this is a module of its own
 *
 * The distinction `plan.ts` draws against `swap.ts`, and `training.ts` against
 * `log.ts`: what a write is ADDRESSED by. `log.ts` takes a key naming an item in
 * TODAY'S resolved timeline and never sees a date at all; `training.ts` takes a
 * date and an entry the plan has to hold. This takes a date and NOTHING ELSE —
 * there is no plan to resolve against, because a weigh-in is not scheduled. Any
 * past date is a legitimate one, including dates before the program started,
 * which every other date-taking action in this app refuses.
 *
 * That is also why nothing here re-resolves anything. `actions/training.ts` goes
 * back to the database to take `workout_id` from its own answer, because a
 * caller naming a workout the date does not schedule would write a row that
 * never renders and still reaches the weekly export. A weigh-in has no such
 * second identifier: the date is the whole address, the composite foreign key
 * problem does not arise, and `scope()` puts `user_id` in the statement without
 * any caller being able to name it.
 *
 * ## One form, one action
 *
 * `saveWeighIn` is the create AND the edit, because `weight_logs` is unique on
 * `(user_id, date)` and the upsert underneath makes them one statement — see
 * `queries/weight.ts`. FUEL-34's "log a weigh-in" and "edit any past entry"
 * differ only in whether a row was already there, which is a question the
 * database answers and neither this module nor the screen has to ask.
 *
 * ## Nothing throws
 *
 * Every path returns `{ ok }`. A thrown Server Action is a 500 with nothing for
 * the client to render, and Brand Guide § Feedback asks for an inline banner
 * with the value reverted and a "Try again" — which needs something to come
 * back. The failures are deliberately not distinguished: "not signed in", "no
 * profile", "a weight out of range", "a date in the future" and "the database is
 * down" are one answer, because the screen's response to all five is identical.
 */

/** What the screen renders from. Success carries nothing — see § Feedback. */
export type WeightResult = { ok: boolean };

const DONE: WeightResult = { ok: true };
const FAILED: WeightResult = { ok: false };

/**
 * What FUEL-84's two READS hand back.
 *
 * Unlike `WeightResult` these carry rows, so they are unions rather than one
 * shape with an `ok` flag: a caller that reached for `entries` on a failed read
 * would be reaching for rows that do not exist, and the union is what stops it
 * compiling. Success and failure are still the only two answers — a read that
 * was refused for want of a session and one the database dropped are
 * indistinguishable, for `saveWeighIn`'s reason.
 *
 * `entry: null` is NOT a failure. "No weigh-in on that date" is an answer the
 * form acts on — it means the fields stay empty — and collapsing it into
 * `{ ok: false }` would make the screen warn about a note it was never going to
 * overwrite.
 */
export type EarlierWeighInsResult = { ok: true; entries: WeighInRow[] } | { ok: false };
export type WeighInOnResult = { ok: true; entry: WeighInRow | null } | { ok: false };

const UNREAD = { ok: false } as const;

/**
 * Logs a weigh-in, or replaces the one already on that date.
 *
 * The whole request is untrusted — unlike a training write, where the date and
 * the workout are re-derived server-side, there is nothing here for the server
 * to derive. `lib/weigh-in.ts` is therefore the entire trust boundary, and it is
 * a module rather than three checks here so that its refusals can be tested
 * without a Server Action around them.
 *
 * Today is fetched before the values are parsed because parsing needs it: the
 * future-date refusal is against the user's own midnight, not the server's. It
 * costs the one query this path was always going to make.
 *
 * A save that writes the same values it already had is an ordinary update, not
 * a no-op to be refused. The note beside the number may have changed, and a
 * caller cannot tell a refused no-op from a failure out of `{ ok: false }`.
 */
export async function saveWeighIn(input: {
  date: unknown;
  weight: unknown;
  note?: unknown;
}): Promise<WeightResult> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    const today = await weighInToday(session.userId, new Date());

    // No profile row: no timezone, so there is no "today" to measure a future
    // date against, and inventing one — the server's — would let a weigh-in be
    // logged tomorrow from a phone west of the server. `/weight` renders an
    // empty state in this case and offers no form, so reaching here means a
    // forged request.
    if (!today) return FAILED;

    const weighIn = parseWeighIn(input, today);

    if (!weighIn) return FAILED;

    await recordWeighIn(session.userId, weighIn);

    refresh();

    return DONE;
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a banner and a
    // "Try again", which is everything they can act on.
    console.error("Could not save the weigh-in.", error);

    return FAILED;
  }
}

/**
 * Deletes the weigh-in on a date — FUEL-34's "delete any past entry".
 *
 * The timezone is fetched BEFORE the date is parsed, which is the opposite of
 * `plan.ts` and worth saying why. That module parses first so a malformed date
 * is refused without a round trip; here the refusal itself needs a round trip,
 * because "not in the future" is a question about the user's own midnight and
 * that lives in `profiles.timezone`. Parsing the shape first and the future
 * second would split one refusal across two places to save a query that an
 * authenticated caller has already paid for on every other path.
 *
 * A future date is refused here exactly as it is on the way in, so there is one
 * definition of a date this app will accept rather than a stricter one for
 * writing and a looser one for deleting.
 *
 * Deleting a weigh-in that is already gone is `ok`, not a failure. The screen
 * offers no delete control for a date with no row, so reaching that state means
 * the screen was behind — another tab, or a second tap — and `refresh()` is the
 * correction. A banner would report a problem the user does not have, and the
 * row they wanted gone is gone either way.
 */
export async function deleteWeighIn(input: { date: unknown }): Promise<WeightResult> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    const today = await weighInToday(session.userId, new Date());

    if (!today) return FAILED;

    const date = parseWeighInDate(input.date, today);

    if (!date) return FAILED;

    await removeWeighIn(session.userId, date);

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not delete the weigh-in.", error);

    return FAILED;
  }
}

/**
 * The page of weigh-ins older than a date — FUEL-84's "show earlier".
 *
 * ## A read, in a file of writes
 *
 * `/weight` bounds what it renders, so the rest of the history has to arrive
 * some other way, and this is it. The screen holds every READING already —
 * the chart draws them and § Accessibility obliges it to table them — so what
 * this adds is the rows themselves: the note, and a `<li>` to edit and delete
 * from.
 *
 * No `refresh()`, which is the whole difference between this and the two above.
 * Nothing was written, so there is no server render to invalidate; calling it
 * would throw away the pages the reader has already asked for and put the list
 * back to ten rows underneath them.
 *
 * The page size is `RECENT_WEIGH_INS` — the same figure the first window uses,
 * and taken from the module that defines it rather than from the caller. A
 * limit named by the client is a limit a hand-rolled POST can set to a year of
 * rows, which is the payload this ticket exists to bound.
 */
export async function earlierWeighIns(input: {
  before: unknown;
}): Promise<EarlierWeighInsResult> {
  try {
    const session = await getSession();

    if (!session) return UNREAD;

    // Shape only, and no timezone fetched to check the future against — see
    // `parseHistoryDate`. "Older than a date in the future" is every row this
    // user has, in pages of ten, which is neither a refusal worth making nor a
    // way to learn anything about someone else.
    const before = parseHistoryDate(input.before);

    if (!before) return UNREAD;

    const entries = await loadEarlierWeighIns(session.userId, before, RECENT_WEIGH_INS);

    return { ok: true, entries: entries.map(narrowWeighIn) };
  } catch (error) {
    console.error("Could not load earlier weigh-ins.", error);

    return UNREAD;
  }
}

/**
 * The weigh-in on one date — what the form needs before it can replace one.
 *
 * The date field addresses an entry, and with the history bounded it can name
 * one the list has not loaded. The reading is already on the screen, so the
 * form can say what it is about to replace either way; what is missing is the
 * NOTE, and `recordWeighIn` sets the note on every write. Without this the
 * screen would prefill an empty note over a real one and the upsert would
 * store it — a note silently lost by correcting a weight, which is the one
 * failure a bounded list could introduce that the unbounded one could not.
 *
 * A read, so no `refresh()`, for `earlierWeighIns`' reason.
 */
export async function weighInOn(input: { date: unknown }): Promise<WeighInOnResult> {
  try {
    const session = await getSession();

    if (!session) return UNREAD;

    const date = parseHistoryDate(input.date);

    if (!date) return UNREAD;

    const entry = await loadWeighInOn(session.userId, date);

    return { ok: true, entry: entry ? narrowWeighIn(entry) : null };
  } catch (error) {
    console.error("Could not load that weigh-in.", error);

    return UNREAD;
  }
}
