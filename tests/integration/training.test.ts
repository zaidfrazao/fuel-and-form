import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { recentSessions } from "@/lib/adherence";
import { getDb } from "@/lib/db";
import {
  clearSession,
  loadTraining,
  logSet,
  recordSession,
  removeSet,
} from "@/lib/db/queries/training";
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

/**
 * Recording a session against a real Postgres — FUEL-27.
 *
 * The action layer is covered hermetically in `src/app/actions/training.test.ts`
 * with the database mocked. What that suite structurally cannot assert is the
 * one guarantee this feature rests on, because it lives in the database rather
 * than in the code: `workout_logs` is unique on `(user_id, date, workout_id)`,
 * so a correction UPDATES the row it corrects instead of adding a second one.
 *
 * Without it, "past sessions are editable by date" is not a coherent claim —
 * the screen, the dot grid and the weekly export would each be reading a set of
 * rows with no rule for which one wins, and the app would be picking by
 * `logged_at` in three places that could drift.
 *
 * The fixture seeds Alice with one workout log on 2026-03-02, already `done`.
 * That is the row these cases correct, clear and try to duplicate.
 */

const ALICE_LOGGED = "2026-03-02";

/** Bob's own logged date, and the reps his one fixture set carries. */
const BOB_DATE_LOGGED = "2026-03-03";

/** `fixtures.ts` gives each user `name.length` reps, so the three differ. */
const ALICE_FIXTURE_REPS = "Alice".length;

