import type { CalendarDate, TimeOfDay } from "./date";
import type { MealLogStatus, WorkoutLogStatus } from "./db/schema";
import { type DayLogs, type LogVerb, logIntent } from "./log-intent";
import { type MacroBearing, type MacroTotals, totalMacros } from "./macros";
import { itemName, slotLabel } from "./now-display";
import type { NowItem, ScheduledItem } from "./resolve-now";

/**
 * The day-complete summary's data — FUEL-20, PRD § P1's last criterion.
 *
 * "After the last item of the day, the view shows a day-complete summary with
 * actual versus target macros." This file is the *actual* half: the day's log
 * rows, turned into the list the screen prints and the four numbers underneath
 * it. The target half is `profiles`, and the subtraction is `macros.ts`.
 *
 * ## Actual means logged, not planned
 *
 * `dayTotals` in macros.ts answers "what was PLANNED for this date". That is the
 * wrong number here, and wrong in a way that flatters: a day whose dinner was
 * skipped would report the dinner's calories anyway. PRD § Risks asks for the
 * opposite — *"export separates planned from actual, so the gap is visible at
 * check-ins rather than hidden"* — and the Brand Guide's own mock shows 1,715
 * kcal beside a list containing a skipped item. So the total below is over the
 * meals whose log row says `eaten`, and a day advanced through by hand with
 * nothing logged honestly reads zero against target.
 *
 * ## Why the entries carry their own macros
 *
 * The summary is reachable OPTIMISTICALLY: logging the last item of the day
 * flips `/` to it on the current frame, before the server has answered
 * (`right-now.tsx`, FUEL-19). So the totals cannot be computed on the server and
 * shipped as four numbers — the tap that produces this screen would leave them
 * short by exactly the meal that produced it, for as long as the request takes.
 *
 * Hanging each entry's macros off the entry makes one list drive both halves:
 * the client appends the entry the tap implies and the totals move with it. It
 * also keeps the payload narrow — four numbers per eaten meal rather than the
 * `meals` row, whose `method` is unbounded text the screen never shows.
 *
 * ## Pure, like everything it reads
 *
 * No database access, no `user_id`, no `server-only`, and only TYPE imports from
 * the schema. `app/page.tsx` fetches the rows and calls `dayLog`; the browser
 * gets the answer, never the rows.
 */

/** Every status a log row can carry, across both tables. */
export type LogStatus = MealLogStatus | WorkoutLogStatus;

/**
 * The word on the right of a logged row.
 *
 * The four statuses the two log tables hold, in the app's own vocabulary.
 * 'partial' has no verb on P1 — one tap means done — but the schema keeps room
 * for it and an export or a later screen can write one, so it is named here
 * rather than left to fall through to something wrong.
 *
 * Here rather than in `day-complete.tsx`, where FUEL-20 wrote it, because
 * FUEL-86's `The day` prints the same four words in the aside on `/`. Two
 * copies of this map is two chances for one screen to call a skip something the
 * other does not — the same argument `format.ts` and `now-display.ts` are both
 * recorded as having been extracted on.
 */
export const STATUS_LABEL: Readonly<Record<LogStatus, string>> = {
  eaten: "Eaten",
  done: "Done",
  partial: "Partial",
  skipped: "Skipped",
};

/** One line of the day's log, as the summary prints it. */
export type LoggedEntry = {
  /**
   * React's key, and nothing else. The log row's id for a persisted entry, and
   * a `pending:` one for an optimistic entry that has no row yet — so the two
   * cannot collide when the optimistic one is appended to the server's list.
   */
  id: string;
  /** The item's own name, resolved from today's plan. */
  name: string;
  status: LogStatus;
  /**
   * What this entry contributes to the day's totals.
   *
   * Present on an eaten meal and on nothing else: a skipped meal contributes
   * nothing by definition, and a session has no macros to contribute. Absent
   * rather than zeroed, so `entryTotals` needs no second rule to decide which
   * zeroes are real.
   */
  macros?: MacroBearing;
  /**
   * Set on the daily walk's line, and on nothing else — FUEL-29.
   *
   * The line is printed like any other, because the walk happened and the day's
   * record would be short without it. What the flag decides is whether `/`'s
   * Undo control counts it: that control is a stack over the logs the ACTION BAR
   * wrote, and `lib/walk.ts` sets out why the walk is not one of them. Without
   * this, a day whose only log was the walk would offer an Undo that takes back
   * nothing.
   *
   * Absent rather than `false`, on the same reasoning as `macros`: it is a
   * property of one kind of line, and a `false` on every other would invite a
   * reader to believe something distinguishes them.
   */
  walk?: true;
};

