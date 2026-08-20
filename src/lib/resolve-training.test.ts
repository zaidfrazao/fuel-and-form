import { describe, expect, it } from "vitest";

import type { TrainingTemplateEntry, Workout, WorkoutExercise } from "./db/schema";
import { trainingDay, WALK_TYPE } from "./resolve-training";
import type { TrainingPlan } from "./rotation";
import { seedTrainingTemplate } from "./seed/plan";
import { seedWorkouts } from "./seed/workouts";

/**
 * FUEL-26 — the wiring, asserted against the real program.
 *
 * The rotation arithmetic is rotation.test.ts's, at 100%, case by numbered case.
 * Nothing here re-derives it. What this file asserts is the layer above: that a
 * template entry naming a `rotation_group` comes back as the right WORKOUT with
 * the right exercises under it, and that the five-day schedule plus weekend
 * walks falls out of the template with no weekday rule anywhere.
 *
 * ## The fixture is the seed
 *
 * The rows below are built from `seedWorkouts` and `seedTrainingTemplate`, the
 * same arrays `lib/seed/load.ts` inserts, by the same rules — `sortOrder` is the
 * exercise's index, exactly as the loader assigns it. A hand-written template
 * would let this suite keep passing while the program the app actually seeds
 * drifted away from PRD § P3's schedule, which is the one thing these criteria
 * are about. Asserting on names rather than keys is deliberate for the same
 * reason: "Bodyweight Circuit A" is what the screen shows.
 *
 * ## The calendar
 *
 * Program start is Monday 2026-03-02 — rotation.test.ts's date and
 * resolve-plan.test.ts's, so all three suites share one calendar. The first full
 * week of the program is therefore:
 *
 *   Mon 03-02  circuit (A) + walk      Fri 03-06  circuit (A) + walk
 *   Tue 03-03  intervals + walk        Sat 03-07  walk only
 *   Wed 03-04  circuit (B) + walk      Sun 03-08  walk only
 *   Thu 03-05  intervals + walk        Mon 03-09  circuit (B) + walk
 *
 * The second Monday is the point: the alternation carries across the week
 * boundary, so a week is not a cycle and Monday is not Circuit A.
 */

const USER = "user-owner";
const PROGRAM_START = "2026-03-02"; // a Monday

const CIRCUIT_A = "Bodyweight Circuit A";
const CIRCUIT_B = "Bodyweight Circuit B";
const INTERVALS = "Skipping Intervals + Core";
const WALK = "Daily Walk";

/** Stable stand-ins for the uuids the loader would generate. */
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

/**
 * `workouts.id` → its exercises, keyed and ordered the way `loadToday` hands
 * them over: `sort_order` is the position in the seed's own array.
 */
const EXERCISES = new Map<string, WorkoutExercise[]>(
  seedWorkouts.map((workout) => [
    idFor(workout.key),
    workout.exercises.map((exercise, sortOrder) => ({
      id: `${workout.key}-exercise-${sortOrder}`,
      userId: USER,
      workoutId: idFor(workout.key),
      name: exercise.name,
      prescription: exercise.prescription,
      sortOrder,
      notes: exercise.notes ?? null,
    })),
  ]),
);

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

/** The day's workouts by name, in the order the screen would list them. */
const namesOn = (date: string, plan: TrainingPlan = PLAN) =>
  trainingDay(plan, EXERCISES, date).sessions.map((session) => session.workout.name);

describe("a template entry that names a rotation group", () => {
  it("resolves to the workout the rotation lands on, not to a fixed row", () => {
    // The task's own testing note, and the criterion the entry exists for.
    // Monday's row names 'bodyweight-circuit' and no workout at all; what comes
    // back is a workout, and which one depends on the date.
    const monday = trainingDay(PLAN, EXERCISES, PROGRAM_START).sessions[0]!;

    expect(TEMPLATE.find((entry) => entry.id === monday.entryId)).toMatchObject({
      workoutId: null,
      rotationGroup: "bodyweight-circuit",
    });
    expect(monday.workout.name).toBe(CIRCUIT_A);
    expect(monday.source).toBe("rotation");
  });

  it("names the entry that produced it, not the workout", () => {
    // The same Monday entry on both dates, resolving to different workouts —
    // which is why `entryId` is the entry: it is the stable thing to edit or
    // to log against, where the workout is the date's answer.
    const first = trainingDay(PLAN, EXERCISES, PROGRAM_START).sessions[0]!;
    const second = trainingDay(PLAN, EXERCISES, "2026-03-09").sessions[0]!;

    expect(second.entryId).toBe(first.entryId);
    expect(second.workout.name).toBe(CIRCUIT_B);
  });

  it("marks a fixed entry as fixed", () => {
    // Tuesday's intervals and the daily walk are both `workout_id` rows. The
    // discriminator has to survive the join, because a rotated day is the one
    // whose workout a screen cannot cache against the entry.
    expect(
      trainingDay(PLAN, EXERCISES, "2026-03-03").sessions.map((s) => s.source),
    ).toEqual(["fixed", "fixed"]);
  });
});

