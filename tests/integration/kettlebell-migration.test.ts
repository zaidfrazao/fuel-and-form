import { readFileSync } from "node:fs";

import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { todayIn } from "@/lib/date";
import { getDb } from "@/lib/db";
import { loadTraining } from "@/lib/db/queries/training";
import { loadWeekExport } from "@/lib/db/queries/week-export";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { buildWeekCsv } from "@/lib/export-week";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * The data half of `drizzle/0019_kettlebell_swings.sql` — FUEL-130.
 *
 * `walk-migration.test.ts` argues why a data migration needs a test when a
 * schema one does not, and every word of it applies: `globalSetup` has already
 * applied 0019, the seed already ships the swings, so a version of this file
 * that moved no rows would leave the rest of the suite green. The database it
 * is for is the owner's, which holds a skipping session and weeks of logs
 * against it, and the ticket's first criterion — history is not rewritten —
 * rests on what this file does to it.
 *
 * It runs the migration's own statements, read off disk, skipping the DDL that
 * `globalSetup` already applied. Every run here is therefore a RE-run of the
 * data half, and a second `runMigration()` in one test is the idempotence
 * claim.
 */

const configured = testDatabaseUrl() !== undefined;

const SKIPPING = "Skipping Intervals + Core";
const SWINGS = "Kettlebell Swings";
const TIMEZONE = "Europe/London";

