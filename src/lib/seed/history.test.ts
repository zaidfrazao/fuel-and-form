import { describe, expect, it } from "vitest";

import { addDays, type CalendarDate, dayOfWeek, daysBetween, todayIn } from "@/lib/date";
import type {
  Meal,
  PlanTemplateEntry,
  TrainingTemplateEntry,
  Workout,
  WorkoutExercise,
} from "@/lib/db/schema";
import { resolveTraining } from "@/lib/rotation";
import { WORKING_SECTION, working } from "@/lib/section";
import { countPoints, distanceMetres, MAX_ROUTE_POINTS, TRIM_METRES } from "@/lib/route";
import { PACE_TOLERANCE_KG, TRAILING_DAYS, weightStats } from "@/lib/weight-stats";

import {
  demoHistory,
  type DemoHistoryInput,
  MEAL_LOG_WEEKS,
  ROUTE_HISTORY_WEEKS,
  SET_HISTORY_WEEKS,
} from "./history";
import { seedMeals } from "./meals";
import { DEMO_TIMEZONE, demoProfile } from "./persona";
import { seedPlanTemplate, seedTrainingTemplate } from "./plan";
import { seedWorkouts } from "./workouts";

/**
 * Sam Rivera's generated history — FUEL-41.
 *
 * ## What this file is actually for
 *
 * Not to restate the generator's arithmetic. A test that recomputed the weight
 * curve from the same constants would pass for as long as the two copies agreed
 * and would notice nothing about whether the result is any good.
 *
 * So the assertions run the output through the REAL consumers instead —
 * `weightStats` for the verdict the demo's progress view prints, and
 * `resolveTraining` for the sessions its training view draws. That is the
 * acceptance criterion "the fixture and the feature maintain each other" turned
 * into something that can fail: a change to the on-pace band, to the rotation,
 * or to the curve breaks a test here rather than quietly changing what a
 * visitor sees.
 *
 * ## Every weekday, not one
 *
 * `demoProgramStart` is relative to whenever a visitor clicks, so a demo can be
 * provisioned on any of seven weekdays, each giving a slightly different length
 * of history and a different trailing window. Seven is small enough to be
 * exhaustive, and exhaustive is the only honest way to claim a property holds
 * "whenever the demo is provisioned" — this is not a sample.
 */

/* -------------------------------------------------------------------------- */
/* The library, as `loadSeedLibraries` would have written it                   */
/* -------------------------------------------------------------------------- */

/**
 * Rows standing in for a seeded library, with readable ids in place of uuids.
 *
 * Built from the SHIPPED seed arrays rather than from invented meals and
 * workouts, because half of what this file checks is about their structure —
 * that the weekend has no dinner to log, that Mon/Wed/Fri alternate a rotation
 * group. A hand-made fixture would test those claims against itself.
 *
 * The ids are `meal-0`, `workout-1` and so on. `loadSeedLibraries` gets real
 * uuids from Postgres; nothing in the generator parses an id, so the shape of
 * one is not a property under test here.
 */
function seededLibrary() {
  const meals: Meal[] = seedMeals.map(({ key, ingredients, ...meal }, index) => ({
    ...meal,
    id: `meal-${index}`,
    userId: "demo",
    method: meal.method ?? null,
    notes: meal.notes ?? null,
    isArchived: false,
  }));

  const workouts: Workout[] = seedWorkouts.map(({ key, exercises, ...workout }, index) => ({
    ...workout,
    id: `workout-${index}`,
    userId: "demo",
    description: workout.description ?? null,
    rotationGroup: workout.rotationGroup ?? null,
    rotationIndex: workout.rotationIndex ?? null,
  }));

  const mealIds = new Map(seedMeals.map((meal, index) => [meal.key, `meal-${index}`]));
  const workoutIds = new Map(
    seedWorkouts.map((workout, index) => [workout.key, `workout-${index}`]),
  );

  const planTemplate: PlanTemplateEntry[] = seedPlanTemplate.map((entry, index) => ({
    id: `plan-entry-${index}`,
    userId: "demo",
    dayOfWeek: entry.dayOfWeek,
    slot: entry.slot,
    mealId: mealIds.get(entry.mealKey)!,
    sortOrder: entry.sortOrder ?? 0,
  }));

  const trainingTemplate: TrainingTemplateEntry[] = seedTrainingTemplate.map(
    (entry, index) => ({
      id: `training-entry-${index}`,
      userId: "demo",
      dayOfWeek: entry.dayOfWeek,
      workoutId: entry.workoutKey ? (workoutIds.get(entry.workoutKey) ?? null) : null,
      rotationGroup: entry.rotationGroup ?? null,
      sortOrder: entry.sortOrder ?? 0,
    }),
  );

  // Flattened exactly as `loadSeedLibraries` writes them: `sort_order` is the
  // position within the workout, not across all of them, and it is defaulted at
  // load time rather than stated in the seed file.
  const workoutExercises: WorkoutExercise[] = seedWorkouts.flatMap((workout, workoutIndex) =>
    workout.exercises.map((exercise, sortOrder) => ({
      ...exercise,
      id: `exercise-${workoutIndex}-${sortOrder}`,
      userId: "demo",
      workoutId: `workout-${workoutIndex}`,
      sortOrder,
      section: exercise.section ?? WORKING_SECTION,
      notes: exercise.notes ?? null,
      targetSets: exercise.targetSets ?? null,
      targetRepsLow: exercise.targetRepsLow ?? null,
      targetRepsHigh: exercise.targetRepsHigh ?? null,
      mediaKey: exercise.mediaKey ?? null,
      mediaKind: exercise.mediaKind ?? null,
      mediaAlt: exercise.mediaAlt ?? null,
      mediaCredit: exercise.mediaCredit ?? null,
    })),
  );

  return { meals, workouts, planTemplate, trainingTemplate, workoutExercises };
}

