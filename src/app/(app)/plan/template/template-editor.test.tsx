import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { TemplateRow } from "@/lib/template-plan";

/**
 * The template editor — FUEL-25's screen, and the two acceptance criteria only
 * a rendered screen can answer: that editing the template is "reachable but
 * distinct from swapping", and that it is "never triggered accidentally".
 *
 * The Server Actions are mocked because they ARE the request. What they then
 * write is `actions/template.test.ts` and `tests/integration/template.test.ts`;
 * what is asserted here is the part a user can see — what a tap does, what it
 * takes to make a write happen at all, and whether the words on screen say what
 * the write will reach.
 *
 * The distinctness cases are deliberately about COPY. Two flows ending in the
 * same tile grid is fine; two flows a user cannot tell apart at the moment of
 * committing is not, and the two places anyone reads before a tap are the
 * sheet's title and the confirm's label.
 */

const { setTemplateMeal, clearTemplateMeal } = vi.hoisted(() => ({
  setTemplateMeal: vi.fn(),
  clearTemplateMeal: vi.fn(),
}));

vi.mock("@/app/actions/template", () => ({ setTemplateMeal, clearTemplateMeal }));

const { TemplateEditor } = await import("./template-editor");

const meal = (id: string, name: string, fields: Record<string, unknown> = {}) => ({
  id,
  name,
  slotType: "dinner" as const,
  kcal: 700,
  proteinG: 45,
  isArchived: false,
  ...fields,
});

const CHILLI = meal("m1", "Chilli con Carne");
const CURRY = meal("m2", "Chickpea Curry", { kcal: 560, proteinG: 24 });
const OATS = meal("m3", "Overnight Oats", { slotType: "breakfast", kcal: 400, proteinG: 30 });
const RETIRED = meal("m4", "Retired Traybake", { isArchived: true });

const LIBRARY = [CHILLI, CURRY, OATS, RETIRED];

/** Tuesday dinner is Chilli — PRD § Problem Statement's worked example. */
const TUESDAY_DINNER: TemplateRow = {
  id: "e1",
  dayOfWeek: 2,
  slot: "dinner",
  mealId: "m1",
  sortOrder: 0,
};

const editor = (entries: TemplateRow[] = [TUESDAY_DINNER]) =>
  render(<TemplateEditor entries={entries} meals={LIBRARY} />);

/** The row that opens a given weekday's slot. */
const row = (weekday: string, slot: string, meal: string) =>
  screen.getByRole("button", { name: `${weekday} ${slot}: ${meal}` });

/**
 * Holds an action open so the optimistic layer can be observed on its own, and
 * hands back the release.
 *
 * The release is not optional, and finding that out is what this helper is for.
 * A transition left suspended at the end of a test outlives the component that
 * started it: React does not consider the transition finished, and the NEXT
 * test's updates are swallowed into it — every assertion about a banner in the
 * rest of the file fails, in a file where each test passes on its own.
 */
function held(action = setTemplateMeal) {
  let release!: () => void;

  action.mockReturnValue(
    new Promise<{ ok: boolean }>((resolve) => {
      release = () => resolve({ ok: true });
    }),
  );

  return async () => {
    release();
    // Let the transition settle before the test ends, so cleanup unmounts a
    // component with nothing still in flight.
    await screen.findByRole("heading", { level: 2, name: "Monday" });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setTemplateMeal.mockResolvedValue({ ok: true });
  clearTemplateMeal.mockResolvedValue({ ok: true });
});

describe("the week", () => {
  test("renders all seven days, Monday first", () => {
    editor();

    const days = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

    expect(days).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  test("shows what a slot recurs to", () => {
    editor();

    expect(row("Tuesday", "dinner", "Chilli con Carne")).toBeTruthy();
  });

  test("renders an unplanned slot as a control rather than omitting it", () => {
    // The weekend the seed leaves half-empty. An empty row is how a meal gets
    // planned at all, so a screen that showed only what is planned would have
    // no way to plan anything.
    editor();

    expect(row("Saturday", "lunch", "not planned")).toBeTruthy();
  });

  test("names the weekday in every row's accessible name", () => {
    // Seven rows are called "Dinner". Without the weekday a screen-reader user
    // would have seven identical buttons and no way to tell which one changes
    // Tuesday.
    editor();

    expect(row("Monday", "dinner", "not planned")).toBeTruthy();
    expect(row("Tuesday", "dinner", "Chilli con Carne")).toBeTruthy();
  });
});

describe("distinct from swapping", () => {
  test("the sheet is headed by the weekday, not by 'Swap'", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));

    expect(screen.getByRole("dialog", { name: /Every Tuesday/ })).toBeTruthy();
    expect(screen.queryByText("Swap dinner")).toBeNull();
  });

  test("the confirm names the blast radius, and does not say Swap", async () => {
    // The last thing read before the tap. "Save to every Tuesday" is a sentence
    // about the future; "Swap" is a sentence about tonight.
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));

    expect(screen.getByRole("button", { name: "Save to every Tuesday" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Swap" })).toBeNull();
  });

  test("offers no repeat control — that is the swap flow's", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));

    expect(screen.queryByText(/Repeat for/)).toBeNull();
  });
});

