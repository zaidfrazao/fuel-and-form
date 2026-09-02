import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Week } from "@/components/dot-grid";
import { APP_ACTION_BAR, SESSION_ACTION_BAR } from "@/components/action-bar";
import type { TrainingItem } from "@/components/training";
import { PAGE_ASIDE_COLUMN, PAGE_MEASURE_COLUMN, PAGE_MEASURE_FOOT } from "@/lib/frame";
import { WORKING_SECTION } from "@/lib/section";

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

const {
  setSessionStatus,
  clearSessionStatus,
  logExerciseSet,
  removeExerciseSet,
  logWalk,
  clearWalk,
} = vi.hoisted(() => ({
  setSessionStatus: vi.fn(),
  clearSessionStatus: vi.fn(),
  logExerciseSet: vi.fn(),
  removeExerciseSet: vi.fn(),
  logWalk: vi.fn(),
  clearWalk: vi.fn(),
}));

vi.mock("@/app/actions/training", () => ({
  setSessionStatus,
  clearSessionStatus,
  logExerciseSet,
  removeExerciseSet,
}));
vi.mock("@/app/actions/log-walk", () => ({ logWalk, clearWalk }));

const { Training } = await import("./training");

const TODAY = "2026-08-20"; // a Thursday
const YESTERDAY = "2026-08-19";

const CIRCUIT: TrainingItem = {
  entryId: "entry-circuit",
  name: "Bodyweight Circuit B",
  type: "circuit",
  kind: "session",
  exercises: [
    {
      id: "e1",
      name: "Press-ups",
      prescription: "3 x 12",
      section: WORKING_SECTION,
      notes: null,
      targetSets: 3,
      targetRepsLow: 12,
      targetRepsHigh: 12,
    },
    {
      id: "e2",
      name: "Reverse lunges",
      prescription: "3 x 10 ea",
      section: WORKING_SECTION,
      notes: "Slow down.",
      targetSets: 2,
      targetRepsLow: 8,
      targetRepsHigh: 10,
    },
    // Sets and no rep target — a hold. The third state a set row has to draw,
    // and the one a regex over "3 x 45s" would get wrong.
    {
      id: "e3",
      name: "Plank",
      prescription: "3 x 45s",
      section: WORKING_SECTION,
      notes: null,
      targetSets: 3,
      targetRepsLow: null,
      targetRepsHigh: null,
    },
  ],
  entry: null,
  sets: [],
};

const WALK: TrainingItem = {
  entryId: "entry-walk",
  name: "Daily Walk",
  type: "walk",
  kind: "walk",
  exercises: [],
  entry: null,
  sets: [],
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
    bodyweightKg={75}
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
  logExerciseSet.mockResolvedValue({ ok: true });
  removeExerciseSet.mockResolvedValue({ ok: true });
  // Every test starts outside the session state. `localStorage` is shared
  // across tests in one jsdom environment, so a test that enters it would
  // otherwise leave the next one in a composition it never asked for.
  window.localStorage.clear();
  logWalk.mockResolvedValue({ ok: true });
  clearWalk.mockResolvedValue({ ok: true });
});

