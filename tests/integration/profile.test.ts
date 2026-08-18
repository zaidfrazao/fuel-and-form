import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { loadSchedule, saveSchedule } from "@/lib/db/queries/profile";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * Settings' data layer against a real Postgres — FUEL-21.
 *
 * The same division log.test.ts describes: `slot-times.test.ts` proves the
 * parser refuses what it should with nothing mocked at all, and this proves the
 * two statements underneath do what that claim assumes once Postgres runs them.
 *
 * Three things are only true here rather than in jsdom. That a `null` survives a
 * round trip through a `jsonb` column as a JSON null rather than arriving back
 * as the string "null" or as an absent key — which is the whole distinction
 * `scheduleFor` acts on. That the merge preserves keys the update did not name.
 * And that a demo visitor editing settings cannot reach the owner's profile,
 * which is the § Security promise applied to this write path.
 */

const configured = testDatabaseUrl() !== undefined;

describe.skipIf(!configured)("the profile schedule, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  describe("loadSchedule", () => {
    it("returns the caller's own times", async () => {
      const schedule = await loadSchedule(fixture.alice.userId);

      expect(schedule?.slotTimes).toEqual({ breakfast: "07:30", dinner: "19:00" });
      expect(schedule?.timezone).toBe("Europe/London");
    });

    it("starts workout_times empty rather than null — the column's default", async () => {
      // The migration added the column with `DEFAULT '{}'`, and the fixture's
      // insert does not name it. `scheduleFor` reads an absent key as "not
      // configured" and defaults it; a null here would reach `Object.entries`
      // and throw instead.
      const schedule = await loadSchedule(fixture.alice.userId);

      expect(schedule?.workoutTimes).toEqual({});
    });

    it("is undefined for a user with no profile row", async () => {
      const stranger = await scope(fixture.bob.userId, getDb()).delete(schema.profiles);

      expect(stranger).toHaveLength(1);
      expect(await loadSchedule(fixture.bob.userId)).toBeUndefined();
    });
  });

  describe("saveSchedule", () => {
    it("writes the submitted times", async () => {
      const saved = await saveSchedule(fixture.alice.userId, {
        slotTimes: { lunch: "12:30" },
        workoutTimes: { circuit: "06:30" },
      });

      expect(saved).toBe(true);
      expect((await loadSchedule(fixture.alice.userId))?.slotTimes.lunch).toBe("12:30");
      expect((await loadSchedule(fixture.alice.userId))?.workoutTimes.circuit).toBe("06:30");
    });

    it("round-trips a cleared slot as a JSON null, not as a string", async () => {
      // The case the whole three-state design rests on, and the one a jsdom test
      // cannot make: `jsonb` has its own null, and a driver that stringified it
      // would hand back "null" — which is truthy, is not `=== null`, and would
      // therefore be treated as a TIME and thrown on by `parseTimeOfDay`.
      await saveSchedule(fixture.alice.userId, {
        slotTimes: { dinner: null },
        workoutTimes: {},
      });

      const schedule = await loadSchedule(fixture.alice.userId);

      expect(schedule?.slotTimes.dinner).toBeNull();
      expect("dinner" in schedule!.slotTimes).toBe(true);
    });

    it("merges rather than replacing, so an unnamed slot survives", async () => {
      // The form posts the fields it renders. A wholesale replace would drop a
      // slot the form does not yet have a row for.
      await saveSchedule(fixture.alice.userId, {
        slotTimes: { lunch: "12:30" },
        workoutTimes: {},
      });

      const schedule = await loadSchedule(fixture.alice.userId);

      expect(schedule?.slotTimes.breakfast).toBe("07:30");
      expect(schedule?.slotTimes.dinner).toBe("19:00");
    });

    it("leaves every other user's schedule untouched", async () => {
      // § Security, on the app's second write path: a demo visitor saving
      // settings rewrites their own profile or none.
      await saveSchedule(fixture.bob.userId, {
        slotTimes: { breakfast: "04:00" },
        workoutTimes: { circuit: "04:00" },
      });

      const alice = await loadSchedule(fixture.alice.userId);

      expect(alice?.slotTimes.breakfast).toBe("07:30");
      expect(alice?.workoutTimes).toEqual({});
    });

    it("reports false for a user with no profile rather than creating one", async () => {
      // A profile carries height, weight and macro targets settings has no
      // values for. Inventing them to satisfy a time change would be worse.
      await scope(fixture.bob.userId, getDb()).delete(schema.profiles);

      const saved = await saveSchedule(fixture.bob.userId, {
        slotTimes: { lunch: "12:30" },
        workoutTimes: {},
      });

      expect(saved).toBe(false);
      expect(await loadSchedule(fixture.bob.userId)).toBeUndefined();
    });
  });
});