/** A meal's four figures, and none of the rest of the row. */
const macrosOf = ({ kcal, proteinG, fatG, carbG }: MacroBearing): MacroBearing => ({
  kcal,
  proteinG,
  fatG,
  carbG,
});

/**
 * The day's log, in the order it happened.
 *
 * `items` is today's resolved plan — `timeline` and `anytime` together — and it
 * is what turns an id into a name: log rows carry `meal_id` and `workout_id`,
 * because a log records what was eaten rather than what it was called at the
 * time.
 *
 * ## The order is the same order undo works in
 *
 * Sorted by `logged_at`, ties broken by id, which is exactly `latestLog`'s
 * comparison in log-intent.ts. That is not a coincidence to be maintained by
 * hand — it is what makes "undo takes back the last line of this list" true on
 * the screen as well as in the database, and what lets the optimistic layer pop
 * the entry it appended rather than searching for it.
 *
 * ## A row naming something not on today's plan
 *
 * It still gets a line, named by its slot — "Breakfast" rather than the meal.
 * Dropping it would be worse in two ways: the count would disagree with
 * `logCount`, which is what offers the undo control, and a log the user
 * genuinely made would vanish from the day's record with nothing to say why. It
 * contributes no macros, because the figures went with the row that is missing.
 *
 * Unreachable today — nothing removes a meal from a day it was logged on until
 * P2's swap exists — which is precisely why it is written down now rather than
 * discovered later as a summary that quietly disagrees with itself.
 */
export function dayLog(
  items: readonly NowItem[],
  logs: DayLogs,
  /**
   * The workouts whose logs belong to a row of their own rather than to the
   * action bar — the daily walk's, from `walkWorkoutIds(view.anytime)`.
   *
   * Passed in rather than derived from `items`, because `items` is the whole day
   * and the answer depends on WHICH HALF of it a walk is in. That distinction is
   * the caller's: `app/page.tsx` and `actions/log.ts` hand the same set to this
   * and to `withoutWalks`, so the control this decides to offer and the row that
   * one decides to take back cannot disagree.
   *
   * Defaulted to empty so a caller that has no view — a test asking only about
   * names and ordering — need not invent one.
   */
  walks: ReadonlySet<string> = new Set(),
): LoggedEntry[] {
  const meals = new Map(
    items.flatMap((item) => (item.kind === "meal" ? [[item.meal.meal.id, item.meal.meal]] : [])),
  );
  const workouts = new Map(
    items.flatMap((item) =>
      item.kind === "workout" ? [[item.workout.workout.id, item.workout.workout]] : [],
    ),
  );

  const rows = [
    ...logs.meals.map((log) => {
      const meal = meals.get(log.mealId);

      return {
        at: log.loggedAt.getTime(),
        entry: {
          id: log.id,
          name: meal?.name ?? slotLabel(log.slot),
          status: log.status,
          // The macros of what was eaten, from the meal the log names — never
          // from the slot, which a swap could have refilled since.
          ...(meal && log.status === "eaten" ? { macros: macrosOf(meal) } : {}),
        } satisfies LoggedEntry,
      };
    }),
    ...logs.workouts.map((log) => ({
      at: log.loggedAt.getTime(),
      entry: {
        id: log.id,
        name: workouts.get(log.workoutId)?.name ?? "Training",
        status: log.status,
        ...(walks.has(log.workoutId) ? { walk: true as const } : {}),
      } satisfies LoggedEntry,
    })),
  ];

  return rows
    .sort((a, b) => a.at - b.at || (a.entry.id > b.entry.id ? 1 : -1))
    .map(({ entry }) => entry);
}

/**
 * What the day actually came to.
 *
 * `totalMacros` does the arithmetic and the rounding, so the summary's figures
 * and P4's planned totals are produced by the same function — the two are meant
 * to be compared, and a second implementation here would be the way they come to
 * disagree about a decimal.
 */
export function entryTotals(entries: readonly LoggedEntry[]): MacroTotals {
  return totalMacros(entries.flatMap((entry) => entry.macros ?? []));
}

