import { describe, expect, test } from "vitest";

import {
  dayLog,
  entryTotals,
  type LoggedEntry,
  type LogStatus,
  notLogged,
  pendingEntry,
  theDay,
  undoRetreats,
  undoTarget,
} from "@/lib/day-summary";
import type { Meal, MealLog, Workout } from "@/lib/db/schema";
import type { DayLogs, MarkedWorkoutLog } from "@/lib/log-intent";
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
  // The figures the meal had when it was logged — its current ones, unless a
  // case overrides them to stand for a recipe edited since (FUEL-146).
  const { kcal, proteinG, fatG, carbG } = [OATS, SALAD].find(
    (meal) => meal.id === (fields.mealId ?? "meal-1"),
  ) ?? { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 };

  return {
    kcal,
    proteinG,
    fatG,
    carbG,
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

function workoutLog(fields: Partial<MarkedWorkoutLog> & { id: string }): MarkedWorkoutLog {
  return {
    userId: USER,
    date: DATE,
    workoutId: "workout-1",
    status: "done",
    note: null,
    durationMin: null,
    distanceM: null,
    steps: null,
    stepsSource: null,
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

  test("marks the walk's line, and only the walk's — FUEL-29", () => {
    // What the flag decides is whether `/`'s Undo counts the line: that control
    // is a stack over what the action bar wrote, and the walk is logged from its
    // own row. See `lib/walk.ts`.
    const entries = dayLog(
      ITEMS,
      logs({
        meals: [mealLog({ id: "l1", mealId: "meal-1" })],
        workouts: [
          workoutLog({ id: "l2", workoutId: "workout-1", loggedAt: at(1) }),
          workoutLog({ id: "l3", workoutId: "workout-2", loggedAt: at(2) }),
        ],
      }),
      new Set(["workout-2"]),
    );

    expect(entries.map((entry) => [entry.name, entry.walk])).toEqual([
      ["Overnight oats", undefined],
      ["Circuit A", undefined],
      ["Daily walk", true],
    ]);
  });

  test("marks nothing when the caller names no walk", () => {
    // The set is the CALLER's answer to "which of these has a row of its own",
    // not a property of the workout: a walk on the TIMELINE is logged from the
    // action bar and has to stay in the bar's undo stack. `lib/walk.ts` argues
    // why both callers pass `view.anytime` rather than the whole day.
    const entries = dayLog(
      ITEMS,
      logs({ workouts: [workoutLog({ id: "l1", workoutId: "workout-2" })] }),
    );

    expect(entries.map((entry) => [entry.name, entry.walk])).toEqual([
      ["Daily walk", undefined],
    ]);
  });

  test("still names a log the plan no longer holds, unmarked", () => {
    // It has no row on the screen to revert it from, so the bar is the only way
    // back to it — which means the bar has to offer it.
    const entries = dayLog(
      [mealItem(OATS)],
      logs({ workouts: [workoutLog({ id: "l1", workoutId: "workout-2" })] }),
      new Set(["workout-2"]),
    );

    // The name falls back because resolution cannot name it; the flag is the
    // caller's and is honoured regardless.
    expect(entries.map((entry) => [entry.name, entry.walk])).toEqual([
      ["Training", true],
    ]);
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
        meals: [
          mealLog({
            id: "l1",
            mealId: "meal-gone",
            slot: "dinner",
            kcal: 540,
            proteinG: 41,
            fatG: 17,
            carbG: 52,
          }),
        ],
        workouts: [workoutLog({ id: "l2", workoutId: "workout-gone", loggedAt: at(1) })],
      }),
    );

    expect(entries.map((entry) => entry.name)).toEqual(["Dinner", "Training"]);
    // Only the NAME went with the missing plan item. Since FUEL-146 the
    // figures are on the log row, so the meal still counts for what it was.
    expect(entries[0]!.macros).toEqual({ kcal: 540, proteinG: 41, fatG: 17, carbG: 52 });
  });

  test("is empty on a day nothing was logged on", () => {
    expect(dayLog(ITEMS, logs())).toEqual([]);
  });

  test("counts what the log recorded, not the recipe as edited since — FUEL-146", () => {
    // ITEMS' oats read 486 kcal now. The log was written when they were 400,
    // and an edit to the recipe after breakfast must not rewrite breakfast.
    const asLogged = { kcal: 400, proteinG: 30, fatG: 10, carbG: 50 };
    const entries = dayLog(
      ITEMS,
      logs({ meals: [mealLog({ id: "l1", mealId: "meal-1", ...asLogged })] }),
    );

    expect(entries[0]!.name).toBe("Overnight oats");
    expect(entries[0]!.macros).toEqual(asLogged);
    expect(entryTotals(entries)).toMatchObject(asLogged);
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
      // The optimistic entry carries the kind too, or `theDay` would fail to
      // match the row the tap just created against the item it came from.
      kind: "meal",
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

describe("theDay", () => {
  /*
   * The desktop aside's list — FUEL-86. The join is by name and the placement
   * is by position, and `day-summary.ts` carries the argument for both.
   */

  const timed = (item: NowItem, key: string, time: string): ScheduledItem => ({
    ...item,
    key,
    at: time,
    minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
  });

  const TIMELINE = [
    timed(mealItem(OATS), "m1", "07:30"),
    timed(workoutItem(CIRCUIT), "w1", "12:00"),
    timed(mealItem(SALAD), "m2", "13:00"),
  ];

  const entry = (
    name: string,
    status: LogStatus,
    kind: LoggedEntry["kind"] = "meal",
    walk = false,
  ): LoggedEntry => ({
    id: `log-${name}-${status}`,
    name,
    kind,
    status,
    ...(walk ? { walk: true as const } : {}),
  });

  test("places every item by the cursor, and only the cursor", () => {
    // The card and the list cannot disagree about where the day has got to,
    // because both read the same position.
    expect(theDay(TIMELINE, 1, []).map((row) => row.place)).toEqual([
      "past",
      "now",
      "upcoming",
    ]);
  });

  test("takes the status word from the log, for past items only", () => {
    const rows = theDay(TIMELINE, 2, [
      entry("Overnight oats", "eaten"),
      entry("Circuit A", "skipped", "workout"),
      // Ahead of the cursor, and so not this list's to report. A day whose
      // lunch was logged early still shows lunch as the item the reader is on.
      entry("Chicken salad", "eaten"),
    ]);

    expect(rows.map((row) => row.status)).toEqual(["eaten", "skipped", undefined]);
    expect(rows[2]!.place).toBe("now");
  });

  test("keeps the time on a past item nothing logged", () => {
    // The manual advance walks past an item without writing a row — "I'm done"
    // with no tap on anything. § Tone of Voice would rather say nothing than
    // name it something it was not.
    const [row] = theDay(TIMELINE, 3, [entry("Circuit A", "done", "workout")]);

    expect(row!.status).toBeUndefined();
    expect(row!.at).toBe("07:30");
  });

  test("gives two identically named items one log row each", () => {
    // Names are not unique — a day with the same meal in two slots is ordinary
    // — so the join is a queue rather than a lookup. Taking the first for both
    // would report the skip against the slot that was eaten.
    const twice = [
      timed(mealItem(OATS), "m1", "07:30"),
      timed(mealItem(OATS), "m2", "16:00"),
    ];

    expect(
      theDay(twice, 2, [
        entry("Overnight oats", "eaten"),
        entry("Overnight oats", "skipped"),
      ]).map((row) => row.status),
    ).toEqual(["eaten", "skipped"]);
  });

  test("never lets a workout's status answer for a meal that shares its name", () => {
    // `meals` and `workouts` are separate namespaces with nothing constraining
    // one against the other, so a name is unique only WITHIN a table. Keyed by
    // name alone the two share a queue, and the meal is handed the session's
    // "Done" while the session is left with nothing.
    //
    // Unreachable today — the library is seeded and no seeded meal is named
    // after a workout — which is why it is a test rather than a bug report: the
    // thing that makes it safe is a coincidence in the data, and this is what
    // makes it a property of the code. Raised by the FUEL-86 precommit review.
    //
    // The meal is advanced past WITHOUT a log, which is what separates the two
    // keyings: the day holds one log row and two items that answer to its name,
    // so a name-only queue gives it to the first item rather than to the one it
    // belongs to. An earlier version of this test logged both in timeline order
    // and passed against the very bug it was written for — the queue handed out
    // the right answers by accident.
    const clash = meal({ id: "meal-9", name: "Circuit A", slotType: "lunch" });

    const rows = theDay(
      [timed(mealItem(clash), "m9", "13:00"), timed(workoutItem(CIRCUIT), "w9", "18:00")],
      2,
      [entry("Circuit A", "done", "workout")],
    );

    expect(rows.map((row) => row.status)).toEqual([undefined, "done"]);
  });

  test("never lets the walk answer for a scheduled item", () => {
    // The walk is in `anytime` rather than on the timeline, so its log row has
    // nothing here to match. Left in, it could be consumed by an item that
    // happened to share its name.
    const named = [timed(workoutItem(WALK), "w9", "18:00")];

    expect(theDay(named, 1, [entry("Daily walk", "done", "workout", true)])[0]!.status).toBeUndefined();
  });

  test("carries the item's own key, so a row is stable across renders", () => {
    expect(theDay(TIMELINE, 0, []).map((row) => row.key)).toEqual(["m1", "w1", "m2"]);
  });

  test("an empty timeline is an empty list, not a heading with nothing under it", () => {
    expect(theDay([], 0, [entry("Overnight oats", "eaten")])).toEqual([]);
  });
});

describe("notLogged — FUEL-131", () => {
  const timed = (item: NowItem, key: string, time: string): ScheduledItem => ({
    ...item,
    key,
    at: time,
    minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
  });

  const TIMELINE = [
    timed(workoutItem(CIRCUIT), "w1", "06:30"),
    timed(mealItem(OATS), "m1", "07:10"),
    timed(mealItem(SALAD), "m2", "13:00"),
  ];

  const entry = (name: string, status: LogStatus, kind: LoggedEntry["kind"] = "meal"): LoggedEntry => ({
    id: `log-${name}`,
    name,
    kind,
    status,
  });

  const open = (position: number, entries: LoggedEntry[] = []) =>
    notLogged(TIMELINE, theDay(TIMELINE, position, entries)).map((item) => item.key);

  test("is everything behind the card with nothing recorded", () => {
    expect(open(2)).toEqual(["w1", "m1"]);
  });

  test("leaves out what was logged, and what was skipped", () => {
    expect(open(2, [entry("Circuit A", "done", "workout")])).toEqual(["m1"]);
    expect(open(2, [entry("Overnight oats", "skipped")])).toEqual(["w1"]);
  });

  test("never offers the card, or anything ahead of it", () => {
    expect(open(0)).toEqual([]);
    expect(open(1)).toEqual(["w1"]);
  });

  test("offers the whole unanswered day once it is complete", () => {
    expect(open(3, [entry("Overnight oats", "eaten")])).toEqual(["w1", "m2"]);
  });

  test("returns the items themselves, for the key a tap sends", () => {
    expect(notLogged(TIMELINE, theDay(TIMELINE, 1, []))).toEqual([TIMELINE[0]]);
  });
});

describe("undoRetreats — FUEL-131", () => {
  const timed = (item: NowItem, key: string, time: string): ScheduledItem => ({
    ...item,
    key,
    at: time,
    minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
  });

  const TIMELINE = [
    timed(workoutItem(CIRCUIT), "w1", "06:30"),
    timed(mealItem(OATS), "m1", "07:10"),
    timed(mealItem(SALAD), "m2", "13:00"),
  ];

  const entry = (name: string, kind: LoggedEntry["kind"] = "meal", walk = false): LoggedEntry => ({
    id: `log-${name}`,
    name,
    kind,
    status: "eaten",
    ...(walk ? { walk: true as const } : {}),
  });

  const SIX_FORTY = 6 * 60 + 40;
  const SEVEN_FIFTY_THREE = 7 * 60 + 53;

  test("steps back over the card's own log, when the bar put the card there", () => {
    // 06:40, oats logged early from the bar: the card is on the salad, ahead of
    // the clock, and the newest row is the oats.
    expect(undoRetreats(TIMELINE, 2, [entry("Overnight oats")], SIX_FORTY)).toBe(true);
  });

  test("stays put for a row logged against something further back", () => {
    expect(
      undoRetreats(TIMELINE, 2, [entry("Overnight oats"), entry("Circuit A", "workout")], SIX_FORTY),
    ).toBe(false);
  });

  test("never puts the card behind the clock, whatever the name says", () => {
    // 07:53: the coffee-shaped case. The row is the item behind the card, but
    // the clock put the card there, so there is nowhere to step back to.
    expect(undoRetreats(TIMELINE, 1, [entry("Circuit A", "workout")], SEVEN_FIFTY_THREE)).toBe(false);
  });

  test("matches by kind as well as name", () => {
    expect(undoRetreats(TIMELINE, 2, [entry("Overnight oats", "workout")], SIX_FORTY)).toBe(false);
  });

  test("passes over the walk, which is not on the stack", () => {
    expect(
      undoRetreats(TIMELINE, 2, [entry("Overnight oats"), entry("Daily walk", "workout", true)], SIX_FORTY),
    ).toBe(true);
  });

  test("has nothing to step back over at the start of the day, or with no log", () => {
    expect(undoRetreats(TIMELINE, 0, [entry("Overnight oats")], 0)).toBe(false);
    expect(undoRetreats(TIMELINE, 2, [], SIX_FORTY)).toBe(false);
  });
});

describe("undoTarget — FUEL-142", () => {
  const line = (id: string, walk = false): LoggedEntry => ({
    id,
    name: id,
    kind: walk ? "workout" : "meal",
    status: walk ? "done" : "eaten",
    ...(walk ? { walk: true as const } : {}),
  });

  test("is the last line", () => {
    expect(undoTarget([line("a"), line("b")])?.id).toBe("b");
  });

  test("passes over a walk logged after it, as undoLastLog does", () => {
    expect(undoTarget([line("a"), line("walk", true)])?.id).toBe("a");
  });

  test("is nothing when the walk is all there is", () => {
    expect(undoTarget([line("walk", true)])).toBeUndefined();
    expect(undoTarget([])).toBeUndefined();
  });
});
