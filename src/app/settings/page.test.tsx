import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `/settings` — the route, not the form.
 *
 * `slot-times-form.test.tsx` covers the form this screen renders. What is left
 * here is what the route itself decides, and FUEL-37 added the case worth a
 * file: the export link.
 *
 * That link is gated on the profile, and the gate is load-bearing rather than
 * cosmetic. `GET /api/export` answers 404 without a profile row — no timezone,
 * so no date to name a file with — so a link offered in that state would be a
 * link that reliably fails. Both halves are asserted, because a gate is only a
 * gate if something checks the closed side.
 */

const { redirect, getSession, loadSchedule } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates the render. A mock
    // that only recorded the call would let the page run on with no session.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadSchedule: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/profile", () => ({ loadSchedule }));
// The form is a client component importing a "use server" module, which cannot
// be imported under jsdom. The same reason `/weight`'s test mocks its actions.
vi.mock("@/app/actions/settings", () => ({ saveSlotTimes: vi.fn() }));

const { default: SettingsPage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const SCHEDULE = {
  slotTimes: { breakfast: "07:30" },
  workoutTimes: { circuit: "06:30" },
  timezone: "Europe/London",
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadSchedule.mockResolvedValue(SCHEDULE);
});

describe("the export link", () => {
  test("points at the endpoint, as a plain anchor", async () => {
    render(await SettingsPage());

    const link = screen.getByRole("link", { name: "Export everything" });

    expect(link.getAttribute("href")).toBe("/api/export");

    // No `download` attribute, deliberately. It would name the file from the
    // URL's last segment — "export" — while the server is already naming it
    // `fuel-form-<date>.json` in the header, and two sources for one filename
    // is one more than can be right.
    expect(link.hasAttribute("download")).toBe(false);
  });

  test("says what the file is for", async () => {
    // § Tone of Voice: describe the thing rather than sell it. The sentence
    // names both audiences P6 has — the backup, and the check-in.
    render(await SettingsPage());

    expect(screen.getByText(/Your backup, and the file your check-in reads/)).toBeTruthy();
  });

  test("is absent for an account with no profile", async () => {
    // The route answers 404 in this state. An offered link that reliably fails
    // is worse than no link, and § Tone of Voice would rather say nothing than
    // promise something that does not work.
    loadSchedule.mockResolvedValue(undefined);

    render(await SettingsPage());

    expect(screen.queryByRole("link", { name: "Export everything" })).toBeNull();
  });
});

describe("the route itself", () => {
  test("sends a caller with no session to the login screen, reading nothing", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(loadSchedule).not.toHaveBeenCalled();
  });
});
