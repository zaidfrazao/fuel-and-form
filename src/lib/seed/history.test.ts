import { describe, expect, it } from "vitest";

import { addDays, type CalendarDate, dayOfWeek, daysBetween, todayIn } from "@/lib/date";
import type {
  Meal,
  PlanTemplateEntry,
  TrainingTemplateEntry,
  Workout,
} from "@/lib/db/schema";
import { resolveTraining } from "@/lib/rotation";
import { PACE_TOLERANCE_KG, TRAILING_DAYS, weightStats } from "@/lib/weight-stats";

import { demoHistory, type DemoHistoryInput, MEAL_LOG_WEEKS } from "./history";
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

  return { meals, workouts, planTemplate, trainingTemplate };
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
    });
  });
});

/** Every date this history writes, across all four tables. */
function everyDatedRow(history: ReturnType<typeof demoHistory>): CalendarDate[] {
  return [
    ...history.weightLogs.map((row) => row.date),
    ...history.workoutLogs.map((row) => row.date),
    ...history.mealLogs.map((row) => row.date),
    ...history.dayPlanOverrides.map((row) => row.date),
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
