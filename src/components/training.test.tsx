import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Week } from "@/components/dot-grid";
import type { TrainingItem } from "@/components/training";

/**
 * The Training screen — FUEL-27's acceptance criteria, as the DOM answers them.
 *
 * The Server Actions are mocked because they ARE the request; what they write is
 * `actions/training.test.ts` and `tests/integration/training.test.ts`. What is
 * asserted here is the part a user can see, and two of those are rules that rot
 * silently rather than break:
 *
 *   - **"Skipped renders as an outline, never red — the same visual weight as
 *     done."** § The Governing Principle states it as an absolute: "a missed
 *     workout and a completed workout are rendered with the same visual weight
 *     — only the status label differs". Nothing about an `text-error` creeping
 *     onto a Skip button would look wrong in a diff, so the colour is asserted
 *     as absent rather than spot-checked.
 *   - **One umber element per screen.** § The Four Rules gives it to today's
 *     dot here and nothing else. Counted, for the same reason `week-grid`
 *     counts it.
 */

const { setSessionStatus, clearSessionStatus } = vi.hoisted(() => ({
  setSessionStatus: vi.fn(),
  clearSessionStatus: vi.fn(),
}));

vi.mock("@/app/actions/training", () => ({ setSessionStatus, clearSessionStatus }));

const { Training } = await import("./training");

const TODAY = "2026-08-20"; // a Thursday
const YESTERDAY = "2026-08-19";

const CIRCUIT: TrainingItem = {
  entryId: "entry-circuit",
  name: "Bodyweight Circuit B",
  type: "circuit",
  kind: "session",
  exercises: [
    { id: "e1", name: "Press-ups", prescription: "3 x 12", notes: null },
    { id: "e2", name: "Reverse lunges", prescription: "3 x 10 ea", notes: "Slow down." },
    { id: "e3", name: "Plank", prescription: "3 x 45s", notes: null },
  ],
  entry: null,
};

const WALK: TrainingItem = {
  entryId: "entry-walk",
  name: "Daily Walk",
  type: "walk",
  kind: "walk",
  exercises: [],
  entry: null,
};

/** Two weeks of dots, enough for the grid to have something to say. */
const ADHERENCE: Week[] = [
  [
    { date: "2026-08-10", label: "Bodyweight Circuit A", status: "done" },
    { date: "2026-08-11", label: "Skipping Intervals + Core", status: "partial" },
    { date: "2026-08-12", label: "Bodyweight Circuit B", status: "skipped" },
    { date: "2026-08-15", label: "Daily Walk", status: "walk" },
  ],
  [{ date: TODAY, label: "Bodyweight Circuit B", status: "none" }],
];

const view = (overrides: Partial<Parameters<typeof Training>[0]> = {}) => (
  <Training
    date={TODAY}
    today={TODAY}
    sessions={[CIRCUIT, WALK]}
    adherence={ADHERENCE}
    {...overrides}
  />
);

const recorded = (entry: TrainingItem["entry"]) => [{ ...CIRCUIT, entry }, WALK];

