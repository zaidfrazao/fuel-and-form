"use server";

import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { type CalendarDate, parseCalendarDate, startOfWeek } from "@/lib/date";
import { checkItem, uncheckItem } from "@/lib/db/queries/shopping";
import { normaliseKey } from "@/lib/shopping-list";

/**
 * Ticking a line of the shopping list off, and putting it back — P8, FUEL-45.
 *
 * The sibling of `log.ts` and `swap.ts`, built on the three rules `log.ts`
 * argues in full: a Server Action is a public endpoint, so the session is
 * resolved here rather than trusted from the caller; every write goes through
 * the `user_id`-scoped data layer; and nothing throws, because § Feedback needs
 * a value to render a banner from.
 *
 * ## What the client is allowed to name, and why it is more than usual
 *
 * `log.ts` accepts a key and nothing else, because everything it writes is
 * derivable from today's plan. This action cannot take that shape. A tick is
 * about a LINE of an aggregate — a normalised ingredient name that exists only
 * after seventy ingredient rows have been folded together — and there is no
 * server-side identifier for it that the client could send instead. So both
 * values cross the wire, and each is narrowed as far as it can be:
 *
 *   - **The week is snapped, not accepted.** `startOfWeek` runs on whatever
 *     date arrives, so a request naming a Wednesday writes the Monday's row.
 *     That is the same function the page used to decide which week it was
 *     showing, which is what stops a tick and the list it was made against
 *     from landing in two different weeks.
 *   - **The key is re-normalised.** `normaliseKey` is `shopping-list.ts`'s own
 *     function, not a copy of it, so the key stored is the key the aggregation
 *     will look for. A client sending "Beef Mince " writes "beef mince".
 *   - **The key is bounded.** See `MAX_KEY` below.
 *
 * ## Why the key is not checked against the week's actual list
 *
 * It could be: re-resolve the week, aggregate it, and refuse a key that is not
 * in the result. That is what `swap.ts` does with a meal id, and the reason it
 * is right there and wrong here is what a forged value BUYS.
 *
 * A swap writes a row the plan then renders — an unchecked meal id would put
 * another user's meal on a screen, which is a cross-tenant read. A tick writes
 * a row that is only ever joined BACK to a list the server itself computed: a
 * key matching nothing renders nothing, on this user's own screen, forever. It
 * cannot be read out, and it cannot make anything else render differently.
 *
 * Against that, the check costs five queries and two sequential round trips on
 * every tap, on a screen whose whole interaction is tapping — against § Feedback's
 * 300ms budget. Paying that to prevent a row nobody can observe would be the
 * expensive half of a trade with nothing on the other side.
 *
 * What remains is volume, and that is what `MAX_KEY` bounds.
 */

/** What the row renders from. Success carries nothing — see § Feedback. */
export type CheckResult = { ok: boolean };

const DONE: CheckResult = { ok: true };
const FAILED: CheckResult = { ok: false };

/**
 * The longest key this will store.
 *
 * `item_key` is `text`, so Postgres would take a megabyte of it, and the one
 * thing an unvalidated key genuinely allows is a request that stores far more
 * than an ingredient name. 200 characters is comfortably longer than any real
 * one — the seeded library's longest is "Olive oil (for the potatoes)" — and
 * short enough that the table cannot be used as storage.
 *
 * Refused rather than truncated, on `lib/repeat.ts`'s reasoning for its own
 * bound: truncating would silently store a DIFFERENT key from the one the
 * caller named, which then ticks nothing and looks like a bug in the list. A
 * refusal is an answer the screen can show.
 */
const MAX_KEY = 200;

/**
 * Sets or clears the tick on one line of one week's list.
 *
 * One action for both directions rather than two, because they are one control:
 * a checkbox's two states are the same tap, and splitting them would put the
 * decision about which to call in the browser, where a stale render could get
 * it wrong. Underneath they are genuinely different statements — an upsert and
 * a delete — and `queries/shopping.ts` holds that difference.
 *
 * The failures are not distinguished in the return value, on `log.ts`'s
 * reasoning: "no session", "a malformed week" and "the database is down" get
 * the same banner, and a caller who can tell them apart learns something about
 * the deployment for nothing.
 */
export async function setChecked({
  week,
  key,
  checked,
}: {
  /** Any date in the week being shopped for. Snapped to its Monday here. */
  week: CalendarDate;
  /** The line's normalised name. Re-normalised here regardless. */
  key: string;
  checked: boolean;
}): Promise<CheckResult> {
  try {
    const session = await getSession();

    if (!session) return FAILED;

    // A malformed date is a refusal rather than "this week". `requestedWeek`
    // falls back for a URL because a person can edit one and should get a page
    // instead of an error — but this is a write, and writing a tick onto a week
    // nobody named would be an invented fact rather than a forgiving default.
    let monday: CalendarDate;

    try {
      parseCalendarDate(week);
      monday = startOfWeek(week);
    } catch {
      return FAILED;
    }

    const itemKey = normaliseKey(key);

    // An empty key after normalising — whitespace, or nothing at all. The
    // aggregation skips a blank ingredient name for the same reason, so there
    // is no line this could ever tick.
    if (!itemKey || itemKey.length > MAX_KEY) return FAILED;

    if (checked) await checkItem(session.userId, monday, itemKey);
    else await uncheckItem(session.userId, monday, itemKey);

    // The list is server-rendered, and the row is optimistic until this lands.
    // Without it the screen would keep showing the optimistic answer with
    // nothing behind it — correct until the next navigation, and then not.
    refresh();

    return DONE;
  } catch (error) {
    console.error("setChecked failed", error);

    return FAILED;
  }
}
