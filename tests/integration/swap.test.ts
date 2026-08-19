import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { deleteOverride, writeOverride } from "@/lib/db/queries/swap";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
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
