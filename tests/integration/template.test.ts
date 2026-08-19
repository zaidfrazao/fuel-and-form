import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { deleteOverride, writeOverride } from "@/lib/db/queries/swap";
import {
  clearTemplateEntry,
  loadTemplate,
  writeTemplateEntry,
} from "@/lib/db/queries/template";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { type Plan, resolveSlot } from "@/lib/resolve-plan";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * P2's other write path against a real Postgres — FUEL-25.
 *
 * `src/app/actions/template.test.ts` proves the action refuses the wrong
 * weekday, the wrong slot, the wrong meal and the wrong caller, with every
 * collaborator mocked. That is a claim about control flow. This file proves the
 * statements underneath it behave as the claim assumes once Postgres executes
 * them, and proves the guarantees that are properties of the DATA and cannot be
 * observed from a mock:
 *
 *   - a template write lands on one `(day_of_week, slot)` row and updates it in
 *     place on the second write, rather than duplicating it;
 *   - the new unique index actually exists in the migrated database, and
 *     refuses a duplicate inserted around the query layer;
 *   - `day_plan_overrides` is unchanged, row for row — the mirror image of
 *     swap.test.ts's assertion that a swap leaves the template alone;
 *   - a date that already carries an override keeps it, and takes the new
 *     template meal only once the override is reverted;
 *   - none of it crosses a user boundary.
 *
 * The index case is the one that needs a real database most. `writeTemplateEntry`
 * targets `(user_id, day_of_week, slot)` in an `ON CONFLICT` clause; a schema
 * whose migration never ran, or a conflict target that did not match it, would
 * still build a statement that looked right in a unit test and fail — or worse,
 * silently duplicate — only once deployed.
 *
 * ## The dates
 *
 * The fixture seeds each user a Monday-breakfast template entry, an override on
 * their own date, and a program starting 2026-01-05. Everything below works on
 * 2026-03-09 and 2026-03-16, two later Mondays, so nothing it asserts can be an
 * accident of the seeded override.
 */

const configured = testDatabaseUrl() !== undefined;

/** Two Mondays, one week apart. Both after the fixture's program start. */
const MONDAY = "2026-03-09";
const NEXT_MONDAY = "2026-03-16";

/** The weekday those Mondays are, as `day_of_week` stores it. */
const MONDAY_DOW = 1;

