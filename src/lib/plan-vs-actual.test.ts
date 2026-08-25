import { describe, expect, test } from "vitest";

import type { Meal, MealLog, MealSlot } from "./db/schema";
import { compareDay, type SlotComparison, stood } from "./plan-vs-actual";
import type { ResolvedMeal } from "./resolve-plan";

/**
 * The planned/swapped-with/actual comparison — FUEL-39, PRD § P6.
 *
 * Gated at 100% because both exports render this, and every way it can be
 * wrong produces a VALID FILE. A build that simply reported the resolved meal
 * three times passes every test written over a week where nothing was changed,
 * opens in a spreadsheet, sums correctly, and tells the person reading it that
 * the plan was followed perfectly.
 *
 * So the cases that carry the criterion are the ones where the three DISAGREE.
 * PRD § Risks names the failure this exists to mitigate — "macro totals drift
 * from reality because logs are aspirational" — and the mitigation is only
 * real while the columns keep distinguishing.
 *
 * ## The fixtures
 *
 * Invented figures throughout, per Testing Strategy § 1.5 — this repository is
 * public and the owner's real rows live in the database, never in git.
 */

const USER_ID = "11111111-2222-3333-4444-555555555555";
const MONDAY = "2026-08-17";

const OATS: Meal = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  userId: USER_ID,
  name: "Oats and whey",
  slotType: "breakfast",
  kcal: 430,
  proteinG: 32,
  fatG: 9,
  carbG: 58,
  method: null,
  notes: null,
  isArchived: false,
};

const CHICKEN: Meal = {
  ...OATS,
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Chicken rice bowl",
  slotType: "lunch",
};

const BEEF: Meal = {
  ...OATS,
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Beef and potato",
  slotType: "lunch",
};

/** The whole library, as both callers pass it. */
const LIBRARY = new Map([OATS, CHICKEN, BEEF].map((meal) => [meal.id, meal]));

/** A resolved slot, as `resolveSlot` and `templateSlot` answer. */
function slot(
  slot: ResolvedMeal["slot"],
  meal: Meal,
  source: ResolvedMeal["source"] = "template",
): ResolvedMeal {
  return { slot, meal, source, entryId: `entry-${slot}-${source}` };
}

function mealLog(
  over: Partial<MealLog> & Pick<MealLog, "slot" | "mealId">,
): MealLog {
  return {
    id: "cccccccc-0000-4000-8000-000000000001",
    userId: USER_ID,
    date: MONDAY,
    status: "eaten",
    note: null,
    loggedAt: new Date("2026-08-17T08:00:00.000Z"),
    ...over,
  };
}

/** `compareDay` with the library already supplied — the only constant part. */
function compare({
  templateMeals = [],
  resolvedMeals = [],
  logs = [],
  meals = LIBRARY,
}: {
  templateMeals?: ResolvedMeal[];
  resolvedMeals?: ResolvedMeal[];
  logs?: MealLog[];
  meals?: ReadonlyMap<string, Meal>;
} = {}): SlotComparison[] {
  return compareDay({ templateMeals, resolvedMeals, logs, meals });
}

/** The three answers as names, which is what the disagreements read as. */
function triple(comparison: SlotComparison) {
  return {
    slot: comparison.slot,
    planned: comparison.planned?.name ?? null,
    swappedWith: comparison.swappedWith?.name ?? null,
    actual: comparison.actual?.name ?? null,
    status: comparison.status,
  };
}

/**
 * The comparison for one slot.
 *
 * Throws rather than answering `undefined`, so a slot this module stopped
 * emitting fails as a MISSING SLOT rather than as a handful of null fields in
 * an assertion that was checking something else.
 */
function slotOf(comparisons: SlotComparison[], wanted: MealSlot): SlotComparison {
  const found = comparisons.find((comparison) => comparison.slot === wanted);

  if (!found) throw new Error(`No comparison for ${wanted}`);

  return found;
}

