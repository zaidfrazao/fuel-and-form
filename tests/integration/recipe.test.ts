import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { recordLog } from "@/lib/db/queries/log";
import { loadEditableRecipe, loadRecipe, saveRecipe } from "@/lib/db/queries/recipe";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import type { IngredientEdit, RecipeEdit } from "@/lib/recipe-edit";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * `/recipe/[mealId]`'s read against a real Postgres — FUEL-143.
 *
 * The page test mocks this module, so it can only prove that an `undefined`
 * becomes a 404. Whether another account's meal ever comes back as `undefined`
 * is a property of the scoped WHERE clause, and only a database can answer it.
 */

const configured = testDatabaseUrl() !== undefined;

describe.skipIf(!configured)("loadRecipe, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  it("reads a user's own meal and its ingredients", async () => {
    const recipe = await loadRecipe(fixture.alice.userId, fixture.alice.mealId);

    expect(recipe?.meal.id).toBe(fixture.alice.mealId);
    expect(recipe?.ingredients.length).toBeGreaterThan(0);
  });

  it("does not read another account's meal, in either direction", async () => {
    expect(await loadRecipe(fixture.bob.userId, fixture.alice.mealId)).toBeUndefined();
    expect(await loadRecipe(fixture.alice.userId, fixture.bob.mealId)).toBeUndefined();
    // The owner's read, which also carries the draft, is scoped the same way.
    expect(await loadEditableRecipe(fixture.alice.userId, fixture.bob.mealId)).toBeUndefined();
  });

  it("answers a malformed id without asking Postgres to cast it", async () => {
    // Unguarded, this is `invalid input syntax for type uuid` — a 500, not a 404.
    expect(await loadRecipe(fixture.alice.userId, "not-a-uuid")).toBeUndefined();
  });

  it("orders ingredients by the recipe's sort order, and crosses no shop field", async () => {
    const owned = scope(fixture.alice.userId, getDb());

    // Inserted out of order, so a read that ignored `sort_order` would fail.
    await owned.insert(schema.mealIngredients, [
      { mealId: fixture.alice.mealId, name: "Third", sortOrder: 30, shopName: "Shop third" },
      { mealId: fixture.alice.mealId, name: "Second", sortOrder: 20, nonScaleMeasure: "1 tsp" },
    ]);

    const recipe = await loadRecipe(fixture.alice.userId, fixture.alice.mealId);
    const names = recipe!.ingredients.map((row) => row.name);

    expect(names.indexOf("Second")).toBeLessThan(names.indexOf("Third"));
    for (const row of recipe!.ingredients) {
      expect(Object.keys(row).sort()).toEqual(["grams", "id", "name", "nonScaleMeasure"]);
    }
  });
});

/**
 * The recipe edit's write — FUEL-147.
 *
 * Mocked in the action's test, so what only Postgres can answer is here: that
 * the update is the ownership check, that the transaction is whole, that a
 * kept row keeps its id, and that an empty list is not sent to the driver.
 */
describe.skipIf(!configured)("saveRecipe, scoped and whole", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  const row = (over: Partial<IngredientEdit> = {}): IngredientEdit => ({
    id: null,
    name: "Oats",
    nonScaleMeasure: "1/2 cup",
    grams: 40,
    shopName: null,
    shopQty: 40,
    shopUnit: "g",
    category: "dry goods",
    pantry: false,
    ...over,
  });

  const edit = (ingredients: IngredientEdit[]): RecipeEdit => ({
    meal: {
      name: "Edited porridge",
      kcal: 610,
      proteinG: 41,
      fatG: 14,
      carbG: 77,
      method: "Soak.\nCook.",
      notes: null,
    },
    ingredients,
  });

  const ingredientsOf = (userId: string, mealId: string) =>
    scope(userId, getDb()).select(
      schema.mealIngredients,
      eq(schema.mealIngredients.mealId, mealId),
    );

  it("writes the meal and replaces its ingredients, in the order given", async () => {
    const { userId, mealId } = fixture.alice;

    expect(
      await saveRecipe(userId, mealId, edit([row({ name: "Milk" }), row({ name: "Oats" })])),
    ).toBe(true);

    const loaded = await loadEditableRecipe(userId, mealId);

    expect(loaded?.recipe.meal).toMatchObject(edit([]).meal);
    expect(loaded?.recipe.ingredients.map((r) => r.name)).toEqual(["Milk", "Oats"]);
    expect(loaded?.draft.ingredients[1]).toMatchObject({ shopQty: "40", shopUnit: "g" });
  });

  it("keeps a stored row's id, and gives a forged or repeated claim a fresh one", async () => {
    const { userId, mealId } = fixture.alice;
    const [first] = await ingredientsOf(userId, mealId);
    const [foreign] = await ingredientsOf(fixture.bob.userId, fixture.bob.mealId);

    await saveRecipe(
      userId,
      mealId,
      edit([
        row({ id: first!.id, name: "Kept" }),
        row({ id: first!.id, name: "Second claim" }),
        row({ id: foreign!.id, name: "Forged" }),
      ]),
    );

    const after = await ingredientsOf(userId, mealId);
    const byName = Object.fromEntries(after.map((r) => [r.name, r.id]));

    expect(byName.Kept).toBe(first!.id);
    expect(byName["Second claim"]).not.toBe(first!.id);
    expect(byName.Forged).not.toBe(foreign!.id);

    // Bob's row is where it was, still his.
    expect(await ingredientsOf(fixture.bob.userId, fixture.bob.mealId)).toContainEqual(foreign);
  });

  it("accepts an empty list without sending an empty insert", async () => {
    const { userId, mealId } = fixture.alice;

    expect(await saveRecipe(userId, mealId, edit([]))).toBe(true);
    expect(await ingredientsOf(userId, mealId)).toEqual([]);
  });

  it("writes nothing to another account's meal, and says so", async () => {
    const before = await loadEditableRecipe(fixture.bob.userId, fixture.bob.mealId);

    expect(await saveRecipe(fixture.alice.userId, fixture.bob.mealId, edit([row()]))).toBe(false);
    expect(await loadEditableRecipe(fixture.bob.userId, fixture.bob.mealId)).toEqual(before);
  });

  it("refuses a malformed id without asking Postgres to cast it", async () => {
    expect(await saveRecipe(fixture.alice.userId, "not-a-uuid", edit([]))).toBe(false);
  });

  it("rolls the meal back when an ingredient row is refused", async () => {
    const { userId, mealId } = fixture.alice;
    const before = await loadEditableRecipe(userId, mealId);

    // Past the parser, a unit without a count is the column CHECK's to refuse.
    await expect(
      saveRecipe(userId, mealId, edit([row(), row({ shopQty: null, shopUnit: "g" })])),
    ).rejects.toThrow();

    expect(await loadEditableRecipe(userId, mealId)).toEqual(before);
  });

  it("leaves a logged day's figures where they were", async () => {
    const { userId, mealId } = fixture.alice;
    const logged = { kcal: 420, proteinG: 24, fatG: 12, carbG: 55 };

    await recordLog(userId, {
      kind: "meal",
      date: "2026-03-03",
      slot: "lunch",
      mealId,
      status: "eaten",
      ...logged,
    });

    await saveRecipe(userId, mealId, edit([row()]));

    const logs = await scope(userId, getDb()).select(
      schema.mealLogs,
      eq(schema.mealLogs.date, "2026-03-03"),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject(logged);
  });
});
