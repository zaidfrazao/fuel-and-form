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
