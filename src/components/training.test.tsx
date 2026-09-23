import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Week } from "@/components/dot-grid";
import {
  ACTION_BAR_AT,
  APP_ACTION_BAR,
  SESSION_ACTION_BAR,
  TRAINING_BAR_AT,
} from "@/components/action-bar";
import type { TrainingItem } from "@/components/training";
import type { ResolvedFormMedia } from "@/lib/form-media";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_MEASURE_COLUMN,
  PAGE_MEASURE_FOOT,
  PAGE_SESSION_FOOT,
} from "@/lib/frame";
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
  saveWalkRecording,
} = vi.hoisted(() => ({
  setSessionStatus: vi.fn(),
  clearSessionStatus: vi.fn(),
  logExerciseSet: vi.fn(),
  removeExerciseSet: vi.fn(),
  logWalk: vi.fn(),
  clearWalk: vi.fn(),
  saveWalkRecording: vi.fn(),
}));

vi.mock("@/app/actions/training", () => ({
  setSessionStatus,
  clearSessionStatus,
  logExerciseSet,
  removeExerciseSet,
}));
vi.mock("@/app/actions/log-walk", () => ({ logWalk, clearWalk, saveWalkRecording }));
vi.mock("@/app/actions/walk-route", () => ({
  openWalkRoute: vi.fn(),
  nameRoute: vi.fn(),
}));

const { Training } = await import("./training");

/**
 * One copy of the plan state's action bar, or the session state's only bar —
 * FUEL-118.
 *
 * The plan state renders the bar twice, as `/` does (FUEL-114). Below 1024 it
 * is sticky and last. From 1024 it sits in the measure under `This session`.
 * CSS draws one copy, but jsdom has no stylesheet, so both are in the tree
 * here and an unscoped `getByRole("button", { name: "Mark done" })` finds two.
 *
 * `"phone"` is the default because it is the copy these tests were written
 * against, and both copies are the same children with the same props. The
 * session state draws one bar with no attribute, so the default falls back to
 * the whole screen, and so does a query that expects no bar at all. A named
 * copy that is missing throws rather than being answered by the other copy.
 * That is the rule `right-now.test.tsx`'s `bar()` settled in FUEL-114.
 *
 * Resolved at each call, because a tap can swap states, and with them which
 * copies exist.
 */
const bar = (which?: "phone" | "desktop") => copy("bar", which);

/**
 * One copy of the plan state's exercise list — FUEL-118, `LIST_AT`. The same
 * rules as `bar()`: the phone's copy by default, the whole screen when no copy
 * is rendered (the session state, a walks-only day), and a throw when a named
 * copy is missing.
 */
const list = (which?: "phone" | "desktop") => copy("list", which);

function copy(of: "bar" | "list", which?: "phone" | "desktop") {
  const scoped = document.querySelector<HTMLElement>(`[data-${of}="${which ?? "phone"}"]`);

  if (scoped) return within(scoped);
  if (which) throw new Error(`no ${which} copy of the ${of} is rendered`);

  return within(document.body);
}

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
      targetSecondsLow: null,
      targetSecondsHigh: null,
      media: null,
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
      targetSecondsLow: null,
      targetSecondsHigh: null,
      media: null,
    },
    // Sets and no target of either unit. The third state a set row has to
    // draw, and the one a regex over "3 x 45s" would get wrong. It is what the
    // seed's planks were before FUEL-123 gave them seconds; the timed hold has
    // its own fixture, `TIMED_HOLD`, below.
    {
      id: "e3",
      name: "Plank",
      prescription: "3 x 45s",
      section: WORKING_SECTION,
      notes: null,
      targetSets: 3,
      targetRepsLow: null,
      targetRepsHigh: null,
      targetSecondsLow: null,
      targetSecondsHigh: null,
      media: null,
    },
  ],
  entry: null,
  sets: [],
  lastTime: [],
};

const WALK: TrainingItem = {
  entryId: "entry-walk",
  name: "Morning Walk",
  type: "walk",
  kind: "walk",
  exercises: [],
  entry: null,
  sets: [],
  lastTime: [],
};

/**
 * The day's second walk — FUEL-98.
 *
 * Most of this file runs with ONE walk on the day, and deliberately: a template
 * with a single walk is what every account looked like before this ticket and
 * what one still looks like after someone edits theirs, so the single-walk
 * screen has to go on working. The pair gets its own block below.
 */
const AFTERNOON_WALK: TrainingItem = {
  entryId: "entry-walk-2",
  name: "Afternoon Walk",
  type: "walk",
  kind: "walk",
  exercises: [],
  entry: null,
  sets: [],
  lastTime: [],
};

