import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { checkItem, loadShoppingWeek, uncheckItem } from "@/lib/db/queries/shopping";
import { deleteOverride, writeOverride } from "@/lib/db/queries/swap";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import type { ShoppingGroup } from "@/lib/shopping-list";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * P8's check state against a real Postgres — FUEL-45.
 *
 * `src/app/actions/shopping.test.ts` proves the action narrows what a client
 * sends, and `src/components/shopping-list-view.test.tsx` proves a tap paints
 * the row. Both mock everything below them, which makes them claims about
 * control flow. This file proves the claim the ticket actually rests on, and it
 * is a property of the DATA that no mock can observe:
 *
 *   > "Regenerating after a swap preserves existing check state for unchanged
 *   > items."
 *
 * That sentence is only true if the identity a tick is stored against survives
 * a change to the plan underneath it. The tick is keyed on the normalised
 * ingredient NAME precisely so it does — and nothing in the unit suites can
 * tell that design from one keyed on a `meal_ingredients.id`, because both look
 * identical until a real swap replaces the row the ingredient came from. Here
 * the swap is real, the regeneration is a second call to the real query, and
 * the tick either survives or it does not.
 *
 * The other thing needing a real database is the unique index: a re-tick is an
 * `ON CONFLICT` against `(user_id, week_start, item_key)`, and a scope whose
 * conflict target were wrong would still build a statement that looked right.
 *
 * ## The dates
 *
 * The fixture seeds each user an override and a tick on their own date —
 * Alice's is 2026-03-02. Everything below works on 2026-03-09, a later Monday,
 * so nothing it asserts can be an accident of the seeded rows, and the
 * week-scoping case has a genuine second week to be scoped away from.
 */

const configured = testDatabaseUrl() !== undefined;

/** Two Mondays, one week apart. Both after the fixture's program start. */
const MONDAY = "2026-03-09";
const NEXT_MONDAY = "2026-03-16";

/** The fixture's own Monday, and the week its seeded tick belongs to. */
const FIXTURE_MONDAY = "2026-03-02";

