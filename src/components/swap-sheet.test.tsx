import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { type PlannedMeal, SwapSheet, type SwappableMeal } from "@/components/swap-sheet";
import type { MacroTarget } from "@/lib/macros";
import { REPEAT_COUNTS, REPEAT_MAX } from "@/lib/repeat";

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
const onRepeat = vi.fn();

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
  repeatable = true,
}: {
  planned?: PlannedMeal[];
  meals?: SwappableMeal[];
  slot?: PlannedMeal["slot"];
  /** Whether the caller offers a repeat at all — the prop is optional. */
  repeatable?: boolean;
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
        onRepeat={repeatable ? onRepeat : undefined}
      />
    </>
  );
}

async function open(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();

  onConfirm.mockReset();
  onRepeat.mockReset();
  render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));

  return { user, sheet: screen.getByRole("dialog") };
}

/**
 * The value and its slash metadata for one column of the totals grid.
 *
 * `KeyValueGrid` renders each pair as `<div><dt>label</dt><dd>…</dd></div>`, so
 * the label's parent is exactly one column. That matters more than it looks:
 * if this reached the whole `<dl>` instead, every assertion below would be
 * matching a substring of all four columns at once and would pass for the wrong
 * reason — including if the figures were swapped between columns. The first
 * case in this describe pins that, so the helper is self-checking.
 */
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

    // The helper reads ONE column, not the whole grid. Without this the
    // assertions above would pass even if `column` returned every figure on
    // the sheet — and would keep passing if the two were transposed.
    expect(column(sheet, "Calories")).not.toContain("54 g");
    expect(column(sheet, "Protein")).not.toContain("960");
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

  test("move again when the selection moves to a second tile", async () => {
    // "Updates as the selected tile changes" — the acceptance criterion is about
    // the SECOND tap, and the case above only makes the first. A preview that
    // computed once and froze passes every other test in this file: the figures
    // would be right for the meal the reader settled on first and wrong for the
    // one they settled on, which is the only reading that matters.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));
    expect(column(sheet, "Calories")).toContain("960");

    // 1,100 − 700 + 900 = 1,300, and nothing of the curry left in it.
    await user.click(within(sheet).getByRole("button", { name: /Salmon and greens/ }));

    expect(column(sheet, "Calories")).toContain("1,300");
    expect(column(sheet, "Calories")).not.toContain("960");
    expect(column(sheet, "Protein")).toContain("90 g");
  });

  test("go back to the day as it stands when the swapped-away meal is chosen", async () => {
    // The selection landing back on the ink anchor is a real tap, not a no-op:
    // the reader compared two meals and came back. The figures have to come back
    // with them — a preview that only ever moved AWAY from the base would leave
    // the panel claiming a cost for a swap that changes nothing.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));
    await user.click(within(sheet).getByRole("button", { name: /Chilli/ }));

    expect(column(sheet, "Calories")).toContain("1,100");
    expect(column(sheet, "Protein")).toContain("75 g");
  });
});

/* -------------------------------------------------------------------------- */
/* The panel the figures sit in — FUEL-32                                     */
/* -------------------------------------------------------------------------- */

/** The tinted block: the live region, which is the panel's own element. */
const panel = (sheet: HTMLElement) =>
  sheet.querySelector('[aria-live="polite"]') as HTMLElement;

