import { describe, expect, test } from "vitest";

import type { Workout, WorkoutLog } from "@/lib/db/schema";
import type { DayLogs } from "@/lib/log-intent";
import type { NowItem } from "@/lib/resolve-now";
import { isWalk, walkEntryFor, walkWorkoutIds, withoutWalks, WALK_PRESETS } from "@/lib/walk";

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

describe("walkEntryFor", () => {
  test("is null when the walk has not been logged", () => {
    expect(walkEntryFor([workoutItem(WALK)], [])).toBeNull();
  });

  test("is null when the plan has no walk on it", () => {
    expect(
      walkEntryFor([workoutItem(CIRCUIT)], [workoutLog({ id: "l1", workoutId: "workout-2" })]),
    ).toBeNull();
  });

  test("carries the duration, and nothing else about the row", () => {
    const entry = walkEntryFor(
      [workoutItem(WALK)],
      [workoutLog({ id: "l1", workoutId: "workout-2", durationMin: 45 })],
    );

    // Not the id, not the instant, not the note — none of them are drawn.
    expect(entry).toEqual({ durationMin: 45 });
  });

  test("distinguishes a logged walk with no duration from an unlogged one", () => {
    // The two are one tap apart and look nothing alike on the row: one says
    // Done and offers the presets, the other says Log walk.
    expect(
      walkEntryFor([workoutItem(WALK)], [workoutLog({ id: "l1", workoutId: "workout-2" })]),
    ).toEqual({ durationMin: null });
  });

  test("ignores the session's row on a day that has both", () => {
    expect(
      walkEntryFor(
        [workoutItem(CIRCUIT), workoutItem(WALK)],
        [workoutLog({ id: "l1", workoutId: "workout-1", durationMin: 28 })],
      ),
    ).toBeNull();
  });
});

describe("WALK_PRESETS", () => {
  test("covers the program's own walk, and stays inside what the action takes", () => {
    // PRD § Persona: "a 30–45 minute walk every day including weekends".
    expect(WALK_PRESETS).toContain(30);
    expect(WALK_PRESETS).toContain(45);
    // A preset the action would refuse is a control that reports a failure the
    // user cannot understand. `MAX_DURATION_MIN` is twelve hours.
    expect(WALK_PRESETS.every((minutes) => minutes > 0 && minutes <= 12 * 60)).toBe(true);
  });
});
