import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { deleteLog, logsFor, recordLog } from "@/lib/db/queries/log";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { latestLog } from "@/lib/log-intent";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * P1's write path against a real Postgres — FUEL-19.
 *
 * `src/app/actions/log.test.ts` proves the action derives the right row and
 * refuses the wrong caller, with every collaborator mocked. That is a claim
 * about control flow. This file proves the statements underneath it do what the
 * claim assumes once Postgres executes them: a log written for one user is
 * invisible to another, and one user's undo cannot remove another's row.
 *
 * That is the § Security promise — "every query is scoped by `user_id` at the
 * data-access layer, with an automated test asserting a demo session cannot read
 * owner rows" — applied to the first WRITE path the app has. scope.test.ts makes
 * the general argument over all twelve tables; this makes it over the two
 * functions P1 actually calls, which is where a future edit would break it.
 */

const configured = testDatabaseUrl() !== undefined;

describe.skipIf(!configured)("logging, scoped", () => {
  const as = (user: { userId: string }) => scope(user.userId, getDb());

  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  describe("recordLog", () => {
    it("writes the row as the user it was called for", async () => {
      const { alice } = fixture;

      await recordLog(alice.userId, {
        kind: "meal",
        date: "2026-03-09",
        slot: "lunch",
        mealId: alice.mealId,
        status: "eaten",
      });

      const rows = await as(alice).select(schema.mealLogs);
      const written = rows.find((row) => row.date === "2026-03-09");

      expect(written).toMatchObject({ slot: "lunch", status: "eaten", userId: alice.userId });
      // Left to the column's own default, so the database's clock is what
      // orders the day for undo.
      expect(written?.loggedAt).toBeInstanceOf(Date);
    });

    it("writes a session log the same way", async () => {
      const { alice } = fixture;

      await recordLog(alice.userId, {
        kind: "workout",
        date: "2026-03-09",
        workoutId: alice.workoutId,
        status: "skipped",
      });

      const rows = await as(alice).select(schema.workoutLogs);

      expect(rows.find((row) => row.date === "2026-03-09")).toMatchObject({
        status: "skipped",
        userId: alice.userId,
      });
    });

    it("cannot file a log against another user's meal", async () => {
      // The composite foreign key `(meal_id, user_id)`, doing the job the
      // schema built it for: `user_id` comes from the scope and cannot be
      // named, so a meal id belonging to someone else has no matching pair to
      // reference. Postgres refuses it — no application check involved.
      const { alice, bob } = fixture;

      await expect(
        recordLog(bob.userId, {
          kind: "meal",
          date: "2026-03-09",
          slot: "lunch",
          mealId: alice.mealId,
          status: "eaten",
        }),
      ).rejects.toThrow();
    });
  });

  describe("logsFor", () => {
    it("returns only the caller's logs, on the date asked for", async () => {
      const { alice, bob } = fixture;

      await recordLog(alice.userId, {
        kind: "meal",
        date: "2026-03-09",
        slot: "lunch",
        mealId: alice.mealId,
        status: "eaten",
      });
      await recordLog(bob.userId, {
        kind: "meal",
        date: "2026-03-09",
        slot: "lunch",
        mealId: bob.mealId,
        status: "eaten",
      });

      const mine = await logsFor(alice.userId, "2026-03-09");

      expect(mine.meals).toHaveLength(1);
      expect(mine.meals[0]?.userId).toBe(alice.userId);
      expect(mine.workouts).toHaveLength(0);
    });

    it("does not reach another day", async () => {
      const { alice } = fixture;

      await recordLog(alice.userId, {
        kind: "meal",
        date: "2026-03-09",
        slot: "lunch",
        mealId: alice.mealId,
        status: "eaten",
      });

      expect((await logsFor(alice.userId, "2026-03-10")).meals).toHaveLength(0);
    });
  });

  describe("deleteLog", () => {
    it("removes the caller's own log and says so", async () => {
      const { alice } = fixture;

      await recordLog(alice.userId, {
        kind: "meal",
        date: "2026-03-09",
        slot: "lunch",
        mealId: alice.mealId,
        status: "eaten",
      });

      const target = latestLog(await logsFor(alice.userId, "2026-03-09"));

      expect(target).not.toBeNull();
      expect(await deleteLog(alice.userId, target!)).toBe(true);
      expect((await logsFor(alice.userId, "2026-03-09")).meals).toHaveLength(0);
    });

    it("cannot remove another user's log, even holding its id", async () => {
      // The whole reason undo names a row rather than trusting one: the id
      // travels no further than the server, but if it ever did, this is what
      // stops it deleting someone else's history. "Not yours" and "not there"
      // are the same answer — `false`, not a 403.
      const { alice, bob } = fixture;

      await recordLog(alice.userId, {
        kind: "meal",
        date: "2026-03-09",
        slot: "lunch",
        mealId: alice.mealId,
        status: "eaten",
      });

      const target = latestLog(await logsFor(alice.userId, "2026-03-09"))!;

      expect(await deleteLog(bob.userId, target)).toBe(false);
      expect((await logsFor(alice.userId, "2026-03-09")).meals).toHaveLength(1);
    });

    it("is false for a log that has already gone", async () => {
      // Another tab got there first. The action reads this to decide whether to
      // step the view back, so it must not report a delete that did nothing.
      const { alice } = fixture;

      await recordLog(alice.userId, {
        kind: "workout",
        date: "2026-03-09",
        workoutId: alice.workoutId,
        status: "done",
      });

      const target = latestLog(await logsFor(alice.userId, "2026-03-09"))!;

      expect(await deleteLog(alice.userId, target)).toBe(true);
      expect(await deleteLog(alice.userId, target)).toBe(false);
    });
  });
});

describe.skipIf(configured)("logging, scoped (unconfigured)", () => {
  it.skip("needs DATABASE_URL_TEST — see README → Database", () => {});
});
