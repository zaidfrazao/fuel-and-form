import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { WorkoutExercise } from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { trainingDay } from "@/lib/resolve-training";
import type { TrainingPlan } from "@/lib/rotation";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * Today's session against a real Postgres — FUEL-26.
 *
 * `src/lib/resolve-training.test.ts` proves the shaping against fixtures built
 * in TypeScript, which is the right place for the schedule itself: it can assert
 * the whole seeded program week by week without a database in the loop. What it
 * cannot assert is that the ROWS Postgres hands back are the rows those fixtures
 * imitate, and the rotation is unusually exposed on exactly that point:
 *
 *   - `program_start_date` and the date being resolved are `date` columns, and
 *     the whole alternation is `daysBetween` over them. A driver returning a
 *     `Date` rather than the 'YYYY-MM-DD' string the resolvers parse would be
 *     a wrong circuit rather than a type error — and wrong by a day only in
 *     some timezones, which is the bug this project is most exposed to.
 *   - `rotation_group` / `rotation_index` are nullable and move together under
 *     a CHECK. The walk's nulls have to survive the round trip as nulls, or
 *     `groupWorkouts` matches the walk into the circuit's group and puts it on
 *     a Monday.
 *   - `training_template_entries` carries the exclusive `workout_id` XOR
 *     `rotation_group` choice. A row written with a group really does come back
 *     with a null `workout_id`, which is the branch resolution takes.
 *
 * The reads below go through `scope()` and assemble the same `TrainingPlan`
 * `db/queries/today.ts` assembles, so what is exercised is the arrangement the
 * app uses rather than a second one invented for a test.
 *
 * ## The dates
 *
 * The fixture's `program_start_date` is 2026-01-05, a Monday, and both Alice and
 * Bob get one Monday template row naming the shared rotation group. So the
 * Mondays are the program's own circuit days: 01-05 is session one, 01-12 is
 * session two, 01-19 session three.
 */

const configured = testDatabaseUrl() !== undefined;

const FIRST_MONDAY = "2026-01-05"; // the program start date itself
const SECOND_MONDAY = "2026-01-12";
const THIRD_MONDAY = "2026-01-19";
const SATURDAY = "2026-01-10";

