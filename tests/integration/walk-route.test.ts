import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { loadWalkRoute, nameWalkRoute, routedLogIds } from "@/lib/db/queries/route";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { reduceTrackPrecision, type Track } from "@/lib/route";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * One walk's route, against a real Postgres — FUEL-102, PRD § P11.
 *
 * ## Why this file exists rather than trusting the unit tests
 *
 * PRD § P11 opens with what makes this data different: "a trace of a
 * twice-daily walk starts and ends at the front door, repeats, and is
 * timestamped; ten of them identify a home address to anyone who reads them."
 * Testing Strategy § 1.4 case 3 asks whether one user's data can reach another,
 * and every previous answer has been given against `scope()`, which prepends
 * `user_id` to every statement it builds.
 *
 * **`routedLogIds` is the one query in this feature that does NOT go through
 * `scope()`**, and it is the whole reason for this file. It selects a single
 * column — `workout_log_id`, never the point array — precisely so the schema's
 * rule that geometry stays out of list queries survives the row needing to know
 * whether a trace exists at all. It therefore carries its own two `user_id`
 * predicates instead of inheriting one, and a claim like that is worth a
 * database rather than a reading.
 *
 * The unit suite cannot ask this: it mocks the database, so a query missing a
 * `user_id` predicate passes there exactly as one carrying it does.
 *
 * ## Every case plants a positive first
 *
 * A query returning nothing to anybody would satisfy every "cannot see the
 * other user's row" assertion here. So each case asserts the OWNER's own row
 * comes back before asserting the stranger's does not.
 *
 * ## The fixture already carries a trace per user, and this file uses it
 *
 * `fixtures.ts` seeds one `walk_routes` row for each user, its geometry derived
 * from the user's name length so no two can be confused and no coordinate is
 * written down. Inserting a second route against the same log is what
 * `walk_routes_user_log_key` exists to refuse — an earlier draft of this file
 * did exactly that and the unique index caught it.
 */

const configured = Boolean(testDatabaseUrl());

/** The fixture's dates, restated so a reader need not open that file. */
const ALICE_DATE = "2026-03-02";
const BOB_DATE = "2026-03-03";
/** A second date for Alice — the later walk that gets offered a name. */
const LATER_DATE = "2026-03-10";

