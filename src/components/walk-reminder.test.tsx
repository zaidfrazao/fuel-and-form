import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Who gets a walk reminder, and what it says — FUEL-46, § P9.
 *
 * The decision about the DAY — the reminder time, the template, the log — is
 * `queries/walk-reminder.ts`'s, and it is proved against a real database in
 * `tests/integration/walk-reminder.test.ts`. This file is the gate in front of
 * it and the markup behind it: the two things that would be invisible if they
 * went wrong quietly.
 *
 *   - `/login` has no session, and must not be a 500. This renders in the root
 *     layout, so every route in the app pays for a mistake here.
 *   - nothing may be queried for a signed-out visitor. A layout that hit the
 *     database on the login screen would be a login screen that could not
 *     render while the database was down.
 *   - the sentence is the criterion's sentence, and the link goes to the screen
 *     the walk can actually be logged from.
 */

const { getSession, loadWalkReminder } = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadWalkReminder: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/walk-reminder", () => ({ loadWalkReminder }));

const { WalkReminder } = await import("./walk-reminder");

const USER_ID = "11111111-2222-3333-4444-555555555555";

/** Renders the async server component. */
const renderReminder = async () => render(await WalkReminder());

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: USER_ID, kind: "owner" });
  loadWalkReminder.mockResolvedValue({ at: "19:00" });
});

describe("WalkReminder", () => {
  test("shows the reminder the query returned", async () => {
    await renderReminder();

    expect(
      screen.getByText(/Walk not logged\. Reminder set for 19:00\./),
    ).toBeTruthy();
  });

  test("names the configured time rather than a fixed one", async () => {
    loadWalkReminder.mockResolvedValue({ at: "21:15" });

    await renderReminder();

    expect(screen.getByText(/Reminder set for 21:15\./)).toBeTruthy();
  });

  test("offers the way to log the walk, on `/`", async () => {
    await renderReminder();

    const link = screen.getByRole("link", { name: "Log the walk." });

    expect(link.getAttribute("href")).toBe("/");
  });

  test("is a labelled landmark, so it can be skipped once per screen", async () => {
    // § Accessibility, and the demo banner's reasoning: this sits above every
    // page, and without the landmark a screen-reader user hears it before every
    // one with no way past.
    await renderReminder();

    expect(screen.getByRole("complementary", { name: "Walk reminder" })).toBeTruthy();
  });

  test("shows nothing when the query says there is nothing to show", async () => {
    // One answer for all five reasons — reminder off, too early, no walk
    // planned, already logged, no profile. The component does not distinguish
    // them because it renders the same thing for each.
    loadWalkReminder.mockResolvedValue(undefined);

    const { container } = await renderReminder();

    expect(container.innerHTML).toBe("");
  });

  test("does not show, or query, with no session at all", async () => {
    // `/login`. Every route renders through this layout, and this one has
    // nobody to remind.
    getSession.mockResolvedValue(undefined);

    const { container } = await renderReminder();

    expect(container.innerHTML).toBe("");
    expect(loadWalkReminder).not.toHaveBeenCalled();
  });

  test("asks about the signed-in user, at the instant of the request", async () => {
    await renderReminder();

    const [userId, now] = loadWalkReminder.mock.calls[0]!;

    expect(userId).toBe(USER_ID);
    expect(now).toBeInstanceOf(Date);
  });

  test("carries no dismiss control", async () => {
    // "Dismisses on log" is not the same as dismissible, and the absence is the
    // design — see the component. A dismiss button appearing here later would
    // be a snooze nobody specified, and it would need a lifetime to be wrong
    // about.
    await renderReminder();

    expect(screen.queryByRole("button")).toBeNull();
  });
});