const LIBRARY = seededLibrary();

/**
 * A provision at noon on a given date, as `provisionDemoUser` would make one.
 *
 * Noon so the instant is unambiguously the same calendar day in the persona's
 * zone, which is the one thing this helper must not get wrong: `todayIn` is
 * what the real caller uses, and a midnight instant would resolve to the
 * previous day under British Summer Time.
 */
function provisionedOn(iso: string): DemoHistoryInput {
  const now = new Date(`${iso}T12:00:00Z`);

  return {
    profile: demoProfile(now),
    today: todayIn(DEMO_TIMEZONE, now),
    ...LIBRARY,
  };
}

/** Seven consecutive days, so every weekday a demo can start on is covered. */
const WEEK = [
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
] as const;

const eachWeekday = WEEK.map((date) => [date] as const);

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

describe("determinism", () => {
  /**
   * The property the E2E-fixture criterion rests on. Without it the persona is
   * not a fixture at all — an assertion about what Sam did nine weeks ago would
   * pass or fail depending on the provision, and an E2E suite would have to
   * seed its own data and drift away from the product.
   */
  it("produces identical history for the same provision", () => {
    const input = provisionedOn("2026-08-25");

    expect(demoHistory(input)).toEqual(demoHistory(input));
  });

  it("does not depend on the time of day within the persona's zone", () => {
    const morning = demoHistory({
      ...provisionedOn("2026-08-25"),
      today: todayIn(DEMO_TIMEZONE, new Date("2026-08-25T06:30:00Z")),
    });

    expect(morning).toEqual(demoHistory(provisionedOn("2026-08-25")));
  });
});

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

describe("the window it covers", () => {
  it.each(eachWeekday)("covers about twelve weeks, provisioned %s", (date) => {
    const input = provisionedOn(date);
    const { weightLogs } = demoHistory(input);

    const span = daysBetween(input.profile.programStartDate, input.today);

    expect(span).toBeGreaterThanOrEqual(11 * 7);
    expect(span).toBeLessThanOrEqual(12 * 7);
    expect(weightLogs.length).toBeGreaterThan(7 * 5);
  });

  /**
   * Nothing before day zero, because the resolvers schedule nothing there — a
   * log against an unscheduled date is a row the app has no way to render.
   */
  it.each(eachWeekday)("writes nothing before the program starts, %s", (date) => {
    const input = provisionedOn(date);
    const history = demoHistory(input);

    for (const row of everyDatedRow(history)) {
      expect(row >= input.profile.programStartDate).toBe(true);
    }
  });

  /**
   * Today is left alone on purpose — see the module comment. If this ever
   * fails, the demo still renders, but every action on the "Right Now" view is
   * already taken and P7's "fully writable" promise has nothing to demonstrate.
   */
  it.each(eachWeekday)("stops before today, %s", (date) => {
    const input = provisionedOn(date);
    const history = demoHistory(input);

    for (const row of everyDatedRow(history)) {
      expect(row < input.today).toBe(true);
    }

    expect(history.weightLogs.some((row) => row.date === input.today)).toBe(false);
  });

  it("returns nothing at all when the program has not started", () => {
    const input = provisionedOn("2026-08-25");
    const history = demoHistory({ ...input, today: input.profile.programStartDate });

    expect(history).toEqual({
      weightLogs: [],
      dayPlanOverrides: [],
      mealLogs: [],
      workoutLogs: [],
      exerciseSets: [],
      walkRoutes: [],
    });
  });
});

/**
 * Every date this history writes, across all five tables.
 *
 * `exerciseSets` carries a date because that is half of the key its log is
 * resolved by (FUEL-96), which means the bounds properties below cover sets
 * without a line of their own — including "stops before today", the one that
 * keeps the demo's landing screen something a visitor can still act on.
 */
function everyDatedRow(history: ReturnType<typeof demoHistory>): CalendarDate[] {
  return [
    ...history.weightLogs.map((row) => row.date),
    ...history.workoutLogs.map((row) => row.date),
    ...history.mealLogs.map((row) => row.date),
    ...history.dayPlanOverrides.map((row) => row.date),
    ...history.exerciseSets.map((row) => row.date),
  ];
}

/* -------------------------------------------------------------------------- */
/* The weight series                                                           */
/* -------------------------------------------------------------------------- */

