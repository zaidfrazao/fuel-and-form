import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { loadRecipe } from "@/lib/db/queries/recipe";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

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