/** Two weeks of dots, enough for the grid to have something to say. */
const ADHERENCE: Week[] = [
  [
    { date: "2026-08-10", label: "Bodyweight Circuit A", status: "done" },
    { date: "2026-08-11", label: "Skipping Intervals + Core", status: "partial" },
    { date: "2026-08-12", label: "Bodyweight Circuit B", status: "skipped" },
    { date: "2026-08-15", label: "Morning Walk · Afternoon Walk", status: "walk" },
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
    const exercises = list().getByRole("heading", { name: "Exercises" }).nextElementSibling!;
    const rows = within(exercises as HTMLElement).getAllByRole("listitem");

    expect(rows).toHaveLength(3);
    // Each working row is the door to its sets since FUEL-127, and says so
    // before its contents — an `sr-only` prefix, announced and not drawn.
    expect(rows.map((row) => row.textContent)).toEqual([
      "Show sets for 01Press-ups3 x 12",
      "Show sets for 02Reverse lunges/ Slow down.3 x 10 ea",
      "Show sets for 03Plank3 x 45s",
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

  test("keeps a dash in either Title's name with the words before it — FUEL-117", async () => {
    // Both of this screen's Titles carry a name from the library, the session's
    // in the plan state and the exercise's in the session state. Headings
    // balance, and balancing would otherwise be free to open line 2 with the
    // dash; `title-wrap.spec.ts` measures the break, this holds the text.
    const user = userEvent.setup();
    const [first, ...rest] = CIRCUIT.exercises;
    const dashed = {
      ...CIRCUIT,
      name: "Circuit B — Lower",
      exercises: [{ ...first!, name: "Squats — paused" }, ...rest],
    };

    render(view({ sessions: [dashed] }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Circuit B\u00A0— Lower");

    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Squats\u00A0— paused");
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

    expect(screen.getByText("Morning Walk")).toBeTruthy();
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

  test("draws a row for EVERY walk on the day, not just the first — FUEL-98", () => {
    // The defect this ticket is against, at the screen. A `find` here rendered
    // one row for the pair: the afternoon walk was unloggable from `/training`
    // at all, and the row that WAS drawn was the morning one — on a screen
    // somebody opened in the evening to record the afternoon.
    render(view({ sessions: [CIRCUIT, WALK, AFTERNOON_WALK] }));

    expect(screen.getByText("Morning Walk")).toBeTruthy();
    expect(screen.getByText("Afternoon Walk")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Log walk" })).toHaveLength(2);
  });

  test("states the recording caveat once for the pair, not once a row — FUEL-112", () => {
    // jsdom has no `geolocation`, so a browser that can record is stubbed in;
    // without it no row offers Record and there is no caveat to count.
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        geolocation: { watchPosition: vi.fn(), clearWatch: vi.fn() },
      }),
    );

    try {
      render(view({ sessions: [CIRCUIT, WALK, AFTERNOON_WALK] }));

      expect(screen.getAllByRole("button", { name: "Record" })).toHaveLength(2);
      expect(screen.getAllByText("/ Screen on, app open · uses battery")).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("logs each walk against its own entry, in one tap each", async () => {
    // "Loggable in one tap" is the criterion, and two walks must not become a
    // picker followed by a tap. Each row is addressed by its own entry, which
    // is what makes them two independent controls rather than one with a
    // choice in front of it.
    const user = userEvent.setup();

    render(view({ sessions: [CIRCUIT, WALK, AFTERNOON_WALK] }));

    const afternoon = screen.getByText("Afternoon Walk").closest("li")!;

    await user.click(within(afternoon).getByRole("button", { name: "Log walk" }));

    await waitFor(() =>
      expect(logWalk).toHaveBeenCalledWith({
        date: TODAY,
        entryId: "entry-walk-2",
        durationMin: null,
      }),
    );
    // Never the morning walk's entry. That mistake is the ticket's own defect
    // in its UI form — one tap standing in for the other.
    expect(logWalk).toHaveBeenCalledTimes(1);
  });

  test("reverts each walk from its own row", async () => {
    // § Feedback's "revertible from where it was performed", per walk. A single
    // Undo for the pair would take back whichever the screen happened to draw
    // first, which is the same silent substitution the database was making.
    const user = userEvent.setup();

    render(
      view({
        sessions: [
          CIRCUIT,
          { ...WALK, entry: { status: "done", note: null, durationMin: 20 }, figures: { durationMin: 20, distanceM: null, steps: null, stepsSource: null, hasRoute: false } },
          { ...AFTERNOON_WALK, entry: { status: "done", note: null, durationMin: 15 }, figures: { durationMin: 15, distanceM: null, steps: null, stepsSource: null, hasRoute: false } },
        ],
      }),
    );

    const morning = screen.getByText("Morning Walk").closest("li")!;
    const afternoon = screen.getByText("Afternoon Walk").closest("li")!;

    // Each row shows its OWN duration. One shared answer would put the morning
    // walk's minutes under the afternoon walk's name. Read off the Slash line
    // since FUEL-102 — `Done` is the status and the figures are beneath it.
    // Scoped to the figures LINE by its selector: the presets are buttons
    // reading the same minutes, and an unscoped match finds both.
    expect(within(morning).getByText(/20 min/, { selector: "p" })).toBeDefined();
    expect(within(afternoon).getByText(/15 min/, { selector: "p" })).toBeDefined();

    await user.click(within(afternoon).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(clearWalk).toHaveBeenCalledWith({ date: TODAY, entryId: "entry-walk-2" }),
    );
  });

  test("offers both walks on a rest day, which is when they are all there is", async () => {
    const user = userEvent.setup();

    render(view({ sessions: [WALK, AFTERNOON_WALK] }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Walks only");
    expect(screen.getAllByRole("button", { name: "Log walk" })).toHaveLength(2);

    await user.click(
      within(screen.getByText("Afternoon Walk").closest("li")!).getByRole("button", {
        name: "Log walk",
      }),
    );

    await waitFor(() => expect(logWalk).toHaveBeenCalled());
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
        sessions: [CIRCUIT, { ...WALK, entry: { status: "done", note: null, durationMin: 45 }, figures: { durationMin: 45, distanceM: null, steps: null, stepsSource: null, hasRoute: false } }],
      }),
    );

    const walkRow = screen.getByText("Morning Walk").closest("li")!;

    // FUEL-102 split these. `Done` is the STATUS and carries no figure; the
    // minutes moved to the Slash line beneath, which § The Route Trace makes
    // the affordance that opens the walk's sheet. Printing the duration in both
    // would print it twice, a line apart.
    expect(within(walkRow).getByRole("status").textContent).toBe("Done");
    expect(within(walkRow).getByText(/45 min/, { selector: "p" })).toBeDefined();
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
          { ...WALK, entry: { status: "done", note: null, durationMin: null }, figures: { durationMin: null, distanceM: null, steps: null, stepsSource: null, hasRoute: false } },
        ],
      }),
    );

    const walkRow = screen.getByText("Morning Walk").closest("li")!;

    await user.click(within(walkRow).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(clearWalk).toHaveBeenCalledWith({ date: TODAY, entryId: "entry-walk" }),
    );
    expect(clearSessionStatus).not.toHaveBeenCalled();
  });

  test("says a weekend is a rest day rather than an empty screen", () => {
    render(view({ sessions: [WALK] }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Walks only");
    // § Tone of Voice: describe what will appear; never nudge.
    expect(screen.getByText(/The daily walks still count/)).toBeTruthy();
    expect(bar().queryByRole("button", { name: "Mark done" })).toBeNull();
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
    await user.click(bar().getByRole("button", { name: "Partial" }));

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
    await user.click(bar().getByRole("button", { name: "Mark done" }));

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
    await user.click(bar().getByRole("button", { name: "Skip" }));

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

    expect(bar().getByRole("button", { name: "Partial" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(bar().getByRole("button", { name: "Mark done" }).getAttribute("aria-pressed")).toBe(
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

    await user.click(bar().getByRole("button", { name: "Mark done" }));

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

    expect(bar().queryByRole("button", { name: "Save note" })).toBeNull();

    await user.type(screen.getByLabelText("Note"), " — second time this week");

    const save = await bar().findByRole("button", { name: "Save note" });

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

    expect(bar().queryByRole("button", { name: "Save note" })).toBeNull();
  });

  test("clears the record, and offers no clear when there is nothing to clear", async () => {
    const user = userEvent.setup();

    render(view());

    expect(bar().queryByRole("button", { name: "Clear" })).toBeNull();

    // The first render is still mounted, so the bar is found inside the second.
    const { container } = render(
      view({ sessions: recorded({ status: "skipped", note: null, durationMin: null }) }),
    );

    await user.click(
      within(container.querySelector<HTMLElement>('[data-bar="phone"]')!).getByRole("button", {
        name: "Clear",
      }),
    );

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
    await user.click(bar().getByRole("button", { name: "Partial" }));

    // § Feedback: an inline banner at the point of action, the value reverted,
    // a "Try again". Never a modal, and § Tone of Voice forbids "Something
    // went wrong".
    const alert = await bar().findByRole("alert");

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
    await user.click(bar().getByRole("button", { name: "Clear" }));

    expect((await bar().findByRole("alert")).textContent).toContain("Couldn’t clear that.");
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
    //
    // Two copies since FUEL-118, and each is exactly its `TRAINING_BAR_AT`
    // string, so this screen cannot quietly add or drop anything on either.
    // Neither takes `PAGE_MEASURE_FOOT`: the phone's is not drawn at the cap,
    // and the desktop's is a flex item of the measure's own column.
    for (const which of ["phone", "desktop"] as const) {
      const copy = bar(which)
        .getByRole("button", { name: "Mark done" })
        .closest(".action-bar-fade");

      expect(copy?.className).toBe(TRAINING_BAR_AT[which]);
    }

    // And both are the shared string: the desktop copy is the released bar,
    // and the phone's is the sticky one `/` shows below 1024.
    expect(TRAINING_BAR_AT.desktop.startsWith(`${APP_ACTION_BAR} `)).toBe(true);
    expect(TRAINING_BAR_AT.phone).toBe(ACTION_BAR_AT.phone);
  });

  test("draws the plan state's two copies with the same controls — FUEL-118", () => {
    // The copies are one function's output with the same props, which is the
    // whole of why two of them are safe. Asserted on a recorded past date, where
    // the bar is at its fullest: three answers, then Save note and Clear.
    render(
      view({
        date: YESTERDAY,
        sessions: recorded({ status: "partial", note: "cut it short", durationMin: 18 }),
      }),
    );

    const controls = (which: "phone" | "desktop") =>
      bar(which)
        .getAllByRole("button")
        .map((button) => [button.textContent, button.getAttribute("aria-pressed")]);

    expect(controls("desktop")).toEqual(controls("phone"));
    expect(controls("phone").map(([name]) => name)).toEqual([
      "Mark done",
      "Partial",
      "Skip",
      "Clear",
    ]);
  });

  test.each([
    ["the plan state, today", "Start session", "Skip", () => render(view())],
    [
      "the plan state, another date",
      "Mark done",
      "Skip",
      () => render(view({ date: YESTERDAY })),
    ],
    [
      "the session state",
      "Mark done",
      // FUEL-121: the session state names what its Skip acts on.
      "Skip session",
      () => {
        resumed();
        return render(view());
      },
    ],
  ])("takes `/`'s one row in %s — FUEL-109", (_state, primary, skip, draw) => {
    // § Buttons: "`/training`'s bar takes the same row, in both of its states."
    // Decided rather than inherited from a shared string: the primary leads and
    // takes the spare width, Partial and Skip take their own, in that order.
    draw();

    const lead = bar().getByRole("button", { name: primary });
    const row = lead.closest(".action-bar-fade > div")!;
    const inRow = [...row.querySelectorAll("button")];

    expect(inRow.map((button) => button.textContent)).toEqual([primary, "Partial", skip]);
    expect(lead.className).toContain("flex-1");
    for (const secondary of inRow.slice(1)) {
      expect(secondary.className).toContain("flex-none");
      expect(secondary.className).not.toContain("flex-1");
    }
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

    const done = bar().getByRole("button", { name: "Mark done" });
    const skip = bar().getByRole("button", { name: "Skip" });
    const partial = bar().getByRole("button", { name: "Partial" });

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
    await user.click(bar().getByRole("button", { name: "Partial" }));

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

    await user.click(bar().getByRole("button", { name: "Clear" }));

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

  /**
   * Whether a node is in the copy a width draws, or in no copy at all —
   * FUEL-118. The plan state renders its list and its bar once per position,
   * and jsdom has no stylesheet to hide the other, so each width's reading
   * order is read through its own copies.
   */
  const drawnAt = (node: Element, at: "phone" | "desktop") => {
    const copy = node.closest("[data-list], [data-bar]");

    return !copy || [copy.getAttribute("data-list"), copy.getAttribute("data-bar")].includes(at);
  };

  /** The sections a column holds, by heading, in DOM order, as a width reads them. */
  const sectionsIn = (column: "measure" | "aside", at: "phone" | "desktop" = "phone") =>
    [
      ...document
        .querySelector<HTMLElement>(`[data-column="${column}"]`)!
        .querySelectorAll("h1, h2"),
    ]
      .filter((node) => drawnAt(node, at))
      .map((node) => node.textContent);

  /** The whole screen's headings and its bar, in DOM order, as a width reads them. */
  const readingOrder = (at: "phone" | "desktop") =>
    [...document.querySelectorAll("h1, h2, .action-bar-fade")]
      .filter((node) => drawnAt(node, at))
      .map((node) => (node.matches(".action-bar-fade") ? "[bar]" : node.textContent));

  test("the measure keeps the session, its record and its exercise list", () => {
    render(view());

    // § Desktop, and the note travels with them: the bar acts on this session,
    // and what it records is the status and the note beside it.
    expect(sectionsIn("measure")).toEqual([
      "Training",
      "Bodyweight Circuit B",
      "Exercises",
      "This session",
    ]);

    // From 1024 the record comes before the list, because the bar that submits
    // it sits between them — § The two states of `/training`, FUEL-118.
    expect(sectionsIn("measure", "desktop")).toEqual([
      "Training",
      "Bodyweight Circuit B",
      "This session",
      "Exercises",
    ]);
  });

  test("the aside takes the pattern rather than the day", () => {
    render(view());

    // "Both of which are below the fold at every width today — on the one
    // screen whose argument is the pattern rather than the day." Anytime joins
    // them because it is the same row `/` renders, in the column `/` puts it in.
    expect(sectionsIn("aside")).toEqual(["Adherence", "Recent", "Anytime"]);
    expect(sectionsIn("aside", "desktop")).toEqual(["Adherence", "Recent", "Anytime"]);
  });

  test("the phone reads the order it always has, and 1024 up reads subject, actions, list", () => {
    /*
     * FUEL-77 wrapped the column groups around sections that were already in
     * the order both columns wanted, so the phone's sequence is the one it had
     * before any of this, and it still is.
     *
     * FUEL-118 gives the width from 1024 its own sequence: the session, its
     * record, the bar that submits the record, then the 877px list, then the
     * context. Read off the document rather than off boxes, because the
     * document is what a screen reader walks. It is the same order the boxes
     * are drawn in, and `page-columns.spec.ts` measures those in a browser.
     */
    render(view());

    expect(readingOrder("phone")).toEqual([
      "Training",
      "Bodyweight Circuit B",
      "Exercises",
      "This session",
      "Adherence",
      "Recent",
      "Anytime",
      "[bar]",
    ]);
    expect(readingOrder("desktop")).toEqual([
      "Training",
      "Bodyweight Circuit B",
      "This session",
      "[bar]",
      "Exercises",
      "Adherence",
      "Recent",
      "Anytime",
    ]);
  });

  test("the two lists are one list — FUEL-118", () => {
    // Same function, same props: the rows, their order, their progress and
    // which of them open the form sheet cannot differ between the copies.
    render(view({ sessions: withSets([set("e1", 1), set("e1", 2)]) }));

    const rows = (which: "phone" | "desktop") =>
      list(which)
        .getAllByRole("listitem")
        .map((row) => row.textContent);

    expect(rows("desktop")).toEqual(rows("phone"));
    expect(rows("phone")).toHaveLength(3);
  });

  test("a date with no session renders no copy of either", () => {
    // The walks-only and nothing-scheduled days have no list and no bar, and
    // the copies must not bring an empty one.
    render(view({ sessions: [WALK] }));

    expect(document.querySelector("[data-list]")).toBeNull();
    expect(document.querySelector("[data-bar]")).toBeNull();
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
const set = (exerciseId: string, setIndex: number, value = 12) => ({
  exerciseId,
  setIndex,
  value,
});

/** '3 x 30–60 sec' with its seconds transcribed — FUEL-123. */
const TIMED_HOLD = {
  id: "e4",
  name: "Plank",
  prescription: "3 x 30–60 sec",
  section: WORKING_SECTION,
  notes: null,
  targetSets: 3,
  targetRepsLow: null,
  targetRepsHigh: null,
  targetSecondsLow: 30,
  targetSecondsHigh: 60,
  media: null,
};

/** A session of the timed hold alone, holding it until its sets are in. */
const timed = (sets: ReturnType<typeof set>[] = []) => [
  { ...CIRCUIT, type: "intervals", exercises: [TIMED_HOLD], sets },
  WALK,
];

/** The session with sets already against it. */
const withSets = (sets: ReturnType<typeof set>[]) => [{ ...CIRCUIT, sets }, WALK];

/**
 * The same session stepped exercise by exercise — FUEL-119.
 *
 * `CIRCUIT` is a circuit, so it steps round by round: ticking press-ups' set 1
 * moves the measure to reverse lunges. The sub-list tests below are about ONE
 * exercise's rows across several sets, and they are not about stepping, so they
 * run on a type that holds the subject until its sets are in. That is also
 * what Skipping Intervals + Core does, which the ticket requires unchanged.
 */
const straight = (sets: ReturnType<typeof set>[] = []) => [
  { ...CIRCUIT, type: "intervals", sets },
  WALK,
];

/** In the session state on the first render, the way a reload arrives in it. */
const resumed = () => window.localStorage.setItem(`fuel:training-session:${TODAY}`, "1");

describe("entering and leaving the session state", () => {
  test("offers Start session on today, and Mark done on any other date", () => {
    // Brand Guide § Desktop's state table. "The primary changes because the
    // screen's question does" — before you train that is starting, while you
    // are training it is finishing — and a past date is a record, so Start
    // session is not offered where it would mean nothing.
    const { unmount } = render(view());

    expect(bar().getByRole("button", { name: "Start session" })).toBeTruthy();
    expect(bar().queryByRole("button", { name: "Mark done" })).toBeNull();

    unmount();
    render(view({ date: YESTERDAY }));

    expect(bar().getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(bar().queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("swaps the whole list for the exercise being worked", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // § P3's re-aimed criterion: "the active exercise is what is visible when
    // you are working". The subject is the exercise; the session's name moves
    // to the eyebrow above it.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
    // By role: the session's name is also a row in Recent, which is the aside
    // doing its own job and not this assertion's subject.
    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B" }),
    ).toBeTruthy();
    expect(screen.getByText(/3 x 12 · Round 1 of 3 · Exercise 1 of 3/)).toBeTruthy();

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

    expect(list().getByRole("heading", { name: "Exercises" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sets" })).toBeNull();
  });

  test("is not offered on a date with no session to work through", () => {
    render(view({ sessions: [WALK] }));

    expect(bar().queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("records the session and leaves when the primary is tapped", async () => {
    // PRD § P10: "entered and left by the primary". Mark done is the session
    // state's primary; it writes the status and returns to the plan state.
    const user = userEvent.setup();

    render(view());
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", entryId: "entry-circuit" }),
    );
    expect(await list().findByRole("heading", { name: "Exercises" })).toBeTruthy();
  });

  test("leaves on Partial and on Skip too", async () => {
    // A session marked partial is a session that has stopped. Leaving the
    // reader inside a surface for operating one they have just said is over
    // would be a state whose only way out is the buttons they already pressed.
    const user = userEvent.setup();

    render(view());
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(bar().getByRole("button", { name: "Partial" }));

    expect(await list().findByRole("heading", { name: "Exercises" })).toBeTruthy();

    // With nothing logged, Skip session records in one tap (FUEL-121): a
    // session started by mistake has nothing to lose, and needs a way out.
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));

    expect(setSessionStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "skipped", entryId: "entry-circuit" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await list().findByRole("heading", { name: "Exercises" })).toBeTruthy();
  });

  test("keeps the bar pinned at every width, unlike every other bar", () => {
    // § Desktop's one named exception to FUEL-72's release, and the reason it
    // is not `APP_ACTION_BAR`: a rest timer rides in this slot (FUEL-93) and a
    // live readout that scrolls out of sight has failed at its only job at 1920
    // exactly as at 375. Identity, so the string cannot quietly gain `lg:static`.
    //
    // The placement is the state's own too, since FUEL-106: `PAGE_SESSION_FOOT`
    // spans the frame's content rows and aligns to their foot, which is where a
    // `bottom` offset can reach the bar from. `PAGE_MEASURE_FOOT` — row three,
    // aligned to its top — is what left the exception declared and inert above
    // 1272. What that placement DOES is invisible here, jsdom applying no
    // stylesheet; `tests/visual/session-bar.spec.ts` measures it in a browser
    // and this holds the two strings apart.
    resumed();
    render(view());

    const pinned = bar().getByRole("button", { name: "Mark done" }).closest(".action-bar-fade");

    expect(pinned?.className).toBe(`${SESSION_ACTION_BAR} ${PAGE_SESSION_FOOT}`);
    expect(pinned?.className).not.toContain("lg:static");
    expect(pinned?.className).not.toContain(PAGE_MEASURE_FOOT);

    // One bar, not handed over. FUEL-118's two copies are the plan state's, and
    // a copy of THIS bar would be a second running timer.
    expect(document.querySelectorAll(".action-bar-fade")).toHaveLength(1);
    expect(pinned?.hasAttribute("data-bar")).toBe(false);
  });

  test("does not offer Clear from inside a session", () => {
    // The mock draws three controls and no fourth. Clear takes the whole record
    // away and its cascade takes the sets with it — a control with no use
    // mid-session and every reason not to be reached by accident.
    resumed();
    render(view({ sessions: [{ ...CIRCUIT, entry: { status: "partial", note: null, durationMin: null } }, WALK] }));

    expect(bar().queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

/**
 * Skip session, once a set is logged — FUEL-121.
 *
 * A bare Skip under a list of sets reads as *skip this exercise*, and one tap
 * of it recorded the day as skipped and left the state. The sets survived, but
 * the adherence record said *skipped* about a session that was mostly done.
 * So the session state names what it acts on, and asks first once there is
 * something the answer would misdescribe.
 */
describe("the session clock — FUEL-124", () => {
  /**
   * Only `Date` is faked. The interval, the transitions and user-event's own
   * delays stay real, so nothing here depends on a tick having run — which is
   * the point: the reading is `now − start`, and a clock that was right only
   * because an interval fired would be wrong on a locked phone.
   */
  const T = Date.UTC(2026, 7, 20, 17, 30, 0);
  const KEY = `fuel:training-session:${TODAY}`;
  const MIN = 60_000;

  /** Entered at `startedAt`, the way a reload arrives in the state. */
  const startedAt = (instant: number) => window.localStorage.setItem(KEY, String(instant));

  const clock = () => document.querySelector("time");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("stores the instant Start session was tapped, and reads 0:00 from it", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(window.localStorage.getItem(KEY)).toBe(String(T));
    expect(clock()?.textContent).toBe("Elapsed 0:00");
  });

  test("keeps the clock out of the heading, whose name stays the session's", async () => {
    // A heading whose accessible name changed every second would be a
    // different heading to every query that names it.
    startedAt(T - 5 * MIN);

    render(view());

    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B" }),
    ).toBeTruthy();
    expect(clock()?.closest("h2")).toBeNull();
    // Not `role="timer"`: that is the rest timer's, and one per screen.
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("reads the stored instant after a reload", () => {
    startedAt(T - (12 * 60 + 34) * 1000);

    render(view());

    expect(clock()?.textContent).toBe("Elapsed 12:34");
    expect(clock()?.getAttribute("dateTime")).toBe("PT754S");
  });

  test("is right on the frame a backgrounded tab comes back, with no tick in between", () => {
    startedAt(T);
    render(view());

    // Twenty minutes pass and no interval runs — a phone locked in a pocket.
    vi.setSystemTime(T + 20 * MIN + 5000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(clock()?.textContent).toBe("Elapsed 20:05");
  });

  test('keeps a session entered before FUEL-124 ("1"), without a clock', () => {
    resumed();

    render(view());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
    expect(clock()).toBeNull();
  });

  test("draws no clock for a start it cannot believe, and keeps the state", () => {
    // More than a minute ahead of the clock: not a start this app wrote.
    startedAt(T + 2 * MIN);

    render(view());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
    expect(clock()).toBeNull();
  });

  test.each(["Mark done", "Partial"])(
    "%s with an empty duration records the elapsed minutes",
    async (button) => {
      const user = userEvent.setup();
      startedAt(T - (27 * 60 + 40) * 1000);

      render(view());
      await user.click(bar().getByRole("button", { name: button }));

      expect(setSessionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ durationMin: "28" }),
      );
      // And into the box, so it reads back as a value the reader can change.
      expect(
        (await screen.findByLabelText<HTMLInputElement>("Duration")).value,
      ).toBe("28");
    },
  );

  test("never overwrites a duration the reader typed", async () => {
    // The session state does not draw `This session`, so a typed duration is
    // one typed before Start session — or one already recorded, below.
    const user = userEvent.setup();

    render(view());
    await user.type(screen.getByLabelText("Duration"), "40");
    await user.click(bar().getByRole("button", { name: "Start session" }));
    vi.setSystemTime(T + 28 * MIN);
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ durationMin: "40" }),
    );
  });

  test("never overwrites a duration already recorded, on a session entered again", async () => {
    const user = userEvent.setup();
    startedAt(T - 28 * MIN);

    render(view({ sessions: recorded({ status: "partial", note: null, durationMin: 15 }) }));
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ durationMin: "15" }),
    );
  });

  test("records no duration for a skip", async () => {
    // Nothing logged, so Skip session records in one tap. A skipped session has
    // no training time to put a number to.
    const user = userEvent.setup();
    startedAt(T - 28 * MIN);

    render(view());
    await user.click(bar().getByRole("button", { name: "Skip session" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", durationMin: "" }),
    );
  });

  test("leaves the box empty for a session forgotten past three hours", async () => {
    // A capped figure would be one this app invented; empty is what the box
    // held before FUEL-124. The clock still says why.
    const user = userEvent.setup();
    startedAt(T - 3 * 60 * MIN - 1000);

    render(view());
    expect(clock()?.textContent).toBe("Elapsed 3:00:01");
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ durationMin: "" }),
    );
  });

  test("leaves the box empty for a legacy session, which has no instant", async () => {
    const user = userEvent.setup();
    resumed();

    render(view());
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ durationMin: "" }),
    );
  });

  test("lets the reader clear the recorded duration afterwards", async () => {
    const user = userEvent.setup();
    startedAt(T - 28 * MIN);

    const { rerender } = render(view());
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    // The server's answer, as the revalidated page hands it back.
    rerender(view({ sessions: recorded({ status: "done", note: null, durationMin: 28 }) }));

    const duration = await screen.findByLabelText<HTMLInputElement>("Duration");
    expect(duration.value).toBe("28");

    await user.clear(duration);
    await user.click(await bar().findByRole("button", { name: "Save note" }));

    expect(setSessionStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "done", durationMin: "" }),
    );
  });
});

describe("Skip session, once a set is logged", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Skip session" });

  test("asks before it records, and records nothing by asking", async () => {
    const user = userEvent.setup();
    resumed();

    render(view({ sessions: withSets([set("e1", 1), set("e1", 2)]) }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));

    expect(dialog()).toBeTruthy();
    expect(within(dialog()).getByText(/2 sets are logged\. They’re kept,/)).toBeTruthy();
    expect(within(dialog()).getByText(/Partial says so/)).toBeTruthy();
    expect(setSessionStatus).not.toHaveBeenCalled();
  });

  test("counts one set in the singular", async () => {
    const user = userEvent.setup();
    resumed();

    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));

    expect(within(dialog()).getByText(/1 set is logged\. It’s kept,/)).toBeTruthy();
  });

  test("Keep going closes it and leaves the session where it was", async () => {
    const user = userEvent.setup();
    resumed();

    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));
    await user.click(within(dialog()).getByRole("button", { name: "Keep going" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setSessionStatus).not.toHaveBeenCalled();
    // Still in the session state, on the exercise the sets say.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Reverse lunges");
  });

  test("Record as skipped records it, leaves the state, and keeps the sets", async () => {
    const user = userEvent.setup();
    resumed();

    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));
    await user.click(within(dialog()).getByRole("button", { name: "Record as skipped" }));

    expect(setSessionStatus).toHaveBeenCalledOnce();
    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", entryId: "entry-circuit" }),
    );
    expect(removeExerciseSet).not.toHaveBeenCalled();
    expect(await list().findByRole("heading", { name: "Exercises" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("fills its Destructive button, which only a confirmation sheet may", async () => {
    // § Buttons: "no fill; it is filled only inside a confirmation sheet".
    const user = userEvent.setup();
    resumed();

    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));

    const confirm = within(dialog()).getByRole("button", { name: "Record as skipped" });
    expect(confirm.getAttribute("data-variant")).toBe("destructive");
    expect(confirm.className).toContain("bg-destructive");
    // And the bar's own Skip session stays a Secondary, the weight of Partial.
    expect(
      bar().getByRole("button", { name: "Skip session", hidden: true }).getAttribute(
        "data-variant",
      ),
    ).toBe("secondary");
  });

  test("does not reopen by itself when the state ended under it", async () => {
    // Another tab clears the entered flag while the sheet is open. The sheet
    // goes with the state, and entering again must not bring it back unasked.
    const user = userEvent.setup();
    const key = `fuel:training-session:${TODAY}`;
    resumed();

    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(bar().getByRole("button", { name: "Skip session" }));
    expect(dialog()).toBeTruthy();

    act(() => {
      window.localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bar().getByRole("button", { name: "Skip session" })).toBeTruthy();
    expect(setSessionStatus).not.toHaveBeenCalled();
  });

  test("never draws a bare Skip in the session state", () => {
    // The criterion: whatever label remains cannot be read as acting on the
    // current exercise. FUEL-120's steps are Previous and Next exercise, so no
    // control on the screen is called Skip on its own.
    resumed();

    render(view({ sessions: withSets([set("e1", 1)]) }));

    expect(screen.queryByRole("button", { name: /^Skip$/ })).toBeNull();
  });

  test("keeps aria-pressed on the recorded answer", () => {
    // The three are one choice with three answers, in either state.
    resumed();

    render(
      view({
        sessions: [
          {
            ...CIRCUIT,
            sets: [set("e1", 1)],
            entry: { status: "skipped", note: null, durationMin: null },
          },
          WALK,
        ],
      }),
    );

    expect(bar().getByRole("button", { name: "Skip session" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(bar().getByRole("button", { name: "Partial" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(bar().getByRole("button", { name: "Mark done" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  test("leaves the plan state's Skip a single tap, sets or not", async () => {
    // Outside the session there is no list of sets for Skip to be read
    // against: it answers "did you do today's session?", as it always has.
    const user = userEvent.setup();

    render(view({ sessions: withSets([set("e1", 1)]) }));
    await user.click(bar().getByRole("button", { name: "Skip" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", entryId: "entry-circuit" }),
    );
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
    render(view({ sessions: straight([set("e1", 1, 12), set("e1", 2, 9)]) }));

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
      value: 12,
    });
  });

  test("offers a timed hold in seconds, and an empty tick logs its low end — FUEL-123", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: timed() }));

    // The box names its unit, the line says the target in seconds, and the
    // placeholder is the low end the tick will log — never a reps box.
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Set 1 seconds").placeholder).toBe("30");
    expect(screen.getAllByText("Target 30–60s")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(logExerciseSet).toHaveBeenCalledWith({
      date: TODAY,
      entryId: "entry-circuit",
      exerciseId: "e4",
      setIndex: 1,
      value: 30,
    });
  });

  test("shows a logged hold as its seconds", () => {
    resumed();
    render(view({ sessions: timed([set("e4", 1, 45)]) }));

    expect(screen.getByLabelText<HTMLInputElement>("Set 1 seconds").value).toBe("45");
    expect(screen.getByText("sec")).toBeTruthy();
    // Four digits fit: `MAX_SECONDS` is an hour, and a three-digit box would
    // refuse a twenty-minute hold the action accepts.
    expect(screen.getByLabelText<HTMLInputElement>("Set 1 seconds").maxLength).toBe(4);
    expect(screen.getByLabelText<HTMLInputElement>("Set 2 seconds").maxLength).toBe(4);
  });

  test("logs what was typed rather than what was asked for", async () => {
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.type(screen.getByLabelText("Set 1 reps"), "9");
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(logExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ setIndex: 1, value: 9 }),
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
    render(view({ sessions: straight() }));
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(await screen.findByRole("button", { name: "Remove set 1" })).toBeTruthy();

    pending.settle({ ok: true });
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
  });

  test("takes a set back when its tick is tapped again", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight([set("e1", 1)]) }));
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
    render(view({ sessions: straight([set("e1", 1, 12)]) }));

    const input = screen.getByLabelText("Set 1 reps");

    await user.clear(input);
    await user.type(input, "8");
    await user.tab();

    expect(logExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ setIndex: 1, value: 8 }),
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

  test("outside a circuit, moves to the next exercise when an exercise's sets are complete", async () => {
    // The current exercise is DERIVED, so it advances on the frame the last set
    // lands rather than on the render after the server agrees.
    const user = userEvent.setup();
    // Held open on purpose. The props are fixed in a test, so a mock that
    // resolves at once ends the transition and takes the optimistic set back
    // with it — the screen would return to Press-ups before the assertion ran.
    const pending = deferred<{ ok: boolean }>();

    logExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(view({ sessions: straight([set("e1", 1), set("e1", 2)]) }));

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
    expect(bar().getByRole("button", { name: "Mark done" })).toBeTruthy();
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
      expect.objectContaining({ exerciseId: "e3", setIndex: 1, value: 20 }),
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
    expect(await bar().findByRole("alert")).toHaveProperty(
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
    await user.click(bar().getByRole("button", { name: "Try again" }));

    expect(logExerciseSet).toHaveBeenCalledTimes(2);
    expect(logExerciseSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ setIndex: 1, value: 12 }),
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

describe("last time, on the set rows — FUEL-122", () => {
  /** The session stepped straight, with last time's sets against it. */
  const recalled = (
    lastTime: ReturnType<typeof set>[],
    sets: ReturnType<typeof set>[] = [],
  ) => [{ ...CIRCUIT, type: "intervals", sets, lastTime }, WALK];

  test("follows each row's target with that set's reps last time", () => {
    resumed();
    render(view({ sessions: recalled([set("e1", 1, 10), set("e1", 2, 9)]) }));

    const rows = screen.getAllByRole("listitem").filter((row) =>
      within(row).queryByLabelText(/^Set \d reps$/),
    );

    // By set number: row 1 is last time's set 1, row 2 its set 2, and row 3,
    // which last time never reached, carries the target and nothing else.
    expect(rows.map((row) => within(row).getByText(/^Target/).textContent)).toEqual([
      "Target 12 · 10 last time",
      "Target 12 · 9 last time",
      "Target 12",
    ]);
  });

  test("draws nothing at all on a first session", () => {
    // No dash, no zero, no "first time" — the rows read exactly as they did
    // before this ticket.
    resumed();
    render(view({ sessions: recalled([]) }));

    expect(screen.getAllByText("Target 12")).toHaveLength(3);
    expect(screen.queryByText(/last time/)).toBeNull();
  });

  test("reads only the exercise on screen", () => {
    // Reverse lunges' last time is in the same list, and press-ups is the
    // subject. `setsFor` is what keeps one exercise's history off another's rows.
    resumed();
    render(view({ sessions: recalled([set("e2", 1, 8), set("e2", 2, 7)]) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
    expect(screen.queryByText(/last time/)).toBeNull();
  });

  test("keeps last time beside a set once it is logged", () => {
    resumed();
    render(
      view({ sessions: recalled([set("e1", 1, 10), set("e1", 2, 9)], [set("e1", 1, 11)]) }),
    );

    expect(screen.getByLabelText<HTMLInputElement>("Set 1 reps").value).toBe("11");
    expect(screen.getByText("reps · 10 last time")).toBeTruthy();
    expect(screen.getByText("Target 12 · 9 last time")).toBeTruthy();
  });

  test("leaves the placeholder and the empty tick on the target, not last time", async () => {
    // The ticket's one decision in writing: last time is text beside the box.
    // A placeholder of 9 over a tick that logs 12 would be a box offering one
    // number while the control recorded another.
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: recalled([set("e1", 1, 9)]) }));

    expect(screen.getByLabelText<HTMLInputElement>("Set 1 reps").placeholder).toBe("12");
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(logExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: "e1", setIndex: 1, value: 12 }),
    );
  });
});

describe("what the plan state says about sets", () => {
  test("puts set progress on the exercise's own row and adds no rows", () => {
    // § Desktop's table: "Slash metadata on the exercise's own row — `/ 3 of 3
    // sets`. No rows added." That is what keeps § Lists' window spendable.
    render(view({ sessions: withSets([set("e1", 1), set("e1", 2)]) }));

    // The exercise list itself, found through a row of it — the screen holds
    // three lists and the other two are the aside's.
    const exercises = list().getByText("Press-ups").closest("ol")!;

    expect(list().getByText("2 of 3 sets")).toBeTruthy();
    // Three exercises, three rows. The progress is metadata on a row rather
    // than a row of its own.
    expect(within(exercises).getAllByRole("listitem")).toHaveLength(3);
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
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    // The plan state is the list, and the list still says what was performed.
    // Leaving the session state is a change of composition, not of record.
    expect(await list().findByText("1 of 3 sets")).toBeTruthy();
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
      targetSecondsLow: null,
      targetSecondsHigh: null,
      media: null,
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
      targetSecondsLow: null,
      targetSecondsHigh: null,
      media: null,
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
      expect(list().getByRole("heading", { level: 2, name: label })).toBeTruthy();
    }
  });

  test("still lists every row of the session, bookends included", () => {
    render(view({ sessions: sectioned() }));

    expect(list().getByText("Joint prep")).toBeTruthy();
    expect(list().getByText("Lower-body stretches")).toBeTruthy();
    expect(list().getByText("Press-ups")).toBeTruthy();
  });

  test("reports set progress on working rows and says nothing about a warm-up", () => {
    render(view({ sessions: sectioned([set("e1", 1), set("e1", 2)]) }));

    expect(list().getByText("2 of 3 sets")).toBeTruthy();
    // The warm-up logs no sets, so it has nothing to report — and a row that
    // said "0 of" anything would be reporting an absence about a row that was
    // never going to have a figure.
    const warmUp = list().getByText("Joint prep").closest("li")!;

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
          targetSecondsLow: null,
          targetSecondsHigh: null,
          media: null,
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

    expect(bar().queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("still records a status, because the session still happened", () => {
    // Refusing the session STATE is not refusing the session. The three
    // outcomes stay exactly where they were.
    render(view({ sessions: mobilityOnly() }));

    expect(bar().getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(bar().getByRole("button", { name: "Partial" })).toBeTruthy();
    expect(bar().getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  test("still draws the rows it does have", () => {
    // The list is the screen's subject in the plan state, and a warm-up row is
    // an exercise. One section, so no heading — the flat list, as always.
    render(view({ sessions: mobilityOnly() }));

    expect(list().getByText("Joint prep")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Warm-up" })).toBeNull();
  });
});

describe("the session state, when a session has sections", () => {
  test("opens on the first WARM-UP row — FUEL-125", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // FUEL-92 made the bookends sections of the list; FUEL-125 makes them steps
    // of the session. Until it, the reader warmed up from the plan-state list
    // BEFORE tapping Start session, so the session did not start when the
    // workout did. This test asserted "Press-ups" for exactly that reason and is
    // reversed by decision, not by regression.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Joint prep");
  });

  test("offers no set entry on a warm-up row — PRD § P10", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // "Set logging offered on the working section only." Three sets of a hip
    // opener is not information anybody wants recorded, and a box to type it in
    // is the invitation to record it. The step is a movement and a way on.
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Sets" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Next exercise/ })).toBeTruthy();

    // And no way BACK from the first step of the session, which is the boundary
    // an overloaded "nothing that way" would draw a button on — one that jumped
    // the reader straight into the work.
    expect(screen.queryByRole("button", { name: /^Previous exercise/ })).toBeNull();
  });

  test("counts a bookend in its own stage, never in the working count", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // "Warm-up 1 of 1", not "Exercise 1 of 5" and not "Exercise 1 of 3". The
    // working count keeps meaning the work: a warm-up in that denominator would
    // be a session reporting itself as longer than the work it asks for. The
    // round is the work's too — a warm-up has no rounds.
    expect(screen.getByText(/~2 min · Warm-up 1 of 1/)).toBeTruthy();
    expect(screen.queryByText(/Exercise 1 of/)).toBeNull();
    expect(screen.queryByText(/Round/)).toBeNull();
  });

  test("counts the working rows in the position, not the whole session", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));
    // Past the warm-up, into the work.
    await user.click(screen.getByRole("button", { name: /^Next exercise/ }));

    // Three working rows out of five. "Exercise 1 of 5" would be a session
    // reporting itself as longer than the work it is asking for, and the count
    // would never reach its own last exercise.
    expect(screen.getByText(/3 x 12 · Round 1 of 3 · Exercise 1 of 3/)).toBeTruthy();
  });

  test("names the stage the reader is in, in the eyebrow", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // The eyebrow is the only place that says which of the three stages this is
    // — the Title is the movement's and the slash line is the position's. It
    // said "· Work" unconditionally before FUEL-125, which was true while the
    // work was the only stage the state stepped through.
    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B · Warm-up" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Next exercise/ }));

    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B · Work" }),
    ).toBeTruthy();
  });

  test("leaves the eyebrow alone when the session has no sections", async () => {
    const user = userEvent.setup();

    render(view());
    await user.click(bar().getByRole("button", { name: "Start session" }));

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
    await user.click(bar().getByRole("button", { name: "Start session" }));
    // Into the work, which is where the two lists diverge.
    await user.click(screen.getByRole("button", { name: /^Next exercise/ }));

    // The aside holds the WHOLE session — § Desktop's "the rest of the list" —
    // while the measure's working position is an index into the working rows
    // alone. So the current marker cannot be that index: index 0 of this list is
    // the warm-up, and the measure is showing the first working exercise.
    //
    // FUEL-125 steps the bookends too, so reaching the work now takes a tap.
    // The fault this guards is unchanged and still invisible to both suites:
    // jsdom has no width and the column is `hidden` below the cap, and the
    // screen baselines photograph the plan state rather than this one.
    const marked = document.querySelectorAll('[aria-current="step"]');

    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("Press-ups");
    expect(marked[0]!.textContent).not.toContain("Joint prep");
  });

  test("marks the bookend row in the aside while the reader is on it", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // The other half of the same rule, and the ticket's own ≥1272 note: the
    // aside already lists all three sections, so the marking extends to bookend
    // rows. It does because the mark is by id and the measure's subject is now
    // the stage's row — nothing here translates a position.
    const marked = document.querySelectorAll('[aria-current="step"]');

    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("Joint prep");
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
    //
    // It also covers FUEL-125's re-entry rule from the other side: with sets
    // already logged, entering opens in the WORK rather than at the warm-up,
    // because the sets are the honest account of how far along the reader is.
    // The cool-down is reached by stepping, never by landing.
    render(
      view({
        sessions: sectioned([
          set("e1", 1), set("e1", 2), set("e1", 3),
          set("e2", 1), set("e2", 2),
          set("e3", 1), set("e3", 2), set("e3", 3),
        ]),
      }),
    );
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plank");
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-125 — the bookends as steps of the session                             */
/* -------------------------------------------------------------------------- */

/**
 * The session with cues on its bookends, which the seed has and `SECTIONED`
 * does not.
 *
 * On a bookend the cues ARE the content — "10 arm circles forward, 10 backward"
 * is the whole of what the step asks for, where a working exercise's own
 * instruction is its sets. So they need a fixture that carries them.
 */
const CUED = (): TrainingItem[] => [
  {
    ...SECTIONED,
    exercises: SECTIONED.exercises.map((exercise) =>
      exercise.section === "work"
        ? exercise
        : { ...exercise, notes: `Cues for ${exercise.name}.` },
    ),
    sets: [],
  },
  WALK,
];

/** Every working set of the seeded circuit, so the work has no step left. */
const ALL_WORKING_SETS = [
  set("e1", 1), set("e1", 2), set("e1", 3),
  set("e2", 1), set("e2", 2),
  set("e3", 1), set("e3", 2), set("e3", 3),
];

const step = (direction: "Next" | "Previous") =>
  screen.getByRole("button", { name: new RegExp(`^${direction} exercise`) });

describe("the bookends as steps of the session — FUEL-125", () => {
  test("a bookend step draws its cues, in the Sets section's shape", async () => {
    const user = userEvent.setup();

    render(view({ sessions: CUED() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 2, name: "Cues" })).toBeTruthy();
    expect(screen.getByText("Cues for Joint prep.")).toBeTruthy();
  });

  test("a bookend with no cues draws no eyebrow over an empty block", async () => {
    const user = userEvent.setup();

    // `SECTIONED`'s own bookends have `notes: null`. The refusal `Show form`
    // makes: the section is absent rather than hidden, so the gap closes.
    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.queryByRole("heading", { level: 2, name: "Cues" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Joint prep");
  });

  test("steps from the warm-up into the work and back", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(step("Next"));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");

    await user.click(step("Previous"));

    // Back onto the warm-up row, not two steps into the work. The stage owns
    // the boundary and hands over only at its own end.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Joint prep");
  });

  test("after the last working exercise the session steps into the cool-down", async () => {
    const user = userEvent.setup();

    // AC: "After the last working exercise, the session state steps through the
    // cool-down." Before FUEL-125 the cool-down came after Mark done had
    // already left the state — of the cool-down whose own cue is "don't skip it
    // after skipping".
    render(view({ sessions: [{ ...SECTIONED, sets: ALL_WORKING_SETS }, WALK] }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plank");

    await user.click(step("Next"));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Lower-body stretches",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Bodyweight Circuit B · Cool-down" }),
    ).toBeTruthy();
    // Its own stage's count, and no set entry — the same two rules as the warm-up.
    expect(screen.getByText(/30 sec each · Cool-down 1 of 1/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  test("the cool-down is the end of the session, with nothing after it", async () => {
    const user = userEvent.setup();

    render(view({ sessions: [{ ...SECTIONED, sets: ALL_WORKING_SETS }, WALK] }));
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(step("Next"));

    expect(screen.queryByRole("button", { name: /^Next exercise/ })).toBeNull();
    expect(step("Previous")).toBeTruthy();
  });

  test("Mark done is available on a bookend, and is never required after it", async () => {
    const user = userEvent.setup();

    // AC: "Mark done is available throughout." If the cool-down is part of the
    // session, finishing has to be reachable DURING it and cannot be required
    // before it. The bar is outside the measure's branch, so this pins a fact
    // the structure already gives rather than one a change here would announce.
    render(view({ sessions: [{ ...SECTIONED, sets: ALL_WORKING_SETS }, WALK] }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // In the work, with every set logged.
    expect(bar().getByRole("button", { name: "Mark done" })).toBeTruthy();

    await user.click(step("Next"));

    // And on the cool-down, which is the step this ticket puts AFTER the point
    // the app used to call finished.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Lower-body stretches",
    );
    expect(bar().getByRole("button", { name: "Mark done" })).toBeTruthy();
  });

  test("the accessible name says where the step goes, bookend or working row", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // FUEL-120's rule, extended: a bookend names its row, and a working step
    // keeps "Reverse lunges, round 1". The hand-over BACK into the work names
    // the derived position rather than a stored one.
    expect(
      screen.getByRole("button", { name: "Next exercise, Press-ups, round 1" }),
    ).toBeTruthy();

    await user.click(step("Next"));

    expect(
      screen.getByRole("button", { name: "Previous exercise, Joint prep" }),
    ).toBeTruthy();
  });

  test("the position survives a remount, with nothing new in the database", async () => {
    const user = userEvent.setup();

    // AC: "The position survives a reload, with nothing new in the database."
    // The stage is one id in `localStorage`, beside the entered instant and
    // `Moved` — no row, no column, no migration.
    const { unmount } = render(view({ sessions: sectioned() }));

    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(step("Next"));
    await user.click(step("Next"));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Reverse lunges");

    unmount();
    render(view({ sessions: sectioned() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Reverse lunges");
  });

  test("a session entered before this ticket stays in the work", () => {
    // The legacy case, decided by construction: the entered instant with no
    // stage id reads as in the work. A deploy mid-session does not yank the
    // reader back to the warm-up.
    window.localStorage.setItem(`fuel:training-session:${TODAY}`, String(Date.now()));

    render(view({ sessions: sectioned() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
  });

  test("a stored id the session no longer has falls back to the work", () => {
    // `localStorage` is anyone's to edit, and a rotated day is the honest
    // version of the same case.
    window.localStorage.setItem(`fuel:training-session:${TODAY}`, String(Date.now()));
    window.localStorage.setItem(`fuel:training-stage:${TODAY}`, "gone");

    render(view({ sessions: sectioned() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
  });

  test("a session with no bookends behaves exactly as today", async () => {
    const user = userEvent.setup();

    // AC 4, and the criterion most likely to rot silently: all three seeded
    // workouts HAVE bookends, so this is written against a working-only session
    // rather than a seed fixture. Entering opens on the first working exercise,
    // there is no step back from it, and nothing draws a Cues block.
    render(view());
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");
    expect(screen.getByText(/3 x 12 · Round 1 of 3 · Exercise 1 of 3/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Previous exercise/ })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Cues" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Sets" })).toBeTruthy();
  });

  test("leaving the session forgets which bookend the reader was on", async () => {
    const user = userEvent.setup();

    render(view({ sessions: sectioned() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Joint prep");

    await user.click(bar().getByRole("button", { name: "Mark done" }));

    // A session that has stopped keeps nobody's place in it. Entered again with
    // nothing logged, it opens at the warm-up — from the key being cleared, not
    // from it happening to still hold the first row.
    expect(window.localStorage.getItem(`fuel:training-stage:${TODAY}`)).toBeNull();
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
    await user.click(bar().getByRole("button", { name: "Start session" }));

    const timer = screen.getByRole("button", { name: "1:30" });
    const primary = bar().getByRole("button", { name: "Mark done" });

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
    await user.click(bar().getByRole("button", { name: "Start session" }));
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
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(screen.getByRole("button", { name: "1:30" }));
    await user.click(bar().getByRole("button", { name: "Mark done" }));

    // The bar goes back to the plan state's, and the timer's row goes with it.
    // The rest itself is not cancelled — nothing here writes to its key — but
    // there is no longer a surface it belongs to.
    expect(screen.queryByRole("timer")).toBeNull();
  });
});

/**
 * A circuit's rest starts on the set that earns it — FUEL-126.
 *
 * FUEL-93 ruled against auto-start because "an automatic timer would start
 * counting every time a set was corrected". The answer is that a correction and
 * a new set are different gestures in `SetList`, so every case below that is
 * not a NEW set in a circuit asserts that no timer appeared.
 */
describe("the rest timer, started by a logged set", () => {
  const timer = () => screen.queryByRole("timer")?.textContent ?? null;
  /** Round 2 on press-ups, with its set 1 logged: a row to correct. */
  const ROUND_2 = () => withSets([set("e1", 1, 12), set("e2", 1), set("e3", 1)]);

  test("starts 0:20 when the round goes on to the next exercise", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    logExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(view());
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    // On the tick, before the server answers.
    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(timer()).toBe("0:20");
    expect(setSessionStatus).not.toHaveBeenCalled();

    pending.settle({ ok: true });
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
  });

  test("starts 1:30 when the set finishes a round", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: withSets([set("e1", 1), set("e2", 1)]) }));
    // Plank, whose fixture has no target, so its tick needs a number.
    await user.type(screen.getByLabelText("Set 1 reps"), "45");
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(timer()).toBe("1:30");
  });

  test("starts on Enter in an open row, the tick's twin", async () => {
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.type(screen.getByLabelText("Set 1 reps"), "10{Enter}");

    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(timer()).toBe("0:20");
  });

  test("starts nothing after the session's last set", async () => {
    const user = userEvent.setup();

    resumed();
    render(
      view({
        sessions: withSets([
          ...[1, 2, 3].map((n) => set("e1", n)),
          set("e2", 1),
          set("e2", 2),
          set("e3", 1),
          set("e3", 2),
        ]),
      }),
    );
    await user.type(screen.getByLabelText("Set 3 reps"), "45");
    await user.click(screen.getByRole("button", { name: "Log set 3" }));

    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
    expect(timer()).toBeNull();
  });

  test("starts nothing on a correction, by blur or by Enter", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: ROUND_2() }));

    const input = screen.getByLabelText("Set 1 reps");

    await user.clear(input);
    await user.type(input, "8");
    await user.tab();
    await user.clear(input);
    await user.type(input, "9{Enter}");

    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledTimes(2));
    expect(timer()).toBeNull();
  });

  test("starts nothing when a set is taken back", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: ROUND_2() }));
    await user.click(screen.getByRole("button", { name: "Remove set 1" }));

    await waitFor(() => expect(removeExerciseSet).toHaveBeenCalledOnce());
    expect(timer()).toBeNull();
  });

  test("starts nothing outside a circuit, which keeps the manual timer", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight() }));
    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
    expect(timer()).toBeNull();
    expect(screen.getByRole("button", { name: "0:20" })).toBeTruthy();
  });

  test("stops by hand, like any rest", async () => {
    const user = userEvent.setup();

    resumed();
    render(view());
    await user.click(screen.getByRole("button", { name: "Log set 1" }));
    await screen.findByRole("timer");
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(timer()).toBeNull();
    expect(window.localStorage.getItem("fuel:rest-timer")).toBeNull();
  });
});

/**
 * The form affordance and what it opens — § P10, FUEL-94.
 *
 * The mock draws a Text button, "Show form", under the prescription in the
 * SESSION state, and FUEL-90's ruling says why it is not on each row of the plan
 * list. Both halves are asserted, because "not on the plan list" is the sort of
 * thing a later refactor restores without noticing.
 *
 * `currentEx.media` is a resolved value by the time this component sees it —
 * `page.tsx` runs `resolveFormMedia` at the boundary — so these fixtures carry
 * the resolved shape rather than a `media_key`. That is the type doing its job:
 * there is no way to hand this component a raw string.
 */
/**
 * A circuit walked round by round — FUEL-119.
 *
 * Both circuits are "3 rounds, each exercise back to back", so `CIRCUIT` (a
 * `circuit`) takes press-ups' set 1, then reverse lunges' set 1, then plank's,
 * and round 2 starts over at press-ups. Reverse lunges has a target of TWO,
 * which is what drops it out of round 3.
 */
describe("a circuit, round by round", () => {
  /**
   * The measure's slash line: prescription · round · exercise. Without the
   * leading "/", which is `SlashMeta`'s own aria-hidden mark.
   */
  const position = () =>
    screen.getByText(/ · Exercise \d of \d$/).textContent?.replace(/^\/\s*/, "");
  const subject = () => screen.getByRole("heading", { level: 1 }).textContent;

  test("moves to the next exercise's set 1 on the frame set 1 is ticked", async () => {
    // Held, so the move is shown to come from the optimistic set rather than
    // from the server's answer.
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    logExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(view());
    expect(position()).toBe("3 x 12 · Round 1 of 3 · Exercise 1 of 3");

    await user.click(screen.getByRole("button", { name: "Log set 1" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Reverse lunges" })).toBeTruthy();
    expect(position()).toBe("3 x 10 ea · Round 1 of 3 · Exercise 2 of 3");
    // Its own set 1 is the row on offer, not a set 2.
    expect(screen.getByRole("button", { name: "Log set 1" })).toBeTruthy();

    pending.settle({ ok: true });
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
  });

  test("begins round 2 at the first exercise once round 1 reaches the last", () => {
    resumed();
    render(view({ sessions: withSets([set("e1", 1), set("e2", 1), set("e3", 1)]) }));

    expect(subject()).toBe("Press-ups");
    expect(position()).toBe("3 x 12 · Round 2 of 3 · Exercise 1 of 3");
    // Every row is still drawn: set 1 done, and set 2 the first open one.
    expect(screen.getByRole("button", { name: "Remove set 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log set 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log set 3" })).toBeTruthy();
  });

  test("resumes mid-round after a reload, with nothing new stored", () => {
    resumed();
    render(
      view({
        sessions: withSets([set("e1", 1), set("e1", 2), set("e2", 1), set("e3", 1)]),
      }),
    );

    expect(subject()).toBe("Reverse lunges");
    expect(position()).toBe("3 x 10 ea · Round 2 of 3 · Exercise 2 of 3");
    // The entered boolean, and nothing about the round: nobody moved.
    expect(Object.keys(window.localStorage)).toEqual([`fuel:training-session:${TODAY}`]);
  });

  test("goes back to the round a removed set leaves open", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    removeExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(view({ sessions: withSets([set("e1", 1), set("e2", 1), set("e3", 1)]) }));
    expect(position()).toBe("3 x 12 · Round 2 of 3 · Exercise 1 of 3");

    await user.click(screen.getByRole("button", { name: "Remove set 1" }));

    await waitFor(() => expect(position()).toBe("3 x 12 · Round 1 of 3 · Exercise 1 of 3"));
    expect(subject()).toBe("Press-ups");

    pending.settle({ ok: true });
    await waitFor(() => expect(removeExerciseSet).toHaveBeenCalledOnce());
  });

  test("leaves an exercise with a shorter target out of the last round", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    logExerciseSet.mockReturnValue(pending.promise);

    resumed();
    render(
      view({
        sessions: withSets([
          set("e1", 1),
          set("e1", 2),
          set("e2", 1),
          set("e2", 2),
          set("e3", 1),
          set("e3", 2),
        ]),
      }),
    );
    expect(position()).toBe("3 x 12 · Round 3 of 3 · Exercise 1 of 3");

    await user.click(screen.getByRole("button", { name: "Log set 3" }));

    // Reverse lunges had its two rounds, so press-ups hands straight to plank.
    expect(await screen.findByRole("heading", { level: 1, name: "Plank" })).toBeTruthy();
    expect(position()).toBe("3 x 45s · Round 3 of 3 · Exercise 3 of 3");

    pending.settle({ ok: true });
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());
  });

  test("marks the round's exercise in the aside", () => {
    // The aside's `aria-current="step"` reads the same position as the measure.
    resumed();
    render(view({ sessions: sectioned([set("e1", 1)]) }));

    const marked = document.querySelectorAll('[aria-current="step"]');

    expect(subject()).toBe("Reverse lunges");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("Reverse lunges");
  });

  test("names no round outside a circuit", () => {
    // Skipping Intervals + Core steps exactly as it did: no round, and press-ups
    // held until its sets are in.
    resumed();
    render(view({ sessions: straight([set("e1", 1)]) }));

    expect(subject()).toBe("Press-ups");
    expect(position()).toBe("3 x 12 · Exercise 1 of 3");
    expect(screen.queryByText(/Round \d of/)).toBeNull();
  });
});

/**
 * A way past an exercise, and back — FUEL-120.
 *
 * Push-ups short of their third set used to hold the session state on push-ups,
 * and the only way on was to log a set that was not done. Every move here is
 * asserted to call NO action: the whole point is that the sets and the status
 * say what was performed, and moving is not performing.
 */
describe("a way past an exercise", () => {
  const MOVED = `fuel:training-moved:${TODAY}`;
  const subject = () => screen.getByRole("heading", { level: 1 }).textContent;
  const steps = () => within(screen.getByRole("navigation", { name: "Exercises" }));

  const nothingWritten = () => {
    expect(logExerciseSet).not.toHaveBeenCalled();
    expect(removeExerciseSet).not.toHaveBeenCalled();
    expect(setSessionStatus).not.toHaveBeenCalled();
    expect(clearSessionStatus).not.toHaveBeenCalled();
  };

  test("moves on from an exercise short of its target without logging a set", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight([set("e1", 1), set("e1", 2)]) }));
    expect(subject()).toBe("Press-ups");

    await user.click(steps().getByRole("button", { name: "Next exercise, Reverse lunges" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Reverse lunges" })).toBeTruthy();
    expect(screen.getByText(/ · Exercise 2 of 3$/)).toBeTruthy();
    nothingWritten();
  });

  test("goes back to the exercise passed, with its sets as they were", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight([set("e1", 1), set("e1", 2)]) }));

    await user.click(steps().getByRole("button", { name: "Next exercise, Reverse lunges" }));
    await user.click(
      await steps().findByRole("button", { name: "Previous exercise, Press-ups" }),
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Press-ups" })).toBeTruthy();
    // Two sets logged and the third still open: nothing was written for it.
    expect(screen.getByRole("button", { name: "Remove set 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove set 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log set 3" })).toBeTruthy();
    nothingWritten();
  });

  test("names the round in a circuit", async () => {
    const user = userEvent.setup();

    resumed();
    render(view());

    await user.click(
      steps().getByRole("button", { name: "Next exercise, Reverse lunges, round 1" }),
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Reverse lunges" })).toBeTruthy();
    expect(
      steps().getByRole("button", { name: "Previous exercise, Press-ups, round 1" }),
    ).toBeTruthy();
    expect(steps().getByRole("button", { name: "Next exercise, Plank, round 1" })).toBeTruthy();
    nothingWritten();
  });

  test("offers no Previous on the first step and no Next on the last", () => {
    resumed();
    render(view({ sessions: straight() }));

    expect(steps().queryByRole("button", { name: /^Previous exercise/ })).toBeNull();
    expect(steps().getByRole("button", { name: /^Next exercise/ })).toBeTruthy();

    cleanup();
    window.localStorage.setItem(MOVED, JSON.stringify({ passed: ["e1", "e2"], at: null }));
    render(view({ sessions: straight() }));

    expect(subject()).toBe("Plank");
    expect(steps().queryByRole("button", { name: /^Next exercise/ })).toBeNull();
    expect(steps().getByRole("button", { name: "Previous exercise, Reverse lunges" })).toBeTruthy();
  });

  test("keeps keyboard focus in the row when a press removes its own button", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight() }));

    // Two presses from the first step: the second lands on Plank, the last
    // step, and Next is no longer drawn.
    await user.click(steps().getByRole("button", { name: "Next exercise, Reverse lunges" }));
    await user.click(await steps().findByRole("button", { name: "Next exercise, Plank" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Plank" })).toBeTruthy();
    expect(steps().queryByRole("button", { name: /^Next exercise/ })).toBeNull();
    expect(document.activeElement).toBe(
      steps().getByRole("button", { name: "Previous exercise, Reverse lunges" }),
    );
  });

  test("never calls itself Skip", () => {
    // Skip finishes the whole session on this screen (FUEL-121).
    resumed();
    render(view({ sessions: straight([set("e1", 1)]) }));

    for (const button of steps().getAllByRole("button")) {
      expect(button.textContent).not.toMatch(/skip/i);
      expect(button.getAttribute("aria-label")).not.toMatch(/skip/i);
    }
  });

  test("keeps the reader where they moved to across a reload", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight([set("e1", 1)]) }));
    await user.click(steps().getByRole("button", { name: "Next exercise, Reverse lunges" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Reverse lunges" })).toBeTruthy();

    // A reload: the component comes back with nothing but the storage.
    cleanup();
    render(view({ sessions: straight([set("e1", 1)]) }));

    expect(subject()).toBe("Reverse lunges");
    expect(JSON.parse(window.localStorage.getItem(MOVED)!)).toEqual({
      passed: ["e1"],
      at: null,
    });
  });

  test("forgets the move when the session is recorded", async () => {
    const user = userEvent.setup();

    resumed();
    render(view({ sessions: straight([set("e1", 1)]) }));
    await user.click(steps().getByRole("button", { name: "Next exercise, Reverse lunges" }));
    await user.click(bar().getByRole("button", { name: "Partial" }));

    expect(window.localStorage.getItem(MOVED)).toBeNull();
  });

  test("reads a malformed stored value as the position the sets give", () => {
    resumed();
    window.localStorage.setItem(MOVED, "{not json");
    render(view({ sessions: straight([set("e1", 1)]) }));

    expect(subject()).toBe("Press-ups");
  });
});

describe("form reference media", () => {
  const MEDIA = {
    key: "side-plank",
    kind: "image" as const,
    frames: [
      { path: "/form/side-plank-1.jpg", width: 850, height: 567, label: "Set-up" },
      {
        path: "/form/side-plank-2.jpg",
        width: 850,
        height: 567,
        label: "Holding the side plank",
      },
    ],
    alt: "A side plank: propped on one forearm, feet stacked, hips lifted.",
    // A credit is carried here even though every SHIPPED asset waives it, so the
    // attribution path stays covered — see form-media.test.ts on why the
    // manifest is the wrong place to assert it from.
    credit: "A Photographer · CC BY-SA 3.0",
    licence: {
      name: "CC BY-SA 3.0",
      url: "https://creativecommons.org/licenses/by-sa/3.0/",
      requiresAttribution: true,
    },
  };

  /** The circuit with media on its FIRST working exercise, which is the subject. */
  const withMedia = (media: ResolvedFormMedia | null = MEDIA) => [
    {
      ...CIRCUIT,
      exercises: CIRCUIT.exercises.map((exercise, index) =>
        index === 0 ? { ...exercise, media } : exercise,
      ),
    },
    WALK,
  ];

  const start = async () => {
    const user = userEvent.setup();
    render(view({ sessions: withMedia() }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    return user;
  };

  test("offers Show form on the current exercise when it has media", async () => {
    await start();

    expect(await screen.findByRole("button", { name: "Show form" })).toBeTruthy();
  });

  test("draws nothing at all when the exercise has none", async () => {
    const user = userEvent.setup();

    render(view({ sessions: withMedia(null) }));
    await user.click(bar().getByRole("button", { name: "Start session" }));

    // Not a disabled control — absent. A disabled button would promise a
    // reference that does not exist, which § Desktop refuses by name.
    expect(screen.queryByRole("button", { name: "Show form" })).toBeNull();
  });

  /**
   * The plan state's own door — § P10, FUEL-108.
   *
   * This block replaces a test that asserted the opposite ("the plan list offers
   * it on no row"), and the way that test would have SURVIVED this change is
   * worth recording: it queried the exact name "Show form", and the plan rows
   * are named "Show form for Press-ups", so it went on passing while the thing
   * it claimed stopped being true. A test that passes for a reason unrelated to
   * its subject is worse than an absent one, and the fix is to assert against
   * the row rather than against a string that used to be unique.
   */
  describe("from the plan state", () => {
    test("a row with a reference leads with its WORKING frame — FUEL-129", () => {
      // The asset's last frame, not its first: the starts are people standing,
      // and the working position is what tells one movement from the next.
      render(view({ sessions: withMedia() }));

      const photos = list().getByRole("button", { name: /Press-ups/ }).querySelectorAll("img");

      expect(photos).toHaveLength(1);
      expect(photos[0]!.getAttribute("src")).toBe("/form/side-plank-2.jpg");
      // Every other row of the circuit has no reference, so only one is drawn.
      expect(list().getByRole("list").querySelectorAll("img")).toHaveLength(1);
    });

    test("a video reference draws no photograph on the row — FUEL-129", () => {
      // Its last frame is a video file, and the row's photograph is an `<img>`.
      render(view({ sessions: withMedia({ ...MEDIA, kind: "video" }) }));

      expect(list().getByRole("list").querySelectorAll("img")).toHaveLength(0);
    });

    test("the session state draws no photograph — FUEL-129", async () => {
      // § The two states of `/training`: the measure keeps `Show form` and the
      // list is the plan state's alone.
      await start();

      expect(await screen.findByRole("button", { name: "Show form" })).toBeTruthy();
      expect(document.querySelectorAll("img")).toHaveLength(0);
    });

    test("a working row opens its sets, and the reference is inside them", async () => {
      // FUEL-90 put the affordance with the subject, and the reader who is
      // PLANNING never reaches a subject: the session state is today-only and
      // shows one exercise at a time. FUEL-108 gave the row the reference;
      // FUEL-127 gave a working row its sets, and the reference moved one tap
      // on, into that sheet — handed over rather than stacked.
      const user = userEvent.setup();

      render(view({ sessions: withMedia() }));

      await user.click(
        await list().findByRole("button", { name: /Show sets for.*Press-ups/ }),
      );

      const sets = await screen.findByRole("dialog", { name: "Sets · Press-ups" });

      await user.click(within(sets).getByRole("button", { name: "Show form" }));

      expect(await screen.findByRole("dialog", { name: "Form · Press-ups" })).toBeTruthy();
      // One sheet at a time: the sets sheet gave way to the reference.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    test("a working row with no reference opens sets that offer none", async () => {
      // The other two exercises in the fixture carry `media: null`. Absent, not
      // disabled — the same refusal the session state's button makes.
      const user = userEvent.setup();

      render(view({ sessions: withMedia() }));

      await user.click(
        await list().findByRole("button", { name: /Show sets for.*Reverse lunges/ }),
      );

      const sets = await screen.findByRole("dialog", { name: "Sets · Reverse lunges" });

      expect(within(sets).queryByRole("button", { name: "Show form" })).toBeNull();
    });

    test("opens the exercise that was pressed, not the one the session is on", async () => {
      // The failure this shape has to rule out. `currentEx` is derived whether
      // or not a session has been entered, so a sheet that read from it rather
      // than from the pressed row would show the first exercise under the
      // second's name — silently, and only for rows other than the first.
      const user = userEvent.setup();

      render(
        view({
          sessions: [
            {
              ...CIRCUIT,
              exercises: CIRCUIT.exercises.map((exercise, index) =>
                index === 1 ? { ...exercise, media: MEDIA } : exercise,
              ),
            },
            WALK,
          ],
        }),
      );

      await user.click(
        await list().findByRole("button", { name: /Show sets for.*Reverse lunges/ }),
      );
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Show form" }),
      );

      expect(await screen.findByText("Form · Reverse lunges")).toBeTruthy();
    });

    test("a bookend row opens its reference directly, and without one offers nothing", async () => {
      // § P10 offers set logging on the working section only, so a warm-up row
      // has no sets to open — its door is still FUEL-108's, straight to the
      // reference. The cool-down here has none, so its row stays inert.
      const user = userEvent.setup();

      render(
        view({
          sessions: [
            {
              ...SECTIONED,
              exercises: SECTIONED.exercises.map((exercise) =>
                exercise.id === "u1" ? { ...exercise, media: MEDIA } : exercise,
              ),
            },
            WALK,
          ],
        }),
      );

      expect(list().queryByRole("button", { name: /Show sets for.*Joint prep/ })).toBeNull();
      expect(list().queryByRole("button", { name: /Lower-body stretches/ })).toBeNull();

      await user.click(
        await list().findByRole("button", { name: /Show form for.*Joint prep/ }),
      );

      expect(await screen.findByRole("dialog", { name: "Form · Joint prep" })).toBeTruthy();
    });

    test("a request made in one state does not answer in the other", async () => {
      /*
       * The resurrection bug, and the reason `FormRequest` carries `from`.
       *
       * Storing an id alone was FUEL-94's design and it was right while ONE
       * state could open the sheet: advancing past an exercise stopped the id
       * matching `currentEx`, the sheet unmounted, and nothing had to be kept
       * in sync. With two states the same close stopped clearing anything —
       * the id survived, and the plan state's lookup would find it and reopen
       * a sheet the reader had already watched close.
       *
       * Driven through the storage subscription rather than by clicking,
       * because that is a real path (`subscribeToStorage` exists so a session
       * entered or left in another tab is not a stale composition here) and
       * because the sheet is `aria-modal`, so the controls that would leave the
       * session are not reachable by a role query while it is open.
       */
      const user = userEvent.setup();
      resumed();

      render(view({ sessions: withMedia() }));

      await user.click(await screen.findByRole("button", { name: "Show form" }));
      expect(await screen.findByRole("dialog")).toBeTruthy();

      // Another tab leaves the session. `inSession` flips underneath the sheet.
      window.localStorage.removeItem(`fuel:training-session:${TODAY}`);
      window.dispatchEvent(new StorageEvent("storage"));

      // The session's request is retired with the session. Before `from`, the
      // plan state's lookup found the same exercise and this stayed open.
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });

    test("is offered on a past date, where a session cannot be started", async () => {
      // `canEnter` gates STARTING a session — a claim about what can be
      // performed now. How a movement is done is not a claim about today, so
      // the reference is not gated with it, and neither is the record.
      const user = userEvent.setup();

      render(view({ sessions: withMedia(), date: "2026-08-31", today: "2026-09-07" }));

      expect(bar().queryByRole("button", { name: "Start session" })).toBeNull();

      await user.click(
        await list().findByRole("button", { name: /Show sets for.*Press-ups/ }),
      );
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Show form" }),
      );

      expect(await screen.findByRole("dialog", { name: "Form · Press-ups" })).toBeTruthy();
    });
  });

  test("reveals the media, its description and its attribution", async () => {
    const user = await start();
    await user.click(screen.getByRole("button", { name: "Show form" }));

    // The sheet is lazy, so it arrives on a later frame than the click.
    const sheet = await screen.findByRole("dialog");

    /*
     * BOTH frames, in order — FUEL-107. A movement needs a start and a working
     * position, and asserting only that "an image rendered" would pass against
     * the single still this ticket exists to replace.
     */
    const images = within(sheet).getAllByRole("img");
    expect(images).toHaveLength(MEDIA.frames.length);

    for (const [i, frame] of MEDIA.frames.entries()) {
      const image = images[i]!;
      expect(image.getAttribute("src")).toBe(frame.path);
      expect(image.getAttribute("alt")).toBe(frame.label);
      expect(image.getAttribute("loading")).toBe("lazy");
      // Reserved before it loads, or the sheet reflows as each one arrives.
      expect(image.getAttribute("width")).toBe(String(frame.width));
      expect(image.getAttribute("height")).toBe(String(frame.height));
    }

    // Each frame says which moment it is, under the photograph.
    for (const frame of MEDIA.frames) {
      expect(within(sheet).getByText(`/ ${frame.label}`)).toBeTruthy();
    }

    // The description is CONTENT, not only an alt — § Accessibility's "a mark
    // on a screen is not the data", which media is the strongest case of.
    expect(within(sheet).getByText(MEDIA.alt)).toBeTruthy();

    // Attribution is the licence's condition, so it renders with its link.
    expect(within(sheet).getByText(/A Photographer · CC BY-SA 3\.0/)).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Licence" }).getAttribute("href")).toBe(
      MEDIA.licence.url,
    );
  });

  test("names the exercise it is about", async () => {
    const user = await start();
    await user.click(screen.getByRole("button", { name: "Show form" }));

    // One string for the visible title and the accessible name — ui/sheet.tsx's
    // rule. The subject is the exercise, so the sheet says which.
    expect(await screen.findByRole("dialog", { name: /Press-ups/ })).toBeTruthy();
  });

  test("a clip is muted, playsinline, looping and preloads nothing", async () => {
    // No clip ships with FUEL-94, so this fixture is the only thing standing
    // between the `video` kind and a column whose value nothing renders — and
    // between the ticket's muted/playsinline criterion and being vacuously true.
    const user = userEvent.setup();

    render(
      view({
        sessions: [
          {
            ...CIRCUIT,
            exercises: CIRCUIT.exercises.map((exercise, index) =>
              index === 0
                ? {
                    ...exercise,
                    media: {
                      ...MEDIA,
                      kind: "video" as const,
                      frames: [
                        {
                          path: "/form/side-plank.mp4",
                          width: 850,
                          height: 567,
                          label: "The movement",
                        },
                      ],
                    },
                  }
                : exercise,
            ),
          },
          WALK,
        ],
      }),
    );
    await user.click(bar().getByRole("button", { name: "Start session" }));
    await user.click(screen.getByRole("button", { name: "Show form" }));

    const sheet = await screen.findByRole("dialog");
    const video = sheet.querySelector("video");

    expect(video).not.toBeNull();
    expect(video!.getAttribute("src")).toBe("/form/side-plank.mp4");
    expect(video!.hasAttribute("muted") || video!.muted).toBe(true);
    expect(video!.hasAttribute("playsinline")).toBe(true);
    expect(video!.hasAttribute("loop")).toBe(true);
    expect(video!.getAttribute("preload")).toBe("none");
    // "A clip that starts talking in a gym is a bug" — and this one does not
    // start at all; see form-media-sheet.tsx on why not merely muted.
    expect(video!.hasAttribute("autoplay")).toBe(false);
    // The description still reaches a screen reader, which `alt` does not do
    // for a <video>.
    expect(video!.getAttribute("aria-label")).toBe(MEDIA.alt);
  });

  test("closes when the exercise underneath it changes", async () => {
    /*
     * The state is keyed to the exercise id rather than being a boolean, and
     * this is the failure that motivates it: the subject is derived from the
     * sets, so completing an exercise advances it on the same frame. A boolean
     * would leave the sheet open over the NEXT exercise, showing one movement
     * under another one's name.
     *
     * The change arrives as PROPS rather than as a click, and it has to: while
     * the sheet is open `aria-modal` hides the page behind it, so no control on
     * this screen can advance the subject. What can is the server — a
     * revalidation landing with sets logged elsewhere, or the same session open
     * on a second device — which reaches this component as a new `sessions`
     * array under an already-open sheet. That is the case a boolean gets wrong,
     * and the only one that can actually occur.
     *
     * BOTH exercises carry media, and that is what makes this test about the
     * id-keying rather than about something else. The sheet is also gated on
     * `currentEx.media`, so if the next exercise had none it would unmount for
     * that reason and a plain boolean would pass — which is exactly what
     * happened to the first draft of this test. With media on both, the only
     * thing that can close it is the subject's identity changing.
     */
    const user = userEvent.setup();
    const sessions = (sets: ReturnType<typeof set>[]) => [
      {
        ...CIRCUIT,
        exercises: CIRCUIT.exercises.map((exercise, index) =>
          index === 0 || index === 1 ? { ...exercise, media: MEDIA } : exercise,
        ),
        sets,
      },
      WALK,
    ];

    resumed();
    const { rerender } = render(view({ sessions: sessions([]) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press-ups");

    await user.click(screen.getByRole("button", { name: "Show form" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    // Press-ups' set 1 lands underneath the open sheet, and in a circuit that
    // is enough (FUEL-119): the subject becomes Reverse lunges — which HAS media of its own. The sheet must still close:
    // it was opened about a movement that is no longer the one on screen.
    rerender(view({ sessions: sessions([set("e1", 1)]) }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveProperty(
      "textContent",
      "Reverse lunges",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // And the affordance is still offered, because the new subject has media
    // too — which is what says the sheet closed on identity rather than on the
    // media going away.
    expect(screen.getByRole("button", { name: "Show form" })).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-127 — a session's sets, from the plan row, on any date                */
/* -------------------------------------------------------------------------- */

describe("the sets sheet", () => {
  const PAST = "2026-08-17"; // the Monday before TODAY

  /** The circuit on a past date, with two sets of press-ups on record. */
  const past = (sets: ReturnType<typeof set>[] = [set("e1", 1, 10), set("e1", 2, 9)]) =>
    view({
      date: PAST,
      today: TODAY,
      sessions: [
        {
          ...CIRCUIT,
          entry: { status: "done", note: "Felt strong.", durationMin: 30 },
          sets,
        },
        WALK,
      ],
    });

  const open = async (user: ReturnType<typeof userEvent.setup>, name = "Press-ups") => {
    await user.click(
      await list().findByRole("button", { name: new RegExp(`Show sets for.*${name}`) }),
    );

    return within(await screen.findByRole("dialog", { name: `Sets · ${name}` }));
  };

  test("reads a past session's reps, which nothing in the app could before", async () => {
    // The first acceptance criterion. Before FUEL-127 the plan row said
    // `/ 2 of 3 sets` and the numbers themselves reached only the export.
    const user = userEvent.setup();

    render(past());

    const sheet = await open(user);

    expect(
      (sheet.getByRole("textbox", { name: "Set 1 reps" }) as HTMLInputElement).value,
    ).toBe("10");
    expect(
      (sheet.getByRole("textbox", { name: "Set 2 reps" }) as HTMLInputElement).value,
    ).toBe("9");
    expect(
      (sheet.getByRole("textbox", { name: "Set 3 reps" }) as HTMLInputElement).value,
    ).toBe("");
    // The one still missing is on offer, as the session state offers it.
    expect(sheet.getByRole("button", { name: "Log set 3" })).toBeTruthy();
  });

  test("adds a set to the past date, addressed to that date", async () => {
    const user = userEvent.setup();

    render(past());

    const sheet = await open(user);

    await user.click(sheet.getByRole("button", { name: "Log set 3" }));

    await waitFor(() =>
      expect(logExerciseSet).toHaveBeenCalledWith({
        date: PAST,
        entryId: CIRCUIT.entryId,
        exerciseId: "e1",
        setIndex: 3,
        value: 12,
      }),
    );
  });

  test("corrects a logged number when the box loses focus", async () => {
    // The session state's rule, because it is the session state's component:
    // a logged row commits a changed number on blur, an unlogged one does not.
    const user = userEvent.setup();

    render(past());

    const sheet = await open(user);
    const box = sheet.getByRole("textbox", { name: "Set 1 reps" });

    await user.clear(box);
    await user.type(box, "8");
    await user.tab();

    await waitFor(() =>
      expect(logExerciseSet).toHaveBeenCalledWith(
        expect.objectContaining({ date: PAST, exerciseId: "e1", setIndex: 1, value: 8 }),
      ),
    );
  });

  test("removes a set by untapping it", async () => {
    const user = userEvent.setup();
    // Held, so the optimistic row is observed while the server is still out —
    // a mock that resolves at once reverts it to the fixture before `findBy`.
    const held = deferred<{ ok: true }>();
    removeExerciseSet.mockReturnValue(held.promise);

    render(past());

    const sheet = await open(user);

    await user.click(sheet.getByRole("button", { name: "Remove set 2" }));

    // Optimistic, so the row is open again before the server answers.
    expect(await sheet.findByRole("button", { name: "Log set 2" })).toBeTruthy();
    expect(removeExerciseSet).toHaveBeenCalledWith({
      date: PAST,
      entryId: CIRCUIT.entryId,
      exerciseId: "e1",
      setIndex: 2,
    });

    held.settle({ ok: true });
  });

  test("leaves the session's status, note and duration alone", async () => {
    // A set edit is `logExerciseSet` or `removeExerciseSet` and nothing else.
    // The record was marked done with a note and a duration, and none of the
    // three writes that could change it may be reached from this sheet.
    const user = userEvent.setup();

    render(past());

    const sheet = await open(user);

    await user.click(sheet.getByRole("button", { name: "Log set 3" }));
    await user.click(sheet.getByRole("button", { name: "Remove set 1" }));

    await waitFor(() => expect(removeExerciseSet).toHaveBeenCalledOnce());
    expect(logExerciseSet).toHaveBeenCalledOnce();
    expect(setSessionStatus).not.toHaveBeenCalled();
    expect(clearSessionStatus).not.toHaveBeenCalled();
  });

  test("reports a refused set inside the sheet, where the reader is", async () => {
    // The bar's banner is behind an `aria-modal` panel, so a refusal reported
    // only there would be reported to nobody.
    const user = userEvent.setup();
    logExerciseSet.mockResolvedValue({ ok: false });

    render(past());

    const sheet = await open(user);

    await user.click(sheet.getByRole("button", { name: "Log set 3" }));

    expect((await sheet.findByRole("alert")).textContent).toContain(
      "Couldn’t save that set.",
    );
  });

  test("never makes a past date a session state", async () => {
    // "Only today has one" stands: the record is corrected here, and the
    // session is still never started on Thursday for Tuesday.
    const user = userEvent.setup();

    render(past());
    await open(user);

    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  test("is today's plan state's door too, and entering the session closes it", async () => {
    // The row does the same thing on every date. Once the session is entered
    // the sub-list is the session state's, and two editors of one set on one
    // screen would be one too many — so the request answers with nothing.
    const user = userEvent.setup();

    render(view());
    await open(user);

    resumed();
    window.dispatchEvent(new StorageEvent("storage"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  test("stays closed when the session is left again — the request is retired, not hidden", async () => {
    // FUEL-108's resurrection bug, which `FormRequest` exists to rule out for
    // the form sheet. A request that entering only HID would survive the
    // session and reopen this sheet, unasked, the moment it ended.
    const user = userEvent.setup();

    render(view());
    await open(user);

    resumed();
    window.dispatchEvent(new StorageEvent("storage"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    window.localStorage.removeItem(`fuel:training-session:${TODAY}`);
    window.dispatchEvent(new StorageEvent("storage"));

    // Back in the plan state, which is what makes the absence mean something.
    // (Two copies of the bar in the plan state, one per position — FUEL-118.)
    expect(
      await screen.findAllByRole("button", { name: "Start session" }),
    ).not.toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("starts no rest, which is the session state's and not the record's", async () => {
    // FUEL-126 starts a circuit's rest on a newly logged set. Correcting a
    // record is not training, so the plan state's sheet must not start one.
    const user = userEvent.setup();

    render(view());

    const sheet = await open(user);

    await user.click(sheet.getByRole("button", { name: "Log set 1" }));
    await waitFor(() => expect(logExerciseSet).toHaveBeenCalledOnce());

    // `rest-timer.tsx` mirrors a running rest to this key, and the session
    // state's own log in a circuit writes it (FUEL-126's tests).
    expect(window.localStorage.getItem("fuel:rest-timer")).toBeNull();
  });
});

describe("the recap of a recorded session — FUEL-128", () => {
  /**
   * What finishing leaves on the screen. Not a state and not a sheet: the
   * sets list added to `This session`, which already held the other four
   * facts. So most of these assert that the five sit together, and the rest
   * assert what the recap is forbidden to say.
   */

  const DONE = { status: "done" as const, note: "Felt strong", durationMin: 30 };

  /** The `This session` section, found by its eyebrow. */
  const thisSession = () => {
    const section = screen.getByRole("heading", { name: "This session" }).closest("section");

    if (!section) throw new Error("This session is not a section");

    return within(section);
  };

  const recap = () => thisSession().getByRole("list", { name: "Sets" });

  const rows = () =>
    within(recap())
      .getAllByRole("listitem")
      .map((row) => row.textContent);

  test("holds the sets per exercise, the duration, the note and the estimate in one place", () => {
    render(
      view({
        sessions: [
          {
            ...CIRCUIT,
            entry: DONE,
            sets: [set("e1", 1, 12), set("e1", 2, 12), set("e1", 3, 10), set("e2", 1, 8)],
          },
          WALK,
        ],
      }),
    );

    expect(rows()).toEqual(["Press-ups12 · 12 · 10 reps", "Reverse lunges8 reps"]);
    expect(thisSession().getByRole("status").textContent).toBe("Done · 30 min");
    expect(thisSession().getByText(/^Estimated \d+–\d+ kcal$/)).toBeTruthy();
    expect(thisSession().getByLabelText<HTMLTextAreaElement>("Note").value).toBe("Felt strong");
    expect(thisSession().getByLabelText<HTMLInputElement>("Duration").value).toBe("30");
  });

  test("appears on the frame Mark done is tapped, before the server answers", async () => {
    // The criterion's "after finishing today's session": from the session
    // state, whose sets are the optimistic ones, into the plan state.
    const user = userEvent.setup();
    const pending = deferred<{ ok: boolean }>();

    setSessionStatus.mockReturnValue(pending.promise);
    resumed();
    render(view({ sessions: withSets([set("e1", 1, 12), set("e1", 2, 11)]) }));

    await user.click(bar().getByRole("button", { name: "Mark done" }));

    const list = await screen.findByRole("list", { name: "Sets" });

    expect(within(list).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Press-ups12 · 11 reps",
    ]);

    pending.settle({ ok: true });
    await waitFor(() => expect(setSessionStatus).toHaveBeenCalledOnce());
  });

  test("never counts sets against a target, anywhere in the section", () => {
    // § P10: no percentage, ratio or score from set completion. The rows'
    // `3 of 3 sets` is exactly such a ratio, and it belongs to the list; the
    // recap reads the values back and nothing else. An extra fourth set is a
    // fourth value, not "4 of 3".
    render(
      view({
        sessions: [
          {
            ...CIRCUIT,
            entry: DONE,
            sets: [set("e1", 1), set("e1", 2), set("e1", 3), set("e1", 4)],
          },
          WALK,
        ],
      }),
    );

    const text = screen
      .getByRole("heading", { name: "This session" })
      .closest("section")?.textContent;

    expect(rows()).toEqual(["Press-ups12 · 12 · 12 · 12 reps"]);
    expect(text).not.toMatch(/\d+ of \d+/);
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(text).not.toMatch(/completed|score|best|beat/i);
  });

  test("keeps the estimate a labelled range, never netted against intake", () => {
    render(view({ sessions: [{ ...CIRCUIT, entry: DONE, sets: [set("e1", 1)] }, WALK] }));

    const text = screen
      .getByRole("heading", { name: "This session" })
      .closest("section")?.textContent;

    expect(text).toMatch(/Estimated \d+–\d+ kcal/);
    expect(text).not.toMatch(/earned|eaten|left|remaining|net/i);
  });

  test("names the unit a timed hold was done in — FUEL-123", () => {
    render(
      view({
        sessions: [
          {
            ...CIRCUIT,
            type: "intervals",
            exercises: [TIMED_HOLD],
            sets: [set("e4", 1, 45), set("e4", 2, 40)],
            entry: DONE,
          },
          WALK,
        ],
      }),
    );

    expect(rows()).toEqual(["Plank45 · 40 sec"]);
  });

  test("is drawn from the record, so it is there after a reload and on a past date", () => {
    // Nothing the tap stored: a fresh render from the server's sets and entry
    // is what a reload is, and yesterday is the same render with another date.
    render(
      view({
        date: YESTERDAY,
        sessions: [{ ...CIRCUIT, entry: DONE, sets: [set("e2", 1, 9)] }, WALK],
      }),
    );

    expect(rows()).toEqual(["Reverse lunges9 reps"]);
  });

  test("leaves out an exercise nobody did, and a warm-up, which logs none", () => {
    render(
      view({
        sessions: [
          {
            ...CIRCUIT,
            exercises: [
              { ...TIMED_HOLD, id: "w1", name: "Arm circles", section: "warmup" },
              ...CIRCUIT.exercises,
            ],
            entry: DONE,
            // A set against the warm-up is unreachable through the screen, and
            // is here to prove the recap does not read one if the data has it.
            sets: [set("w1", 1, 20), set("e3", 1, 45)],
          },
          WALK,
        ],
      }),
    );

    expect(rows()).toEqual(["Plank45 reps"]);
  });

  test("draws no sets list for a session recorded with no sets", () => {
    // Skipped, nothing logged: the status line says what happened, and an
    // empty "Sets" heading would be an absence reported as a thing.
    render(
      view({
        sessions: recorded({ status: "skipped", note: null, durationMin: null }),
      }),
    );

    expect(thisSession().getByRole("status").textContent).toBe("Skipped");
    expect(screen.queryByRole("list", { name: "Sets" })).toBeNull();
    expect(screen.queryByText("Sets")).toBeNull();
  });

  test("leaves the status, the note and the duration editable beside it", async () => {
    const user = userEvent.setup();

    render(view({ sessions: [{ ...CIRCUIT, entry: DONE, sets: [set("e1", 1)] }, WALK] }));

    expect(recap()).toBeTruthy();

    await user.clear(thisSession().getByLabelText("Duration"));
    await user.type(thisSession().getByLabelText("Duration"), "35");
    await user.click(bar().getByRole("button", { name: "Partial" }));

    expect(setSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "partial", note: "Felt strong", durationMin: "35" }),
    );
  });

  test("moves the phone's list rather than remounting it when a record arrives", () => {
    // A first set logged from the sets sheet creates a `partial` record and
    // refreshes, with the sheet still up. A remounted list would disconnect the
    // row that opened it, and the sheet would hand focus back to <body>.
    const { rerender } = render(view());
    const before = document.querySelector('[data-list="phone"]');

    rerender(view({ sessions: recorded({ status: "partial", note: null, durationMin: null }) }));

    expect(before).not.toBeNull();
    expect(document.querySelector('[data-list="phone"]')).toBe(before);
    expect(before?.isConnected).toBe(true);
  });

  test("leads the phone's screen once recorded, and not before", () => {
    // Below 1024 the list is under the session until there is a record, then
    // under `This session` — the order the measure has read in from 1024 since
    // FUEL-118. One phone copy either way, never two.
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    const phoneLists = () => document.querySelectorAll('[data-list="phone"]');
    const phoneList = () => {
      const [only] = phoneLists();

      if (!only) throw new Error("no phone copy of the list is rendered");

      return only;
    };
    const record = () =>
      screen.getByRole("heading", { name: "This session" }).closest("section")!;

    const { unmount } = render(view());

    expect(phoneLists()).toHaveLength(1);
    expect(follows(phoneList(), record())).toBe(true);

    unmount();
    render(view({ sessions: recorded(DONE) }));

    expect(phoneLists()).toHaveLength(1);
    expect(follows(record(), phoneList())).toBe(true);
  });
});