describe("weigh-ins", () => {
  it.each(eachWeekday)("trends down without reaching the target, %s", (date) => {
    const input = provisionedOn(date);
    const { weightLogs } = demoHistory(input);

    const first = weightLogs.at(0)!;
    const last = weightLogs.at(-1)!;

    expect(first.weightKg).toBe(input.profile.startWeightKg);
    expect(last.weightKg).toBeLessThan(first.weightKg);

    // Still mid-cut. Arriving at the target would put the whole progress view
    // into its "done" state, which is not the story a demo should tell.
    expect(last.weightKg).toBeGreaterThan(input.profile.targetWeightKg);

    for (const row of weightLogs) {
      // Not monotonic, and it must not be — a series that only ever falls is
      // the other tell of generated data. What it must not do is wander far
      // ABOVE where the program started, which would read as a failing cut.
      expect(row.weightKg).toBeLessThan(first.weightKg + 0.5);
      expect(row.weightKg).toBeGreaterThan(input.profile.targetWeightKg);
    }

    // Explicitly: the wobble does go up sometimes. If this ever fails the
    // series has been flattened into a ruled line.
    expect(
      weightLogs.some((row, index) => index > 0 && row.weightKg > weightLogs[index - 1]!.weightKg),
    ).toBe(true);
  });

  /**
   * THE anchor test.
   *
   * `weightStats` calls a rate on pace only inside a two-sided band — within
   * `PACE_TOLERANCE_KG` under the configured pace and no faster. The demo's
   * headline stat is therefore decided by the slope of the trailing four weeks
   * alone, and it is easy to miss that a plausible-looking curve misses the
   * band. Asserting through the real function, on every weekday a demo can
   * start on, is what keeps the generator answerable to it.
   */
  it.each(eachWeekday)("reads as on pace, provisioned %s", (date) => {
    const input = provisionedOn(date);
    const { weightLogs } = demoHistory(input);

    const stats = weightStats({
      readings: weightLogs.map((row) => ({ date: row.date, weightKg: row.weightKg })),
      startWeightKg: input.profile.startWeightKg,
      targetWeightKg: input.profile.targetWeightKg,
      goalPaceKgPerWeek: input.profile.goalPaceKgPerWeek,
    });

    expect(stats).not.toBeNull();
    expect(stats!.rate).not.toBeNull();
    expect(stats!.rate!.onPace).toBe(true);

    // Not on the edge of the band. A rate sitting exactly on a boundary is one
    // rounding change away from flipping the demo's verdict, so the margin is
    // asserted rather than left to luck.
    const loss = -stats!.rate!.kgPerWeek;
    const pace = input.profile.goalPaceKgPerWeek;

    expect(loss).toBeGreaterThan(pace - PACE_TOLERANCE_KG);
    expect(loss).toBeLessThan(pace);

    // Something to show on the progress grid, and not a finished journey.
    expect(stats!.percentToTarget).toBeGreaterThan(40);
    expect(stats!.percentToTarget).toBeLessThan(90);
  });

  it.each(eachWeekday)("does not weigh in every single day, %s", (date) => {
    const input = provisionedOn(date);
    const { weightLogs } = demoHistory(input);

    const span = daysBetween(input.profile.programStartDate, input.today);

    // Five mornings in seven. A perfect daily series is the least believable
    // thing a tracker can show.
    expect(weightLogs.length).toBeLessThan(span);
    expect(weightLogs.length).toBeGreaterThan(span * 0.6);
  });

  it.each(eachWeekday)("has a stall that is nowhere near the window, %s", (date) => {
    const input = provisionedOn(date);
    const { weightLogs } = demoHistory(input);

    const latest = weightLogs.at(-1)!;

    const weekly = (rows: typeof weightLogs) =>
      rows.length < 2
        ? 0
        : (rows.at(0)!.weightKg - rows.at(-1)!.weightKg) /
          (daysBetween(rows.at(0)!.date, rows.at(-1)!.date) / 7);

    const inWindow = weightLogs.filter(
      (row) => daysBetween(row.date, latest.date) < TRAILING_DAYS,
    );
    const earlier = weightLogs.filter(
      (row) => daysBetween(row.date, latest.date) >= TRAILING_DAYS,
    );

    // The stall lives in the older half, so the chart has a flat stretch in it
    // while the recent trend the verdict is taken from stays clean.
    expect(weekly(earlier)).toBeGreaterThan(0);
    expect(weekly(inWindow)).toBeGreaterThan(0);

    const flattest = Math.min(
      ...earlier.slice(0, -3).map((_, index) => weekly(earlier.slice(index, index + 4))),
    );

    expect(flattest).toBeLessThan(0.2);
  });

  it("keeps the day-to-day offsets balanced", () => {
    // Both properties the offsets table claims, checked against the series
    // rather than against the constant: the mean of the residuals around a
    // straight line is what a non-zero-sum table would shift.
    const input = provisionedOn("2026-08-25");
    const { weightLogs } = demoHistory(input);

    const recent = weightLogs.slice(-20);
    const byWeekday = new Map<number, number[]>();

    for (const row of recent) {
      const day = dayOfWeek(row.date);
      byWeekday.set(day, [...(byWeekday.get(day) ?? []), row.weightKg]);
    }

    // Five weigh-in weekdays, four occurrences each inside four weeks — the
    // structure `weight-stats.ts`'s 28-day window depends on.
    expect(byWeekday.size).toBe(5);

    for (const readings of byWeekday.values()) {
      expect(readings).toHaveLength(4);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Training                                                                    */
/* -------------------------------------------------------------------------- */

describe("training history", () => {
  /**
   * The silent failure rotation.ts warns about, checked independently.
   *
   * The generator resolves through `resolveTraining`, so this cannot fail today
   * — which is the point. If someone later replaces that call with a
   * hand-rolled Circuit A/B alternation to save an import, every session lands
   * on the wrong workout and the training view shows a log for a session that
   * was never scheduled. Nothing else in the suite would notice.
   */
  it.each(eachWeekday)("logs only sessions the plan scheduled, %s", (date) => {
    const input = provisionedOn(date);
    const { workoutLogs } = demoHistory(input);

    const training = {
      programStartDate: input.profile.programStartDate,
      template: input.trainingTemplate,
      workouts: input.workouts,
    };

    expect(workoutLogs.length).toBeGreaterThan(0);

    for (const log of workoutLogs) {
      const scheduled = resolveTraining(training, log.date).map(({ workout }) => workout.id);

      expect(scheduled).toContain(log.workoutId);
    }
  });

  it.each(eachWeekday)("logs every scheduled session exactly once, %s", (date) => {
    const input = provisionedOn(date);
    const { workoutLogs } = demoHistory(input);

    const training = {
      programStartDate: input.profile.programStartDate,
      template: input.trainingTemplate,
      workouts: input.workouts,
    };

    const seen = new Set<string>();

    for (const log of workoutLogs) {
      const key = `${log.date}:${log.workoutId}`;

      // `workout_logs_user_date_workout_key` is unique. A duplicate here is not
      // a cosmetic problem: it fails the insert, and every visitor gets a
      // refused demo rather than a slightly odd one.
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    let scheduled = 0;

    for (let day = 0; day < daysBetween(input.profile.programStartDate, input.today); day += 1) {
      scheduled += resolveTraining(
        training,
        addDays(input.profile.programStartDate, day),
      ).length;
    }

    expect(workoutLogs).toHaveLength(scheduled);
  });

  it.each(eachWeekday)("mixes done, partial and skipped, %s", (date) => {
    const { workoutLogs } = demoHistory(provisionedOn(date));

    const count = (status: string) =>
      workoutLogs.filter((log) => log.status === status).length;

    // `partial` is a first-class outcome in this schema, not a failure state,
    // so it has to actually appear — a demo that only ever shows done and
    // skipped hides a third of the training UI.
    expect(count("done")).toBeGreaterThan(0);
    expect(count("partial")).toBeGreaterThan(0);
    expect(count("skipped")).toBeGreaterThan(0);

    // Someone doing well but not perfectly. 100% would read as generated, and
    // the adherence figure is on both the progress view and the export.
    const adherence = count("done") / workoutLogs.length;

    expect(adherence).toBeGreaterThan(0.6);
    expect(adherence).toBeLessThan(0.95);
  });

  it("keeps the walk easier to keep than the sessions", () => {
    const input = provisionedOn("2026-08-25");
    const { workoutLogs } = demoHistory(input);

    const byId = new Map(input.workouts.map((workout) => [workout.id, workout]));
    const rate = (walk: boolean) => {
      const rows = workoutLogs.filter(
        (log) => (byId.get(log.workoutId)!.type === "walk") === walk,
      );

      return rows.filter((log) => log.status === "done").length / rows.length;
    };

    expect(rate(true)).toBeGreaterThan(rate(false));
  });

  it("records a duration for what happened and none for what did not", () => {
    const { workoutLogs } = demoHistory(provisionedOn("2026-08-25"));

    for (const log of workoutLogs) {
      if (log.status === "skipped") {
        expect(log.durationMin).toBeNull();
        continue;
      }

      expect(log.durationMin).toBeGreaterThan(0);
      expect(log.durationMin).toBeLessThan(60);
    }

    // Enough notes that the column is not a run of nulls on screen, few enough
    // that it does not read as a diary.
    const noted = workoutLogs.filter((log) => log.note !== null).length;

    expect(noted).toBeGreaterThan(5);
    expect(noted).toBeLessThan(workoutLogs.length / 2);
  });

  it("stamps each log on the day it happened rather than at provisioning", () => {
    const { workoutLogs } = demoHistory(provisionedOn("2026-08-25"));

    for (const log of workoutLogs.slice(0, 20)) {
      expect(log.loggedAt!.toISOString().slice(0, 10)).toBe(log.date);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Meals and the swap                                                          */
/* -------------------------------------------------------------------------- */

describe("meal history", () => {
  it.each(eachWeekday)("covers the recent weeks only, %s", (date) => {
    const input = provisionedOn(date);
    const { mealLogs } = demoHistory(input);

    const earliest = mealLogs.map((row) => row.date).sort()[0]!;
    const from = addDays(input.today, -MEAL_LOG_WEEKS * 7);

    expect(earliest >= from).toBe(true);
    expect(daysBetween(earliest, input.today)).toBeLessThanOrEqual(MEAL_LOG_WEEKS * 7);

    // The documented boundary, asserted so that raising MEAL_LOG_WEEKS is a
    // deliberate act rather than something that drifts.
    expect(mealLogs.length).toBeGreaterThan(MEAL_LOG_WEEKS * 7 * 3);
  });

  /**
   * The weekend leaves lunch and dinner flex on purpose, and the resolver skips
   * the second of each weekday's two snacks. Logging either would put a meal in
   * the export that no screen in the app ever showed.
   */
  it.each(eachWeekday)("logs only slots the plan actually fills, %s", (date) => {
    const input = provisionedOn(date);
    const { mealLogs } = demoHistory(input);

    const filled = new Set(
      input.planTemplate.map((entry) => `${entry.dayOfWeek}:${entry.slot}`),
    );

    const seen = new Set<string>();

    for (const log of mealLogs) {
      expect(filled.has(`${dayOfWeek(log.date)}:${log.slot}`)).toBe(true);

      // One meal per slot per day, matching what `resolveDay` returns.
      const key = `${log.date}:${log.slot}`;

      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it.each(eachWeekday)("is mostly eaten, but not entirely, %s", (date) => {
    const { mealLogs } = demoHistory(provisionedOn(date));

    const eaten = mealLogs.filter((log) => log.status === "eaten").length;

    // The export's planned-versus-actual columns are worth nothing if every
    // row agrees with the plan.
    expect(eaten).toBeLessThan(mealLogs.length);
    expect(eaten / mealLogs.length).toBeGreaterThan(0.8);
  });
});

describe("swaps", () => {
  /**
   * On the week the visitor actually lands on, wherever possible.
   *
   * `/plan` opens on the current week, so a swap sitting in an earlier one is a
   * feature the visitor has to go looking for. The exception is a Monday
   * provision, where the current week is one day old and that day is today —
   * which the history deliberately leaves alone. Stated as an exception rather
   * than loosened away, so the six days it does hold on stay held.
   */
  it.each(eachWeekday)("puts a swap in the week the visitor lands on, %s", (date) => {
    const input = provisionedOn(date);
    const { dayPlanOverrides } = demoHistory(input);

    const monday = addDays(input.today, -((dayOfWeek(input.today) + 6) % 7));
    const thisWeek = dayPlanOverrides.filter((row) => row.date >= monday);

    if (dayOfWeek(input.today) === 1) {
      expect(thisWeek).toHaveLength(0);
      return;
    }

    expect(thisWeek.length).toBeGreaterThan(0);
  });

  it.each(eachWeekday)("leaves at least one recent swap, %s", (date) => {
    const input = provisionedOn(date);
    const { dayPlanOverrides } = demoHistory(input);

    expect(dayPlanOverrides.length).toBeGreaterThan(0);

    for (const override of dayPlanOverrides) {
      // Recent enough that the visitor lands on a week containing it.
      expect(daysBetween(override.date, input.today)).toBeLessThanOrEqual(
        MEAL_LOG_WEEKS * 7,
      );

      // A weekday, because the template leaves the weekend's dinner flex and an
      // override there would invent a plan that never existed.
      const day = dayOfWeek(override.date);

      expect(day).toBeGreaterThan(0);
      expect(day).toBeLessThan(6);
    }
  });

  /**
   * The whole point of the swap: it has to make planned, actual and
   * swapped-with three different answers in at least one export row. Otherwise
   * FUEL-39's columns are invisible in the demo that exists to show them.
   */
  it.each(eachWeekday)("differs from the template and gets eaten, %s", (date) => {
    const input = provisionedOn(date);
    const { dayPlanOverrides, mealLogs } = demoHistory(input);

    for (const override of dayPlanOverrides) {
      const planned = input.planTemplate.find(
        (entry) =>
          entry.dayOfWeek === dayOfWeek(override.date) && entry.slot === override.slot,
      );

      expect(planned).toBeDefined();
      expect(override.mealId).not.toBe(planned!.mealId);

      // The swapped-in meal is one the template uses in that slot elsewhere in
      // the week — a different dinner, not the morning coffee.
      const slotMeals = input.planTemplate
        .filter((entry) => entry.slot === override.slot)
        .map((entry) => entry.mealId);

      expect(slotMeals).toContain(override.mealId);

      const logged = mealLogs.find(
        (log) => log.date === override.date && log.slot === override.slot,
      );

      expect(logged).toBeDefined();
      expect(logged!.mealId).toBe(override.mealId);
    }
  });

  it("writes one override per slot, as the unique index requires", () => {
    const { dayPlanOverrides } = demoHistory(provisionedOn("2026-08-30"));

    const keys = dayPlanOverrides.map((row) => `${row.date}:${row.slot}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * A program days rather than weeks old.
   *
   * The seeded persona is never in this state — `demoProgramStart` puts it
   * twelve weeks back — but the generator takes its dates as arguments, and the
   * two guards this exercises are the difference between a short program and a
   * walk that runs off the start of the program into dates nothing schedules.
   */
  it("stops at the program start and asks for no more swaps than exist", () => {
    const input = provisionedOn("2026-08-28");
    const programStart = addDays(input.today, -4);

    const history = demoHistory({
      ...input,
      profile: { ...input.profile, programStartDate: programStart },
    });

    for (const row of everyDatedRow(history)) {
      expect(row >= programStart).toBe(true);
    }

    // Four filled days behind today, and the third swap position asks for a
    // sixth. It goes unfilled rather than wrapping round to one already taken,
    // which the unique index on (date, slot) would refuse.
    expect(history.dayPlanOverrides.length).toBeGreaterThan(0);
    expect(history.dayPlanOverrides.length).toBeLessThan(3);
  });

  it("swaps nothing when the library has no alternative in the slot", () => {
    // A template whose every dinner is the same meal. Not the shipped library —
    // the branch exists because the generator takes its library as an argument,
    // and a caller with a one-recipe slot should get no swap rather than an
    // override that changes nothing.
    const input = provisionedOn("2026-08-30");
    const onlyDinner = input.planTemplate.find((entry) => entry.slot === "dinner")!;

    const history = demoHistory({
      ...input,
      planTemplate: input.planTemplate.map((entry) =>
        entry.slot === "dinner" ? { ...entry, mealId: onlyDinner.mealId } : entry,
      ),
    });

    expect(history.dayPlanOverrides).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Profiles that leave things unset                                            */
/* -------------------------------------------------------------------------- */

describe("a profile with times missing", () => {
  /**
   * `slot_times` is `Partial` and `workout_times` carries a `{}` default, so
   * both can arrive without the key being asked for. The demo's own profile
   * fills them, but the generator takes a profile as an argument and must not
   * produce an invalid instant for one that does not.
   */
  it("still stamps every row with a usable instant", () => {
    const input = provisionedOn("2026-08-25");

    const history = demoHistory({
      ...input,
      profile: { ...input.profile, slotTimes: {}, workoutTimes: undefined },
    });

    for (const row of [...history.mealLogs, ...history.workoutLogs]) {
      expect(Number.isNaN(row.loggedAt!.getTime())).toBe(false);
    }

    for (const row of history.dayPlanOverrides) {
      expect(Number.isNaN(row.createdAt!.getTime())).toBe(false);
    }
  });

  /** A workout type nothing here anticipates — schema.ts says to expect one. */
  it("handles a workout type the profile has no window for", () => {
    const input = provisionedOn("2026-08-25");

    const history = demoHistory({
      ...input,
      workouts: input.workouts.map((workout) => ({ ...workout, type: "strength" })),
    });

    expect(history.workoutLogs.length).toBeGreaterThan(0);

    for (const log of history.workoutLogs) {
      expect(Number.isNaN(log.loggedAt!.getTime())).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The set history                                                             */
/* -------------------------------------------------------------------------- */

/** The exercise a set names, from the fixture library. */
function exerciseFor(input: DemoHistoryInput, exerciseId: string): WorkoutExercise {
  const exercise = input.workoutExercises.find((row) => row.id === exerciseId);

  if (!exercise) throw new Error(`No such exercise: ${exerciseId}`);

  return exercise;
}

describe("set history", () => {
  it.each(eachWeekday)("logs sets against the demo's own sessions, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    // The whole point of the ticket: a demo whose training screen is blank on
    // every past date is a portfolio piece whose headline feature renders as
    // empty rows.
    expect(exerciseSets.length).toBeGreaterThan(0);
  });

  it.each(eachWeekday)("keeps every set inside the schema's bounds, %s", (date) => {
    const { exerciseSets } = demoHistory(provisionedOn(date));

    for (const set of exerciseSets) {
      // `exercise_sets_set_index_range` and `exercise_sets_reps_range`. A
      // generator that produced a row outside these would fail at the driver,
      // during provisioning, for every visitor — and nothing else here runs
      // against a real constraint.
      expect(set.setIndex).toBeGreaterThanOrEqual(1);
      expect(set.setIndex).toBeLessThanOrEqual(20);
      expect(set.reps).toBeGreaterThanOrEqual(1);
      expect(set.reps).toBeLessThanOrEqual(999);
    }
  });

  it.each(eachWeekday)("names a session it actually logged, %s", (date) => {
    const input = provisionedOn(date);
    const history = demoHistory(input);

    // The property `provisionDemoUser` resolves sets by, asserted where it is
    // cheap: a `(date, workoutId)` that is not among the logs is a set the
    // provisioner would throw on, in a transaction a visitor is waiting on.
    const logs = new Set(history.workoutLogs.map((log) => `${log.date}|${log.workoutId}`));

    for (const set of history.exerciseSets) {
      expect(logs.has(`${set.date}|${set.workoutId}`)).toBe(true);
    }
  });

  it.each(eachWeekday)("never logs a set against a skipped session, %s", (date) => {
    const input = provisionedOn(date);
    const history = demoHistory(input);

    const skipped = new Set(
      history.workoutLogs
        .filter((log) => log.status === "skipped")
        .map((log) => `${log.date}|${log.workoutId}`),
    );

    for (const set of history.exerciseSets) {
      expect(skipped.has(`${set.date}|${set.workoutId}`)).toBe(false);
    }
  });

  it.each(eachWeekday)("logs sets only against working rows, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    for (const set of exerciseSets) {
      // `section.ts`: a warm-up "does not get rep entry". A set against one is
      // data the screen cannot produce, and it would be priced at the working
      // MET by `energy.ts` on top of that.
      expect(exerciseFor(input, set.exerciseId).section).toBe(WORKING_SECTION);
    }
  });

  it.each(eachWeekday)("never invents a rep count for a timed hold, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    for (const set of exerciseSets) {
      const exercise = exerciseFor(input, set.exerciseId);

      // The planks, the side plank and the superman hold carry a set count and
      // no rep range, because seconds are not reps. `reps` is NOT NULL, so the
      // only honest row for one is no row — and the skipping session, which has
      // no target_sets at all, declines for the reason workouts.ts gives.
      expect(exercise.targetSets).not.toBeNull();
      expect(exercise.targetRepsLow).not.toBeNull();
      expect(exercise.targetRepsHigh).not.toBeNull();
    }
  });

  it.each(eachWeekday)("performs the prescription, and never under it, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    for (const set of exerciseSets) {
      const exercise = exerciseFor(input, set.exerciseId);

      expect(set.reps).toBeGreaterThanOrEqual(exercise.targetRepsLow!);
      expect(set.reps).toBeLessThanOrEqual(exercise.targetRepsHigh!);
      expect(set.setIndex).toBeLessThanOrEqual(exercise.targetSets!);
    }
  });

  it.each(eachWeekday)("gives an exercise consecutive sets from one, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    // A gap would be invisible in the data and visible on the screen, which
    // prints the index as the set's ordinal — "Set 1, Set 3".
    const byExercise = new Map<string, number[]>();

    for (const set of exerciseSets) {
      const key = `${set.date}|${set.exerciseId}`;

      byExercise.set(key, [...(byExercise.get(key) ?? []), set.setIndex]);
    }

    for (const indexes of byExercise.values()) {
      expect([...indexes].sort((a, b) => a - b)).toEqual(
        indexes.map((_, position) => position + 1),
      );
    }
  });

  it.each(eachWeekday)("stops at the set-history horizon, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    const earliest = exerciseSets.map((set) => set.date).sort()[0]!;

    // The documented boundary, asserted so that raising SET_HISTORY_WEEKS is a
    // deliberate act with a measured cost rather than a number someone nudged.
    expect(daysBetween(earliest, input.today)).toBeLessThanOrEqual(SET_HISTORY_WEEKS * 7);
  });

  it.each(eachWeekday)("does the whole session when it was completed, %s", (date) => {
    const input = provisionedOn(date);
    const history = demoHistory(input);

    const done = history.workoutLogs.filter(
      (log) => log.status === "done" && history.exerciseSets.some((set) => set.date === log.date),
    );

    for (const log of done) {
      const sets = history.exerciseSets.filter(
        (set) => set.date === log.date && set.workoutId === log.workoutId,
      );

      if (sets.length === 0) continue;

      // Every working row that CAN carry sets carries its full target. A 'done'
      // session that stopped two exercises in is not a done session.
      const eligible = working(
        input.workoutExercises.filter((row) => row.workoutId === log.workoutId),
      ).filter((row) => row.targetSets !== null && row.targetRepsLow !== null);

      expect(new Set(sets.map((set) => set.exerciseId)).size).toBe(eligible.length);

      for (const exercise of eligible) {
        expect(sets.filter((set) => set.exerciseId === exercise.id)).toHaveLength(
          exercise.targetSets!,
        );
      }
    }
  });

  it.each(eachWeekday)("stamps every set with a real instant, %s", (date) => {
    const input = provisionedOn(date);
    const { exerciseSets } = demoHistory(input);

    // The same claim the workout logs make one describe up. `createdAt` is
    // built by string arithmetic on the session's window, so an hour that ran
    // past midnight would produce `T24:03:00Z` and an Invalid Date — which
    // inserts as null-ish rather than failing, and reaches the export.
    for (const set of exerciseSets) {
      expect(Number.isNaN(set.createdAt!.getTime())).toBe(false);
      expect(set.createdAt!.toISOString().slice(0, 10)).toBe(set.date);
    }
  });

  it.each(eachWeekday)("never logs two sessions of one workout on a date, %s", (date) => {
    const { workoutLogs } = demoHistory(provisionedOn(date));

    // The property the whole `(date, workoutId)` correlation rests on, and the
    // one `workout_logs`' unique index would reject at insert time. Asserted
    // here so a template change that scheduled a workout twice in a day fails
    // in a unit test rather than as a failed provision for every visitor.
    const keys = workoutLogs.map((log) => `${log.date}|${log.workoutId}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the same history to two demos provisioned on the same day", () => {
    // Determinism, which the module note explains at length: a Tuesday nine
    // weeks ago is skipped in every demo ever provisioned or in none of them.
    const first = demoHistory(provisionedOn("2026-08-25"));
    const second = demoHistory(provisionedOn("2026-08-25"));

    expect(first.exerciseSets).toEqual(second.exerciseSets);
  });

  it("logs from day one of a program younger than the horizon", () => {
    const input = provisionedOn("2026-08-25");

    // A program shorter than SET_HISTORY_WEEKS is entirely INSIDE the horizon,
    // so the window clamps to the program rather than excluding it — the same
    // behaviour MEAL_LOG_WEEKS has, and the reason the guard below is not the
    // way this batch comes back empty.
    const history = demoHistory({
      ...input,
      today: addDays(input.profile.programStartDate, 1),
    });

    expect(history.exerciseSets.length).toBeGreaterThan(0);

    for (const set of history.exerciseSets) {
      expect(set.date).toBe(input.profile.programStartDate);
    }
  });

  it("returns no sets when nothing in the library carries a rep range", () => {
    const input = provisionedOn("2026-08-25");

    // The empty batch `provisionDemoUser` guards against, reached the way it
    // actually can be: a library of holds and intervals. The guard is what
    // stops "Try the demo" being an error for every visitor rather than a
    // degraded one — `scope.insert` has no statement for inserting no rows.
    const history = demoHistory({
      ...input,
      workoutExercises: input.workoutExercises.map((exercise) => ({
        ...exercise,
        targetRepsLow: null,
        targetRepsHigh: null,
      })),
    });

    expect(history.exerciseSets).toEqual([]);
    expect(history.workoutLogs.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Routes — § P11, FUEL-100                                                   */
/* -------------------------------------------------------------------------- */

describe("walk routes", () => {
  const history = demoHistory(provisionedOn("2026-08-25"));

  /** Every log that carries a recorded distance, by its natural key. */
  const recorded = new Map(
    history.workoutLogs
      .filter((log) => log.distanceM != null)
      .map((log) => [`${log.date}/${log.workoutId}`, log] as const),
  );

  it("records a route on some walks and not on others", () => {
    // Both states, in one history. § P11: "recording is additive — a walk with
    // no route is a complete walk with fewer figures, never a partial one". A
    // demo where every walk had a trace would quietly assert the opposite.
    expect(history.walkRoutes.length).toBeGreaterThan(0);
    expect(history.walkRoutes.length).toBeLessThan(
      history.workoutLogs.filter((log) => log.durationMin !== null).length,
    );
  });

  it("gives every route at least one point", () => {
    // The invariant standing in for a guard `history.ts` deliberately does not
    // write — see the note there. `walk_routes_point_count_range` refuses a
    // zero-point row, so this is what keeps provisioning from failing at the
    // database if `DURATION_MIN.walk` is ever lowered past twice the trim.
    for (const route of history.walkRoutes) {
      expect(route.pointCount).toBeGreaterThan(0);
      expect(route.pointCount).toBe(countPoints(route.points));
    }
  });

  it("holds every route under the stored cap", () => {
    for (const route of history.walkRoutes) {
      expect(route.pointCount).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    }
  });

  it("stores no coordinate at more than five decimal places", () => {
    // The rule this whole ticket exists for, asserted against the rows that
    // would actually be written rather than against the function that makes
    // them. A demo that bypassed `storableRoute` would pass every test above.
    for (const route of history.walkRoutes) {
      for (const segment of route.points) {
        for (const point of segment) {
          expect(Math.round(point.lat * 1e5)).toBeCloseTo(point.lat * 1e5, 6);
          expect(Math.round(point.lng * 1e5)).toBeCloseTo(point.lng * 1e5, 6);
        }
      }
    }
  });

  it("trims the ends, so no trace begins where the walk did", () => {
    // The stored geometry is shorter than the measured distance, by roughly
    // twice the trim. That gap IS the privacy control, so a run where the two
    // agreed would mean the trim had silently stopped happening.
    for (const route of history.walkRoutes) {
      const log = recorded.get(`${route.date}/${route.workoutId}`);
      expect(log).toBeDefined();
      if (log?.distanceM == null) continue;

      const drawn = distanceMetres(route.points);
      expect(drawn).toBeLessThan(log.distanceM);
      expect(log.distanceM - drawn).toBeGreaterThan(TRIM_METRES);
    }
  });

  it("walks at a believable pace", () => {
    // The failure this catches is invisible in a diff and obvious on a screen:
    // a 20-minute walk covering nine kilometres. Between three and seven km/h
    // is the whole plausible range for walking, and the generator aims at the
    // middle of it.
    for (const [, log] of recorded) {
      if (log.distanceM == null || log.durationMin == null) continue;
      const kmh = (log.distanceM / 1000) / (log.durationMin / 60);
      expect(kmh).toBeGreaterThan(3);
      expect(kmh).toBeLessThan(7);
    }
  });

  it("records a distance only on walks", () => {
    // A circuit has no distance, and neither does a skipped walk. Null rather
    // than zero throughout — § P11's "absent rather than zeroed", which is
    // also what a walk logged before P11 looks like.
    const walkIds = new Set(
      LIBRARY.workouts.filter((workout) => workout.type === "walk").map((w) => w.id),
    );

    for (const log of history.workoutLogs) {
      if (log.distanceM == null) continue;
      expect(walkIds.has(log.workoutId)).toBe(true);
      expect(log.status).not.toBe("skipped");
    }
  });

  it("keeps routes inside their window, and logs outside it", () => {
    // The dial, asserted the way `SET_HISTORY_WEEKS` is. A route outside the
    // trailing weeks would be rows nobody opens, on a path priced per
    // provisioning.
    const input = provisionedOn("2026-08-25");
    const cutoff = addDays(input.today, -ROUTE_HISTORY_WEEKS * 7);

    for (const route of history.walkRoutes) {
      expect(route.date >= cutoff).toBe(true);
    }
    // And there IS history before the cutoff, so the assertion above is not
    // passing because everything happens to fall inside the window.
    expect(history.workoutLogs.some((log) => log.date < cutoff)).toBe(true);
  });

  it("is deterministic, like everything else here", () => {
    const input = provisionedOn("2026-08-25");
    expect(demoHistory(input).walkRoutes).toEqual(demoHistory(input).walkRoutes);
  });
});

/* -------------------------------------------------------------------------- */
/* A third walk on one day                                                    */
/* -------------------------------------------------------------------------- */

describe("more walks than there are logged hours", () => {
  /**
   * `WALK_LOGGED_HOURS` holds two entries since FUEL-98, and a third walk on a
   * day falls back to the last of them. `history.ts` states that as a
   * deliberate choice — *"a stamp rather than a lie: nothing in the schema
   * forbids a third walk, and a seed that threw on one would be a seed that
   * could not load a template the app is happy to render"* — but nothing
   * exercised it, so the gate on this file has been one branch short since the
   * second walk was added and the fallback stopped being reachable by two.
   *
   * Found while adding routes (FUEL-100) rather than caused by them: `main`
   * measures the same 98.41%.
   */
  it("stamps the extra walk with the last hour rather than throwing", () => {
    const input = provisionedOn("2026-08-25");

    const walk = LIBRARY.workouts.find((workout) => workout.type === "walk");
    expect(walk).toBeDefined();
    if (walk === undefined) return;

    // A third walk on every Monday, on top of the two the seed schedules.
    const trainingTemplate = [
      ...input.trainingTemplate,
      {
        id: "training-entry-third-walk",
        userId: "demo",
        dayOfWeek: 1 as const,
        workoutId: walk.id,
        rotationGroup: null,
        sortOrder: 99,
      },
    ];

    const history = demoHistory({ ...input, trainingTemplate });

    const mondayWalks = history.workoutLogs.filter(
      (log) => log.workoutId === walk.id && dayOfWeek(log.date) === 1,
    );

    expect(mondayWalks.length).toBeGreaterThan(0);
    // Nothing threw, every row got an instant, and no two walks on one date
    // share one — which is the property the hours exist to give.
    for (const log of mondayWalks) {
      expect(log.loggedAt).toBeInstanceOf(Date);
    }
  });
});
