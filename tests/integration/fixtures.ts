import { startOfWeek } from "@/lib/date";
import { getPool } from "@/lib/db/pool";
import { scope } from "@/lib/db/scope";
import * as schema from "@/lib/db/schema";
import type { UserKind } from "@/lib/db/schema";

/**
 * Two users, each owning a row in every user-owned table.
 *
 * ## Why every table
 *
 * Testing Strategy § 1.4 case 3 asks whether an export can reach another user's
 * data, and an export reads everything its caller owns. A sweep over eleven
 * tables proves nothing if nine of them are empty — an empty table cannot leak,
 * so the assertion would pass vacuously and keep passing after a real
 * regression. Seeding all of them is what makes the sweep in scope.test.ts mean
 * something, which is why that file also fails when a table comes back empty.
 *
 * ## Why it goes through `scope()`
 *
 * The fixture writes the way the application writes. Seeding by raw insert would
 * let the tests pass while the scope's own insert path was broken, and it would
 * be a second way to write rows — the exact thing scope.ts argues against. Only
 * `users` is inserted directly, because it carries no `user_id` to scope by.
 *
 * ## Why one transaction
 *
 * Twelve statements per user over the HTTP driver is twelve round trips, once
 * per test. The pooled handle runs them in one session instead, which is both
 * faster and the shape demo provisioning (FUEL-40) will use for real.
 *
 * ## No real figures
 *
 * Every number here is invented and deliberately unlike the owner's own: this
 * repository is public, and `scripts/check-no-metrics.sh` (FUEL-16) will scan
 * for the real ones. Body metrics in tests are fixtures, never data.
 */

/** What a test needs to name the rows a seeded user owns. */
export type SeededUser = {
  /** The `users.id` every one of this user's rows carries. */
  userId: string;
  /** This user's only meal — the target of their plan, override and log rows. */
  mealId: string;
  /** This user's only workout — the target of their template and log rows. */
  workoutId: string;
  /** The weigh-in date already taken, so a test can pick an unused one. */
  weighInDate: string;
};

/** Distinct dates per user, so a shared date can never be what makes a match. */
const ALICE_DATE = "2026-03-02";
const BOB_DATE = "2026-03-03";

/**
 * The rotation group both users use.
 *
 * The same string on purpose: isolation must come from `user_id`, not from the
 * two users happening to name their workouts differently.
 */
const ROTATION_GROUP = "bodyweight-circuit";

type Tx = Parameters<Parameters<ReturnType<typeof getPool>["transaction"]>[0]>[0];

/**
 * The row an insert's `returning()` just produced.
 *
 * `noUncheckedIndexedAccess` is on, so the row is typed as possibly missing.
 * Throwing beats a non-null assertion: if an insert ever returns nothing, the
 * failure names the fixture rather than surfacing as a null-property error
 * inside whichever test happened to run first.
 */
function inserted<T>(rows: T[], what: string): T {
  const row = rows.at(0);

  if (!row) throw new Error(`Fixture insert of ${what} returned no row.`);

  return row;
}

/**
 * Creates one user and a full set of rows beneath it.
 *
 * `expiresAt` is null for an owner and a real instant for a demo session — the
 * column that lets a session layer tell "demo" from "demo that has run out".
 */