describe.skipIf(!configured)("editing the template, scoped", () => {
  const as = (user: { userId: string }) => scope(user.userId, getDb());

  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** A second meal to move the template TO — the fixture seeds only one. */
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

    if (!row) throw new Error("Inserting the template's target meal returned no row.");

    return row.id;
  }

  /**
   * Everything `resolve-plan` needs, read back out of Postgres.
   *
   * The assertions resolve rather than inspecting rows, because what the ticket
   * promises is about what a user SEES on a date — a template edit reaching
   * every future week, and not reaching a date that was already swapped.
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

  describe("writeTemplateEntry", () => {
    it("writes the entry for that weekday and slot, as that user", async () => {
      const { alice } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      const rows = await as(alice).select(schema.planTemplateEntries);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
        userId: alice.userId,
      });
    });

    it("updates the row in place rather than duplicating it", async () => {
      // With no unique index to conflict on, this is the whole reason
      // `writeTemplateEntry` reads before it writes. An INSERT would leave two
      // rows for one weekday's breakfast and put resolution in the position of
      // breaking a tie between two intentions, neither of which is more recent
      // as far as the table is concerned.
      const { alice } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");
      const oats = await addMeal(alice, "Alice's third breakfast");

      const before = (await as(alice).select(schema.planTemplateEntries)).at(0);

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });
      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: oats,
      });

      const rows = await as(alice).select(schema.planTemplateEntries);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.mealId).toBe(oats);
      // The same physical row throughout — the entry's identity is the cell,
      // not the meal that happens to be in it.
      expect(rows[0]?.id).toBe(before?.id);
    });

    it("leaves sort_order alone when only the meal changes", async () => {
      // A day ordered by hand keeps its order. `writeTemplateEntry` writes the
      // meal and nothing else on conflict, so changing what is eaten cannot
      // silently reshuffle when.
      const { alice } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");

      await as(alice).update(schema.planTemplateEntries, { sortOrder: 3 });

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      const rows = await as(alice).select(schema.planTemplateEntries);

      expect(rows[0]?.sortOrder).toBe(3);
    });

    it("edits the row the resolver serves when a slot holds two", async () => {
      // The seed's snacks, in miniature: two rows in one cell, ordered by
      // `sort_order`. The editor shows one meal per cell because resolution
      // answers with one meal per slot, so the row it changes must be the one
      // that is actually eaten — otherwise someone edits a snack and watches
      // the screen go on serving the other.
      const { alice } = fixture;
      const second = await addMeal(alice, "Alice's second snack");
      const chosen = await addMeal(alice, "Alice's new first snack");

      await as(alice).insert(schema.planTemplateEntries, [
        { dayOfWeek: MONDAY_DOW, slot: "snack", mealId: alice.mealId, sortOrder: 0 },
        { dayOfWeek: MONDAY_DOW, slot: "snack", mealId: second, sortOrder: 1 },
      ]);

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "snack",
        mealId: chosen,
      });

      const snacks = (await as(alice).select(schema.planTemplateEntries))
        .filter((row) => row.slot === "snack")
        .sort((a, b) => a.sortOrder - b.sortOrder);

      // Two rows still, the first now naming the chosen meal.
      expect(snacks).toHaveLength(2);
      expect(snacks[0]?.mealId).toBe(chosen);
      expect(snacks[1]?.mealId).toBe(second);

      expect(resolveSlot(await planFor(alice), MONDAY, "snack")).toMatchObject({
        meal: { id: chosen },
      });
    });

    it("accepts a second entry in a slot, as the seed's two snacks need", async () => {
      // The constraint FUEL-25 tried to add and took back off. schema.ts
      // carries the reasoning; this is the database agreeing with it, because
      // a unique index re-added by a later tidy-up would break `db:seed` and
      // nothing in the hermetic suite would notice.
      const { alice } = fixture;
      const second = await addMeal(alice, "Alice's second snack");

      await expect(
        as(alice).insert(schema.planTemplateEntries, [
          { dayOfWeek: MONDAY_DOW, slot: "snack", mealId: alice.mealId, sortOrder: 0 },
          { dayOfWeek: MONDAY_DOW, slot: "snack", mealId: second, sortOrder: 1 },
        ]),
      ).resolves.toHaveLength(2);
    });

    it("adds a row for a slot the template did not fill", async () => {
      // The Saturday the seed leaves empty. A cell with no row is an ordinary
      // state, so filling it is an insert rather than an update.
      const { alice } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: 6,
        slot: "dinner",
        mealId: eggs,
      });

      const rows = await as(alice).select(schema.planTemplateEntries);

      expect(rows).toHaveLength(2);
      expect(rows.some((row) => row.dayOfWeek === 6 && row.slot === "dinner")).toBe(true);
    });

    it("leaves day_plan_overrides byte for byte unchanged", async () => {
      // The mirror image of swap.test.ts's "leaves plan_template_entries byte
      // for byte unchanged". Both halves of the override model are guarantees,
      // and they fail in opposite directions: a swap that wrote the template
      // would change every future week, and a template edit that wrote an
      // override would change today and nothing else.
      const { alice } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");

      const before = await as(alice).select(schema.dayPlanOverrides);

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      const after = await as(alice).select(schema.dayPlanOverrides);

      expect(after).toEqual(before);
      expect(before.length).toBeGreaterThan(0);
    });

    it("changes every future occurrence of that weekday", async () => {
      // What the screen's own copy promises: "changes apply to every future
      // week". Both dates are Mondays covered by the one entry.
      const { alice } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      const plan = await planFor(alice);

      expect(resolveSlot(plan, MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: eggs },
      });
      expect(resolveSlot(plan, NEXT_MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: eggs },
      });
    });

    it("does not reach a date that already carries an override", async () => {
      // The second sentence on the editor's header, and the half people get
      // wrong. Resolution consults `day_plan_overrides` first, so a swapped
      // Monday keeps its swap and the edit shows up on the Monday after.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's swapped breakfast");
      const eggs = await addMeal(alice, "Alice's new template breakfast");

      await writeOverride(alice.userId, {
        date: MONDAY,
        slot: "breakfast",
        mealId: curry,
      });
      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      const plan = await planFor(alice);

      expect(resolveSlot(plan, MONDAY, "breakfast")).toMatchObject({
        source: "override",
        meal: { id: curry },
      });
      expect(resolveSlot(plan, NEXT_MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: eggs },
      });
    });

    it("does not touch another user's template", async () => {
      // § 1.4's question, asked of the newest write in the app. Both users have
      // a Monday breakfast entry, so a statement missing its scope would land
      // on Bob's row as readily as on Alice's.
      const { alice, bob } = fixture;
      const eggs = await addMeal(alice, "Alice's second breakfast");

      const before = await as(bob).select(schema.planTemplateEntries);

      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      expect(await as(bob).select(schema.planTemplateEntries)).toEqual(before);
    });
  });

  describe("clearTemplateEntry", () => {
    it("removes the row for that weekday and slot", async () => {
      const { alice } = fixture;

      await expect(
        clearTemplateEntry(alice.userId, { dayOfWeek: MONDAY_DOW, slot: "breakfast" }),
      ).resolves.toBe(true);

      expect(await as(alice).select(schema.planTemplateEntries)).toHaveLength(0);
    });

    it("stops the weekday resolving to anything in that slot", async () => {
      // A cleared slot is not an error state — resolve-plan.ts treats a missing
      // row as an ordinary answer, which is what the half-empty weekend is.
      const { alice } = fixture;

      await clearTemplateEntry(alice.userId, { dayOfWeek: MONDAY_DOW, slot: "breakfast" });

      expect(resolveSlot(await planFor(alice), NEXT_MONDAY, "breakfast")).toBeNull();
    });

    it("empties a slot that holds more than one entry", async () => {
      // Deleting only the row the resolver serves would empty the cell on
      // screen and then refill it from a meal the user cannot see — which reads
      // as the control not working. "The template plans nothing here" is what
      // the words say.
      const { alice } = fixture;
      const second = await addMeal(alice, "Alice's second snack");

      await as(alice).insert(schema.planTemplateEntries, [
        { dayOfWeek: MONDAY_DOW, slot: "snack", mealId: alice.mealId, sortOrder: 0 },
        { dayOfWeek: MONDAY_DOW, slot: "snack", mealId: second, sortOrder: 1 },
      ]);

      await clearTemplateEntry(alice.userId, { dayOfWeek: MONDAY_DOW, slot: "snack" });

      expect(resolveSlot(await planFor(alice), NEXT_MONDAY, "snack")).toBeNull();
      // And nothing else went with them: breakfast is a different cell.
      expect(await as(alice).select(schema.planTemplateEntries)).toHaveLength(1);
    });

    it("reports that nothing was removed when the cell was already empty", async () => {
      const { alice } = fixture;

      await expect(
        clearTemplateEntry(alice.userId, { dayOfWeek: 6, slot: "dinner" }),
      ).resolves.toBe(false);
    });

    it("leaves the meal in the library", async () => {
      // § Buttons reserves `destructive` for Delete and discard, and this is
      // neither: the slot can be refilled from the same sheet, with the same
      // meal.
      const { alice } = fixture;

      await clearTemplateEntry(alice.userId, { dayOfWeek: MONDAY_DOW, slot: "breakfast" });

      const meals = await as(alice).select(schema.meals);

      expect(meals.some((meal) => meal.id === alice.mealId)).toBe(true);
    });

    it("does not touch another user's template", async () => {
      const { alice, bob } = fixture;

      const before = await as(bob).select(schema.planTemplateEntries);

      await clearTemplateEntry(alice.userId, { dayOfWeek: MONDAY_DOW, slot: "breakfast" });

      expect(await as(bob).select(schema.planTemplateEntries)).toEqual(before);
      expect(before.length).toBeGreaterThan(0);
    });
  });

  describe("loadTemplate", () => {
    it("returns this user's entries and library, and no one else's", async () => {
      const { alice, bob } = fixture;

      const { entries, meals } = await loadTemplate(alice.userId);

      expect(entries.every((entry) => entry.userId === alice.userId)).toBe(true);
      expect(meals.every((meal) => meal.userId === alice.userId)).toBe(true);
      expect(meals.some((meal) => meal.id === bob.mealId)).toBe(false);
    });
  });

  describe("a reverted override falls back to the template", () => {
    it("resolves to the template meal once the override row is gone", async () => {
      // FUEL-25's acceptance criterion: "reverting deletes the override row;
      // resolution falls back to the template". resolve-plan.test.ts's case 13
      // proves the resolver does it from a fixture; this proves the DELETE
      // leaves the database in the state that case describes.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's swapped breakfast");

      await writeOverride(alice.userId, {
        date: MONDAY,
        slot: "breakfast",
        mealId: curry,
      });

      const swapped = await planFor(alice);
      const override = resolveSlot(swapped, MONDAY, "breakfast");

      expect(override).toMatchObject({ source: "override", meal: { id: curry } });

      await deleteOverride(alice.userId, override?.entryId ?? "");

      const reverted = await planFor(alice);

      expect(resolveSlot(reverted, MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: alice.mealId },
      });
      // Nothing was restored, because nothing was overwritten. The row is
      // simply gone, and the template was there the whole time.
      expect(
        (await as(alice).select(schema.dayPlanOverrides)).some(
          (row) => row.date === MONDAY,
        ),
      ).toBe(false);
    });

    it("falls back to the template as it is NOW, not as it was when swapped", async () => {
      // The two halves of FUEL-25 meeting. A revert is a delete, not an undo
      // log — so a template edited in between is what the slot goes back to,
      // which is the behaviour the override model implies and the one a
      // restore-the-previous-meal implementation would get wrong.
      const { alice } = fixture;
      const curry = await addMeal(alice, "Alice's swapped breakfast");
      const eggs = await addMeal(alice, "Alice's new template breakfast");

      await writeOverride(alice.userId, {
        date: MONDAY,
        slot: "breakfast",
        mealId: curry,
      });
      await writeTemplateEntry(alice.userId, {
        dayOfWeek: MONDAY_DOW,
        slot: "breakfast",
        mealId: eggs,
      });

      const override = resolveSlot(await planFor(alice), MONDAY, "breakfast");

      await deleteOverride(alice.userId, override?.entryId ?? "");

      expect(resolveSlot(await planFor(alice), MONDAY, "breakfast")).toMatchObject({
        source: "template",
        meal: { id: eggs },
      });
    });
  });
});
