"use server";

import { refresh } from "next/cache";

import { resolveWalk } from "@/app/actions/resolve-walk";
import { getSession } from "@/lib/auth/session";
import {
  clearSession,
  recordSession,
  recordWalkRecording,
} from "@/lib/db/queries/training";
import type { CalendarDate } from "@/lib/date";
import { parseTrack, trackMinutes } from "@/lib/recording";
import { storableRoute } from "@/lib/route";
import { parseDuration } from "@/lib/session-entry";

/**
 * The daily walk's one tap — FUEL-29, PRD § P3.
 *
 * "The daily walk is a separate, always-present item logged with a single tap",
 * every day including weekends, with an optional duration. This is the write
 * behind that tap, and it is a module of its own for the reason `plan.ts` and
 * `swap.ts` are two modules and `training.ts` is a third: what a write is
 * ADDRESSED by, and what it is allowed to say.
 *
 * ## Why not `actions/log.ts`
 *
 * That module can already REACH the walk — `itemFor` searches the day's
 * `anytime` items as well as its timeline, and says it does so for this feature
 * — but it cannot write it correctly, twice over.
 *
 *   - It writes through `queries/log.ts`'s `recordLog`, a plain INSERT.
 *     `workout_logs` is unique on `(user_id, date, workout_id)`, so the second
 *     write against the same walk collides and throws. `alreadyLogged` hides
 *     that only for as long as the status never varies, which is not a property
 *     anyone would know they were relying on.
 *   - It has no duration. Adding one would put a field on `logItem` that means
 *     something for exactly one of the items it can be handed.
 *
 * And its own contract rules out the other half of this task: "the date is
 * never an argument at all — it re-resolves today and reads the date off its own
 * answer". `/training` shows the walk on any date and needs to log it there.
 *
 * ## Why not `actions/training.ts`
 *
 * That module's comment expected FUEL-29 to widen its `kind === "session"`
 * filter and hang the walk off `setSessionStatus`. It is written here instead,
 * and the filter stays as it is, because widening it would have meant the
 * client sending `status` for a control that offers exactly one — a value the
 * user never chooses but a forged request still could, so 'partial' and
 * 'skipped' would become reachable states for an item with no way to display
 * them. It would also have carried `note` onto a row the walk has no control
 * for, and a note that survived a re-log would be a sentence no screen can edit.
 *
 * What the two modules DO share is the write itself. `recordSession` and
 * `clearSession` are used unchanged: the walk's row is a `workout_logs` row like
 * the session's, and a second statement against the same table would be a second
 * place for the upsert's conflict target to drift.
 *
 * ## Addressed by date and entry, and re-resolved here
 *
 * The same closure `log.ts` and `training.ts` both make, for the same reason:
 * what crosses the wire is a `training_template_entries` id and a date, and the
 * WORKOUT is taken from this module's own resolution of that date. A caller
 * cannot name a workout, so the worst a forged request can do is name an entry
 * the date does not hold — which is refused — rather than file a walk against
 * some other row in the library.
 *
 * The entry rather than the workout for `resolve-training.ts`'s reason: a
 * rotated day's workout changes with the date, so the entry is the stable thing
 * for a screen to name.
 *
 * ## One status, and it is not a parameter
 *
 * 'done' is written here as a literal. A walk that did not happen is a walk with
 * no row — there is no skip, because there is nothing on the timeline for a skip
 * to advance past, and § Tone of Voice does not ask anyone to declare what they
 * did not do. `note` is written `null` for the same reason it is not a
 * parameter: the row has the column, and no screen offers the control.
 *
 * ## Nothing throws
 *
 * Every path returns `{ ok }`, on `log.ts`'s and `training.ts`'s reasoning: a
 * thrown Server Action is a 500 with nothing for the client to render, and
 * § Feedback asks for an inline banner with the value reverted and a "Try
 * again", which needs something to come back. The failures are deliberately not
 * distinguished — "no session", "no such entry", "that entry is not a walk", "a
 * duration out of range" and "the database is down" are one answer, because the
 * row's response to all five is identical.
 */

/** What the row renders from. Success carries nothing — see § Feedback. */
export type WalkResult = { ok: boolean };

const DONE: WalkResult = { ok: true };
const FAILED: WalkResult = { ok: false };

/**
 * Records the walk on a date, with its optional duration.
 *
 * An upsert, so a repeated tap is an ordinary update writing the same values
 * rather than a unique-index violation surfacing as a "Try again" for something
 * that already succeeded. It is also what makes the duration correctable: 30
 * minutes changed to 45, and 45 cleared back to nothing, are the same statement
 * as the first tap, which is why the row's presets can be toggled at all.
 *
 * `durationMin` is `unknown` because this is a public POST endpoint and nothing
 * has checked it by the time it arrives. It is parsed BEFORE the day is
 * resolved, because that costs no query — every branch of the parse is reachable
 * by anyone who can POST here, and `session-entry.ts` sets out what each one
 * refuses and why storing an unchecked minute count is the silent failure.
 */
