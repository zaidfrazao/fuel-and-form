import { describe, expect, it } from "vitest";

import type { Meal, MealLog, Workout, WorkoutLog } from "./db/schema";
import { alreadyLogged, type DayLogs, latestLog, logIntent } from "./log-intent";
import type { NowItem } from "./resolve-now";

/**
 * What a tap means, as a row.
 *
 * Every failure this file can produce is a plausible-looking wrong answer
 * rather than a crash: a skip filed as 'eaten', a duplicate that doubles a
 * day's protein, an undo that takes back the wrong log. None of them throw and
 * none of them are visible on the screen that produced them, which is what puts
 * this module behind the coverage gate.
 */

const USER = "user-owner";
const MON = "2026-03-09";

function meal(fields: Partial<Meal> = {}): Meal {
  return {
    id: "meal-1",
    userId: USER,
    name: "Overnight oats",
    slotType: "breakfast",
    kcal: 420,
    proteinG: 32.5,
    fatG: 12,
    carbG: 48,
    method: null,
    notes: null,
    isArchived: false,
    ...fields,
  };
}

function workout(fields: Partial<Workout> = {}): Workout {
  return {
    id: "workout-1",
    userId: USER,
    name: "Circuit A",
    type: "circuit",
    description: null,
    rotationGroup: null,
    rotationIndex: null,
    ...fields,
  };
}

const MEAL_ITEM: NowItem = {
  kind: "meal",
  meal: { slot: "lunch", meal: meal({ id: "meal-2" }), source: "template", entryId: "e2" },
};

const WORKOUT_ITEM: NowItem = {
  kind: "workout",
  workout: { workout: workout(), source: "rotation", entryId: "e3" },
};

function mealLog(fields: Partial<MealLog> = {}): MealLog {
  return {
    id: "log-1",
    userId: USER,
    date: MON,
    slot: "lunch",
    mealId: "meal-2",
    status: "eaten",
    note: null,
    loggedAt: new Date("2026-03-09T12:00:00Z"),
    ...fields,
  };
}

function workoutLog(fields: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    id: "wlog-1",
    userId: USER,
    date: MON,
    workoutId: "workout-1",
    status: "done",
    note: null,
    durationMin: null,
    loggedAt: new Date("2026-03-09T17:00:00Z"),
    ...fields,
  };
}

const NOTHING: DayLogs = { meals: [], workouts: [] };

describe("logIntent", () => {
  it("takes a meal's slot and id from resolution, never from a request", () => {
    // The whole trust argument in one assertion: the row is built out of the
    // item the SERVER resolved, so there is no field a caller could supply.
    expect(logIntent(MEAL_ITEM, "log", MON)).toEqual({
      kind: "meal",
      date: MON,
      slot: "lunch",
      mealId: "meal-2",
      status: "eaten",
    });
  });

  it("records a skipped meal as skipped, not as absent", () => {
    // P1: "a skip advances without logging completion, AND RECORDS THE SKIP".
    // Writing nothing would make a skip indistinguishable from a day the app
    // was never opened — which is the distinction the weekly export is for.
    expect(logIntent(MEAL_ITEM, "skip", MON)).toMatchObject({ status: "skipped" });
  });

  it("maps a session's log to 'done', which is the workout enum's word for it", () => {
    expect(logIntent(WORKOUT_ITEM, "log", MON)).toEqual({
      kind: "workout",
      date: MON,
      workoutId: "workout-1",
      status: "done",
    });
  });

  it("records a skipped session as skipped", () => {
    expect(logIntent(WORKOUT_ITEM, "skip", MON)).toMatchObject({
      kind: "workout",
      status: "skipped",
    });
  });

  it("files the row under the date it is given, not under a clock of its own", () => {
    // The date comes from the resolution the screen was showing, so a request
    // in flight across midnight lands on the day the user was looking at.
    expect(logIntent(MEAL_ITEM, "log", "2026-03-10")).toMatchObject({ date: "2026-03-10" });
  });
});

