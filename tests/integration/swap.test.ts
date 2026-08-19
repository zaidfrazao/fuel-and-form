import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { deleteOverride, writeOverride, writeOverrides } from "@/lib/db/queries/swap";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { repeatDates } from "@/lib/repeat";
import { type Plan, resolveSlot } from "@/lib/resolve-plan";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * P2's write path against a real Postgres — FUEL-23.
 *
 * `src/app/actions/swap.test.ts` proves the action derives the right row and
 * refuses the wrong caller, with every collaborator mocked. That is a claim
 * about control flow. This file proves the two statements underneath it behave
 * as the claim assumes once Postgres executes them — and, more importantly,
 * proves the ticket's headline guarantees, which are properties of the DATA and
 * cannot be observed from a mock at all:
 *
 *   - an override lands for that date and slot only;
 *   - `plan_template_entries` is unchanged, row for row;
 *   - the same weekday NEXT WEEK still resolves to the template meal;
 *   - a second swap of the same slot updates the row rather than duplicating it.
 *
 * The last of those is the one that needs a real database more than the others.
 * The unique index on `(user_id, date, slot)` and the `ON CONFLICT` clause that
 * targets it are both invisible to a unit test: a scope whose conflict target
 * were wrong would still build a statement that looked right, and the failure
 * would be a duplicate-key error in production or, worse, a silently overwritten
 * row belonging to somebody else.
 *
 * ## The dates
 *
 * The fixture seeds each user a Monday-breakfast template entry and an override
 * on their own date. Everything below works on 2026-03-09 and 2026-03-16 —
 * two later Mondays — so nothing it asserts can be an accident of the seeded
 * override, and the "next week" case is a genuine second calendar date.
 */

const configured = testDatabaseUrl() !== undefined;

/** Two Mondays, one week apart. Both after the fixture's program start. */
const MONDAY = "2026-03-09";
const NEXT_MONDAY = "2026-03-16";

