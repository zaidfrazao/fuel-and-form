import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import {
  loadWeighIns,
  recordWeighIn,
  removeWeighIn,
  weighInToday,
} from "@/lib/db/queries/weight";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * Weigh-ins against a real Postgres — FUEL-34.
 *
 * `src/lib/weigh-in.test.ts` proves the refusals and `src/app/actions/weight.test.ts`
 * proves the wiring, both without a database. What neither can prove is the
 * claim this whole feature is built on, because the claim lives in the schema:
 *
 *   **A second weigh-in on one date REPLACES the first.**
 *
 * That is `weight_logs_user_date_key`, and everything above it follows from it —
 * one form rather than two, no id in the payload, "edit" being the same write as
 * "log". If the index were dropped, or the upsert's conflict target drifted off
 * it, nothing in the hermetic suites would notice: `recordWeighIn` would still
 * resolve, the screen would still render, and the history would quietly grow a
 * second row for the same morning. The chart FUEL-35 draws from it would then
 * have two points on one day with no rule for which is the measurement.
 *
 * The second claim is `user_id`, which is Testing Strategy § 1.4: Bob's delete
 * must not reach Alice's row, and must not be able to TELL that Alice's row is
 * there. `scope.test.ts` proves the scope; this proves this table's use of it.
 */

const configured = testDatabaseUrl() !== undefined;

describe.skipIf(!configured)("weigh-ins, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Every weigh-in row in the table, whoever owns it. */
  async function allRows() {
    return getDb().select().from(schema.weightLogs);
  }

  it("reads back a user's own weigh-ins and nobody else's", async () => {
    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(history?.entries.map((row) => row.date)).toEqual([fixture.alice.weighInDate]);
    // Bob's row exists — the fixture seeds one per user on a distinct date — so
    // this is a filter that had something to filter.
    expect(await allRows()).toHaveLength(3);
  });

  it("hands back the date as a 'YYYY-MM-DD' string, not a Date", async () => {
    // The driver's answer, not the app's. Every comparison in this feature —
    // the form's prefill, the row lookup, the future-date refusal — is a string
    // comparison, and a `Date` here would make each of them silently false.
    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(typeof history?.entries[0]?.date).toBe("string");
    expect(history?.entries[0]?.date).toBe(fixture.alice.weighInDate);
  });

  it("hands back the weight as a number, not a numeric string", async () => {
    // `numeric` comes back as a string from node-postgres unless the column is
    // declared `mode: "number"`. It is — see `kilograms` in schema.ts — and if
    // that were lost, `figure()` would render "79.4" perfectly while every
    // future average and delta silently concatenated instead of adding.
    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(typeof history?.entries[0]?.weightKg).toBe("number");
  });

  it("records a new weigh-in against its date", async () => {
    await recordWeighIn(fixture.alice.userId, {
      date: "2026-03-09",
      weightKg: 78.65,
      note: "before breakfast",
    });

    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(history?.entries.map((row) => row.date)).toEqual([
      // Newest first, which is the order the screen reads in.
      "2026-03-09",
      fixture.alice.weighInDate,
    ]);
    expect(history?.entries[0]?.weightKg).toBe(78.65);
  });

  it("replaces the weigh-in already on that date rather than adding one", async () => {
    // The claim the whole feature rests on, and the only place it can be made.
    const date = fixture.alice.weighInDate;

    await recordWeighIn(fixture.alice.userId, { date, weightKg: 78.2, note: "re-weighed" });

    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(history?.entries).toHaveLength(1);
    expect(history?.entries[0]?.weightKg).toBe(78.2);
    expect(history?.entries[0]?.note).toBe("re-weighed");
  });

  it("writes a cleared note as null rather than leaving the old one", async () => {
    // `null` and "absent" are different answers in `lib/weigh-in.ts`, and this
    // is the half of that distinction the database has to honour: an update
    // whose `note` was simply missing would leave the previous sentence in
    // place under a number it no longer explains.
    const date = fixture.alice.weighInDate;

    await recordWeighIn(fixture.alice.userId, { date, weightKg: 79, note: "felt light" });
    await recordWeighIn(fixture.alice.userId, { date, weightKg: 79, note: null });

    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(history?.entries[0]?.note).toBeNull();
  });

  it("leaves created_at where it was when a weigh-in is corrected", async () => {
    // Unlike `workout_logs.logged_at`, which moves with a correction. The two
    // columns mean different things — see `recordWeighIn` — and a `created_at`
    // that moved would be a second, worse copy of the date the row already has.
    const date = fixture.alice.weighInDate;
    const s = scope(fixture.alice.userId, getDb());

    const [before] = await s.select(schema.weightLogs);

    await recordWeighIn(fixture.alice.userId, { date, weightKg: 78.2, note: null });

    const [after] = await s.select(schema.weightLogs);

    expect(after?.createdAt).toEqual(before?.createdAt);
  });

  it("does not let one user's weigh-in land on another's date", async () => {
    // The same date for both, which is exactly the case a per-date unique index
    // could get wrong: the constraint is on `(user_id, date)`, so two users
    // weighing in on one morning is two rows and not a conflict.
    await recordWeighIn(fixture.alice.userId, { date: "2026-04-01", weightKg: 79, note: null });
    await recordWeighIn(fixture.bob.userId, { date: "2026-04-01", weightKg: 91, note: null });

    const alice = await loadWeighIns(fixture.alice.userId, new Date());
    const bob = await loadWeighIns(fixture.bob.userId, new Date());

    expect(alice?.entries.find((row) => row.date === "2026-04-01")?.weightKg).toBe(79);
    expect(bob?.entries.find((row) => row.date === "2026-04-01")?.weightKg).toBe(91);
  });

  it("deletes the caller's own weigh-in", async () => {
    await expect(
      removeWeighIn(fixture.alice.userId, fixture.alice.weighInDate),
    ).resolves.toBe(true);

    const history = await loadWeighIns(fixture.alice.userId, new Date());

    expect(history?.entries).toEqual([]);
    // Hard, not soft: nothing is left behind for a future total to remember to
    // filter out.
    expect(await allRows()).toHaveLength(2);
  });

  it("cannot delete another user's weigh-in, and cannot tell it is there", async () => {
    // § 1.4, and the reason the answer is `false` rather than a 403: a delete
    // that distinguished "not yours" from "not there" would be an oracle for
    // asking whether the owner weighed in on any given date.
    await expect(
      removeWeighIn(fixture.bob.userId, fixture.alice.weighInDate),
    ).resolves.toBe(false);

    await expect(removeWeighIn(fixture.bob.userId, "2026-12-25")).resolves.toBe(false);

    // Alice's row is untouched.
    const alice = await loadWeighIns(fixture.alice.userId, new Date());

    expect(alice?.entries).toHaveLength(1);
  });

  it("reads today from the caller's own timezone", async () => {
    // The fixture's profile is Europe/London. An instant that is already
    // tomorrow in London but not in UTC is what separates the two.
    const instant = new Date("2026-06-30T23:30:00Z"); // 00:30 on the 1st in London

    await expect(weighInToday(fixture.alice.userId, instant)).resolves.toBe("2026-07-01");
  });

  it("has nothing to say for a user with no profile row", async () => {
    // No timezone, so no "today". The screen renders an empty state rather than
    // inventing one, and the action refuses rather than using the server's.
    const s = scope(fixture.bob.userId, getDb());

    await s.delete(schema.profiles);

    await expect(loadWeighIns(fixture.bob.userId, new Date())).resolves.toBeUndefined();
    await expect(weighInToday(fixture.bob.userId, new Date())).resolves.toBeUndefined();
  });
});