describe.skipIf(!configured)("shopping check state, scoped", () => {
  const as = (user: { userId: string }) => scope(user.userId, getDb());

  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Every line of the list, flattened out of its aisles. */
  const lines = (groups: readonly ShoppingGroup[]) => groups.flatMap((group) => group.lines);

  /** The list for a user's week, or a failure that names the missing profile. */
  async function listFor(user: { userId: string }, week = MONDAY) {
    const result = await loadShoppingWeek(user.userId, new Date(), week);

    if (!result) throw new Error("expected a shopping week for a seeded user");

    return result;
  }

  /**
   * A second breakfast for Alice, sharing one ingredient with the fixture's
   * porridge and bringing one of its own.
   *
   * The shared ingredient is what the preservation case turns on, and the
   * distinct one is the control: after the swap the list must have replaced one
   * and kept the other, and a test with only the shared ingredient could not
   * tell a working swap from a swap that did nothing.
   *
   * The gram figures are all different, so a wrong answer names its own cause.
   */
  async function seedAlternative() {
    const owned = as(fixture.alice);

    const [meal] = await owned.insert(schema.meals, {
      name: "Alice's overnight oats",
      slotType: "breakfast",
      kcal: 390,
      proteinG: 21,
      fatG: 9,
      carbG: 58,
    });

    if (!meal) throw new Error("expected the alternative meal to be inserted");

    await owned.insert(schema.mealIngredients, [
      // The same ingredient the fixture's porridge carries, at a different
      // weight — so the line survives the swap while its quantity changes.
      { mealId: meal.id, name: "Rolled oats", grams: 50 },
      { mealId: meal.id, name: "Blueberries", grams: 60 },
    ]);

    return meal.id;
  }

  /**
   * A breakfast sharing NOTHING with the porridge.
   *
   * The other half of the pair above: swapping to this one removes the oats
   * from the week altogether, which is what makes the "tick with no line" case
   * a real absence rather than a changed quantity.
   */
  async function seedUnrelated() {
    const owned = as(fixture.alice);

    const [meal] = await owned.insert(schema.meals, {
      name: "Alice's eggs",
      slotType: "breakfast",
      kcal: 310,
      proteinG: 26,
      fatG: 22,
      carbG: 2,
    });

    if (!meal) throw new Error("expected the unrelated meal to be inserted");

    await owned.insert(schema.mealIngredients, { mealId: meal.id, name: "Eggs", grams: 120 });

    return meal.id;
  }

  /* ------------------------------------------------------------------------ */
  /* The headline criterion                                                   */
  /* ------------------------------------------------------------------------ */

  it("keeps the tick on an ingredient a swap did not remove", async () => {
    const alternative = await seedAlternative();

    // Before: Monday breakfast is the fixture's porridge, which brings 80g of
    // rolled oats. Tick it.
    const before = await listFor(fixture.alice);

    expect(lines(before.groups).map((line) => line.key)).toEqual(["rolled oats"]);
    expect(lines(before.groups)[0]?.grams).toBe(80);

    await checkItem(fixture.alice.userId, MONDAY, "rolled oats");

    // The swap. A real override on a real date, through the same query `/plan`
    // writes — not a hand-built row, because the point is that the plan
    // genuinely changed underneath the list.
    await writeOverride(fixture.alice.userId, {
      date: MONDAY,
      slot: "breakfast",
      mealId: alternative,
    });

    // The regeneration: a second call to the real query, which re-resolves the
    // week, re-aggregates the ingredients and re-reads the ticks.
    const after = await listFor(fixture.alice);

    // The list HAS changed — the swapped-in meal's ingredients are what the
    // week now needs, and the oats arrive from a different recipe's row at a
    // different weight.
    expect(lines(after.groups).map((line) => line.key).sort()).toEqual([
      "blueberries",
      "rolled oats",
    ]);
    expect(lines(after.groups).find((line) => line.key === "rolled oats")?.grams).toBe(50);

    // And the tick survived it. This is the criterion: the ingredient did not
    // change, so neither did its check state — even though the row it came from
    // is a different row entirely.
    expect(after.checked).toContain("rolled oats");

    // The newly arrived ingredient is not ticked. A regeneration that carried
    // the tick across to everything would pass the assertion above and be
    // useless.
    expect(after.checked).not.toContain("blueberries");
  });

  it("keeps a tick for an ingredient the week stops needing", async () => {
    const unrelated = await seedUnrelated();

    await checkItem(fixture.alice.userId, MONDAY, "rolled oats");

    // Swap Monday breakfast to a meal that shares no ingredient with the
    // porridge, so the week stops needing oats entirely.
    await writeOverride(fixture.alice.userId, {
      date: MONDAY,
      slot: "breakfast",
      mealId: unrelated,
    });

    const after = await listFor(fixture.alice);

    // The line is gone from the list...
    expect(lines(after.groups).map((line) => line.key)).toEqual(["eggs"]);

    // ...and the tick is still stored, with nothing to hang it on. Sweeping it
    // here would destroy exactly the state the criterion asks to keep, in the
    // case where the swap is undone an hour later — which is the next thing
    // this test does.
    expect(after.checked).toContain("rolled oats");

    // The revert, through the same query `/plan` reverts with. It takes the
    // override's id, so the row is read back rather than reconstructed — which
    // is also what `writeOverride` actually wrote.
    const [override] = await as(fixture.alice).select(
      schema.dayPlanOverrides,
      eq(schema.dayPlanOverrides.date, MONDAY),
    );

    if (!override) throw new Error("expected the swap to have written an override");

    await deleteOverride(fixture.alice.userId, override.id);

    const restored = await listFor(fixture.alice);

    expect(lines(restored.groups).map((line) => line.key)).toEqual(["rolled oats"]);
    expect(restored.checked).toContain("rolled oats");
  });

  /* ------------------------------------------------------------------------ */
  /* The statements                                                           */
  /* ------------------------------------------------------------------------ */

  it("ticks, unticks, and treats a repeat tick as the same row", async () => {
    await checkItem(fixture.alice.userId, MONDAY, "rolled oats");

    // The upsert: a second tap must not raise a duplicate key, and must not
    // leave two rows for one line.
    await checkItem(fixture.alice.userId, MONDAY, "rolled oats");

    const rows = await as(fixture.alice).select(schema.shoppingChecks);
    const week = rows.filter((row) => row.weekStart === MONDAY);

    expect(week).toHaveLength(1);
    expect((await listFor(fixture.alice)).checked).toEqual(["rolled oats"]);

    await uncheckItem(fixture.alice.userId, MONDAY, "rolled oats");

    expect((await listFor(fixture.alice)).checked).toEqual([]);
  });

  it("unticking something never ticked removes nothing and does not raise", async () => {
    // The checkbox's two directions are one control, so a screen that had
    // drifted from the row would otherwise fail on the tap putting it right.
    await expect(
      uncheckItem(fixture.alice.userId, MONDAY, "rolled oats"),
    ).resolves.toBeUndefined();

    expect((await listFor(fixture.alice)).checked).toEqual([]);
  });

  /* ------------------------------------------------------------------------ */
  /* Scoping — by week, and by user                                           */
  /* ------------------------------------------------------------------------ */

  it("keeps each week's ticks to that week", async () => {
    await checkItem(fixture.alice.userId, MONDAY, "rolled oats");

    // The fixture already ticked the same ingredient in an earlier week. If the
    // read were not narrowed, one of these two weeks would carry the other's.
    expect((await listFor(fixture.alice, MONDAY)).checked).toEqual(["rolled oats"]);
    expect((await listFor(fixture.alice, NEXT_MONDAY)).checked).toEqual([]);
    expect((await listFor(fixture.alice, FIXTURE_MONDAY)).checked).toEqual(["rolled oats"]);
  });

  it("does not let one account's ticks reach another's list", async () => {
    // Testing Strategy § 1.4: the demo session is the stranger. Both users own
    // an ingredient normalising to the same key, which is what makes this
    // assertion capable of failing — with distinct keys it would pass whether
    // or not the statements were scoped.
    await checkItem(fixture.alice.userId, MONDAY, "rolled oats");

    expect((await listFor(fixture.bob, MONDAY)).checked).toEqual([]);

    // And Bob unticking his own does not clear Alice's.
    await uncheckItem(fixture.bob.userId, MONDAY, "rolled oats");

    expect((await listFor(fixture.alice, MONDAY)).checked).toEqual(["rolled oats"]);
  });

  it("removes an account's ticks when the account is reaped", async () => {
    // P7's reaper is `delete from users`, and every tick has to go with it. A
    // `restrict` anywhere in the graph would leave that job failing against
    // rows it cannot see — `ownerId()` says the cascade is load-bearing rather
    // than tidy, and this is the statement that would find out.
    await checkItem(fixture.bob.userId, MONDAY, "rolled oats");

    await getDb().delete(schema.users).where(eq(schema.users.id, fixture.bob.userId));

    const left = await getDb()
      .select()
      .from(schema.shoppingChecks)
      .where(eq(schema.shoppingChecks.userId, fixture.bob.userId));

    expect(left).toEqual([]);
  });
});