describe.skipIf(!configured)("swapping, scoped", () => {
  const as = (user: { userId: string }) => scope(user.userId, getDb());

  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** The alternative dinner a swap moves TO — the fixture seeds only one meal. */
  async function addMeal(user: { userId: string }, name: string): Promise<string> {
    const rows = await as(user).insert(schema.meals, {
      name,
      slotType: "breakfast",
      kcal: 610,
      proteinG: 38,
      fatG: 22,
      carbG: 61,
    });

    const row = rows.at(0);

    if (!row) throw new Error("Inserting the swap's target meal returned no row.");

    return row.id;
  }

  /**
   * Everything `resolve-plan` needs, read back out of Postgres.
   *
   * The assertions below resolve rather than inspecting rows directly, because
   * the guarantee the ticket makes is about what the user SEES on a date — not
   * about which table a row happens to sit in. Reading it back through the same
   * resolver the app uses is what makes "next week is unaffected" mean the
   * thing it means on the screen.
   */
  async function planFor(user: { userId: string }): Promise<Plan> {
    const s = as(user);

    const [template, overrides, meals, profile] = await Promise.all([
      s.select(schema.planTemplateEntries),
      s.select(schema.dayPlanOverrides),
      s.select(schema.meals),
      s.selectOne(schema.profiles),
    ]);

    if (!profile) throw new Error("The fixture seeded no profile.");

    return { programStartDate: profile.programStartDate, template, overrides, meals };
  }

  describe("writeOverride", () => {
    it("writes the override for that date and slot, as that user", async () => {
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverride(alice.userId, {
        date: MONDAY,
        slot: "breakfast",
        mealId: curry,
      });

      const rows = await as(alice).select(schema.dayPlanOverrides);
      const written = rows.find((row) => row.date === MONDAY);

      expect(written).toMatchObject({
        slot: "breakfast",
        mealId: curry,
        userId: alice.userId,
      });
      // Left to the column's own default — when the slot first diverged.
      expect(written?.createdAt).toBeInstanceOf(Date);
    });

    it("leaves plan_template_entries byte for byte unchanged", async () => {
      // The acceptance criterion, asserted the blunt way: every column of every
      // template row, before and after. A swap that edited the template would
      // be a swap that changed every future week, and the PRD's whole override
      // model exists to make that impossible.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      const before = await as(alice).select(schema.planTemplateEntries);

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: curry });

      const after = await as(alice).select(schema.planTemplateEntries);

      expect(after).toEqual(before);
      expect(before.length).toBeGreaterThan(0);
    });

    it("leaves next week's same weekday resolving to the template meal", async () => {
      // "One-off by construction rather than by discipline." Both dates are
      // Mondays and both are covered by the same template entry; only the one
      // that was swapped changes.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: curry });

      const plan = await planFor(alice);

      expect(resolveSlot(plan, MONDAY, "breakfast")).toMatchObject({
        source: "override",
        meal: { id: curry },
      });
      expect(resolveSlot(plan, NEXT_MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: alice.mealId },
      });
    });

    it("touches no other slot on the same date", async () => {
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: curry });

      const sameDate = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (row) => row.date === MONDAY,
      );

      expect(sameDate).toHaveLength(1);
      expect(sameDate[0]?.slot).toBe("breakfast");
    });

    it("updates the existing row when the same slot is swapped twice", async () => {
      // Second thoughts about breakfast. The unique index makes "the row"
      // singular, so this must land on the row already there — a duplicate
      // would leave resolution breaking a tie it has no rule for.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");
      const eggs = await addMeal(alice, "Alice's third breakfast");

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: curry });
      const first = (await as(alice).select(schema.dayPlanOverrides)).find(
        (row) => row.date === MONDAY,
      );

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: eggs });
      const rows = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (row) => row.date === MONDAY,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.mealId).toBe(eggs);
      // The same physical row, not a replacement: `created_at` records when the
      // slot first diverged from the template, and a correction to a divergence
      // is not a new one.
      expect(rows[0]?.id).toBe(first?.id);
      expect(rows[0]?.createdAt).toEqual(first?.createdAt);
    });

    it("does not collide with another user's row for the same date and slot", async () => {
      // The line scope.upsert() rests on. The arbiter index carries user_id, so
      // two users swapping the same slot on the same date are two rows. An
      // ON CONFLICT target that omitted user_id would silently overwrite one
      // with the other, and the statement would still look correct.
      const { alice, bob } = fixture;
      const aliceMeal = await addMeal(alice, "Alice's second breakfast");
      const bobMeal = await addMeal(bob, "Bob's second breakfast");

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: aliceMeal });
      await writeOverride(bob.userId, { date: MONDAY, slot: "breakfast", mealId: bobMeal });

      const hers = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (row) => row.date === MONDAY,
      );
      const his = (await as(bob).select(schema.dayPlanOverrides)).filter(
        (row) => row.date === MONDAY,
      );

      expect(hers).toHaveLength(1);
      expect(his).toHaveLength(1);
      expect(hers[0]?.mealId).toBe(aliceMeal);
      expect(his[0]?.mealId).toBe(bobMeal);
    });

    it("refuses another user's meal", async () => {
      // The composite foreign key `(meal_id, user_id)`, doing the job the
      // action's own library check does first. Both exist on purpose: the
      // action turns it into a banner, this makes it impossible.
      const { alice, bob } = fixture;

      await expect(
        writeOverride(alice.userId, {
          date: MONDAY,
          slot: "breakfast",
          mealId: bob.mealId,
        }),
      ).rejects.toThrow();
    });
  });

  /**
   * The repeat — FUEL-24.
   *
   * The action's own tests prove it builds the right list of dates with every
   * collaborator mocked. What only a real Postgres can settle is what that list
   * BECOMES: N separate rows, each resolvable on its own date and each
   * removable on its own, written by one statement that either lands entirely
   * or not at all. Every one of those is a property of the data, and the last
   * two are the task's acceptance criteria stated in the only place they are
   * checkable.
   */
  describe("writeOverrides", () => {
    /** The dates a run of `days` starting at `from` covers. */
    const run = (from: string, days: number) =>
      (repeatDates(from, days) ?? []).map((date) => ({
        date,
        slot: "breakfast" as const,
      }));

    it("writes one row per date, across the whole run", async () => {
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverrides(
        alice.userId,
        run(MONDAY, 3).map((row) => ({ ...row, mealId: curry })),
      );

      const rows = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (row) => row.slot === "breakfast" && row.date >= MONDAY,
      );

      expect(rows.map((row) => row.date).sort()).toEqual([
        "2026-03-09",
        "2026-03-10",
        "2026-03-11",
      ]);

      // Separate rows, not one row covering a range. This is what "each created
      // override is individually revertible" rests on, and it is checked before
      // the revert case below so a failure points at the write.
      expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    });

    it("resolves the repeated meal on every date of the run", async () => {
      // § 1.1 case 11's expectation, reached through the write path rather than
      // through a hand-built fixture: all three resolve to the override.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverrides(
        alice.userId,
        run(MONDAY, 3).map((row) => ({ ...row, mealId: curry })),
      );

      const plan = await planFor(alice);

      for (const date of ["2026-03-09", "2026-03-10", "2026-03-11"]) {
        const resolved = resolveSlot(plan, date, "breakfast");

        expect(resolved?.source).toBe("override");
        expect(resolved?.meal.id).toBe(curry);
      }

      // The day after the run is untouched — the repeat did not smear past its
      // own end. It resolves to nothing rather than to a template entry
      // because the fixture seeds breakfast on MONDAYS only, so a Thursday has
      // nothing behind the slot at all. "Not an override" is the assertion that
      // matters; what it falls back to is the resolver's business, and the
      // template fallback is proven on a Monday two cases below.
      expect(resolveSlot(plan, "2026-03-12", "breakfast")).toBeNull();
    });

    it("resolves correctly across a month boundary", async () => {
      // § 1.1 case 12's dates. March has 31 days, so a run that stepped by
      // string arithmetic or by local midnights would land on 2026-03-32 or
      // repeat a date — and the resolver would then answer for a day the user
      // never has.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverrides(
        alice.userId,
        run("2026-03-30", 3).map((row) => ({ ...row, mealId: curry })),
      );

      const plan = await planFor(alice);

      expect(
        ["2026-03-30", "2026-03-31", "2026-04-01"].map(
          (date) => resolveSlot(plan, date, "breakfast")?.source,
        ),
      ).toEqual(["override", "override", "override"]);

      // Neither flank was written. Both are non-Mondays, so they resolve to
      // nothing — see the note above on what the fixture's template holds.
      expect(resolveSlot(plan, "2026-03-29", "breakfast")).toBeNull();
      expect(resolveSlot(plan, "2026-04-02", "breakfast")).toBeNull();
    });

    it("leaves each date of the run individually revertible", async () => {
      // The acceptance criterion, proven rather than assumed. Removing the
      // MIDDLE date is the case that would fail if the run were one row or if
      // the rows shared an id: the middle day goes back to the template while
      // the days either side of it stay exactly where they were.
      //
      // The run starts on the SUNDAY so that its middle date is the Monday the
      // fixture seeds a breakfast template for. That is what lets this assert
      // the revert lands back on the template rather than merely on nothing —
      // which is the half of "revertible" the criterion is actually about.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverrides(
        alice.userId,
        run("2026-03-08", 3).map((row) => ({ ...row, mealId: curry })),
      );

      const monday = (await as(alice).select(schema.dayPlanOverrides)).find(
        (row) => row.date === MONDAY,
      );

      expect(await deleteOverride(alice.userId, monday!.id)).toBe(true);

      const plan = await planFor(alice);

      expect(resolveSlot(plan, "2026-03-08", "breakfast")?.source).toBe("override");
      expect(resolveSlot(plan, MONDAY, "breakfast")?.source).toBe("template");
      expect(resolveSlot(plan, "2026-03-10", "breakfast")?.source).toBe("override");
    });

    it("leaves plan_template_entries byte for byte unchanged", async () => {
      // The override model's whole promise, and a repeat is the write with the
      // most opportunity to break it: seven dates, every one of which has a
      // template entry sitting behind it.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      const before = await as(alice).select(schema.planTemplateEntries);

      await writeOverrides(
        alice.userId,
        run(MONDAY, 7).map((row) => ({ ...row, mealId: curry })),
      );

      expect(await as(alice).select(schema.planTemplateEntries)).toEqual(before);
    });

    it("leaves the same weekday next week resolving to the template", async () => {
      // A seven-day run reaches the day BEFORE next Monday and stops. The
      // recurring intent is untouched, which is what makes a repeat a dated
      // divergence rather than an edit to the plan.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverrides(
        alice.userId,
        run(MONDAY, 7).map((row) => ({ ...row, mealId: curry })),
      );

      const plan = await planFor(alice);

      expect(resolveSlot(plan, "2026-03-15", "breakfast")?.source).toBe("override");
      expect(resolveSlot(plan, NEXT_MONDAY, "breakfast")?.source).toBe("template");
    });

    it("updates a date that was already overridden, rather than duplicating it", async () => {
      // "I made too much, ignore what I said about Tuesday." The unique index
      // on (user_id, date, slot) and the ON CONFLICT that targets it are both
      // invisible to a unit test: a wrong conflict target would still build a
      // statement that looked right here.
      const { alice } = fixture;
      const first = await addMeal(alice, "Alice's second breakfast");
      const second = await addMeal(alice, "Alice's third breakfast");

      await writeOverride(alice.userId, {
        date: "2026-03-10",
        slot: "breakfast",
        mealId: first,
      });

      await writeOverrides(
        alice.userId,
        run(MONDAY, 3).map((row) => ({ ...row, mealId: second })),
      );

      const rows = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (row) => row.date === "2026-03-10",
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.mealId).toBe(second);
    });

    it("writes the longest run Postgres will be asked for, in one statement", async () => {
      // Seven rows in one INSERT ... ON CONFLICT. Postgres refuses a statement
      // that would affect the same row twice, so this is also where a
      // `repeatDates` that ever produced a duplicate date would surface — as a
      // thrown error rather than as a quietly short run.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverrides(
        alice.userId,
        run(MONDAY, 7).map((row) => ({ ...row, mealId: curry })),
      );

      const rows = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (row) => row.date >= MONDAY && row.date < NEXT_MONDAY,
      );

      expect(rows).toHaveLength(7);
    });

    it("touches no other user's plan", async () => {
      // The scope's guarantee, applied to a batch. Stamping ownership onto only
      // the first row of an array is the exact mistake this shape invites.
      const { alice, bob } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      const bobsBefore = await as(bob).select(schema.dayPlanOverrides);

      await writeOverrides(
        alice.userId,
        run(MONDAY, 5).map((row) => ({ ...row, mealId: curry })),
      );

      expect(await as(bob).select(schema.dayPlanOverrides)).toEqual(bobsBefore);

      const mine = await as(alice).select(schema.dayPlanOverrides);

      expect(mine.every((row) => row.userId === alice.userId)).toBe(true);
    });

    it("writes nothing at all for an empty batch", async () => {
      // An INSERT with no tuples is a syntax error, not a no-op. The guard is
      // in `writeOverrides`; this is what proves it is a guard and not a
      // comment.
      const { alice } = fixture;

      const before = await as(alice).select(schema.dayPlanOverrides);

      await writeOverrides(alice.userId, []);

      expect(await as(alice).select(schema.dayPlanOverrides)).toEqual(before);
    });
  });

  describe("deleteOverride", () => {
    it("removes the row and restores the template meal", async () => {
      // Nothing was overwritten, so nothing has to be restored — the template
      // entry has been sitting there the whole time and resolution finds it
      // again the moment the override is gone.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: curry });

      const overridden = await planFor(alice);
      const row = overridden.overrides.find((candidate) => candidate.date === MONDAY);

      expect(await deleteOverride(alice.userId, row!.id)).toBe(true);

      const reverted = await planFor(alice);

      expect(resolveSlot(reverted, MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: alice.mealId },
      });
    });

    it("cannot remove another user's override, even holding its id", async () => {
      // "Not yours" and "not there" are the same answer — see scope.ts. Bob
      // learns nothing about whether the row exists, and Alice keeps it.
      const { alice, bob } = fixture;
      const curry = await addMeal(alice, "Alice's second breakfast");

      await writeOverride(alice.userId, { date: MONDAY, slot: "breakfast", mealId: curry });

      const row = (await as(alice).select(schema.dayPlanOverrides)).find(
        (candidate) => candidate.date === MONDAY,
      );

      expect(await deleteOverride(bob.userId, row!.id)).toBe(false);

      const survived = (await as(alice).select(schema.dayPlanOverrides)).filter(
        (candidate) => candidate.date === MONDAY,
      );

      expect(survived).toHaveLength(1);
    });

    it("answers false for an override that is already gone", async () => {
      // Another tab got there first. The caller needs to tell that from a
      // genuine revert so it does not report success for a delete that did
      // nothing.
      const { alice } = fixture;

      expect(
        await deleteOverride(alice.userId, "00000000-0000-0000-0000-000000000000"),
      ).toBe(false);
    });
  });
});
