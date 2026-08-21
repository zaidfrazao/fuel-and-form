import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { WeighInRow } from "@/components/weigh-ins";

/**
 * The Weight screen — FUEL-34's acceptance criteria, as the DOM answers them.
 *
 * The Server Actions are mocked because they ARE the request; what they write is
 * `actions/weight.test.ts` and `tests/integration/weight.test.ts`. What is
 * asserted here is the part a user can see, and three of those are criteria
 * that would rot silently rather than break:
 *
 *   - **`inputmode="decimal"`, and both separators.** A comma reaching the
 *     action unchanged is invisible from the screen — the parser is what turns
 *     it into a number — so what is asserted here is that the screen SENDS what
 *     was typed rather than a value some input type quietly emptied.
 *   - **The delete confirmation.** § Voice gives the sentence word for word;
 *     nothing about it drifting would look wrong in a diff.
 *   - **The destructive control's distance from the frequently-tapped one.**
 *     § Touch Targets states it as an absolute, and it is a fact about the tree
 *     rather than about a value, so it is asserted as one.
 */

const { saveWeighIn, deleteWeighIn } = vi.hoisted(() => ({
  saveWeighIn: vi.fn(),
  deleteWeighIn: vi.fn(),
}));

vi.mock("@/app/actions/weight", () => ({ saveWeighIn, deleteWeighIn }));

const { WeighIns } = await import("./weigh-ins");

const TODAY = "2026-08-20"; // a Thursday

const ENTRIES: WeighInRow[] = [
  { date: "2026-08-20", weightKg: 79.3, note: "before breakfast" },
  { date: "2026-08-13", weightKg: 80.1, note: null },
  { date: "2026-08-06", weightKg: 80.8, note: null },
];

/** Invented figures, per Testing Strategy § 1.5 — never the owner's real ones. */
const START_KG = 84.2;
const TARGET_KG = 76;

/** `profiles.goal_pace_kg_per_week`, and the middle of the band it implies. */
const GOAL_PACE = 0.5;

/**
 * Three weekly readings falling exactly half a kilogram each.
 *
 * `ENTRIES` above falls three quarters of a kilogram a week, which is off pace
 * against the same goal — so the two fixtures cover both verdicts without
 * either of them having to move the configured pace to get there.
 */
const ON_PACE_ENTRIES: WeighInRow[] = [
  { date: "2026-08-20", weightKg: 80.1, note: null },
  { date: "2026-08-13", weightKg: 80.6, note: null },
  { date: "2026-08-06", weightKg: 81.1, note: null },
];

const view = (entries: WeighInRow[] = ENTRIES) => (
  <WeighIns
    today={TODAY}
    entries={entries}
    startWeightKg={START_KG}
    targetWeightKg={TARGET_KG}
    goalPaceKgPerWeek={GOAL_PACE}
  />
);

