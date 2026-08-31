import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * What `/` actually hands the browser.
 *
 * `page.test.tsx` renders the real `RightNow` and asserts what ends up on the
 * screen. That is the right test for almost everything the route does — and it
 * is structurally incapable of asking this one question, because a prop that
 * never gets rendered leaves no trace in the DOM. A narrowing test written
 * against `container.innerHTML` passes just as happily when the narrowing is
 * deleted, which was checked rather than assumed.
 *
 * So this file mocks the screen and captures its props. It is a separate file
 * because `vi.mock` is module-scoped: mocking `RightNow` inside page.test.tsx
 * would gut every other case there.
 *
 * ## Why it is worth a file of its own
 *
 * PRD § Security & Compliance, and the route's own doc: "choosing which of the
 * fetched fields the browser is allowed to see". `loadToday` returns whole rows
 * — a profile with the owner's body metrics on it, a meal library with recipe
 * method and notes — and this is the only place that decides what leaves the
 * server. That decision is one `.map()` away from being deleted by someone
 * simplifying, and nothing else in the suite would notice.
 */

const { redirect, getSession, loadToday, readCursor, rightNow } = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSession: vi.fn(),
  loadToday: vi.fn(),
  readCursor: vi.fn(),
  rightNow: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/today", () => ({ loadToday }));
vi.mock("@/lib/cursor-cookie", () => ({ readCursor }));

vi.mock("@/components/right-now", () => ({
  RightNow: (props: Record<string, unknown>) => {
    rightNow(props);

    return null;
  },
}));

const Home = (await import("./page")).default;

const SESSION = { userId: "user-owner", kind: "owner" as const };

/** Invented — Testing Strategy § 1.5. The demo persona's, not anyone's. */
const PROFILE = {
  userId: SESSION.userId,
  heightCm: 172,
  startWeightKg: 84.2,
  targetWeightKg: 76,
  goalPaceKgPerWeek: 0.5,
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
  slotTimes: {},
  programStartDate: "2026-03-02",
  timezone: "Europe/London",
};

/**
 * A library row as the database returns it.
 *
 * `method` and `notes` are populated deliberately: they are what the route has
 * to drop, and a fixture whose free-text columns were already null would let
 * the narrowing be deleted without this file noticing.
 */
const CHILLI = {
  id: "meal-1",
  userId: SESSION.userId,
  name: "Beef chilli",
  slotType: "dinner",
  kcal: 612,
  proteinG: 54.2,
  fatG: 14.6,
  carbG: 63.8,
  method: "Brown the mince, then simmer for forty minutes.",
  notes: "Doubles well for the freezer.",
  isArchived: false,
};

const VIEW = {
  date: "2026-03-09",
  minutesOfDay: 8 * 60,
  timeline: [],
  anytime: [],
  state: "nothing-planned",
};

/**
 * The daily walk as `loadToday` resolves it, and a log against it.
 *
 * The log is populated deliberately, exactly as `CHILLI`'s free text is: it
 * carries an id, an instant, a status and a note, and every one of them is a
 * field the row on screen does not draw. A fixture whose log was bare would let
 * the narrowing in `walkEntries` be widened without this file noticing.
 */
const WALK_WORKOUT = {
  id: "workout-9",
  userId: SESSION.userId,
  name: "Daily Walk",
  type: "walk",
  description: "Thirty to forty-five minutes, easy pace.",
  rotationGroup: null,
  rotationIndex: null,
};

const WALK_ITEM = {
  kind: "workout",
  workout: { workout: WALK_WORKOUT, source: "fixed", entryId: "entry-walk" },
  key: "workout:entry-walk",
};

const WALK_LOG = {
  id: "log-9",
  userId: SESSION.userId,
  date: "2026-03-09",
  workoutId: "workout-9",
  status: "done",
  note: "a note no screen shows",
  durationMin: 45,
  loggedAt: new Date(Date.UTC(2026, 2, 9, 19, 4)),
};

const today = () => ({
  view: VIEW,
  profile: PROFILE,
  exercises: new Map(),
  logs: { meals: [], workouts: [] },
  meals: [CHILLI],
  templatePlan: [
    { slot: "dinner", meal: CHILLI, source: "template", entryId: "entry-1" },
  ],
});

/** The props `RightNow` was rendered with. */
const props = () => rightNow.mock.calls[0]![0] as Record<string, never>;

/**
 * Renders again with a different answer from `loadToday`, and returns the props
 * that time.
 *
 * The `beforeEach` renders one default day, which is the right shape for the
 * cases above — they are about columns that are always there. The walk is a
 * state rather than a column, so its cases need a day it is logged on.
 */
