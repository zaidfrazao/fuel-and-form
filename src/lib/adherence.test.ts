import { describe, expect, it } from "vitest";

import {
  adherenceWeeks,
  adherenceWindow,
  recentSessions,
  type SessionLog,
  weekStanding,
} from "./adherence";
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

/**
 * FUEL-30 — the same six weeks as a list a thumb can hit.
 *
 * The dots are the picture and this is the way back into it, so what matters
 * here is which dates the list is willing to send someone to. `dot-grid.tsx`
 * and `recent-sessions.tsx` carry the argument for why both exist.
 */
describe("the recent list", () => {
  it("gives the last seven session dates, newest first", () => {
    const weeks = adherenceWeeks(PLAN, [], ANCHOR);

    // Wednesday 8 April back to Tuesday 31 March, with the weekend of the 4th
    // and 5th absent: those are walk-only days, and this list is the way to the
    // screen's editable session.
    expect(recentSessions(weeks, ANCHOR).map((row) => row.date)).toEqual([
      "2026-04-08",
      "2026-04-07",
      "2026-04-06",
      "2026-04-03",
      "2026-04-02",
      "2026-04-01",
      "2026-03-31",
    ]);
  });

  it("carries the workout the date resolved to, and what was recorded", () => {
    const logs: SessionLog[] = [
      { date: "2026-04-06", workoutId: CIRCUIT_B_ID, status: "partial" },
    ];

    const [latest, , monday] = recentSessions(adherenceWeeks(PLAN, logs, ANCHOR), ANCHOR);

    // The rotation's answer for each date and not the week's — Wednesday is
    // Circuit A here and the Monday two days before it is Circuit B, because
    // the cycle runs across weeks rather than resetting on one.
    expect(latest).toEqual({ date: "2026-04-08", label: CIRCUIT_A, status: "none" });
    // An unlogged session is `none` exactly as it is a small dot on the grid —
    // the row states the absence without inventing a reason for it.
    expect(monday).toEqual({ date: "2026-04-06", label: CIRCUIT_B, status: "partial" });
  });

  it("stops at today, because a future session cannot have happened", () => {
    // The window runs to Sunday 12 April, four days past the anchor. Offering
    // one of them would be inviting a record the user would have to take back —
    // the same reason `DateNav` refuses to walk forward past today.
    const weeks = adherenceWeeks(PLAN, [], ANCHOR);

    expect(recentSessions(weeks, ANCHOR).map((row) => row.date)).not.toContain("2026-04-09");
    expect(recentSessions(weeks, "2026-04-10").map((row) => row.date).at(0)).toBe(
      "2026-04-10",
    );
  });

  it("leaves out the days there is no session to go back to", () => {
    // Three kinds of day the grid draws and this does not offer: a walk-only
    // weekend, a date before the program started, and — through both — anything
    // the template does not cover at all.
    const weeks = adherenceWeeks(PLAN, [], "2026-03-08"); // the first Sunday

    expect(recentSessions(weeks, "2026-03-08").map((row) => row.date)).toEqual([
      "2026-03-06",
      "2026-03-05",
      "2026-03-04",
      "2026-03-03",
      "2026-03-02",
    ]);
  });

  it("takes a different cap", () => {
    expect(recentSessions(adherenceWeeks(PLAN, [], ANCHOR), ANCHOR, 2)).toHaveLength(2);
    expect(recentSessions([], ANCHOR)).toEqual([]);
  });

  it("does not reorder the grid it is handed", () => {
    // `sort` is in-place. Sorting the weeks themselves would move the dots as a
    // side effect of drawing the list — rotation.ts guards the same property
    // for the same reason.
    const weeks = adherenceWeeks(PLAN, [], ANCHOR);
    const before = weeks.map((week) => week.map((day) => ({ ...day })));

    recentSessions(weeks, ANCHOR);

    expect(weeks).toEqual(before);
  });

  it("sorts, rather than trusting the order it was handed", () => {
    // `Week` says outright that order does not matter and that each day is
    // placed by its own date, so a caller is entitled to hand these over in any
    // order at all. A list that merely reversed its input would come out
    // oldest-first for one that did.
    const weeks = adherenceWeeks(PLAN, [], ANCHOR)
      .map((week) => [...week].reverse())
      .reverse();

    expect(recentSessions(weeks, ANCHOR, 3).map((row) => row.date)).toEqual([
      "2026-04-08",
      "2026-04-07",
      "2026-04-06",
    ]);
  });

  it("keeps the first of two rows for one date, as the grid does", () => {
    // A duplicate day is a caller's mistake rather than something the shaping
    // produces, and `layOut` already decided what to do about one: keep the
    // first given. A comparator that answered anything but 0 for equal dates
    // would make which one survives arbitrary.
    const twice = [
      [
        { date: "2026-04-06", label: CIRCUIT_A, status: "done" as const },
        { date: "2026-04-06", label: CIRCUIT_B, status: "skipped" as const },
      ],
    ];

    expect(recentSessions(twice, ANCHOR).map((row) => row.label)).toEqual([
      CIRCUIT_A,
      CIRCUIT_B,
    ]);
  });
});

