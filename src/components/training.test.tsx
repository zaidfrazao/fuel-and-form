import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Week } from "@/components/dot-grid";
import { APP_ACTION_BAR } from "@/components/action-bar";
import type { TrainingItem } from "@/components/training";
import { PAGE_ASIDE_COLUMN, PAGE_MEASURE_COLUMN, PAGE_MEASURE_FOOT } from "@/lib/frame";

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

const { setSessionStatus, clearSessionStatus, logWalk, clearWalk } = vi.hoisted(() => ({
  setSessionStatus: vi.fn(),
  clearSessionStatus: vi.fn(),
  logWalk: vi.fn(),
  clearWalk: vi.fn(),
}));

vi.mock("@/app/actions/training", () => ({ setSessionStatus, clearSessionStatus }));
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

  test("keeps a pasted non-number out of the duration, and out of the state", async () => {
    // `inputMode` asks for a numeric keypad; it does not stop a paste. `NaN` is
    // uniquely bad here — it renders as "NaN min", and because `NaN !== NaN` it
    // would leave the dirty check true forever, offering "Save note" after
    // every failed save with nothing on screen to explain it.
    const user = userEvent.setup();

    render(view());

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
    render(view());

    // The primary is a direct child of the bar — `Training` renders it and the
    // Partial/Skip row inside the one sticky container, with no wrapper between.
    const bar = screen.getByRole("button", { name: "Mark done" }).parentElement;

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