describe("the five-day schedule", () => {
  it("resolves the program's first week day by day", () => {
    expect(namesOn("2026-03-02")).toEqual([CIRCUIT_A, WALK]);
    expect(namesOn("2026-03-03")).toEqual([INTERVALS, WALK]);
    expect(namesOn("2026-03-04")).toEqual([CIRCUIT_B, WALK]);
    expect(namesOn("2026-03-05")).toEqual([INTERVALS, WALK]);
    expect(namesOn("2026-03-06")).toEqual([CIRCUIT_A, WALK]);
  });

  it("carries the alternation into the second week rather than restarting it", () => {
    // A week is not the cycle. Monday is B, Wednesday A, Friday B — the mirror
    // of the first week, which is what gives each circuit equal time over a
    // fortnight (seed/workouts.ts).
    expect(namesOn("2026-03-09")).toEqual([CIRCUIT_B, WALK]);
    expect(namesOn("2026-03-11")).toEqual([CIRCUIT_A, WALK]);
    expect(namesOn("2026-03-13")).toEqual([CIRCUIT_B, WALK]);
  });

  it("lists the session before the walk, as the template orders them", () => {
    // `sort_order` 0 then 1, from the seed. The walk is the day's second
    // activity, not its headline, and this file does not re-sort by kind.
    const monday = trainingDay(PLAN, EXERCISES, "2026-03-02").sessions;

    expect(monday.map((session) => session.kind)).toEqual(["session", "walk"]);
  });

  it("echoes the date it was asked about", () => {
    expect(trainingDay(PLAN, EXERCISES, "2026-03-04").date).toBe("2026-03-04");
  });
});

describe("weekends", () => {
  it("show the walk and nothing else", () => {
    expect(namesOn("2026-03-07")).toEqual([WALK]); // Saturday
    expect(namesOn("2026-03-08")).toEqual([WALK]); // Sunday
  });

  it("say so through `kind`, so a screen need not know which days are weekends", () => {
    const saturday = trainingDay(PLAN, EXERCISES, "2026-03-07");

    expect(saturday.sessions.every((session) => session.kind === "walk")).toBe(true);
  });

  it("follow the template rather than the calendar", () => {
    // Saturday training is walk-only because nothing else is scheduled on it —
    // not because it is a Saturday. Add a Saturday circuit and the same date
    // resolves to a session, with no change here.
    const saturdayCircuit: TrainingTemplateEntry = {
      id: "entry-saturday",
      userId: USER,
      dayOfWeek: 6,
      workoutId: null,
      rotationGroup: "bodyweight-circuit",
      sortOrder: 0,
    };

    const plan = { ...PLAN, template: [saturdayCircuit, ...TEMPLATE] };

    expect(namesOn("2026-03-07", plan)).toEqual([CIRCUIT_B, WALK]);
  });
});

