import type { Meal, MealLog, MealSlot } from "./db/schema";
import { type ResolvedMeal, SLOT_ORDER } from "./resolve-plan";

/**
 * What was planned, what a swap put there, and what was eaten — FUEL-39, PRD § P6.
 *
 * Pure: no database, no clock, no `server-only`. It is handed a date's two
 * resolutions and that date's logs, and returns the comparison. Both exports
 * consume it — `export-week.ts` renders it as three CSV columns and
 * `export.ts` as three fields — which is the entire reason the module exists.
 *
 * ## Why this is not left inside the CSV builder
 *
 * It was, until this ticket. `export-week.ts` computed the triple privately
 * inside `mealRows`, which was correct and untroubled for as long as one
 * artefact carried it. The moment a second artefact has to answer the same
 * question, a private rule becomes two implementations of it, and the two
 * would not fail together: a JSON export whose `planned` meant "what stood
 * after the swap" would still parse, still validate, and disagree with the CSV
 * for exactly the days that matter — the swapped ones. PRD § Risks names that
 * outcome ("macro totals drift from reality because logs are aspirational")
 * and puts this distinction forward as the mitigation, so the distinction
 * itself is worth having in one place.
 *
 * ## The three answers, and where each comes from
 *
 * PRD § Plan versus actual: "`day_plan_overrides` records what was *scheduled*
 * after a swap; `meal_logs` records what was *consumed*. Keeping them separate
 * is what lets the export show planned, actual, and swapped-with as three
 * distinct columns."
 *
 *   - `planned` — the weekly TEMPLATE's meal for that weekday and slot,
 *     `plan_template_entries` resolved with overrides ignored. The recurring
 *     intent, as it stood before anything happened to the day.
 *   - `swappedWith` — the `day_plan_overrides` meal, `null` when the slot was
 *     never swapped. Not "the meal that stood": a slot nothing swapped has no
 *     swap to report, and filling this with the template's meal would make
 *     every day look edited.
 *   - `actual` — the meal the `meal_log` names, `null` when the slot was never
 *     logged.
 *
 * The three usually agree, because `actions/log.ts` re-resolves the plan on the
 * server and takes the meal id from its own answer. They come apart in exactly
 * the cases worth reporting: a swap (`planned` and `swappedWith` differ), an
 * unlogged slot (`actual` is absent), and a slot logged and only afterwards
 * swapped (all three differ, and `actual` is the one that was eaten).
 *
 * ## Two resolutions in, and why they are not one argument
 *
 * `templateMeals` and `resolvedMeals` are both `ResolvedMeal[]` and passing
 * them the wrong way round would invert `planned` and `swappedWith` on every
 * swapped slot — a file that still opens, still sums, and is wrong only where
 * anyone would look. So they arrive named, in an object, rather than
 * positionally. The types cannot tell them apart; the parameter names can.
 *
 * They are passed in rather than resolved here for a second reason: the two
 * callers get them from different places. The CSV is handed a week already
 * resolved by `queries/week-export.ts`, and the JSON resolves date by date over
 * an account's whole history. A module that called `resolveDay` itself would
 * force one of them into the other's shape.
 *
 * ## A slot reports its most recent log, not all of them
 *
 * `meal_logs` has no unique constraint — `actions/log.ts` says so, and guards
 * with `alreadyLogged` — so a double tap or a retry after a lost response can
 * leave two rows for one slot. This takes the later of them, by instant then by
 * id, which is `latestLog`'s rule in `log-intent.ts` and the one undo already
 * works by: the most recent decision is the decision. The superseded row is not
 * lost; it is in the JSON export's `mealLogs`, whole.
 *
 * ## A slot appears when any of the three has something to say
 *
 * Not when all three do, and not only when the slot was logged. A slot that was
 * planned and never logged is the gap the feature exists to show, and a swap on
 * a day nothing was eaten is the same gap read from the other side. What is
 * dropped is the slot where all three are absent: a plan that does not use
 * `extra` would otherwise emit an empty row every day, saying the slot exists,
 * which for that plan is not true.
 *
 * ## A log whose meal is missing keeps its status
 *
 * `actual` is `null` when the library does not hold the logged meal, while
 * `status` still reports what the log said. The composite foreign key makes
 * that unreachable in practice — both callers pass the whole library — but the
 * shape matters: it is what makes "the slot was logged" and "we can name what
 * was eaten" separate questions, so the two artefacts degrade identically
 * rather than one blanking a row the other keeps.
 */

