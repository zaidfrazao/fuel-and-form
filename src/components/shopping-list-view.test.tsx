import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ShoppingGroup } from "@/lib/shopping-list";

/**
 * The shopping list's screen — FUEL-45's acceptance criteria, as far as a
 * rendered list can answer them.
 *
 * The Server Action is mocked because it IS the request; what it writes is
 * `actions/shopping.test.ts`, and that the tick survives a swap against real
 * Postgres is `tests/integration/shopping.test.ts`. What is asserted here is
 * what a person can see and do: that every line is individually checkable, that
 * a tick lands on the frame it was tapped, that a refusal reverts it and says
 * so, that the copy carries the list as text, and that the rows are hairlines
 * on the canvas rather than a card.
 *
 * ## Why the optimistic assertions hold the promise open
 *
 * A mock that resolves immediately destroys the thing under test: the
 * optimistic value is replaced by the server's answer before an assertion can
 * see it, and the test then passes for the wrong reason — or flakes, depending
 * on how the microtask queue lands. So the action returns a promise this file
 * holds, asserts against the held frame, and releases. `week-grid.test.tsx`
 * takes the same care and states it.
 */

const { setChecked } = vi.hoisted(() => ({ setChecked: vi.fn() }));

vi.mock("@/app/actions/shopping", () => ({ setChecked }));

const { ShoppingListView } = await import("./shopping-list-view");

/** Monday 9 March 2026 — the fixture week the whole suite shares. */
const MON = "2026-03-09";

const GROUPS: ShoppingGroup[] = [
  {
    category: "produce",
    lines: [
      {
        key: "onion",
        name: "Onion",
        category: "produce",
        grams: null,
        gramsPartial: true,
        measures: [{ text: "1 large", times: 2 }],
        times: 2,
      },
      {
        key: "spinach",
        name: "Spinach",
        category: "produce",
        grams: 200,
        gramsPartial: false,
        measures: [],
        times: 1,
      },
    ],
  },
  {
    category: "meat",
    lines: [
      {
        key: "beef mince",
        name: "Beef mince",
        category: "meat",
        grams: 300,
        gramsPartial: false,
        measures: [],
        times: 2,
      },
    ],
  },
];

const list = (checked: string[] = []) =>
  render(<ShoppingListView week={MON} groups={GROUPS} checked={checked} />);

/** One line's checkbox, by the name a person reads. */
const box = (name: string) =>
  screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement;

