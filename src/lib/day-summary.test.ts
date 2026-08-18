import { describe, expect, test } from "vitest";

import { dayLog, entryTotals, pendingEntry } from "@/lib/day-summary";
import type { Meal, MealLog, Workout, WorkoutLog } from "@/lib/db/schema";
import type { DayLogs } from "@/lib/log-intent";
import type { NowItem, ScheduledItem } from "@/lib/resolve-now";

/**
 * The day-complete summary's data — FUEL-20, PRD § P1's last criterion.
 *
 * Every way this can be wrong is a plausible-looking wrong number rather than a
 * crash: a skipped meal counted, a swapped meal counted twice, a log listed in
 * an order that makes undo appear to take back the wrong line. None of them
 * surface on the screen that produced them, which is why the module is pure and
 * gated at 100% rather than checked through a rendered tree.
 *
 * The figures below are invented — Testing Strategy § 1.5 and PRD § Risks: the
 * repository is public and the owner's real day stays out of it.
 */

const USER = "user-owner";
const DATE = "2026-03-09";

function meal(fields: Partial<Meal> & { id: string }): Meal {
  return {
    userId: USER,
    name: "Overnight oats",
    slotType: "breakfast",
    kcal: 400,
    proteinG: 30,
    fatG: 10,
    carbG: 45,
    method: null,
    notes: null,
    isArchived: false,
    ...fields,
  };
}

function workout(fields: Partial<Workout> & { id: string }): Workout {
  return {
    userId: USER,
    name: "Circuit A",
    type: "circuit",
    description: null,
    rotationGroup: null,
    rotationIndex: null,
    ...fields,
  };
}

const mealItem = (m: Meal): NowItem => ({
  kind: "meal",
  meal: { slot: m.slotType, meal: m, source: "template", entryId: `entry-${m.id}` },
});

const workoutItem = (w: Workout): NowItem => ({
  kind: "workout",
  workout: { workout: w, source: "rotation", entryId: `entry-${w.id}` },
});

const scheduled = (item: NowItem, key: string): ScheduledItem => ({
  ...item,
  key,
  at: "07:00",
  minutes: 420,
});

/** An instant, as minutes past an arbitrary fixed epoch. Only the order matters. */
const at = (minutes: number) => new Date(Date.UTC(2026, 2, 9, 0, minutes));

function mealLog(fields: Partial<MealLog> & { id: string }): MealLog {
  return {
    userId: USER,
    date: DATE,
    slot: "breakfast",
    mealId: "meal-1",
    status: "eaten",
    note: null,
    loggedAt: at(0),
    ...fields,
  };
}

function workoutLog(fields: Partial<WorkoutLog> & { id: string }): WorkoutLog {
  return {
    userId: USER,
    date: DATE,
    workoutId: "workout-1",
    status: "done",
    note: null,
    durationMin: null,
    loggedAt: at(0),
    ...fields,
  };
}

const OATS = meal({ id: "meal-1", name: "Overnight oats", kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 });
const SALAD = meal({ id: "meal-2", name: "Chicken salad", slotType: "lunch", kcal: 612, proteinG: 54.2, fatG: 14.6, carbG: 63.8 });
const CIRCUIT = workout({ id: "workout-1", name: "Circuit A" });
const WALK = workout({ id: "workout-2", name: "Daily walk", type: "walk" });

const ITEMS: NowItem[] = [mealItem(OATS), mealItem(SALAD), workoutItem(CIRCUIT), workoutItem(WALK)];

const logs = (fields: Partial<DayLogs> = {}): DayLogs => ({ meals: [], workouts: [], ...fields });

/* -------------------------------------------------------------------------- */
/* The day's log                                                              */
/* -------------------------------------------------------------------------- */