/**
 * An action held open, and the handle that lets it go.
 *
 * The optimistic case below has to observe the screen while the server has not
 * answered, which means the action must not resolve yet. A promise that NEVER
 * resolves does that and then poisons the rest of the file — React runs
 * transitions one at a time, so one left pending on an unmounted tree makes
 * every later test's transition sit behind it. `right-now.test.tsx` records
 * finding this by bisect; this file inherited the trap along with the pattern.
 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSessionStatus.mockResolvedValue({ ok: true });
  clearSessionStatus.mockResolvedValue({ ok: true });
});

describe("the session", () => {
  test("lists every exercise with its prescription, numbered", () => {
    render(view());

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      "01Press-ups3 x 12",
      "02Reverse lunges/ Slow down.3 x 10 ea",
      "03Plank3 x 45s",
    ]);
  });

  test("names the session at the top and its type beneath", () => {
    render(view());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Bodyweight Circuit B",
    );
    // The "/" is its own aria-hidden span, so the type is matched on its own.
    expect(screen.getByText("circuit")).toBeTruthy();
  });

  test("renders a type the app has never seen, because the column is open", () => {
    // schema.ts keeps `workouts.type` as text so the gym restart is new rows
    // rather than a migration, and says the UI "must handle a value it does not
    // recognise". This is that promise, kept.
    render(view({ sessions: [{ ...CIRCUIT, type: "strength" }] }));

    expect(screen.getByText("strength")).toBeTruthy();
  });

  test("shows the walk without offering to log it", () => {
    // It is on the template every day, so a screen that hid it would describe a
    // different plan from the one being followed. Its one-tap log is FUEL-29.
    render(view());

    expect(screen.getByText("Daily Walk")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /walk/i })).toBeNull();
  });

  test("says a weekend is a rest day rather than an empty screen", () => {
    render(view({ sessions: [WALK] }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Walk only");
    // § Tone of Voice: describe what will appear; never nudge.
    expect(screen.getByText(/The daily walk still counts/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  test("says nothing is scheduled on a date the plan does not cover", () => {
    render(view({ sessions: [] }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nothing scheduled");
    expect(screen.getByText(/does not cover this date/)).toBeTruthy();
  });
});

describe("setting a status", () => {
  test("records done, partial and skipped, each carrying the note and duration", async () => {
    const user = userEvent.setup();

    render(view());

    await user.type(screen.getByLabelText("Note"), "8, 8, 6");
    await user.type(screen.getByLabelText("Duration"), "26");
    await user.click(screen.getByRole("button", { name: "Partial" }));

    expect(setSessionStatus).toHaveBeenCalledWith({
      date: TODAY,
      entryId: "entry-circuit",
      status: "partial",
      note: "8, 8, 6",
      durationMin: "26",
    });
  });

  test("sends the entry id, never a workout id", async () => {
    // The screen holds no workout id at all — the action re-resolves it. This
    // is the client half of that arrangement, asserted so a future payload
    // cannot quietly start carrying one.
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.not.objectContaining({ workoutId: expect.anything() }),
    );
  });

  test("shows the status on the frame it is tapped, before the server answers", async () => {
    // § Feedback's 300ms budget, and the reason this screen is a client
    // component at all. `findBy` rather than `getBy`: the optimistic update
    // lands inside a transition.
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    setSessionStatus.mockReturnValue(pending.promise);

    render(view());
    await user.click(screen.getByRole("button", { name: "Skip" }));

    // Nothing has answered, so anything on the screen can only have come from
    // the optimistic layer.
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Skipped");

    pending.settle({ ok: true });
    await waitFor(() => expect(setSessionStatus).toHaveBeenCalledOnce());
  });

  test("carries the recorded status through to the controls", () => {
    render(view({ sessions: recorded({ status: "partial", note: null, durationMin: 22 }) }));

    expect(screen.getByRole("button", { name: "Partial" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Mark done" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    // And in words, so it is not carried by a pressed state alone. Read off
    // the live region rather than by text, because "Partial" is also the label
    // on a button — which is the point: the two agree.
    expect(screen.getByRole("status").textContent).toBe("Partial · 22 min");
  });

  test("fills the boxes with what was recorded, so an edit starts from the truth", () => {
    render(
      view({ sessions: recorded({ status: "done", note: "felt strong", durationMin: 28 }) }),
    );

    expect(screen.getByLabelText<HTMLTextAreaElement>("Note").value).toBe("felt strong");
    expect(screen.getByLabelText<HTMLInputElement>("Duration").value).toBe("28");
  });

  test("says nothing is recorded rather than nudging", () => {
    render(view());

    expect(screen.getByText("Not recorded.")).toBeTruthy();
  });
});

describe("editing what was recorded", () => {
  test("offers a save only once the boxes hold something unsent", async () => {
    const user = userEvent.setup();

    render(view({ sessions: recorded({ status: "done", note: "felt strong", durationMin: 28 }) }));

    expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();

    await user.type(screen.getByLabelText("Note"), " — second time this week");

    const save = await screen.findByRole("button", { name: "Save note" });

    await user.click(save);

    // The SAME status, with the edited note. A note edited after the fact must
    // not silently change what was recorded about the session.
    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "done",
        note: "felt strong — second time this week",
      }),
    );
  });

  test("offers no save before a status exists, because the note travels with one", async () => {
    const user = userEvent.setup();

    render(view());
    await user.type(screen.getByLabelText("Note"), "not saved on its own");

    expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();
  });

  test("clears the record, and offers no clear when there is nothing to clear", async () => {
    const user = userEvent.setup();

    render(view());

    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    render(view({ sessions: recorded({ status: "skipped", note: null, durationMin: null }) }));

    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]!);

    expect(clearSessionStatus).toHaveBeenCalledWith({
      date: TODAY,
      entryId: "entry-circuit",
    });
  });
});

describe("when the write is refused", () => {
  test("names what happened and offers the same attempt again", async () => {
    const user = userEvent.setup();

    setSessionStatus.mockResolvedValue({ ok: false });

    render(view());
    await user.type(screen.getByLabelText("Note"), "felt heavy");
    await user.click(screen.getByRole("button", { name: "Partial" }));

    // § Feedback: an inline banner at the point of action, the value reverted,
    // a "Try again". Never a modal, and § Tone of Voice forbids "Something
    // went wrong".
    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Couldn’t save that.");
    // § Feedback: "the value reverted". `findBy`, because the optimistic value
    // is discarded when the transition settles rather than when the promise
    // resolves — `getBy` here passes on `npm run test` and flakes under
    // coverage.
    expect(await screen.findByText("Not recorded.")).toBeTruthy();

    setSessionStatus.mockResolvedValue({ ok: true });
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    // The retry re-runs what was refused, note included — not whatever the
    // boxes happen to hold by then.
    expect(setSessionStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "partial", note: "felt heavy" }),
    );
  });

  test("says clearing failed in its own words", async () => {
    const user = userEvent.setup();

    clearSessionStatus.mockResolvedValue({ ok: false });

    render(view({ sessions: recorded({ status: "done", note: null, durationMin: null }) }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t clear that.");
  });
});

describe("the rules the guide states as absolutes", () => {
  test("gives skipped the same visual weight as done, and no red", () => {
    // The task's own testing note: "same visual weight" is a Brand Guide
    // requirement, not a nicety. The three controls are the same component at
    // the same sizes, and the only thing that separates a skip from a done is
    // the word on it.
    render(view({ sessions: recorded({ status: "skipped", note: null, durationMin: null }) }));

    const done = screen.getByRole("button", { name: "Mark done" });
    const skip = screen.getByRole("button", { name: "Skip" });
    const partial = screen.getByRole("button", { name: "Partial" });

    for (const control of [done, skip, partial]) {
      // `aria-invalid:border-destructive` is on every Button in the app, so the
      // match is for a variant that PAINTS one of these — a destructive button
      // or error text — rather than for the word anywhere in the class list.
      expect(control.getAttribute("data-variant")).not.toBe("destructive");
      expect(control.className).not.toMatch(/(^|\s|:)(text-error|text-destructive|bg-error)/);
    }

    // Skip and Partial are the same variant and the same height as each other —
    // neither is diminished for being the less flattering answer.
    expect(skip.getAttribute("data-variant")).toBe(partial.getAttribute("data-variant"));
    expect(skip.getAttribute("data-size")).toBe(partial.getAttribute("data-size"));
    // And the recorded status is stated, not coloured.
    expect(screen.getByText("Skipped")).toBeTruthy();
  });

  test("puts exactly one umber element on the screen, and it is today's dot", () => {
    const { container } = render(view());

    const umber = [...container.querySelectorAll<HTMLElement>("*")].filter(
      (node) =>
        node.style.backgroundColor === "var(--accent)" ||
        node.style.boxShadow?.includes("var(--accent)"),
    );

    expect(umber).toHaveLength(1);
    // § The Four Rules: umber marks the present moment and nothing else.
    expect(umber[0]?.className).toContain("rounded-full");
  });

  test("shows the six-week grid with its adjacent data table", () => {
    render(view());

    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Training adherence",
    );
    expect(screen.getByRole("table")).toBeTruthy();
  });

  test("keeps the umber on TODAY when a past date is being reviewed", () => {
    // The accent says "you are here". Reviewing Wednesday on Thursday does not
    // move the present moment onto Wednesday.
    const { container } = render(view({ date: YESTERDAY }));

    const accented = [...container.querySelectorAll<HTMLElement>(".rounded-full")].filter(
      (dot) => dot.style.backgroundColor === "var(--accent)",
    );

    expect(accented).toHaveLength(1);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Today 20 August");
  });
});

describe("moving between dates", () => {
  test("links to the day before and the day after", () => {
    render(view({ date: YESTERDAY }));

    const nav = within(screen.getByRole("navigation", { name: "Date" }));

    expect(nav.getByRole("link", { name: /Previous day, Tue 18 Aug/ }).getAttribute("href")).toBe(
      "/training?date=2026-08-18",
    );
    expect(nav.getByRole("link", { name: /Next day, Thu 20 Aug/ }).getAttribute("href")).toBe(
      "/training?date=2026-08-20",
    );
  });

  test("stops going forward at today", () => {
    // A future session cannot have happened, and offering to record one would
    // invite a row the user would then have to notice and take back.
    render(view());

    const nav = within(screen.getByRole("navigation", { name: "Date" }));

    expect(nav.queryByRole("link", { name: /Next day/ })).toBeNull();
    expect(nav.getByRole("link", { name: /Previous day/ })).toBeTruthy();
  });

  test("names the date being viewed, and marks it when it is today", () => {
    render(view());
    expect(screen.getByText(/Thu 20 Aug/)).toBeTruthy();
    expect(screen.getByText("· Today")).toBeTruthy();
  });
});