describe.skipIf(!configured)("recording a session, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Every log this user holds, oldest date first. */
  const logsOf = (userId: string) =>
    scope(userId, getDb()).select(schema.workoutLogs, undefined, {
      orderBy: [asc(schema.workoutLogs.date)],
    });

  it("replaces the status on a date rather than adding a second row", async () => {
    const { userId, workoutId } = fixture.alice;

    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId,
      status: "partial",
      note: "cut it at three rounds",
      durationMin: 22,
    });

    const logs = await logsOf(userId);

    // One row, not two. This is the whole of the unique index's job.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: "partial",
      note: "cut it at three rounds",
      durationMin: 22,
    });
  });

  it("writes the absence of a note, so a correction can take one back", async () => {
    const { userId, workoutId } = fixture.alice;

    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId,
      status: "done",
      note: "felt strong",
      durationMin: 28,
    });
    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId,
      status: "done",
      note: null,
      durationMin: null,
    });

    const [log] = await logsOf(userId);

    // `null` and "leave it alone" are different instructions, and the update
    // has to honour the first — otherwise a cleared note silently survives.
    expect(log?.note).toBeNull();
    expect(log?.durationMin).toBeNull();
  });

  it("moves logged_at with the correction", async () => {
    const { userId, workoutId } = fixture.alice;

    const [before] = await logsOf(userId);

    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId,
      status: "skipped",
      note: null,
      durationMin: null,
    });

    const [after] = await logsOf(userId);

    // The column means "when this was recorded", and after a correction the
    // record was made at the correction — which is what keeps `latestLog` on
    // `/` pointing at what most recently happened.
    expect(after!.loggedAt.getTime()).toBeGreaterThan(before!.loggedAt.getTime());
  });

  it("keeps one row per workout, so the walk and the session both survive", async () => {
    const { userId } = fixture.alice;
    const s = scope(userId, getDb());

    const [walk] = await s.insert(schema.workouts, { name: "Daily Walk", type: "walk" });

    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId: walk!.id,
      status: "done",
      note: null,
      durationMin: null,
    });

    // The index constrains (date, workout), not the date. A day holds both.
    expect(await logsOf(userId)).toHaveLength(2);
  });

  it("refuses a duplicate at the database, not merely in the app", async () => {
    const { userId, workoutId } = fixture.alice;

    // A plain insert, bypassing `recordSession` entirely — which is what a
    // future caller reaching for `s.insert` would be doing. The constraint has
    // to be the thing that stops it, or it is a habit rather than a guarantee.
    await expect(
      scope(userId, getDb()).insert(schema.workoutLogs, {
        date: ALICE_LOGGED,
        workoutId,
        status: "skipped",
      }),
    ).rejects.toThrow();
  });

  it("clears a date's record and leaves the other dates alone", async () => {
    const { userId, workoutId } = fixture.alice;

    await recordSession(userId, {
      date: "2026-03-09",
      workoutId,
      status: "done",
      note: null,
      durationMin: null,
    });

    expect(await clearSession(userId, ALICE_LOGGED, workoutId)).toBe(true);

    const remaining = await logsOf(userId);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.date).toBe("2026-03-09");

    // Nothing left to remove is `false`, not an error — the caller uses it to
    // tell a real revert from one that raced another tab.
    expect(await clearSession(userId, ALICE_LOGGED, workoutId)).toBe(false);
  });

  it("never reaches another user's log, holding its workout id or not", async () => {
    // § 1.4. Bob is a demo visitor; Alice is the owner. Every statement below
    // is scoped, so Bob naming Alice's workout writes his OWN row and deletes
    // nothing of hers.
    const before = await logsOf(fixture.alice.userId);

    expect(await clearSession(fixture.bob.userId, ALICE_LOGGED, fixture.alice.workoutId)).toBe(
      false,
    );
    expect(await logsOf(fixture.alice.userId)).toEqual(before);
  });

  it("hands the screen the date's own logs and the grid's whole window", async () => {
    const { userId, workoutId } = fixture.alice;

    // Five weeks before the fixture's logged date — inside a six-week window
    // ending on it, and therefore a dot on the grid.
    await recordSession(userId, {
      date: "2026-01-26",
      workoutId,
      status: "skipped",
      note: null,
      durationMin: null,
    });

    const training = await loadTraining(userId, ALICE_LOGGED, new Date());

    expect(training?.date).toBe(ALICE_LOGGED);
    // The date's own rows are filtered from the window rather than fetched
    // again, so the two answers are the same read.
    expect(training?.logs.map((log) => log.date)).toEqual([ALICE_LOGGED]);
    expect(training?.adherence).toHaveLength(6);

    const dots = training!.adherence.flat();

    expect(dots.find((day) => day.date === "2026-01-26")?.status).toBe("skipped");
    expect(dots.find((day) => day.date === ALICE_LOGGED)?.status).toBe("done");
  });

  it("leaves a log outside the window out of the grid", async () => {
    const { userId, workoutId } = fixture.alice;

    // A year earlier: a real row, and one no dot in this window can show. The
    // read narrows to `adherenceWindow`, so it never crosses the wire at all.
    await recordSession(userId, {
      date: "2025-03-03",
      workoutId,
      status: "done",
      note: null,
      durationMin: null,
    });

    const training = await loadTraining(userId, ALICE_LOGGED, new Date());

    expect(
      training?.adherence.flat().some((day) => day.date === "2025-03-03"),
    ).toBe(false);
  });
});

/**
 * The daily walk's own write — FUEL-29.
 *
 * `src/components/walk-row.tsx` and its two callers are asserted in the
 * hermetic suite with the action mocked, and `actions/log-walk.ts` cannot be
 * called from here at all: it resolves a session cookie, which is a request and
 * not a fixture. What is left is the part the action delegates, and it is the
 * part the feature actually rests on.
 *
 * Two claims, both of which live in the database rather than in the code:
 *
 *   1. The walk resolves out of `loadTraining` with `kind: 'walk'` and the
 *      `entryId` the row sends back, so the action's `find` has something to
 *      match. That derivation is `resolve-training.ts`'s and is unit-tested, but
 *      it reads `workouts.type` off a real row — and a `type` that came back as
 *      anything other than the string 'walk' would make every tap on the row
 *      resolve to nothing and be refused, silently, with a banner.
 *   2. The walk's row and the session's row coexist on one date and are cleared
 *      independently. `workout_logs` is unique on `(user_id, date, workout_id)`,
 *      which is exactly what allows this — the walk shares every day with a
 *      session — and it is also what makes a second tap on the walk an update
 *      rather than the unique-index violation a plain insert would raise.
 */
