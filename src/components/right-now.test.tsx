import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { RightNow } from "@/components/right-now";
import type { LoggedEntry } from "@/lib/day-summary";
import type { Meal, Workout, WorkoutExercise } from "@/lib/db/schema";
import type { MacroTarget } from "@/lib/macros";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";

/**
 * The server actions are mocked, for the reason `login/page.test.tsx` gives
 * about its own: `@/app/actions/log` is a "use server" module that imports the
 * database, `server-only` and a session, none of which resolve under the
 * hermetic jsdom suite. What is under test here is the half the browser owns —
 * that the card advances before the server has answered, that a refusal reverts
 * it and says so, and that a success says nothing at all.
 */
const logItem = vi.fn();
const undoLastLog = vi.fn();

vi.mock("@/app/actions/log", () => ({
  logItem: (...args: unknown[]) => logItem(...args),
  undoLastLog: (...args: unknown[]) => undoLastLog(...args),
}));

beforeEach(() => {
  logItem.mockReset();
  undoLastLog.mockReset();
  logItem.mockResolvedValue({ ok: true });
  undoLastLog.mockResolvedValue({ ok: true });
});

/**
 * An action held open, and the handle that lets it go.
 *
 * The optimistic cases below have to observe the screen while the server has
 * not answered, which means the action must not resolve yet. A promise that
 * NEVER resolves does that and then poisons the rest of the file: React runs
 * transitions one at a time, so a transition left pending on an unmounted tree
 * makes every later test's transition sit behind it and time out — which is a
 * failure in a test that is not the one at fault, and took a bisect to find.
 *
 * So each case resolves its own, and flushes before it ends.
 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

/**
 * P1's acceptance criteria, as assertions about what ends up on the screen.
 *
 * The component is pure — it takes a resolved `NowView` and renders it — so
 * every case below is a fixture rather than a clock, a session and a database.
 * That is the whole reason `app/page.tsx` is eight lines: the criteria are
 * about the screen, and the screen is reachable here without any of the three.
 */

const USER = "user-owner";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function meal(fields: Partial<Meal> = {}): Meal {
  return {
    id: "meal-1",
    userId: USER,
    name: "Overnight oats",
    slotType: "breakfast",
    kcal: 420,
    proteinG: 32.5,
    fatG: 12,
    carbG: 48,
    method: null,
    notes: null,
    isArchived: false,
    ...fields,
  };
}

function workout(fields: Partial<Workout> = {}): Workout {
  return {
    id: "workout-1",
    userId: USER,
    name: "Circuit A",
    type: "circuit",
    description: null,
    rotationGroup: null,
    rotationIndex: null,
    ...fields,
  };
}

function exercise(fields: Partial<WorkoutExercise> & { id: string }): WorkoutExercise {
  return {
    userId: USER,
    workoutId: "workout-1",
    name: "Press-ups",
    prescription: "3 x 12",
    sortOrder: 0,
    notes: null,
    ...fields,
  };
}

const mealItem = (fields: Partial<Meal> = {}, slot: Meal["slotType"] = "breakfast"): NowItem => ({
  kind: "meal",
  meal: { slot, meal: meal(fields), source: "template", entryId: "entry-1" },
});

const workoutItem = (fields: Partial<Workout> = {}): NowItem => ({
  kind: "workout",
  workout: { workout: workout(fields), source: "fixed", entryId: "entry-2" },
});

const at = (item: NowItem, key: string, time: string, minutes: number): ScheduledItem => ({
  ...item,
  key,
  at: time,
  minutes,
});

const BREAKFAST = at(mealItem(), "meal:e1", "07:00", 420);
const LUNCH = at(mealItem({ id: "meal-2", name: "Chicken salad" }, "lunch"), "meal:e2", "13:00", 780);
const SESSION = at(workoutItem(), "workout:e3", "17:30", 1050);
const DINNER = at(mealItem({ id: "meal-3", name: "Chilli" }, "dinner"), "meal:e4", "19:00", 1140);