describe("alreadyLogged", () => {
  const intent = logIntent(MEAL_ITEM, "log", MON);

  it("is false when nothing has been logged", () => {
    expect(alreadyLogged(NOTHING, intent)).toBe(false);
  });

  it("is true for the same meal, slot, date and status", () => {
    // The double-tap. `meal_logs` has no unique constraint to stop it, so this
    // is what stands between a second tap and a doubled day total.
    expect(alreadyLogged({ ...NOTHING, meals: [mealLog()] }, intent)).toBe(true);
  });

  it("is false for the same meal in a different slot", () => {
    expect(alreadyLogged({ ...NOTHING, meals: [mealLog({ slot: "dinner" })] }, intent)).toBe(
      false,
    );
  });

  it("is false for the same slot holding a different meal", () => {
    // A slot may legitimately hold more than one meal, which is exactly why
    // there is no unique index to lean on here.
    expect(alreadyLogged({ ...NOTHING, meals: [mealLog({ mealId: "meal-9" })] }, intent)).toBe(
      false,
    );
  });

  it("is false on another date", () => {
    expect(alreadyLogged({ ...NOTHING, meals: [mealLog({ date: "2026-03-10" })] }, intent)).toBe(
      false,
    );
  });

  it("does not treat a skip as a log of the same meal", () => {
    // Changing your mind — skipped, then eaten — is two different rows, and
    // collapsing them would silently discard whichever came second.
    expect(alreadyLogged({ ...NOTHING, meals: [mealLog({ status: "skipped" })] }, intent)).toBe(
      false,
    );
  });

  it("matches a session on date, workout and status", () => {
    const session = logIntent(WORKOUT_ITEM, "log", MON);

    expect(alreadyLogged({ ...NOTHING, workouts: [workoutLog()] }, session)).toBe(true);
    expect(
      alreadyLogged({ ...NOTHING, workouts: [workoutLog({ status: "partial" })] }, session),
    ).toBe(false);
    expect(
      alreadyLogged({ ...NOTHING, workouts: [workoutLog({ workoutId: "w-9" })] }, session),
    ).toBe(false);
    expect(
      alreadyLogged({ ...NOTHING, workouts: [workoutLog({ date: "2026-03-10" })] }, session),
    ).toBe(false);
  });

  it("does not confuse a meal log with a session log", () => {
    expect(alreadyLogged({ meals: [mealLog()], workouts: [] }, logIntent(WORKOUT_ITEM, "log", MON))).toBe(
      false,
    );
  });
});

describe("latestLog", () => {
  it("is null when there is nothing to take back", () => {
    expect(latestLog(NOTHING)).toBeNull();
  });

  it("finds the most recent meal log", () => {
    const early = mealLog({ id: "a", loggedAt: new Date("2026-03-09T07:00:00Z") });
    const late = mealLog({ id: "b", loggedAt: new Date("2026-03-09T13:00:00Z") });

    expect(latestLog({ meals: [early, late], workouts: [] })).toEqual({
      kind: "meal",
      log: late,
    });
  });

  it("does not prefer the array it looked at first", () => {
    // The two kinds live in separate arrays, and the order they were fetched in
    // must not decide what undo takes back. A session logged after lunch is
    // what a tap on Undo means, whichever query returned first.
    const lunch = mealLog({ loggedAt: new Date("2026-03-09T13:00:00Z") });
    const session = workoutLog({ loggedAt: new Date("2026-03-09T17:30:00Z") });

    expect(latestLog({ meals: [lunch], workouts: [session] })).toEqual({
      kind: "workout",
      log: session,
    });
  });

  it("prefers an earlier array only when the instant is genuinely later", () => {
    const lunch = mealLog({ loggedAt: new Date("2026-03-09T18:00:00Z") });
    const session = workoutLog({ loggedAt: new Date("2026-03-09T17:30:00Z") });

    expect(latestLog({ meals: [lunch], workouts: [session] })).toEqual({
      kind: "meal",
      log: lunch,
    });
  });

  it("breaks a tie by id, so undoing twice removes two different rows", () => {
    // `logged_at` defaults to `now()`, so rows written in one statement share
    // an instant. Without a tie-break, undo could return the same row twice and
    // the second delete would remove nothing while the view stepped back anyway.
    const same = new Date("2026-03-09T13:00:00Z");
    const a = mealLog({ id: "aaa", loggedAt: same });
    const b = mealLog({ id: "bbb", loggedAt: same });

    expect(latestLog({ meals: [a, b], workouts: [] })).toEqual({ kind: "meal", log: b });
    expect(latestLog({ meals: [b, a], workouts: [] })).toEqual({ kind: "meal", log: b });
  });
});