/** The data statements, in file order: everything after the DDL. */
const STATEMENTS = readFileSync("drizzle/0019_kettlebell_swings.sql", "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0 && !/^ALTER TABLE/m.test(statement));

async function runMigration(): Promise<void> {
  for (const statement of STATEMENTS) {
    await getDb().execute(sql.raw(statement));
  }
}

describe.skipIf(!configured)("the kettlebell data migration", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /**
   * A week as it stood before FUEL-130: the skipping session on Tue and Thu,
   * open-ended, with a plank under it and a done log on a past Tuesday.
   */
  async function legacySkipping(userId: string) {
    const owned = scope(userId, getDb());

    const [skipping] = await owned.insert(schema.workouts, {
      name: SKIPPING,
      type: "intervals",
      description: "8–12 rounds.",
    });

    await owned.insert(schema.workoutExercises, {
      workoutId: skipping!.id,
      name: "Plank",
      prescription: "3 x 30–45 sec",
      targetSets: 3,
      targetSecondsLow: 30,
      targetSecondsHigh: 45,
    });

    await owned.insert(
      schema.trainingTemplateEntries,
      [2, 4].map((dayOfWeek) => ({ dayOfWeek, workoutId: skipping!.id })),
    );

    await owned.insert(schema.workoutLogs, {
      date: PAST_TUESDAY,
      workoutId: skipping!.id,
      status: "done",
      durationMin: 25,
    });

    await owned.update(
      schema.profiles,
      { workoutTimes: { intervals: "07:15" } },
      eq(schema.profiles.userId, userId),
    );

    return skipping!.id;
  }

  const today = () => todayIn(TIMEZONE, new Date());

  // Inside the fixture's program (it starts 2026-01-05) and before any run of
  // this suite, so it is always before the change date the migration writes.
  const PAST_TUESDAY = "2026-03-03";

  const rowsOf = (userId: string) =>
    scope(userId, getDb()).select(schema.trainingTemplateEntries);

  const workoutsNamed = (userId: string, name: string) =>
    scope(userId, getDb()).select(schema.workouts, eq(schema.workouts.name, name));

  it("adds the swing session and keeps the skipping one, unrenamed", async () => {
    const { userId } = fixture.alice;
    const skippingId = await legacySkipping(userId);

    await runMigration();

    const [skipping] = await workoutsNamed(userId, SKIPPING);
    const [swings] = await workoutsNamed(userId, SWINGS);

    expect(skipping?.id).toBe(skippingId);
    expect(skipping?.type).toBe("intervals");
    expect(swings?.type).toBe("kettlebell");

    const exercises = await scope(userId, getDb()).select(
      schema.workoutExercises,
      eq(schema.workoutExercises.workoutId, swings!.id),
    );
    const swing = exercises.find((row) => row.name === "Kettlebell swings");

    expect(exercises).toHaveLength(5);
    expect(swing).toMatchObject({
      targetSets: null,
      targetRepsLow: 10,
      targetRepsHigh: 25,
      targetTotalReps: 75,
      takesLoad: true,
    });
  });

  it("closes the skipping rows the day before, and opens the swings' on the day", async () => {
    const { userId } = fixture.alice;
    const skippingId = await legacySkipping(userId);

    await runMigration();

    const [swings] = await workoutsNamed(userId, SWINGS);
    const rows = await rowsOf(userId);
    const on = (workoutId: string) =>
      rows
        .filter((row) => row.workoutId === workoutId)
        .map(({ dayOfWeek, validFrom, validUntil }) => ({ dayOfWeek, validFrom, validUntil }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

    const yesterday = new Date(`${today()}T12:00:00Z`);

    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const closedOn = yesterday.toISOString().slice(0, 10);

    expect(on(skippingId)).toEqual([
      { dayOfWeek: 2, validFrom: null, validUntil: closedOn },
      { dayOfWeek: 4, validFrom: null, validUntil: closedOn },
    ]);
    expect(on(swings!.id)).toEqual([
      { dayOfWeek: 2, validFrom: today(), validUntil: null },
      { dayOfWeek: 4, validFrom: today(), validUntil: null },
    ]);
  });

  it("changes nothing on a second run", async () => {
    const { userId } = fixture.alice;

    await legacySkipping(userId);
    await runMigration();

    const before = await rowsOf(userId);

    await runMigration();

    expect(await rowsOf(userId)).toEqual(before);
    expect(await workoutsNamed(userId, SWINGS)).toHaveLength(1);
  });

  it("touches only users whose Tue/Thu was skipping", async () => {
    // Bob has no skipping session; he gets no swings.
    await legacySkipping(fixture.alice.userId);
    await runMigration();

    expect(await workoutsNamed(fixture.bob.userId, SWINGS)).toEqual([]);
  });

  it("carries the intervals slot time to the kettlebell one", async () => {
    const { userId } = fixture.alice;

    await legacySkipping(userId);
    await runMigration();

    const [profile] = await scope(userId, getDb()).select(schema.profiles);

    expect(profile?.workoutTimes).toMatchObject({ intervals: "07:15", kettlebell: "07:15" });
  });

  it("keeps a past Tuesday on the skipping session, with its log, on /training", async () => {
    // The ticket's first criterion, through the query the screen reads.
    const { userId } = fixture.alice;
    const skippingId = await legacySkipping(userId);

    await runMigration();

    const training = await loadTraining(userId, PAST_TUESDAY, new Date());
    const session = training?.day.sessions.find((item) => item.kind === "session");

    expect(session?.workout.name).toBe(SKIPPING);
    expect(training?.logs.find((log) => log.workoutId === skippingId)?.status).toBe("done");
  });

  it("keeps a past week's export on the skipping session, not an unplanned row", async () => {
    const { userId } = fixture.alice;

    await legacySkipping(userId);
    await runMigration();

    const csv = buildWeekCsv((await loadWeekExport(userId, new Date(), "2026-03-02"))!.input);
    const lines = csv.split("\n").filter((line) => line.includes(PAST_TUESDAY));

    expect(lines.some((line) => line.includes(SKIPPING))).toBe(true);
    expect(lines.some((line) => line.includes(SWINGS))).toBe(false);
  });

  it("writes a set's load where the exercise takes one, and it reaches the export", async () => {
    const { userId } = fixture.alice;

    await legacySkipping(userId);
    await runMigration();

    const [swings] = await workoutsNamed(userId, SWINGS);
    const [swing] = await scope(userId, getDb()).select(
      schema.workoutExercises,
      and(
        eq(schema.workoutExercises.workoutId, swings!.id),
        eq(schema.workoutExercises.takesLoad, true),
      ),
    );
    const owned = scope(userId, getDb());
    const [log] = await owned.insert(schema.workoutLogs, {
      date: "2026-03-10",
      workoutId: swings!.id,
      status: "done",
    });

    await owned.insert(schema.exerciseSets, {
      workoutLogId: log!.id,
      exerciseId: swing!.id,
      setIndex: 1,
      reps: 20,
      loadKg: 13.5,
    });

    const [stored] = await owned.select(
      schema.exerciseSets,
      eq(schema.exerciseSets.exerciseId, swing!.id),
    );

    expect(stored?.loadKg).toBe(13.5);

    // The CSV's `load_kg` column, on the set's own line.
    const csv = buildWeekCsv((await loadWeekExport(userId, new Date(), "2026-03-09"))!.input);

    expect(csv.split("\n").find((line) => line.includes("Kettlebell swings"))).toMatch(/,13\.5\s*$/);
  });
});
