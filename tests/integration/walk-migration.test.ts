import { readFileSync } from "node:fs";

import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * The data migration that gives an existing database its second walk — FUEL-98,
 * `drizzle/0011_lucky_shocker.sql`.
 *
 * ## Why a migration needs a test at all, when no others here have one
 *
 * Because this one is not a schema change. Every other migration in this folder
 * is DDL, and the whole integration suite is its test: `globalSetup` applies the
 * folder before anything runs, so a column that failed to arrive fails every
 * file that reads it. This one adds no column and alters no table — it moves
 * ROWS — so a version of it that ran cleanly and did nothing would leave the
 * entire suite green. The seed already ships two walks, so every fixture below
 * this line builds the world the migration is supposed to produce, and none of
 * them would notice if it produced nothing.
 *
 * What it is for is the one database the seed will never touch: the owner's,
 * which already holds a single `daily-walk` row and weeks of logs against it.
 * PRD § P3's criterion is that existing history goes on resolving, and that
 * claim rests entirely on this file renaming that row rather than replacing it.
 *
 * ## It runs the migration's own SQL, read off disk
 *
 * Not a re-implementation of it. A copy of the statements written out here
 * would be a test that passed while the file it is about was broken — which is
 * the only failure mode that matters, since nothing else executes this file
 * after the first deployment that applies it.
 *
 * Running it a second time is not incidental either: `globalSetup` has already
 * applied it to this branch, so every execution below is a RE-run, and the
 * assertions are therefore also the idempotence claim the file's own comment
 * makes. A migration that doubled the afternoon walk on a second pass would
 * fail here rather than in whichever database somebody re-ran it against.
 */

const configured = testDatabaseUrl() !== undefined;

/** The statements, in file order. `drizzle-kit`'s own separator. */
const STATEMENTS = readFileSync("drizzle/0011_lucky_shocker.sql", "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

async function runMigration(): Promise<void> {
  for (const statement of STATEMENTS) {
    await getDb().execute(sql.raw(statement));
  }
}

describe.skipIf(!configured)("the two-walk data migration", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /**
   * A database as it stood before FUEL-98: one walk, on all seven days.
   *
   * Named "Daily Walk", because that is what the row was called and the
   * migration must not depend on having been run before. Returns its id, which
   * is the thing every assertion here is ultimately about.
   */
  async function legacyWalk(userId: string): Promise<string> {
    const owned = scope(userId, getDb());

    const [walk] = await owned.insert(schema.workouts, {
      name: "Daily Walk",
      type: "walk",
      description: "Separate from the training sessions.",
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

  const walksOf = (userId: string) =>
    scope(userId, getDb()).select(schema.workouts, eq(schema.workouts.type, "walk"), {
      orderBy: [asc(schema.workouts.name)],
    });

  it("renames the existing walk instead of replacing it", async () => {
    // The whole of the backward-compatibility claim. The id is what every
    // `workout_logs` row, every export line and every dot already points at, so
    // a migration that deleted and re-created would take the history with it
    // and there would be nothing in the app to say it had gone.
    const { userId } = fixture.alice;
    const walkId = await legacyWalk(userId);

    await runMigration();

    const morning = (await walksOf(userId)).find((walk) => walk.name === "Morning Walk");

    expect(morning?.id).toBe(walkId);
  });

  it("leaves the history against that row resolving, and against the right walk", async () => {
    // PRD § P3's criterion, at the layer it is actually a claim about. A log
    // filed before this ticket is a log against the morning walk afterwards,
    // with its duration intact.
    const { userId } = fixture.alice;
    const walkId = await legacyWalk(userId);

    await scope(userId, getDb()).insert(schema.workoutLogs, {
      date: "2026-03-02",
      workoutId: walkId,
      status: "done",
      durationMin: 40,
    });

    await runMigration();

    const logs = await scope(userId, getDb()).select(
      schema.workoutLogs,
      eq(schema.workoutLogs.workoutId, walkId),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]!.durationMin).toBe(40);
  });

  it("adds the afternoon walk, and only one of it", async () => {
    const { userId } = fixture.alice;

    await legacyWalk(userId);
    await runMigration();

    expect((await walksOf(userId)).map((walk) => walk.name)).toEqual([
      "Afternoon Walk",
      "Morning Walk",
    ]);
  });

  it("schedules it on exactly the days the morning walk is scheduled on", async () => {
    // Not on all seven unconditionally. The template is editable, and a user
    // who took their walk off Sunday has said something this migration must not
    // overrule — so the new entries are derived from the existing ones.
    const { userId } = fixture.alice;
    const owned = scope(userId, getDb());

    const [walk] = await owned.insert(schema.workouts, {
      name: "Daily Walk",
      type: "walk",
    });

    await owned.insert(
      schema.trainingTemplateEntries,
      [1, 2, 3].map((dayOfWeek) => ({ dayOfWeek, workoutId: walk!.id, sortOrder: 1 })),
    );

    await runMigration();

    const afternoon = (await walksOf(userId)).find(
      (row) => row.name === "Afternoon Walk",
    );

    const entries = await owned.select(
      schema.trainingTemplateEntries,
      eq(schema.trainingTemplateEntries.workoutId, afternoon!.id),
    );

    expect(entries.map((entry) => entry.dayOfWeek).sort()).toEqual([1, 2, 3]);
    // After the session at 0 and the morning walk at 1, which is where it
    // happens and the order every reader takes as the template's.
    expect(entries.every((entry) => entry.sortOrder === 2)).toBe(true);
  });

  it("does nothing on a second run", async () => {
    // The file's own idempotence claim. A re-run that inserted a second
    // afternoon walk would be two identical rows nobody could tell apart, on a
    // day that then held three walks.
    const { userId } = fixture.alice;

    await legacyWalk(userId);
    await runMigration();
    await runMigration();

    const walks = await walksOf(userId);
    const entries = await scope(userId, getDb()).select(
      schema.trainingTemplateEntries,
    );

    expect(walks).toHaveLength(2);
    // Seven for each walk, and nothing else: the fixture's own template row
    // names a rotation group rather than a workout, so it is counted here too.
    expect(entries.filter((entry) => entry.workoutId !== null)).toHaveLength(14);
  });

  it("leaves a database that already has two walks alone", async () => {
    // An account seeded after this change. The guard is a count of the user's
    // own walks, so the migration cannot rename a walk somebody has already
    // named, and cannot give a third one to a day that holds two.
    const { userId } = fixture.alice;
    const owned = scope(userId, getDb());

    for (const name of ["Morning Walk", "Afternoon Walk"]) {
      await owned.insert(schema.workouts, { name, type: "walk" });
    }

    await runMigration();

    expect(await walksOf(userId)).toHaveLength(2);
  });

  it("touches nobody else's rows", async () => {
    // Every statement is keyed by `user_id` — the migration runs unscoped, so
    // this is the one place that can be asserted. Alice has the legacy shape
    // and Bob has no walk at all; Bob must come out of it with no walk at all.
    await legacyWalk(fixture.alice.userId);

    await runMigration();

    expect(await walksOf(fixture.bob.userId)).toEqual([]);
  });
});
