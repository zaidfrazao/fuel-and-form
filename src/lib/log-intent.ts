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

/**
 * A meal's four figures as a log row carries them — FUEL-146.
 *
 * Copied from the resolved meal at the moment of logging, so the row keeps
 * what was eaten if the recipe is edited later. They come from the same
 * server-side resolution as `mealId`, never from the request: a figure the
 * client could send is a day's protein the client could choose.
 */
export type LoggedFigures = Pick<MealLog, "kcal" | "proteinG" | "fatG" | "carbG">;

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
  | ({
      kind: "meal";
      date: CalendarDate;
      slot: MealSlot;
      mealId: string;
      status: MealLogStatus;
    } & LoggedFigures)
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
    const { id, kcal, proteinG, fatG, carbG } = item.meal.meal;

    return {
      kind: "meal",
      date,
      slot: item.meal.slot,
      mealId: id,
      status: verb === "log" ? "eaten" : "skipped",
      kcal,
      proteinG,
      fatG,
      carbG,
    };
  }

  return {
    kind: "workout",
    date,
    workoutId: item.workout.workout.id,
    status: verb === "log" ? "done" : "skipped",
  };
}

/**
 * A session's log row that records an outcome — FUEL-134.
 *
 * `workout_logs.status` is null on a row the first logged set wrote and nobody
 * has marked yet. That row is the sets' parent, not a log of the session: it is
 * not something `/` logged, not something it may undo, and not a reason to
 * call the session logged. So `DayLogs` holds only the marked rows, and the
 * type says so rather than leaving every reader to check.
 */
export type MarkedWorkoutLog = WorkoutLog & { status: WorkoutLogStatus };

/** Whether a session's row records an outcome. See `MarkedWorkoutLog`. */
export function isMarked(log: WorkoutLog): log is MarkedWorkoutLog {
  return log.status !== null;
}

/** Today's logs, both kinds, as the undo affordance and the guard below read them. */
export type DayLogs = {
  meals: MealLog[];
  workouts: MarkedWorkoutLog[];
};

/** A log row with its table, so a caller can delete it without guessing. */
export type LoggedRow =
  | { kind: "meal"; log: MealLog }
  | { kind: "workout"; log: MarkedWorkoutLog };

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

/**
 * Whether a log row was written for this item — FUEL-131.
 *
 * Undo's question since the `Not logged` section gave `/` a second place to log
 * from. The bar logs the card and moves it on, so taking that row back moves
 * the card back; a row logged against an item the day already walked past moved
 * nothing, and taking it back must not either. So Undo steps back only when the
 * row it removes belongs to the item directly behind the card.
 *
 * The same fields `alreadyLogged` compares, less the date and the status: the
 * date is today's by construction (the stack is today's rows), and the status is
 * what the row SAYS about the item, not which item it is. A meal is its slot
 * and its meal; a session is its workout.
 */
export function rowBelongsTo(row: LoggedRow, item: NowItem): boolean {
  if (row.kind === "meal") {
    return (
      item.kind === "meal" &&
      row.log.slot === item.meal.slot &&
      row.log.mealId === item.meal.meal.id
    );
  }

  return item.kind === "workout" && row.log.workoutId === item.workout.workout.id;
}
