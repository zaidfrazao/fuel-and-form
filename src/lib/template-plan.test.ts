import { describe, expect, it } from "vitest";

import { SLOT_ORDER } from "./resolve-plan";
import {
  isDayOfWeek,
  isMealSlot,
  templateWeek,
  WEEK_ORDER,
  weekdayName,
  type TemplateRow,
} from "./template-plan";

/**
 * The recurring week's shape, and the two guards behind the endpoint that edits
 * it — FUEL-25.
 *
 * Three halves, tested for three different reasons.
 *
 * The SHAPE half is about a screen that has to be able to fill a slot that is
 * empty. Thirty-five cells regardless of what the template holds is the whole
 * contract: a day rendered with only its planned meals would offer no way to
 * plan anything new, which is the one thing the template editor exists for.
 *
 * The ORDER half is about the week starting on Monday while storage counts
 * Sunday as 0. Those two conventions meeting in the wrong place is an off-by-one
 * that shows up as the right meals under the wrong headings — plausible on
 * screen, and invisible in a diff.
 *
 * The GUARD half is the security half, on `repeat.ts`'s reasoning: every
 * rejection below is reachable by anyone who can POST to the app, and a
 * template row is the widest write in it by blast radius — one row that decides
 * every future occurrence of a weekday.
 */

const meal = (id: string, name = id) => ({ id, name });

const row = (
  dayOfWeek: number,
  slot: TemplateRow["slot"],
  mealId: string,
  extra: Partial<TemplateRow> = {},
): TemplateRow => ({
  dayOfWeek,
  slot,
  mealId,
  sortOrder: 0,
  id: `${dayOfWeek}-${slot}-${mealId}`,
  ...extra,
});

const cellFor = (
  week: ReturnType<typeof templateWeek<{ id: string; name: string }>>,
  day: number,
  slot: string,
) => week.find((d) => d.dayOfWeek === day)?.cells.find((c) => c.slot === slot);

describe("the week's order", () => {
  it("starts on Monday and ends on Sunday", () => {
    // Monday-first is display; 0 = Sunday is storage. date.ts's `startOfWeek`
    // draws the same line, and this is the other place the two meet.
    expect(WEEK_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("covers every weekday exactly once", () => {
    expect([...WEEK_ORDER].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("names weekdays in full, because the confirm reads 'every Tuesday'", () => {
    expect(weekdayName(2)).toBe("Tuesday");
    expect(weekdayName(0)).toBe("Sunday");
  });
});

describe("the week's shape", () => {
  it("renders seven days of every slot from an empty template", () => {
    const week = templateWeek([], []);

    expect(week).toHaveLength(7);
    expect(week.every((day) => day.cells.length === SLOT_ORDER.length)).toBe(true);
  });

  it("leaves an unplanned slot null rather than dropping the cell", () => {
    // The weekend the seed leaves half-empty (lib/seed/plan.ts). An empty cell
    // is the control for filling it, so it has to be rendered.
    const week = templateWeek([row(6, "breakfast", "eggs")], [meal("eggs")]);

    expect(cellFor(week, 6, "breakfast")?.meal?.id).toBe("eggs");
    expect(cellFor(week, 6, "dinner")?.meal).toBeNull();
  });

  it("puts each entry under its own weekday and slot", () => {
    const week = templateWeek(
      [row(2, "dinner", "chicken"), row(3, "dinner", "chilli")],
      [meal("chicken"), meal("chilli")],
    );

    expect(cellFor(week, 2, "dinner")?.meal?.id).toBe("chicken");
    expect(cellFor(week, 3, "dinner")?.meal?.id).toBe("chilli");
  });

  it("shows an archived meal, because the template still serves it", () => {
    // resolve-plan.ts resolves archived meals by design. Hiding one here would
    // draw an empty cell for a slot that is not empty — and the user would
    // "fill" a Tuesday that was already full.
    const archived = { id: "retired", name: "Retired dinner", isArchived: true };
    const week = templateWeek([row(2, "dinner", "retired")], [archived]);

    expect(cellFor(week, 2, "dinner")?.meal?.name).toBe("Retired dinner");
  });

  it("empties a cell whose meal is not in the library", () => {
    // Should not happen — the composite foreign key cascades — but an editor
    // that threw on the one screen that could repair the plan would be the
    // worst possible response to it.
    const week = templateWeek([row(2, "dinner", "missing")], [meal("chicken")]);

    expect(cellFor(week, 2, "dinner")?.meal).toBeNull();
  });

  it("breaks a duplicate by sort order, then id — the resolver's tie-break", () => {
    // Only reachable for rows written before FUEL-25's unique constraint. The
    // editor and the resolver must pick the SAME row, or the screen would offer
    // to change one meal while next Tuesday serves the other.
    const week = templateWeek(
      [
        row(2, "dinner", "second", { sortOrder: 1, id: "a" }),
        row(2, "dinner", "first", { sortOrder: 0, id: "z" }),
      ],
      [meal("first"), meal("second")],
    );

    expect(cellFor(week, 2, "dinner")?.meal?.id).toBe("first");
  });

  it("breaks a sort-order tie by id, so the order is total", () => {
    const week = templateWeek(
      [
        row(2, "dinner", "later", { id: "b" }),
        row(2, "dinner", "earlier", { id: "a" }),
      ],
      [meal("earlier"), meal("later")],
    );

    expect(cellFor(week, 2, "dinner")?.meal?.id).toBe("earlier");
  });

  it("does not reorder the caller's rows", () => {
    // The array a resolver reads is not the array an editor may reshuffle.
    const entries = [
      row(2, "dinner", "second", { sortOrder: 1, id: "a" }),
      row(2, "dinner", "first", { sortOrder: 0, id: "z" }),
    ];

    templateWeek(entries, [meal("first"), meal("second")]);

    expect(entries.map((entry) => entry.mealId)).toEqual(["second", "first"]);
  });
});

describe("isDayOfWeek", () => {
  it.each([0, 1, 6])("accepts %s", (day) => {
    expect(isDayOfWeek(day)).toBe(true);
  });

  it.each([
    ["a day past Saturday", 7],
    ["a negative day", -1],
    ["a fraction", 2.5],
    ["NaN", Number.NaN],
    // `value % 1 !== 0` would let this through, and `<= 6` does not stop it.
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string from a hand-rolled POST", "2"],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_case, value) => {
    expect(isDayOfWeek(value)).toBe(false);
  });
});

describe("isMealSlot", () => {
  it.each(SLOT_ORDER)("accepts %s", (slot) => {
    expect(isMealSlot(slot)).toBe(true);
  });

  it.each([
    ["a slot the enum does not have", "brunch"],
    ["the empty string", ""],
    ["a number", 2],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_case, value) => {
    expect(isMealSlot(value)).toBe(false);
  });
});
