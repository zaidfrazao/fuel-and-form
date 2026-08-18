"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { readCursor, writeCursor } from "@/lib/cursor-cookie";
import { deleteLog, recordLog } from "@/lib/db/queries/log";
import { loadToday } from "@/lib/db/queries/today";
import { alreadyLogged, latestLog, logIntent, type LogVerb } from "@/lib/log-intent";
import { advance, type NowItem, type NowView, retreat } from "@/lib/resolve-now";

/**
 * The three taps P1's card offers: log it, skip it, take it back.
 *
 * ## Treated as a public endpoint, because it is one
 *
 * A Server Action is reachable by anyone who can POST to the app, whatever the
 * screen offers — the same reasoning `login/actions.ts` sets out. So the session
 * is resolved here rather than trusted from the caller, and every write goes
 * through the `user_id`-scoped data layer underneath.
 *
 * ## The client sends a KEY, never a row
 *
 * The only thing crossing the wire is the item key `resolve-now.ts` built from a
 * template entry id, plus a verb. This action then RE-RESOLVES today on the
 * server and takes the date, the slot and the meal id from its own answer.
 *
 * That is what closes the obvious hole. Had the client sent `{ mealId, slot,
 * date }`, a hand-rolled POST could log any meal in the library against any slot
 * on any date — every value in the row would be attacker-chosen, and each one
 * would be individually plausible. Sending a key instead means the worst a
 * forged request can do is name an item that is not on the plan today, which
 * resolves to nothing and is refused. There is no id in the payload to tamper
 * with because there is no id in the payload.
 *
 * ## Nothing throws
 *
 * A thrown Server Action is a 500 with no value for the client to render, and
 * Brand Guide § Feedback asks for an inline banner at the point of action with
 * the value reverted and a "Try again" — which needs something to come back.
 * So every path returns `{ ok }`, and the catch logs for whoever runs the app.
 *
 * The failures are deliberately not distinguished in the return value. "No
 * session", "no such item", and "the database is down" are one answer here for
 * the same reason `login/actions.ts` gives one message: the screen's response to
 * all three is identical, and a caller who can tell them apart learns something
 * about the deployment for nothing.
 */

/** What the card renders from. Success carries nothing — see § Feedback. */
export type LogResult = { ok: boolean };

const DONE: LogResult = { ok: true };
const FAILED: LogResult = { ok: false };

/**
 * The item a key names, scheduled or not.
 *
 * `anytime` is searched as well as the timeline so the action layer can record
 * the daily walk, which has no window and therefore no place in the timeline.
 * No control currently sends one — P1's action bar acts on the active card —
 * but the write path is the same one, and a log module that could only reach
 * half the day's items would be the wrong shape to hand the next task.
 */
function itemFor(view: NowView, key: string): NowItem | undefined {
  return (
    view.timeline.find((item) => item.key === key) ??
    view.anytime.find((item) => item.key === key)
  );
}

/**
 * Records the active item and advances past it.
 *
 * `verb` decides which of the four statuses in the schema this becomes; the
 * mapping is `logIntent`'s and is not restated here.
 *
 * ## Recording and advancing are separate, and only one is conditional
 *
 * The row is written if today does not already hold it (see `alreadyLogged` —
 * `meal_logs` has no unique constraint, so a double-tap or a retry after a lost
 * response would otherwise double-count in P4's totals). The cursor moves only
 * when the key names the item that is CURRENTLY active, which makes a repeated
 * tap on an item already advanced past a no-op rather than a second advance —
 * the "one tap, one item" guarantee `resolve-now.ts` is built around, held up on
 * this side of the wire too.
 */
export async function logItem(key: string, verb: LogVerb): Promise<LogResult> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    // `LogVerb` is a compile-time type, and this is a public POST endpoint, so
    // nothing has checked the value at runtime by the time it arrives here.
    // Without this, an unrecognised verb would fall through `logIntent`'s
    // `verb === "log" ? … : …` and be recorded as a SKIP — a write, chosen by
    // whoever sent the request, from input nobody validated. Failing open into
    // a database row is the one thing a trust boundary must not do, even when
    // the row it writes happens to be harmless.
    if (verb !== "log" && verb !== "skip") return FAILED;

    const today = await loadToday(session.userId, new Date(), await readCursor());

    // No profile row: nothing is resolved, so there is nothing to log against.
    if (!today) return FAILED;

    const { view } = today;
    const item = itemFor(view, key);

    // A key today's plan does not hold. Either a forged request, or a genuine
    // tap on a card the plan changed underneath — a swap made in another tab.
    // Both are refused; the second is also a screen that is out of date, and
    // `refresh()` is what corrects it. It has to be called HERE rather than
    // left to the one at the end, because this path returns before reaching it
    // — so a stale tap would otherwise be refused and left stale, which is the
    // opposite of "never wrong for longer than one tap".
    if (!item) {
      refresh();

      return FAILED;
    }

    const intent = logIntent(item, verb, view.date);

    if (!alreadyLogged(today.logs, intent)) {
      await recordLog(session.userId, intent);
    }

    if (view.state === "active" && view.active.key === key) {
      await writeCursor(advance(view));
    }

    // Always, and not only when the cursor moved. Logging an `anytime` item
    // writes no cookie, and reconciliation that depended on the cookie's own
    // re-render would silently skip exactly that case. The page read is dynamic
    // — it reads cookies — and nothing in the app uses `use cache`, so there is
    // no tag to invalidate and this is the whole of it.
    refresh();

    return DONE;
  } catch (error) {
    // Names the failure for whoever runs the app. The user gets a banner and a
    // "Try again", which is everything they can act on.
    console.error("Could not record the log.", error);

    return FAILED;
  }
}

/**
 * Takes back the most recent log of the day — Brand Guide § Feedback's "any log
 * or swap is revertible from where it was performed, for the rest of that day".
 *
 * The target comes from the persisted rows rather than from anything the client
 * remembers, which is what makes "the rest of that day" true across a lock
 * screen and a reopened tab. Taken twice, it peels the two most recent logs: a
 * stack over everything logged today, not a single-level undo of the last tap.
 *
 * Nothing to take back is `ok`, not a failure — the card offers no undo control
 * in that state, so reaching here means the screen was behind, and `refresh()`
 * is the correction. A banner would be reporting a problem the user does not
 * have.
 */
export async function undoLastLog(): Promise<LogResult> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    const today = await loadToday(session.userId, new Date(), await readCursor());

    if (!today) return FAILED;

    const target = latestLog(today.logs);

    // Only step the view back if a row was actually removed. `deleteLog`
    // returns false for a log already gone — another tab got there first — and
    // moving the cursor for a delete that did nothing would take the card back
    // past an item that is still logged.
    if (target && (await deleteLog(session.userId, target))) {
      await writeCursor(retreat(today.view));
    }

    refresh();

    return DONE;
  } catch (error) {
    console.error("Could not undo the log.", error);

    return FAILED;
  }
}
