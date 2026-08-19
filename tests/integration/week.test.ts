import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { writeOverride } from "@/lib/db/queries/swap";
import { loadWeek } from "@/lib/db/queries/week";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * The weekly grid's read against a real Postgres — FUEL-28.
 *
 * `src/app/actions/plan.test.ts` proves the actions refuse the wrong caller and
 * derive the right row, with every collaborator mocked; that is a claim about
 * control flow. `tests/integration/swap.test.ts` proves the WRITE behaves once
 * Postgres executes it. What is left, and what this file is for, are the three
 * properties of the READ that only a database can answer:
 *
 *   - the date range genuinely BOUNDS the overrides fetched. A `BETWEEN` whose
 *     operands were the wrong way round, or which compared a date column
 *     against a mis-formatted string, would still build a statement that looked
 *     right — and would silently pull a neighbouring week's swaps into this
 *     one, or drop this one's. Both render as a plausible plan.
 *   - the scope holds across seven dates. `scope.test.ts` proves it for a
 *     single read; this is the first query in the app that narrows on a second
 *     column at the same time, and a `user_id` predicate lost to an `and()`
 *     rearrangement would be invisible until a stranger saw the owner's week.
 *   - `templateDays` really does ignore overrides. It is what a revert restores
 *     to, so a version that leaked the override would show the user reverting
 *     to the thing they were reverting from.
 *
 * ## The dates
 *
 * The fixture seeds each user a Monday-breakfast TEMPLATE entry and an override
 * on their own date (Alice 2026-03-02, Bob 2026-03-03). Everything below works
 * on the week of Monday 2026-03-09, a week later, so nothing asserted here can
 * be an accident of the seeded override — and that seeded row doubles as the
 * out-of-range control the narrowing has to exclude.
 */

const configured = testDatabaseUrl() !== undefined;

/** The Monday under test, and its Sunday. A week after the fixture's rows. */
const MONDAY = "2026-03-09";
const WEDNESDAY = "2026-03-11";
const SUNDAY = "2026-03-15";
/** The Monday after — outside the week, and the first date the range must drop. */
const NEXT_MONDAY = "2026-03-16";

/** Any instant on the Monday. `loadWeek` only reads it to derive "today". */
const NOON = new Date("2026-03-09T12:00:00Z");

