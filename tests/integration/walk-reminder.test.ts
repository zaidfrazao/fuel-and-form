import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { loadWalkReminder } from "@/lib/db/queries/walk-reminder";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * Whether the walk reminder shows, against a real Postgres — FUEL-46, § P9.
 *
 * `walk-reminder.test.ts` in `src/lib` proves the comparison and the copy with
 * nothing mocked; this proves the five things that decide whether that
 * comparison is ever reached, and every one of them is a question about rows:
 * the reminder's own column, the program's start date, the template's weekday,
 * today's log, and whose rows any of it read.
 *
 * ## Why the timezone case is here and not in jsdom
 *
 * Because it is the failure the PRD names first — "day boundary respects the
 * configured timezone, not the server's" — and the way it fails is a banner
 * that appears on the right screen at the wrong hour. The suite runs in
 * America/New_York (see vitest.config.mts), the fixture's profile is
 * Europe/London, and the two disagree by five hours, so a reminder resolved
 * against the ambient zone reads back a different answer here than in
 * production.
 *
 * The fixture's own date, 2026-03-02, is a Monday in GMT — before British
 * Summer Time begins — so London and UTC agree that day and the instants below
 * mean what they say.
 */

const configured = testDatabaseUrl() !== undefined;

/** The fixture's Monday. Its template already trains a session on this weekday. */
const MONDAY = "2026-03-02";

const at = (time: string) => new Date(`${MONDAY}T${time}:00.000Z`);

/**
 * Gives a user a walk, on the weekdays named.
 *
 * A fixed `workout_id` rather than a rotation group, which is what the seed does
 * and what the query relies on: there is nothing for the walk to alternate with,
 * so no rotation has to be resolved to know a date holds one.
 */
async function seedWalk(userId: string, days: number[]): Promise<string> {
  const owned = scope(userId, getDb());

  const [walk] = await owned.insert(schema.workouts, {
    name: "Daily walk",
    type: "walk",
  });

  if (!walk) throw new Error("Fixture insert of the walk returned no row.");

  for (const dayOfWeek of days) {
    await owned.insert(schema.trainingTemplateEntries, {
      dayOfWeek,
      workoutId: walk.id,
      sortOrder: 1,
    });
  }

  return walk.id;
}