/**
 * An action held open, and the handle that lets it go.
 *
 * The optimistic cases have to observe the screen while the server has not
 * answered, which means the action must not resolve yet. A promise that NEVER
 * resolves does that and then poisons the rest of the file — React runs
 * transitions one at a time, so one left pending on an unmounted tree makes
 * every later test's transition sit behind it. `training.test.tsx` and
 * `right-now.test.tsx` both carry this note; this file inherited the trap along
 * with the pattern.
 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

const weightBox = () => screen.getByLabelText("Weight");
const dateBox = () => screen.getByLabelText("Date");
const rows = () => within(screen.getByRole("list", { name: "Weigh-ins" })).getAllByRole("listitem");

beforeEach(() => {
  vi.clearAllMocks();
  saveWeighIn.mockResolvedValue({ ok: true });
  deleteWeighIn.mockResolvedValue({ ok: true });
});

describe("logging a weigh-in", () => {
  test("takes a date, a weight and an optional note", async () => {
    const user = userEvent.setup();

    render(view([]));

    await user.type(weightBox(), "77.4");
    await user.type(screen.getByLabelText("Note"), "after the walk");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    await waitFor(() =>
      expect(saveWeighIn).toHaveBeenCalledWith({
        // The form defaults to today in the USER's zone, which is a prop and
        // not the test machine's clock.
        date: TODAY,
        weight: "77.4",
        note: "after the walk",
      }),
    );
  });

  test("logs without a note", async () => {
    const user = userEvent.setup();

    render(view([]));

    await user.type(weightBox(), "77.4");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    await waitFor(() =>
      expect(saveWeighIn).toHaveBeenCalledWith({ date: TODAY, weight: "77.4", note: "" }),
    );
  });

  test("asks the phone for a decimal keypad", () => {
    // FUEL-34's criterion, and the reason the box is not `type="number"`: a
    // number input reports an EMPTY value for "77,4" on a full-stop locale, so
    // the comma below would be lost before any parser saw it.
    render(view());

    expect(weightBox().getAttribute("inputmode")).toBe("decimal");
    expect(weightBox().getAttribute("type")).not.toBe("number");
  });

  test("sends a comma-separated reading through untouched", async () => {
    // The criterion is that both are accepted. The screen's job is to carry
    // what was typed; `lib/weigh-in.test.ts` is where `77,4` becomes 77.4.
    const user = userEvent.setup();

    render(view([]));

    await user.type(weightBox(), "77,4");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    await waitFor(() =>
      expect(saveWeighIn).toHaveBeenCalledWith({ date: TODAY, weight: "77,4", note: "" }),
    );
  });

  test("shows the new weigh-in before the server answers", async () => {
    // § Feedback's 300ms budget, and the reason this is a client component.
    // `findBy` rather than `getBy`: the optimistic update lands inside a
    // transition, and `getBy` here passes on `npm run test` while flaking under
    // coverage.
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    saveWeighIn.mockReturnValue(pending.promise);

    render(view([]));

    await user.type(weightBox(), "77,4");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    // Nothing has answered, so anything on screen can only have come from the
    // optimistic layer — and it is the ROUNDED number, not the typed string.
    expect(await screen.findByRole("list", { name: "Weigh-ins" })).toBeTruthy();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("77.4 kg");

    pending.settle({ ok: true });
    await waitFor(() => expect(saveWeighIn).toHaveBeenCalledOnce());
  });

  test("refuses a weight the action would refuse, without a round trip", async () => {
    // The screen and the action share one definition of a valid weigh-in —
    // the same pure module — so a control cannot submit something the server
    // will not take.
    const user = userEvent.setup();

    render(view());

    await user.type(weightBox(), "774");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("between 20 and 400");
    expect(saveWeighIn).not.toHaveBeenCalled();
    // Named by the field it belongs to, so a screen reader hears the refusal
    // as part of the box rather than as loose text.
    expect(weightBox().getAttribute("aria-invalid")).toBe("true");
  });

  test("refuses an empty weight rather than logging nothing", async () => {
    const user = userEvent.setup();

    render(view());

    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(saveWeighIn).not.toHaveBeenCalled();
  });

  test("will not let the date be set into the future", () => {
    // The input's ceiling, which is what stops it by accident. `lib/weigh-in.ts`
    // is what stops it on purpose, since an attribute is only a suggestion to a
    // browser.
    render(view());

    expect(dateBox().getAttribute("max")).toBe(TODAY);
  });

  test("reverts and offers a retry when the server refuses", async () => {
    const user = userEvent.setup();

    saveWeighIn.mockResolvedValue({ ok: false });

    render(view([]));

    await user.type(weightBox(), "77.4");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    const alert = await screen.findByRole("alert");

    // § Tone of Voice: name what happened, never "Something went wrong".
    expect(alert.textContent).toContain("Couldn’t log that.");
    // § Feedback: "the value reverted". `findBy`, because the optimistic value
    // is discarded when the transition ends rather than when the action
    // resolves.
    expect(await screen.findByText("No weigh-ins yet. Your first entry starts the chart."))
      .toBeTruthy();

    // "Try again" re-runs what was refused, not what the boxes hold now — the
    // form has already reset itself to today with an empty weight.
    saveWeighIn.mockResolvedValue({ ok: true });
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(saveWeighIn).toHaveBeenCalledTimes(2));
    expect(saveWeighIn.mock.calls[1]?.[0]).toEqual({
      date: TODAY,
      weight: "77.4",
      note: "",
    });
  });
});

describe("editing a past entry", () => {
  test("loads a row into the one form, which is addressed by its date", async () => {
    const user = userEvent.setup();

    render(view());

    await user.click(screen.getByRole("button", { name: /80.1 kg/ }));

    expect(dateBox()).toHaveProperty("value", "2026-08-13");
    expect(weightBox()).toHaveProperty("value", "80.1");
  });

  test("says what logging will replace, before the tap rather than after", async () => {
    // § Content Guidelines: "state consequences factually and immediately,
    // including unwelcome ones".
    const user = userEvent.setup();

    render(view());

    await user.click(screen.getByRole("button", { name: /80.1 kg/ }));

    expect(await screen.findByText(/replaces 80.1 kg/)).toBeTruthy();
  });

  test("follows the date field onto whatever weigh-in that date holds", async () => {
    // The date is the address, so changing it changes which entry is being
    // edited. Without this the previous row's number would stay in the box, one
    // tap from overwriting a different day's measurement.
    const user = userEvent.setup();

    render(view());

    await user.clear(dateBox());
    await user.type(dateBox(), "2026-08-06");

    await waitFor(() => expect(weightBox()).toHaveProperty("value", "80.8"));

    await user.clear(dateBox());
    await user.type(dateBox(), "2026-08-07");

    // A date with no weigh-in empties the form rather than leaving the last
    // one's figure under a date it does not belong to.
    await waitFor(() => expect(weightBox()).toHaveProperty("value", ""));
  });

  test("writes the edit against the row's own date", async () => {
    const user = userEvent.setup();

    render(view());

    await user.click(screen.getByRole("button", { name: /80.1 kg/ }));
    await user.clear(weightBox());
    await user.type(weightBox(), "80,4");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    await waitFor(() =>
      expect(saveWeighIn).toHaveBeenCalledWith({
        date: "2026-08-13",
        weight: "80,4",
        note: "",
      }),
    );
  });

  test("replaces the row rather than adding one beside it", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    saveWeighIn.mockReturnValue(pending.promise);

    render(view());

    await user.click(screen.getByRole("button", { name: /80.1 kg/ }));
    await user.clear(weightBox());
    await user.type(weightBox(), "80.4");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    // The unique index is what makes this true in the database; this is the
    // screen agreeing with it while the request is still in flight.
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()[1]?.textContent).toContain("80.4 kg");

    pending.settle({ ok: true });
    await waitFor(() => expect(saveWeighIn).toHaveBeenCalledOnce());
  });
});

describe("deleting an entry", () => {
  test("asks first, in the Brand Guide's own words", async () => {
    const user = userEvent.setup();

    render(view());

    await user.click(
      screen.getByRole("button", { name: "Delete the weigh-in for Thu 13 Aug" }),
    );

    const sheet = await screen.findByRole("dialog");

    expect(
      within(sheet).getByText("Delete this weigh-in? This can’t be undone."),
    ).toBeTruthy();
    // Nothing is removed by opening the question.
    expect(deleteWeighIn).not.toHaveBeenCalled();
  });

  test("leaves the weigh-in alone when the answer is no", async () => {
    const user = userEvent.setup();

    render(view());

    await user.click(
      screen.getByRole("button", { name: "Delete the weigh-in for Thu 13 Aug" }),
    );
    await user.click(await screen.findByRole("button", { name: "Keep it" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteWeighIn).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
  });

  test("removes the row it was opened for, and no other", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    deleteWeighIn.mockReturnValue(pending.promise);

    render(view());

    await user.click(
      screen.getByRole("button", { name: "Delete the weigh-in for Thu 13 Aug" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((row) => row.textContent).join(" ")).not.toContain("80.1 kg");

    pending.settle({ ok: true });
    await waitFor(() => expect(deleteWeighIn).toHaveBeenCalledWith({ date: "2026-08-13" }));
  });

  test("puts the row back and names the failure when the server refuses", async () => {
    const user = userEvent.setup();

    deleteWeighIn.mockResolvedValue({ ok: false });

    render(view());

    await user.click(
      screen.getByRole("button", { name: "Delete the weigh-in for Thu 13 Aug" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t delete that.");
    expect(await screen.findByRole("button", { name: /80.1 kg/ })).toBeTruthy();
  });

  test("keeps the destructive control away from the frequently-tapped one", () => {
    // § Touch Targets: "destructive controls never sit adjacent to a
    // frequently-tapped one". The frequently-tapped control here is the primary
    // — Log weigh-in — so the assertion is that no Delete shares a parent with
    // it, and that each row's Delete is separated from the row's own edit
    // target rather than sitting inside it.
    render(view());

    const primary = screen.getByRole("button", { name: "Log weigh-in" });
    // The whole form block, not just the button's own box: adjacency is about
    // where a thumb lands, and two controls in one section are adjacent enough.
    const form = primary.closest("section") as HTMLElement;

    expect(within(form).queryAllByRole("button", { name: /^Delete/ })).toHaveLength(0);
    expect(within(form).getByRole("button", { name: "Log weigh-in" })).toBe(primary);

    for (const row of rows()) {
      const edit = within(row).getByRole("button", { name: /kg/ });
      const remove = within(row).getByRole("button", { name: /^Delete the weigh-in/ });

      // Siblings, not nested: a delete inside the edit target would be a tap on
      // one that could land on the other.
      expect(edit.contains(remove)).toBe(false);
    }
  });
});

describe("the empty state", () => {
  test("describes what will appear rather than nudging", () => {
    // § Tone of Voice, and the guide's own copy for this state. No "Let's get
    // started", no exclamation mark, no motivational subtitle.
    render(view([]));

    expect(
      screen.getByText("No weigh-ins yet. Your first entry starts the chart."),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Weigh-ins" })).toBeNull();
  });

  test("leads with the latest reading once there is one", () => {
    render(view());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("79.3 kg");
  });

  test("carries the year on a weigh-in from another one", () => {
    // The list has no window — the first weigh-in can predate the program by
    // years — so two rows could otherwise read `Thu 14 Aug` and mean different
    // Augusts.
    render(view([{ date: "2025-08-14", weightKg: 88.2, note: null }]));

    expect(screen.getByRole("button", { name: /88.2 kg/ }).textContent).toContain("2025");
  });
});

describe("progress and the trailing rate", () => {
  /**
   * The progress grid.
   *
   * By element rather than by role: `KeyValueGrid` renders a description list,
   * and a `dt` takes no accessible name — `getByRole("term", { name })` is a
   * query that can only ever return nothing. `macro-grid.test.tsx` reaches for
   * its grid the same way, and the scope is what matters here: the chart above
   * carries a data table naming the same weights, so an unscoped query would
   * find the caption's figures as readily as the grid's.
   */
  const grid = (container: HTMLElement) => within(container.querySelector("dl")!);

  test("reports kg lost, kg remaining, and the percentage of the journey", () => {
    const { container } = render(view());
    const dl = grid(container);

    // 84.2 → 79.3, against a journey of 8.2 to the target.
    expect(dl.getByText("4.9 kg")).toBeTruthy();
    expect(dl.getByText(/from 84.2 kg/)).toBeTruthy();
    expect(dl.getByText("3.3 kg")).toBeTruthy();
    expect(dl.getByText(/to 76 kg/)).toBeTruthy();
    expect(dl.getByText("60%")).toBeTruthy();
    expect(dl.getByText(/of 8.2 kg/)).toBeTruthy();
  });

  test("puts an on-pace rate in the success ink AND says so in words", () => {
    const { container } = render(view(ON_PACE_ENTRIES));
    const dl = grid(container);

    // § Color Palette gives `success` exactly one job on this screen: "goal-pace
    // rate".
    expect(dl.getByText("−0.50 kg/wk").className).toContain("text-success");

    // § Accessibility: never colour alone. The two assertions belong in one test
    // because the failure that matters is them drifting apart — a green figure
    // whose words stopped agreeing is invisible to the reader who needs the
    // words, and each half would still pass a test of its own.
    expect(dl.getByText(/on pace · goal 0.50 kg\/wk/)).toBeTruthy();
  });

  test("leaves a rate outside the band in the ordinary ink, never in red", () => {
    // `ENTRIES` falls faster than the goal, which is off pace too — the pace is
    // what separates a cut from a crash. § The Governing Principle is why it is
    // not an error colour in either direction: divergence is data, not guilt.
    const { container } = render(view());
    const dl = grid(container);

    const rate = dl.getByText("−0.75 kg/wk");

    expect(rate.className).not.toContain("text-success");
    expect(rate.className).not.toContain("text-error");

    // The goal is still named, so the comparison can be checked; the verdict
    // simply is not claimed.
    expect(dl.getByText(/goal 0.50 kg\/wk/).textContent).not.toContain("on pace");
  });

  test("has no rate to give until a second weigh-in lands", () => {
    // P5's single-data-point state, in figures rather than in geometry. One
    // reading is a distance travelled but not a speed, and § Tone of Voice asks
    // the absence to say what will fill it.
    const { container } = render(view([{ date: "2026-08-20", weightKg: 79.3, note: null }]));
    const dl = grid(container);

    expect(dl.getByText("—")).toBeTruthy();
    expect(dl.getByText(/a second weigh-in starts this/)).toBeTruthy();
    expect(dl.getByText("4.9 kg")).toBeTruthy();
  });

  test("moves the figures with the optimistic row, before the server answers", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    saveWeighIn.mockReturnValue(pending.promise);

    const { container } = render(view());

    await user.type(weightBox(), "79.1");
    await user.click(screen.getByRole("button", { name: "Log weigh-in" }));

    // The form defaults to today, which already holds a reading, so this
    // corrects it: 84.2 → 79.1 is 5.1 of the journey. § Feedback — the UI
    // reflecting the new state IS the confirmation — and figures that waited for
    // the round trip would sit beside a chart that had already moved.
    expect(await grid(container).findByText("5.1 kg")).toBeTruthy();

    pending.settle({ ok: true });
    await waitFor(() => expect(saveWeighIn).toHaveBeenCalledOnce());
  });
});