describe.skipIf(!configured)("one walk's route, across users", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Drop a user's seeded trace, for the cases about a walk that has none. */
  const removeRoute = (userId: string, workoutLogId: string) =>
    scope(userId, getDb()).delete(
      schema.walkRoutes,
      eq(schema.walkRoutes.workoutLogId, workoutLogId),
    );

  /** The geometry the fixture stored for a user. */
  async function traceOf(user: Fixture["alice"], date: string): Promise<Track> {
    const loaded = await loadWalkRoute(user.userId, date, user.workoutId);

    expect(loaded).not.toBeNull();

    return loaded!.points;
  }

  describe("routedLogIds — the one query that does not use scope()", () => {
    it("finds the owner's own trace", async () => {
      // The planted positive. Without it, every assertion below would pass on a
      // query that returned nothing to anybody.
      expect([...(await routedLogIds(fixture.alice.userId, ALICE_DATE))]).toEqual([
        fixture.alice.workoutLogId,
      ]);
    });

    it("never returns a stranger's trace, even asked for their date", async () => {
      // Bob asking about ALICE's date. The date predicate alone would return her
      // log id, so this is precisely what the outer `user_id` predicate is for.
      expect([...(await routedLogIds(fixture.bob.userId, ALICE_DATE))]).toEqual([]);

      // And Bob asking about his own date gets his own row and only his own.
      expect([...(await routedLogIds(fixture.bob.userId, BOB_DATE))]).toEqual([
        fixture.bob.workoutLogId,
      ]);
    });

    it("returns nothing for a walk logged with no route", async () => {
      await removeRoute(fixture.alice.userId, fixture.alice.workoutLogId);

      // The log is still there — this is a walk logged in one tap. The row must
      // draw a plain figures line rather than a control opening an empty sheet.
      expect([...(await routedLogIds(fixture.alice.userId, ALICE_DATE))]).toEqual([]);
    });
  });

  describe("loadWalkRoute", () => {
    it("reads the owner's own geometry back", async () => {
      const loaded = await loadWalkRoute(
        fixture.alice.userId,
        ALICE_DATE,
        fixture.alice.workoutId,
      );

      expect(loaded?.points.flat().length).toBeGreaterThan(0);
      expect(loaded?.name).toBeNull();
    });

    it("hands a stranger nothing for a walk that is not theirs", async () => {
      // Alice's date AND Alice's workout, asked for by Bob. Null rather than a
      // refusal, so "not yours" and "not there" stay indistinguishable.
      expect(
        await loadWalkRoute(fixture.bob.userId, ALICE_DATE, fixture.alice.workoutId),
      ).toBeNull();
    });

    it("is null for a walk with no route, which is what draws nothing", async () => {
      await removeRoute(fixture.alice.userId, fixture.alice.workoutLogId);

      expect(
        await loadWalkRoute(fixture.alice.userId, ALICE_DATE, fixture.alice.workoutId),
      ).toBeNull();
    });
  });

  describe("nameWalkRoute", () => {
    it("names the owner's own route, and unnames it with null", async () => {
      expect(
        await nameWalkRoute(
          fixture.alice.userId,
          ALICE_DATE,
          fixture.alice.workoutId,
          "The park circuit",
        ),
      ).toBe(true);

      const named = await loadWalkRoute(
        fixture.alice.userId,
        ALICE_DATE,
        fixture.alice.workoutId,
      );

      expect(named?.name).toBe("The park circuit");
      // A route that has been named is not asking a question.
      expect(named?.suggestion).toBeNull();

      await nameWalkRoute(fixture.alice.userId, ALICE_DATE, fixture.alice.workoutId, null);

      expect(
        (await loadWalkRoute(fixture.alice.userId, ALICE_DATE, fixture.alice.workoutId))
          ?.name,
      ).toBeNull();
    });

    it("cannot write a name onto a stranger's route", async () => {
      expect(
        await nameWalkRoute(
          fixture.bob.userId,
          ALICE_DATE,
          fixture.alice.workoutId,
          "written by a stranger",
        ),
      ).toBe(false);

      // And her row is untouched, which is the half the boolean cannot promise.
      expect(
        (await loadWalkRoute(fixture.alice.userId, ALICE_DATE, fixture.alice.workoutId))
          ?.name,
      ).toBeNull();
    });

    it("refuses a blank or oversized name at the DATABASE", async () => {
      // `walk_routes_name_shape`. The action trims to null long before this, so
      // what is asserted here is the constraint that holds when a future caller
      // forgets the action — the reason schema.ts states the rule twice.
      for (const bad of ["   ", "x".repeat(61)]) {
        await expect(
          nameWalkRoute(fixture.alice.userId, ALICE_DATE, fixture.alice.workoutId, bad),
        ).rejects.toThrow();
      }
    });
  });

  describe("the offer", () => {
    /** A second walk for a user, carrying the given geometry. */
    async function secondWalk(user: Fixture["alice"], points: Track) {
      const owned = scope(user.userId, getDb());

      const [log] = await owned.insert(schema.workoutLogs, {
        date: LATER_DATE,
        workoutId: user.workoutId,
        status: "done",
        distanceM: 1200,
      });

      await owned.insert(schema.walkRoutes, {
        workoutLogId: log!.id,
        points,
        pointCount: points.flat().length,
      });
    }

    it("offers a name from the user's own earlier walk, and does not apply it", async () => {
      const points = await traceOf(fixture.alice, ALICE_DATE);

      await nameWalkRoute(
        fixture.alice.userId,
        ALICE_DATE,
        fixture.alice.workoutId,
        "The park circuit",
      );
      await secondWalk(fixture.alice, points);

      const later = await loadWalkRoute(
        fixture.alice.userId,
        LATER_DATE,
        fixture.alice.workoutId,
      );

      // OFFERED, and the row itself still unnamed — § P11's requirement, and the
      // distinction this whole feature turns on.
      expect(later?.suggestion?.name).toBe("The park circuit");
      expect(later?.name).toBeNull();
    });

    it("never offers a stranger's route name, even for the identical shape", async () => {
      const points = await traceOf(fixture.alice, ALICE_DATE);

      // Bob's route is REPLACED with Alice's own geometry and then named. Same
      // start, same shape, same length — so the only thing that can refuse the
      // offer is the user boundary. Left as the fixture had it, Bob's trace is
      // ~480m from Alice's and the match would decline on distance, which would
      // make this test pass for a reason that has nothing to do with isolation.
      await removeRoute(fixture.bob.userId, fixture.bob.workoutLogId);
      await scope(fixture.bob.userId, getDb()).insert(schema.walkRoutes, {
        workoutLogId: fixture.bob.workoutLogId,
        points,
        pointCount: points.flat().length,
        name: "Bob’s route",
      });

      await secondWalk(fixture.alice, points);

      const later = await loadWalkRoute(
        fixture.alice.userId,
        LATER_DATE,
        fixture.alice.workoutId,
      );

      expect(later?.suggestion).toBeNull();
    });

    it("offers nothing when the shape matches but the walk began elsewhere", async () => {
      const points = await traceOf(fixture.alice, ALICE_DATE);

      await nameWalkRoute(
        fixture.alice.userId,
        ALICE_DATE,
        fixture.alice.workoutId,
        "The park circuit",
      );

      // The same shape, moved a kilometre north — about ten times the 100m the
      // match allows. A route is where you walked as well as what shape it was.
      //
      // Through `reduceTrackPrecision`, because the arithmetic does not land on
      // five decimals on its own: `0.011 + 0.01` is 0.020999999999999998 in
      // binary floating point, and `walk_routes_points_precision` refuses it.
      // That is the second time this constraint has caught a fixture in this
      // file, which is a constraint earning its keep rather than a nuisance.
      const elsewhere: Track = reduceTrackPrecision(
        points.map((segment) => segment.map((point) => ({ ...point, lat: point.lat + 0.01 }))),
      );

      await secondWalk(fixture.alice, elsewhere);

      expect(
        (await loadWalkRoute(fixture.alice.userId, LATER_DATE, fixture.alice.workoutId))
          ?.suggestion,
      ).toBeNull();
    });
  });
});
