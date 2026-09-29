import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import {
  loadSchedule,
  loadSettings,
  saveSchedule,
  saveTargets,
} from "@/lib/db/queries/profile";
import type { ProfileTargets } from "@/lib/profile-targets";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { demoProfile } from "@/lib/seed/persona";

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
  /*
   * FUEL-136. The persona's figures as the update, so every value written here
   * is one the metrics scan already accepts — and they differ from the
   * fixture's in every target, so a save of them is a recalibration.
   */
  describe("saveTargets", () => {
    const persona = demoProfile(new Date("2026-06-17T12:00:00Z"));

    const SAM: ProfileTargets = {
      targetKcal: persona.targetKcal,
      targetProteinG: persona.targetProteinG,
      targetFatG: persona.targetFatG,
      targetCarbG: persona.targetCarbG,
      startWeightKg: persona.startWeightKg,
      targetWeightKg: persona.targetWeightKg,
      goalPaceKgPerWeek: persona.goalPaceKgPerWeek,
      heightCm: persona.heightCm,
      timezone: persona.timezone,
    };

    // 12:30 UTC on the 20th: still the 20th in London, already 00:30 on the
    // 21st in Auckland (NZST, before its DST starts on the 27th). The two zones
    // disagree about the date, which is what proves it is taken in the zone
    // being saved.
    const NOW = new Date("2026-09-20T12:30:00Z");

    async function changedOn(userId: string) {
      const row = await scope(userId, getDb()).selectOne(schema.profiles);

      return row?.targetsChangedOn;
    }

    it("writes every field, and reads back through loadSettings unchanged", async () => {
      expect(await saveTargets(fixture.alice.userId, SAM, NOW)).toBe(true);

      expect((await loadSettings(fixture.alice.userId))?.targets).toEqual(SAM);
    });

    it("dates a recalibration in the zone being saved", async () => {
      await saveTargets(fixture.alice.userId, { ...SAM, timezone: "Pacific/Auckland" }, NOW);

      expect(await changedOn(fixture.alice.userId)).toBe("2026-09-21");
    });

    it("leaves the date alone when no target moved", async () => {
      await saveTargets(fixture.alice.userId, SAM, NOW);

      // A week later: only the height and the start weight change.
      await saveTargets(
        fixture.alice.userId,
        { ...SAM, heightCm: SAM.heightCm + 1, startWeightKg: SAM.startWeightKg + 1 },
        new Date("2026-09-27T12:00:00Z"),
      );

      expect(await changedOn(fixture.alice.userId)).toBe("2026-09-20");
    });

    it("is null until the app changes a target", async () => {
      expect(await changedOn(fixture.alice.userId)).toBeNull();
    });

    it("leaves every other user's profile untouched", async () => {
      const before = await loadSettings(fixture.alice.userId);

      await saveTargets(fixture.bob.userId, SAM, NOW);

      expect(await loadSettings(fixture.alice.userId)).toEqual(before);
      expect(await changedOn(fixture.alice.userId)).toBeNull();
    });

    it("reports false for a user with no profile rather than creating one", async () => {
      await scope(fixture.bob.userId, getDb()).delete(schema.profiles);

      expect(await saveTargets(fixture.bob.userId, SAM, NOW)).toBe(false);
      expect(await loadSettings(fixture.bob.userId)).toBeUndefined();
    });
  });
});
