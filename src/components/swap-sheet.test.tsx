import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { type PlannedMeal, SwapSheet, type SwappableMeal } from "@/components/swap-sheet";
import type { MacroTarget } from "@/lib/macros";

/**
 * The swap preview — PRD § P4's "a swap preview shows the resulting day totals
 * BEFORE the swap is confirmed", and § Progressive Disclosure's placement of
 * them "*inside* the sheet, above the confirm button".
 *
 * The sheet writes nothing: it is given a library and a day and reports which
 * meal was chosen, so every case here is a fixture rather than a Server Action.
 * What the chosen meal then does to the database is `actions/swap.test.ts` and
 * `tests/integration/swap.test.ts`; what a refusal does to the screen is
 * `right-now.test.tsx`, which owns the banner.
 */

const target: MacroTarget = {
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbG: 200,
};

const candidate = (
  id: string,
  name: string,
  fields: Partial<SwappableMeal> = {},
): SwappableMeal => ({
  id,
  name,
  slotType: "dinner",
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  isArchived: false,
  ...fields,
});

const CHILLI = candidate("m1", "Chilli");
const CURRY = candidate("m2", "Chickpea curry", { kcal: 560, proteinG: 24, fatG: 18, carbG: 70 });
const SALMON = candidate("m3", "Salmon and greens", { kcal: 900, proteinG: 60, fatG: 40, carbG: 30 });
const OATS = candidate("m4", "Overnight oats", { slotType: "breakfast", kcal: 400, proteinG: 30, fatG: 10, carbG: 50 });
const RETIRED = candidate("m5", "Retired traybake", { isArchived: true });

const LIBRARY = [CHILLI, CURRY, SALMON, OATS, RETIRED];

/** Breakfast and dinner planned — 1,100 kcal and 75g of protein between them. */
const PLANNED: PlannedMeal[] = [
  { slot: "breakfast", meal: { id: "m4", name: "Overnight oats", kcal: 400, proteinG: 30, fatG: 10, carbG: 50 } },
  { slot: "dinner", meal: { id: "m1", name: "Chilli", kcal: 700, proteinG: 45, fatG: 20, carbG: 60 } },
];

const onConfirm = vi.fn();

/**
 * The sheet, open, with its `open` state owned by a harness.
 *
 * Controlled by a wrapper rather than pinned to `open`, because two cases below
 * are about what the sheet does when it CLOSES — and a sheet that could not
 * close would pass both of them for the wrong reason.
 */
function Harness({
  planned = PLANNED,
  meals = LIBRARY,
  slot = "dinner" as const,
}: {
  planned?: PlannedMeal[];
  meals?: SwappableMeal[];
  slot?: PlannedMeal["slot"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <SwapSheet
        open={open}
        onOpenChange={setOpen}
        slot={slot}
        date="2026-03-09"
        planned={planned}
        meals={meals}
        target={target}
        onConfirm={onConfirm}
      />
    </>
  );
}

async function open(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();

  onConfirm.mockReset();
  render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));

  return { user, sheet: screen.getByRole("dialog") };
}

/** The value and its slash metadata for one column of the totals grid. */
function column(sheet: HTMLElement, label: string) {
  const heading = within(sheet).getByText(label);
  const pair = heading.parentElement!;

  return pair.textContent ?? "";
}

