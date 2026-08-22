import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { loadWeekExport } from "@/lib/db/queries/week-export";
import { buildWeekCsv } from "@/lib/export-week";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * The weekly CSV, scoped — **Testing Strategy § 1.4 case 3**, for FUEL-38.
 *
 * "Demo session exports → export contains demo data only." `export.test.ts`
 * makes the case for the JSON file; this is the same criterion on the other
 * file P6 hands out, and it needs its own test because it is a different set of
 * statements: seven reads in `queries/week-export.ts`, four of them narrowed to
 * a date range, none of them shared with the JSON export's eleven.
 *
 * ## Why the assertion is stronger here than for the JSON
 *
 * That file carries ids, so a leak is a uuid in a field. This one carries
 * NAMES, because nothing downstream would resolve a uuid — which means a leak
 * is the other person's meal sitting in the middle of a check-in, in plain
 * text. So the sweep below is over the file's own bytes rather than over parsed
 * rows: not "is Alice's id in the field I thought to check", but "is anything
 * of Alice's anywhere in what leaves".
 *
 * ## Two-sided, on purpose
 *
 * "Bob's file contains none of Alice's rows" passes trivially against a file
 * with no rows at all, and would keep passing after a regression that emptied
 * it. So every section is asserted to hold Bob's own rows first. The fixture
 * seeds each user a meal, a workout, a plan entry, an override and a log on a
 * date of their own for exactly this reason.
 *
 * The fixture's two dates — Alice's Monday and Bob's Tuesday — are in the SAME
 * week, deliberately. A narrowed read that leaked would leak into this window
 * rather than falling outside it, so the date range cannot be what makes the
 * isolation assertions pass.
 */

const configured = testDatabaseUrl() !== undefined;

/** The Monday both fixture dates belong to. */
const MONDAY = "2026-03-02";

describe.skipIf(!configured)("the weekly export, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** The file one user gets for one week. */
  async function csvFor(userId: string, anchor: string | null = MONDAY) {
    const payload = await loadWeekExport(
      userId,
      new Date("2026-03-05T12:00:00.000Z"),
      anchor,
    );

    if (!payload) throw new Error("expected a payload for a seeded user");

    return { csv: buildWeekCsv(payload.input), monday: payload.monday };
  }

  /**
   * The rows of one section, without its name or its header.
   *
   * Needed because two of the assertions below are about a SECTION rather than
   * about the file: the fixture's dates are the week's own dates, so "the
   * file does not contain 2026-03-02" is false for a file whose preamble names
   * the week starting on it. What a leak would look like is an extra ROW.
   */
  function section(csv: string, name: string): string[] {
    const all = csv.split("\r\n");
    const rest = all.slice(all.indexOf(name) + 2);
    const end = rest.indexOf("");

    return end === -1 ? rest : rest.slice(0, end);
  }

  it("gives a demo session its own week, in all three sections", async () => {
    // The positive half, and what stops the isolation assertions below from
    // passing against a file that had quietly stopped working.
    const { csv } = await csvFor(fixture.bob.userId);

    expect(csv).toContain("Bob's porridge");
    expect(csv).toContain("Bob's circuit");
    // The weigh-in, by its date: the fixture gives each user a date of their
    // own, so a leaked row is visible as a day this user never recorded.
    expect(csv).toContain(`\r\n${fixture.bob.weighInDate},`);
  });

  it("gives a demo session none of the owner's rows", async () => {
    // § 1.4 case 3. A sweep over the bytes rather than over fields, for the
    // reason the module comment gives: every id in this file was replaced by a
    // name, and a name is what a leak would look like.
    const { csv } = await csvFor(fixture.bob.userId);

    expect(csv).not.toContain("Alice");
    expect(csv).not.toContain(fixture.alice.userId);
    expect(csv).not.toContain(fixture.alice.mealId);
    expect(csv).not.toContain(fixture.alice.workoutId);

    // Alice's weigh-in is asserted as a ROW rather than as a string, because
    // her fixture date is this week's Monday — it is in the preamble of every
    // file for this week, including Bob's own. One row, on Bob's own date, is
    // what "none of the owner's rows" means here.
    expect(section(csv, "weight").map((row) => row.split(",")[0])).toEqual([
      fixture.bob.weighInDate,
    ]);
  });

  it("gives the owner their own week, not the demo session's", async () => {
    // The same isolation from the other side. Without it, a reader that
    // returned only the first user's rows to whoever asked would pass every
    // assertion above.
    const { csv } = await csvFor(fixture.alice.userId);

    expect(csv).toContain("Alice's porridge");
    expect(csv).not.toContain("Bob");
    expect(csv).not.toContain(fixture.bob.userId);
  });

  it("carries no user_id in the bytes that leave", async () => {
    // Every row in this file is a projection into named columns, so a
    // `user_id` cannot arrive by accident the way it could in the JSON export's
    // spread. Asserted anyway, because that is a property of the current
    // columns rather than a rule the file states.
    const { csv } = await csvFor(fixture.bob.userId);

    expect(csv).not.toContain(fixture.bob.userId);
  });

  it("takes any day of the week as the week", async () => {
    // `startOfWeek` snaps the anchor, so a URL carrying a Thursday names the
    // same seven days as one carrying the Monday before it — and produces a
    // file with the same name.
    const monday = await csvFor(fixture.bob.userId, MONDAY);
    const thursday = await csvFor(fixture.bob.userId, "2026-03-05");

    expect(thursday.monday).toBe(MONDAY);
    expect(thursday.csv).toBe(monday.csv);
  });

  it("shows a neighbouring week's plan without its logs", async () => {
    // The narrowed reads, from the outside — and the line between what is
    // narrowed and what is not. The template RECURS, so the week after the
    // fixture's still plans Bob's porridge on its Monday; the logs, the
    // override and the weigh-in are dated, so none of them belongs here.
    //
    // A read that forgot its date range would fill `actual` and `status` in
    // with the week before's answers, which is the failure that would be
    // hardest to see in a file that otherwise looks right.
    const { csv } = await csvFor(fixture.bob.userId, "2026-03-09");

    expect(csv).toContain("week,2026-03-09");
    expect(section(csv, "weight")).toEqual([]);
    expect(section(csv, "meals")).toEqual([
      "2026-03-09,breakfast,Bob's porridge,,,,420,24,12,55,",
    ]);
    expect(section(csv, "training")).toEqual(["2026-03-09,Bob's circuit,circuit,yes,,,"]);
  });

  it("chooses the current week in the user's own zone", async () => {
    // P6's dated filename, one layer down. A summer instant, deliberately: the
    // fixture seeds Europe/London, which is on GMT through March and therefore
    // agrees with UTC — a March instant would assert nothing. In July, London
    // is an hour ahead, so 23:30Z on Sunday the 5th is already Monday the 6th
    // there, and the week the file names turns over with it.
    const payload = await loadWeekExport(
      fixture.alice.userId,
      new Date("2026-07-05T23:30:00.000Z"),
    );

    expect(payload?.monday).toBe("2026-07-06");
  });

  it("answers undefined for a user with no profile row", async () => {
    // The contract every reader in this app keeps, and what the route turns
    // into a 404 rather than a file named from the server's clock.
    const missing = await loadWeekExport(
      "00000000-0000-4000-8000-000000000000",
      new Date(),
      MONDAY,
    );

    expect(missing).toBeUndefined();
  });
});
