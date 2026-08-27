import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ShoppingWeek } from "@/lib/db/queries/shopping";

/**
 * The `/shopping` route — the wire between the fetch and the list.
 *
 * How the list BEHAVES is shopping-list-view.test.tsx's, against a fixture.
 * What is left here is the part only the route does: it refuses a caller with
 * no session, it turns a query parameter into a week without trusting it, it
 * reads the clock once, and it says something useful when there is nothing to
 * show.
 *
 * The `?week=` cases carry the file, for `plan/page.test.tsx`'s reason: it is
 * the one input on this screen a stranger fully controls, `parseCalendarDate`
 * throws, and the question is not whether a bad value is rejected but whether
 * rejecting it costs the user a 500 on a screen that could have shown them this
 * week.
 */

const { redirect, getSession, loadShoppingWeek } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates rendering of the
    // segment. A mock that merely recorded the call would let execution run on
    // into `loadShoppingWeek` with no session — the exact bug this test exists
    // to catch would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadShoppingWeek: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/shopping", () => ({ loadShoppingWeek }));
// The list is a client component importing a "use server" module, which cannot
// be imported under jsdom. `plan/page.test.tsx` mocks its actions for the same
// reason.
vi.mock("@/app/actions/shopping", () => ({ setChecked: vi.fn() }));

const { default: ShoppingPage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const MON = "2026-03-09";
const WED = "2026-03-11";

const WEEK: ShoppingWeek = {
  monday: MON,
  today: MON,
  groups: [
    {
      category: "meat",
      lines: [
        {
          key: "beef mince",
          name: "Beef mince",
          category: "meat",
          grams: 300,
          gramsPartial: false,
          measures: [],
          times: 2,
        },
      ],
    },
  ],
  checked: ["beef mince"],
};

const page = async (params: Record<string, string | string[]> = {}) =>
  render(await ShoppingPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadShoppingWeek.mockResolvedValue(WEEK);
});

/* -------------------------------------------------------------------------- */
/* The session                                                                */
/* -------------------------------------------------------------------------- */

describe("the session", () => {
  test("sends a caller with no session to the login screen", async () => {
    getSession.mockResolvedValue(null);

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/login");

    // And nothing is read on the way past. A check that let the fetch run would
    // still redirect, and would still be a query executed for a stranger.
    expect(loadShoppingWeek).not.toHaveBeenCalled();
  });

  test("reads the week for the session's own user", async () => {
    await page();

    expect(loadShoppingWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), null);
  });
});

/* -------------------------------------------------------------------------- */
/* ?week=                                                                     */
/* -------------------------------------------------------------------------- */

describe("the week parameter", () => {
  test("passes a date the URL names through to the fetch", async () => {
    await page({ week: WED });

    expect(loadShoppingWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), WED);
  });

  test("falls back to this week rather than failing on a malformed date", async () => {
    // A person can edit a URL, and § Tone of Voice would rather show them a
    // week than an error page. `requestedWeek` makes the call; this asserts the
    // route is actually using it.
    await page({ week: "not-a-date" });

    expect(loadShoppingWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), null);
  });

  test("refuses to guess when the URL names two weeks", async () => {
    await page({ week: [MON, WED] });

    expect(loadShoppingWeek).toHaveBeenCalledWith(SESSION.userId, expect.any(Date), null);
  });
});

/* -------------------------------------------------------------------------- */
/* What renders                                                               */
/* -------------------------------------------------------------------------- */

describe("the screen", () => {
  test("renders the list, with what the server says is ticked already ticked", async () => {
    await page();

    const box = screen.getByRole("checkbox", { name: /Beef mince/ }) as HTMLInputElement;

    expect(box.checked).toBe(true);
  });

  test("offers the week's neighbours without leaving the screen", async () => {
    // The shared `WeekNav`, pointed at `/shopping` rather than `/plan`. Getting
    // this wrong navigates away from the list, which is the one failure here
    // that looks like a working control.
    await page();

    expect(
      screen.getByRole("link", { name: /Previous week/ }).getAttribute("href"),
    ).toBe("/shopping?week=2026-03-02");
    expect(screen.getByRole("link", { name: /Next week/ }).getAttribute("href")).toBe(
      "/shopping?week=2026-03-16",
    );
  });

  test("links back to the plan for the week being shown", async () => {
    // Carrying the week, so the two screens cannot end up a week apart.
    await page({ week: WED });

    // Named "Back to Plan", not "Weekly plan". The header link used to be a
    // bare destination name in the same register as a cross-link — see
    // `up-link.tsx`, which is where the naming is now decided for all four
    // screens that carry one.
    expect(screen.getByRole("link", { name: "Back to Plan" }).getAttribute("href")).toBe(
      `/plan?week=${MON}`,
    );
  });

  test("keeps the up-link distinct from the link that resets the week", async () => {
    // Both go to `/plan`-ish places and both are a "way back", which is why
    // they are asserted together: one moves up a level carrying the week, the
    // other stays on this screen and drops it. § Navigation's cross-link rule
    // is about exactly this collision.
    loadShoppingWeek.mockResolvedValue({ ...WEEK, monday: "2026-03-16", today: MON });

    await page({ week: "2026-03-16" });

    expect(screen.getByRole("link", { name: "Back to Plan" }).getAttribute("href")).toBe(
      "/plan?week=2026-03-16",
    );
    expect(
      screen.getByRole("link", { name: "Back to this week" }).getAttribute("href"),
    ).toBe("/shopping");
  });

  test("offers a way back when the week shown is not the current one", async () => {
    loadShoppingWeek.mockResolvedValue({ ...WEEK, monday: "2026-03-16", today: MON });

    await page({ week: "2026-03-16" });

    expect(screen.getByRole("link", { name: "Back to this week" })).toBeDefined();
  });

  test("does not offer a way back when the week shown IS the current one", async () => {
    await page();

    expect(screen.queryByRole("link", { name: "Back to this week" })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

describe("nothing to show", () => {
  test("describes what will appear when the account has no profile", async () => {
    // § Tone of Voice: an empty state describes what will appear rather than
    // nudging. Not "Set up your profile!".
    loadShoppingWeek.mockResolvedValue(undefined);

    await page();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "No shopping list yet",
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("says the week is unplanned rather than congratulating an empty list", async () => {
    // "Nothing to buy!" would read as an achievement. This week simply has no
    // meals on it yet.
    loadShoppingWeek.mockResolvedValue({ ...WEEK, groups: [], checked: [] });

    await page();

    expect(screen.getByText(/Nothing is planned for this week yet/)).toBeDefined();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("still offers the week navigation on an unplanned week", async () => {
    // The way OUT of an empty week is the control that moves to another one.
    loadShoppingWeek.mockResolvedValue({ ...WEEK, groups: [], checked: [] });

    await page();

    expect(screen.getByRole("link", { name: /Next week/ })).toBeDefined();
  });
});