describe("the week's standing", () => {
  /*
   * The right of `/training`'s header band — FUEL-86, `3 of 5 sessions this
   * week`. Read off the same six weeks the dot grid draws, so the count and the
   * dots cannot disagree.
   */

  const weeksWith = (logs: readonly SessionLog[] = [], anchor = ANCHOR) =>
    adherenceWeeks(PLAN, logs, anchor);

  it("counts the sessions the template trains in the viewed week", () => {
    // The seed's program is PRD § P3's five weekdays, and the walk is on every
    // one of them — so a count that let the walk in would say seven.
    const standing = weekStanding(weeksWith(), ANCHOR);

    expect(standing?.sessions).toBe(5);
    expect(standing?.done).toBe(0);
  });

  it("counts only what was recorded as done", () => {
    // Partial has its own control precisely to say NOT done — § Buttons — and a
    // count that folded the two would erase the distinction the screen offers
    // to make. A skip is not done either, and an unlogged day is not a skip.
    // The program's first week, whose three session dates and their workouts
    // are the ones "what a day says" already pins above — the rotation puts a
    // different workout on a given weekday in a later week, and a log naming
    // the wrong one would match nothing and pass this test for no reason.
    const viewing = "2026-03-04";

    const standing = weekStanding(
      weeksWith(
        [
          { date: "2026-03-02", workoutId: CIRCUIT_A_ID, status: "done" },
          { date: "2026-03-04", workoutId: CIRCUIT_B_ID, status: "partial" },
          { date: "2026-03-06", workoutId: CIRCUIT_A_ID, status: "skipped" },
        ],
        viewing,
      ),
      viewing,
    );

    expect(standing).toEqual({ done: 1, sessions: 5 });
  });

  it("answers about the week the date is in, not the last week of the window", () => {
    // The window is anchored on the viewed date, so the two coincide today.
    // Found by the date rather than indexed, because the index is a fact about
    // how the window is built and the date is a fact about what is on screen.
    const earlier = "2026-03-03"; // the first week of ANCHOR's window

    const standing = weekStanding(
      weeksWith([{ date: "2026-03-02", workoutId: CIRCUIT_A_ID, status: "done" }]),
      earlier,
    );

    expect(standing).toEqual({ done: 1, sessions: 5 });
  });

  it("says nothing about a date the window does not cover", () => {
    // A caller cannot draw `0 of 0` if it is never handed one.
    expect(weekStanding(weeksWith(), "2027-01-01")).toBeNull();
  });

  it("says nothing about a week with no sessions on it", () => {
    // Before the program starts there is nothing to be a fraction of, and
    // § Tone of Voice would rather say nothing than report a ratio about it.
    const before = "2026-02-25"; // a Wednesday, the week before PROGRAM_START

    expect(weekStanding(adherenceWeeks(PLAN, [], before), before)).toBeNull();
  });
});