describe("a fixture week with a swap and a skip", () => {
  /**
   * The ticket's own testing note, and the shape of a real week: most days went
   * to plan, one lunch was swapped, one breakfast was skipped.
   *
   * Asserted as the whole comparison rather than field by field, because the
   * claim being made is about the RELATIONSHIP between three columns — a
   * per-field assertion passes just as happily when all three name the same
   * meal, which is the exact bug this is written to catch.
   */
  const MONDAY_TEMPLATE = [slot("breakfast", OATS), slot("lunch", CHICKEN)];

  test("a day that went to plan names the same meal in planned and actual", () => {
    const day = compare({
      templateMeals: MONDAY_TEMPLATE,
      resolvedMeals: MONDAY_TEMPLATE,
      logs: [
        mealLog({ slot: "breakfast", mealId: OATS.id }),
        mealLog({ slot: "lunch", mealId: CHICKEN.id }),
      ],
    });

    // `swappedWith` is null rather than a repeat of `planned`. Filling it with
    // the meal that stood would make every ordinary day read as edited, which
    // is the reading that makes a swap count invisible.
    expect(triple(slotOf(day, "breakfast"))).toEqual({
      slot: "breakfast",
      planned: "Oats and whey",
      swappedWith: null,
      actual: "Oats and whey",
      status: "eaten",
    });
    expect(triple(slotOf(day, "lunch"))).toEqual({
      slot: "lunch",
      planned: "Chicken rice bowl",
      swappedWith: null,
      actual: "Chicken rice bowl",
      status: "eaten",
    });
  });

  test("a swapped lunch reports all three separately", () => {
    // The swap happened, then the swapped meal was eaten. `planned` is what the
    // template still says for every future Monday — the swap did not touch it.
    const day = compare({
      templateMeals: MONDAY_TEMPLATE,
      resolvedMeals: [slot("breakfast", OATS), slot("lunch", BEEF, "override")],
      logs: [mealLog({ slot: "lunch", mealId: BEEF.id })],
    });

    expect(triple(slotOf(day, "lunch"))).toEqual({
      slot: "lunch",
      planned: "Chicken rice bowl",
      swappedWith: "Beef and potato",
      actual: "Beef and potato",
      status: "eaten",
    });
  });

  test("a skipped breakfast names the meal it skipped, and says it was skipped", () => {
    // `actual` is the meal the log names even though nothing was eaten. The
    // status column is what separates intake from intent, and a blank `actual`
    // would make a skip indistinguishable from a slot never logged at all.
    const day = compare({
      templateMeals: MONDAY_TEMPLATE,
      resolvedMeals: MONDAY_TEMPLATE,
      logs: [mealLog({ slot: "breakfast", mealId: OATS.id, status: "skipped" })],
    });

    expect(triple(slotOf(day, "breakfast"))).toEqual({
      slot: "breakfast",
      planned: "Oats and whey",
      swappedWith: null,
      actual: "Oats and whey",
      status: "skipped",
    });
  });

  test("an unlogged slot has no actual, and is still reported", () => {
    // The gap the feature exists to show: planned, and never confirmed. PRD
    // § Risks — the export separates planned from actual "so the gap is visible
    // at check-ins rather than hidden".
    const day = compare({
      templateMeals: MONDAY_TEMPLATE,
      resolvedMeals: MONDAY_TEMPLATE,
    });

    expect(triple(slotOf(day, "breakfast"))).toEqual({
      slot: "breakfast",
      planned: "Oats and whey",
      swappedWith: null,
      actual: null,
      status: null,
    });
  });
});