describe("dayLog", () => {
  test("names each row from the plan it was logged against", () => {
    // The rows carry ids, because a log records what was eaten rather than what
    // it was called. The names come back from resolution.
    const entries = dayLog(
      ITEMS,
      logs({
        meals: [mealLog({ id: "l1", mealId: "meal-1" })],
        workouts: [workoutLog({ id: "l2", workoutId: "workout-2", loggedAt: at(1) })],
      }),
    );

    expect(entries.map((entry) => entry.name)).toEqual(["Overnight oats", "Daily walk"]);
  });

  test("lists them in the order they were logged", () => {
    const entries = dayLog(
      ITEMS,
      logs({
        meals: [
          mealLog({ id: "l1", mealId: "meal-2", slot: "lunch", loggedAt: at(30) }),
          mealLog({ id: "l2", mealId: "meal-1", loggedAt: at(10) }),
        ],
        workouts: [workoutLog({ id: "l3", loggedAt: at(20) })],
      }),
    );

    // Across both tables, not within each: the day is one sequence.
    expect(entries.map((entry) => entry.id)).toEqual(["l2", "l3", "l1"]);
  });

  test("breaks a tie on the id, so the order is total", () => {
    // `logged_at` is a `timestamptz` with a `defaultNow()`, so two rows written
    // in the same statement share an instant. The same tie-break `latestLog`
    // uses — which is what keeps "undo takes back the last line" true.
    const same = at(15);

    const entries = dayLog(
      ITEMS,
      logs({
        meals: [
          mealLog({ id: "l-b", mealId: "meal-2", slot: "lunch", loggedAt: same }),
          mealLog({ id: "l-c", mealId: "meal-1", loggedAt: same }),
          mealLog({ id: "l-a", mealId: "meal-1", loggedAt: same }),
        ],
      }),
    );

    // Three of them, in an order that is neither sorted nor reversed, so the
    // comparison is exercised in both directions rather than in whichever one
    // the engine's sort happens to try first.
    expect(entries.map((entry) => entry.id)).toEqual(["l-a", "l-b", "l-c"]);
  });

  test("carries the macros of an eaten meal, and of nothing else", () => {
    const entries = dayLog(
      ITEMS,
      logs({
        meals: [
          mealLog({ id: "l1", mealId: "meal-1" }),
          mealLog({ id: "l2", mealId: "meal-2", slot: "lunch", status: "skipped", loggedAt: at(1) }),
        ],
        workouts: [workoutLog({ id: "l3", loggedAt: at(2) })],
      }),
    );

    expect(entries[0]!.macros).toEqual({ kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 });
    // A skip contributes nothing by definition, and a session has nothing to
    // contribute. Absent rather than zeroed, so the totals need no second rule
    // to decide which zeroes are real.
    expect(entries[1]!.macros).toBeUndefined();
    expect(entries[2]!.macros).toBeUndefined();
  });

  test("keeps the status each row was written with", () => {
    const entries = dayLog(
      ITEMS,
      logs({
        meals: [mealLog({ id: "l1", status: "skipped" })],
        workouts: [workoutLog({ id: "l2", status: "partial", loggedAt: at(1) })],
      }),
    );

    // 'partial' has no verb on P1, but the schema holds it and an import or a
    // later screen can write one. It must not fall through to something wrong.
    expect(entries.map((entry) => entry.status)).toEqual(["skipped", "partial"]);
  });

  test("still lists a row naming something not on today's plan", () => {
    // Unreachable until P2's swap exists, and written down now rather than
    // discovered later as a summary that disagrees with its own undo control:
    // the entry count is what offers undo, so a dropped row would offer one
    // fewer than the database holds.
    const entries = dayLog(
      ITEMS,
      logs({
        meals: [mealLog({ id: "l1", mealId: "meal-gone", slot: "dinner" })],
        workouts: [workoutLog({ id: "l2", workoutId: "workout-gone", loggedAt: at(1) })],
      }),
    );

    expect(entries.map((entry) => entry.name)).toEqual(["Dinner", "Training"]);
    // The figures went with the row that is missing, so it counts for nothing.
    expect(entries[0]!.macros).toBeUndefined();
  });

  test("is empty on a day nothing was logged on", () => {
    expect(dayLog(ITEMS, logs())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* What the day came to                                                       */
/* -------------------------------------------------------------------------- */

describe("entryTotals", () => {
  test("adds up what was eaten and ignores the rest", () => {
    const totals = entryTotals(
      dayLog(
        ITEMS,
        logs({
          meals: [
            mealLog({ id: "l1", mealId: "meal-1" }),
            mealLog({ id: "l2", mealId: "meal-2", slot: "lunch", loggedAt: at(1) }),
            // Skipped, and therefore not eaten. A planned total would count it,
            // which is the whole reason the summary reads the logs.
            mealLog({ id: "l3", mealId: "meal-1", status: "skipped", loggedAt: at(2) }),
          ],
          workouts: [workoutLog({ id: "l4", loggedAt: at(3) })],
        }),
      ),
    );

    expect(totals).toEqual({ kcal: 1098, proteinG: 86.7, fatG: 26.4, carbG: 122 });
  });

  test("is four zeroes on a day with nothing logged, not NaN", () => {
    // The state reached by advancing past the last item by hand. `NaN` here
    // would propagate silently through a delta and surface far from its cause.
    expect(entryTotals([])).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* The optimistic entry                                                       */
/* -------------------------------------------------------------------------- */

describe("pendingEntry", () => {
  test("logs a meal as eaten, with its macros", () => {
    const entry = pendingEntry(scheduled(mealItem(OATS), "meal:e1"), "log", DATE);

    expect(entry).toEqual({
      // Prefixed, so it cannot collide with a uuid from the database when it is
      // appended to the server's own list.
      id: "pending:meal:e1",
      name: "Overnight oats",
      status: "eaten",
      macros: { kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 },
    });
  });

  test("skips a meal without counting it", () => {
    const entry = pendingEntry(scheduled(mealItem(OATS), "meal:e1"), "skip", DATE);

    expect(entry.status).toBe("skipped");
    expect(entry.macros).toBeUndefined();
  });

  test("takes the schema's word for a session", () => {
    // Two verbs, four statuses, and the mapping lives in `logIntent` — so the
    // word this screen prints and the value the row is written with are one
    // decision rather than two that agree today.
    const item = scheduled(workoutItem(CIRCUIT), "workout:e4");

    expect(pendingEntry(item, "log", DATE).status).toBe("done");
    expect(pendingEntry(item, "skip", DATE).status).toBe("skipped");
    expect(pendingEntry(item, "log", DATE).macros).toBeUndefined();
  });
});
