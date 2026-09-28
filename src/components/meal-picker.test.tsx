import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test } from "vitest";

import { MealPicker } from "@/components/meal-picker";
import { FRAME, FRAME_MEASURE } from "@/lib/frame";
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
  // Not part of the picker's own props: most cases want the sheet already up,
  // and the focus-restore case has to start closed so there is a real opening
  // to restore to.
  initialOpen = true,
  // Rerendered as `true` by one case, to unmount the opener while the sheet is
  // over it. Done through React rather than by calling `.remove()` on the node,
  // which React then fails to remove itself at cleanup.
  hideTrigger = false,
  // Nothing chosen on opening, as in the swap sheet — which, since FUEL-135,
  // is also what decides whether any tile is ink.
  initialSelected = null,
  ...rest
}: Overrides & { initialOpen?: boolean; hideTrigger?: boolean; initialSelected?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [open, setOpen] = useState(initialOpen);

  return (
    <>
      {/* The trigger the real screen has. Only the reopen case uses it, and it
          needs to be outside the sheet to survive the close. */}
      {!hideTrigger && (
        <button type="button" onClick={() => setOpen(true)}>
          Swap
        </button>
      )}

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

function Picker(
  overrides: Overrides & {
    initialOpen?: boolean;
    hideTrigger?: boolean;
    initialSelected?: string | null;
  } = {},
) {
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
  // FUEL-135. Ink follows the SELECTION, as `BRAND_GUIDE.html`'s swap frame
  // draws it (`tile ink sel` on the chosen meal, the planned one stone). Until
  // then ink marked the planned meal, and the incumbent read as the choice.
  const ink = () => tiles().filter((element) => element.className.includes("bg-ink"));

  test("draws no ink tile before anything is chosen", () => {
    Picker({ currentMealId: CHILLI.id });

    expect(ink()).toHaveLength(0);

    // Everything is stone. Neither material is a border or a shadow —
    // § Materials allows only the two fills.
    for (const element of tiles()) expect(element.className).toContain("bg-surface");
  });

  test("draws the chosen tile in ink, and only that one", async () => {
    const user = userEvent.setup();
    Picker({ currentMealId: CHICKEN.id });

    await user.click(tile(/Chorizo Stew/));

    expect(ink()).toHaveLength(1);
    expect(ink()[0]?.textContent).toContain("Butterbean & Chorizo Stew");

    // And the ink moves with the selection rather than staying where it was.
    await user.click(tile(/Smoked Paprika Chilli/));

    expect(ink()).toHaveLength(1);
    expect(ink()[0]?.textContent).toContain("Smoked Paprika Chilli");
  });

  test("leaves the planned meal stone, marked by a word", () => {
    Picker({ currentMealId: CHICKEN.id });

    const current = tile(/Harissa/);

    expect(current.className).toContain("bg-surface");
    expect(current.style.boxShadow).toBe("");
    expect(current.textContent).toContain("Current");

    // The word is the planned meal's alone.
    const marked = tiles().filter((element) => element.textContent?.includes("Current"));
    expect(marked).toEqual([current]);
  });

  test("the planned meal takes ink like any other when it is chosen", async () => {
    // Choosing the incumbent is a real answer — it prices the day as it
    // stands — so it is drawn as a choice, and keeps its word beside the ink.
    const user = userEvent.setup();
    Picker({ currentMealId: CHICKEN.id });

    await user.click(tile(/Harissa/));

    expect(ink()).toEqual([tile(/Harissa/)]);
    expect(tile(/Harissa/).textContent).toContain("Current");
  });
});

describe("what each tile says it would change — FUEL-135", () => {
  const LIGHT = meal("d4", "Miso Salmon with Greens", "dinner", { kcal: 420, proteinG: 46 });
  const HEAVY = meal("d5", "Steak, Chips & Peppercorn", "dinner", { kcal: 1265, proteinG: 52 });

  test("counts from the planned meal, signed", () => {
    // CHICKEN is the fixture's 500 kcal and 40g of protein.
    Picker({ meals: [CHICKEN, LIGHT, HEAVY], currentMealId: CHICKEN.id });

    expect(tile(/Steak/).textContent).toContain("+765 kcal · +12 P");
    // A minus SIGN, from `signed`, not a hyphen.
    expect(tile(/Miso Salmon/).textContent).toContain("−80 kcal · +6 P");
  });

  test("says `0`, not nothing, for a meal with the same figures", () => {
    Picker({ meals: [CHICKEN, STEW], currentMealId: CHICKEN.id });

    expect(tile(/Chorizo Stew/).textContent).toContain("0 kcal · 0 P");
  });

  test("counts from the planned meal even when the filter hides it", async () => {
    // The incumbent is a breakfast in a dinner slot: filtered out of the
    // default view, and still the zero the dinners count from.
    const BREAKFAST_IN_DINNER = meal("b9", "Big Breakfast", "breakfast", { kcal: 900, proteinG: 40 });

    Picker({ meals: [BREAKFAST_IN_DINNER, CHICKEN], currentMealId: BREAKFAST_IN_DINNER.id });

    expect(tile(/Harissa/).textContent).toContain("−400 kcal · 0 P");
  });

  test("falls back to absolute figures with nothing to count from", () => {
    // An empty slot: the template leaves it open and this pick fills it.
    Picker({ meals: [CHICKEN, HEAVY], currentMealId: null });

    expect(tile(/Harissa/).textContent).toContain("500 kcal · P 40");
    expect(tile(/Steak/).textContent).toContain("1265 kcal · P 52");
  });

  test("falls back to absolute figures when the planned meal is untracked", () => {
    // An untracked meal's figures are not a day's figures, so a delta from
    // them would be a number about nothing.
    const FLEXIBLE = { ...meal("x1", "Flexible dinner", "dinner", { kcal: 0, proteinG: 0 }), isUntracked: true };

    Picker({ meals: [FLEXIBLE, CHICKEN], currentMealId: FLEXIBLE.id });

    expect(tile(/Harissa/).textContent).toContain("500 kcal · P 40");
  });
});

describe("selection", () => {
  test("is a 1.5px accent inset ring, over the ink", async () => {
    const user = userEvent.setup();
    Picker({ currentMealId: CHICKEN.id, initialSelected: CHICKEN.id });

    await user.click(tile(/Chorizo Stew/));

    const chosen = tile(/Chorizo Stew/);

    expect(chosen.style.boxShadow).toBe("inset 0 0 0 1.5px var(--accent)");
    // The ring is never an accent FILL: the tile's ground is ink, the ring is
    // drawn over it, and umber stays the one element it always was.
    expect(chosen.className).toContain("bg-ink");
    expect(chosen.className).not.toContain("bg-accent");

    // And the ring left the tile it was on.
    expect(tile(/Harissa/).style.boxShadow).toBe("");
  });

  test("every tile is a toggle, not just the chosen one", () => {
    Picker({ currentMealId: CHICKEN.id, initialSelected: CHICKEN.id });

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

  test("gives focus back to whatever opened it", async () => {
    const user = userEvent.setup();
    Picker({ initialOpen: false });

    const trigger = screen.getByRole("button", { name: "Swap" });

    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");

    // Radix restores to a `Dialog.Trigger`, and this sheet is controlled with
    // no trigger element — left to itself it focuses null and drops the user on
    // `<body>`, one Escape away from having lost their place entirely. Caught
    // in a browser rather than here, which is why the assertion is on the
    // element and not merely on "something is focused".
    expect(document.activeElement).toBe(trigger);
  });

  test("gives focus to the body when the opener has gone", async () => {
    const user = userEvent.setup();
    const { rerender } = Picker({ initialOpen: false });

    await user.click(screen.getByRole("button", { name: "Swap" }));

    // The case `onCloseAutoFocus` checks `isConnected` for: a control that was
    // unmounted while the sheet was over it — a week-grid cell behind a
    // re-render.
    //
    // **This holds the outcome and not the branch, and the difference is worth
    // stating.** Removing `?.isConnected` from `sheet.tsx` leaves this test
    // passing — planted and run, not assumed. Both routes end on `<body>`:
    // taking the event over and focusing a detached node does nothing silently,
    // and leaving it alone gives Radix's own handler the same detached node to
    // fail on. So the guard is a statement of intent rather than a load-bearing
    // line, and no assertion available here can tell the two apart. What this
    // does hold is the acceptance criterion — focus lands on `<body>` when the
    // opener has gone, rather than nowhere, on the wrong control, or in a throw.
    //
    // A rerender rather than a second `render`: the sheet's `open` lives in the
    // harness and has to survive the opener going away.
    rerender(<Harness initialOpen={false} hideTrigger />);

    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(document.body);
  });

  test("is dismissed by the scrim", async () => {
    const user = userEvent.setup();
    Picker();

    // The overlay carries no role — it is `aria-hidden` scenery — so it is
    // reached by the one class that is its whole purpose.
    const scrim = document.querySelector(".bg-scrim");

    expect(scrim).not.toBeNull();

    await user.click(scrim as Element);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/**
 * Where the sheet stands — Brand Guide § Desktop, "Sheets, against a pointer".
 *
 * jsdom applies no stylesheet, so nothing here is a claim about pixels; these
 * hold the two structural properties the fix depends on, and
 * `tests/visual/sheet.spec.ts` measures the result in a browser.
 */
describe("the measure's column", () => {
  test("is one dialog that reflows, not a phone one and a desktop one", () => {
    Picker();

    // The whole of the "reflow, do not duplicate" rule `nav-shell.tsx` sets out:
    // two elements toggled by `hidden`/`lg:block` would both be in the tree
    // here, CSS being what hides one, and this query would throw on the pair.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  test("takes its place from the frame rather than restating it", () => {
    Picker();

    const sheet = screen.getByRole("dialog");
    const frame = sheet.parentElement;
    const layer = frame?.parentElement;

    // The column index, which is the desktop change in one utility. Read off
    // `FRAME_MEASURE` rather than written out, so that a change to the frame
    // moves this assertion with it instead of leaving it asserting a string
    // nothing renders any more.
    expect(sheet.className).toContain(FRAME_MEASURE);
    expect(frame?.className).toBe(FRAME);

    // Not a second declaration of the grid. `globals.css` holds the numbers and
    // `lib/frame.ts` the classes; a `left: calc(...)` here would be the fourth
    // statement of a template that exists to have exactly one.
    expect(layer?.className).not.toMatch(/calc\(.*(100vw|1272)/);
  });

  test("places the sheet without lifting the layer that places it", () => {
    Picker();

    const sheet = screen.getByRole("dialog");

    // § Materials gives the system one shadow and it belongs to the sheet. The
    // sibling assertion in "the only element carrying a shadow" looks down the
    // tree; the positioning layer and the frame are ABOVE the dialog, so they
    // are outside it and are checked here instead.
    for (
      let node = sheet.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      expect(node.className.toString()).not.toMatch(/(^|\s)shadow-/);
    }
  });
});
