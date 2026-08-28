import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { WeighInRow } from "@/components/weigh-ins";
import { RECENT_WEIGH_INS } from "@/lib/weigh-in";
import type { Reading } from "@/lib/weight-chart";

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

const { saveWeighIn, deleteWeighIn, earlierWeighIns, weighInOn } = vi.hoisted(() => ({
  saveWeighIn: vi.fn(),
  deleteWeighIn: vi.fn(),
  earlierWeighIns: vi.fn(),
  weighInOn: vi.fn(),
}));

vi.mock("@/app/actions/weight", () => ({
  saveWeighIn,
  deleteWeighIn,
  earlierWeighIns,
  weighInOn,
}));

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

/**
 * Fourteen consecutive days, newest first — a history longer than the window.
 *
 * Written out rather than generated from `addDays`, so the dates a test asserts
 * on are dates this file states rather than dates a shared helper computed. The
 * notes are what FUEL-84's one data-loss path turns on, so the older half
 * carries them.
 */
const LONG_HISTORY: WeighInRow[] = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-08-${String(20 - index).padStart(2, "0")}`,
  weightKg: Math.round((80 - index / 10) * 10) / 10,
  note: index >= RECENT_WEIGH_INS ? `logged on day ${index}` : null,
}));

/** The window, as `weight/page.tsx` narrows it. */
const WINDOW = LONG_HISTORY.slice(0, RECENT_WEIGH_INS);

/** The oldest weigh-in there is — outside the window by ten places. */
const OLDEST = LONG_HISTORY[LONG_HISTORY.length - 1]!;

/**
 * The screen as the page renders it.
 *
 * `readings` defaults to the rows themselves, which is what a history shorter
 * than `RECENT_WEIGH_INS` looks like: everything listed, nothing earlier. The
 * two are passed apart only where FUEL-84's window is the thing under test.
 */
const view = (entries: WeighInRow[] = ENTRIES, readings: Reading[] = entries) => (
  <WeighIns
    today={TODAY}
    entries={entries}
    readings={readings}
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
  earlierWeighIns.mockResolvedValue({ ok: true, entries: LONG_HISTORY.slice(RECENT_WEIGH_INS) });
  weighInOn.mockResolvedValue({ ok: true, entry: OLDEST });
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

/**
 * FUEL-84 — the history is a window, and the rest is a step away.
 *
 * The screen used to render every weigh-in it had: 58 on the demo account,
 * 4333px, six and a half screens of phone, and no ceiling on any of it. What is
 * asserted here is the bound and everything the bound could have broken —
 * because most of that would break QUIETLY. A note fetched into the wrong
 * date, an earlier entry that comes back after being deleted, and a marker that
 * stops following the form are all screens that look right.
 */
describe("the bounded history", () => {
  test("lists the window it was given and not the history behind it", () => {
    render(view(WINDOW, LONG_HISTORY));

    expect(rows()).toHaveLength(RECENT_WEIGH_INS);
    expect(screen.queryByRole("button", { name: new RegExp(OLDEST.weightKg.toString()) })).toBe(
      null,
    );
  });

  test("says how many weigh-ins are not listed", () => {
    render(view(WINDOW, LONG_HISTORY));

    expect(screen.getByText(`/ ${LONG_HISTORY.length - RECENT_WEIGH_INS} earlier weigh-ins`)).
      toBeTruthy();
  });

  test("counts one earlier weigh-in in the singular", () => {
    render(view(WINDOW, LONG_HISTORY.slice(0, RECENT_WEIGH_INS + 1)));

    expect(screen.getByText("/ 1 earlier weigh-in")).toBeTruthy();
  });

  test("offers nothing to expand when the whole history is listed", () => {
    // A history shorter than the window renders exactly what it rendered before
    // this ticket: the rows, and nothing underneath them.
    render(view());

    expect(rows()).toHaveLength(ENTRIES.length);
    expect(screen.queryByRole("button", { name: "Show earlier" })).toBe(null);
    expect(screen.queryByText(/earlier weigh-in/)).toBe(null);
  });

  test("leads with the latest weigh-in and lists it first", () => {
    // The criterion says the latest entry is always shown. It is structural
    // here rather than incidental: the readings are newest first and whole, and
    // the window is a prefix of them.
    render(view(WINDOW, LONG_HISTORY));

    // Read off the fixture rather than written out, so the assertion says "the
    // newest reading" rather than a figure that happens to be it.
    const newest = `${LONG_HISTORY[0]!.weightKg} kg`;

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(newest);
    expect(rows()[0]?.textContent).toContain(newest);
  });

  test("marks the entry the form addresses, not the latest one", async () => {
    // FUEL-84 and FUEL-78 both read `aria-current` as "the latest entry". It is
    // not: it follows the form, and it lands on the latest only because the
    // form opens on today.
    const user = userEvent.setup();

    render(view(WINDOW, LONG_HISTORY));

    const [first, second] = rows();

    expect(within(first!).getByRole("button", { name: /kg/ }).getAttribute("aria-current")).toBe(
      "true",
    );

    await user.click(within(second!).getByRole("button", { name: /kg/ }));

    expect(within(first!).getByRole("button", { name: /kg/ }).getAttribute("aria-current")).toBe(
      null,
    );
    expect(within(second!).getByRole("button", { name: /kg/ }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  test("shows the earlier entries when asked, and stops offering once they are all listed", async () => {
    const user = userEvent.setup();

    render(view(WINDOW, LONG_HISTORY));

    await user.click(screen.getByRole("button", { name: "Show earlier" }));

    await waitFor(() => expect(rows()).toHaveLength(LONG_HISTORY.length));

    // Keyset, not an offset: the page is asked for by the oldest date on screen.
    expect(earlierWeighIns).toHaveBeenCalledWith({ before: WINDOW[WINDOW.length - 1]?.date });
    expect(screen.queryByRole("button", { name: "Show earlier" })).toBe(null);
  });

  test("an entry that was paged in can still be edited", async () => {
    // The criterion's other half: reachable is not enough, it has to be
    // editable — and the note has to come with it, or the edit replaces one.
    const user = userEvent.setup();

    render(view(WINDOW, LONG_HISTORY));

    await user.click(screen.getByRole("button", { name: "Show earlier" }));

    const row = await screen.findByRole("button", { name: new RegExp(`${OLDEST.weightKg} kg`) });

    await user.click(row);

    expect(dateBox()).toHaveProperty("value", OLDEST.date);
    expect(weightBox()).toHaveProperty("value", String(OLDEST.weightKg));
    expect(screen.getByLabelText("Note")).toHaveProperty("value", OLDEST.note);
  });

  test("says so when a page does not come back, and offers the tap again", async () => {
    const user = userEvent.setup();

    earlierWeighIns.mockResolvedValue({ ok: false });

    render(view(WINDOW, LONG_HISTORY));

    await user.click(screen.getByRole("button", { name: "Show earlier" }));

    const alert = await screen.findByRole("alert");

    // § Tone of Voice: name what happened.
    expect(alert.textContent).toContain("Couldn’t load earlier weigh-ins.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(rows()).toHaveLength(RECENT_WEIGH_INS);
  });

  test("does not put a deleted earlier entry back when the write settles", async () => {
    /*
     * The failure this guards is invisible in a diff. `refresh()` re-renders the
     * server's window and the paged-in rows are client state it cannot reach, so
     * without `reconcile` the optimistic delete reverts into a row that is
     * already gone from the database.
     */
    const user = userEvent.setup();

    render(view(WINDOW, LONG_HISTORY));

    await user.click(screen.getByRole("button", { name: "Show earlier" }));
    await screen.findByRole("button", { name: new RegExp(`${OLDEST.weightKg} kg`) });

    await user.click(
      // 2026-08-07, ten places outside the window and a Friday.
      screen.getByRole("button", { name: "Delete the weigh-in for Fri 7 Aug" }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteWeighIn).toHaveBeenCalledWith({ date: OLDEST.date }));
    await waitFor(() => expect(rows()).toHaveLength(LONG_HISTORY.length - 1));

    expect(
      screen.queryByRole("button", { name: new RegExp(`${OLDEST.weightKg} kg`) }),
    ).toBe(null);
  });
});

/**
 * The one data-loss path a bounded list could open.
 *
 * The date field addresses a weigh-in by its date, and that date can now name
 * an entry the list has not loaded. The reading is on the screen either way —
 * the chart holds every one — but the NOTE is not, and `recordWeighIn` writes
 * the note on every save. An empty box over a real note loses it with nothing
 * having said so.
 */
describe("addressing a weigh-in the list has not loaded", () => {
  test("shows the reading, and fetches the note behind it", async () => {
    const user = userEvent.setup();

    render(view(WINDOW, LONG_HISTORY));

    await user.clear(dateBox());
    await user.type(dateBox(), OLDEST.date);

    // The weight comes off the readings, which are whole — so the "replaces"
    // line is right before the fetch has answered.
    await waitFor(() => expect(weightBox()).toHaveProperty("value", String(OLDEST.weightKg)));
    expect(await screen.findByText(new RegExp(`replaces ${OLDEST.weightKg} kg`))).toBeTruthy();

    await waitFor(() => expect(weighInOn).toHaveBeenCalledWith({ date: OLDEST.date }));
    await waitFor(() => expect(screen.getByLabelText("Note")).toHaveProperty("value", OLDEST.note));
  });

  test("warns rather than silently replacing when the note cannot be loaded", async () => {
    const user = userEvent.setup();

    weighInOn.mockResolvedValue({ ok: false });

    render(view(WINDOW, LONG_HISTORY));

    await user.clear(dateBox());
    await user.type(dateBox(), OLDEST.date);

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Couldn’t load this entry’s note.");
    // A warning, not a block: replacing the entry may well be the intention.
    const log = screen.getByRole("button", { name: "Log weigh-in" }) as HTMLButtonElement;

    expect(log.disabled).toBe(false);
  });

  test("leaves the note alone for a date with no weigh-in at all", async () => {
    const user = userEvent.setup();

    render(view(WINDOW, LONG_HISTORY));

    await user.clear(dateBox());
    await user.type(dateBox(), "2026-07-04");

    await waitFor(() => expect(weightBox()).toHaveProperty("value", ""));
    expect(screen.getByLabelText("Note")).toHaveProperty("value", "");
    expect(weighInOn).not.toHaveBeenCalled();
  });

  test("does not drop a fetched note into a date the form has since left", async () => {
    /*
     * The reason `addressed` is a ref rather than the `date` state: the closure
     * that started this fetch holds the date the reader has already left, and a
     * note landing under someone else's weight is a note the next save writes
     * there.
     */
    const user = userEvent.setup();
    const held = deferred<{ ok: true; entry: WeighInRow }>();

    weighInOn.mockReturnValue(held.promise);

    render(view(WINDOW, LONG_HISTORY));

    await user.clear(dateBox());
    await user.type(dateBox(), OLDEST.date);

    await waitFor(() => expect(weighInOn).toHaveBeenCalledWith({ date: OLDEST.date }));

    await user.clear(dateBox());
    await user.type(dateBox(), TODAY);

    held.settle({ ok: true, entry: OLDEST });

    await waitFor(() => expect(dateBox()).toHaveProperty("value", TODAY));
    expect(screen.getByLabelText("Note")).toHaveProperty("value", "");
  });
});