describe("the resulting day totals", () => {
  test("start as the day stands, before anything is chosen", () => {
    // Not blank and not zero. The reader is deciding whether to swap, and the
    // comparison they need is against where the day is now.
    return open().then(({ sheet }) => {
      expect(column(sheet, "Calories")).toContain("1,100");
      expect(column(sheet, "Protein")).toContain("75 g");
    });
  });

  test("show the swapped day the moment a tile is tapped", async () => {
    // P4's criterion. 1,100 − 700 + 560 = 960 kcal; 75 − 45 + 24 = 54g protein.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));

    expect(column(sheet, "Calories")).toContain("960");
    expect(column(sheet, "Protein")).toContain("54 g");
  });

  test("replace the slot's meal rather than adding to it", async () => {
    // The difference between a swap and an extra meal, and the one arithmetic
    // mistake that would make every preview in the app read high.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Salmon and greens/ }));

    // 1,100 − 700 + 900 = 1,300. Adding instead of replacing would read 2,000,
    // which is the target exactly — so the delta is what tells the two apart.
    expect(column(sheet, "Calories")).toContain("1,300");
    expect(column(sheet, "Calories")).toContain("−700");
    expect(column(sheet, "Calories")).not.toContain("· 0");
  });

  test("add the whole meal when the slot is empty", async () => {
    // A swap into a slot the template leaves empty is a real action — an extra
    // meal, today only — and the day gains all of it.
    const { user, sheet } = await open({ slot: "snack" });

    await user.click(within(sheet).getByRole("button", { name: "Show all meals" }));
    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));

    expect(column(sheet, "Calories")).toContain("1,660");
  });

  test("sign the delta against target, under and over", async () => {
    // § Content Guidelines: "Use −21g over '21g less' — signed figures parse
    // faster", with U+2212 rather than a hyphen.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));

    // 960 against 2,000, and 54 against 150.
    expect(column(sheet, "Calories")).toContain("−1,040");
    expect(column(sheet, "Protein")).toContain("−96");
  });

  test("show all four figures, not only the two the copy names", async () => {
    const { sheet } = await open();

    for (const label of ["Calories", "Protein", "Fat", "Carbs"]) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
  });

  test("colour an over-target kcal and nothing else", async () => {
    // § Tone of Voice writes `+220 kcal` in `error` against `−8g protein` in
    // `text-secondary`. Over target on protein is the day going well, and a
    // rule that painted every positive delta red would report it as a fault.
    const { user, sheet } = await open({
      planned: [
        { slot: "breakfast", meal: { id: "m4", name: "Overnight oats", kcal: 1800, proteinG: 130, fatG: 40, carbG: 150 } },
        { slot: "dinner", meal: { id: "m1", name: "Chilli", kcal: 700, proteinG: 45, fatG: 20, carbG: 60 } },
      ],
    });

    await user.click(within(sheet).getByRole("button", { name: /Salmon and greens/ }));

    // The swapped day lands over target on both kcal (+700) and protein (+40).
    // Stated as deltas rather than totals on purpose: `check:metrics` reads a
    // bare "<n>g protein" as a body metric, and a comment is not worth
    // widening that guard's allow-list for.
    expect(column(sheet, "Calories")).toContain("+700");
    expect(column(sheet, "Protein")).toContain("+40");

    // Exactly one red thing in the sheet, and it is the calorie delta. Counting
    // them is what makes this a claim about the rule rather than about one
    // element: a future change that painted the protein delta too would have to
    // come here and say so.
    const red = sheet.querySelectorAll(".text-error");

    expect(red).toHaveLength(1);
    expect(red[0]?.textContent).toBe("+700");
  });

  test("say when a total excludes an untracked meal", async () => {
    // An untracked meal contributes nothing, so the day is a floor rather than
    // a sum. A preview that hid that in a tooltip would hide it from the reader
    // who most needs it.
    const { sheet } = await open({
      planned: [
        ...PLANNED,
        { slot: "snack", meal: { id: "m9", name: "Weekend lunch", kcal: 0, proteinG: 0, fatG: 0, carbG: 0, isUntracked: true } },
      ],
    });

    expect(within(sheet).getByText(/Excludes 1 untracked meal\./)).toBeTruthy();
  });

  test("say nothing about untracked meals when there are none", async () => {
    const { sheet } = await open();

    expect(within(sheet).queryByText(/untracked/)).toBeNull();
  });

  test("are announced, because the numbers change without focus moving", async () => {
    // A sighted reader sees the grid update under the tile they tapped. Without
    // a live region a screen-reader user would tap through the whole library
    // hearing nothing about the cost of any of it — which is the entire
    // question the sheet exists to answer.
    const { sheet } = await open();

    const live = sheet.querySelector('[aria-live="polite"]');

    expect(live).toBeTruthy();
    expect(within(live as HTMLElement).getByText("Calories")).toBeTruthy();
  });
});

describe("the confirm", () => {
  test("is disabled until a meal is chosen", async () => {
    const { sheet } = await open();

    expect(
      (within(sheet).getByRole("button", { name: "Swap" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("reports the chosen meal and closes", async () => {
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));
    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    expect(onConfirm).toHaveBeenCalledWith(CURRY);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("writes nothing itself", async () => {
    // The sheet asks a question and reports the answer. Every call to a Server
    // Action is `right-now.tsx`'s, which is what keeps the optimistic layer and
    // the retry in one place — and what lets this file render without a mock.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));
    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("is the one ink action in the sheet", async () => {
    // § The Four Rules: actions are ink, and there is one primary per screen.
    const { sheet } = await open();

    expect(sheet.querySelectorAll('[data-variant="default"]')).toHaveLength(1);
  });
});

describe("the selection", () => {
  test("does not survive the sheet being dismissed", async () => {
    // A sheet reopened after a cancelled swap must not start with the abandoned
    // choice still ringed — that reads as the swap having half-happened.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));
    expect(column(sheet, "Calories")).toContain("960");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Open" }));

    const reopened = screen.getByRole("dialog");

    expect(column(reopened, "Calories")).toContain("1,100");
    expect(
      (within(reopened).getByRole("button", { name: "Swap" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