describe("where the three disagree", () => {
  test("a slot logged before it was swapped keeps both answers", () => {
    // The one case where all three differ, and the reason `actual` is read from
    // the log rather than from the plan: what was eaten was the template's
    // meal, and the plan now says something else. A build that re-read the plan
    // for `actual` would report the beef as eaten, which never happened.
    const day = compare({
      templateMeals: [slot("lunch", CHICKEN)],
      resolvedMeals: [slot("lunch", BEEF, "override")],
      logs: [mealLog({ slot: "lunch", mealId: CHICKEN.id })],
    });

    expect(triple(slotOf(day, "lunch"))).toEqual({
      slot: "lunch",
      planned: "Chicken rice bowl",
      swappedWith: "Beef and potato",
      actual: "Chicken rice bowl",
      status: "eaten",
    });
  });

  test("a swap into a slot the template leaves empty has no planned meal", () => {
    // An extra meal, today only. Null rather than a repeat of the swap: nothing
    // recurring put it there, and saying otherwise would invent a template
    // entry that does not exist.
    const day = compare({
      resolvedMeals: [slot("extra", BEEF, "override")],
      logs: [mealLog({ slot: "extra", mealId: BEEF.id })],
    });

    expect(triple(slotOf(day, "extra"))).toEqual({
      slot: "extra",
      planned: null,
      swappedWith: "Beef and potato",
      actual: "Beef and potato",
      status: "eaten",
    });
  });

  test("a swap nobody logged is still a swap", () => {
    // The same gap read from the other side — the plan changed and nothing was
    // eaten. This is why the JSON section covers dates carrying an override as
    // well as dates carrying a log.
    const day = compare({
      templateMeals: [slot("lunch", CHICKEN)],
      resolvedMeals: [slot("lunch", BEEF, "override")],
    });

    expect(triple(slotOf(day, "lunch"))).toEqual({
      slot: "lunch",
      planned: "Chicken rice bowl",
      swappedWith: "Beef and potato",
      actual: null,
      status: null,
    });
  });

  test("a log outside the plan is reported on its own", () => {
    // Nothing scheduled it and nothing swapped it — a meal logged on a date the
    // template no longer covers. Dropping it would quietly delete recorded
    // history from the file.
    const day = compare({
      logs: [mealLog({ slot: "dinner", mealId: BEEF.id })],
    });

    expect(triple(slotOf(day, "dinner"))).toEqual({
      slot: "dinner",
      planned: null,
      swappedWith: null,
      actual: "Beef and potato",
      status: "eaten",
    });
  });
});

describe("which slots appear", () => {
  test("a slot with nothing to report does not appear at all", () => {
    // Five empty fields would say the slot exists, which for a plan that does
    // not use it is not true.
    expect(compare()).toEqual([]);
    expect(compare({ templateMeals: [slot("breakfast", OATS)] })).toHaveLength(1);
  });

  test("answers in slot order, whatever order the inputs arrive in", () => {
    // The order a day is eaten in, taken from the slot enum rather than from
    // any row — which is what lets both exports write the answer straight out
    // and still be byte-identical between runs.
    const comparisons = compare({
      templateMeals: [
        slot("dinner", BEEF),
        slot("breakfast", OATS),
        slot("snack", OATS),
        slot("lunch", CHICKEN),
      ],
    });

    expect(comparisons.map((comparison) => comparison.slot)).toEqual([
      "breakfast",
      "lunch",
      "snack",
      "dinner",
    ]);
  });
});