describe.skipIf(!configured)("loading a week, scoped", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** A second meal for Alice, so a swap has somewhere to go. */
  async function altMeal(): Promise<string> {
    const [meal] = await scope(fixture.alice.userId, getDb()).insert(schema.meals, {
      name: "Chickpea Curry",
      slotType: "dinner",
      kcal: 560,
      proteinG: 24,
      fatG: 18,
      carbG: 70,
    });

    return meal!.id;
  }

  it("returns the seven days of the week the anchor falls in", async () => {
    const week = await loadWeek(fixture.alice.userId, NOON, WEDNESDAY);

    // A midweek anchor names the same seven days as its Monday — which is what
    // lets `?week=` carry a date a human might type.
    expect(week?.monday).toBe(MONDAY);
    expect(week?.days.map((day) => day.date)).toEqual([
      MONDAY,
      "2026-03-10",
      WEDNESDAY,
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      SUNDAY,
    ]);
  });

  it("bounds the overrides it fetches to those seven dates", async () => {
    const mealId = await altMeal();

    // One inside the week, one the day after it, and the fixture's own from the
    // week before. Only the first may reach the resolved week.
    await writeOverride(fixture.alice.userId, {
      date: WEDNESDAY,
      slot: "dinner",
      mealId,
    });
    await writeOverride(fixture.alice.userId, {
      date: NEXT_MONDAY,
      slot: "dinner",
      mealId,
    });

    const week = await loadWeek(fixture.alice.userId, NOON, MONDAY);

    const swapped = week!.days
      .filter((day) => day.meals.some((meal) => meal.source === "override"))
      .map((day) => day.date);

    expect(swapped).toEqual([WEDNESDAY]);
  });

  it("keeps the last day of the week, which an off-by-one would drop", async () => {
    const mealId = await altMeal();

    await writeOverride(fixture.alice.userId, { date: SUNDAY, slot: "dinner", mealId });

    const week = await loadWeek(fixture.alice.userId, NOON, MONDAY);

    const sunday = week!.days.find((day) => day.date === SUNDAY);

    // An exclusive upper bound would lose exactly this row and nothing else,
    // which is the kind of error that survives every other assertion here.
    expect(sunday?.meals.some((meal) => meal.source === "override")).toBe(true);
  });

  it("shows one user nothing of another's week", async () => {
    const mealId = await altMeal();

    await writeOverride(fixture.alice.userId, {
      date: WEDNESDAY,
      slot: "dinner",
      mealId,
    });

    const bobs = await loadWeek(fixture.bob.userId, NOON, MONDAY);

    // Bob's own week resolves; none of Alice's rows are in it. § 1.4's promise,
    // now across a query that narrows on a date range as well as an owner.
    expect(bobs).toBeDefined();
    expect(
      bobs!.days.some((day) => day.meals.some((meal) => meal.meal.id === mealId)),
    ).toBe(false);
    expect(bobs!.meals.some((meal) => meal.id === mealId)).toBe(false);
  });

  it("resolves the template on every day the template covers", async () => {
    // The fixture plans Monday breakfast. It recurs, so the Monday in this week
    // carries it even though the seeded override is a week earlier.
    const week = await loadWeek(fixture.alice.userId, NOON, MONDAY);

    const monday = week!.days.find((day) => day.date === MONDAY);

    expect(monday?.meals).toHaveLength(1);
    expect(monday?.meals[0]?.slot).toBe("breakfast");
    expect(monday?.meals[0]?.source).toBe("template");
  });

  it("templateDays ignores the overrides that days carries", async () => {
    const mealId = await altMeal();

    // Swap the very slot the template fills, so the two answers must differ.
    await writeOverride(fixture.alice.userId, {
      date: MONDAY,
      slot: "breakfast",
      mealId,
    });

    const week = await loadWeek(fixture.alice.userId, NOON, MONDAY);

    const resolved = week!.days.find((day) => day.date === MONDAY)?.meals[0];
    const template = week!.templateDays.find((day) => day.date === MONDAY)?.meals[0];

    expect(resolved?.source).toBe("override");
    expect(resolved?.meal.id).toBe(mealId);

    // What a revert restores. If this leaked the override the user would be
    // shown reverting to the thing they were reverting from.
    expect(template?.source).toBe("template");
    expect(template?.meal.id).toBe(fixture.alice.mealId);
  });

  it("leaves plan_template_entries untouched when a date is swapped", async () => {
    const mealId = await altMeal();

    const before = await scope(fixture.alice.userId, getDb()).select(
      schema.planTemplateEntries,
    );

    await writeOverride(fixture.alice.userId, {
      date: MONDAY,
      slot: "breakfast",
      mealId,
    });

    const after = await scope(fixture.alice.userId, getDb()).select(
      schema.planTemplateEntries,
    );

    // P2's central guarantee, now reachable from a second screen. Row for row.
    expect(after).toEqual(before);
  });

  it("the same weekday next week still resolves to the template", async () => {
    const mealId = await altMeal();

    await writeOverride(fixture.alice.userId, {
      date: MONDAY,
      slot: "breakfast",
      mealId,
    });

    const next = await loadWeek(fixture.alice.userId, NOON, NEXT_MONDAY);

    const monday = next!.days.find((day) => day.date === NEXT_MONDAY);

    expect(monday?.meals[0]?.source).toBe("template");
    expect(monday?.meals[0]?.meal.id).toBe(fixture.alice.mealId);
  });

  it("has no week for a user with no profile row", async () => {
    // A user exists before it is set up. Without a timezone there is no day
    // boundary and so no week to be in — an ordinary state, not an error.
    await scope(fixture.alice.userId, getDb()).delete(schema.profiles);

    await expect(loadWeek(fixture.alice.userId, NOON)).resolves.toBeUndefined();
  });

  it("defaults to the week containing today, in the profile's zone", async () => {
    const week = await loadWeek(fixture.alice.userId, NOON);

    // Europe/London on the fixture, so noon UTC is the same date. The point is
    // that the date comes from the PROFILE rather than the server's zone —
    // the suite runs in New York, where a server-zone reading would be the 9th
    // at noon but the 8th at 02:00 UTC.
    expect(week?.today).toBe(MONDAY);
    expect(week?.monday).toBe(MONDAY);
  });
});
