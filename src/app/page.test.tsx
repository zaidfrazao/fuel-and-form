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

const { default: Home } = await import("@/app/page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const CURSOR = { date: "2026-03-09", advancedPast: "meal:e1" };

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
    loadToday.mockResolvedValue({
      view: {
        date: "2026-03-09",
        minutesOfDay: 8 * 60,
        timeline: [],
        anytime: [],
        state: "nothing-planned",
      },
      profile: {},
      exercises: new Map(),
      logs: { meals: [], workouts: [] },
    });

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nothing planned");
  });
});