describe("a slot with more than one log", () => {
  /**
   * `meal_logs` has no unique constraint, so a double tap or a retry after a
   * lost response leaves two rows for one slot. The later one is the decision —
   * `latestLog`'s rule in `log-intent.ts`, and the one undo works by.
   */
  const EARLIER = new Date("2026-08-17T12:30:00.000Z");
  const LATER = new Date("2026-08-17T12:31:00.000Z");

  test("reports the most recent, not the first or the last in the array", () => {
    const forwards = compare({
      logs: [
        mealLog({ slot: "lunch", mealId: CHICKEN.id, loggedAt: EARLIER }),
        mealLog({ slot: "lunch", mealId: BEEF.id, loggedAt: LATER }),
      ],
    });
    const backwards = compare({
      logs: [
        mealLog({ slot: "lunch", mealId: BEEF.id, loggedAt: LATER }),
        mealLog({ slot: "lunch", mealId: CHICKEN.id, loggedAt: EARLIER }),
      ],
    });

    expect(slotOf(forwards, "lunch").actual?.name).toBe("Beef and potato");
    // Same answer from the reversed array. Without that, the file would be
    // stable per run and different between runs.
    expect(slotOf(backwards, "lunch").actual?.name).toBe("Beef and potato");
  });

  test("breaks a tie on id, because logged_at defaults to now()", () => {
    // Two rows written by the same statement share an instant. Without the
    // tie-break the answer would depend on which row Postgres scanned first.
    const SAME = new Date("2026-08-17T12:30:00.000Z");
    const lo = "cccccccc-0000-4000-8000-0000000000a1";
    const hi = "cccccccc-0000-4000-8000-0000000000f9";

    const forwards = compare({
      logs: [
        mealLog({ id: lo, slot: "lunch", mealId: CHICKEN.id, loggedAt: SAME }),
        mealLog({ id: hi, slot: "lunch", mealId: BEEF.id, loggedAt: SAME }),
      ],
    });
    const backwards = compare({
      logs: [
        mealLog({ id: hi, slot: "lunch", mealId: BEEF.id, loggedAt: SAME }),
        mealLog({ id: lo, slot: "lunch", mealId: CHICKEN.id, loggedAt: SAME }),
      ],
    });

    expect(slotOf(forwards, "lunch").actual?.name).toBe("Beef and potato");
    expect(slotOf(backwards, "lunch").actual?.name).toBe("Beef and potato");
  });

  test("keeps the logs of other slots apart", () => {
    // The latest log for a slot, not the latest log of the day.
    const day = compare({
      logs: [
        mealLog({ slot: "breakfast", mealId: OATS.id, loggedAt: EARLIER }),
        mealLog({ slot: "lunch", mealId: BEEF.id, loggedAt: LATER }),
      ],
    });

    expect(slotOf(day, "breakfast").actual?.name).toBe("Oats and whey");
    expect(slotOf(day, "lunch").actual?.name).toBe("Beef and potato");
  });
});

describe("a log naming a meal the library does not hold", () => {
  test("keeps the status and reports no meal", () => {
    // Unreachable through the composite foreign key — both callers pass the
    // whole library — but the shape is what makes "the slot was logged" and
    // "we can name what was eaten" separate questions, so the CSV and the JSON
    // degrade identically instead of one blanking a row the other keeps.
    const day = compare({
      logs: [mealLog({ slot: "lunch", mealId: BEEF.id })],
      meals: new Map([[OATS.id, OATS]]),
    });

    expect(triple(slotOf(day, "lunch"))).toEqual({
      slot: "lunch",
      planned: null,
      swappedWith: null,
      actual: null,
      status: "eaten",
    });
  });
});

describe("the meal that stood", () => {
  /**
   * `resolveSlot`'s answer, reconstructed from the comparison. The CSV's macro
   * columns are the only caller: they describe what was eaten if anything was,
   * and otherwise what was scheduled.
   */
  test("is the swap when there was one", () => {
    const day = compare({
      templateMeals: [slot("lunch", CHICKEN)],
      resolvedMeals: [slot("lunch", BEEF, "override")],
    });

    expect(stood(slotOf(day, "lunch"))).toBe(BEEF);
  });

  test("is the template's meal when there was not", () => {
    const day = compare({
      templateMeals: [slot("lunch", CHICKEN)],
      resolvedMeals: [slot("lunch", CHICKEN)],
    });

    expect(stood(slotOf(day, "lunch"))).toBe(CHICKEN);
  });

  test("is nothing when nothing was scheduled", () => {
    // A logged slot the plan never filled. The macros then describe the log's
    // own meal, which is `actual` and not this.
    const day = compare({
      logs: [mealLog({ slot: "dinner", mealId: BEEF.id })],
    });

    expect(stood(slotOf(day, "dinner"))).toBeNull();
  });
});
