import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Meal, Profile } from "@/lib/db/schema";

/**
 * The `/plan` route — the wire between the fetch and the grid.
 *
 * How the table LOOKS is week-grid.test.tsx's, against a fixture. What is left
 * here is the part only the route does: it refuses a caller with no session, it
 * turns a query parameter into a week without trusting it, it reads the clock
 * once, and it narrows the payload before anything crosses to the browser.
 *
 * The `?week=` cases are the ones worth the file. It is the one input on this
 * screen a stranger fully controls, and `parseCalendarDate` throws — so the
 * question is not whether a bad value is rejected but whether rejecting it
 * costs the user a 500 on a screen that could perfectly well have shown them
 * this week.
 */

const { redirect, getSession, loadWeek } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates rendering of the
    // segment. A mock that merely recorded the call would let execution run on
    // into `loadWeek` with no session — the exact bug this test exists to catch
    // would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadWeek: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/week", () => ({ loadWeek }));
// The grid is a client component importing "use server" modules, which cannot
// be imported under jsdom. Same reason `page.test.tsx` mocks the log actions.
vi.mock("@/app/actions/plan", () => ({
  swapOnDate: vi.fn(),
  repeatFromDate: vi.fn(),
  revertOnDate: vi.fn(),
}));

const { default: PlanPage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const MON = "2026-03-09";
const TUE = "2026-03-10";

/**
 * A profile carrying the metrics that must NOT reach the browser alongside the
 * four targets that must — Testing Strategy § 1.5, and what makes the
 * narrowing assertable rather than merely visible.
 */
const PROFILE = {
  userId: SESSION.userId,
  timezone: "Europe/London",
  programStartDate: "2026-03-02",
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
  targetWeightKg: "76.0",
  slotTimes: {},
} as unknown as Profile;

const CHILLI = {
  id: "m1",
  userId: SESSION.userId,
  name: "Chilli con Carne",
  slotType: "dinner",
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  method: "## Method\nBrown the mince, then simmer for forty minutes.",
  notes: "Freezes well",
  isArchived: false,
} as unknown as Meal;

const week = (over: Record<string, unknown> = {}) => ({
  monday: MON,
  today: TUE,
  profile: PROFILE,
  meals: [CHILLI],
  days: [{ date: MON, meals: [{ slot: "dinner", meal: CHILLI, source: "template", entryId: "t1" }] }],
  templateDays: [
    { date: MON, meals: [{ slot: "dinner", meal: CHILLI, source: "template", entryId: "t1" }] },
  ],
  ...over,
});

const params = (search: Record<string, string | string[]> = {}) =>
  ({ searchParams: Promise.resolve(search) }) as never;

const show = async (search: Record<string, string | string[]> = {}) =>
  render(await PlanPage(params(search)));

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadWeek.mockResolvedValue(week());
});

describe("the route", () => {
  test("sends a caller with no session to the login screen", async () => {
    getSession.mockResolvedValue(null);

    await expect(show()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(loadWeek).not.toHaveBeenCalled();
  });

  test("renders the week it is given", async () => {
    await show();

    expect(screen.getByRole("heading", { name: "Weekly plan" })).toBeTruthy();
    expect(screen.getByText("9 – 15 Mar 2026")).toBeTruthy();
  });

  test("says which table a tap here writes", async () => {
    await show();

    // The mirror of the sentence `/plan/template` opens with. The two screens
    // write different tables and the difference is the whole of P2.
    expect(screen.getByText(/that date only/)).toBeTruthy();
    expect(screen.getByText(/template is unchanged/)).toBeTruthy();
  });

  test("has an empty state when the user has no profile row", async () => {
    loadWeek.mockResolvedValue(undefined);

    await show();

    expect(screen.getByRole("heading", { name: "No plan yet" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("has an empty state when the library is empty", async () => {
    // Rendering the grid would give thirty-five cells opening a picker with
    // nothing in it.
    loadWeek.mockResolvedValue(week({ meals: [] }));

    await show();

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/once there are meals in the library/)).toBeTruthy();
  });
});

describe("which week", () => {
  test("no parameter asks for the current week", async () => {
    await show();

    expect(loadWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), null);
  });

  test("a valid parameter is passed through", async () => {
    await show({ week: "2026-03-16" });

    expect(loadWeek).toHaveBeenCalledWith(
      SESSION.userId,
      expect.any(Date),
      "2026-03-16",
    );
  });

  test("a malformed parameter renders this week rather than a 500", async () => {
    // The one input a stranger fully controls. `parseCursor` makes the same
    // call: the honest answer to a value we do not recognise is the answer to
    // no value at all.
    await show({ week: "nonsense" });

    expect(loadWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), null);
    expect(screen.getByRole("heading", { name: "Weekly plan" })).toBeTruthy();
  });

  test("a repeated parameter is refused rather than half-obeyed", async () => {
    // A URL that says two different things has not asked a question this screen
    // can answer, and picking one of the values would answer a question nobody
    // asked.
    await show({ week: ["2026-03-16", "2026-04-06"] });

    expect(loadWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), null);
  });

  test("offers a way back only when showing another week", async () => {
    await show();
    expect(screen.queryByRole("link", { name: "Back to this week" })).toBeNull();

    loadWeek.mockResolvedValue(week({ monday: "2026-03-16" }));
    await show({ week: "2026-03-16" });

    expect(screen.getByRole("link", { name: "Back to this week" })).toBeTruthy();
  });

  test("prev and next name the weeks they lead to", async () => {
    await show();

    // "Previous" alone tells a screen-reader user nothing about where they
    // would land.
    expect(
      screen.getByRole("link", { name: "Previous week, 2 – 8 Mar 2026" }).getAttribute("href"),
    ).toBe("/plan?week=2026-03-02");
    expect(
      screen.getByRole("link", { name: "Next week, 16 – 22 Mar 2026" }).getAttribute("href"),
    ).toBe("/plan?week=2026-03-16");
  });
});

describe("the payload", () => {
  test("drops the columns the browser has no business holding", async () => {
    const { container } = await show();

    const payload = container.innerHTML;

    // The method and notes are free text this table never renders. The four
    // targets DO cross, because the swap sheet totals the day against them.
    expect(payload).not.toContain("Brown the mince");
    expect(payload).not.toContain("Freezes well");
  });

  test("does not ship the owner's body metrics", async () => {
    const { container } = await show();

    // Testing Strategy § 1.5. `targetWeightKg` is on the profile the query
    // returns and has no business on a screen showing meal names.
    expect(container.innerHTML).not.toContain("76.0");
  });
});