describe.skipIf(!configured)("the walk reminder, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  describe("the reminder's own setting", () => {
    it("defaults to 19:00 on a profile that never named it", async () => {
      // The fixture's insert does not carry the column, so this is the
      // migration's `DEFAULT '19:00'` arriving through a real round trip —
      // which is what makes the feature on by default rather than dormant.
      await seedWalk(fixture.alice.userId, [1]);

      const reminder = await loadWalkReminder(fixture.alice.userId, at("19:00"));

      expect(reminder).toEqual({ at: "19:00" });
    });

    it("shows nothing all evening when the reminder is switched off", async () => {
      // P9's "the reminder can be disabled entirely" — a `null` column and no
      // second flag that could disagree with it.
      await seedWalk(fixture.alice.userId, [1]);
      await scope(fixture.alice.userId, getDb()).update(schema.profiles, {
        walkReminderAt: null,
      });

      expect(await loadWalkReminder(fixture.alice.userId, at("23:30"))).toBeUndefined();
    });

    it("honours a time the user moved it to", async () => {
      await seedWalk(fixture.alice.userId, [1]);
      await scope(fixture.alice.userId, getDb()).update(schema.profiles, {
        walkReminderAt: "21:30",
      });

      expect(await loadWalkReminder(fixture.alice.userId, at("21:29"))).toBeUndefined();
      expect(await loadWalkReminder(fixture.alice.userId, at("21:30"))).toEqual({
        at: "21:30",
      });
    });

    it("refuses to store a time the app would not be able to read", async () => {
      // The CHECK the column carries, and the reason `walk-reminder.ts` can
      // print the stored value straight into a sentence. `slot_times` is jsonb
      // with no constraint behind it and cannot make this promise.
      const write = scope(fixture.alice.userId, getDb()).update(schema.profiles, {
        walkReminderAt: "7pm",
      });

      await expect(write).rejects.toThrow();
    });

    it("is undefined for a user with no profile row", async () => {
      await scope(fixture.bob.userId, getDb()).delete(schema.profiles);

      expect(await loadWalkReminder(fixture.bob.userId, at("20:00"))).toBeUndefined();
    });
  });

  describe("the clock", () => {
    beforeEach(async () => {
      await seedWalk(fixture.alice.userId, [0, 1, 2, 3, 4, 5, 6]);
    });

    it("shows nothing a minute before the reminder time", async () => {
      expect(await loadWalkReminder(fixture.alice.userId, at("18:59"))).toBeUndefined();
    });

    it("shows from the reminder time until the end of the day", async () => {
      expect(await loadWalkReminder(fixture.alice.userId, at("19:00"))).toBeDefined();
      expect(await loadWalkReminder(fixture.alice.userId, at("23:59"))).toBeDefined();
    });

    it("reads the hour in the user's zone, not the server's", async () => {
      // The § P1 criterion the PRD names first, applied to this feature. The
      // instant below is 23:30 in London — the reminder is due — and 18:30 in
      // New York, which is where this process's clock is. A resolver that read
      // the ambient zone would answer "not yet" and the assertion would fail
      // here while passing in production, or the other way about.
      await scope(fixture.alice.userId, getDb()).update(schema.profiles, {
        timezone: "Pacific/Auckland",
      });

      // 23:30 UTC on the Monday is 12:30 on TUESDAY in Auckland — a new day,
      // whose walk has the whole of it left to be logged in.
      expect(await loadWalkReminder(fixture.alice.userId, at("23:30"))).toBeUndefined();

      // And 06:30 UTC is 19:30 the same evening there.
      expect(await loadWalkReminder(fixture.alice.userId, at("06:30"))).toBeDefined();
    });

    it("shows nothing on a date before the program began", async () => {
      // `resolveTraining` renders such a date as an empty day, so a reminder
      // there would be nagging about a walk no screen in the app shows.
      const beforeStart = new Date("2026-01-04T20:00:00.000Z");

      expect(
        await loadWalkReminder(fixture.alice.userId, beforeStart),
      ).toBeUndefined();
    });
  });

  describe("the day's plan", () => {
    it("shows nothing for a user whose library holds no walk", async () => {
      // The fixture seeds a circuit and nothing else. An account that has never
      // been set up is not one to nag.
      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeUndefined();
    });

    it("shows nothing on a weekday the template trains no walk", async () => {
      // A walk in the library, scheduled on Tuesdays only. The banner is about
      // a walk that was planned, not about walking in general.
      await seedWalk(fixture.alice.userId, [2]);

      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeUndefined();
    });

    it("ignores a template row that names a rotation group", async () => {
      // The fixture's own Monday entry is one. A row with a null `workout_id`
      // is a session's, never the walk's, and must not be mistaken for one.
      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeUndefined();
    });
  });

  describe("dismisses on log", () => {
    let walkId: string;

    beforeEach(async () => {
      walkId = await seedWalk(fixture.alice.userId, [1]);
    });

    it("shows while the walk has no row", async () => {
      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeDefined();
    });

    it("stops as soon as the walk is logged", async () => {
      await scope(fixture.alice.userId, getDb()).insert(schema.workoutLogs, {
        date: MONDAY,
        workoutId: walkId,
        status: "done",
      });

      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeUndefined();
    });

    it("comes back if the log is taken away again", async () => {
      const owned = scope(fixture.alice.userId, getDb());

      await owned.insert(schema.workoutLogs, {
        date: MONDAY,
        workoutId: walkId,
        status: "done",
      });
      await owned.delete(schema.workoutLogs);

      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeDefined();
    });

    it("is not satisfied by yesterday's walk", async () => {
      // The one that would look right for a day and then be wrong forever: a
      // query missing its date predicate reads any walk ever logged as today's.
      await scope(fixture.alice.userId, getDb()).insert(schema.workoutLogs, {
        date: "2026-02-23",
        workoutId: walkId,
        status: "done",
      });

      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeDefined();
    });

    it("is not satisfied by the day's SESSION being logged", async () => {
      // The fixture already logs Alice's circuit on this date. The walk and the
      // session share a day and are different rows — `adherence.ts` makes the
      // same distinction — so a query matching on date alone would call the
      // walk done because the circuit was.
      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeDefined();
    });
  });

  describe("isolation", () => {
    it("is not satisfied by another user's logged walk", async () => {
      // § 1.4, on this read path. Both users get a walk on the same weekday and
      // only Bob logs his; a query whose date predicate outran its scope would
      // let a demo visitor's tap silence the owner's reminder.
      await seedWalk(fixture.alice.userId, [1]);
      const bobsWalk = await seedWalk(fixture.bob.userId, [1]);

      await scope(fixture.bob.userId, getDb()).insert(schema.workoutLogs, {
        date: MONDAY,
        workoutId: bobsWalk,
        status: "done",
      });

      expect(await loadWalkReminder(fixture.alice.userId, at("20:00"))).toBeDefined();
      expect(await loadWalkReminder(fixture.bob.userId, at("20:00"))).toBeUndefined();
    });

    it("reads each user's own reminder time", async () => {
      await seedWalk(fixture.alice.userId, [1]);
      await seedWalk(fixture.bob.userId, [1]);

      await scope(fixture.bob.userId, getDb()).update(schema.profiles, {
        walkReminderAt: "17:00",
      });

      expect(await loadWalkReminder(fixture.alice.userId, at("17:30"))).toBeUndefined();
      expect(await loadWalkReminder(fixture.bob.userId, at("17:30"))).toEqual({
        at: "17:00",
      });
    });
  });
});
