import type { CalendarDate } from "./date";
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
export function dayLog(items: readonly NowItem[], logs: DayLogs): LoggedEntry[] {
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
