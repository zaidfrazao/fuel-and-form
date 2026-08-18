import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test } from "vitest";

import { MealPicker } from "@/components/meal-picker";
import type { Meal, PlanTemplateEntry } from "@/lib/db/schema";
import { resolveDay } from "@/lib/resolve-plan";

/**
 * FUEL-22's acceptance criteria, as assertions about what ends up on the screen.
 *
 * The component takes its library and reports a tap, so every case below is a
 * fixture rather than a database — the same split `right-now.test.tsx` relies
 * on, and the reason the criteria are checkable at all without a session.
 *
 * Two of the six criteria are appearance claims that jsdom cannot evaluate — the
 * tiles being flat, and the sheet being the one shadowed element as *rendered*.
 * What is checkable here is the class and style each element is given, which is
 * what the browser then acts on; `/dev/meal-picker` is where the rendering
 * itself is checked, as `/dev/primitives` is for the tile.
 */

const USER = "picker-user";

/**
 * A full `Meal` row, so one fixture serves both halves of the archived
 * criterion: the picker takes the subset it needs, and `resolveDay` takes the
 * whole row.
 */
const meal = (
  id: string,
  name: string,
  slotType: Meal["slotType"],
  fields: Partial<Meal> = {},
): Meal => ({
  id,
  userId: USER,
  name,
  slotType,
  kcal: 500,
  proteinG: 40,
  fatG: 18,
  carbG: 50,
  method: null,
  notes: null,
  isArchived: false,
  ...fields,
});

const CHICKEN = meal("d1", "Harissa Chicken & Rice", "dinner");
const STEW = meal("d2", "Butterbean & Chorizo Stew", "dinner");
const CHILLI = meal("d3", "Smoked Paprika Chilli", "dinner");
const OATS = meal("b1", "Overnight Oats — Fig & Honey", "breakfast");
const SHAKE = meal("s1", "Cocoa Whey Shake", "snack");
const RETIRED = meal("d0", "Retired Sausage Pasta", "dinner", { isArchived: true });

const LIBRARY: readonly Meal[] = [CHICKEN, STEW, CHILLI, OATS, SHAKE, RETIRED];

/**
 * The picker under a caller that owns the selection, which is how it is used.
 *
 * `selectedMealId` is controlled, so a test that passed a constant could never
 * observe the ring moving — the thing the selection criterion is about.
 */
type Overrides = Partial<Parameters<typeof MealPicker>[0]>;

function Harness({
  meals = LIBRARY,
  currentMealId = CHICKEN.id,
  ...rest
}: Overrides) {
  const [selected, setSelected] = useState<string | null>(currentMealId ?? null);
  const [open, setOpen] = useState(true);

  return (
    <>
      {/* The trigger the real screen has. Only the reopen case uses it, and it
          needs to be outside the sheet to survive the close. */}
      <button type="button" onClick={() => setOpen(true)}>
        Swap
      </button>

      <MealPicker
        open={open}
        onOpenChange={setOpen}
        slot="dinner"
        date="Mon 10 Aug"
        meals={meals}
        currentMealId={currentMealId}
        selectedMealId={selected}
        onSelect={setSelected}
        {...rest}
      />
    </>
  );
}

function Picker(overrides: Overrides = {}) {
  return render(<Harness {...overrides} />);
}

/** The tiles, in render order. Every one is a button inside the group. */
function tiles(): HTMLElement[] {
  return within(screen.getByRole("group")).getAllByRole("button");
}

function tile(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("the candidate list", () => {
  test("shows only the slot's meals by default", () => {
    Picker();

    expect(tiles()).toHaveLength(3);
    expect(tile(/Harissa/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Overnight Oats/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Whey Shake/ })).toBeNull();
  });

  test("shows the rest of the library on request, and goes back", async () => {
    const user = userEvent.setup();
    Picker();

    await user.click(screen.getByRole("button", { name: "Show all meals" }));

    expect(tiles()).toHaveLength(5);
    expect(tile(/Overnight Oats/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show dinner only" }));

    expect(tiles()).toHaveLength(3);
  });

  test("returns to the slot filter when the sheet is reopened", async () => {
    const user = userEvent.setup();
    Picker();

    await user.click(screen.getByRole("button", { name: "Show all meals" }));
    expect(tiles()).toHaveLength(5);

    // Escape closes it; Radix drops the subtree, which is what resets the
    // filter. A `showAll` hoisted out of the sheet would survive this and the
    // picker would stop defaulting after the first use.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Swap" }));

    expect(tiles()).toHaveLength(3);
  });

  test("says so when the slot has no meals, without hiding the way out", async () => {
    const user = userEvent.setup();
    Picker({ meals: [OATS, SHAKE], currentMealId: null });

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("No dinner meals in the library yet.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show all meals" }));

    expect(tiles()).toHaveLength(2);
  });
});