export async function logWalk(input: {
  date: CalendarDate;
  entryId: string;
  durationMin?: unknown;
}): Promise<WalkResult> {
  try {
    const durationMin = parseDuration(input.durationMin);

    if (durationMin === undefined) return FAILED;

    const resolved = await resolveWalk(input.date, input.entryId);

    // An entry the date does not hold, or one that is not the walk. Either a
    // forged request, or a screen whose plan changed underneath it — a template
    // edited in another tab. `refresh()` is what corrects the second, and it
    // has to happen here because this path returns before reaching the one
    // below.
    if (!resolved) {
      refresh();

      return FAILED;
    }

    await recordSession(resolved.userId, {
      date: input.date,
      workoutId: resolved.workoutId,
      status: "done",
      note: null,
      durationMin,
    });

    refresh();

    return DONE;
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a banner and a
    // "Try again", which is everything they can act on.
    console.error("Could not record the walk.", error);

    return FAILED;
  }
}

/**
 * Records a walk that was RECORDED — the route, the distance and the duration.
 *
 * FUEL-101, PRD § P11. `logWalk` above is the one tap, and it does not change:
 * a walk with no GPS at all still logs exactly as it did, which is § P3's
 * criterion and § P11 says it "does not bend here". This is the additive path,
 * and everything it writes is a figure the tap has no way to produce.
 *
 * ## Only the geometry crosses the wire
 *
 * Not the distance, not the duration, not the point count — all three are
 * DERIVED here from the track itself. They are derivable, so accepting them
 * would be accepting three numbers that can disagree with the shape they claim
 * to describe, from an endpoint anyone can POST to. A forged body could then
 * file a 40km walk with a two-point trace, and every figure downstream — the
 * export, the step estimate, the energy range — would carry it.
 *
 * `storableRoute` does the deriving, which is FUEL-100's entry point and the
 * one the schema names: `walk_routes`' precision comment says this ticket
 * "adds the second writer — a browser recorder, taking positions from a device
 * that reports seven decimals — and discipline is what a second writer is most
 * likely to miss". Going through it is that discipline.
 *
 * ## Refused in cost order: no session, then a malformed body, then the day
 *
 * `getSession` first, and it is the cheapest of the three — a cookie and an
 * HMAC, no query — so an unauthenticated POST is turned away before the server
 * walks up to ten thousand positions on its behalf. It is `cache`d for the
 * request, so `resolveWalk` calling it again below costs nothing.
 *
 * `parseTrack` second, on the reasoning `logWalk` already applies to
 * `durationMin`: a refusal that costs a query is a refusal that can be used to
 * make the database work, and this body is far larger than that one. It bounds
 * the point count before walking the points, so a body claiming a million
 * positions is refused by its length.
 *
 * The day last, because that is the one that reads.
 *
 * ## An empty track is a success, not a refusal
 *
 * A recording that was granted the permission and never got a usable fix
 * produces no points, and this writes the walk with no distance and no trace —
 * "a walk with no route is a complete walk with fewer figures, never a partial
 * one". The refusals are reserved for a body that is malformed rather than one
 * that is empty.
 *
 * ## A span that is not a duration
 *
 * The derived minutes go through `parseDuration` — the single place
 * `MAX_DURATION_MIN` is spelled — and a span outside it is stored as NULL
 * rather than refused. A recording left running from breakfast until the
 * evening spans thirteen hours and is not a thirteen-hour walk; that figure is
 * unknown, and `parseDuration` already says the honest way to record an unknown
 * duration is to leave it empty. Refusing the save instead would throw away a
 * real distance and a real route to protect a field that has a null in it.
 */
export async function saveWalkRecording(input: {
  date: CalendarDate;
  entryId: string;
  track?: unknown;
}): Promise<WalkResult> {
  try {
    if (!(await getSession())) return FAILED;

    const track = parseTrack(input.track);

    if (!track) return FAILED;

    const resolved = await resolveWalk(input.date, input.entryId);

    if (!resolved) {
      refresh();

      return FAILED;
    }

    await recordWalkRecording(resolved.userId, {
      date: input.date,
      workoutId: resolved.workoutId,
      durationMin: parseDuration(trackMinutes(track)) ?? null,
      route: storableRoute(track),
    });

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not record the walk.", error);

    return FAILED;
  }
}

/**
 * Takes the walk back, leaving the date unlogged — § Feedback's "any log is
 * revertible from where it was performed".
 *
 * Where it was performed is the walk's own row, not `/`'s action bar. The bar's
 * Undo is a stack over the items the bar itself logged, and `lib/walk.ts`
 * explains why the walk is not one of them: it never advanced the card, so
 * taking it back through the bar would step the card past an item that is still
 * logged.
 *
 * Removing a record that is already gone is `ok`, not a failure. The row offers
 * no revert in that state, so reaching here means the screen was behind, and
 * `refresh()` is the correction — a banner would report a problem the user does
 * not have.
 */
export async function clearWalk(input: {
  date: CalendarDate;
  entryId: string;
}): Promise<WalkResult> {
  try {
    const resolved = await resolveWalk(input.date, input.entryId);

    if (!resolved) {
      refresh();

      return FAILED;
    }

    await clearSession(resolved.userId, input.date, resolved.workoutId);

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not clear the walk.", error);

    return FAILED;
  }
}
