import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { RightNow } from "@/components/right-now";
import type { Meal, Workout, WorkoutExercise } from "@/lib/db/schema";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";

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

const renderNow = (view: NowView, exercises: ReadonlyMap<string, WorkoutExercise[]> = EXERCISES) =>
  render(<RightNow view={view} exercises={exercises} />);

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

  test("is drawn on a day with nothing active", () => {
    renderNow({ ...BASE, state: "day-complete" });

    expect(screen.getByRole("img")).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The two quiet states                                                       */
/* -------------------------------------------------------------------------- */

describe("day-complete", () => {
  test("reports, and offers no action", () => {
    renderNow({ ...BASE, state: "day-complete" });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nothing left today");
    // Nothing is active, so there is nothing to log, swap or skip. FUEL-20
    // turns this into the actual-versus-target summary.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("nothing-planned", () => {
  test("describes what will appear rather than nudging", () => {
    renderNow({ ...BASE, state: "nothing-planned", timeline: [], anytime: [] });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nothing planned");
    expect(
      screen.getByText(/appear here once the week's plan covers today/),
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

  test("every action is disabled until FUEL-19 wires it", () => {
    renderNow(active(0));

    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
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

  test("sits below the content, in the bottom third", () => {
    // Held at the foot by `mt-auto` on a full-height column rather than by a
    // fixed position, so it never covers the last row of a list.
    const { container } = renderNow(active(0));

    const bar = container.querySelector('[data-variant="default"]')?.parentElement;

    expect(bar?.className).toContain("mt-auto");
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
