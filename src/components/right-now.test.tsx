import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { APP_ACTION_BAR } from "@/components/action-bar";
import { RightNow } from "@/components/right-now";
import type { LoggedEntry } from "@/lib/day-summary";
import type { Meal, Workout, WorkoutExercise } from "@/lib/db/schema";
import type { MacroTarget } from "@/lib/macros";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";
import type { WalkEntryView } from "@/lib/walk";

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
const swapMeal = vi.fn();
const repeatMeal = vi.fn();
const revertSwap = vi.fn();
const logWalk = vi.fn();
const clearWalk = vi.fn();

vi.mock("@/app/actions/log-walk", () => ({
  logWalk: (...args: unknown[]) => logWalk(...args),
  clearWalk: (...args: unknown[]) => clearWalk(...args),
}));

vi.mock("@/app/actions/log", () => ({
  logItem: (...args: unknown[]) => logItem(...args),
  undoLastLog: (...args: unknown[]) => undoLastLog(...args),
}));

vi.mock("@/app/actions/swap", () => ({
  swapMeal: (...args: unknown[]) => swapMeal(...args),
  repeatMeal: (...args: unknown[]) => repeatMeal(...args),
  revertSwap: (...args: unknown[]) => revertSwap(...args),
}));

beforeEach(() => {
  logItem.mockReset();
  undoLastLog.mockReset();
  swapMeal.mockReset();
  repeatMeal.mockReset();
  revertSwap.mockReset();
  logWalk.mockReset();
  clearWalk.mockReset();
  logWalk.mockResolvedValue({ ok: true });
  clearWalk.mockResolvedValue({ ok: true });
  logItem.mockResolvedValue({ ok: true });
  undoLastLog.mockResolvedValue({ ok: true });
  swapMeal.mockResolvedValue({ ok: true });
  repeatMeal.mockResolvedValue({ ok: true });
  revertSwap.mockResolvedValue({ ok: true });
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

const mealItem = (
  fields: Partial<Meal> = {},
  slot: Meal["slotType"] = "breakfast",
  /** "override" is what puts the Swapped tag, the note and Revert on the card. */
  source: "template" | "override" = "template",
): NowItem => ({
  kind: "meal",
  meal: { slot, meal: meal(fields), source, entryId: source === "override" ? "override-1" : "entry-1" },
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

/** The template entry the walk resolved from — what its row names on a write. */
const WALK_ENTRY = "entry-2";

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

/**
 * The library the swap sheet offers.
 *
 * Two dinners so the picker has a real choice, one breakfast so "Show all
 * meals" reveals something, and one archived row that must never appear.
 */
const LIBRARY = [
  { id: "meal-3", name: "Chilli", slotType: "dinner" as const, kcal: 700, proteinG: 45, fatG: 20, carbG: 60, isArchived: false },
  { id: "meal-4", name: "Chickpea curry", slotType: "dinner" as const, kcal: 560, proteinG: 24, fatG: 18, carbG: 70, isArchived: false },
  { id: "meal-1", name: "Overnight oats", slotType: "breakfast" as const, kcal: 420, proteinG: 32.5, fatG: 12, carbG: 48, isArchived: false },
  { id: "meal-9", name: "Retired traybake", slotType: "dinner" as const, kcal: 800, proteinG: 40, fatG: 30, carbG: 70, isArchived: true },
];

/** What the template plans today — the "before" of every swap note. */
const TEMPLATE_PLAN = [
  { slot: "breakfast" as const, meal: { id: "meal-1", name: "Overnight oats", kcal: 420, proteinG: 32.5, fatG: 12, carbG: 48 } },
  { slot: "lunch" as const, meal: { id: "meal-2", name: "Chicken salad", kcal: 500, proteinG: 40, fatG: 15, carbG: 45 } },
  { slot: "dinner" as const, meal: { id: "meal-3", name: "Chilli", kcal: 700, proteinG: 45, fatG: 20, carbG: 60 } },
];

const renderNow = (
  view: NowView,
  exercises: ReadonlyMap<string, WorkoutExercise[]> = EXERCISES,
  /** The day's log so far — what the summary prints, and what undo takes back. */
  entries: LoggedEntry[] = [],
  /** What is recorded against the walk. Unlogged unless a case says otherwise. */
  walk: WalkEntryView | null = null,
) => (
  render(
    <RightNow
      view={view}
      exercises={exercises}
      entries={entries}
      target={TARGET}
      meals={LIBRARY}
      templatePlan={TEMPLATE_PLAN}
      walks={new Map(walk ? [[WALK_ENTRY, walk]] : [])}
    />,
  )
);

/**
 * One shape of the meal's numbers — FUEL-82.
 *
 * `/` renders both: below 768px one grid carrying the meal's four macros with
 * the day's totals on the slash line, and at 768px and up the two named sections
 * `This meal` and `Today`. CSS chooses one. jsdom loads no stylesheet, so unlike
 * a browser it has BOTH in the tree — and since all three grids carry the labels
 * `Calories / Protein / Fat / Carbs`, an unscoped `getByText("32.5 g")` finds
 * the meal's protein twice.
 *
 * Every query that reaches for a macro figure goes through a shape for that
 * reason. Anyone adding one to this file must do the same, or it will match
 * ambiguously — the same rule `week-grid.test.tsx` records for `/plan`.
 *
 * Addressed by `data-shape` rather than by text: the two carry the same figures
 * on purpose, because they are the same meal either way.
 */
const shape = (which: "merged" | "split") =>
  within(document.querySelector<HTMLElement>(`[data-shape="${which}"]`)!);

/**
 * One copy of the day ruler — FUEL-82.
 *
 * Also rendered twice on a meal card, because the phone puts it below the
 * figures and the desktop above them, and CSS `order` would have moved the box
 * without moving the sequence a screen reader walks. `"wide"` is the default for
 * a test that is not about position: it is the copy these tests were written
 * against, and both are the same `DayRuler` with the same props.
 *
 * On a workout card there is no merged grid to move it past, so only one copy
 * renders and it carries no `data-ruler` — hence the fallback to `getAllByRole`.
 */
const dayRuler = (which: "wide" | "phone" = "wide"): HTMLElement => {
  const scoped = document.querySelector<HTMLElement>(`[data-ruler="${which}"]`);

  // `getAllByRole` throws when it finds none, so the index is safe — but it is
  // typed as possibly-undefined, and an assertion is honest here where a `??`
  // fallback would invent an element that does not exist.
  return scoped ? within(scoped).getByRole("img") : screen.getAllByRole("img")[0]!;
};

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

    // Both shapes, because the rule is about the screen a reader is offered and
    // there are two of those now — FUEL-82. A check on one shape alone would
    // pass while the other quietly lost the emphasis.
    for (const which of ["merged", "split"] as const) {
      expect(shape(which).getByText("32.5 g").className).toContain("font-bold");
      expect(shape(which).getByText("48 g").className).not.toContain("font-bold");
    }
  });

  test("renders no exercise list", () => {
    renderNow(active(0));

    expect(screen.queryByText("3 x 12")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The two shapes of the day's numbers — FUEL-82                              */
/* -------------------------------------------------------------------------- */

describe("the day's numbers, in two shapes", () => {
  test("draws both, and lets CSS choose between them", () => {
    // The page is server-rendered into one HTML for every viewport, so the
    // choice cannot be a `matchMedia` read without every phone painting the
    // wide shape for a frame first. Both are in the tree; the classes are what
    // decides.
    renderNow(active(0));

    expect(document.querySelector('[data-shape="merged"]')!.className).toContain(
      "md:hidden",
    );
    expect(document.querySelector('[data-shape="split"]')!.className).toContain(
      "hidden md:flex",
    );
  });

  test("the merged shape carries the day's totals, so `Today` is hidden with it", () => {
    // The two must not both be showing at any width: the merged grid already
    // prints the day's four figures on its slash lines, and `Today` beneath it
    // would be the same numbers twice.
    renderNow(active(0));

    const today = screen.getByRole("heading", { name: "Today" }).closest("section")!;

    expect(today.className).toContain("hidden md:flex");
  });

  test("a workout card keeps `Today` at every width", () => {
    // There is no meal to merge the day's figures into, so the section is the
    // only place they appear and it may not be hidden on a phone. `DayTotals`
    // makes the point itself: the totals belong to the day, not to the item in
    // the middle of the screen.
    renderNow(active(2));

    const today = screen.getByRole("heading", { name: "Today" }).closest("section")!;

    expect(today.className).not.toContain("hidden");
  });

  test("the ruler follows the figures on a phone and precedes them elsewhere", () => {
    // On the longest meal names something goes under the action bar, and the
    // four figures are what § P4 is measured on. Two copies rather than CSS
    // `order`, so the sequence a screen reader walks matches what is drawn at
    // both widths.
    renderNow(active(0));

    const wide = document.querySelector('[data-ruler="wide"]')!;
    const phone = document.querySelector('[data-ruler="phone"]')!;
    const merged = document.querySelector('[data-shape="merged"]')!;

    // `DOCUMENT_POSITION_FOLLOWING` is set when the argument comes after the
    // node in document order — which is the sequence a screen reader walks.
    const follows = (node: Element, other: Element) =>
      Boolean(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(wide, merged)).toBe(true);
    expect(follows(merged, phone)).toBe(true);
  });

  test("a workout card draws the ruler once, in its original place", () => {
    // Nothing to move it past, and `ExerciseList` runs to six rows — demoting it
    // below that would push it most of a screen down to buy nothing.
    renderNow(active(2));

    expect(document.querySelector('[data-ruler="phone"]')).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(1);
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

  test("carries the day's totals but no macro grid of its own", () => {
    renderNow(active(2));

    // A session has no macros, so the card shows none. The DAY's do not belong
    // to the item in the middle of the screen, and a grid that appeared at
    // breakfast and vanished at the afternoon session would be hiding the day's
    // figures exactly when the next meal is the one being decided — FUEL-31.
    //
    // Queried by the two headings rather than by the cell labels, which are the
    // same four words in both grids. The previous form of this test asked for
    // `role="term"` by accessible name: a `dt` takes no name from its contents,
    // so that query answered null whether or not a grid was there, and the test
    // passed for the whole of the time it was checking nothing.
    expect(screen.queryByText("This meal")).toBeNull();
    expect(screen.getByText("Today")).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The day's totals — FUEL-31                                                 */
/* -------------------------------------------------------------------------- */

/** The day grid, which is the second of the two on a meal card. */
const dayGrid = (container: HTMLElement) => {
  const grids = container.querySelectorAll("dl");

  return grids[grids.length - 1]!;
};

describe("the day's totals", () => {
  test("sums the resolved day against target, with signed deltas", () => {
    const { container } = renderNow(active(0));

    // Three meals at 420 / 32.5 / 12 / 48, against 2,000 / 150 / 60 / 200. The
    // walk is on the day too and contributes nothing, which is what it should
    // contribute: a workout has no macros.
    const day = within(dayGrid(container));

    expect(day.getByText("1,260")).toBeDefined();
    expect(day.getByText("−740")).toBeDefined();
    expect(day.getByText("97.5 g")).toBeDefined();
    expect(day.getByText(/of 150 · −52.5/)).toBeDefined();
    expect(day.getByText("36 g")).toBeDefined();
    expect(day.getByText(/of 60 · −24/)).toBeDefined();
    expect(day.getByText("144 g")).toBeDefined();
    expect(day.getByText(/of 200 · −56/)).toBeDefined();
  });

  test("names both grids, so two sets of the same four labels can be told apart", () => {
    renderNow(active(0));

    expect(screen.getByText("This meal")).toBeDefined();
    expect(screen.getByText("Today")).toBeDefined();
  });

  test("moves on a swap, before the server has answered", async () => {
    // P4's promise, and the reason the totals are derived rather than stored:
    // "a swap that costs the day 30g of protein says so at the moment of the
    // swap, not in hindsight."
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    swapMeal.mockReturnValue(held.promise);

    const { container } = renderNow(active(3));

    expect(within(dayGrid(container)).getByText("1,260")).toBeDefined();

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    // 420 + 420 + 560: dinner's 420 displaced by the curry, on the frame the
    // sheet closes and while the write is still in flight.
    await waitFor(() => expect(within(dayGrid(container)).getByText("1,400")).toBeDefined());
    expect(within(dayGrid(container)).queryByText("1,260")).toBeNull();

    held.settle({ ok: true });
    await waitFor(() => expect(swapMeal).toHaveBeenCalled());
  });

  test("moves back on a revert", async () => {
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    revertSwap.mockReturnValue(held.promise);

    const { container } = renderNow(swappedView());

    expect(within(dayGrid(container)).getByText("1,400")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Revert" }));

    // Back to what the TEMPLATE plans for dinner — 700 kcal, not the 420 the
    // unswapped fixture carries — because that is what a revert restores.
    await waitFor(() => expect(within(dayGrid(container)).getByText("1,540")).toBeDefined());

    held.settle({ ok: true });
    await waitFor(() => expect(revertSwap).toHaveBeenCalled());
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
/* The daily walk — FUEL-29                                                   */
/* -------------------------------------------------------------------------- */

/** The Anytime section, which is where the walk's row lives on this screen. */
const anytime = () =>
  screen.getByRole("heading", { name: "Anytime" }).nextElementSibling as HTMLElement;

describe("the daily walk", () => {
  test("logs in one tap, with no duration asked for first", async () => {
    const user = userEvent.setup();

    renderNow(active(0));

    await user.click(within(anytime()).getByRole("button", { name: "Log walk" }));

    // One tap, one write. The date and the entry are the row's, and the
    // duration is absent rather than zero — see `parseDuration`.
    await waitFor(() =>
      expect(logWalk).toHaveBeenCalledWith({
        date: "2026-03-09",
        entryId: "entry-2",
        durationMin: null,
      }),
    );
  });

  test("says Done on the frame it is tapped, before the server answers", async () => {
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    logWalk.mockReturnValue(held.promise);

    renderNow(active(0));

    await user.click(within(anytime()).getByRole("button", { name: "Log walk" }));

    // § Feedback's 300ms budget: the row has already changed while the request
    // is still open. `findBy` rather than `getBy` — an optimistic assertion has
    // to wait for the transition to paint, and `getBy` is the version that
    // passes under `npm run test` and flakes under coverage.
    expect((await within(anytime()).findByRole("status")).textContent).toContain("Done");
    expect(within(anytime()).queryByRole("button", { name: "Log walk" })).toBeNull();

    held.settle({ ok: true });
    await waitFor(() => expect(logWalk).toHaveBeenCalled());
  });

  test("reverts and says so when the write is refused", async () => {
    const user = userEvent.setup();

    logWalk.mockResolvedValue({ ok: false });

    renderNow(active(0));

    await user.click(within(anytime()).getByRole("button", { name: "Log walk" }));

    // The value is back — § Feedback: "value reverted, Try again" — and the
    // banner is at the point of action rather than in the bar.
    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Couldn’t save that.");
    expect(
      await within(anytime()).findByRole("button", { name: "Log walk" }),
    ).toBeDefined();
  });

  test("re-runs the same write from Try again", async () => {
    const user = userEvent.setup();

    logWalk.mockResolvedValue({ ok: false });

    renderNow(active(0));

    await user.click(within(anytime()).getByRole("button", { name: "Log walk" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(logWalk).toHaveBeenCalledTimes(2));
    expect(logWalk.mock.calls[1]).toEqual(logWalk.mock.calls[0]);
  });

  test("offers the durations once the walk is logged, and not before", async () => {
    renderNow(active(0));

    expect(within(anytime()).queryByRole("button", { name: "30 min" })).toBeNull();

    renderNow(active(0), EXERCISES, [], { durationMin: null });

    expect(screen.getAllByRole("button", { name: "45 min" })).not.toHaveLength(0);
  });

  test("records a duration against the walk already logged", async () => {
    const user = userEvent.setup();

    renderNow(active(0), EXERCISES, [], { durationMin: null });

    await user.click(within(anytime()).getByRole("button", { name: "45 min" }));

    await waitFor(() =>
      expect(logWalk).toHaveBeenCalledWith({
        date: "2026-03-09",
        entryId: "entry-2",
        durationMin: 45,
      }),
    );
  });

  test("clears the duration when its own preset is tapped again", async () => {
    const user = userEvent.setup();

    renderNow(active(0), EXERCISES, [], { durationMin: 45 });

    const preset = within(anytime()).getByRole("button", { name: "45 min" });

    // The state is said to a screen reader as well as drawn.
    expect(preset.getAttribute("aria-pressed")).toBe("true");

    await user.click(preset);

    await waitFor(() =>
      expect(logWalk).toHaveBeenCalledWith({
        date: "2026-03-09",
        entryId: "entry-2",
        durationMin: null,
      }),
    );
  });

  test("shows the duration beside Done", () => {
    renderNow(active(0), EXERCISES, [], { durationMin: 30 });

    expect(within(anytime()).getByRole("status").textContent).toContain("30 min");
  });

  test("takes the walk back from its own row", async () => {
    const user = userEvent.setup();

    renderNow(active(0), EXERCISES, [], { durationMin: 30 });

    await user.click(within(anytime()).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(clearWalk).toHaveBeenCalledWith({ date: "2026-03-09", entryId: "entry-2" }),
    );
    // The bar's Undo is a different control writing a different action. This
    // one must not have reached for it.
    expect(undoLastLog).not.toHaveBeenCalled();
  });

  test("is offered on a weekend, where nothing else is scheduled", () => {
    // "Every day including weekends" is a property of the TEMPLATE, so a
    // weekend here is simply a day whose timeline is empty and whose walk is
    // not — the shape `resolveNow` returns for a Saturday.
    renderNow({ ...BASE, state: "nothing-planned", timeline: [], anytime: [WALK] });

    expect(screen.getByRole("button", { name: "Log walk" })).toBeDefined();
  });

  test("keeps the bar's Undo off the walk's own log", () => {
    // A day whose only log is the walk. The bar's stack is over what the bar
    // wrote, and it wrote none of this — see `lib/walk.ts`.
    renderNow(active(0), EXERCISES, [entry({ id: "l1", name: "Daily walk", status: "done", walk: true })]);

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  test("still offers the bar's Undo for a meal logged beside the walk", () => {
    renderNow(active(1), EXERCISES, [
      entry({ id: "l1" }),
      entry({ id: "l2", name: "Daily walk", status: "done", walk: true }),
    ]);

    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The day ruler                                                              */
/* -------------------------------------------------------------------------- */

describe("the day ruler", () => {
  test("marks the day's shape and puts NOW at the clock", () => {
    renderNow(active(0));

    // Both copies, because a meal card draws the ruler twice and only one of
    // them is ever visible — FUEL-82. The summary is the same either way, and
    // asserting it on one would let the other drift.
    for (const which of ["wide", "phone"] as const) {
      const ruler = dayRuler(which);

      // The ruler's accessible summary is built from the same array as its marks.
      expect(ruler.getAttribute("aria-label")).toContain("4 slots");
      expect(ruler.getAttribute("aria-label")).toContain("Now 08:00");
      expect(within(ruler).getByText("Now")).toBeDefined();
    }
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
    const rule = dayRuler().querySelector(
      '[class*="bg-accent"]:not([class*="rounded-full"])',
    );

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

  test("still offers the walk while it is outstanding — FUEL-29", () => {
    // The closed page's one exception. The evening is when the walk is logged,
    // so a finished day with an unlogged walk is the ordinary case rather than
    // an edge, and hiding it would leave nowhere to log it until midnight.
    summary();

    expect(screen.getByRole("button", { name: "Log walk" })).toBeDefined();
  });

  test("closes completely once the walk is logged", () => {
    renderNow({ ...BASE, state: "day-complete" }, EXERCISES, LOGGED, {
      durationMin: 45,
    });

    // The row is gone; the walk is a line in the summary above like any other
    // log. No ruler, no Up next, no Anytime — the page is closed again.
    expect(screen.queryByRole("button", { name: "Log walk" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Anytime" })).toBeNull();
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

    // The summary's own list, named by the heading above it. The unlogged walk
    // puts a second list on this page (FUEL-29), which is the whole of why this
    // is scoped rather than "the list".
    const logged = screen.getByRole("heading", { name: "Logged" }).nextElementSibling!;

    expect(
      within(logged as HTMLElement)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
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

  test("marks the four corners, and renders no landmark of its own", () => {
    const { container } = summary();

    // § Materials: crop marks at the four corners of this screen "and nowhere
    // else. The day is a finished page."
    expect(
      [...container.querySelectorAll("[data-crop]")].map((mark) => mark.getAttribute("data-crop")),
    ).toEqual(["tl", "tr", "bl", "br"]);

    // The summary renders no landmark of its own. Narrowed deliberately in
    // FUEL-58, because the claim it used to make is no longer true of the
    // SCREEN: § Navigation's shell now renders on day-complete like everywhere
    // else, mounted in `app/(app)/layout.tsx`. This component is rendered here
    // without that layout, so an assertion phrased as "day-complete carries no
    // tab bar" would have gone on passing while the rule it named was reversed
    // — measuring the absence of something that was never in scope. What it
    // measures now is the thing this file can actually see.
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

  test("no control on the action bar is disabled — swap opens the picker now", () => {
    // It was disabled until FUEL-23, waiting for the sheet and the override it
    // writes. Asserted as "none of the three", so that a control disabled by a
    // later change has to be argued for rather than slipping in.
    renderNow(active(0));

    for (const name of ["Log eaten", "Swap", "Skip"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(
        false,
      );
    }
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
    //
    // "Opaque" has one deliberate hole in it since FUEL-83, and `bg-background`
    // is still the right thing to assert: the fill is unchanged and the bar
    // covers everything under it exactly as before. What changed is that the
    // top 24px of that cover is masked below `lg`, so a line of type meeting
    // the bar runs out instead of being cut through the x-height. The class
    // carrying it is asserted with the rest, and `action-bar.test.tsx` owns
    // what it does.
    const { container } = renderNow(active(0));

    const bar = container.querySelector('[data-variant="default"]')?.parentElement;

    expect(bar?.className).toContain("sticky");
    expect(bar?.className).toContain("bottom-0");
    expect(bar?.className).toContain("mt-auto");
    expect(bar?.className).toContain("bg-background");
    expect(bar?.className).toContain("action-bar-fade");
  });

  test("is the shared bar, not a string of its own", () => {
    // FUEL-83. `/`, `/training` and the `/` skeleton have to agree about the
    // pinning — the skeleton exists so the primary does not move on swap-in —
    // and they now agree by taking one constant rather than by three literals
    // matching. Identity, so this screen cannot quietly add or drop a class.
    const { container } = renderNow(active(0));

    const bar = container.querySelector('[data-variant="default"]')?.parentElement;

    expect(bar?.className).toBe(APP_ACTION_BAR);
  });

  test("no longer carries the safe-area inset, which the shell owns", () => {
    // Inverted in FUEL-58, and worth keeping as an assertion rather than
    // deleting. The inset used to be here because a bar pinned to `bottom: 0`
    // sits below any padding its parent has. That stopped being the right place
    // for it when § Navigation's shell went in below this column: the shell is
    // the last thing on the screen and the only thing with the home indicator
    // beneath it, so a bar keeping its own inset would clear an indicator two
    // elements away and leave a visible gap — the doubled inset this test now
    // exists to catch.
    const { container } = renderNow(active(0));

    const bar = container.querySelector('[data-variant="default"]')?.parentElement;

    expect(bar?.className).not.toContain("safe-area-inset-bottom");
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

    /*
     * Counted per SHAPE now, plus a total — FUEL-82.
     *
     * "One umber element per screen" is a claim about a rendered viewport, and a
     * meal card holds two rulers in the DOM because the phone puts it below the
     * figures and the desktop above them. Only one is ever displayed, so the
     * rule is intact; what changed is that the DOM cannot be counted as if it
     * were the screen.
     *
     * The total is asserted as well as the per-copy check because that is the
     * assertion that fails if a third copy is ever added and nobody revisits
     * this — the per-copy loop alone would pass forever.
     */
    const rulers = [dayRuler("wide"), dayRuler("phone")];
    const accented = [...container.querySelectorAll('[class*="accent"]')];

    // A positive control first: an assertion that everything accented is inside
    // the ruler passes just as happily when nothing is accented at all, which
    // would mean the marker had gone missing rather than the rule being kept.
    expect(accented.length).toBeGreaterThan(0);

    for (const ruler of rulers) {
      expect([...ruler.querySelectorAll('[class*="accent"]')].length).toBe(
        accented.length / rulers.length,
      );
    }

    for (const element of accented) {
      expect(rulers.some((ruler) => ruler.contains(element))).toBe(true);
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

/* -------------------------------------------------------------------------- */
/* The swap — FUEL-23                                                         */
/* -------------------------------------------------------------------------- */

/** A view whose dinner resolved from an override rather than the template. */
const swappedDinner = at(
  mealItem({ id: "meal-4", name: "Chickpea curry", kcal: 560, proteinG: 24, fatG: 18, carbG: 70 }, "dinner", "override"),
  "meal:e4",
  "19:00",
  1140,
);

const swappedView = (): NowView =>
  ({
    ...BASE,
    timeline: [BREAKFAST, LUNCH, SESSION, swappedDinner],
    state: "active",
    index: 3,
    active: swappedDinner,
    upcoming: [],
  }) as NowView;

/** Opens the sheet from the card and hands back the tile for `name`. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Swap" }));

  const sheet = screen.getByRole("dialog");

  await user.click(within(sheet).getByRole("button", { name: new RegExp(name) }));

  return sheet;
}

describe("swapping a meal", () => {
  test("Swap opens the picker for the active slot", async () => {
    const user = userEvent.setup();

    renderNow(active(3));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    // Named for the slot being swapped, not for the meal in it — the sheet is
    // asking "what goes in dinner", and the answer may be anything.
    expect(screen.getByRole("dialog", { name: /Swap dinner/ })).toBeTruthy();
  });

  test("offers the library, and never an archived meal", async () => {
    const user = userEvent.setup();

    renderNow(active(3));
    await user.click(screen.getByRole("button", { name: "Swap" }));
    await user.click(screen.getByRole("button", { name: "Show all meals" }));

    const sheet = screen.getByRole("dialog");

    expect(within(sheet).getByRole("button", { name: /Chickpea curry/ })).toBeTruthy();
    // A retired meal is not a candidate — meal-picker.tsx filters it, and
    // actions/swap.ts refuses it again on the way in.
    expect(within(sheet).queryByRole("button", { name: /Retired traybake/ })).toBeNull();
  });

  test("sends the item KEY and the chosen meal id, and nothing else", async () => {
    // The security shape. The date and the slot are the server's to derive; a
    // payload carrying them would be a payload to tamper with.
    const user = userEvent.setup();

    renderNow(active(3));

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(swapMeal).toHaveBeenCalled());
    expect(swapMeal).toHaveBeenCalledWith("meal:e4", "meal-4");
  });

  test("shows the new meal, its macros and the tag before the server answers", async () => {
    // § Feedback's 300ms budget applies to a swap exactly as it does to a log.
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    swapMeal.mockReturnValue(held.promise);

    renderNow(active(3));

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chickpea curry"),
    );
    expect(screen.getByText("Swapped")).toBeTruthy();
    // The macro grid follows the meal, not the slot — in both shapes, since they
    // share the one `useOptimistic` state and a swap that moved only one of them
    // would be a swap the phone or the desktop did not see.
    expect(shape("merged").getByText("560")).toBeTruthy();
    expect(shape("split").getByText("560")).toBeTruthy();

    held.settle({ ok: true });
    await waitFor(() => expect(swapMeal).toHaveBeenCalled());
  });

  test("does not advance the card", async () => {
    // A swap changes WHAT the active item is, not whether it is done. Dinner is
    // the last item here, so advancing would land on the day-complete summary.
    const user = userEvent.setup();

    renderNow(active(3));

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(swapMeal).toHaveBeenCalled());
    expect(screen.queryByText(/Day complete/)).toBeNull();
    expect(screen.getByRole("button", { name: "Log eaten" })).toBeTruthy();
  });

  test("reverts the card and says what happened when the write is refused", async () => {
    // § Feedback: "inline banner at the point of action, value reverted, Try
    // again. Never a modal." And § Tone of Voice: name what happened — this was
    // not a log failing to save.
    const user = userEvent.setup();

    swapMeal.mockResolvedValue({ ok: false });

    renderNow(active(3));

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t swap that.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chilli");
    expect(screen.queryByText("Swapped")).toBeNull();
  });

  test("retries the same swap from the banner", async () => {
    const user = userEvent.setup();

    swapMeal.mockResolvedValue({ ok: false });

    renderNow(active(3));

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(swapMeal).toHaveBeenCalledTimes(2));
    // The SAME swap, not a fresh one — the retry cannot reopen the sheet to ask
    // again, so the attempt has to carry what it needs to be re-run.
    expect(swapMeal.mock.calls[1]).toEqual(["meal:e4", "meal-4"]);
  });

  test("says nothing at all when the write succeeds", async () => {
    // Routine success is silent. There is no toast anywhere in this app — the
    // card showing the new meal IS the confirmation.
    const user = userEvent.setup();

    renderNow(active(3));

    const sheet = await choose(user, "Chickpea curry");

    await user.click(within(sheet).getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(swapMeal).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a session offers no Swap", () => {
    renderNow(active(2));

    expect(screen.queryByRole("button", { name: "Swap" })).toBeNull();
  });
});

describe("repeating a meal", () => {
  /** Choose a meal, set the count, and tap the text button. */
  async function repeat(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    days: number,
  ) {
    const sheet = await choose(user, name);

    for (let tap = 0; tap < days - 2; tap += 1) {
      await user.click(within(sheet).getByRole("button", { name: "One day more" }));
    }

    await user.click(
      within(sheet).getByRole("button", { name: `Repeat for ${days} days` }),
    );

    return sheet;
  }

  test("sends the item KEY, the chosen meal id and the count", async () => {
    // The security shape a repeat adds to the swap's: the START date and the
    // slot are still the server's to derive, and the only new value is how many
    // days the run covers. A payload carrying the dates themselves would be a
    // payload to tamper with — and a repeat's would be several.
    const user = userEvent.setup();

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 3);

    await waitFor(() => expect(repeatMeal).toHaveBeenCalled());
    expect(repeatMeal).toHaveBeenCalledWith("meal:e4", "meal-4", 3);
    expect(swapMeal).not.toHaveBeenCalled();
  });

  test("shows today's card swapped before the server answers", async () => {
    // A repeat writes several days; ONE of them has a card here. So the
    // optimistic answer is exactly a swap's — the new meal, its macros and the
    // tag, on the current frame — and the later dates are simply not this
    // screen's business.
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    repeatMeal.mockReturnValue(held.promise);

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 4);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chickpea curry");
    expect(screen.getByText("Swapped")).toBeTruthy();

    held.settle({ ok: true });
  });

  test("does not advance the day", async () => {
    // The swap's rule, and the server agrees: `repeatMeal` writes no cursor. A
    // repeat changes WHAT the active item is, not whether it is done.
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    repeatMeal.mockReturnValue(held.promise);

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 3);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chickpea curry");
    expect(screen.getByRole("button", { name: "Log eaten" })).toBeTruthy();

    held.settle({ ok: true });
  });

  test("names what failed, and it is not a swap", async () => {
    // § Tone of Voice: name what happened. "Couldn't swap that" would be wrong
    // here — the user asked for four days, and none of them were written.
    const user = userEvent.setup();

    repeatMeal.mockResolvedValue({ ok: false });

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 3);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t repeat that.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chilli");
    expect(screen.queryByText("Swapped")).toBeNull();
  });

  test("retries the SAME count from the banner", async () => {
    // The reason `days` rides on the Attempt. The sheet has closed by the time
    // a refusal comes back, so a retry that forgot the count would quietly
    // write two days where the user asked for five.
    const user = userEvent.setup();

    repeatMeal.mockResolvedValue({ ok: false });

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 5);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(repeatMeal).toHaveBeenCalledTimes(2));
    expect(repeatMeal.mock.calls[1]).toEqual(["meal:e4", "meal-4", 5]);
  });

  test("says nothing at all when the write succeeds", async () => {
    const user = userEvent.setup();

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 3);

    await waitFor(() => expect(repeatMeal).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("closes the sheet, as the swap does", async () => {
    const user = userEvent.setup();

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 3);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("leaves Revert offered for today's date", async () => {
    // The acceptance criterion's "individually revertible", as far as THIS
    // screen can speak to it: today's override is one row, and the control that
    // removes it is the one already on the card. The later dates are separate
    // rows and become revertible from the weekly grid (FUEL-28).
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    repeatMeal.mockReturnValue(held.promise);

    renderNow(active(3));
    await repeat(user, "Chickpea curry", 4);

    expect(screen.getByRole("button", { name: "Revert" })).toBeTruthy();

    held.settle({ ok: true });
  });
});

describe("a slot that is already swapped", () => {
  test("marks the card, and states the cost in the Brand Guide's words", () => {
    // The copy example itself: the template dinner is 700 kcal / 45g protein,
    // the override is 560 / 24. § Feedback keeps success silent — this is not
    // an acknowledgement of a tap but the state of an overridden slot, which is
    // why it is here on a first render with no tap in sight.
    renderNow(swappedView());

    expect(screen.getByText("Swapped")).toBeTruthy();
    expect(screen.getByText("Swapped. −21g protein, −140 kcal today.")).toBeTruthy();
  });

  test("tints the tag rather than accenting it", () => {
    // § The Four Rules: one umber element per screen, and on `/` that is the
    // ruler's NOW marker. `accent-subtle` is a tinted ground and not the
    // accent, which is what lets the tag exist without making two.
    renderNow(swappedView());

    const tag = screen.getByText("Swapped");

    expect(tag.className).toContain("bg-accent-subtle");
    expect(tag.className).not.toContain("bg-accent ");
    expect(tag.className).not.toContain("text-accent");
  });

  test("does not rely on colour alone", () => {
    // § Accessibility: "never colour alone". The word is the signal; the tint
    // reinforces it, and the mark survives greyscale.
    renderNow(swappedView());

    expect(screen.getByText("Swapped").textContent).toBe("Swapped");
  });

  test("offers Revert, which deletes the override by its own key", async () => {
    const user = userEvent.setup();

    renderNow(swappedView());

    await user.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() => expect(revertSwap).toHaveBeenCalledWith("meal:e4"));
  });

  test("drops the tag and the note the moment Revert is tapped", async () => {
    const user = userEvent.setup();
    const held = deferred<{ ok: boolean }>();

    revertSwap.mockReturnValue(held.promise);

    renderNow(swappedView());
    await user.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() => expect(screen.queryByText("Swapped")).toBeNull());
    expect(screen.queryByText(/−21g protein/)).toBeNull();

    held.settle({ ok: true });
    await waitFor(() => expect(revertSwap).toHaveBeenCalled());
  });

  test("keeps Revert away from the controls a thumb reaches for", () => {
    // FUEL-25, and § Touch Targets: "destructive controls never sit adjacent to
    // a frequently-tapped one". Revert deletes the override outright, and it
    // used to sit 12px under Swap — the control that OPENS the sheet that wrote
    // it. Asserted structurally rather than by pixel: what matters is that a
    // mis-tap on the bar cannot reach it, and the bar is one container.
    renderNow(swappedView());

    const revert = screen.getByRole("button", { name: "Revert" });
    // The primary's own parent IS the bar: `Actions` renders it and the
    // Swap/Skip row inside one sticky container, with no wrapper between.
    const bar = screen.getByRole("button", { name: "Log eaten" }).parentElement;

    expect(bar?.className).toContain("sticky");
    expect(bar?.contains(screen.getByRole("button", { name: "Swap" }))).toBe(true);
    expect(bar?.contains(screen.getByRole("button", { name: "Skip" }))).toBe(true);
    expect(bar?.contains(revert)).toBe(false);
  });

  test("sits with the mark it takes back", () => {
    // The other half of the move. P2 words the criterion as one thought —
    // "overridden cells are visually marked and can be reverted to template in
    // one tap" — so Revert belongs with the note, not merely away from Swap.
    renderNow(swappedView());

    const note = screen.getByText(/Swapped\./);

    expect(
      note.parentElement?.contains(screen.getByRole("button", { name: "Revert" })),
    ).toBe(true);
  });

  test("keeps Revert at the guide's minimum tap size", () => {
    // § Touch Targets' 44px floor. Inline beside a caption is exactly where a
    // control gets quietly shrunk to match the text around it.
    renderNow(swappedView());

    expect(screen.getByRole("button", { name: "Revert" }).dataset.size).toBe("sm");
  });

  test("says what happened when a revert is refused", async () => {
    const user = userEvent.setup();

    revertSwap.mockResolvedValue({ ok: false });

    renderNow(swappedView());
    await user.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // Not "Couldn't save that" — a revert was not saving anything, and
    // § Tone of Voice asks copy to name what happened.
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t revert that.");
    expect(screen.getByText("Swapped")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* The way to the other screens                                               */
/* -------------------------------------------------------------------------- */

describe("the link at the foot", () => {
  test("is Settings, and nothing else", () => {
    // It was four links until FUEL-58 — `/plan`, `/training` and `/weight`
    // beside this one — because there was no other way to reach those screens.
    // § Navigation's shell carries all four destinations on every authenticated
    // screen now, so the peers are a second, worse copy of it and are gone.
    //
    // Asserted as the WHOLE set rather than with three `queryByRole` absences,
    // so a link added back here has to come through this test. `/settings` is
    // the one that stays: it is not one of the four, does not go in the pill,
    // and § Navigation puts it exactly here — "To the foot of `/`... Two taps
    // from anywhere: the Now pill, then the link."
    renderNow(active(0));

    expect(
      screen.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([["Settings", "/settings"]]);
  });

  test("is named for the screen it opens, not for one section of it", () => {
    // FUEL-60. It said "Slot times", which was the whole of `/settings` when
    // FUEL-21 put it here and a subset of it from the next task onward — that
    // screen also holds the walk reminder, the push subscription, the export,
    // the template link and sign-out, and heads itself "Settings".
    //
    // Both directions asserted. The name is the one § Navigation's route table
    // gives the route, and the old one is gone rather than merely joined.
    renderNow(active(0));

    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
    expect(screen.queryByRole("link", { name: "Slot times" })).toBeNull();
  });

  test("is on the finished page too, which it did not used to be", () => {
    // The half of FUEL-58 that is a real behaviour change rather than a
    // deletion. Once the day is logged, day-complete IS `/` — so a finished
    // page without this link makes § Navigation's "two taps from anywhere"
    // false every evening, and leaves the phone no route to `/settings` at all
    // (the sidebar's Settings link is ≥1024px only).
    renderNow({ ...BASE, state: "day-complete" });

    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  test("no longer duplicates the shell's four destinations", () => {
    // The three that left, named individually, so this fails loudly if one is
    // reintroduced on the argument that `/` "needs a way to reach it".
    //
    // `/plan` is listed under both names it has been given: "Plan", which is
    // what § Navigation's table calls it and what a link added back today
    // would most likely say, and "Weekly plan", which is what the link here
    // actually said before FUEL-58 removed it.
    renderNow(active(0));

    for (const name of ["Plan", "Weekly plan", "Training", "Weight"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });
});

describe("a slot resolved from the template", () => {
  test("carries no tag, no note and no Revert", () => {
    // The other half of "overridden cells are visually marked": an unmarked
    // cell has to actually be unmarked, or the mark means nothing.
    renderNow(active(3));

    expect(screen.queryByText("Swapped")).toBeNull();
    expect(screen.queryByText(/Swapped\./)).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });
});
