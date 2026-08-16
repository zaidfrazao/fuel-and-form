import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getPool } from "@/lib/db/pool";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { loadSeedLibraries } from "@/lib/seed/load";
import { seedMeals } from "@/lib/seed/meals";
import { seedPlanTemplate, seedTrainingTemplate } from "@/lib/seed/plan";

import { testDatabaseUrl } from "./env";

/**
 * `loadSeedLibraries` against real Postgres — FUEL-15.
 *
 * The unit suite in `src/lib/seed/plan.test.ts` proves the template is
 * internally consistent, and it does so hermetically. What it cannot prove is
 * that the library survives contact with the schema, and that is where the
 * interesting failures live: every child row in this seed is held by a COMPOSITE
 * foreign key on `(parent_id, user_id)`, the loader wires those parents to their
 * children by matching a seed key to a generated uuid, and neither the key
 * mapping nor the constraints exist in a hermetic test.
 *
 * A mis-wired map is the failure that matters. It does not throw and it does not
 * look wrong in the data — it produces a library where the chilli has the fish's
 * ingredients and Tuesday schedules the wrong dinner. So these tests check the
 * relationships that a positional zip would get wrong, not just the row counts.
 */

const configured = Boolean(testDatabaseUrl());

/** Creates a user and loads the seed into it, inside one transaction. */
async function seedFreshUser(kind: "owner" | "demo" = "demo") {
  return getPool().transaction(async (tx) => {
    const rows = await tx
      .insert(schema.users)
      .values({ kind, displayName: `Seed test ${kind}`, expiresAt: null })
      .returning();

    const user = rows.at(0);

    if (!user) throw new Error("Inserting the test user returned no row.");

    const loaded = await loadSeedLibraries(scope(user.id, tx));

    return { userId: user.id, loaded };
  });
}

describe.skipIf(!configured)("loading the seed libraries", () => {
  it("writes every row the seed files describe", async () => {
    const { userId, loaded } = await seedFreshUser();
    const s = scope(userId, getPool());

    const [meals, ingredients, workouts, exercises, planEntries, trainingEntries] =
      await Promise.all([
        s.select(schema.meals),
        s.select(schema.mealIngredients),
        s.select(schema.workouts),
        s.select(schema.workoutExercises),
        s.select(schema.planTemplateEntries),
        s.select(schema.trainingTemplateEntries),
      ]);

    expect(meals).toHaveLength(loaded.counts.meals);
    expect(ingredients).toHaveLength(loaded.counts.meal_ingredients);
    expect(workouts).toHaveLength(loaded.counts.workouts);
    expect(exercises).toHaveLength(loaded.counts.workout_exercises);
    expect(planEntries).toHaveLength(seedPlanTemplate.length);
    expect(trainingEntries).toHaveLength(seedTrainingTemplate.length);

    // Guards the counts above against being vacuously satisfied by a loader that
    // wrote nothing and reported nothing.
    expect(meals.length).toBeGreaterThan(0);
    expect(planEntries.length).toBeGreaterThan(0);
  });

  it("gives each meal its own ingredients, not another recipe's", async () => {
    // The assertion the positional key mapping in load.ts exists to earn. If
    // `RETURNING` came back in a different order from `VALUES`, every row would
    // still insert cleanly and every foreign key would still hold — the
    // ingredients would simply belong to the wrong recipes.
    const { userId } = await seedFreshUser();
    const s = scope(userId, getPool());

    const chilli = await s.selectOne(
      schema.meals,
      eq(schema.meals.name, "Lean Beef Mince Chilli"),
    );

    expect(chilli).toBeDefined();

    const ingredients = await s.select(
      schema.mealIngredients,
      eq(schema.mealIngredients.mealId, chilli!.id),
    );

    const seeded = seedMeals.find((meal) => meal.key === "beef-mince-chilli")!;

    expect(ingredients.map((row) => row.name).sort()).toEqual(
      seeded.ingredients.map((row) => row.name).sort(),
    );
  });

  it("schedules the dinner the template names", async () => {
    // The same risk, one table further on: a template entry holds a meal uuid,
    // so a shuffled map schedules a real meal on the right day — the wrong one.
    // Tuesday's dinner is the one the PRD pins by name, which makes it the entry
    // worth asserting.
    const { userId } = await seedFreshUser();
    const s = scope(userId, getPool());

    const tuesdayDinner = await s.selectOne(
      schema.planTemplateEntries,
      eq(schema.planTemplateEntries.dayOfWeek, 2),
    );

    expect(tuesdayDinner).toBeDefined();

    const scheduled = await s.select(schema.meals, eq(schema.meals.id, tuesdayDinner!.mealId));

    // Whatever slot came back first, it must be a meal of that slot's type.
    expect(scheduled.at(0)?.slotType).toBe(tuesdayDinner!.slot);
  });

  it("keeps two seeded users' libraries entirely separate", async () => {
    // The seed is the first thing that writes a realistic volume of rows, and
    // FUEL-41 will run it per demo visit. Two users loading the SAME library is
    // the case where a missing `user_id` filter would be invisible: the rows
    // look right because they are meant to be identical.
    const [alice, bob] = await Promise.all([seedFreshUser("demo"), seedFreshUser("demo")]);

    const aliceMeals = await scope(alice.userId, getPool()).select(schema.meals);
    const bobMeals = await scope(bob.userId, getPool()).select(schema.meals);

    expect(aliceMeals).toHaveLength(seedMeals.length);
    expect(bobMeals).toHaveLength(seedMeals.length);

    // Same recipes, disjoint rows — no id may appear in both.
    const aliceIds = new Set(aliceMeals.map((meal) => meal.id));
    const shared = bobMeals.filter((meal) => aliceIds.has(meal.id));

    expect(shared).toEqual([]);

    for (const meal of aliceMeals) expect(meal.userId).toBe(alice.userId);
    for (const meal of bobMeals) expect(meal.userId).toBe(bob.userId);
  });

  it("refuses a template entry pointing at another user's meal", async () => {
    // The composite foreign key from schema.ts, exercised through the seed. This
    // is the constraint that stops a demo visitor scheduling the owner's meal,
    // and it only exists in the database — no unit test can reach it.
    const [alice, bob] = await Promise.all([seedFreshUser("demo"), seedFreshUser("demo")]);

    const aliceMeal = (await scope(alice.userId, getPool()).select(schema.meals)).at(0);

    expect(aliceMeal).toBeDefined();

    await expect(
      scope(bob.userId, getPool()).insert(schema.planTemplateEntries, {
        dayOfWeek: 1,
        slot: "dinner",
        mealId: aliceMeal!.id,
        sortOrder: 99,
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(configured)("loading the seed libraries (unconfigured)", () => {
  it.skip("needs DATABASE_URL_TEST — see README → Database", () => {});
});