const WALK: AnytimeItem = { ...workoutItem({ id: "workout-2", name: "Daily walk", type: "walk" }), key: "workout:e5" };

const TIMELINE = [BREAKFAST, LUNCH, SESSION, DINNER];

/**
 * A Monday at 08:00, with breakfast, lunch, a session and dinner on it.
 *
 * Not `as const`: `NowView`'s arrays are mutable, and a readonly fixture cannot
 * be spread into one.
 */
const BASE = {
  date: "2026-03-09",
  minutesOfDay: 8 * 60,
  timeline: TIMELINE,
  anytime: [WALK],
};

/** An active view, positioned at `index` in the timeline. */
function active(index: number, overrides: Partial<NowView> = {}): NowView {
  return {
    ...BASE,
    state: "active",
    index,
    active: TIMELINE[index]!,
    upcoming: TIMELINE.slice(index + 1),
    ...overrides,
  } as NowView;
}

const EXERCISES = new Map<string, WorkoutExercise[]>([
  [
    "workout-1",
    [
      exercise({ id: "ex-1", name: "Press-ups", prescription: "3 x 12" }),
      exercise({ id: "ex-2", name: "Squats", prescription: "3 x 15", sortOrder: 1 }),
      exercise({
        id: "ex-3",
        name: "Mountain climbers",
        prescription: "30s on / 30s off",
        sortOrder: 2,
        notes: "Keep the hips level",
      }),
    ],
  ],
]);

/**
 * Invented targets — Testing Strategy § 1.5. Round numbers, so a delta in an
 * assertion is obviously the subtraction under test rather than a coincidence.
 */
const TARGET: MacroTarget = {
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbG: 200,
};

/** One line of the day's log, as `dayLog` would have produced it. */
const entry = (fields: Partial<LoggedEntry> & { id: string }): LoggedEntry => ({
  name: "Overnight oats",
  status: "eaten",
  ...fields,
});

const renderNow = (
  view: NowView,
  exercises: ReadonlyMap<string, WorkoutExercise[]> = EXERCISES,
  /** The day's log so far — what the summary prints, and what undo takes back. */
  entries: LoggedEntry[] = [],
) => (
  render(<RightNow view={view} exercises={exercises} entries={entries} target={TARGET} />)
);

/** A day's log of `count` lines, for the cases that only care that there is one. */
const someLogs = (count: number) =>
  Array.from({ length: count }, (_, index) => entry({ id: `log-${index}` }));

/* -------------------------------------------------------------------------- */
/* The active card                                                            */
/* -------------------------------------------------------------------------- */

describe("the active meal", () => {
  test("names the meal as the heading, with its slot and time", () => {
    renderNow(active(0));

    // "The card shows meal name, kcal, and P/F/C for a meal" — the name is the
    // 40px subject, and it is the page's h1 because it is the answer to the
    // question the screen exists to answer.
    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading.textContent).toBe("Overnight oats");

    // Scoped to the header. "07:00" also appears in the ruler's accessible data
    // table, which is the graphic's own obligation and not this assertion's.
    const subject = heading.closest("header");

    expect(within(subject!).getByText("Breakfast")).toBeDefined();
    expect(within(subject!).getByText("07:00")).toBeDefined();
  });

  test("shows kcal and P/F/C", () => {
    const { container } = renderNow(active(0));

    const macros = container.querySelector("dl");

    expect(macros).not.toBeNull();
    expect(within(macros!).getByText("Calories")).toBeDefined();
    expect(within(macros!).getByText("420")).toBeDefined();
    expect(within(macros!).getByText("32.5 g")).toBeDefined();
    expect(within(macros!).getByText("12 g")).toBeDefined();
    expect(within(macros!).getByText("48 g")).toBeDefined();
  });

  test("emphasises protein by weight, not colour", () => {
    // Brand Guide § Typography — "protein stays emphasised by weight, not
    // colour", because colour is spoken for by the accent.
    renderNow(active(0));

    expect(screen.getByText("32.5 g").className).toContain("font-bold");
    expect(screen.getByText("48 g").className).not.toContain("font-bold");
  });

  test("renders no exercise list", () => {
    renderNow(active(0));

    expect(screen.queryByText("3 x 12")).toBeNull();
  });
});