describe.skipIf(!configured)("recording the daily walk, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** The walk on every day of the week, sorting after whatever else a day has. */
  async function seedWalk(userId: string): Promise<string> {
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

    return walk!.id;
  }

  /** What `resolveWalk` does, minus the session it cannot have here. */
  async function resolveWalk(userId: string, date: string) {
    const training = await loadTraining(userId, date, new Date());

    return training?.day.sessions.find((item) => item.kind === "walk");
  }

  const logsOf = (userId: string) =>
    scope(userId, getDb()).select(schema.workoutLogs, undefined, {
      orderBy: [asc(schema.workoutLogs.date)],
    });

  it("resolves the walk on a date, entry and all", async () => {
    const walkId = await seedWalk(fixture.alice.userId);

    const walk = await resolveWalk(fixture.alice.userId, ALICE_LOGGED);

    // The kind is read off `workouts.type` on a row that has been to Postgres
    // and back. The entry is what the screen names and the action matches.
    expect(walk?.workout.id).toBe(walkId);
    expect(walk?.kind).toBe("walk");
    expect(walk?.entryId).toBeTruthy();
    // No exercise rows, which is the honest model rather than a missing one.
    expect(walk?.exercises).toEqual([]);
  });

  it("resolves on a weekend, where there is no session to share the day with", async () => {
    await seedWalk(fixture.alice.userId);

    // 2026-01-10 is a Saturday. "Every day including weekends" is a property of
    // the template, and this is that property surviving the round trip.
    expect((await resolveWalk(fixture.alice.userId, SATURDAY))?.kind).toBe("walk");
  });

  it("records one row for the walk beside the session's own", async () => {
    const { userId, workoutId } = fixture.alice;
    const walkId = await seedWalk(userId);

    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId: walkId,
      status: "done",
      note: null,
      durationMin: null,
    });

    const logs = await logsOf(userId);

    // Two rows on one date: the fixture's session, and the walk. The unique
    // index is on `(user_id, date, workout_id)`, so it constrains the pair and
    // not the day.
    expect(logs.filter((log) => log.date === ALICE_LOGGED)).toHaveLength(2);
    expect(logs.find((log) => log.workoutId === walkId)).toMatchObject({
      status: "done",
      note: null,
      durationMin: null,
    });
    expect(logs.find((log) => log.workoutId === workoutId)?.status).toBe("done");
  });

  it("updates the walk on a second tap rather than writing another row", async () => {
    const { userId } = fixture.alice;
    const walkId = await seedWalk(userId);

    const log = (durationMin: number | null) =>
      recordSession(userId, {
        date: ALICE_LOGGED,
        workoutId: walkId,
        status: "done",
        note: null,
        durationMin,
      });

    await log(null);
    await log(45);
    await log(null);

    const rows = (await logsOf(userId)).filter((row) => row.workoutId === walkId);

    // One row throughout. A duration added and then cleared is the same
    // statement three times — which is what makes the presets toggleable, and
    // what a plain insert would have turned into a unique-index violation on
    // the second tap.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.durationMin).toBeNull();
  });

  it("clears the walk without touching the session on the same date", async () => {
    const { userId, workoutId } = fixture.alice;
    const walkId = await seedWalk(userId);

    await recordSession(userId, {
      date: ALICE_LOGGED,
      workoutId: walkId,
      status: "done",
      note: null,
      durationMin: 30,
    });

    expect(await clearSession(userId, ALICE_LOGGED, walkId)).toBe(true);

    const remaining = (await logsOf(userId)).filter((log) => log.date === ALICE_LOGGED);

    expect(remaining.map((log) => log.workoutId)).toEqual([workoutId]);
    // Taking it back twice is not a failure the second time; it is a screen
    // that was behind. The action answers `ok` either way.
    expect(await clearSession(userId, ALICE_LOGGED, walkId)).toBe(false);
  });

  it("never reaches another user's walk", async () => {
    const walkId = await seedWalk(fixture.alice.userId);

    await recordSession(fixture.alice.userId, {
      date: ALICE_LOGGED,
      workoutId: walkId,
      status: "done",
      note: null,
      durationMin: null,
    });

    // Bob holding Alice's walk id is the demo-isolation case, and the answer is
    // the WHERE clause rather than a check: the row does not match, so the
    // delete removes nothing and cannot tell him whether it existed.
    expect(await clearSession(fixture.bob.userId, ALICE_LOGGED, walkId)).toBe(false);
    // Alice's row is untouched — the assertion that makes the one above mean
    // something rather than merely pass.
    expect(
      (await logsOf(fixture.alice.userId)).some((log) => log.workoutId === walkId),
    ).toBe(true);
  });
});