async function renderWith(overrides: Record<string, unknown>) {
  rightNow.mockClear();
  loadToday.mockResolvedValue({ ...today(), ...overrides });

  render(await Home());

  return rightNow.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  readCursor.mockResolvedValue(null);
  getSession.mockResolvedValue(SESSION);
  loadToday.mockResolvedValue(today());

  render(await Home());
});

describe("the meal library", () => {
  test("carries what the picker draws and the preview totals", () => {
    // Both, because neither type is a superset of the other: the picker needs
    // the name and slot type, the preview needs all four macros.
    expect(props().meals).toEqual([
      {
        id: "meal-1",
        name: "Beef chilli",
        slotType: "dinner",
        kcal: 612,
        proteinG: 54.2,
        fatG: 14.6,
        carbG: 63.8,
        isArchived: false,
      },
    ]);
  });

  test("carries no recipe method and no notes", () => {
    // Free text shown on meal detail and nowhere near this screen. Asserted by
    // key rather than by searching for the strings, so a column renamed later
    // still has to be added here deliberately.
    for (const meal of props().meals as unknown as Record<string, unknown>[]) {
      expect(Object.keys(meal).sort()).toEqual([
        "carbG",
        "fatG",
        "id",
        "isArchived",
        "kcal",
        "name",
        "proteinG",
        "slotType",
      ]);
    }
  });

  test("carries no user id", () => {
    // Not a secret — it is the recipient's own — but it is an identifier with
    // no use on this screen, and the narrowing that drops the method should
    // not make an exception for it.
    for (const meal of props().meals as unknown as Record<string, unknown>[]) {
      expect(meal.userId).toBeUndefined();
    }
  });
});

describe("the template plan", () => {
  test("carries the slot and the macros the note is measured against", () => {
    expect(props().templatePlan).toEqual([
      {
        slot: "dinner",
        meal: { id: "meal-1", name: "Beef chilli", kcal: 612, proteinG: 54.2, fatG: 14.6, carbG: 63.8 },
      },
    ]);
  });

  test("carries the name a revert puts back, and no recipe text", () => {
    // The name is here for one reason: a revert renders optimistically, so the
    // card has to name the meal coming back on the frame the control is
    // tapped. Method and notes are not needed for that and still do not cross.
    for (const item of props().templatePlan as unknown as { meal: Record<string, unknown> }[]) {
      expect(item.meal.name).toBe("Beef chilli");
      expect(item.meal.method).toBeUndefined();
      expect(item.meal.notes).toBeUndefined();
      expect(item.meal.userId).toBeUndefined();
    }
  });
});

describe("the profile", () => {
  test("carries the four targets and no other body metric", () => {
    // The same argument, on the payload that was already there. `page.test.tsx`
    // asserts the figures do not appear on screen; this asserts they never
    // reach the browser at all, which is the stronger of the two.
    expect(props().target).toEqual({
      targetKcal: 1780,
      targetProteinG: 148,
      targetFatG: 50,
      targetCarbG: 185,
    });
  });
});

describe("the daily walk", () => {
  test("carries the duration the row draws, and nothing else off the log", async () => {
    const payload = await renderWith({
      view: { ...VIEW, anytime: [WALK_ITEM] },
      logs: { meals: [], workouts: [WALK_LOG] },
    });

    // Asserted by equality rather than field by field: the row shows Done and
    // the minutes, so the id, the instant, the status and the note have no
    // reason to leave the server — and a fifth field added later has to be
    // added here deliberately. Keyed by the template ENTRY, which is what the
    // row holds and what a write names.
    expect(payload.walks).toEqual(new Map([["entry-walk", { durationMin: 45 }]]));
  });

  test("has no entry for a walk that has not been logged", async () => {
    const payload = await renderWith({ view: { ...VIEW, anytime: [WALK_ITEM] } });

    // The row is rendered from the ITEM being in `anytime`; this says only what
    // state it is in, and unlogged is the state a tap changes.
    expect(payload.walks).toEqual(new Map());
  });

  test("is empty on a plan with no walk on it", async () => {
    expect((await renderWith({})).walks).toEqual(new Map());
  });

  test("marks the walk's line in the day's log", async () => {
    const payload = await renderWith({
      view: { ...VIEW, anytime: [WALK_ITEM] },
      logs: { meals: [], workouts: [WALK_LOG] },
    });

    // What keeps the action bar's Undo off a row it cannot take back. The line
    // itself still crosses — the walk happened, and the summary says so.
    expect(payload.entries).toEqual([
      { id: "log-9", name: "Daily Walk", kind: "workout", status: "done", walk: true },
    ]);
  });
});
