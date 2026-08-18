import type { CalendarDate } from "./date";
import type {
  MealLog,
  MealLogStatus,
  MealSlot,
  WorkoutLog,
  WorkoutLogStatus,
} from "./db/schema";
import type { NowItem } from "./resolve-now";

/**
 * What a tap means, as a row — P1's "log eaten", "mark done" and "skip".
 *
 * The whole of the decision, and none of the writing. `app/actions/log.ts`
 * resolves who is asking and `lib/db/queries/log.ts` runs the statement; this
 * file is the part in between that can be wrong in a way nothing would notice:
 * a skip recorded as `eaten`, a meal's slot taken from the request rather than
 * from resolution, a duplicate row that silently doubles a day's protein.
 *
 * Pure, and gated at 100% in vitest.config.mts for that reason. It takes a
 * RESOLVED item — the same `NowItem` the screen is rendering — and never an id
 * from a request, which is what makes "you cannot log something that is not on
 * your plan today" a property of the types rather than a check somebody has to
 * remember to write.
 *
 * ## Two verbs, four statuses
 *
 * The user-facing vocabulary is two words wide: log it, or skip it. The schema's
 * is four, across two enums — `meal_log_status` is 'eaten' | 'skipped' and
 * `workout_log_status` is 'done' | 'partial' | 'skipped'. Mapping between them
 * lives here and nowhere else, so the button labels in `right-now.tsx` and the
 * enum values in `schema.ts` cannot drift apart through a third file's opinion.
 *
 * 'partial' has no verb. It is a first-class outcome the schema keeps room for,
 * but P1's card offers one tap and the honest reading of one tap is "done" —
 * inventing a way to reach 'partial' from a control that does not exist would be
 * a status no user ever chose.
 */

/** The two things a tap can mean. */
export type LogVerb = "log" | "skip";

/**
 * A row to write, with its table decided.
 *
 * Deliberately not `NewMealLog` / `NewWorkoutLog`: those carry `user_id`, and
 * ownership is the scope's to fill in — a type with room for it here would be a
 * type a caller could put the wrong one into.
 */
export type LogIntent =
  | {
      kind: "meal";
      date: CalendarDate;
      slot: MealSlot;
      mealId: string;
      status: MealLogStatus;
    }
  | {
      kind: "workout";
      date: CalendarDate;
      workoutId: string;
      status: WorkoutLogStatus;
    };

/**
 * The row a verb produces for an item, on a date.
 *
 * `date` is an argument rather than read from a clock, and it comes from the
 * same resolution that produced the item — so the row lands on the day the
 * screen was showing, in the user's configured timezone, even if the request
 * crosses midnight while it is in flight.
 */
export function logIntent(item: NowItem, verb: LogVerb, date: CalendarDate): LogIntent {
  if (item.kind === "meal") {
    return {
      kind: "meal",
      date,
      slot: item.meal.slot,
      mealId: item.meal.meal.id,
      status: verb === "log" ? "eaten" : "skipped",
    };
  }

  return {
    kind: "workout",
    date,
    workoutId: item.workout.workout.id,
    status: verb === "log" ? "done" : "skipped",
  };
}

/** Today's logs, both kinds, as the undo affordance and the guard below read them. */
export type DayLogs = {
  meals: MealLog[];
  workouts: WorkoutLog[];
};

/** A log row with its table, so a caller can delete it without guessing. */
export type LoggedRow =
  | { kind: "meal"; log: MealLog }
  | { kind: "workout"; log: WorkoutLog };

/**
 * Whether today already holds this exact log.
 *
 * `meal_logs` has no unique constraint, deliberately — a slot may hold more than
 * one meal — so nothing in the database stops the same tap being recorded twice.
 * Two ways that happens in practice: a double-tap in a kitchen, and a retry
 * after a request that actually succeeded but whose response was lost. Both
 * would double-count in P4's day totals, which is a number the user is asked to
 * trust.
 *
 * So the action checks before it writes. This is a read-then-write and the race
 * is real; it is also one person tapping one phone, and the worst outcome of
 * losing the race is a single duplicate row rather than anything corrupt. The
 * alternative — a partial unique index — is a migration that would also forbid
 * two legitimately different template entries naming the same meal in one slot.
 */
export function alreadyLogged(logs: DayLogs, intent: LogIntent): boolean {
  if (intent.kind === "meal") {
    return logs.meals.some(
      (log) =>
        log.date === intent.date &&
        log.slot === intent.slot &&
        log.mealId === intent.mealId &&
        log.status === intent.status,
    );
  }

  return logs.workouts.some(
    (log) =>
      log.date === intent.date &&
      log.workoutId === intent.workoutId &&
      log.status === intent.status,
  );
}

/**
 * How many logs today holds, both kinds.
 *
 * The only thing P1's card needs to know about them: whether there is anything
 * to undo, and — while a tap is in flight — whether there still would be. The
 * screen is handed this number rather than the rows themselves, so the log
 * history does not travel to the browser to be counted there.
 */
export function logCount(logs: DayLogs): number {
  return logs.meals.length + logs.workouts.length;
}

/**
 * The most recent log of the day — what undo takes back.
 *
 * Brand Guide § Feedback: "any log or swap is revertible from where it was
 * performed, for the rest of that day". Reading that from the persisted rows
 * rather than from client state is what makes "for the rest of the day" true:
 * the phone locks, the tab is reopened, and undo is still there. Peeling the
 * most recent one repeatedly makes it a stack over everything logged today
 * rather than a single-level undo of the last tap.
 *
 * `logged_at` is a `timestamptz` with a `defaultNow()`, so two rows written in
 * the same statement can share an instant. The id breaks the tie, which makes
 * the order total — undo taken twice removes two different rows, never the same
 * one twice, and the answer does not depend on which array was searched first.
 */
export function latestLog(logs: DayLogs): LoggedRow | null {
  const rows: LoggedRow[] = [
    ...logs.meals.map((log): LoggedRow => ({ kind: "meal", log })),
    ...logs.workouts.map((log): LoggedRow => ({ kind: "workout", log })),
  ];

  return rows.reduce<LoggedRow | null>(
    (latest, row) => (latest === null || isAfter(row, latest) ? row : latest),
    null,
  );
}

/** Strictly later, by instant then by id. See `latestLog` on why the id is here. */
function isAfter(row: LoggedRow, than: LoggedRow): boolean {
  const a = row.log.loggedAt.getTime();
  const b = than.log.loggedAt.getTime();

  return a === b ? row.log.id > than.log.id : a > b;
}
