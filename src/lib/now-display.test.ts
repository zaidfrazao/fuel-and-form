import { describe, expect, test } from "vitest";

import type { Meal, MealSlot, Workout } from "@/lib/db/schema";
import { itemLabel, itemName, rulerSlots } from "@/lib/now-display";
import type { NowItem, ScheduledItem } from "@/lib/resolve-now";

/**
 * The presentation half of P1 — what a resolved item is called, and where its
 * mark goes on the ruler.
 *
 * Worth its own suite rather than being asserted through the rendered screen:
 * these are total functions over the item union, so a slot label that goes
 * missing is a failing case here instead of an empty span someone has to notice
 * in a snapshot.
 */

const USER = "user-owner";

function meal(fields: Partial<Meal> = {}): Meal {
  return {
    id: "meal-1",
    userId: USER,
    name: "Overnight oats",
    slotType: "breakfast",
    kcal: 420,
    proteinG: 32,
    fatG: 12,
    carbG: 48,
    method: null,
    notes: null,
    isArchived: false,
    ...fields,
  };
}

function workout(fields: Partial<Workout> = {}): Workout {
  return {
    id: "workout-1",
    userId: USER,
    name: "Circuit A",
    type: "circuit",
    description: null,
    rotationGroup: null,
    rotationIndex: null,
    ...fields,
  };
}

const mealItem = (slot: MealSlot, fields: Partial<Meal> = {}): NowItem => ({
  kind: "meal",
  meal: { slot, meal: meal(fields), source: "template", entryId: "entry-1" },
});

const workoutItem = (fields: Partial<Workout> = {}): NowItem => ({
  kind: "workout",
  workout: { workout: workout(fields), source: "fixed", entryId: "entry-2" },
});

/** A scheduled item, for the ruler. */
const scheduled = (item: NowItem, key: string, at: string, minutes: number): ScheduledItem => ({
  ...item,
  key,
  at,
  minutes,
});

describe("itemName", () => {
  test("a meal is named by its meal", () => {
    expect(itemName(mealItem("breakfast"))).toBe("Overnight oats");
  });

  test("a session is named by its workout", () => {
    expect(itemName(workoutItem())).toBe("Circuit A");
  });

  test("the name follows a swap, not the slot", () => {
    expect(itemName(mealItem("dinner", { name: "Chilli" }))).toBe("Chilli");
  });
});

describe("itemLabel", () => {
  const SLOTS: [MealSlot, string][] = [
    ["breakfast", "Breakfast"],
    ["lunch", "Lunch"],
    ["snack", "Snack"],
    ["dinner", "Dinner"],
    ["extra", "Extra"],
  ];

  test.each(SLOTS)("%s is labelled %s", (slot, label) => {
    expect(itemLabel(mealItem(slot))).toBe(label);
  });

  test("every slot in the enum has a label", () => {
    // The record is keyed by `MealSlot`, so a slot added to the enum is a
    // compile error rather than an empty eyebrow — this asserts the runtime
    // half, that no label is blank.
    for (const [slot] of SLOTS) {
      expect(itemLabel(mealItem(slot))).not.toBe("");
    }
  });

  test("a session is labelled Training regardless of its type", () => {
    expect(itemLabel(workoutItem({ type: "circuit" }))).toBe("Training");
    expect(itemLabel(workoutItem({ type: "intervals" }))).toBe("Training");
    // `workouts.type` is free text precisely so a future 'strength' needs no
    // migration. The eyebrow must not be the place that has to learn about it.
    expect(itemLabel(workoutItem({ type: "strength" }))).toBe("Training");
  });
});

describe("rulerSlots", () => {
  const TIMELINE: ScheduledItem[] = [
    scheduled(mealItem("extra", { name: "Coffee" }), "meal:e1", "06:00", 360),
    scheduled(mealItem("breakfast"), "meal:e2", "07:00", 420),
    scheduled(workoutItem(), "workout:e3", "17:30", 1050),
  ];

  test("carries the item's key, name and minute across", () => {
    expect(rulerSlots(TIMELINE)).toEqual([
      { id: "meal:e1", label: "Coffee", minutes: 360, status: "upcoming" },
      { id: "meal:e2", label: "Overnight oats", minutes: 420, status: "upcoming" },
      { id: "workout:e3", label: "Circuit A", minutes: 1050, status: "upcoming" },
    ]);
  });

  test("keys the mark by the ENTRY, so a swap keeps its position", () => {
    // Same entry, different meal — which is exactly what a swap produces. The
    // mark's identity has to survive it, or React remounts it as a new one.
    const swapped = [scheduled(mealItem("dinner", { id: "meal-9", name: "Chilli" }), "meal:e1", "19:00", 1140)];

    expect(rulerSlots(swapped)[0]?.id).toBe("meal:e1");
  });

  test("reports no status until logs exist", () => {
    // Every mark is `upcoming` — the one of the three statuses that claims
    // nothing about `meal_logs`, which nothing writes until FUEL-19. See the
    // note on rulerSlots.
    expect(rulerSlots(TIMELINE).every((slot) => slot.status === "upcoming")).toBe(true);
  });

  test("preserves the timeline's order rather than re-sorting", () => {
    // `buildTimeline` has already ordered by the clock with a total tie-break,
    // and re-sorting here would be a second, weaker copy of that ordering.
    expect(rulerSlots(TIMELINE).map((slot) => slot.minutes)).toEqual([360, 420, 1050]);
  });

  test("an empty day has no marks", () => {
    expect(rulerSlots([])).toEqual([]);
  });
});