async function seedUser(
  tx: Tx,
  options: { kind: UserKind; name: string; date: string; expiresAt?: Date },
): Promise<SeededUser> {
  const user = inserted(
    await tx
      .insert(schema.users)
      .values({
        kind: options.kind,
        displayName: options.name,
        expiresAt: options.expiresAt ?? null,
      })
      .returning(),
    "users",
  );

  const owned = scope(user.id, tx);

  await owned.insert(schema.profiles, {
    heightCm: 170,
    startWeightKg: 80,
    targetWeightKg: 72,
    goalPaceKgPerWeek: 0.5,
    targetKcal: 2100,
    targetProteinG: 130,
    targetFatG: 65,
    targetCarbG: 220,
    slotTimes: { breakfast: "07:30", dinner: "19:00" },
    programStartDate: "2026-01-05",
    timezone: "Europe/London",
  });

  const meal = inserted(
    await owned.insert(schema.meals, {
      name: `${options.name}'s porridge`,
      slotType: "breakfast",
      kcal: 420,
      proteinG: 24,
      fatG: 12,
      carbG: 55,
    }),
    "meals",
  );

  await owned.insert(schema.mealIngredients, {
    mealId: meal.id,
    name: "Rolled oats",
    grams: 80,
  });

  await owned.insert(schema.planTemplateEntries, {
    dayOfWeek: 1,
    slot: "breakfast",
    mealId: meal.id,
  });

  await owned.insert(schema.dayPlanOverrides, {
    date: options.date,
    slot: "breakfast",
    mealId: meal.id,
  });

  await owned.insert(schema.mealLogs, {
    date: options.date,
    slot: "breakfast",
    mealId: meal.id,
    status: "eaten",
  });

  const workout = inserted(
    await owned.insert(schema.workouts, {
      name: `${options.name}'s circuit`,
      type: "circuit",
      rotationGroup: ROTATION_GROUP,
      rotationIndex: 0,
    }),
    "workouts",
  );

  await owned.insert(schema.workoutExercises, {
    workoutId: workout.id,
    name: "Press-ups",
    prescription: "3 x 12",
  });

  // Names the rotation group rather than the workout: the check constraint
  // makes that an exclusive choice, and the group is the case the resolver
  // (FUEL-9) actually exercises.
  await owned.insert(schema.trainingTemplateEntries, {
    dayOfWeek: 1,
    rotationGroup: ROTATION_GROUP,
  });

  await owned.insert(schema.workoutLogs, {
    date: options.date,
    workoutId: workout.id,
    status: "done",
  });

  await owned.insert(schema.weightLogs, {
    date: options.date,
    weightKg: 79.4,
  });

  // Ticked against the week the fixture's date falls in, and keyed on the
  // NORMALISED spelling of the ingredient seeded above — `shopping-list.ts`
  // lowercases and collapses, so "Rolled oats" is stored as "rolled oats" and a
  // row that copied the display casing would join to nothing.
  await owned.insert(schema.shoppingChecks, {
    weekStart: startOfWeek(options.date),
    itemKey: "rolled oats",
  });

  // A push subscription, so the leak sweep over `push_subscriptions` has a row
  // to be wrong about. The endpoint is namespaced by the user id on purpose:
  // the table is unique on `(user_id, endpoint)`, so two fixture users sharing
  // one literal endpoint would be a legal pair of rows — but it would also make
  // the sweep's "did Alice see Bob's row" question answerable by coincidence,
  // since the two rows would then differ only in a column the assertion reads.
  // Distinct endpoints mean a leak shows up as a value that could not be
  // Alice's under any reading.
  await owned.insert(schema.pushSubscriptions, {
    endpoint: `https://push.example.test/${user.id}`,
    p256dh: "fixture-p256dh",
    auth: "fixture-auth",
  });

  return {
    userId: user.id,
    mealId: meal.id,
    workoutId: workout.id,
    weighInDate: options.date,
  };
}

/** The users a § 1.4 test works with. */
export type Fixture = {
  /** The owner — "the data a stranger must never reach". */
  alice: SeededUser;
  /** A live demo session, the stranger. */
  bob: SeededUser;
  /** A demo session whose `expires_at` is in the past. See § 1.4 case 5. */
  expired: SeededUser;
};

/**
 * Seeds all three users in a single transaction.
 *
 * Two would be enough for cases 1–4; the third exists so case 5 can ask what an
 * expired session can still reach without inventing a session layer that does
 * not exist yet.
 */
export async function seedFixture(): Promise<Fixture> {
  return getPool().transaction(async (tx) => ({
    alice: await seedUser(tx, { kind: "owner", name: "Alice", date: ALICE_DATE }),
    bob: await seedUser(tx, { kind: "demo", name: "Bob", date: BOB_DATE }),
    expired: await seedUser(tx, {
      kind: "demo",
      name: "Expired",
      date: "2026-03-04",
      expiresAt: new Date("2026-03-05T00:00:00Z"),
    }),
  }));
}