describe("the active session", () => {
  test("names the workout and lists every exercise in order", () => {
    // "workout name and full exercise list for a training session" — full, so
    // the assertion is on the whole list rather than on its first row.
    renderNow(active(2));

    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading.textContent).toBe("Circuit A");
    // Scoped: the walk in "Anytime" is a session too, and carries the same
    // eyebrow.
    expect(within(heading.closest("header")!).getByText("Training")).toBeDefined();

    const rows = screen.getAllByRole("listitem").filter((row) => row.closest("ol") !== null);

    expect(rows.map((row) => row.textContent)).toEqual([
      "01Press-ups3 x 12",
      "02Squats3 x 15",
      "03Mountain climbers/ Keep the hips level30s on / 30s off",
    ]);
  });

  test("renders the prescription verbatim", () => {
    // `workout_exercises.prescription` is "displayed verbatim, never parsed".
    renderNow(active(2));

    expect(screen.getByText("30s on / 30s off")).toBeDefined();
  });

  test("renders no slash mark for an empty note", () => {
    // `notes` is nullable text with no length constraint, so "" is storable.
    // A bare "/ " reads as a note that failed to load.
    renderNow(
      active(2),
      new Map([["workout-1", [exercise({ id: "ex-1", name: "Press-ups", notes: "" })]]]),
    );

    const row = screen.getAllByRole("listitem").find((item) => item.closest("ol") !== null);

    expect(row?.textContent).toBe("01Press-ups3 x 12");
  });

  test("says so when a workout has no exercises", () => {
    // The daily walk is exactly this: a real workout row with no children.
    renderNow(active(2), new Map());

    expect(screen.getByText("No exercises listed.")).toBeDefined();
  });

  test("renders no macro grid", () => {
    renderNow(active(2));

    expect(screen.queryByRole("term", { name: "Calories" })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The rest of the day                                                        */
/* -------------------------------------------------------------------------- */

describe("up next", () => {
  test("lists the next two items with their scheduled times", () => {
    renderNow(active(0));

    const list = screen.getByRole("heading", { name: "Up next" }).nextElementSibling;

    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getByText("Chicken salad")).toBeDefined();
    expect(within(list as HTMLElement).getByText("13:00")).toBeDefined();
    expect(within(list as HTMLElement).getByText("Circuit A")).toBeDefined();
    expect(within(list as HTMLElement).getByText("17:30")).toBeDefined();
  });

  test("shows two and no more, however many remain", () => {
    renderNow(active(0));

    const list = screen.getByRole("heading", { name: "Up next" }).nextElementSibling;

    expect(within(list as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
    // Three items follow breakfast; the third is not one of them.
    expect(within(list as HTMLElement).queryByText("Chilli")).toBeNull();
  });

  test("is absent on the last item of the day", () => {
    renderNow(active(3));

    expect(screen.queryByRole("heading", { name: "Up next" })).toBeNull();
  });
});

describe("anytime items", () => {
  test("offers the walk alongside the active card, never as it", () => {
    renderNow(active(0));

    const list = screen.getByRole("heading", { name: "Anytime" }).nextElementSibling;

    expect(within(list as HTMLElement).getByText("Daily walk")).toBeDefined();
    // Alongside — not the subject.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overnight oats");
  });

  test("is absent when nothing is loggable whenever", () => {
    renderNow(active(0, { anytime: [] }));

    expect(screen.queryByRole("heading", { name: "Anytime" })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The day ruler                                                              */
/* -------------------------------------------------------------------------- */

describe("the day ruler", () => {
  test("marks the day's shape and puts NOW at the clock", () => {
    renderNow(active(0));

    const ruler = screen.getByRole("img");

    // The ruler's accessible summary is built from the same array as its marks.
    expect(ruler.getAttribute("aria-label")).toContain("4 slots");
    expect(ruler.getAttribute("aria-label")).toContain("Now 08:00");
    expect(within(ruler).getByText("Now")).toBeDefined();
  });

  test("positions NOW from the clock, not from the active item", () => {
    // 08:00 on a 06:00–22:00 span is 12.5% along. The active item is breakfast
    // at 07:00, which is 6.25% — so a marker placed from the item rather than
    // the clock would land here instead.
    renderNow(active(0));

    // The accent RULE, not its pill. The pill's position is clamped so it
    // cannot hang outside the ruler near either end; the rule is unclamped, so
    // it is the one that marks the precise moment. See day-ruler.tsx on
    // `NOW_PILL_HALF`.
    const rule = screen
      .getByRole("img")
      .querySelector('[class*="bg-accent"]:not([class*="rounded-full"])');

    expect(rule).not.toBeNull();
    expect(rule!.getAttribute("style")).toContain("12.5%");
  });

  test("is left off the finished page", () => {
    // The ruler answers "where am I in the day?", and the day-complete summary
    // is the one state where that question has no live answer. § Materials
    // frames it as a closed page — the Brand Guide's own mock of it carries no
    // ruler — so the graphic stops here rather than being drawn out of habit.
    renderNow({ ...BASE, state: "day-complete" });

    expect(screen.queryByRole("img")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The two quiet states                                                       */
/* -------------------------------------------------------------------------- */

describe("day-complete", () => {
  /** A day where three things were logged and one of them was skipped. */
  const LOGGED: LoggedEntry[] = [
    entry({
      id: "l1",
      name: "Overnight oats",
      macros: { kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 },
    }),
    entry({ id: "l2", name: "Greek yoghurt", status: "skipped" }),
    entry({ id: "l3", name: "Circuit A", status: "done" }),
    entry({
      id: "l4",
      name: "Beef chilli",
      macros: { kcal: 1024, proteinG: 68.3, fatG: 34.1, carbG: 82.5 },
    }),
  ];

  const summary = (entries: LoggedEntry[] = LOGGED) =>
    renderNow({ ...BASE, state: "day-complete" }, EXERCISES, entries);

  test("reports the day as complete, and offers nothing to log", () => {
    summary();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Day complete");
    // Nothing is active, so there is nothing to log, swap or skip. The only
    // control this screen can carry is undo, and only when there is a log to
    // take back — see the undo suite below.
    expect(screen.queryByRole("button", { name: "Log eaten" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });

  test("shows what the day actually came to", () => {
    summary();

    // Eaten only: the skipped yoghurt and the session contribute nothing, which
    // is the difference between this figure and a planned total. 486 + 1024,
    // grouped as the brand voice writes it.
    expect(screen.getByText("1,510")).toBeDefined();
    expect(screen.getByText("kcal")).toBeDefined();
  });

  test("shows actual against target for all three macros, with signed deltas", () => {
    const { container } = summary();

    const figures = container.querySelector("dl");

    // 32.5 + 68.3 = 100.8 against 150; 11.8 + 34.1 = 45.9 against 60;
    // 58.2 + 82.5 = 140.7 against 200.
    expect(within(figures!).getByText("100.8 g")).toBeDefined();
    expect(within(figures!).getByText(/of 150 · −49.2/)).toBeDefined();
    expect(within(figures!).getByText("45.9 g")).toBeDefined();
    expect(within(figures!).getByText(/of 60 · −14.1/)).toBeDefined();
    expect(within(figures!).getByText("140.7 g")).toBeDefined();
    expect(within(figures!).getByText(/of 200 · −59.3/)).toBeDefined();

    // And kcal, whose target is the value and whose delta is the metadata,
    // because the actual figure is already the largest thing on the screen.
    expect(within(figures!).getByText("2,000")).toBeDefined();
    expect(within(figures!).getByText("−490")).toBeDefined();
  });

  test("writes the delta with the brand's minus sign, not a hyphen", () => {
    // § Voice writes the convention as `−21`, never "21 under", and the glyph
    // is U+2212 — the one that lines up under tabular figures.
    summary();

    expect(screen.getByText("−490").textContent).toBe("\u2212490");
  });

  test("marks an over-target day in error, and only on kcal", () => {
    // § Voice: `+220 kcal` in `error`, against `−8g protein` in text-secondary.
    // Over target on protein is the day going well; a rule that painted every
    // positive delta red would report a good day as a fault.
    const { container } = summary([
      entry({
        id: "l1",
        macros: { kcal: 2200, proteinG: 200, fatG: 60, carbG: 200 },
      }),
    ]);

    expect(screen.getByText("+200").className).toContain("text-error");

    const protein = within(container.querySelector("dl")!).getByText(/of 150 · \+50/);

    expect(protein.className).not.toContain("text-error");
  });

  test("emphasises protein by weight, as everywhere else", () => {
    summary();

    expect(screen.getByText("100.8 g").className).toContain("font-bold");
    expect(screen.getByText("45.9 g").className).not.toContain("font-bold");
  });

  test("lists the day's logged items with their status", () => {
    summary();

    const logged = screen.getByRole("list");

    expect(
      within(logged).getAllByRole("listitem").map((row) => row.textContent),
    ).toEqual([
      "Overnight oatsEaten",
      "Greek yoghurtSkipped",
      "Circuit ADone",
      "Beef chilliEaten",
    ]);
  });

  test("sets Skipped and Done in the same caps, differing only in weight", () => {
    // The criterion, and the guide's own caption for this screen. The mock's
    // stylesheet separates them by COLOUR instead; the caption and the
    // criterion agree with each other against it, and they are the ones that
    // state the intent — a skip is a neutral fact about the day, and greying it
    // out is the closest this screen could come to a judgement.
    summary();

    const done = screen.getByText("Done").className;
    const skipped = screen.getByText("Skipped").className;

    for (const shared of ["text-micro", "uppercase", "text-text-secondary"]) {
      expect(done).toContain(shared);
      expect(skipped).toContain(shared);
    }

    expect(skipped).toContain("font-normal");
    expect(done).not.toContain("font-normal");
  });

  test("says so when the day was walked through without logging anything", () => {
    // Reached by advancing past the last item by hand, which is the deliberate
    // "I'm done". Zero against target is the honest reading of it.
    summary([]);

    expect(screen.getByText(/Nothing was logged today/)).toBeDefined();
    expect(screen.getByText("0")).toBeDefined();
  });

  test("marks the four corners, and carries no tab bar", () => {
    const { container } = summary();

    // § Materials: crop marks at the four corners of this screen "and nowhere
    // else. The day is a finished page."
    expect(
      [...container.querySelectorAll("[data-crop]")].map((mark) => mark.getAttribute("data-crop")),
    ).toEqual(["tl", "tr", "bl", "br"]);

    // The summary owns the screen. Nothing renders navigation chrome yet, so
    // this is the assertion that fails on the day something tries to.
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("says nothing about how the day went", () => {
    // "No score, no streak, no praise anywhere on the screen." The four
    // figures and the log are the whole report.
    const { container } = summary();

    expect(container.textContent).not.toMatch(
      /streak|score|great|well done|crushed|nice work|keep it up|goal met|🎉/i,
    );
  });
});

describe("the crop marks", () => {
  test("appear on the finished page and on no other state", () => {
    // "A device used once keeps its meaning" — the reason they are worth an
    // assertion from the outside as well as from within the summary.
    const { container: active_ } = renderNow(active(0));

    expect(active_.querySelectorAll("[data-crop]")).toHaveLength(0);

    const { container: empty } = renderNow({
      ...BASE,
      state: "nothing-planned",
      timeline: [],
      anytime: [],
    });

    expect(empty.querySelectorAll("[data-crop]")).toHaveLength(0);
  });
});

describe("nothing-planned", () => {
  test("describes what will appear rather than nudging", () => {
    renderNow({ ...BASE, state: "nothing-planned", timeline: [], anytime: [] });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nothing planned");
    expect(
      // A curly apostrophe, as everywhere else in the copy — the straight one
      // is a typewriter artefact the brand voice does not use.
      screen.getByText(/appear here once the week\u2019s plan covers today/),
    ).toBeDefined();
  });

  test("drops the ruler when there is no day to draw", () => {
    renderNow({ ...BASE, state: "nothing-planned", timeline: [] });

    expect(screen.queryByRole("img")).toBeNull();
  });

  test("still offers whatever can be logged whenever", () => {
    renderNow({ ...BASE, state: "nothing-planned", timeline: [] });

    expect(screen.getByText("Daily walk")).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The actions                                                                */
/* -------------------------------------------------------------------------- */

describe("the actions", () => {
  test("a meal offers log, swap and skip", () => {
    renderNow(active(0));

    expect(screen.getByRole("button", { name: "Log eaten" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Swap" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDefined();
  });

  test("a session offers mark-done and skip, but not swap", () => {
    // A swap substitutes one meal for another from the library. A session that
    // isn't happening is a skip, not a substitution.
    renderNow(active(2));

    expect(screen.getByRole("button", { name: "Mark done" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Swap" })).toBeNull();
  });

  test("swap is the only disabled control — the meal picker is P2's", () => {
    renderNow(active(0));

    expect((screen.getByRole("button", { name: "Swap" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Log eaten" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test("the primary is ink-filled, and there is exactly one", () => {
    // Brand Guide § The Four Rules — "actions are ink, not colour", and the
    // primary is "the one action the screen exists for. One per screen."
    const { container } = renderNow(active(0));

    const primaries = container.querySelectorAll('[data-variant="default"]');

    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toBe("Log eaten");
    expect(primaries[0]?.className).toContain("bg-ink");
    expect(primaries[0]?.className).not.toContain("bg-accent");
  });

  test("stays within thumb reach however tall the content is", () => {
    // A regression, and one jsdom cannot see for itself: `mt-auto` alone put
    // the primary at y=703 in a 667px viewport on the default case — below the
    // fold, reachable only by scrolling. Measured at 375×667 on
    // /dev/right-now, which is where the criterion is actually checked.
    //
    // Asserting the mechanism is the most this suite can do, so it asserts all
    // three parts of it: pinned to the bottom, still placed by `mt-auto` when
    // the content is short, and opaque so content passing beneath it does not
    // show through.
    const { container } = renderNow(active(0));

    const bar = container.querySelector('[data-variant="default"]')?.parentElement;

    expect(bar?.className).toContain("sticky");
    expect(bar?.className).toContain("bottom-0");
    expect(bar?.className).toContain("mt-auto");
    expect(bar?.className).toContain("bg-background");
  });

  test("carries the safe-area inset itself", () => {
    // A bar pinned to `bottom: 0` sits below any padding its parent has, so the
    // inset only clears the home indicator from inside the pinned element.
    const { container } = renderNow(active(0));

    const bar = container.querySelector('[data-variant="default"]')?.parentElement;

    expect(bar?.className).toContain("safe-area-inset-bottom");
  });
});

/* -------------------------------------------------------------------------- */
/* One umber element                                                          */
/* -------------------------------------------------------------------------- */

describe("the accent", () => {
  test("appears only on the NOW marker", () => {
    // Brand Guide § The Four Rules — "one umber element per screen, and it
    // always says: you are here." On this screen that element is the day
    // ruler's NOW marker, drawn as a rule plus its pill.
    const { container } = renderNow(active(0));

    const ruler = screen.getByRole("img");
    const accented = [...container.querySelectorAll('[class*="accent"]')];

    // A positive control first: an assertion that everything accented is inside
    // the ruler passes just as happily when nothing is accented at all, which
    // would mean the marker had gone missing rather than the rule being kept.
    expect(accented.length).toBeGreaterThan(0);

    for (const element of accented) {
      expect(ruler.contains(element)).toBe(true);
    }
  });

  test("no action reaches for it", () => {
    const { container } = renderNow(active(0));

    for (const button of container.querySelectorAll("button")) {
      // The focus ring is `ring-ring`, which resolves to the accent but is not
      // a persistent element of the screen. A fill or a text colour would be.
      expect(button.className).not.toContain("bg-accent");
      expect(button.className).not.toContain("text-accent");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Logging, skipping and undo — FUEL-19                                       */
/* -------------------------------------------------------------------------- */

describe("logging the active item", () => {
  test("advances the card before the server has answered", async () => {
    // The criterion behind § Feedback's "optimistic by default": the next item
    // is on screen on the frame of the tap, not on the frame of the response.
    // The action is left hanging on purpose — nothing resolves it — so anything
    // that arrives here can only have come from the optimistic layer.
    const pending = deferred<{ ok: boolean }>();

    logItem.mockReturnValue(pending.promise);

    renderNow(active(0));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overnight oats");

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chicken salad"),
    );

    pending.settle({ ok: true });
    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());
  });

  test("sends the item's key and the verb, and nothing else", async () => {
    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    // A key, not a row. The server re-resolves the day and derives the date,
    // the slot and the meal id from its own answer — see app/actions/log.ts.
    await waitFor(() => expect(logItem).toHaveBeenCalledWith("meal:e1", "log"));
  });

  test("skip records a skip rather than a completion", async () => {
    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(logItem).toHaveBeenCalledWith("meal:e1", "skip"));
  });

  test("skip advances the card too", async () => {
    const pending = deferred<{ ok: boolean }>();

    logItem.mockReturnValue(pending.promise);

    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chicken salad"),
    );

    pending.settle({ ok: true });
    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());
  });

  test("puts the tap's own line on the summary it opens", async () => {
    // The case FUEL-20 exists to get right: logging the last item is the only
    // way to reach the summary by tapping, so a screen built from the server's
    // log alone would open missing exactly the line that opened it — and with
    // its calorie figure short by that meal — until the request came back.
    const pending = deferred<{ ok: boolean }>();

    logItem.mockReturnValue(pending.promise);

    renderNow(active(3));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() => expect(screen.getByText("Chilli")).toBeDefined());

    // Dinner's own macros, from the item that was tapped.
    expect(screen.getByText("Eaten")).toBeDefined();
    expect(screen.getByText("420")).toBeDefined();

    pending.settle({ ok: true });
    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());
  });

  test("takes the line back when the log is refused", async () => {
    // The optimistic value reverts on failure, and the summary is part of it:
    // a line left behind would be the app claiming a log the server refused.
    logItem.mockResolvedValue({ ok: false });

    renderNow(active(3));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chilli");
    expect(screen.queryByText("Eaten")).toBeNull();
  });

  test("skips the last item onto the summary as a skip", async () => {
    // Two verbs, four statuses. The word on the summary comes from `logIntent`,
    // the same call the server action makes, so a skip cannot read "Eaten" here
    // and be written as 'skipped' there.
    const pending = deferred<{ ok: boolean }>();

    logItem.mockReturnValue(pending.promise);

    renderNow(active(3));

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(screen.getByText("Skipped")).toBeDefined());

    // Skipped, so it counts for nothing: the day still reads zero.
    expect(screen.getByText("0")).toBeDefined();

    pending.settle({ ok: true });
    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());
  });

  test("marking the last item done shows the day as complete", async () => {
    // The end of the timeline is where the client could most plausibly disagree
    // with the server about what advancing means. Both go through `positionAt`.
    const pending = deferred<{ ok: boolean }>();

    logItem.mockReturnValue(pending.promise);

    renderNow(active(3));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Day complete"),
    );

    pending.settle({ ok: true });
    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());
  });

  test("says nothing at all when it works", async () => {
    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());

    // § Feedback: "Success: silent. The UI reflecting the new state IS the
    // confirmation." No toast, no banner, no status region.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("when a log fails", () => {
  test("reverts the card and says so, at the point of action", async () => {
    logItem.mockResolvedValue({ ok: false });

    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    // § Feedback: "inline banner at the point of action, value reverted, 'Try
    // again'. Never a modal." Reverted means the card the tap was made from is
    // back — not the one the tap moved to.
    const banner = await screen.findByRole("alert");

    expect(banner.textContent).toContain("Couldn’t save that.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overnight oats");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("try again re-runs the same tap", async () => {
    logItem.mockResolvedValue({ ok: false });

    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByRole("alert");

    logItem.mockResolvedValue({ ok: true });

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    // The same item and the same verb — a retry that quietly logged instead of
    // skipping would be worse than no retry at all.
    await waitFor(() => expect(logItem).toHaveBeenCalledTimes(2));
    expect(logItem.mock.calls[1]).toEqual(["meal:e1", "skip"]);
  });

  test("says so when the request itself never reaches the server", async () => {
    // Not a refused action — a rejected CALL. No signal in a kitchen, a dropped
    // connection, a cold start that times out. The action's own try/catch
    // cannot help here because the failure is on the way to it, and without a
    // catch on this side the tap would be silently undone with nothing said.
    logItem.mockRejectedValue(new Error("Failed to fetch"));

    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    const banner = await screen.findByRole("alert");

    expect(banner.textContent).toContain("Couldn’t save that.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overnight oats");
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  test("the banner clears when the next tap is made", async () => {
    logItem.mockResolvedValue({ ok: false });

    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));
    await screen.findByRole("alert");

    logItem.mockResolvedValue({ ok: true });

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("undo", () => {
  test("is not offered when nothing has been logged today", () => {
    renderNow(active(0));

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  test("is offered from the action bar once something has been", () => {
    renderNow(active(1), EXERCISES, someLogs(1));

    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  test("appears as soon as a log is made, without waiting for the server", async () => {
    const pending = deferred<{ ok: boolean }>();

    logItem.mockReturnValue(pending.promise);

    renderNow(active(0));

    await userEvent.click(screen.getByRole("button", { name: "Log eaten" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDefined());

    pending.settle({ ok: true });
    await waitFor(() => expect(logItem).toHaveBeenCalledOnce());
  });

  test("is reachable after the last item of the day, where the tap was made", () => {
    // The edge § Feedback's "from where it was performed" hides: logging the
    // final item leaves a screen with no active card, and before FUEL-19 that
    // state had no action bar for the undo to live in.
    renderNow({ ...BASE, state: "day-complete" }, EXERCISES, someLogs(1));

    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  test("steps the card back", async () => {
    const pending = deferred<{ ok: boolean }>();

    undoLastLog.mockReturnValue(pending.promise);

    renderNow(active(1), EXERCISES, someLogs(1));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chicken salad");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overnight oats"),
    );

    pending.settle({ ok: true });
    await waitFor(() => expect(undoLastLog).toHaveBeenCalledOnce());
  });

  test("says so when the undo request never reaches the server", async () => {
    undoLastLog.mockRejectedValue(new Error("Failed to fetch"));

    renderNow(active(1), EXERCISES, someLogs(1));

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t undo that.");
  });

  test("reverts and says so when it fails", async () => {
    undoLastLog.mockResolvedValue({ ok: false });

    renderNow(active(1), EXERCISES, someLogs(1));

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    const banner = await screen.findByRole("alert");

    expect(banner.textContent).toContain("Couldn’t undo that.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chicken salad");
  });
});