/** A promise the test releases, so an optimistic frame can be observed. */
function held() {
  let release: (value: { ok: boolean }) => void = () => {};
  const promise = new Promise<{ ok: boolean }>((resolve) => {
    release = resolve;
  });

  setChecked.mockReturnValue(promise);

  return () => release({ ok: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  setChecked.mockResolvedValue({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Individually checkable                                                     */
/* -------------------------------------------------------------------------- */

describe("ticking a line", () => {
  test("gives every line its own checkbox", () => {
    // "Items individually checkable" — one control per line, not a bulk one.
    list();

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  test("renders a line the server says is ticked as ticked", () => {
    list(["beef mince"]);

    expect(box("Beef mince").checked).toBe(true);
    expect(box("Spinach").checked).toBe(false);
  });

  test("sends the line's key and the week it belongs to", async () => {
    list();

    await userEvent.setup().click(box("Spinach"));

    // The KEY, not the display name: the tick is stored against the normalised
    // spelling, which is what makes it survive a regeneration.
    expect(setChecked).toHaveBeenCalledWith({
      week: MON,
      key: "spinach",
      checked: true,
    });
  });

  test("asks for the tick to be cleared when a ticked line is tapped", async () => {
    list(["spinach"]);

    await userEvent.setup().click(box("Spinach"));

    expect(setChecked).toHaveBeenCalledWith({
      week: MON,
      key: "spinach",
      checked: false,
    });
  });

  test("ticks a line before the server answers", async () => {
    // § Feedback is "optimistic by default" — the PRD budgets 300ms and this is
    // how it is met. Held open, or the server's answer would arrive first and
    // this would assert nothing.
    const release = held();

    list();
    await userEvent.setup().click(box("Spinach"));

    expect(((await screen.findByRole("checkbox", { name: /Spinach/ })) as HTMLInputElement).checked).toBe(
      true,
    );

    release();
  });

  test("leaves the other lines alone when one is ticked", async () => {
    const release = held();

    list();
    await userEvent.setup().click(box("Spinach"));

    // One optimistic map over the whole list, so a tick cannot leak sideways.
    expect(box("Onion").checked).toBe(false);
    expect(box("Beef mince").checked).toBe(false);

    release();
  });
});

/* -------------------------------------------------------------------------- */
/* Failure                                                                    */
/* -------------------------------------------------------------------------- */

describe("a refusal", () => {
  test("reverts the line and offers Try again", async () => {
    setChecked.mockResolvedValue({ ok: false });

    list();
    await userEvent.setup().click(box("Spinach"));

    // § Feedback: "inline banner at the point of action, value reverted, 'Try
    // again'. Never a modal."
    //
    // Awaited rather than read synchronously: the refusal arrives from a
    // promise and the banner is set inside a nested transition, so a `getBy`
    // here races the frame that paints it.
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t tick that off.");
    expect(box("Spinach").checked).toBe(false);
  });

  test("names what failed rather than saying something went wrong", async () => {
    // § Tone of Voice, and the two directions are different sentences because
    // they are different disappointments.
    setChecked.mockResolvedValue({ ok: false });

    list(["spinach"]);
    await userEvent.setup().click(box("Spinach"));

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t put that back.");
  });

  test("retries the attempt that was refused, not the row's current state", async () => {
    setChecked.mockResolvedValue({ ok: false });

    list();
    const user = userEvent.setup();

    await user.click(box("Spinach"));
    await screen.findByRole("alert");

    setChecked.mockClear();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(setChecked).toHaveBeenCalledWith({ week: MON, key: "spinach", checked: true });
  });

  test("survives the request itself failing, not just the action refusing", async () => {
    // A shop is a supermarket basement with one bar of signal. A rejected
    // request is a different path from `{ ok: false }`, and an escaping
    // rejection would revert the row with nothing on screen to say why.
    setChecked.mockRejectedValue(new Error("network down"));

    list();
    await userEvent.setup().click(box("Spinach"));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(box("Spinach").checked).toBe(false);
  });

  test("shows the banner on the line it belongs to and nowhere else", async () => {
    setChecked.mockResolvedValue({ ok: false });

    list();
    await userEvent.setup().click(box("Spinach"));
    await screen.findByRole("alert");

    // "At the point of action" — one banner, on the row that was tapped.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

describe("copy to clipboard", () => {
  test("writes the list as plain text and says it did", async () => {
    // `userEvent.setup()` installs a clipboard stub; jsdom has none of its own.
    const user = userEvent.setup();

    list(["beef mince"]);
    await user.click(screen.getByRole("button", { name: "Copy as text" }));

    expect(await navigator.clipboard.readText()).toBe(
      [
        "PRODUCE",
        "- [ ] Onion  1 large ×2",
        "- [ ] Spinach  200g",
        "",
        "MEAT",
        "- [x] Beef mince  300g",
      ].join("\n"),
    );

    // Success is NOT silent here, against § Feedback's default: a clipboard
    // write leaves the screen identical, so silence is indistinguishable from
    // the button having done nothing.
    expect((await screen.findByRole("status")).textContent).toBe("Copied.");
  });

  test("copies the tick a tap just made, before the server has answered", async () => {
    // The text is computed from the optimistic set. Reading the server's copy
    // instead would put a list on the clipboard that disagrees with the screen.
    const release = held();
    const user = userEvent.setup();

    list();
    await user.click(box("Spinach"));
    await user.click(screen.getByRole("button", { name: "Copy as text" }));

    expect(await navigator.clipboard.readText()).toContain("- [x] Spinach");

    release();
  });

  test("says so when the clipboard refuses", async () => {
    const user = userEvent.setup();

    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    list();
    await user.click(screen.getByRole("button", { name: "Copy as text" }));

    expect((await screen.findByRole("status")).textContent).toBe("Couldn’t copy that.");
  });
});

/* -------------------------------------------------------------------------- */
/* Brand                                                                      */
/* -------------------------------------------------------------------------- */

describe("the list is a list, not a card", () => {
  test("separates rows with hairlines and gives them no fill or border box", () => {
    // § Lists: "rows on the canvas, separated by hairlines. No card, no fill,
    // no outer rule."
    const { container } = list();

    for (const row of container.querySelectorAll("li")) {
      expect(row.className).toContain("border-b");
      expect(row.className).toContain("border-border");
      expect(row.className).not.toMatch(/\bbg-(surface|raised|card)\b/);
      expect(row.className).not.toMatch(/\brounded\b/);
    }

    // The container around them carries no card either — asserted on the list
    // element itself, because a rule added there is exactly the "outer rule"
    // the guide names.
    for (const group of container.querySelectorAll("ul")) {
      expect(group.className).not.toMatch(/border|rounded|bg-/);
    }
  });

  test("marks a ticked line by shape and not by colour alone", () => {
    // § Accessibility: "never colour alone". A dimmed name survives greyscale
    // as nothing at all; the strike survives it as a strike.
    list(["beef mince"]);

    const name = screen.getByText("Beef mince");

    expect(name.className).toContain("line-through");
  });

  test("groups the lines under their aisle", () => {
    list();

    expect(screen.getByRole("heading", { name: "produce" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "meat" })).toBeDefined();
  });

  test("gives each row a 46px target, the dense-context height", () => {
    // § Lists' dense height for ingredients, which is also what clears
    // § Accessibility's 44px touch minimum.
    const { container } = list();

    for (const label of container.querySelectorAll("label")) {
      expect(label.className).toContain("min-h-[46px]");
    }
  });
});