/**
 * Reviewing a past date against a real Postgres — FUEL-30.
 *
 * `src/lib/rotation.test.ts` § 1.2 case 6 already proves the resolver gives a
 * past date the answer it gave on the day, and it proves it the only way that
 * claim can be proved conclusively: against a pure function that reads no
 * history at all. What it cannot reach is the round trip. `program_start_date`
 * and the date being asked for are both `date` columns, and the alternation is
 * `daysBetween` over the two — so a driver handing back a `Date` instead of a
 * 'YYYY-MM-DD' string would give a session on 5 January one name in January and
 * another in March, in some timezones only.
 *
 * That is the failure this covers: the same date, asked about from two
 * different presents, through the query the screen actually calls.
 */
describe.skipIf(!configured)("reviewing a past date, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  it("gives a past date the session it gave on the day", async () => {
    const { userId } = fixture.alice;

    // The program's own first session, viewed on the day…
    const onTheDay = await loadTraining(userId, FIRST_MONDAY, new Date());
    // …and the same date viewed a fortnight later, with two more sessions of
    // the rotation behind it.
    const later = await loadTraining(userId, THIRD_MONDAY, new Date());

    expect(onTheDay?.day.sessions[0]?.workout.name).toBeDefined();
    expect(later?.day.sessions[0]?.workout.name).toBeDefined();

    const reviewed = await loadTraining(userId, FIRST_MONDAY, new Date());

    expect(reviewed?.day.sessions[0]?.workout.id).toBe(
      onTheDay?.day.sessions[0]?.workout.id,
    );
    // And the dot the later window draws for that date names the same workout,
    // so the grid and the screen behind it cannot tell different stories about
    // one day.
    expect(
      later?.adherence.flat().find((day) => day.date === FIRST_MONDAY)?.label,
    ).toBe(onTheDay?.day.sessions[0]?.workout.name);
  });

  it("offers that date as a row under the grid", async () => {
    const { userId } = fixture.alice;

    const later = await loadTraining(userId, THIRD_MONDAY, new Date());

    // What `/training` renders beneath the dots. The rows come from the grid's
    // own days, so this is the same six weeks the query fetched — and the first
    // Monday is reachable from the third without typing a URL.
    const rows = recentSessions(later?.adherence ?? [], THIRD_MONDAY);

    expect(rows.map((row) => row.date)).toContain(FIRST_MONDAY);
    expect(rows.at(0)?.date).toBe(THIRD_MONDAY);
  });

  it("edits a past date without touching the rows around it", async () => {
    const { userId, workoutId } = fixture.alice;

    // A correction made now, filed against a date two weeks ago — the write
    // "editable retrospectively" means, through the same upsert the action
    // calls.
    await recordSession(userId, {
      date: FIRST_MONDAY,
      workoutId,
      status: "partial",
      note: "went back and corrected this",
      durationMin: 31,
    });

    const reviewed = await loadTraining(userId, FIRST_MONDAY, new Date());

    expect(reviewed?.logs).toHaveLength(1);
    expect(reviewed?.logs[0]).toMatchObject({
      date: FIRST_MONDAY,
      status: "partial",
      durationMin: 31,
    });

    // The fixture's own log, on a later date, is untouched: a retrospective
    // edit addresses one date and one workout.
    const untouched = await loadTraining(userId, ALICE_LOGGED, new Date());

    expect(untouched?.logs[0]).toMatchObject({ date: ALICE_LOGGED, status: "done" });
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-91 — sets, against the constraints that make them true                */
/* -------------------------------------------------------------------------- */

/**
 * § P10's per-set logging, against real Postgres.
 *
 * Everything here is a claim about the DATABASE rather than about the module,
 * which is why none of it can be asserted in the hermetic suite:
 *
 *   - the parent log is created by `on conflict do nothing`, so "the status is
 *     not recomputed" is a claim about what that clause leaves alone;
 *   - a correction collides on `exercise_sets_user_log_exercise_index_key`,
 *     which only exists in the schema;
 *   - clearing a session takes its sets with it by CASCADE, which no test with
 *     a mocked query layer can see;
 *   - and the composite foreign keys are what stop a demo visitor naming the
 *     owner's exercise at all.
 *
 * The fixture seeds each user one exercise, one log on their own date, and one
 * set against it. `ALICE_LOGGED` is that date and the log there is `done` —
 * which is what makes the "a set does not move the status" case meaningful.
 */
describe.skipIf(!configured)("logging sets, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Every set this user holds, in the order they were performed. */
  const setsOf = (userId: string) =>
    scope(userId, getDb()).select(schema.exerciseSets, undefined, {
      orderBy: [asc(schema.exerciseSets.setIndex)],
    });

  const logsOf = (userId: string) =>
    scope(userId, getDb()).select(schema.workoutLogs, undefined, {
      orderBy: [asc(schema.workoutLogs.date)],
    });

  const UNLOGGED = "2026-03-09"; // a Monday the fixture has no log for

  it("creates the session's log at partial when the first set arrives", async () => {
    const { userId, workoutId, exerciseId } = fixture.alice;

    await logSet(userId, {
      date: UNLOGGED,
      workoutId,
      exerciseId,
      setIndex: 1,
      reps: 12,
    });

    const created = (await logsOf(userId)).find((log) => log.date === UNLOGGED);

    // 'partial' because it is the only one of the three that is true of a
    // session with one set in it, and because `status` is not null.
    expect(created?.status).toBe("partial");
    expect(created?.note).toBeNull();
    expect(created?.durationMin).toBeNull();
  });

  it("leaves a status the reader chose exactly where it was", async () => {
    // PRD § P10, in the direction that would be easiest to get wrong: the
    // fixture's log on this date is `done`, and a fourth set does not make it
    // partial. A status that drifted with set completion would turn the dot
    // grid into a percentage.
    const { userId, workoutId, exerciseId } = fixture.alice;
    const before = (await logsOf(userId)).find((log) => log.date === ALICE_LOGGED);

    await logSet(userId, {
      date: ALICE_LOGGED,
      workoutId,
      exerciseId,
      setIndex: 4,
      reps: 6,
    });

    const after = (await logsOf(userId)).find((log) => log.date === ALICE_LOGGED);

    expect(after?.status).toBe("done");
    // `logged_at` is when the OUTCOME was recorded. A set is not an outcome.
    expect(after?.loggedAt).toEqual(before?.loggedAt);
  });

  it("corrects a set rather than adding a second row at the same address", async () => {
    const { userId, workoutId, exerciseId } = fixture.alice;

    // The fixture's own set is index 1. Writing it again is one row twice.
    await logSet(userId, { date: ALICE_LOGGED, workoutId, exerciseId, setIndex: 1, reps: 7 });

    const sets = await setsOf(userId);

    expect(sets).toHaveLength(1);
    expect(sets.at(0)?.reps).toBe(7);
  });

  it("adds a set beside the ones already there", async () => {
    const { userId, workoutId, exerciseId } = fixture.alice;

    await logSet(userId, { date: ALICE_LOGGED, workoutId, exerciseId, setIndex: 2, reps: 10 });

    expect((await setsOf(userId)).map((row) => row.setIndex)).toEqual([1, 2]);
  });

  it("ships load_kg dormant", async () => {
    // PRD § Gym-restart readiness: the column is here so the restart is a data
    // change rather than a migration, and nothing writes it until then.
    const { userId, workoutId, exerciseId } = fixture.alice;

    await logSet(userId, { date: UNLOGGED, workoutId, exerciseId, setIndex: 1, reps: 12 });

    for (const row of await setsOf(userId)) expect(row.loadKg).toBeNull();
  });

  it("removes one set and leaves the session's record standing", async () => {
    const { userId, workoutId, exerciseId } = fixture.alice;

    expect(
      await removeSet(userId, { date: ALICE_LOGGED, workoutId, exerciseId, setIndex: 1 }),
    ).toBe(true);

    expect(await setsOf(userId)).toEqual([]);
    // A status the reader chose is not something a set removal may take away.
    expect((await logsOf(userId)).find((log) => log.date === ALICE_LOGGED)?.status).toBe(
      "done",
    );
  });

  it("is false rather than an error when the set is already gone", async () => {
    const { userId, workoutId, exerciseId } = fixture.alice;

    await removeSet(userId, { date: ALICE_LOGGED, workoutId, exerciseId, setIndex: 1 });

    expect(
      await removeSet(userId, { date: ALICE_LOGGED, workoutId, exerciseId, setIndex: 1 }),
    ).toBe(false);
  });

  it("is false for a date with no session log at all", async () => {
    const { userId, workoutId, exerciseId } = fixture.alice;

    expect(
      await removeSet(userId, { date: UNLOGGED, workoutId, exerciseId, setIndex: 1 }),
    ).toBe(false);
  });

  it("takes a session's sets with it when the record is cleared", async () => {
    // The cascade, and the only outcome the shape allows: a set whose log is
    // gone has no date, no workout and nothing to hang off.
    const { userId, workoutId } = fixture.alice;

    expect(await clearSession(userId, ALICE_LOGGED, workoutId)).toBe(true);
    expect(await setsOf(userId)).toEqual([]);
  });

  it("refuses a set against another user's exercise, in the database", async () => {
    // § 1.4, and the half no application check is doing here. `exercise_sets`
    // names `(exercise_id, user_id)` as one composite key, so Bob writing his
    // own `user_id` beside Alice's exercise is not a row Postgres will store.
    // The action refuses it first; this is what holds if one ever forgets to.
    const bob = fixture.bob;

    await expect(
      logSet(bob.userId, {
        date: BOB_DATE_LOGGED,
        workoutId: bob.workoutId,
        exerciseId: fixture.alice.exerciseId,
        setIndex: 2,
        reps: 12,
      }),
    ).rejects.toThrow();

    expect(await setsOf(bob.userId)).toHaveLength(1);
  });

  it("never lets a demo visitor read or remove the owner's sets", async () => {
    // The acceptance criterion, asserted rather than assumed. Bob is the demo
    // visitor; Alice is the owner.
    const alicesSets = await setsOf(fixture.alice.userId);
    const bobsSets = await setsOf(fixture.bob.userId);

    expect(alicesSets).toHaveLength(1);
    expect(bobsSets).toHaveLength(1);
    // Not one row of hers in his answer — the fixture gives them different rep
    // counts so a leak could not be mistaken for a coincidence.
    expect(bobsSets.map((row) => row.id)).not.toContain(alicesSets.at(0)?.id);
    expect(bobsSets.every((row) => row.userId === fixture.bob.userId)).toBe(true);

    // And a delete aimed straight at her address removes nothing of hers.
    expect(
      await removeSet(fixture.bob.userId, {
        date: ALICE_LOGGED,
        workoutId: fixture.alice.workoutId,
        exerciseId: fixture.alice.exerciseId,
        setIndex: 1,
      }),
    ).toBe(false);
    expect(await setsOf(fixture.alice.userId)).toEqual(alicesSets);
  });

  it("hands the screen this date's sets and no other date's", async () => {
    // `loadTraining` narrows sets to the viewed date rather than to the grid's
    // six-week window, which the logs take. Nothing on the screen draws another
    // date's reps.
    const { userId, workoutId, exerciseId } = fixture.alice;

    await logSet(userId, { date: UNLOGGED, workoutId, exerciseId, setIndex: 1, reps: 5 });

    const viewed = await loadTraining(userId, ALICE_LOGGED, new Date());

    expect(viewed?.sets.map((row) => row.reps)).toEqual([ALICE_FIXTURE_REPS]);

    const other = await loadTraining(userId, UNLOGGED, new Date());

    expect(other?.sets.map((row) => row.reps)).toEqual([5]);
  });
});
