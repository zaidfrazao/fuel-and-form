import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { PlannedDay } from "@/lib/week-grid";

/**
 * The weekly grid — FUEL-28's screen, and the acceptance criteria only a
 * rendered table can answer.
 *
 * The Server Actions are mocked because they ARE the request; what they write
 * is `actions/plan.test.ts` and `tests/integration/week.test.ts`. What is
 * asserted here is the part a user can see: that all seven days carry all five
 * slots, that a swapped cell is marked in a way that survives greyscale, that
 * an unplanned cell is hatched rather than blank, that the slot column stays
 * put while the days scroll, and that exactly one thing on the screen is umber.
 *
 * The last one is the rule most likely to rot silently — § The Four Rules gives
 * the accent to "today's column header in the week grid" and allows "one umber
 * element per screen", and nothing about a second one would look wrong in a
 * diff. So it is counted rather than spot-checked.
 */

const { swapOnDate, repeatFromDate, revertOnDate } = vi.hoisted(() => ({
  swapOnDate: vi.fn(),
  repeatFromDate: vi.fn(),
  revertOnDate: vi.fn(),
}));

vi.mock("@/app/actions/plan", () => ({ swapOnDate, repeatFromDate, revertOnDate }));

const { WeekGrid } = await import("./week-grid");

const meal = (id: string, name: string, fields: Record<string, unknown> = {}) => ({
  id,
  name,
  slotType: "dinner" as const,
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  isArchived: false,
  ...fields,
});

const CHILLI = meal("m1", "Chilli con Carne");
const CURRY = meal("m2", "Chickpea Curry", { kcal: 560, proteinG: 24 });
const OATS = meal("m3", "Overnight Oats", { slotType: "breakfast", kcal: 400 });

const LIBRARY = [CHILLI, CURRY, OATS];

const TARGET = {
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
};

/** Monday 9 March 2026 through the Sunday. */
const WEEK = [
  "2026-03-09",
  "2026-03-10",
  "2026-03-11",
  "2026-03-12",
  "2026-03-13",
  "2026-03-14",
  "2026-03-15",
];

const TUE = "2026-03-10";

type Meal = typeof CHILLI;

const dinner = (
  meal: Meal,
  source: "template" | "override" = "template",
  entryId = "t1",
) => ({ slot: "dinner" as const, meal, source, entryId });

/**
 * The week as the template alone plans it — Chilli for dinner, every day.
 *
 * `templateDays` is what a revert restores, so it stays the template's answer
 * even in the fixtures where `days` carries an override.
 */
const template: PlannedDay<Meal>[] = WEEK.map((date) => ({
  date,
  meals: [dinner(CHILLI)],
}));

const grid = (
  days: PlannedDay<Meal>[] = template,
  today = TUE,
  templateDays: PlannedDay<Meal>[] = template,
) =>
  render(
    <WeekGrid
      today={today}
      days={days}
      templateDays={templateDays}
      meals={LIBRARY}
      target={TARGET}
    />,
  );

/** Tuesday's dinner, swapped to Curry — PRD § Problem Statement's example. */
const swappedTuesday = () =>
  template.map((day) =>
    day.date === TUE ? { ...day, meals: [dinner(CURRY, "override", "o1")] } : day,
  );

const cell = (name: string | RegExp) => screen.getByRole("button", { name });

/**
 * The same lookup, awaited — for anything that appears through a transition.
 *
 * The optimistic value is applied inside `startTransition`, and a banner lands
 * after an awaited action resolves. Neither is on the frame the click returns
 * on, so a synchronous `getBy` races React's flush: it happened to win
 * uninstrumented and lost under coverage, which is the same flake waiting to
 * happen on a loaded CI runner.
 */
const findCell = (name: string | RegExp) => screen.findByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  swapOnDate.mockResolvedValue({ ok: true });
  repeatFromDate.mockResolvedValue({ ok: true });
  revertOnDate.mockResolvedValue({ ok: true });
});