describe("never triggered accidentally", () => {
  test("tapping a row writes nothing — it opens the picker", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));

    expect(setTemplateMeal).not.toHaveBeenCalled();
    expect(clearTemplateMeal).not.toHaveBeenCalled();
  });

  test("choosing a tile writes nothing — the confirm does", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));

    expect(setTemplateMeal).not.toHaveBeenCalled();
  });

  test("the confirm is inert until a meal is chosen", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));

    const confirm = screen.getByRole("button", { name: "Save to every Tuesday" });

    expect(confirm).toHaveProperty("disabled", true);

    await user.click(confirm);

    expect(setTemplateMeal).not.toHaveBeenCalled();
  });

  test("a slot that holds nothing offers no Clear", async () => {
    // The state is what offers the control, so it survives a reload without
    // anything having to remember it.
    const user = userEvent.setup();

    editor();
    await user.click(row("Saturday", "lunch", "not planned"));

    expect(screen.queryByRole("button", { name: "Clear this slot" })).toBeNull();
  });
});

describe("the write", () => {
  test("saves the chosen meal to the weekday and slot that was tapped", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    expect(setTemplateMeal).toHaveBeenCalledWith(2, "dinner", "m2");
  });

  test("shows the new meal without waiting for the server", async () => {
    // § Feedback is optimistic by default. The action is held open here, so
    // anything on screen is the optimistic layer's doing and nothing else's.
    const user = userEvent.setup();
    const answer = held();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    expect(row("Tuesday", "dinner", "Chickpea Curry")).toBeTruthy();

    await answer();
  });

  test("clears a slot the template fills", async () => {
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: "Clear this slot" }));

    expect(clearTemplateMeal).toHaveBeenCalledWith(2, "dinner");
  });

  test("empties the row optimistically when cleared", async () => {
    const user = userEvent.setup();
    const answer = held(clearTemplateMeal);

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: "Clear this slot" }));

    expect(row("Tuesday", "dinner", "not planned")).toBeTruthy();

    await answer();
  });

  test("does not offer a retired meal", async () => {
    // The picker filters archived meals, and actions/template.ts refuses one
    // again on the way in. Retiring a meal stops it being scheduled again.
    const user = userEvent.setup();

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));

    expect(screen.queryByRole("button", { name: /Retired Traybake/ })).toBeNull();
  });
});

describe("a refusal", () => {
  test("says what failed and offers a retry", async () => {
    const user = userEvent.setup();

    setTemplateMeal.mockResolvedValue({ ok: false });

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Couldn’t save that to the template");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("names the clear when it was a clear that failed", async () => {
    // § Tone of Voice: name what happened. A clear did not fail to "save".
    const user = userEvent.setup();

    clearTemplateMeal.mockResolvedValue({ ok: false });

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: "Clear this slot" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t clear that slot",
    );
  });

  test("reverts the row it could not save", async () => {
    const user = userEvent.setup();

    setTemplateMeal.mockResolvedValue({ ok: false });

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    await screen.findByRole("alert");

    expect(row("Tuesday", "dinner", "Chilli con Carne")).toBeTruthy();
  });

  test("re-runs the same write, not a different one", async () => {
    // The sheet has closed by the time an answer arrives, so the retry has
    // nowhere to read the attempt from but the failure itself.
    const user = userEvent.setup();

    setTemplateMeal.mockResolvedValue({ ok: false });

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(setTemplateMeal).toHaveBeenCalledTimes(2);
    expect(setTemplateMeal).toHaveBeenLastCalledWith(2, "dinner", "m2");
  });

  test("survives a rejected request, not just a refused one", async () => {
    // No signal in a kitchen. The action itself never throws, but reaching it
    // is a network request that can.
    const user = userEvent.setup();

    setTemplateMeal.mockRejectedValue(new Error("offline"));

    editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("the column flow", () => {
  /**
   * § Desktop, amended by FUEL-85 — the same ruling `/shopping` gets, at three
   * columns: "the same move, three columns: seven day groups of four slots".
   *
   * Structure only, for `shopping-list-view.test.tsx`'s reason: jsdom applies
   * no stylesheet, so the fragmentation itself is `page-columns.spec.ts`'s to
   * measure. What is held here is what the flow is allowed to contain.
   */
  test("the seven days are the groups that flow, and nothing else is", () => {
    const { container } = editor();

    const flow = container.querySelector("[data-column-flow]");

    expect(flow?.querySelectorAll(":scope > section")).toHaveLength(7);
  });

  /*
   * § Feedback puts a refusal "inline banner at the point of action", and
   * `template-editor.tsx` places it above the list because "the point of action
   * is the list — the sheet has closed by the time an answer arrives". Flowed
   * into a column it would be a banner BESIDE the action rather than above it,
   * and in column two on a wide screen it would be beside the wrong day.
   */
  test("a refusal banner stands above all three columns", async () => {
    const user = userEvent.setup();

    setTemplateMeal.mockResolvedValue({ ok: false });

    const { container } = editor();
    await user.click(row("Tuesday", "dinner", "Chilli con Carne"));
    await user.click(screen.getByRole("button", { name: /Chickpea Curry/ }));
    await user.click(screen.getByRole("button", { name: "Save to every Tuesday" }));

    const banner = await screen.findByRole("alert");
    const flow = container.querySelector("[data-column-flow]");

    expect(flow?.contains(banner), "the banner is outside the flow").toBe(false);
    expect(
      banner.compareDocumentPosition(flow!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "and above it",
    ).toBeTruthy();
  });
});