describe("the session", () => {
  test("lists every exercise with its prescription, numbered", () => {
    render(view());

    // The exercise list, named by the heading above it. The walk's row is a
    // list of its own on this page now (FUEL-29), which is why this is scoped.
    const list = screen.getByRole("heading", { name: "Exercises" }).nextElementSibling!;
    const rows = within(list as HTMLElement).getAllByRole("listitem");

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

  test("shows the walk, and offers its one tap — FUEL-29", () => {
    // It is on the template every day, so a screen that hid it would describe a
    // different plan from the one being followed.
    render(view());

    expect(screen.getByText("Daily Walk")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log walk" })).toBeTruthy();
  });

  test("logs the walk against the DATE being viewed, not today", async () => {
    // The reason the walk's action is addressed by date at all: a walk missed
    // on Wednesday is recorded on Wednesday, from the screen showing Wednesday.
    const user = userEvent.setup();

    render(view({ date: YESTERDAY }));

    await user.click(screen.getByRole("button", { name: "Log walk" }));

    await waitFor(() =>
      expect(logWalk).toHaveBeenCalledWith({
        date: YESTERDAY,
        entryId: "entry-walk",
        durationMin: null,
      }),
    );
    // The session's action is a different action against a different row.
    expect(setSessionStatus).not.toHaveBeenCalled();
  });

  test("offers the walk on a rest day, where there is no bar at all", async () => {
    const user = userEvent.setup();

    render(view({ sessions: [WALK] }));

    await user.click(screen.getByRole("button", { name: "Log walk" }));

    await waitFor(() => expect(logWalk).toHaveBeenCalled());
  });

  test("shows what is recorded against the walk, with its duration", () => {
    render(
      view({
        sessions: [CIRCUIT, { ...WALK, entry: { status: "done", note: null, durationMin: 45 } }],
      }),
    );

    const walkRow = screen.getByText("Daily Walk").closest("li")!;

    expect(within(walkRow).getByRole("status").textContent).toContain("Done");
    expect(within(walkRow).getByRole("status").textContent).toContain("45 min");
    // Server state, not an optimistic one — nothing was tapped, so `getBy` is
    // the right query here and no wait is being skipped.
    expect(within(walkRow).getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  test("takes the walk back without touching the session's record", async () => {
    const user = userEvent.setup();

    render(
      view({
        sessions: [
          { ...CIRCUIT, entry: { status: "done", note: null, durationMin: 28 } },
          { ...WALK, entry: { status: "done", note: null, durationMin: null } },
        ],
      }),
    );

    const walkRow = screen.getByText("Daily Walk").closest("li")!;

    await user.click(within(walkRow).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(clearWalk).toHaveBeenCalledWith({ date: TODAY, entryId: "entry-walk" }),
    );
    expect(clearSessionStatus).not.toHaveBeenCalled();
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

    // A past date, where the plan state's primary is Mark done — § Desktop
    // gives Start session to today, which is where the session state is
    // reachable. What crosses the wire is the same either way.
    render(view({ date: YESTERDAY }));
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
    render(
      view({
        date: YESTERDAY,
        sessions: recorded({ status: "partial", note: null, durationMin: 22 }),
      }),
    );

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

  test("keeps a pasted non-number out of the duration, and out of the state", async () => {
    // `inputMode` asks for a numeric keypad; it does not stop a paste. `NaN` is
    // uniquely bad here — it renders as "NaN min", and because `NaN !== NaN` it
    // would leave the dirty check true forever, offering "Save note" after
    // every failed save with nothing on screen to explain it.
    const user = userEvent.setup();

    render(view({ date: YESTERDAY }));

    const duration = screen.getByLabelText<HTMLInputElement>("Duration");

    await user.type(duration, "2a8e");

    expect(duration.value).toBe("28");

    await user.click(screen.getByRole("button", { name: "Mark done" }));

    // What reaches the action is the stripped value, so nothing downstream
    // ever sees the `NaN` this test is about. The optimistic render of a
    // duration is covered by the deferred case above; here the mocked action
    // resolves at once and the fixture's own `entry` is still null, so the
    // status correctly reverts to "Not recorded."
    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ durationMin: "28" }),
    );
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

describe("the energy estimate", () => {
  /**
   * § P10's figure, FUEL-95 — and the one criterion the screen owns rather than
   * `lib/energy.ts`: that it is drawn as an estimate, and that it is drawn
   * nowhere near a macro total.
   */

  test("says what the session is estimated to have cost, once a duration exists", () => {
    render(view({ sessions: recorded({ status: "done", note: null, durationMin: 30 }) }));

    // Three working rows and a 30-minute session, at the harness's fixture
    // weight. The figure itself is `energy.test.ts`'s to pin; what matters here
    // is that it reaches the screen and reaches it labelled.
    expect(screen.getByText(/^Estimated /).textContent).toMatch(
      /^Estimated \d+–\d+ kcal$/,
    );
  });

  test("renders nothing at all when the method has nothing to say", () => {
    // No duration and no sets: no evidence of how long anything took. § Tone of
    // Voice refuses to describe an absence as a failure, so there is no line,
    // no placeholder and no "unavailable".
    render(view());

    expect(screen.queryByText(/Estimated/)).toBeNull();
  });

  test("renders nothing for a workout type it has no value for", () => {
    render(
      view({
        sessions: [
          { ...CIRCUIT, type: "strength", entry: { status: "done", note: null, durationMin: 30 } },
          WALK,
        ],
      }),
    );

    // Not a zero. `workouts.type` is open text and the gym restart is new rows,
    // so an unrecognised type is the ordinary case rather than the broken one.
    expect(screen.queryByText(/Estimated/)).toBeNull();
    expect(screen.queryByText(/0 kcal/)).toBeNull();
  });

  test("follows the record as it is set, without a reload", () => {
    // The reason the figure is computed in the component at all: this screen
    // revalidates nothing, so a server-resolved range would stay frozen at
    // whatever the page loaded with. Rendering the two states is the same
    // observation a re-render after a save would make.
    const { unmount } = render(view());

    expect(screen.queryByText(/Estimated/)).toBeNull();
    unmount();

    render(view({ sessions: recorded({ status: "done", note: null, durationMin: 30 }) }));

    expect(screen.getByText(/^Estimated /).textContent).toMatch(/kcal$/);
  });

  test("is not drawn as a measured figure, and carries no target", () => {
    render(view({ sessions: recorded({ status: "partial", note: null, durationMin: 30 }) }));

    const line = screen.getByText(/^Estimated /);

    // A slash line in `text-slash`, which is § Content Guidelines' device for a
    // secondary fact — not the Display type § Data Display reserves for "the one
    // number a screen is about".
    expect(line.parentElement?.className).toContain("text-slash");

    // And the criterion PRD § P10 states in bold: never combined with a target.
    // A screen that had subtracted this from an allowance would have to print
    // one somewhere.
    expect(screen.queryByText(/target/i)).toBeNull();
    expect(screen.queryByText(/remaining/i)).toBeNull();
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

describe("the action bar", () => {
  test("is the shared bar, not a string of its own", () => {
    // FUEL-83. This screen is where the hard edge was measured — at 375×667 the
    // bar's top landed through the x-height of the first exercise's
    // prescription — but the fix belongs to all three bars at once, so what is
    // asserted here is that this one still takes the shared string rather than
    // a copy of it. `action-bar.test.tsx` owns what the string does.
    render(view({ date: YESTERDAY }));

    // Located by the fade class rather than by walking up from the primary.
    // FUEL-86 put a controls row between the two — the bar is a column holding
    // a banner and a row of controls now — and a test that counts `parentElement`
    // hops is asserting the nesting rather than the string it says it is about.
    const bar = screen.getByRole("button", { name: "Mark done" }).closest(".action-bar-fade");

    // The shared string plus where the bar stands in the page's own grid —
    // FUEL-77, and `/`'s bar carries exactly the same pair. Identity still, so
    // this screen cannot quietly add or drop anything else.
    expect(bar?.className).toBe(`${APP_ACTION_BAR} ${PAGE_MEASURE_FOOT}`);
  });
});

describe("the rules the guide states as absolutes", () => {
  test("gives skipped the same visual weight as done, and no red", () => {
    // The task's own testing note: "same visual weight" is a Brand Guide
    // requirement, not a nicety. The three controls are the same component at
    // the same sizes, and the only thing that separates a skip from a done is
    // the word on it.
    render(
      view({
        date: YESTERDAY,
        sessions: recorded({ status: "skipped", note: null, durationMin: null }),
      }),
    );

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
    // And the recorded status is stated, not coloured. Scoped to the live
    // region `Recorded` renders, because FUEL-30's list below now says the same
    // word about the same session — in the same ink, which is the point.
    expect(within(screen.getByRole("status")).getByText("Skipped")).toBeTruthy();
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

    // Scoped to the nav: FUEL-30's list names today as well, and marks it
    // "Viewing" rather than "Today" — the nav says where the present is, and
    // the list says which row you are on.
    const nav = within(screen.getByRole("navigation", { name: "Date" }));

    expect(nav.getByText(/Thu 20 Aug/)).toBeTruthy();
    expect(nav.getByText("· Today")).toBeTruthy();
  });
});

/**
 * FUEL-30 — "past sessions are viewable and editable by date", and the two
 * things the screen owes that criterion.
 *
 * The date already had an address before this task: `/training?date=` and the
 * prev/next nav above are FUEL-27's, and `actions/training.test.ts` covers what
 * a write to a past date does. What was missing was a way IN that is not typing
 * a URL or walking back one day at a time — and, on the editing half, an
 * assertion that a correction to a past session is filed against the date being
 * viewed rather than against today.
 */
describe("reaching a past date", () => {
  test("sends every dot to the day under it", () => {
    const { container } = render(view());

    // Pointer-only, so `getAllByRole` cannot see them: they are inside the
    // graphic's `role="img"` and out of the tab order. `dot-grid.test.tsx`
    // holds the reasoning; what matters here is that the screen supplies the
    // destination at all.
    const dots = [...container.querySelectorAll("[role='img'] a")].map((link) =>
      link.getAttribute("href"),
    );

    expect(dots).toContain("/training?date=2026-08-12");
    expect(dots).toHaveLength(5);
  });

  test("lists the recent sessions as rows a thumb can hit", () => {
    render(view());

    const list = within(screen.getByRole("list", { name: "Recent sessions" }));

    // Newest first, the walk-only Saturday absent — the list is the way to a
    // session, and a weekend has none to edit. Today is present but inert.
    expect(
      screen.getAllByRole("link", { name: /Aug/ }).map((row) => row.getAttribute("href")),
    ).toEqual(
      expect.arrayContaining([
        "/training?date=2026-08-12",
        "/training?date=2026-08-11",
        "/training?date=2026-08-10",
      ]),
    );
    expect(list.queryByRole("link", { name: /15 Aug/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Thu 20 Aug/ })).toBeNull();
  });

  test("does not offer a date that has not happened", () => {
    // The list stops at today for the same reason Next does. `recentSessions`
    // enforces it; this is the screen agreeing.
    render(view({ date: YESTERDAY }));

    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);

    expect(rows.some((row) => row?.includes("Thu 20 Aug"))).toBe(true);
    expect(rows.some((row) => row?.includes("Fri 21 Aug"))).toBe(false);
  });

  test("files a retrospective correction against the date being viewed", async () => {
    const user = userEvent.setup();

    render(
      view({
        date: YESTERDAY,
        sessions: recorded({ status: "done", note: null, durationMin: null }),
      }),
    );

    // The boxes start from what was recorded, so an edit begins from the truth
    // rather than from an empty screen — then the correction goes to the date
    // on screen, not to the day it is being made on.
    await user.type(screen.getByLabelText("Note"), "Felt heavier than it looked.");
    await user.type(screen.getByLabelText("Duration"), "38");
    await user.click(screen.getByRole("button", { name: "Partial" }));

    await waitFor(() =>
      expect(setSessionStatus).toHaveBeenCalledWith({
        date: YESTERDAY,
        entryId: "entry-circuit",
        status: "partial",
        note: "Felt heavier than it looked.",
        durationMin: "38",
      }),
    );
  });

  test("takes a past record back from the date it was made against", async () => {
    const user = userEvent.setup();

    render(
      view({
        date: YESTERDAY,
        sessions: recorded({ status: "skipped", note: "Sore.", durationMin: null }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(clearSessionStatus).toHaveBeenCalledWith({
        date: YESTERDAY,
        entryId: "entry-circuit",
      }),
    );
  });
});

describe("the second column", () => {
  /*
   * § Desktop's composition for `/training` — FUEL-77.
   *
   * The rendered geometry is `tests/visual/page-columns.spec.ts`'s; jsdom loads
   * no stylesheet, so what is asserted here is the grouping and the reading
   * order, which is the half a refactor breaks without anything going red.
   */

  /** The sections a column holds, by heading, in DOM order. */
  const sectionsIn = (column: "measure" | "aside") =>
    [
      ...document
        .querySelector<HTMLElement>(`[data-column="${column}"]`)!
        .querySelectorAll("h1, h2"),
    ].map((node) => node.textContent);

  test("the measure keeps the session and its exercise list", () => {
    render(view());

    // § Desktop, and the note travels with them: the bar acts on this session,
    // and what it records is the status and the note beside it.
    expect(sectionsIn("measure")).toEqual([
      "Training",
      "Bodyweight Circuit B",
      "Exercises",
      "This session",
    ]);
  });

  test("the aside takes the pattern rather than the day", () => {
    render(view());

    // "Both of which are below the fold at every width today — on the one
    // screen whose argument is the pattern rather than the day." Anytime joins
    // them because it is the same row `/` renders, in the column `/` puts it in.
    expect(sectionsIn("aside")).toEqual(["Adherence", "Recent", "Anytime"]);
  });

  test("the division needed no section moved", () => {
    /*
     * The evidence that this composition is § Desktop's rather than the
     * ticket's: the sections were already in the order the two columns want, so
     * the groups could be wrapped around them without a resequence. This
     * asserts the sequence a screen reader walks, which is unchanged from
     * before FUEL-77 and identical at every width.
     */
    render(view());

    expect([...document.querySelectorAll("h1, h2")].map((n) => n.textContent)).toEqual([
      "Training",
      "Bodyweight Circuit B",
      "Exercises",
      "This session",
      "Adherence",
      "Recent",
      "Anytime",
    ]);
  });

  test("the dot grid and the recent list keep what makes them reachable", () => {
    /*
     * FUEL-77's fifth criterion, and the reason it is a criterion: both of these
     * were moved wholesale into another column, and the two things that make
     * them usable are exactly the two a reflow drops without a word.
     */
    render(view());

    const aside = document.querySelector<HTMLElement>('[data-column="aside"]')!;

    // The grid's accessible summary — the whole of what a screen reader gets
    // from a signature graphic under § Rule 4.
    expect(within(aside).getByRole("img").getAttribute("aria-label")).toMatch(/week/i);

    // And the row that says which date is being viewed — named, so this cannot
    // pass on the dot grid's own `aria-current` while the list has lost its.
    const recent = within(aside).getByRole("list", { name: /recent/i });

    expect(recent.querySelector("[aria-current]")).not.toBeNull();
  });

  test("the groups are the frame's, not this screen's", () => {
    render(view());

    // `xl:gap-7` is this screen's own rhythm — 28px, what the wrapper has always
    // used — resolved through `cn` so the two gap utilities cannot both stand
    // and let source order decide which wins.
    for (const [column, base] of [
      ["measure", PAGE_MEASURE_COLUMN],
      ["aside", PAGE_ASIDE_COLUMN],
    ] as const) {
      const className = document.querySelector(`[data-column="${column}"]`)!.className;

      expect(className).toContain("contents");
      expect(className).toContain("xl:gap-7");
      expect(className).not.toContain("xl:gap-[30px]");

      // `Boolean(u)` as well as the gap filter: an empty utility survives the
      // second test and makes `toContain` vacuous.
      for (const utility of base.split(" ").filter((u) => u && !u.includes("gap"))) {
        expect(className).toContain(utility);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-91 — the session state, and the sets it exists to hold                */
/* -------------------------------------------------------------------------- */

/** A set as the screen is given one. */
const set = (exerciseId: string, setIndex: number, reps = 12) => ({
  exerciseId,
  setIndex,
  reps,
});

/** The session with sets already against it. */
const withSets = (sets: ReturnType<typeof set>[]) => [{ ...CIRCUIT, sets }, WALK];

/** In the session state on the first render, the way a reload arrives in it. */
const resumed = () => window.localStorage.setItem(`fuel:training-session:${TODAY}`, "1");

describe("entering and leaving the session state", () => {
  test("offers Start session on today, and Mark done on any other date", () => {
    // Brand Guide § Desktop's state table. "The primary changes because the
    // screen's question does" — before you train that is starting, while you
    // are training it is finishing — and a past date is a record, so Start
    // session is not offered where it would mean nothing.
    const { unmount } = render(view());

    expect(screen.getByRole("button", { name: "Start session" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();

    unmount();
    render(view({ date: YESTERDAY }));

    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("swaps the whole list for the exercise being worked", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));

    // § P3's re-aimed criterion: "the active exercise is what is visible when
    // you are working". The subject is the exercise; the session's name moves
    // to the eyebrow above it.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
    // By role: the session's name is also a row in Recent, which is the aside
    // doing its own job and not this assertion's subject.
    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B" }),
    ).toBeTruthy();
    expect(screen.getByText(/3 x 12 · Exercise 1 of 3/)).toBeTruthy();

    // The plan state's list is gone rather than merely scrolled past.
    expect(screen.queryByRole("heading", { name: "Exercises" })).toBeNull();
  });

  test("resumes where the data says it is after a reload", () => {
    // § Desktop: "a phone locked mid-session and woken twenty minutes later
    // resumes where the data says it is, with nothing to go stale". The only
    // thing stored is the boolean; which exercise is showing is derived.
    resumed();

    render(view({ sessions: withSets([set("e1", 1), set("e1", 2), set("e1", 3)]) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Reverse lunges");
  });

  test("is not reachable for a past date even when one was left entered", () => {
    // The key is the date's, so yesterday's boolean cannot open today's state —
    // but the guard is the composition's rather than the key's, and this is the
    // assertion that says so.
    window.localStorage.setItem(`fuel:training-session:${YESTERDAY}`, "1");

    render(view({ date: YESTERDAY }));

    expect(screen.getByRole("heading", { name: "Exercises" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sets" })).toBeNull();
  });

  test("is not offered on a date with no session to work through", () => {
    render(view({ sessions: [WALK] }));

    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("records the session and leaves when the primary is tapped", async () => {
    // PRD § P10: "entered and left by the primary". Mark done is the session
    // state's primary; it writes the status and returns to the plan state.
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));
    await user.click(screen.getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", entryId: "entry-circuit" }),
    );
    expect(await screen.findByRole("heading", { name: "Exercises" })).toBeTruthy();
  });

  test("leaves on Partial and on Skip too", async () => {
    // A session marked partial is a session that has stopped. Leaving the
    // reader inside a surface for operating one they have just said is over
    // would be a state whose only way out is the buttons they already pressed.
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));
    await user.click(screen.getByRole("button", { name: "Partial" }));

    expect(await screen.findByRole("heading", { name: "Exercises" })).toBeTruthy();
  });

  test("keeps the bar pinned at every width, unlike every other bar", () => {
    // § Desktop's one named exception to FUEL-72's release, and the reason it
    // is not `APP_ACTION_BAR`: a rest timer rides in this slot (FUEL-93) and a
    // live readout that scrolls out of sight has failed at its only job at 1920
    // exactly as at 375. Identity, so the string cannot quietly gain `lg:static`.
    resumed();
    render(view());

    const bar = screen.getByRole("button", { name: "Mark done" }).closest(".action-bar-fade");

    expect(bar?.className).toBe(`${SESSION_ACTION_BAR} ${PAGE_MEASURE_FOOT}`);
    expect(bar?.className).not.toContain("lg:static");
  });

  test("does not offer Clear from inside a session", () => {
    // The mock draws three controls and no fourth. Clear takes the whole record
    // away and its cascade takes the sets with it — a control with no use
    // mid-session and every reason not to be reached by accident.
    resumed();
    render(view({ sessions: [{ ...CIRCUIT, entry: { status: "partial", note: null, durationMin: null } }, WALK] }));

    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

describe("the sets sub-list", () => {
  test("draws a row per set the target asks for, before anything is logged", () => {
    resumed();
    render(view());

    // '3 x 12' — three rows, each offering the target rather than a blank.
    expect(screen.getByLabelText("Set 1 reps")).toBeTruthy();
    expect(screen.getByLabelText("Set 3 reps")).toBeTruthy();
    expect(screen.queryByLabelText("Set 4 reps")).toBeNull();
    expect(screen.getAllByText("Target 12")).toHaveLength(3);
  });

  test("shows a logged set as its own number, and offers the next", () => {
    resumed();
    render(view({ sessions: withSets([set("e1", 1, 12), set("e1", 2, 9)]) }));

    expect(screen.getByLabelText<HTMLInputElement>("Set 1 reps").value).toBe("12");
    expect(screen.getByLabelText<HTMLInputElement>("Set 2 reps").value).toBe("9");
    expect(screen.getByLabelText<HTMLInputElement>("Set 3 reps").value).toBe("");
    // The mock's two states: `8 reps` for a set performed, `Target 8` for one
    // still on offer.
    expect(screen.getAllByText("reps")).toHaveLength(2);
    expect(screen.getByText("Target 12")).toBeTruthy();
  });

  test("logs the target's reps when the tick is tapped with an empty box", async () => {
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(logExerciseSet).toHaveBeenCalledWith({
      date: TODAY,
      entryId: "entry-circuit",
      exerciseId: "e1",
      setIndex: 1,
      reps: 12,
    });
  });

  test("logs what was typed rather than what was asked for", async () => {
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.type(screen.getByLabelText("Set 1 reps"), "9");
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(logExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ setIndex: 1, reps: 9 }),
    );
  });

  test("shows the set on the frame it is ticked, before the server answers", async () => {
    // § Feedback's 300ms. `findBy` and a held promise: `getBy` passes on
    // `npm run test` and flakes under coverage, and a mock that resolves at
    // once kills the optimistic value before the assertion sees it.
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    logExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(view());
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(await screen.findByRole("button", { name: "Remove set 1" })).toBeTruthy();

    pending.settle({ ok: true });
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
  });

  test("takes a set back when its tick is tapped again", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(screen.getByRole("button", { name: "Remove set 1" }));

    expect(removeExerciseSet).toHaveBeenCalledWith({
      date: TODAY,
      entryId: "entry-circuit",
      exerciseId: "e1",
      setIndex: 1,
    });
  });

  test("corrects a logged set when its number is edited", async () => {
    // The acceptance criterion's "correctable". `logSet` collides on the unique
    // index rather than inserting beside it, so this is one row twice.
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: withSets([set("e1", 1, 12)]) }));

    const input = screen.getByLabelText("Set 1 reps");

    await user.clear(input);
    await user.type(input, "8");
    await user.tab();

    expect(logExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ setIndex: 1, reps: 8 }),
    );
  });

  test("does not record a set nobody confirmed", async () => {
    // A number typed into an unlogged row and then abandoned is not a set. If
    // blur committed here, tapping anywhere on the screen after typing would
    // log one.
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.type(screen.getByLabelText("Set 1 reps"), "9");
    await user.tab();

    expect(logExerciseSet).not.toHaveBeenCalled();
  });

  test("moves to the next exercise when an exercise's sets are complete", async () => {
    // The current exercise is DERIVED, so it advances on the frame the last set
    // lands rather than on the render after the server agrees.
    const user = userEvent.setup();
    // Held open on purpose. The props are fixed in a test, so a mock that
    // resolves at once ends the transition and takes the optimistic set back
    // with it — the screen would return to Press-ups before the assertion ran.
    const pending = deferred<{ ok: boolean }>();

    logExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(view({ sessions: withSets([set("e1", 1), set("e1", 2)]) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");

    await user.click(screen.getByRole("button", { name: "Log set 3" }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveProperty(
      "textContent",
      "Reverse lunges",
    );

    pending.settle({ ok: true });
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
  });

  test("holds on the last exercise once everything is logged", () => {
    resumed();
    render(
      view({
        sessions: withSets([
          set("e1", 1),
          set("e1", 2),
          set("e1", 3),
          set("e2", 1),
          set("e2", 2),
          set("e3", 1),
          set("e3", 2),
          set("e3", 3),
        ]),
      }),
    );

    // Not an empty screen: the reader is still standing in the gym, and the
    // primary they came for is in the bar below.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plank");
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
  });

  test("offers an exercise with no rep target a row and no target to meet", () => {
    // '3 x 45s' is three sets of a hold. A regex over that string would offer
    // "Target 3–45"; the seed says sets and nothing else, and this is what the
    // screen does with that.
    resumed();
    render(
      view({
        sessions: withSets([
          set("e1", 1),
          set("e1", 2),
          set("e1", 3),
          set("e2", 1),
          set("e2", 2),
        ]),
      }),
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plank");
    expect(screen.queryByText(/^Target/)).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Set 1 reps").placeholder).toBe("");
    // Nothing to tick at until a number is typed — the alternative is a control
    // that reports a refusal for a value the reader never entered.
    expect(screen.getByRole("button", { name: "Log set 1" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  test("logs against an exercise with no target once a number is typed", async () => {
    const user = userEvent.setup();

    resumed();
    render(
      view({
        sessions: withSets([
          set("e1", 1),
          set("e1", 2),
          set("e1", 3),
          set("e2", 1),
          set("e2", 2),
        ]),
      }),
    );

    await user.type(screen.getByLabelText("Set 1 reps"), "20");
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(logExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: "e3", setIndex: 1, reps: 20 }),
    );
  });

  test("reverts the set and names what failed when the server refuses", async () => {
    const user = userEvent.setup();

    logExerciseSet.mockResolvedValue({ ok: false });

    resumed();
    render(view());
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    // § Tone of Voice: name what happened, and name it apart from the session's
    // own record — this is a set the reader just performed.
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Couldn’t save that set."),
    );
    // § Feedback's "the value reverted". `findBy`, for the reason the status's
    // own refusal test gives one line up: the optimistic value is discarded
    // when the transition SETTLES rather than when the promise resolves, so a
    // `getBy` here is a race the banner has already won.
    expect(await screen.findByRole("button", { name: "Log set 1" })).toBeTruthy();

    // "Try again" re-runs the same thing that failed.
    logExerciseSet.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(logExerciseSet).toHaveBeenCalledTimes(2);
    expect(logExerciseSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ setIndex: 1, reps: 12 }),
    );
  });

  test("never touches the session's status", async () => {
    // PRD § P10, and the criterion this whole feature is measured against: the
    // status is not derived from set data. A set is a set.
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
    expect(setSessionStatus).not.toHaveBeenCalled();
    expect(clearSessionStatus).not.toHaveBeenCalled();
  });
});

describe("what the plan state says about sets", () => {
  test("puts set progress on the exercise's own row and adds no rows", () => {
    // § Desktop's table: "Slash metadata on the exercise's own row — `/ 3 of 3
    // sets`. No rows added." That is what keeps § Lists' window spendable.
    render(view({ sessions: withSets([set("e1", 1), set("e1", 2)]) }));

    // The exercise list itself, found through a row of it — the screen holds
    // three lists and the other two are the aside's.
    const list = screen.getByText("Press-ups").closest("ol")!;

    expect(screen.getByText("2 of 3 sets")).toBeTruthy();
    // Three exercises, three rows. The progress is metadata on a row rather
    // than a row of its own.
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  test("says nothing at all about an exercise with no sets", () => {
    // A row that announced "0 of 3 sets" would be reporting an absence on every
    // date nobody trained — and would move every one of this screen's baselines.
    render(view());

    expect(screen.queryByText(/of 3 sets/)).toBeNull();
  });

  test("still counts a session's sets after leaving the state", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(screen.getByRole("button", { name: "Mark done" }));

    // The plan state is the list, and the list still says what was performed.
    // Leaving the session state is a change of composition, not of record.
    expect(await screen.findByText("1 of 3 sets")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-92 — the sections of a session                                        */
/* -------------------------------------------------------------------------- */

/**
 * The circuit as the seed now writes one: a warm-up, the work, a cool-down.
 *
 * Built from `CIRCUIT` rather than beside it, so the working rows and their
 * targets are the same three every test above uses and the only difference is
 * the two rows wrapped around them.
 */
const SECTIONED: TrainingItem = {
  ...CIRCUIT,
  exercises: [
    {
      id: "u1",
      name: "Joint prep",
      prescription: "~2 min",
      notes: null,
      section: "warmup",
      targetSets: null,
      targetRepsLow: null,
      targetRepsHigh: null,
    },
    ...CIRCUIT.exercises,
    {
      id: "c1",
      name: "Lower-body stretches",
      prescription: "30 sec each",
      notes: null,
      section: "cooldown",
      targetSets: null,
      targetRepsLow: null,
      targetRepsHigh: null,
    },
  ],
};

const sectioned = (sets: ReturnType<typeof set>[] = []) => [
  { ...SECTIONED, sets },
  WALK,
];

describe("the plan state, when a session has sections", () => {
  test("heads each section in § Lists' group register", () => {
    render(view({ sessions: sectioned() }));

    // The device `/shopping` has drawn over its aisles since it shipped, which
    // § Lists names as the group heading's second case. A screen showing a
    // session "may not draw its own", so this screen draws that one.
    for (const label of ["Warm-up", "Work", "Cool-down"]) {
      expect(screen.getByRole("heading", { level: 2, name: label })).toBeTruthy();
    }
  });

  test("still lists every row of the session, bookends included", () => {
    render(view({ sessions: sectioned() }));

    expect(screen.getByText("Joint prep")).toBeTruthy();
    expect(screen.getByText("Lower-body stretches")).toBeTruthy();
    expect(screen.getByText("Press-ups")).toBeTruthy();
  });

  test("reports set progress on working rows and says nothing about a warm-up", () => {
    render(view({ sessions: sectioned([set("e1", 1), set("e1", 2)]) }));

    expect(screen.getByText("2 of 3 sets")).toBeTruthy();
    // The warm-up logs no sets, so it has nothing to report — and a row that
    // said "0 of" anything would be reporting an absence about a row that was
    // never going to have a figure.
    const warmUp = screen.getByText("Joint prep").closest("li")!;

    expect(warmUp.textContent).toBe("01Joint prep~2 min");
  });
});

describe("a session with rows but no work", () => {
  /**
   * A mobility day: warm-up rows and nothing else.
   *
   * Not reachable from the seed — all three seeded sessions have working rows —
   * and there is no exercise editor to build one yet. It is pinned anyway
   * because FUEL-92 is what made it possible: until sections existed, "has
   * exercise rows" and "has rows the session state steps through" were the same
   * set, and `canEnter` was written against the first.
   */
  const mobilityOnly = () => [
    {
      ...CIRCUIT,
      exercises: [
        {
          id: "u1",
          name: "Joint prep",
          prescription: "~2 min",
          notes: null,
          section: "warmup",
          targetSets: null,
          targetRepsLow: null,
          targetRepsHigh: null,
        },
      ],
      sets: [],
    },
    WALK,
  ];

  test("is not offered a session to start, because there is none to work", () => {
    // The invariant the composition depends on: `canEnter` implies the session
    // state has an exercise to show. Offering it here would enter a state whose
    // subject is `undefined` — session chrome around the plan list, with no way
    // back but recording a status.
    render(view({ sessions: mobilityOnly() }));

    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("still records a status, because the session still happened", () => {
    // Refusing the session STATE is not refusing the session. The three
    // outcomes stay exactly where they were.
    render(view({ sessions: mobilityOnly() }));

    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Partial" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  test("still draws the rows it does have", () => {
    // The list is the screen's subject in the plan state, and a warm-up row is
    // an exercise. One section, so no heading — the flat list, as always.
    render(view({ sessions: mobilityOnly() }));

    expect(screen.getByText("Joint prep")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Warm-up" })).toBeNull();
  });
});

describe("the session state, when a session has sections", () => {
  test("opens on the first WORKING exercise, not on the warm-up", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(screen.getByRole("button", { name: "Start session" }));

    // The whole point of the column. A mobility drill offered per-set rep entry
    // is the fault § P10 describes, and the state stepping through it first is
    // how that fault would reach a phone.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
  });

  test("counts the working rows in the position, not the whole session", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(screen.getByRole("button", { name: "Start session" }));

    // Three working rows out of five. "Exercise 1 of 5" would be a session
    // reporting itself as longer than the work it is asking for, and the count
    // would never reach its own last exercise.
    expect(screen.getByText(/3 x 12 · Exercise 1 of 3/)).toBeTruthy();
  });

  test("names the part being worked in the eyebrow", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(screen.getByRole("button", { name: "Start session" }));

    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B · Work" }),
    ).toBeTruthy();
  });

  test("leaves the eyebrow alone when the session has no sections", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));

    // A session whose rows are all one section has no divisions to name, so
    // there is no distinction for "· Work" to draw. Every session stored before
    // FUEL-92 is this one.
    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B" }),
    ).toBeTruthy();
  });

  test("marks the worked exercise in the aside, not the row at that index", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(screen.getByRole("button", { name: "Start session" }));

    // The aside holds the WHOLE session — § Desktop's "the rest of the list" —
    // while the measure steps through the working rows only. So the current
    // marker cannot be an index: index 0 of this list is the warm-up, and the
    // measure is showing the first working exercise.
    //
    // Invisible to both suites without this test: jsdom has no width and the
    // column is `hidden` below the cap, and the screen baselines photograph the
    // plan state rather than this one.
    const marked = document.querySelectorAll('[aria-current="step"]');

    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("Press-ups");
    expect(marked[0]!.textContent).not.toContain("Joint prep");
  });

  test("marks nothing in the aside when there is no exercise to work", () => {
    // `currentId` is undefined rather than an index that would still match a
    // row. Belt and braces with `canEnter`, which now refuses this session
    // outright — but the component must not depend on that to behave.
    render(view({ sessions: sectioned() }));

    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });

  test("never lands on the cool-down, even with every working set logged", async () => {
    const user = userEvent.setup();

    // Every set of all three working exercises. `currentExercise` holds the last
    // one when a session is complete rather than emptying the screen — and the
    // last one is the last WORKING one, not the stretch after it.
    render(
      view({
        sessions: sectioned([
          set("e1", 1), set("e1", 2), set("e1", 3),
          set("e2", 1), set("e2", 2),
          set("e3", 1), set("e3", 2), set("e3", 3),
        ]),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plank");
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-93 — the rest timer's row of the bar                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where the timer renders, and where it does not.
 *
 * `rest-timer.test.tsx` proves what the timer does; this proves that the screen
 * puts it in the one place FUEL-90 ruled for it — a row of the SESSION bar, in
 * the slot § Feedback gives the failure banner, and nowhere in the plan state.
 */
describe("the rest timer", () => {
  test("is not offered in the plan state", () => {
    render(view());

    // A list you read before and after. A rest is taken BETWEEN exercises, so
    // its control belongs to the surface you operate during.
    expect(screen.queryByRole("button", { name: "1:30" })).toBeNull();
  });

  test("is a row of the session bar, above the controls", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));

    const timer = screen.getByRole("button", { name: "1:30" });
    const primary = screen.getByRole("button", { name: "Mark done" });

    expect(timer).toBeTruthy();

    /*
     * § Desktop, FUEL-90: "the timer is a row of the action bar, above the
     * controls". Asserted as document order rather than by reading a class,
     * because the order is what the rule is about — a readout below the
     * primary would be a readout under the reader's thumb.
     */
    expect(timer.compareDocumentPosition(primary)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test("keeps the session's own record out of the timer's business", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));
    await user.click(screen.getByRole("button", { name: "1:30" }));

    // "Zero database writes and zero Server Actions." Starting a rest is a
    // number in `localStorage` and nothing else — the actions this screen has
    // are for the session, and none of them hears about a rest.
    expect(setSessionStatus).not.toHaveBeenCalled();
    expect(logExerciseSet).not.toHaveBeenCalled();
    expect(screen.getByRole("timer").textContent).toBe("1:30");
  });

  test("leaves with the session state", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(screen.getByRole("button", { name: "Start session" }));
    await user.click(screen.getByRole("button", { name: "1:30" }));
    await user.click(screen.getByRole("button", { name: "Mark done" }));

    // The bar goes back to the plan state's, and the timer's row goes with it.
    // The rest itself is not cancelled — nothing here writes to its key — but
    // there is no longer a surface it belongs to.
    expect(screen.queryByRole("timer")).toBeNull();
  });
});