/** One slot, answered three ways. `null` is "nothing to report", never "same". */
export type SlotComparison = {
  slot: MealSlot;
  /** `plan_template_entries` — the recurring intent, overrides ignored. */
  planned: Meal | null;
  /** `day_plan_overrides` — the swap, or `null` if the slot was not swapped. */
  swappedWith: Meal | null;
  /** `meal_logs` — what was eaten, or `null` if the slot was not logged. */
  actual: Meal | null;
  /** The log's status, present whenever the slot was logged at all. */
  status: MealLog["status"] | null;
  /** The log's note. */
  note: string | null;
};

/** Everything one date's comparison needs, already resolved and narrowed. */
export type DayComparisonInput = {
  /** `templateDay(plan, date)` — the template alone. */
  templateMeals: readonly ResolvedMeal[];
  /** `resolveDay(plan, date)` — the template with overrides layered over it. */
  resolvedMeals: readonly ResolvedMeal[];
  /** That date's meal logs, and no other date's. */
  logs: readonly MealLog[];
  /** The library, for naming what a log points at. */
  meals: ReadonlyMap<string, Meal>;
};

/**
 * The later of two logs, by instant then by id.
 *
 * `latestLog` in `log-intent.ts` makes the same call for the same reason, and
 * states it: `logged_at` defaults to `now()`, so two rows written in the same
 * statement can share an instant, and without the id the answer would depend on
 * which row was scanned first.
 */
function later<T extends { loggedAt: Date; id: string }>(a: T, b: T): T {
  const at = a.loggedAt.getTime();
  const bt = b.loggedAt.getTime();

  if (at === bt) return a.id > b.id ? a : b;

  return at > bt ? a : b;
}

/** The one log that speaks for a slot — see the module comment. */
function slotLog(logs: readonly MealLog[], slot: MealSlot): MealLog | undefined {
  return logs
    .filter((log) => log.slot === slot)
    .reduce<MealLog | undefined>(
      (latest, log) => (latest ? later(latest, log) : log),
      undefined,
    );
}

/**
 * One date, compared — in `SLOT_ORDER`, which is the order a day is eaten in.
 *
 * The order comes from the slot enum rather than from any row, so two
 * comparisons of unchanged data are identical and a caller can write them
 * straight out without sorting. That is what keeps both exports byte-identical
 * across runs, and it is why this returns an array rather than a map.
 *
 * The date is the CALLER's. Nothing here needs it — the three inputs are
 * already narrowed to one date — and taking it would invite a caller to pass a
 * date that disagreed with the rows beside it.
 */
export function compareDay({
  templateMeals,
  resolvedMeals,
  logs,
  meals,
}: DayComparisonInput): SlotComparison[] {
  return SLOT_ORDER.flatMap((slot) => {
    const fromTemplate = templateMeals.find((meal) => meal.slot === slot);
    const onTheDay = resolvedMeals.find((meal) => meal.slot === slot);
    const log = slotLog(logs, slot);

    if (!fromTemplate && !onTheDay && !log) return [];

    return [
      {
        slot,
        planned: fromTemplate?.meal ?? null,
        // The resolved meal, but only when an override is what resolved it.
        // `source` is the field that knows; comparing the two meals would call
        // a swap to the same meal no swap at all.
        swappedWith: onTheDay?.source === "override" ? onTheDay.meal : null,
        actual: log ? (meals.get(log.mealId) ?? null) : null,
        status: log?.status ?? null,
        note: log?.note ?? null,
      },
    ];
  });
}

/**
 * The meal that stood for a slot — the swap if there was one, else the template.
 *
 * `resolveSlot`'s answer, reconstructed from the comparison rather than carried
 * as a fourth field, because it is not a fourth answer: it is `swappedWith`
 * when that is present and `planned` otherwise, exactly as resolution decides
 * it. A stored copy would be a value that could come to disagree with the two
 * fields it is derived from.
 *
 * The CSV's macro columns need it — they describe what was eaten if anything
 * was, and otherwise what was scheduled — and nothing else does.
 */
export function stood(comparison: SlotComparison): Meal | null {
  return comparison.swappedWith ?? comparison.planned;
}
