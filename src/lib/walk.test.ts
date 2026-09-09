import { describe, expect, test } from "vitest";

import type { Workout, WorkoutLog } from "@/lib/db/schema";
import type { DayLogs } from "@/lib/log-intent";
import type { NowItem } from "@/lib/resolve-now";
import { isWalk, walkEntries, walkWorkoutIds, withoutWalks, WALK_PRESETS } from "@/lib/walk";

/**
 * The daily walk, as the layers that are not the walk's own see it — FUEL-29.
 *
 * Three callers depend on this file agreeing with itself: `/` renders the row
 * from `isWalk`, `actions/log.ts` narrows its undo stack with `withoutWalks`,
 * and `day-summary.ts` marks the summary's line with `walkWorkoutIds`. If they
 * disagree, the failure is silent in the way this file exists to prevent — an
 * Undo control offered for a row it cannot take back, or a card stepped
 * backwards past an item that is still logged.
 *
 * The figures are invented — Testing Strategy § 1.5, and the repository is
 * public.
 */

const USER = "user-owner";
const DATE = "2026-03-09";

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

const workoutItem = (w: Workout): NowItem => ({
  kind: "workout",
  workout: { workout: w, source: "rotation", entryId: `entry-${w.id}` },
});

const mealItem = (): NowItem => ({
  kind: "meal",
  meal: {
    slot: "breakfast",
    meal: {
      id: "meal-1",
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
    },
    source: "template",
    entryId: "entry-meal-1",
  },
});

function workoutLog(fields: Partial<WorkoutLog> & { id: string }): WorkoutLog {
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
    loggedAt: new Date(Date.UTC(2026, 2, 9, 8, 0)),
    ...fields,
  };
}

const CIRCUIT = workout({ id: "workout-1", name: "Circuit A" });
const WALK = workout({ id: "workout-2", name: "Daily Walk", type: "walk" });
const SECOND_WALK = workout({ id: "workout-3", name: "Evening walk", type: "walk" });

const logs = (fields: Partial<DayLogs> = {}): DayLogs => ({
  meals: [],
  workouts: [],
  ...fields,
});

describe("isWalk", () => {
  test("is the walk, and not the session it shares a day with", () => {
    expect(isWalk(workoutItem(WALK))).toBe(true);
    expect(isWalk(workoutItem(CIRCUIT))).toBe(false);
  });

  test("is not a meal, whatever the meal is called", () => {
    expect(isWalk(mealItem())).toBe(false);
  });

  test("reads the type, not the name", () => {
    // `workouts.type` is the discriminator schema.ts keeps as text so a gym
    // restart adds rows rather than a migration. A row NAMED "walk" that is
    // typed as a circuit is a circuit.
    expect(isWalk(workoutItem(workout({ id: "w9", name: "Walk", type: "circuit" })))).toBe(
      false,
    );
    // And an unrecognised type is a session, which is what keeps the open
    // vocabulary safe here — 'strength' is not a walk by default.
    expect(
      isWalk(workoutItem(workout({ id: "w8", name: "Bench", type: "strength" }))),
    ).toBe(false);
  });
});

describe("walkWorkoutIds", () => {
  test("collects every walk on the day and nothing else", () => {
    const ids = walkWorkoutIds([
      mealItem(),
      workoutItem(CIRCUIT),
      workoutItem(WALK),
      workoutItem(SECOND_WALK),
    ]);

    expect([...ids].sort()).toEqual(["workout-2", "workout-3"]);
  });

  test("is empty for a day with no walk on it", () => {
    expect(walkWorkoutIds([workoutItem(CIRCUIT)]).size).toBe(0);
  });
});

describe("withoutWalks", () => {
  test("takes the walk's rows out of the day's logs", () => {
    const day = logs({
      workouts: [
        workoutLog({ id: "l1", workoutId: "workout-1" }),
        workoutLog({ id: "l2", workoutId: "workout-2" }),
      ],
    });

    const stack = withoutWalks(day, walkWorkoutIds([workoutItem(WALK)]));

    expect(stack.workouts.map((log) => log.id)).toEqual(["l1"]);
  });

  test("leaves meals alone", () => {
    const day = logs({
      meals: [
        {
          id: "m1",
          userId: USER,
          date: DATE,
          slot: "breakfast",
          mealId: "meal-1",
          status: "eaten",
          note: null,
          loggedAt: new Date(Date.UTC(2026, 2, 9, 7, 0)),
        },
      ],
    });

    expect(withoutWalks(day, new Set(["workout-2"])).meals).toEqual(day.meals);
  });

  test("keeps a walk row the day no longer resolves", () => {
    // The set comes from the day's own resolution, so a walk taken off the
    // template is not in it — and its row stays in the stack, because the bar
    // is then the only way back to it.
    const day = logs({ workouts: [workoutLog({ id: "l1", workoutId: "workout-2" })] });

    expect(withoutWalks(day, walkWorkoutIds([])).workouts).toHaveLength(1);
  });
});