describe.skipIf(!configured)("resolving a training day, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Everything `trainingDay` takes, read the way `loadToday` reads it. */
  async function load(
    userId: string,
  ): Promise<{ plan: TrainingPlan; exercises: Map<string, WorkoutExercise[]> }> {
    const s = scope(userId, getDb());

    const profile = await s.selectOne(schema.profiles);

    const [workouts, template, exerciseRows] = await Promise.all([
      s.select(schema.workouts),
      s.select(schema.trainingTemplateEntries),
      s.select(schema.workoutExercises, undefined, {
        orderBy: [
          asc(schema.workoutExercises.sortOrder),
          asc(schema.workoutExercises.id),
        ],
      }),
    ]);

    const exercises = new Map<string, WorkoutExercise[]>();

    for (const row of exerciseRows) {
      const list = exercises.get(row.workoutId);

      if (list) list.push(row);
      else exercises.set(row.workoutId, [row]);
    }

    return {
      plan: { programStartDate: profile!.programStartDate, template, workouts },
      exercises,
    };
  }

  /** The group Alice's seeded circuit belongs to, read rather than restated. */
  async function rotationGroup(userId: string): Promise<string> {
    const [workout] = await scope(userId, getDb()).select(schema.workouts);

    return workout!.rotationGroup!;
  }

  /** A second workout in the same group, so the rotation has somewhere to go. */
  async function addCircuitB(userId: string): Promise<string> {
    const owned = scope(userId, getDb());

    const [workout] = await owned.insert(schema.workouts, {
      name: "Circuit B",
      type: "circuit",
      rotationGroup: await rotationGroup(userId),
      rotationIndex: 1,
    });

    await owned.insert(schema.workoutExercises, [
      {
        workoutId: workout!.id,
        name: "Squat pulses",
        prescription: "3 x 20",
        sortOrder: 0,
      },
      {
        workoutId: workout!.id,
        name: "Pike push-ups",
        prescription: "3 x 8",
        sortOrder: 1,
      },
    ]);

    return workout!.id;
  }

  /** The daily walk, on all seven days, sorting after whatever else the day has. */
  async function addDailyWalk(userId: string): Promise<void> {
    const owned = scope(userId, getDb());

    const [walk] = await owned.insert(schema.workouts, {
      name: "Daily Walk",
      type: "walk",
    });

    await owned.insert(
      schema.trainingTemplateEntries,
      [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        workoutId: walk!.id,
        sortOrder: 1,
      })),
    );
  }

  it("resolves a template row that names a rotation group to a workout", async () => {
    const { plan, exercises } = await load(fixture.alice.userId);

    const [session] = trainingDay(plan, exercises, FIRST_MONDAY).sessions;

    // The template row carries no `workout_id` at all — the check constraint
    // made that exclusive when it was written — so this workout can only have
    // come from the group.
    expect(plan.template[0]?.workoutId).toBeNull();
    expect(session?.source).toBe("rotation");
    expect(session?.workout.id).toBe(fixture.alice.workoutId);
    expect(session?.kind).toBe("session");
  });

  it("carries the exercises Postgres holds, with their prescriptions", async () => {
    const { plan, exercises } = await load(fixture.alice.userId);

    const [session] = trainingDay(plan, exercises, FIRST_MONDAY).sessions;

    expect(session?.exercises.map((exercise) => exercise.name)).toEqual(["Press-ups"]);
    expect(session?.exercises[0]?.prescription).toBe("3 x 12");
  });

  it("alternates A / B / A across weeks once the group holds two", async () => {
    const circuitB = await addCircuitB(fixture.alice.userId);

    const { plan, exercises } = await load(fixture.alice.userId);

    const idOn = (date: string) =>
      trainingDay(plan, exercises, date).sessions[0]?.workout.id;

    // Three consecutive Mondays. Nothing was logged against any of them — the
    // rotation is counted from `program_start_date`, and `workout_logs` is not
    // even read, so the fixture's 'done' row for Alice cannot shift this.
    expect(idOn(FIRST_MONDAY)).toBe(fixture.alice.workoutId);
    expect(idOn(SECOND_MONDAY)).toBe(circuitB);
    expect(idOn(THIRD_MONDAY)).toBe(fixture.alice.workoutId);
  });

  it("swaps the exercise list with the workout, not just the name", async () => {
    await addCircuitB(fixture.alice.userId);

    const { plan, exercises } = await load(fixture.alice.userId);

    const [session] = trainingDay(plan, exercises, SECOND_MONDAY).sessions;

    expect(session?.exercises.map((exercise) => exercise.name)).toEqual([
      "Squat pulses",
      "Pike push-ups",
    ]);
  });

  it("gives a weekend the walk and nothing else", async () => {
    await addDailyWalk(fixture.alice.userId);

    const { plan, exercises } = await load(fixture.alice.userId);

    const saturday = trainingDay(plan, exercises, SATURDAY).sessions;

    // Saturday is walk-only because only the walk is scheduled on it. The
    // walk's null `rotation_group` survived the round trip — had it come back
    // as anything else, `groupWorkouts` would have matched it into the circuit
    // and put a walk on the Monday too.
    expect(saturday.map((session) => [session.workout.name, session.kind])).toEqual([
      ["Daily Walk", "walk"],
    ]);
    expect(saturday[0]?.exercises).toEqual([]);
    expect(saturday[0]?.source).toBe("fixed");
  });

  it("puts the walk after the session on a day that has both", async () => {
    await addDailyWalk(fixture.alice.userId);

    const { plan, exercises } = await load(fixture.alice.userId);

    expect(
      trainingDay(plan, exercises, FIRST_MONDAY).sessions.map((session) => session.kind),
    ).toEqual(["session", "walk"]);
  });

  it("resolves nothing before the program starts, walk included", async () => {
    await addDailyWalk(fixture.alice.userId);

    const { plan, exercises } = await load(fixture.alice.userId);

    // The Sunday before the start date. The walk is scheduled on it and still
    // resolves to nothing: day zero is the first day of the program.
    expect(trainingDay(plan, exercises, "2026-01-04").sessions).toEqual([]);
  });

  it("never reaches another user's workouts, same group or not", async () => {
    // Alice and Bob name the same group on purpose — isolation has to come from
    // `user_id`, not from the two of them having picked different strings.
    await addCircuitB(fixture.bob.userId);

    const alice = await load(fixture.alice.userId);
    const bob = await load(fixture.bob.userId);

    const aliceMonday = trainingDay(alice.plan, alice.exercises, SECOND_MONDAY).sessions;
    const bobMonday = trainingDay(bob.plan, bob.exercises, SECOND_MONDAY).sessions;

    // Bob's group has two workouts, so his second Monday rotates; Alice's has
    // one, so hers cannot. If Bob's row had leaked into her plan, hers would
    // alternate too — and would be his workout on this date.
    expect(aliceMonday.map((session) => session.workout.id)).toEqual([
      fixture.alice.workoutId,
    ]);
    expect(bobMonday[0]?.workout.userId).toBe(fixture.bob.userId);
    expect(bobMonday[0]?.workout.id).not.toBe(fixture.bob.workoutId);
  });
});