describe("the preview panel", () => {
  test("sits above the confirm, never after it", async () => {
    // The acceptance criterion is an ORDER, so this reads document position
    // rather than finding both elements on the screen — a panel rendered below
    // the button would satisfy every "is it there" assertion in this file while
    // failing the one thing § Progressive Disclosure asks of it.
    //
    // Same comparison the repeat control's placement uses, for the same reason:
    // a restyle that keeps the order passes, a reorder that keeps the styling
    // fails.
    const { sheet } = await open();

    const position = panel(sheet).compareDocumentPosition(
      within(sheet).getByRole("button", { name: "Swap" }),
    );

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("sits on the tinted ground", async () => {
    // § Color Palette gives `accent-subtle` to swapped cells and the Swapped
    // tag; this panel is the swap being CONSIDERED, read on the same ground.
    // Pinned the way week-grid.test.tsx and right-now.test.tsx pin theirs.
    const { sheet } = await open();

    expect(panel(sheet).className).toContain("bg-accent-subtle");
  });

  test("does not spend the sheet's one umber element", async () => {
    // § The Four Rules allows the picker exactly one, and it is the selection
    // ring `Tile` draws. A tinted GROUND is not the accent — right-now.tsx
    // settles that for the Swapped tag — so adding this panel must not have
    // introduced a second umber thing anywhere in the sheet.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));

    expect(sheet.querySelectorAll('[class*="bg-accent"]:not([class*="bg-accent-subtle"])'))
      .toHaveLength(0);
    expect(sheet.querySelectorAll('[class*="text-accent"]')).toHaveLength(0);
  });

  test("steps its greys down from the tint rather than keeping text-secondary", async () => {
    // The reason `tinted` exists. `text-secondary` measures 4.07:1 on
    // `accent-subtle`, under § Accessibility's AA floor — so a panel that only
    // changed its background would put every label and every metadata line below
    // the standard the guide sets for itself.
    //
    // Asserted on the label, which is the element that would otherwise keep the
    // failing grey. A class name rather than a computed ratio because jsdom
    // resolves no stylesheet; the ratios themselves are recorded against
    // `TINTED_TEXT` in kv-grid.tsx, where the values they are derived from live.
    const { sheet } = await open();

    const label = within(panel(sheet)).getByText("Calories");

    expect(label.className).not.toContain("text-text-secondary");
    expect(label.className).toContain("text-text-primary/[0.68]");
  });

  test("leaves the calorie delta's red at full strength", async () => {
    // The whole reason the tinted tone works through `color` and not `opacity`.
    // `opacity` applies to a subtree, and the delta is a `text-error` span
    // INSIDE the metadata line — under a dimmed line the panel would be
    // softening the one figure on it that is trying to be noticed.
    const { user, sheet } = await open({
      planned: [
        { slot: "breakfast", meal: { id: "m4", name: "Overnight oats", kcal: 1800, proteinG: 130, fatG: 40, carbG: 150 } },
        { slot: "dinner", meal: { id: "m1", name: "Chilli", kcal: 700, proteinG: 45, fatG: 20, carbG: 60 } },
      ],
    });

    await user.click(within(sheet).getByRole("button", { name: /Salmon and greens/ }));

    const red = panel(sheet).querySelector(".text-error") as HTMLElement;

    expect(red.textContent).toBe("+700");
    expect(red.closest('[class*="opacity-"]')).toBeNull();
  });

  test("persists nothing, however many tiles are tapped", async () => {
    // The component-level half of macros § 1.3 case 6. That case proves the
    // ARITHMETIC writes nothing — a pure function with no connection in reach.
    // This proves the sheet around it does not either: a reader may price the
    // whole library before deciding, and none of it is a swap until the confirm
    // is tapped.
    const { user, sheet } = await open();

    await user.click(within(sheet).getByRole("button", { name: "Show all meals" }));

    for (const meal of [CURRY, SALMON, OATS, CHILLI]) {
      await user.click(within(sheet).getByRole("button", { name: new RegExp(meal.name) }));
    }

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRepeat).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
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

/* -------------------------------------------------------------------------- */
/* Repeat — FUEL-24                                                           */
/* -------------------------------------------------------------------------- */

/** The one text button, whatever count it currently names. */
const repeatButton = (sheet: HTMLElement) =>
  within(sheet).getByRole("button", { name: /^Repeat for \d+ days$/ });

/** Whether a control is currently refusing taps. */
const isDisabled = (element: HTMLElement) => (element as HTMLButtonElement).disabled;

const stepper = (sheet: HTMLElement, direction: "One day more" | "One day fewer") =>
  within(sheet).getByRole("button", { name: direction });

const choose = (sheet: HTMLElement, user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(sheet).getByRole("button", { name: /Chickpea curry/ }));

describe("the repeat control", () => {
  test("sits beneath the confirm, not beside it", async () => {
    // § Progressive Disclosure's order, and the acceptance criterion's
    // "beneath the primary confirm". Compared by document position rather than
    // by looking for a class, so a restyle that kept the order passes and a
    // reorder that kept the styling fails.
    const { sheet } = await open();

    const swap = within(sheet).getByRole("button", { name: "Swap" });
    const position = swap.compareDocumentPosition(repeatButton(sheet));

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("is a text button, not a second filled one", async () => {
    // The criterion says so outright, and § Buttons gives "Repeat for 2 days"
    // to the Text variant by name. Two filled buttons would be two primaries,
    // and the sheet would have stopped saying which action it is for.
    //
    // Asserted through `data-variant`, which `Button` writes for exactly this:
    // the class list is a cva composition that a restyle would churn. The
    // "exactly one filled button" case above is the other half of this, and it
    // is what would fail if the repeat ever became a second primary.
    const { sheet } = await open();

    expect(repeatButton(sheet).getAttribute("data-variant")).toBe("link");
    expect(
      within(sheet).getByRole("button", { name: "Swap" }).getAttribute("data-variant"),
    ).toBe("default");
  });

  test("names the count it will act on", async () => {
    // The Brand Guide's literal copy, and the whole reason the number is in the
    // label: a control saying "Repeat" beside a separate "5" would be asking
    // the reader to assemble the sentence themselves.
    const { sheet } = await open();

    expect(within(sheet).getByRole("button", { name: "Repeat for 2 days" })).not.toBeNull();
  });

  test("is disabled until a meal is chosen", async () => {
    // The confirm's rule, for the confirm's reason: there is no meal to push
    // forward yet, and a control that silently does nothing when tapped is
    // worse than one that says it cannot be used.
    const { sheet, user } = await open();

    expect(isDisabled(repeatButton(sheet))).toBe(true);

    await choose(sheet, user);

    expect(isDisabled(repeatButton(sheet))).toBe(false);
  });

  test("reports the chosen meal and the chosen count", async () => {
    const { sheet, user } = await open();

    await choose(sheet, user);
    await user.click(stepper(sheet, "One day more"));
    await user.click(repeatButton(sheet));

    expect(onRepeat).toHaveBeenCalledWith(expect.objectContaining({ id: "m2" }), 3);
  });

  test("does not also confirm a one-day swap", async () => {
    // The two exits are separate writes. A repeat that fired both would write
    // the override twice — harmless in the database, and a second banner and a
    // second failed retry if either half were refused.
    const { sheet, user } = await open();

    await choose(sheet, user);
    await user.click(repeatButton(sheet));

    expect(onRepeat).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("closes the sheet, as the confirm does", async () => {
    const { sheet, user } = await open();

    await choose(sheet, user);
    await user.click(repeatButton(sheet));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("is absent entirely when the caller offers no repeat", async () => {
    // The prop is optional so the sheet can be mounted without acquiring an
    // opinion about a repeat — the dev specimen page, and FUEL-28's grid cells
    // for a date that is not today.
    const { sheet } = await open({ repeatable: false });

    expect(within(sheet).queryByRole("button", { name: /^Repeat for/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "One day more" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Swap" })).not.toBeNull();
  });
});

describe("the day count", () => {
  test("starts at the shortest run", async () => {
    const { sheet } = await open();

    expect(repeatButton(sheet).textContent).toBe("Repeat for 2 days");
  });

  test("steps up and back down", async () => {
    const { sheet, user } = await open();

    await user.click(stepper(sheet, "One day more"));
    await user.click(stepper(sheet, "One day more"));

    expect(repeatButton(sheet).textContent).toBe("Repeat for 4 days");

    await user.click(stepper(sheet, "One day fewer"));

    expect(repeatButton(sheet).textContent).toBe("Repeat for 3 days");
  });

  test("cannot go below the shortest run", async () => {
    // Two, not one. A repeat of a single day is the substitute this sheet
    // already offers, and the endpoint refuses it — so the control must not be
    // able to ask for it, or the button would read as broken rather than bounded.
    const { sheet } = await open();

    expect(isDisabled(stepper(sheet, "One day fewer"))).toBe(true);
  });

  test("cannot go past a week", async () => {
    // `REPEAT_MAX`. Beyond a week a repeat stops meaning "this batch of mince"
    // and starts meaning the template, which the PRD makes a separate action.
    const { sheet, user } = await open();

    const more = stepper(sheet, "One day more");

    // Five taps from 2 reaches 7; the sixth must not be possible.
    for (let tap = 0; tap < 5; tap += 1) await user.click(more);

    expect(repeatButton(sheet).textContent).toBe("Repeat for 7 days");
    expect(isDisabled(more)).toBe(true);
  });

  test("offers exactly the counts the endpoint accepts", async () => {
    // The drift this pins: a stepper that could reach a count `repeatDates`
    // refuses would look like the button failing rather than a limit holding.
    // Walked rather than assumed, so widening the range in lib/repeat.ts moves
    // both sides of this together or fails.
    const { sheet, user } = await open();

    const more = stepper(sheet, "One day more");
    const reached: number[] = [];

    // One more tap than the range is wide, so a stepper that ran past the end
    // would be caught rather than stopping the loop at the expected count.
    for (let tap = 0; tap <= REPEAT_COUNTS.length; tap += 1) {
      reached.push(Number(/\d+/.exec(repeatButton(sheet).textContent ?? "")?.[0]));

      if (isDisabled(more)) break;

      await user.click(more);
    }

    expect(reached).toEqual([...REPEAT_COUNTS]);
    expect(reached.at(-1)).toBe(REPEAT_MAX);
  });

  test("announces the count where the focus does not move", async () => {
    // The stepper button keeps focus while the value beneath it changes, so
    // without a live region a screen-reader user hears nothing until they
    // navigate back to the text button. A bare "3" is ambiguous read aloud,
    // hence the worded copy beside the hidden digit.
    const { sheet, user } = await open();

    await user.click(stepper(sheet, "One day more"));

    // Scoped through the stepper's own group. The sheet has a SECOND polite
    // live region — the day totals — which comes first in document order, so a
    // bare `[aria-live]` query would silently assert against that one instead.
    // Scoped by ROLE and LABEL rather than by a styling class, so a restyle
    // cannot quietly point this at the wrong element.
    const live = sheet.querySelector(
      '[role="group"][aria-label="Days to repeat"] [aria-live="polite"]',
    );

    // The ANNOUNCED text and the SEEN glyph, asserted separately rather than as
    // the concatenation `textContent` happens to produce. The concatenation is
    // an artefact of putting both in one element, so asserting it would couple
    // this test to the markup and break on an accessibility refactor that
    // preserved the announcement exactly.
    expect(live?.querySelector(".sr-only")?.textContent).toBe("3 days");
    expect(live?.querySelector('[aria-hidden="true"]')?.textContent).toBe("3");
  });

  test("resets when the sheet is closed and reopened", async () => {
    // The selection's rule, for the selection's reason: a sheet reopened after
    // an abandoned repeat should not still be offering a count chosen in a
    // conversation the user walked away from.
    const { sheet, user } = await open();

    await user.click(stepper(sheet, "One day more"));
    expect(repeatButton(sheet).textContent).toBe("Repeat for 3 days");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(repeatButton(screen.getByRole("dialog")).textContent).toBe("Repeat for 2 days");
  });
});
