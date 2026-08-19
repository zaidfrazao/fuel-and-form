import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The route, which is the wire between the fetch and the render.
 *
 * Everything about how the screen LOOKS is asserted in right-now.test.tsx
 * against a fixture. What is left here is the part only the route does: it
 * refuses a caller with no session, it reads the clock exactly once, and it has
 * something to render for a user who has not been set up yet.
 *
 * The three collaborators are mocked because all three are the request —
 * cookies, a database connection and `new Date()`. Mocking them is what makes
 * the wiring itself assertable; `loadToday` and `RightNow` are covered on their
 * own terms elsewhere.
 */

const { redirect, getSession, loadToday, readCursor } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates rendering of the
    // segment. A mock that merely recorded the call would let execution run on
    // into `loadToday` with no session — the exact bug this test exists to
    // catch would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadToday: vi.fn(),
  readCursor: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/today", () => ({ loadToday }));
vi.mock("@/lib/cursor-cookie", () => ({ readCursor }));
// The screen is a client component that imports the log actions, and those
// reach a session and a database. Same reason login/page.test.tsx mocks its
// own: a "use server" module cannot be imported under jsdom, and none of what
// it does is what this file is testing.
vi.mock("@/app/actions/log", () => ({ logItem: vi.fn(), undoLastLog: vi.fn() }));
vi.mock("@/app/actions/swap", () => ({ swapMeal: vi.fn(), revertSwap: vi.fn() }));

const { default: Home } = await import("@/app/page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const CURSOR = { date: "2026-03-09", advancedPast: "meal:e1" };

/**
 * What `loadToday` hands back, with everything invented — Testing Strategy
 * § 1.5. The profile carries the metrics that must NOT reach the browser
 * alongside the four targets that must, which is what makes the narrowing in
 * the route assertable rather than merely visible.
 */
const PROFILE = {
  userId: SESSION.userId,
  // The demo persona's figures, as everywhere else outside `docs/` — see
  // scripts/check-no-metrics.sh on why a profile column never holds an
  // invented number in this repository.
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

const DINNER = {
  kind: "meal",
  meal: {
    slot: "dinner",
    meal: {
      id: "meal-1",
      userId: SESSION.userId,
      name: "Beef chilli",
      slotType: "dinner",
      kcal: 612,
      proteinG: 54.2,
      fatG: 14.6,
      carbG: 63.8,
      method: null,
      notes: null,
      isArchived: false,
    },
    source: "template",
    entryId: "entry-1",
  },
  key: "meal:entry-1",
  at: "19:00",
  minutes: 1140,
};

const VIEW = {
  date: "2026-03-09",
  minutesOfDay: 8 * 60,
  timeline: [],
  anytime: [],
  state: "nothing-planned",
};

/**
 * The meal library `loadToday` now returns (FUEL-23).
 *
 * `method` and `notes` are populated on purpose: they are what the route has to
 * DROP, and a library whose free-text columns were already null would let the
 * narrowing be deleted without a test noticing.
 */
const LIBRARY = [
  {
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
  },
];

const today = (overrides: Record<string, unknown> = {}) => ({
  view: VIEW,
  profile: PROFILE,
  exercises: new Map(),
  logs: { meals: [], workouts: [] },
  meals: LIBRARY,
  templatePlan: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  readCursor.mockResolvedValue(null);
});

describe("without a session", () => {
  test("redirects to the login screen and fetches nothing", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/login");

    // The redirect has to happen BEFORE the read, not alongside it. This is the
    // assertion that keeps the auth check next to the data rather than merely
    // near it.
    expect(loadToday).not.toHaveBeenCalled();
  });
});

describe("with a session", () => {
  test("resolves today for the session's own user", async () => {
    getSession.mockResolvedValue(SESSION);
    loadToday.mockResolvedValue(undefined);

    await Home();

    expect(redirect).not.toHaveBeenCalled();

    const [userId, now] = loadToday.mock.calls[0]!;

    // Never a user id from anywhere else. Everything below this line is scoped
    // to whatever is passed here.
    expect(userId).toBe(SESSION.userId);
    // The instant is read here and passed down, so that nothing beneath the
    // route reads a clock of its own.
    expect(now).toBeInstanceOf(Date);
  });

  test("hands the manual advance to the resolver", async () => {
    // The cursor lives in a cookie so that a tap survives the phone being
    // locked, and this is the only place it is read. A route that fetched
    // today without it would resolve from the clock alone — every skip
    // forgotten on the next render, which looks like the action not working.
    getSession.mockResolvedValue(SESSION);
    loadToday.mockResolvedValue(undefined);
    readCursor.mockResolvedValue(CURSOR);

    await Home();

    expect(loadToday.mock.calls[0]![2]).toEqual(CURSOR);
  });

  test("describes what will appear when the user has no profile", async () => {
    // A user exists before it is set up: no profile row, so no timezone, so no
    // day to resolve. Ordinary, and not an error.
    getSession.mockResolvedValue(SESSION);
    loadToday.mockResolvedValue(undefined);

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No plan yet");
    expect(screen.getByText(/once a profile and a weekly plan exist/)).toBeDefined();
  });

  test("renders the resolved view when there is one", async () => {
    getSession.mockResolvedValue(SESSION);
    loadToday.mockResolvedValue(today());

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nothing planned");
  });

  test("prints the day's log against the day's own plan", async () => {
    // The route is where the log rows meet the resolved items, because it is
    // the only place that holds both. A log carries a `meal_id`; the name comes
    // back from resolution, and this is the join.
    getSession.mockResolvedValue(SESSION);
    loadToday.mockResolvedValue(
      today({
        view: { ...VIEW, state: "day-complete", timeline: [DINNER], anytime: [] },
        logs: {
          meals: [
            {
              id: "log-1",
              userId: SESSION.userId,
              date: "2026-03-09",
              slot: "dinner",
              mealId: "meal-1",
              status: "eaten",
              note: null,
              loggedAt: new Date(0),
            },
          ],
          workouts: [],
        },
      }),
    );

    render(await Home());

    expect(screen.getByText("Beef chilli")).toBeDefined();
    expect(screen.getByText("Eaten")).toBeDefined();
    // The meal's own macros, totalled — so the join found the row rather than
    // falling back to the slot's name.
    expect(screen.getByText("612")).toBeDefined();
  });

  test("sends the four targets and no other body metric", async () => {
    // `profiles` also holds height, start and target weight and goal pace. None
    // of them appear on this screen, so none of them belong in a payload the
    // browser can read — PRD § Security & Compliance, and the reason the props
    // name four fields instead of handing over the row.
    getSession.mockResolvedValue(SESSION);
    loadToday.mockResolvedValue(
      today({ view: { ...VIEW, state: "day-complete", timeline: [DINNER] } }),
    );

    const { container } = render(await Home());

    expect(screen.getByText("1,780")).toBeDefined();
    expect(container.textContent).not.toContain("172");
    expect(container.textContent).not.toContain("84.2");
  });

  // What the route hands the browser, column by column, is asserted in
  // `page.payload.test.tsx` — it has to mock `RightNow` to see the props at
  // all, and mocking it here would gut every case above.
});