describe("the table", () => {
  test("shows all seven days with every meal slot", () => {
    grid();

    // Seven day columns plus the pinned corner.
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);

    // Five slot rows, whatever any one day plans.
    expect(screen.getAllByRole("rowheader").map((th) => th.textContent)).toEqual([
      "Breakfast",
      "Lunch",
      "Snack",
      "Dinner",
      "Extra",
    ]);

    // Thirty-five cells, always — a day that plans one meal still has five.
    expect(screen.getAllByRole("cell")).toHaveLength(35);
  });

  test("associates each cell with its day and slot for a screen reader", () => {
    grid();

    // The association is the markup's, not the layout's: thirty-five buttons
    // reading "Dinner" would be unusable without the date in the name.
    expect(cell("Tue 10 Mar dinner: Chilli con Carne")).toBeTruthy();
    expect(cell("Sun 15 Mar lunch: not planned")).toBeTruthy();
  });

  test("keeps the slot column pinned over the scrolling days", () => {
    const { container } = grid();

    const [corner] = screen.getAllByRole("columnheader");
    const [breakfast] = screen.getAllByRole("rowheader");

    // Sticky, and opaque. Without the fill the day columns scroll visibly
    // through the pinned cells; `bg-surface` is also the AC's permitted
    // `surface` use — the brand rule and the mechanic want the same pixel.
    for (const pinned of [corner, breakfast]) {
      expect(pinned?.className).toContain("sticky");
      expect(pinned?.className).toContain("left-0");
      expect(pinned?.className).toContain("bg-surface");
    }

    // One scrolling container, and it is not the page body. § Accessibility
    // excepts this grid from the no-horizontal-scroll rule by name.
    expect(container.querySelector(".overflow-x-auto")).toBeTruthy();

    // `border-separate`, because a collapsed table hands its borders to the
    // table and the sticky column then scrolls out from under its own hairlines.
    expect(container.querySelector("table")?.className).toContain("border-separate");
  });
});

describe("what a cell says about itself", () => {
  test("an overridden cell is tinted AND announced", () => {
    grid(swappedTuesday());

    const swapped = cell(/Tue 10 Mar dinner: Chickpea Curry/);

    expect(swapped.className).toContain("bg-accent-subtle");
    // A tint is a colour, and § Accessibility does not let a fact live in one
    // alone. Greyscale, colour-blindness and a screen reader all get the word.
    expect(swapped.getAttribute("aria-label")).toContain("swapped");
  });

  test("a template cell is neither tinted nor announced as swapped", () => {
    grid();

    const plain = cell("Wed 11 Mar dinner: Chilli con Carne");

    expect(plain.className).not.toContain("bg-accent-subtle");
    expect(plain.getAttribute("aria-label")).not.toContain("swapped");
  });

  test("an unplanned cell carries the 45° hatch and says so", () => {
    grid();

    const empty = cell("Mon 9 Mar lunch: not planned");

    // § Materials, quoted: a pattern rather than a texture, marking the absence
    // of data without implying failure.
    expect(empty.style.backgroundImage).toBe(
      "repeating-linear-gradient(-45deg, var(--border) 0 1px, transparent 1px 5px)",
    );
    expect(within(empty).getByText("Not planned")).toBeTruthy();
  });

  test("a filled cell carries no hatch", () => {
    grid();

    expect(cell("Wed 11 Mar dinner: Chilli con Carne").style.backgroundImage).toBe("");
  });
});

describe("the one umber mark", () => {
  test("today's column header takes the accent", () => {
    grid();

    const tuesday = screen
      .getAllByRole("columnheader")
      .find((th) => th.textContent?.includes("Tue 10 Mar"));

    expect(tuesday?.className).toContain("text-accent");
  });

  test("and it is the only accent on the screen", () => {
    const { container } = grid();

    // Counted rather than spot-checked. § The Four Rules allows exactly one
    // umber element per screen, and a second one would not look wrong in a diff.
    expect(container.querySelectorAll('[class*="text-accent"]')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="bg-accent"]:not([class*="subtle"])'))
      .toHaveLength(0);
  });

  test("says 'today' as well as colouring it", () => {
    grid();

    const tuesday = screen
      .getAllByRole("columnheader")
      .find((th) => th.textContent?.includes("Tue 10 Mar"));

    expect(tuesday?.textContent).toContain("today");
  });

  test("a week that does not contain today has no umber at all", () => {
    // Navigating away is ordinary, and there is no fallback marker: the accent
    // means "now", so a week without now in it has none.
    const { container } = grid(template, "2026-04-01");

    expect(container.querySelectorAll('[class*="text-accent"]')).toHaveLength(0);
  });
});

