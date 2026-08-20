import { describe, expect, it } from "vitest";

import { adherenceWeeks, adherenceWindow, type SessionLog } from "./adherence";
import type { TrainingTemplateEntry, Workout } from "./db/schema";
import type { TrainingPlan } from "./rotation";
import { seedTrainingTemplate } from "./seed/plan";
import { seedWorkouts } from "./seed/workouts";

/**
 * FUEL-27 — the join between what was planned and what was recorded.
 *
 * The rotation arithmetic is rotation.test.ts's and the day's shaping is
 * resolve-training.test.ts's, both at 100%. Nothing here re-derives either. What
 * this file asserts is the third thing: which DOT a date gets, and in particular
 * the three answers the Governing Principle makes non-negotiable — an unlogged
 * session is not a skip, partial is not rounded into a neighbour, and the walk
 * does not speak for the session it shares a day with.
 *
 * ## The fixture is the seed, and the calendar is the other suites'
 *
 * Built from `seedWorkouts` and `seedTrainingTemplate` — the arrays
 * `lib/seed/load.ts` actually inserts — for the reason resolve-training.test.ts
 * gives: a hand-written template would let this suite pass while the program the
 * app seeds drifted away from PRD § P3. Program start is Monday 2026-03-02, as
 * in rotation.test.ts, resolve-plan.test.ts and resolve-training.test.ts, so all
 * four share one calendar.
 *
 * The anchor below is Wednesday 2026-04-08, chosen so the six-week window lands
 * exactly on the program's first Monday: 2026-03-02 through 2026-04-12.
 */

const USER = "user-owner";
const PROGRAM_START = "2026-03-02"; // a Monday
const ANCHOR = "2026-04-08"; // a Wednesday, five weeks and two days in

const CIRCUIT_A = "Bodyweight Circuit A";
const CIRCUIT_B = "Bodyweight Circuit B";
const INTERVALS = "Skipping Intervals + Core";
const WALK = "Daily Walk";

const idFor = (key: string) => `workout-${key}`;

const WORKOUTS: Workout[] = seedWorkouts.map((workout) => ({
  id: idFor(workout.key),
  userId: USER,
  name: workout.name,
  type: workout.type,
  description: workout.description ?? null,
  rotationGroup: workout.rotationGroup ?? null,
  rotationIndex: workout.rotationIndex ?? null,
}));

const TEMPLATE: TrainingTemplateEntry[] = seedTrainingTemplate.map((entry, index) => ({
  id: `entry-${index}`,
  userId: USER,
  dayOfWeek: entry.dayOfWeek,
  workoutId: entry.workoutKey ? idFor(entry.workoutKey) : null,
  rotationGroup: entry.rotationGroup ?? null,
  sortOrder: entry.sortOrder ?? 0,
}));

const PLAN: TrainingPlan = {
  programStartDate: PROGRAM_START,
  template: TEMPLATE,
  workouts: WORKOUTS,
};

/** The workout ids the seed's names resolve to, for building log rows. */
const CIRCUIT_A_ID = idFor("bodyweight-circuit-a");
const CIRCUIT_B_ID = idFor("bodyweight-circuit-b");
const WALK_ID = idFor("daily-walk");

/** Every day in the window, flattened — the grid's own reading order. */
const daysOf = (logs: readonly SessionLog[] = [], anchor = ANCHOR) =>
  adherenceWeeks(PLAN, logs, anchor).flat();

const dayOn = (date: string, logs: readonly SessionLog[] = []) => {
  const day = daysOf(logs).find((entry) => entry.date === date);

  if (!day) throw new RangeError(`${date} is not in the window`);

  return day;
};

describe("the window", () => {
  it("runs from a Monday six weeks back to the anchor week's Sunday", () => {
    expect(adherenceWindow(ANCHOR)).toEqual({ from: "2026-03-02", to: "2026-04-12" });
  });

  it("puts the anchor in the LAST row rather than at the end of the window", () => {
    // The mock's own final row is three days followed by four that have not
    // happened. Ending the window on the anchor instead would push today into
    // the corner of the grid and lose the rest of its week.
    const days = daysOf();

    expect(days).toHaveLength(42);
    expect(days.at(0)?.date).toBe("2026-03-02");
    expect(days.at(-1)?.date).toBe("2026-04-12");
    expect(days.findIndex((day) => day.date === ANCHOR)).toBe(37); // row six, Wednesday
  });

  it("keeps an anchor that is itself a Sunday inside its own week", () => {
    // The one date `startOfWeek` steps back six days for rather than none.
    // Getting it wrong would show the week AFTER the one being viewed.
    expect(adherenceWindow("2026-04-12")).toEqual({ from: "2026-03-02", to: "2026-04-12" });
  });

  it("takes a different number of weeks, and the shaping agrees with it", () => {
    expect(adherenceWindow(ANCHOR, 2)).toEqual({ from: "2026-03-30", to: "2026-04-12" });

    const weeks = adherenceWeeks(PLAN, [], ANCHOR, 2);

    expect(weeks).toHaveLength(2);
    expect(weeks.flat().at(0)?.date).toBe("2026-03-30");
  });

  it("gives every week exactly seven days, gaps included", () => {
    // The grid places each day by its own date and tolerates a sparse week, but
    // a day that resolves to nothing is still data the adjacent table should
    // state — so the shaping emits it rather than omitting it.
    expect(adherenceWeeks(PLAN, [], ANCHOR).map((week) => week.length)).toEqual([
      7, 7, 7, 7, 7, 7,
    ]);
  });
});

