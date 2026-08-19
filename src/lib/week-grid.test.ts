import { describe, expect, test } from "vitest";

import { SLOT_ORDER } from "./resolve-plan";
import { type PlannedDay, weekGrid } from "./week-grid";

/**
 * The weekly grid's shaping — FUEL-28.
 *
 * Gated at 100% for the reason `template-plan.ts` is: it decides which of
 * thirty-five cells is empty, and an empty cell is not a cosmetic state here.
 * It is what the 45° hatch marks, what a tap fills, and — via `source` — what
 * the `accent-subtle` tint is drawn from. Every way this can be wrong is a
 * plausible-looking screen rather than a crash: a slot silently missing from a
 * column, a swapped cell rendered as an ordinary one, the umber marker on the
 * wrong day. None of them throw, and none are visible in a code review.
 */

type Meal = { id: string; name: string };

const CHILLI = { id: "m1", name: "Chilli con Carne" };
const CURRY = { id: "m2", name: "Chickpea Curry" };

/** Monday 9 March 2026 — the week the resolver's own fixtures use. */
const MON = "2026-03-09";
const TUE = "2026-03-10";
const SUN = "2026-03-15";

const day = (
  date: string,
  meals: PlannedDay<Meal>["meals"] = [],
): PlannedDay<Meal> => ({ date, meals });

const planned = (
  slot: PlannedDay<Meal>["meals"][number]["slot"],
  meal: Meal,
  source: "template" | "override" = "template",
  entryId = "e1",
) => ({ slot, meal, source, entryId });

describe("weekGrid", () => {
  test("gives every day all five slots, whatever it plans", () => {
    // A weekend that plans breakfast and nothing else — PRD § P2's own shape,
    // where the template has no lunch entry at all.
    const [column] = weekGrid([day(SUN, [planned("breakfast", CHILLI)])], MON);

    expect(column?.cells.map((cell) => cell.slot)).toEqual([...SLOT_ORDER]);
  });

  test("an unfilled slot is an empty cell, not a missing one", () => {
    const [column] = weekGrid([day(SUN, [planned("breakfast", CHILLI)])], MON);

    // The hatch and the tap target both hang off this. A shaping that omitted
    // the cell would leave the screen with nothing to draw and no way to plan
    // anything new.
    const lunch = column?.cells.find((cell) => cell.slot === "lunch");

    expect(lunch).toEqual({
      slot: "lunch",
      meal: null,
      source: null,
      entryId: null,
    });
  });

  test("a day that plans nothing is five empty cells, not zero", () => {
    // Before `program_start_date`, `resolveDay` answers with an empty list.
    // That is an ordinary state, and it still has to render a column.
    const [column] = weekGrid([day(MON)], MON);

    expect(column?.cells).toHaveLength(5);
    expect(column?.cells.every((cell) => cell.meal === null)).toBe(true);
  });

  test("carries the source through, so a swapped cell can be tinted", () => {
    const [column] = weekGrid(
      [day(TUE, [planned("dinner", CURRY, "override", "o1")])],
      MON,
    );

    const dinner = column?.cells.find((cell) => cell.slot === "dinner");

    expect(dinner?.source).toBe("override");
    expect(dinner?.entryId).toBe("o1");
    expect(dinner?.meal).toBe(CURRY);
  });

  test("marks today, and only today", () => {
    const week = weekGrid([day(MON), day(TUE), day(SUN)], TUE);

    expect(week.map((column) => column.isToday)).toEqual([false, true, false]);
  });

  test("marks nothing when today falls outside the week shown", () => {
    // Navigating away from this week is ordinary, and § The Four Rules allows
    // the accent nowhere else on this screen — so a week that does not contain
    // today has NO umber mark rather than a fallback one.
    const week = weekGrid([day(MON), day(TUE)], "2026-04-01");

    expect(week.some((column) => column.isToday)).toBe(false);
  });

  test("names each column by its own weekday", () => {
    const week = weekGrid([day(MON), day(TUE), day(SUN)], MON);

    expect(week.map((column) => column.name)).toEqual([
      "Monday",
      "Tuesday",
      "Sunday",
    ]);
    expect(week.map((column) => column.dayOfWeek)).toEqual([1, 2, 0]);
  });

  test("keeps the order it is given rather than sorting", () => {
    // `resolveWeek` already emits Monday-first, and `date.ts`'s `startOfWeek`
    // is the one place that decides where a week begins. Re-sorting here would
    // be a second copy of that decision, able to disagree with it.
    const week = weekGrid([day(SUN), day(MON)], MON);

    expect(week.map((column) => column.date)).toEqual([SUN, MON]);
  });

  test("no days is no columns, not a throw", () => {
    expect(weekGrid([], MON)).toEqual([]);
  });

  test("refuses a malformed date loudly", () => {
    // Rendering a column headed "Invalid Date" that then sorts wrong is the
    // failure this prevents. `dayOfWeek` is what refuses.
    expect(() => weekGrid([day("2026-3-9")], MON)).toThrow();
  });
});
