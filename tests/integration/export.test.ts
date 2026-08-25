import { describe, expect, it, beforeEach } from "vitest";

import { getDb } from "@/lib/db";
import { loadExport } from "@/lib/db/queries/export";
import { buildExport } from "@/lib/export";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * The export, scoped — **Testing Strategy § 1.4 case 3**, which FUEL-37 names.
 *
 * "Demo session exports → export contains demo data only." It is the case the
 * PRD makes to strangers on a public URL, and the one this feature could break
 * most quietly: an export is the single request in the app that reads EVERY
 * table at once, so one unscoped statement among eleven leaks a whole account
 * and the file still downloads, still parses, and still looks correct.
 *
 * ## Why this is here rather than in the hermetic suite
 *
 * `lib/export.test.ts` asserts what the document contains, against values. It
 * cannot assert this, because scoping is not a property of the shaping — it is
 * a property of the eleven SQL statements underneath, and the only way to know
 * Postgres agrees is to ask Postgres. `scope.test.ts` proves the predicate is
 * in every statement the scope builds; this proves the export uses the scope
 * for all eleven of the tables it reads.
 *
 * ## The assertion is two-sided on purpose
 *
 * "Bob's export contains none of Alice's rows" passes trivially against an
 * export that returns nothing at all — and would keep passing after a
 * regression that emptied it. So every table is asserted non-empty for its
 * owner first. `fixtures.ts` seeds a row in every user-owned table for exactly
 * this reason, and says so: "an empty table cannot leak, so the assertion would
 * pass vacuously".
 */

const configured = testDatabaseUrl() !== undefined;

describe.skipIf(!configured)("the export, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Every array in a built document, by key. */
  async function documentFor(userId: string) {
    const payload = await loadExport(userId, new Date());

    if (!payload) throw new Error("expected a payload for a seeded user");

    return buildExport({
      account: payload.account,
      exportedAt: new Date("2026-03-10T00:00:00.000Z"),
      tables: payload.tables,
    });
  }

  it("gives a demo session its own rows in every table", async () => {
    // The positive half, and it is what stops the isolation assertions below
    // from passing against an export that had quietly stopped working.
    const document = await documentFor(fixture.bob.userId);

    expect(document.account.id).toBe(fixture.bob.userId);
    expect(document.account.kind).toBe("demo");
    expect(document.profile).toBeDefined();

    for (const key of [
      "meals",
      "mealIngredients",
      "planTemplateEntries",
      "dayPlanOverrides",
      "mealLogs",
      "workouts",
      "workoutExercises",
      "trainingTemplateEntries",
      "workoutLogs",
      "weightLogs",
    ] as const) {
      expect(document[key].length, `${key} should not be empty`).toBeGreaterThan(0);
    }

    // Not a table — the derived section — so it is asserted apart from the
    // loop. It is here at all because its claim is about coverage: PRD
    // § Success Metrics wants planned-versus-actual for 100% of logged days,
    // and the fixture has both a log and a swap. An empty section against a
    // real database would mean the resolution found no plan to compare to.
    expect(document.derived.planVsActual.length).toBeGreaterThan(0);

    const compared = new Set(document.derived.planVsActual.map((row) => row.date));

    for (const log of document.mealLogs) {
      expect(compared, `${log.date} was logged but not compared`).toContain(log.date);
    }
  });

  it("gives a demo session none of the owner's rows", async () => {
    // § 1.4 case 3. Asserted by ID rather than by count: a count says the sizes
    // match, which two accounts of the same shape do anyway. The ids are what
    // say WHOSE rows these are.
    const document = await documentFor(fixture.bob.userId);

    expect(document.meals.map((row) => row.id)).toEqual([fixture.bob.mealId]);
    expect(document.meals.map((row) => row.id)).not.toContain(fixture.alice.mealId);
    expect(document.workouts.map((row) => row.id)).toEqual([fixture.bob.workoutId]);
    expect(document.workouts.map((row) => row.id)).not.toContain(fixture.alice.workoutId);

    // The rows that POINT at a meal or workout, which is the other way an
    // account's data could arrive: a log of Bob's naming Alice's meal.
    for (const row of [
      ...document.mealLogs,
      ...document.dayPlanOverrides,
      ...document.planTemplateEntries,
      ...document.mealIngredients,
    ]) {
      expect(row.mealId).toBe(fixture.bob.mealId);
    }

    for (const row of [...document.workoutLogs, ...document.workoutExercises]) {
      expect(row.workoutId).toBe(fixture.bob.workoutId);
    }

    // The dates are seeded distinct per user, so a leaked weigh-in is visible
    // as a date Bob never recorded.
    expect(document.weightLogs.map((row) => row.date)).toEqual([fixture.bob.weighInDate]);
    expect(document.weightLogs.map((row) => row.date)).not.toContain(
      fixture.alice.weighInDate,
    );
  });

  it("carries the owner's id nowhere in the demo session's file", async () => {
    // The sweep the per-table assertions above cannot make: not "is Alice's id
    // in the field I thought to check", but "is it anywhere in the bytes at
    // all". A column added to a table later arrives in the export on its own —
    // `withoutUser` spreads rather than lists — so a future foreign key
    // pointing at another account would be caught here and by nothing else.
    const text = JSON.stringify(await documentFor(fixture.bob.userId));

    expect(text).not.toContain(fixture.alice.userId);
    expect(text).not.toContain(fixture.alice.mealId);
    expect(text).not.toContain(fixture.alice.workoutId);
  });

  it("gives the owner their own rows, not the demo session's", async () => {
    // The same isolation from the other side. Without it, an export that
    // returned only the FIRST user's rows whoever asked would pass every
    // assertion above.
    const text = JSON.stringify(await documentFor(fixture.alice.userId));

    expect(text).not.toContain(fixture.bob.userId);
    expect(text).not.toContain(fixture.bob.mealId);
    expect(text).toContain(fixture.alice.mealId);
  });

  it("stamps the file with the date in the user's own zone", async () => {
    // P6's dated filename. The date comes from `profiles.timezone` rather than
    // the server's clock, which is the rule every dated thing in this app keeps.
    // A summer instant, deliberately. The fixture seeds Europe/London, which is
    // on GMT through March and therefore agrees with UTC — a March instant here
    // would assert nothing, because both answers would be the same date. In
    // July, London is an hour ahead, so 23:30Z is already the next day there.
    const payload = await loadExport(fixture.alice.userId, new Date("2026-07-09T23:30:00Z"));

    expect(payload?.today).toBe("2026-07-10");
  });

  it("answers undefined for a user with no profile row", async () => {
    // The contract every reader in this app keeps, and what the route turns
    // into a 404 rather than a file named from the server's clock.
    const missing = await loadExport("00000000-0000-4000-8000-000000000000", new Date());

    expect(missing).toBeUndefined();
  });
});