describe("what a day says", () => {
  it("reports a recorded session with the status that was recorded", () => {
    const logs: SessionLog[] = [
      { date: "2026-03-02", workoutId: CIRCUIT_A_ID, status: "done" },
      { date: "2026-03-04", workoutId: CIRCUIT_B_ID, status: "partial" },
      { date: "2026-03-06", workoutId: CIRCUIT_A_ID, status: "skipped" },
    ];

    expect(dayOn("2026-03-02", logs).status).toBe("done");
    expect(dayOn("2026-03-04", logs).status).toBe("partial");
    expect(dayOn("2026-03-06", logs).status).toBe("skipped");
  });

  it("leaves an unlogged session unrecorded rather than calling it skipped", () => {
    // The Governing Principle, made testable. A skip is a thing someone did and
    // recorded; inferring one from an empty table would have the graphic
    // accusing the user of a decision they never made.
    const monday = dayOn("2026-03-02");

    expect(monday.status).toBe("none");
    expect(monday.status).not.toBe("skipped");
    // And it still names the session, so the data table cannot claim there was
    // no session on a day that had one.
    expect(monday.label).toBe(CIRCUIT_A);
  });

  it("treats a future date exactly as it treats an unlogged past one", () => {
    // Two days after the anchor, inside the last row. Nothing has happened yet
    // and nothing is claimed — the same small dot, for the same reason.
    expect(dayOn("2026-04-10").status).toBe("none");
  });

  it("gives a weekend the walk, so it is a small dot rather than an empty one", () => {
    const saturday = dayOn("2026-03-07");

    expect(saturday.status).toBe("walk");
    expect(saturday.label).toBe(WALK);
  });

  it("draws nothing for a date before the program started", () => {
    // The window reaches back past `program_start_date` as soon as the anchor is
    // in the first six weeks. `resolveTraining` answers with no sessions, which
    // is not an error and not a gap.
    const early = adherenceWeeks(PLAN, [], PROGRAM_START)
      .flat()
      .find((day) => day.date === "2026-02-27");

    expect(early).toEqual({ date: "2026-02-27", status: "none" });
    expect(early?.label).toBeUndefined();
  });
});

describe("the session is what the day is about", () => {
  it("does not let the walk answer for the session it shares a day with", () => {
    // Every weekday carries both. A grid keyed on the date alone would show a
    // completed dot for a session that was never done, on the strength of a walk.
    const logs: SessionLog[] = [{ date: "2026-03-02", workoutId: WALK_ID, status: "done" }];

    const monday = dayOn("2026-03-02", logs);

    expect(monday.status).toBe("none");
    expect(monday.label).toBe(CIRCUIT_A);
  });

  it("matches a log to the workout the rotation actually landed on", () => {
    // The reason the key is (date, workout) and not (date, template entry).
    // Monday is Circuit A in week one and Circuit B in week two, from the same
    // template row — so a log naming A cannot colour the Monday that ran B.
    const logs: SessionLog[] = [{ date: "2026-03-09", workoutId: CIRCUIT_A_ID, status: "done" }];

    expect(dayOn("2026-03-09", logs).label).toBe(CIRCUIT_B);
    expect(dayOn("2026-03-09", logs).status).toBe("none");

    const correct: SessionLog[] = [
      { date: "2026-03-09", workoutId: CIRCUIT_B_ID, status: "done" },
    ];

    expect(dayOn("2026-03-09", correct).status).toBe("done");
  });

  it("labels each day with the workout the template resolved, alternation included", () => {
    expect(dayOn("2026-03-02").label).toBe(CIRCUIT_A);
    expect(dayOn("2026-03-03").label).toBe(INTERVALS);
    expect(dayOn("2026-03-04").label).toBe(CIRCUIT_B);
    // The second Monday, from the same entry as the first. A week is not the
    // cycle, and the grid's own labels have to say so.
    expect(dayOn("2026-03-09").label).toBe(CIRCUIT_B);
  });

  it("ignores a log for a date the window does not cover", () => {
    // The read narrows to the window, but a caller is free to pass more. An
    // out-of-range row must not shift anything, and must not throw.
    const outside: SessionLog[] = [
      { date: "2025-12-25", workoutId: CIRCUIT_A_ID, status: "done" },
    ];

    expect(daysOf(outside)).toEqual(daysOf());
  });

  it("reports without grading — no score, no streak, no total", () => {
    // The module returns dots and nothing else. A count here would be the grade
    // the whole graphic exists to avoid, and the one number the grid does
    // produce is the screen-reader tally it derives from the dots it drew.
    const days = daysOf([{ date: "2026-03-02", workoutId: CIRCUIT_A_ID, status: "done" }]);

    for (const day of days) {
      expect(Object.keys(day).sort()).toEqual(
        day.label === undefined ? ["date", "status"] : ["date", "label", "status"],
      );
    }
  });
});