describe("editing a cell", () => {
  test("a tap opens the picker for that date and slot", async () => {
    grid();
    const user = userEvent.setup();

    await user.click(cell("Thu 12 Mar dinner: Chilli con Carne"));

    // The sheet is headed by the cell's OWN date, not today's — the swap lands
    // where it was tapped. Scoped to the dialog because the same label is on
    // the column header underneath it.
    const sheet = screen.getByRole("dialog");

    expect(within(sheet).getByText("Thu 12 Mar")).toBeTruthy();
    expect(within(sheet).getByText(/Dinner/i)).toBeTruthy();
  });

  test("nothing is written by opening a cell", async () => {
    grid();
    const user = userEvent.setup();

    await user.click(cell("Thu 12 Mar dinner: Chilli con Carne"));

    expect(swapOnDate).not.toHaveBeenCalled();
  });

  test("confirming writes the override for the cell's own date", async () => {
    grid();
    const user = userEvent.setup();

    await user.click(cell("Thu 12 Mar dinner: Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    expect(swapOnDate).toHaveBeenCalledWith("2026-03-12", "dinner", "m2");
  });

  test("the swapped meal appears before the server answers", async () => {
    let release: () => void = () => {};
    swapOnDate.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );

    grid();
    const user = userEvent.setup();

    await user.click(cell("Thu 12 Mar dinner: Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    // § Feedback is "optimistic by default": the cell shows the new meal on the
    // frame the sheet closes, tinted as the override it is about to become.
    const swapped = await findCell(/Thu 12 Mar dinner: Chickpea Curry/);
    expect(swapped.className).toContain("bg-accent-subtle");

    release();
  });

  test("a refusal reverts the cell and offers Try again", async () => {
    swapOnDate.mockResolvedValue({ ok: false });

    grid();
    const user = userEvent.setup();

    await user.click(cell("Thu 12 Mar dinner: Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    // § Feedback: "inline banner at the point of action, value reverted, 'Try
    // again'. Never a modal."
    //
    // Awaited, not read synchronously. The refusal arrives from a promise and
    // the banner is then set inside a nested transition, so a `getBy` here
    // races that continuation — it passed uninstrumented and failed under
    // coverage, which is the same flake waiting to happen in CI.
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t save that meal.",
    );
    expect(await findCell("Thu 12 Mar dinner: Chilli con Carne")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    // The retry re-runs the SAME write, which is why the attempt is stored
    // rather than a message — the sheet has closed by the time a refusal lands.
    expect(swapOnDate).toHaveBeenCalledTimes(2);
    expect(swapOnDate).toHaveBeenLastCalledWith("2026-03-12", "dinner", "m2");
  });

  test("a rejected request is caught, not left to escape the transition", async () => {
    swapOnDate.mockRejectedValue(new Error("offline"));

    grid();
    const user = userEvent.setup();

    await user.click(cell("Thu 12 Mar dinner: Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("repeat and revert", () => {
  test("a repeat runs forward from the cell that was tapped", async () => {
    grid();
    const user = userEvent.setup();

    await user.click(cell("Sat 14 Mar dinner: Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: /Repeat for 2 days/ }));

    expect(repeatFromDate).toHaveBeenCalledWith("2026-03-14", "dinner", "m2", 2);
  });

  test("a repeat paints every day of the run, not only the first", async () => {
    let release: () => void = () => {};
    repeatFromDate.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );

    grid();
    const user = userEvent.setup();

    await user.click(cell("Wed 11 Mar dinner: Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: /Repeat for 2 days/ }));

    // Both days, immediately. Painting only the tapped cell would show the user
    // one day of a change they were told covered two.
    expect(await findCell(/Wed 11 Mar dinner: Chickpea Curry/)).toBeTruthy();
    expect(await findCell(/Thu 12 Mar dinner: Chickpea Curry/)).toBeTruthy();

    release();
  });

  test("Revert is offered only for a cell that has an override", async () => {
    grid(swappedTuesday());
    const user = userEvent.setup();

    await user.click(cell(/Tue 10 Mar dinner: Chickpea Curry/));
    expect(screen.getByRole("button", { name: "Revert to template" })).toBeTruthy();
  });

  test("and not for one resolved from the template", async () => {
    grid();
    const user = userEvent.setup();

    await user.click(cell("Wed 11 Mar dinner: Chilli con Carne"));

    // A control that silently does nothing is worse than one that is not there.
    expect(screen.queryByRole("button", { name: "Revert to template" })).toBeNull();
  });

  test("reverting restores what the template says, before the server answers", async () => {
    let release: () => void = () => {};
    revertOnDate.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );

    grid(swappedTuesday());
    const user = userEvent.setup();

    await user.click(cell(/Tue 10 Mar dinner: Chickpea Curry/));
    await user.click(screen.getByRole("button", { name: "Revert to template" }));

    expect(revertOnDate).toHaveBeenCalledWith(TUE, "dinner");

    // The template's meal, not an empty cell — the override is being removed,
    // and resolution finds the template entry again the moment it is gone.
    const restored = await findCell("Tue 10 Mar dinner: Chilli con Carne");
    expect(restored.className).not.toContain("bg-accent-subtle");

    release();
  });

  test("reverting a slot the template leaves empty shows it unplanned", async () => {
    // The other half of the same rule: a swap that FILLED an empty slot reverts
    // to nothing, and the cell has to go back to hatched rather than keep a
    // meal it never had.
    const days = template.map((day) =>
      day.date === TUE
        ? { ...day, meals: [{ slot: "lunch" as const, meal: CURRY, source: "override" as const, entryId: "o2" }] }
        : day,
    );
    const templates = template.map((day) =>
      day.date === TUE ? { ...day, meals: [] } : day,
    );

    let release: () => void = () => {};
    revertOnDate.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );

    grid(days, TUE, templates);
    const user = userEvent.setup();

    await user.click(cell(/Tue 10 Mar lunch: Chickpea Curry/));
    await user.click(screen.getByRole("button", { name: "Revert to template" }));

    expect(await findCell("Tue 10 Mar lunch: not planned")).toBeTruthy();

    release();
  });

  test("a refused revert says so in its own words", async () => {
    revertOnDate.mockResolvedValue({ ok: false });

    grid(swappedTuesday());
    const user = userEvent.setup();

    await user.click(cell(/Tue 10 Mar dinner: Chickpea Curry/));
    await user.click(screen.getByRole("button", { name: "Revert to template" }));

    // § Tone of Voice: name what happened. A revert did not fail to "save".
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t revert that meal.",
    );
  });
});

/**
 * The daily totals and the weekly average — FUEL-33.
 *
 * The arithmetic is `lib/week-totals.test.ts`'s. What is asserted here is the
 * part only a rendered screen decides: that the figures are wired to the
 * OPTIMISTIC week rather than the props, so a swap moves them on the tap; that
 * a day with no plan reads as absent rather than as zero; and that the block
 * adds no second umber mark — which the count in § "the one umber mark" above
 * already enforces, from the other side.
 */
describe("what the week comes to", () => {
  /** The item for one label. `dt` takes no accessible name, so this is by text. */
  const totalFor = (label: string) =>
    screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement;

  test("every day carries its own kcal and protein", () => {
    grid();

    // Chilli for dinner, every day: 700 kcal and 45 g, seven times.
    expect(totalFor("Mon 9 Mar").textContent).toContain("700 kcal");
    expect(totalFor("Mon 9 Mar").textContent).toContain("45 g");
    expect(totalFor("Sun 15 Mar").textContent).toContain("700 kcal");
  });

  test("and the week states its average, and what it averaged over", () => {
    grid();

    // The divisor is shown rather than implied — a figure the reader can check
    // is the difference between an average and an assertion.
    expect(totalFor("Average").textContent).toContain("700 kcal");
    expect(totalFor("Average").textContent).toContain("7 days");
  });

  test("a swap moves the day and the average on the tap, not on the reload", async () => {
    // Held open, like § "editing a cell"'s optimistic test: the useOptimistic
    // value only stands while the action is in flight, and in a test there is
    // no revalidation behind it to hand back the same answer.
    let release: () => void = () => {};
    swapOnDate.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );

    grid();
    const user = userEvent.setup();

    await user.click(cell(/Tue 10 Mar dinner: Chilli con Carne/));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    // Curry is 560, so Tuesday drops 140 kcal and the week's mean drops 20.
    // Awaited, not read synchronously: the optimistic value lands inside a
    // transition, and a `getBy` here passes uninstrumented and flakes under
    // coverage — the same race `findCell` exists for.
    expect(await screen.findByText("560 kcal")).toBeTruthy();
    expect(totalFor("Tue 10 Mar").textContent).toContain("560 kcal");
    expect(totalFor("Average").textContent).toContain("680 kcal");

    release();
  });

  test("a day with nothing planned reads as absent, not as zero", () => {
    // § Materials, in figures rather than in a hatch: 0 kcal is a claim about
    // the day, and the true state of an unplanned one is that there is none.
    grid(template.map((day) => (day.date === "2026-03-15" ? { ...day, meals: [] } : day)));

    expect(totalFor("Sun 15 Mar").textContent).toContain("—");
    expect(totalFor("Sun 15 Mar").textContent).not.toContain("0 kcal");
    // And it leaves the average alone rather than dragging it toward zero.
    expect(totalFor("Average").textContent).toContain("700 kcal");
    expect(totalFor("Average").textContent).toContain("6 days");
  });

  test("a week before the program starts averages nothing at all", () => {
    grid(WEEK.map((date) => ({ date, meals: [] })));

    expect(screen.queryByText("Average", { selector: "dt" })).toBeNull();
  });
});
