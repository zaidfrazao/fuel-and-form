import { describe, expect, test } from "vitest";

import type { Meal, MealSlot, Workout } from "@/lib/db/schema";
import { positionInSpan } from "@/components/day-ruler";
import {
  dayLabel,
  entryLabel,
  itemLabel,
  itemName,
  rulerSlots,
  slotLabel,
  weekFolio,
  weekLabel,
} from "@/lib/now-display";
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

  test("repositions its ticks when a slot time changes — FUEL-21", () => {
    // The acceptance criterion, pinned across the whole chain rather than at
    // either end of it: a stored slot time becomes a `Schedule`, a `Schedule`
    // becomes a timeline minute, and the minute becomes a percentage along the
    // ruler. Nothing in the ruler had to change for this to work, which is
    // exactly the claim worth a test — the tick positions derive from the
    // configured times, so a settings edit moves them and no component caches
    // a position that could disagree.
    const before = rulerSlots(TIMELINE);
    const moved = rulerSlots([
      ...TIMELINE.slice(0, 1),
      scheduled(mealItem("breakfast"), "meal:e2", "09:00", 540),
      ...TIMELINE.slice(2),
    ]);

    expect(before[1]!.minutes).toBe(420);
    expect(moved[1]!.minutes).toBe(540);
    expect(positionInSpan(moved[1]!.minutes)).toBeGreaterThan(
      positionInSpan(before[1]!.minutes),
    );
    // The other two marks stay put — one edited row moves one tick.
    expect(moved.map((slot) => slot.minutes).filter((_, i) => i !== 1)).toEqual(
      before.map((slot) => slot.minutes).filter((_, i) => i !== 1),
    );
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

describe("slotLabel", () => {
  test("names every slot the schema has", () => {
    // Total over the enum, so a slot added without a label is a failing case
    // here rather than an empty eyebrow somebody has to notice on a screen.
    const slots: MealSlot[] = ["extra", "breakfast", "snack", "lunch", "dinner"];

    expect(slots.map(slotLabel)).toEqual(["Extra", "Breakfast", "Snack", "Lunch", "Dinner"]);
  });

  test("agrees with the label the active card shows", () => {
    // Two callers, one word for breakfast — the summary names a log whose meal
    // is gone by its slot, and it must not invent a second vocabulary to do it.
    expect(slotLabel("breakfast")).toBe(itemLabel(mealItem("breakfast")));
  });
});

describe("dayLabel", () => {
  test("reads as the summary's corner writes it", () => {
    expect(dayLabel("2026-08-10")).toBe("Mon 10 Aug");
  });

  test("names the date's own day, not the runtime's", () => {
    // The suite runs in New York, where `new Date("2026-08-10")` — midnight UTC
    // — is the evening of the 9th. A formatter that went through the runtime's
    // zone would label the summary with yesterday for everyone west of
    // Greenwich, which is the bug the pinned zone exists to catch.
    expect(dayLabel("2026-01-01")).toBe("Thu 1 Jan");
    expect(dayLabel("2026-12-31")).toBe("Thu 31 Dec");
  });

  test("refuses a date that is not one", () => {
    // Loudly, rather than rendering "Invalid Date" into the corner of a screen.
    expect(() => dayLabel("2026-02-30")).toThrow(/No such date/);
  });
});

/**
 * `dayLabel` with the year restored when it is needed — FUEL-34's history list
 * and FUEL-35's chart, which label the same dates and must agree about them.
 *
 * The rule is `weekLabel`'s: the parts that repeat are the parts to drop. What
 * makes it load-bearing here rather than cosmetic is that the weigh-in history
 * has NO window — `lib/weigh-in.ts` sets no lower bound on a weigh-in's date on
 * purpose, because the first reading is the starting weight and may predate the
 * program by years.
 */
describe("entryLabel", () => {
  const TODAY = "2026-08-20";

  test("drops the year within the current one", () => {
    expect(entryLabel("2026-08-10", TODAY)).toBe("Mon 10 Aug");
  });

  test("keeps the year on a date from another one", () => {
    expect(entryLabel("2024-08-12", TODAY)).toBe("Mon 12 Aug 2024");
  });

  /**
   * The case the whole function exists for: two readings a year apart that
   * would otherwise both read "Mon 18 Aug", in a list with no window to
   * disambiguate them.
   */
  test("tells two same-day readings from different years apart", () => {
    expect(entryLabel("2025-08-18", TODAY)).not.toBe(entryLabel("2026-08-17", TODAY));
  });

  /**
   * The year is compared as a string on both sides, so a `today` in a different
   * year from the reading disambiguates in the other direction too — a
   * December weigh-in reviewed in January is still labelled with its own year.
   */
  test("compares against the year given, not the runtime's", () => {
    expect(entryLabel("2026-12-31", "2027-01-02")).toBe("Thu 31 Dec 2026");
  });

  test("refuses a date that is not one", () => {
    expect(() => entryLabel("2026-02-30", TODAY)).toThrow(/No such date/);
  });
});

/**
 * The week header's label — FUEL-28.
 *
 * `dayLabel`'s sibling, and worth pinning for one reason of its own: it drops
 * the parts that repeat, so every case is a decision about what may be left
 * out. Leaving out too much is a header that says something false — "29 Dec – 4
 * Jan 2026" claims a December that never happened.
 */
describe("weekLabel", () => {
  test("names the month once when the week is inside one", () => {
    expect(weekLabel("2026-08-10")).toBe("10 – 16 Aug 2026");
  });

  test("names both months when the week crosses one", () => {
    expect(weekLabel("2026-07-27")).toBe("27 Jul – 2 Aug 2026");
  });

  test("names both years when the week crosses one", () => {
    // The case where dropping either year would be a lie about which December.
    expect(weekLabel("2025-12-29")).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  test("reads the date's own parts, not a UTC midnight", () => {
    // Same trap `dayLabel` names: `new Date("2026-08-10")` is the 9th in the
    // zone this suite pins, so a label built that way would be off by one.
    expect(weekLabel("2026-08-10")).toMatch(/^10 /);
  });

  test("refuses a date that is not one", () => {
    expect(() => weekLabel("2026-02-30")).toThrow(/No such date/);
  });
});

describe("weekFolio", () => {
  // Wednesday 17 June 2026 — the visual suite's frozen instant, whose own
  // Monday is the 15th. Every case below is measured from that Monday, which
  // is the point: the answer must not depend on which weekday "today" is.
  const today = "2026-06-17";

  test("names the week the reader is standing in", () => {
    expect(weekFolio("2026-06-15", today)).toBe("This week");
  });

  test("names the two neighbours rather than counting them", () => {
    expect(weekFolio("2026-06-22", today)).toBe("Next week");
    expect(weekFolio("2026-06-08", today)).toBe("Last week");
  });

  test("counts beyond the named three, in both directions", () => {
    expect(weekFolio("2026-06-29", today)).toBe("2 weeks ahead");
    expect(weekFolio("2026-07-27", today)).toBe("6 weeks ahead");
    expect(weekFolio("2026-06-01", today)).toBe("2 weeks back");
    expect(weekFolio("2026-05-04", today)).toBe("6 weeks back");
  });

  /*
   * The reason `today` is snapped before the subtraction. Sunday the 21st is
   * the LAST day of the week beginning Monday the 15th, so a reader on it is
   * still in "This week" — while an unsnapped difference would be six days,
   * round to nothing useful, and put them somewhere they are not.
   */
  test("is measured from the week's Monday, not from today", () => {
    for (const day of ["2026-06-15", "2026-06-17", "2026-06-21"]) {
      expect(weekFolio("2026-06-15", day)).toBe("This week");
      expect(weekFolio("2026-06-22", day)).toBe("Next week");
    }
  });

  /*
   * The three the year boundary would break if the arithmetic were done on
   * month numbers rather than on `daysBetween`'s UTC days. Monday 28 December
   * 2026 and Monday 4 January 2027 are one week apart and share no field.
   */
  test("counts across a year boundary", () => {
    expect(weekFolio("2027-01-04", "2026-12-30")).toBe("Next week");
    expect(weekFolio("2026-12-28", "2027-01-06")).toBe("Last week");
  });

  /*
   * The function is total rather than partial — raised by the FUEL-78
   * precommit review as the one latent assumption worth removing.
   *
   * The division by seven wants a whole number of weeks. Every caller today
   * hands over a Monday, because `loadWeek` snaps before the page sees it; a
   * future one passing any other weekday would have rendered
   * "1.5714285714285714 weeks ahead" into the page — no exception, no wrong
   * branch, nothing a type could catch. So `monday` is snapped here too, and
   * `startOfWeek` on a Monday is the identity, so the correct caller pays
   * nothing for it.
   */
  test("snaps a mid-week date rather than counting a fraction of a week", () => {
    for (const midweek of ["2026-06-23", "2026-06-25", "2026-06-28"]) {
      expect(weekFolio(midweek, today), midweek).toBe("Next week");
    }

    expect(weekFolio("2026-06-18", today)).toBe("This week");
  });

  test("refuses a date that is not one", () => {
    expect(() => weekFolio("2026-02-30", today)).toThrow(/No such date/);
  });
});
