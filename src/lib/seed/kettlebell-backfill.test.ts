import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  swingExercisesValuesSql,
  swingWorkout,
  swingWorkoutValuesSql,
} from "./kettlebell-backfill";

/**
 * FUEL-130 — the migration and the seed say the same thing about Tuesday.
 *
 * `drizzle/0019` carries the swing session as SQL literals, because a
 * migration cannot import the seed. This is what stops them drifting: the
 * seed is edited, this fails, and the fix is a new migration rather than an
 * owner and a demo who disagree about the session. `shop-backfill.test.ts`
 * is the same guard for FUEL-137.
 */

const MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../drizzle/0019_kettlebell_swings.sql"),
  "utf8",
);

describe("drizzle/0019", () => {
  it("writes exactly the seed's swing workout", () => {
    expect(MIGRATION).toContain(`(VALUES\n${swingWorkoutValuesSql()}\n) AS v(`);
  });

  it("writes exactly the seed's swing exercises", () => {
    expect(MIGRATION).toContain(`(VALUES\n${swingExercisesValuesSql()}\n) AS x(`);
  });

  it("matches the workout by the name and type the seed gives it", () => {
    const { name, type } = swingWorkout();

    expect(MIGRATION).toContain(`k."type" = '${type}'`);
    expect(MIGRATION).toContain(`k."name" = '${name}'`);
  });

  it("deletes and renames nothing", () => {
    // The history criterion: the skipping workout keeps its row and its name.
    expect(MIGRATION).not.toMatch(/\bDELETE\b/i);
    expect(MIGRATION).not.toMatch(/SET\s+"name"/i);
  });
});

describe("the literals", () => {
  it("double a quote rather than ending the string on it", () => {
    // "child's pose" is in the shared cool-down the session keeps.
    expect(swingExercisesValuesSql()).toContain("child''s pose");
  });

  it("refuse a session that names form media, which 0019 cannot write", () => {
    const workout = swingWorkout();
    const withMedia = {
      ...workout,
      exercises: [{ ...workout.exercises[0]!, mediaKey: "squat" }],
    };

    expect(() => swingExercisesValuesSql(withMedia)).toThrow(/names form media/);
  });

  it("refuse a seed with no swing session", () => {
    expect(() => swingWorkout([])).toThrow(/no kettlebell-swings/);
  });
});