/**
 * The entry a tap implies, before the row exists.
 *
 * The optimistic half of the summary. `logIntent` decides the status — the same
 * call the server action makes — so a skip cannot be filed as `eaten` on the
 * screen and `skipped` in the table. The date is required for no other reason
 * than that `logIntent` takes one; nothing here reads it.
 *
 * The id is the item's key, prefixed, which makes it stable across re-renders
 * and impossible to confuse with a uuid from the database.
 */
export function pendingEntry(
  item: ScheduledItem,
  verb: LogVerb,
  date: CalendarDate,
): LoggedEntry {
  const intent = logIntent(item, verb, date);

  return {
    id: `pending:${item.key}`,
    name: itemName(item),
    status: intent.status,
    ...(item.kind === "meal" && intent.status === "eaten"
      ? { macros: macrosOf(item.meal.meal) }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The day, whole — FUEL-86                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One row of `The day` — the desktop aside's list of every scheduled item with
 * what became of it.
 *
 * Brand Guide § Desktop gives the aside "the record, the pattern, the day
 * around it, what can still be done", and FUEL-85's redraw of `/` spends that
 * on the whole timeline rather than on the two items `Up next` shows. The phone
 * keeps Up next; this is the section the two widths do not share.
 */
export type DayRow = {
  /** The timeline item's own key — stable, and React's. */
  key: string;
  name: string;
  at: TimeOfDay;
  /** Where the item sits relative to the cursor. */
  place: "past" | "now" | "upcoming";
  /**
   * What it was logged as, when the log names it.
   *
   * Absent on everything ahead of the cursor, and absent on a past item that
   * was never logged — the manual advance walks past an item without writing a
   * row, so that is an ordinary state rather than a missing join.
   */
  status?: LogStatus;
};

/**
 * The timeline, joined to what has actually been recorded against it.
 *
 * ## No new data, and no new query
 *
 * FUEL-86: "the client already holds the full timeline and every logged entry".
 * Both arguments are already on `/` — `view.timeline` and the `entries` the
 * day-complete summary prints — so this is a join rather than a fetch, and the
 * optimistic entry `pendingEntry` appends is in it for free.
 *
 * ## Position decides past, and the log only supplies the word
 *
 * The cursor is the authority on what has happened: everything before it is
 * past, the item at it is now, everything after is upcoming. That is the same
 * rule `positionAt` uses to pick the card, so the list and the card can never
 * disagree about where the day has got to.
 *
 * ## Why the join is by name, and why it is a queue
 *
 * A log row cannot reproduce a timeline key. `ScheduledItem.key` is per PLAN
 * ENTRY — `mealKey` exists precisely so "two entries in one slot — the two
 * snacks — are two entry ids, so they stay distinguishable" — while
 * `meal_logs` holds a slot and a meal id and no entry id at all. So slot is not
 * unique, the key is not reachable, and the name is what both sides have.
 *
 * Names are not unique either, which is why this is a Map of QUEUES rather than
 * a Map of statuses: a day with the same meal in two slots produces two log
 * rows with one name, and taking the first for both would report a skip against
 * the slot that was eaten. Shifting consumes each row once, in logged order,
 * against the earliest unmatched item that bears the name. That is exact
 * whenever the two orders agree and, when they do not, it is wrong only about
 * WHICH of two identically named rows is which — a distinction the reader
 * cannot see, because the two rows read the same.
 *
 * The walk is excluded. It is in `anytime` and not on the timeline, so its log
 * row has nothing here to match and leaving it in would let it be consumed by a
 * scheduled item that happened to share its name.
 */
export function theDay(
  timeline: readonly ScheduledItem[],
  position: number,
  entries: readonly LoggedEntry[],
): DayRow[] {
  const pending = new Map<string, LogStatus[]>();

  for (const entry of entries) {
    if (entry.walk) continue;

    const queue = pending.get(entry.name);

    if (queue) queue.push(entry.status);
    else pending.set(entry.name, [entry.status]);
  }

  return timeline.map((item, index) => {
    const name = itemName(item);
    const place = index < position ? "past" : index === position ? "now" : "upcoming";
    // Only a past item consumes a row. An upcoming item cannot have been
    // logged, and taking a status for one would hand the next item along the
    // queue's answer.
    const status = place === "past" ? pending.get(name)?.shift() : undefined;

    return { key: item.key, name, at: item.at, place, ...(status ? { status } : {}) };
  });
}