describe("the exercise list", () => {
  it("carries every exercise of the resolved workout, in prescribed order", () => {
    const [circuit] = trainingDay(PLAN, EXERCISES, PROGRAM_START).sessions;

    // Circuit A's five exercises, the whole list — PRD § P3 asks for the FULL
    // list with its prescriptions, and a list truncated here would be a screen
    // that silently drops the last movement of the session.
    expect(circuit!.exercises.map((exercise) => exercise.name)).toEqual([
      "Squats",
      "Push-ups",
      "Reverse lunges",
      "Glute bridges",
      "Plank",
    ]);
    expect(circuit!.exercises.map((exercise) => exercise.sortOrder)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("carries the prescription verbatim", () => {
    // '3 x 12–20' and '8–12 rounds — 40 sec on / 40 sec off' are the same kind
    // of thing to this app: schema.ts says the column is "displayed verbatim,
    // never parsed", so nothing on the way to the screen may reformat it.
    const [intervals] = trainingDay(PLAN, EXERCISES, "2026-03-03").sessions;

    expect(intervals!.exercises[0]?.prescription).toBe(
      "8–12 rounds — 40 sec on / 40 sec off",
    );
  });

  it("resolves the two circuits to different lists, not to one shared one", () => {
    const a = trainingDay(PLAN, EXERCISES, "2026-03-02").sessions[0]!;
    const b = trainingDay(PLAN, EXERCISES, "2026-03-04").sessions[0]!;

    expect(a.exercises[0]?.name).toBe("Squats");
    expect(b.exercises[0]?.name).toBe("Squat pulses");
  });

  it("is empty for the walk, which has no exercise rows", () => {
    const walk = trainingDay(PLAN, EXERCISES, "2026-03-07").sessions[0]!;

    expect(walk.workout.type).toBe(WALK_TYPE);
    expect(walk.exercises).toEqual([]);
  });

  it("is empty rather than absent when the map does not cover the workout", () => {
    // A caller that fetched a narrower set of exercises than the template
    // needs. Empty is what the walk looks like too, and the screen already
    // renders that case — a throw here would take down a day view over a
    // question nobody asked.
    expect(trainingDay(PLAN, new Map(), PROGRAM_START).sessions[0]!.exercises).toEqual(
      [],
    );
  });
});

describe("`kind`", () => {
  it("reads 'walk' only for the walk type", () => {
    const monday = trainingDay(PLAN, EXERCISES, PROGRAM_START).sessions;

    expect(monday.map((session) => [session.workout.type, session.kind])).toEqual([
      ["circuit", "session"],
      ["walk", "walk"],
    ]);
  });

  it("calls a type it has never seen a session", () => {
    // `workouts.type` is text, not an enum, precisely so the gym restart adds
    // rows and not a migration (schema.ts). A 'strength' session must render as
    // a session on the day it is inserted, without an edit here.
    const strength: Workout = {
      id: idFor("barbell-day"),
      userId: USER,
      name: "Barbell Day",
      type: "strength",
      description: null,
      rotationGroup: null,
      rotationIndex: null,
    };

    const entry: TrainingTemplateEntry = {
      id: "entry-strength",
      userId: USER,
      dayOfWeek: 6,
      workoutId: strength.id,
      rotationGroup: null,
      sortOrder: 0,
    };

    const plan: TrainingPlan = {
      ...PLAN,
      template: [entry, ...TEMPLATE],
      workouts: [strength, ...WORKOUTS],
    };

    const [first] = trainingDay(plan, EXERCISES, "2026-03-07").sessions;

    expect(first!.workout.name).toBe("Barbell Day");
    expect(first!.kind).toBe("session");
  });
});

describe("determinism", () => {
  it("cannot be given session history at all", () => {
    // rotation.test.ts § 1.2 case 4's structural assertion, restated one layer
    // up because this is the layer a screen calls. The arguments are a plan, an
    // exercise map and a date — there is no parameter through which "what
    // actually happened" could reach the answer, so a skipped session cannot
    // shift what comes next even by accident.
    expect(trainingDay.length).toBe(3);
    expect(Object.keys(PLAN).sort()).toEqual([
      "programStartDate",
      "template",
      "workouts",
    ]);
  });

  it("gives a skipped Wednesday the Friday it would have had", () => {
    // Nothing was logged for Wednesday 03-04's Circuit B. Friday is still A and
    // the following Monday still B — the answers a completed week would give.
    expect(namesOn("2026-03-06")).toEqual([CIRCUIT_A, WALK]);
    expect(namesOn("2026-03-09")).toEqual([CIRCUIT_B, WALK]);
  });

  it("answers a date months out, and answers it the same way twice", () => {
    expect(namesOn("2026-09-07")).toEqual(namesOn("2026-09-07"));
    expect(namesOn("2026-09-07")).toEqual([CIRCUIT_B, WALK]);
  });
});

describe("a date the program does not cover", () => {
  it("has no sessions before the program starts, walk included", () => {
    const before = trainingDay(PLAN, EXERCISES, "2026-03-01");

    // The walk is scheduled on all seven days, so this is the pre-start rule
    // and not an empty weekday: day zero is the first day, not the day after.
    expect(before.sessions).toEqual([]);
    expect(before.date).toBe("2026-03-01");
  });

  it("has no sessions on a weekday the template does not train", () => {
    const plan: TrainingPlan = {
      ...PLAN,
      template: TEMPLATE.filter((entry) => entry.dayOfWeek !== 0),
    };

    expect(trainingDay(plan, EXERCISES, "2026-03-08").sessions).toEqual([]);
  });
});