describe("materials", () => {
  test("draws exactly one ink tile, and it is the planned meal", () => {
    Picker({ currentMealId: CHILLI.id });

    const ink = tiles().filter((element) => element.className.includes("bg-ink"));

    expect(ink).toHaveLength(1);
    expect(ink[0]?.textContent).toContain("Smoked Paprika Chilli");

    // Everything else is stone. Neither material is a border or a shadow —
    // § Materials allows only the two fills.
    for (const element of tiles()) {
      const isInk = element.className.includes("bg-ink");
      expect(element.className.includes("bg-surface")).toBe(!isInk);
    }
  });

  test("keeps one ink tile when the planned meal is not among the candidates", () => {
    // The planned meal has been archived since it was planned, so it is not a
    // candidate. Without the fallback there would be no ink tile at all.
    Picker({ currentMealId: RETIRED.id });

    expect(tiles().filter((element) => element.className.includes("bg-ink"))).toHaveLength(1);
    expect(tiles()[0]?.className).toContain("bg-ink");
  });

  test("the ink tile stays ink as the selection moves", async () => {
    const user = userEvent.setup();
    Picker({ currentMealId: CHICKEN.id });

    await user.click(tile(/Chorizo Stew/));

    const ink = tiles().filter((element) => element.className.includes("bg-ink"));

    expect(ink).toHaveLength(1);
    expect(ink[0]?.textContent).toContain("Harissa Chicken & Rice");
  });
});

describe("selection", () => {
  test("is a 1.5px accent inset ring, and never a fill", async () => {
    const user = userEvent.setup();
    Picker({ currentMealId: CHICKEN.id });

    await user.click(tile(/Chorizo Stew/));

    const chosen = tile(/Chorizo Stew/);

    expect(chosen.style.boxShadow).toBe("inset 0 0 0 1.5px var(--accent)");
    // The material is untouched — a stone tile stays stone under the ring.
    expect(chosen.className).toContain("bg-surface");
    expect(chosen.className).not.toContain("bg-accent");

    // And the ring left the tile it was on.
    expect(tile(/Harissa/).style.boxShadow).toBe("");
  });

  test("every tile is a toggle, not just the chosen one", () => {
    Picker({ currentMealId: CHICKEN.id });

    expect(tile(/Harissa/).getAttribute("aria-pressed")).toBe("true");

    for (const element of tiles()) {
      expect(element.getAttribute("aria-pressed")).not.toBeNull();
    }
  });

  test("reports the tapped meal by id", async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];

    Picker({ onSelect: (id: string) => chosen.push(id) });

    await user.click(tile(/Smoked Paprika Chilli/));

    expect(chosen).toEqual([CHILLI.id]);
  });
});

describe("archived meals", () => {
  test("are not candidates, in either filter", async () => {
    const user = userEvent.setup();
    Picker();

    expect(screen.queryByRole("button", { name: /Retired Sausage Pasta/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show all meals" }));

    expect(screen.queryByRole("button", { name: /Retired Sausage Pasta/ })).toBeNull();
  });

  test("still resolve in history", () => {
    // The other half of the criterion, and the reason the picker filters rather
    // than the query does: a day that named the retired meal must still resolve
    // to it, or the export loses what was actually eaten.
    const entry: PlanTemplateEntry = {
      id: "t1",
      userId: USER,
      dayOfWeek: 1, // Monday
      slot: "dinner",
      mealId: RETIRED.id,
      sortOrder: 0,
    };

    const resolved = resolveDay(
      {
        programStartDate: "2026-08-03",
        template: [entry],
        overrides: [],
        meals: [...LIBRARY],
      },
      "2026-08-10",
    );

    expect(resolved.map((row) => row.meal.name)).toEqual(["Retired Sausage Pasta"]);
  });
});

describe("the sheet", () => {
  test("is the only element carrying a shadow", () => {
    Picker();

    const sheet = screen.getByRole("dialog");

    expect(sheet.className).toContain("shadow-sheet");

    // Every other element in the sheet, the tiles included. The selection ring
    // is an inline inset box-shadow rather than a `shadow-*` utility, and is
    // deliberately not caught here: § Tiles specifies it, and an inset rule is
    // not elevation.
    for (const element of sheet.querySelectorAll("*")) {
      expect(element.className.toString()).not.toMatch(/(^|\s)shadow-/);
    }
  });

  test("names itself after the slot it is filling", () => {
    Picker();

    expect(screen.getByRole("dialog", { name: /Swap dinner/ })).toBeTruthy();
  });
});