describe("walkEntries", () => {
  test("is empty when the walk has not been logged", () => {
    expect(walkEntries([workoutItem(WALK)], []).size).toBe(0);
  });

  test("is empty when the plan has no walk on it", () => {
    expect(
      walkEntries([workoutItem(CIRCUIT)], [workoutLog({ id: "l1", workoutId: "workout-2" })])
        .size,
    ).toBe(0);
  });

  test("carries the duration under the entry id, and nothing else about the row", () => {
    const entries = walkEntries(
      [workoutItem(WALK)],
      [workoutLog({ id: "l1", workoutId: "workout-2", durationMin: 45 })],
    );

    // Keyed by the ENTRY, which is what a row holds and what a write names.
    // Not the id, not the instant, not the note — none of them are drawn.
    expect(entries.get("entry-workout-2")).toEqual({
      durationMin: 45,
      distanceM: null,
      hasRoute: false,
    });
  });

  test("distinguishes a logged walk with no duration from an unlogged one", () => {
    // The two are one tap apart and look nothing alike on the row: one says
    // Done and offers the presets, the other says Log walk. A present key
    // holding `{ durationMin: null }` is the first; an absent key is the second.
    const entries = walkEntries(
      [workoutItem(WALK)],
      [workoutLog({ id: "l1", workoutId: "workout-2" })],
    );

    expect(entries.has("entry-workout-2")).toBe(true);
    expect(entries.get("entry-workout-2")).toEqual({
      durationMin: null,
      distanceM: null,
      hasRoute: false,
    });
  });

  test("carries the distance and whether there is a trace to open", () => {
    // FUEL-102. Both are the row's, and they are separate answers on purpose:
    // the figure is what the line reads and the flag is what makes it a control.
    const entries = walkEntries(
      [workoutItem(WALK)],
      [workoutLog({ id: "l1", workoutId: "workout-2", durationMin: 25, distanceM: 2040 })],
      new Set(["l1"]),
    );

    expect(entries.get("entry-workout-2")).toEqual({
      durationMin: 25,
      distanceM: 2040,
      hasRoute: true,
    });
  });

  test("a measured distance is not a trace, so the row offers no sheet for one", () => {
    // The case `distanceM` cannot answer, and the reason the flag is carried
    // rather than inferred: a walk shorter than twice the trim measures a
    // distance and stores no trace at all (§ P11, FUEL-100). A row keyed off
    // the figure would open a sheet with nothing in it.
    const entries = walkEntries(
      [workoutItem(WALK)],
      [workoutLog({ id: "l1", workoutId: "workout-2", durationMin: 4, distanceM: 280 })],
      new Set(),
    );

    expect(entries.get("entry-workout-2")).toEqual({
      durationMin: 4,
      distanceM: 280,
      hasRoute: false,
    });
  });

  test("ignores the session's row on a day that has both", () => {
    expect(
      walkEntries(
        [workoutItem(CIRCUIT), workoutItem(WALK)],
        [workoutLog({ id: "l1", workoutId: "workout-1", durationMin: 28 })],
      ).size,
    ).toBe(0);
  });

  test("answers for each walk separately when a day holds two", () => {
    // The reason this is a map and not one figure: a single answer would hand
    // the first walk's minutes to the second row, with nothing on screen to
    // say the second was never logged.
    const entries = walkEntries(
      [workoutItem(WALK), workoutItem(SECOND_WALK)],
      [workoutLog({ id: "l1", workoutId: "workout-2", durationMin: 30 })],
    );

    expect(entries.get("entry-workout-2")).toEqual({
      durationMin: 30,
      distanceM: null,
      hasRoute: false,
    });
    expect(entries.has("entry-workout-3")).toBe(false);
  });
});

describe("WALK_PRESETS", () => {
  test("covers the program's own walk, and stays inside what the action takes", () => {
    // PRD § Persona: "a 30–45 minute walk every day including weekends" — and
    // since FUEL-98 that is the DAY's figure across two walks, so the presets
    // are per walk. 30 is the one that survives from the single-walk list, as
    // the walk that took the whole day's allowance.
    expect(WALK_PRESETS).toContain(30);
    // The two ordinary answers, which is what the control is for. A preset list
    // that started at 30 would offer nothing a twenty-minute walk could pick.
    expect(WALK_PRESETS).toContain(15);
    expect(WALK_PRESETS).toContain(20);
    // A preset the action would refuse is a control that reports a failure the
    // user cannot understand. `MAX_DURATION_MIN` is twelve hours.
    expect(WALK_PRESETS.every((minutes) => minutes > 0 && minutes <= 12 * 60)).toBe(true);
  });

  test("sums to the day's own figure across the two walks", () => {
    // The presets are per walk and there are two walks, so the pair a person
    // most often taps has to land on the persona's day rather than on double
    // it. Two 15s and two 20s bracket "30–45 minutes every day".
    const [shortest] = WALK_PRESETS;

    expect(shortest! * 2).toBe(30);
    expect(WALK_PRESETS[1]! * 2).toBe(40);
  });
});
