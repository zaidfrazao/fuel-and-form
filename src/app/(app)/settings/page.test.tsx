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
// FUEL-47's control, for the same reason one line up — and one more of its own:
// its actions reach `queries/push.ts`, which is `server-only`, so importing the
// page at all fails to collect without this.
vi.mock("@/app/actions/push", () => ({
  subscribeToWalkReminder: vi.fn(),
  unsubscribeFromWalkReminder: vi.fn(),
}));

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

describe("the up-link", () => {
  /*
   * `/settings` is parented to `/` — § Navigation's route table — and the link
   * above the `<h1>` used to say "Right Now" while `/plan`'s said "Right now"
   * for the same screen. The name is the shell's name now, resolved from the
   * table by `up-link.tsx`, so there is one of it.
   */
  test("goes up to Now, named as a way back", async () => {
    render(await SettingsPage());

    expect(
      screen.getByRole("link", { name: "Back to Now" }).getAttribute("href"),
    ).toBe("/");
  });

  /*
   * Settings links DOWN to the weekly template and across to the plan, and
   * § Navigation is explicit that neither is a parent: "Settings keeps its
   * link to it... but a link is not a parent." They keep their register — body
   * text, not the up-link's eyebrow — and their destination names.
   */
  test("does not turn the links Settings offers into second ways back", async () => {
    render(await SettingsPage());

    expect(
      screen.getByRole("link", { name: "Weekly template" }).getAttribute("href"),
    ).toBe("/plan/template");
    expect(
      screen.getByRole("link", { name: "Weekly plan" }).getAttribute("href"),
    ).toBe("/plan");
    expect(screen.queryByRole("link", { name: "Back to Plan" })).toBeNull();
  });
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
    // § Tone of Voice: describe the thing rather than sell it.
    //
    // The sentence used to name both of P6's audiences at once — "your backup,
    // and the file your check-in reads". FUEL-38 made that untrue: the check-in
    // is the weekly CSV now, and this file is the backup alone.
    render(await SettingsPage());

    expect(screen.getByText(/Your backup\./)).toBeTruthy();
  });

  test("sends a check-in to the weekly plan, where the week is chosen", async () => {
    // The CSV has no link of its own here, because it has no file of its own
    // until a week is picked — and `/plan` is the screen that picks one. What
    // this page owes is a signpost: it is where someone looking for "export"
    // arrives.
    render(await SettingsPage());

    const link = screen.getByRole("link", { name: "open the weekly plan" });

    expect(link.getAttribute("href")).toBe("/plan");
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

describe("the push control", () => {
  /**
   * FUEL-47, and the gate is the whole of what the ROUTE decides about it —
   * `push-form.tsx` owns everything after it renders.
   *
   * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined at build time, so it is stubbed on
   * `process.env` here rather than passed: that is where the page reads it, and
   * a test that passed it as a prop would assert nothing about the gate.
   */
  const KEY = "NEXT_PUBLIC_VAPID_PUBLIC_KEY";

  /**
   * `findBy`, not `getBy`, in every case here including the absences.
   *
   * `PushForm` renders NOTHING until it has asked the browser what this device
   * can do — see its `checking` state, which exists so the control cannot show
   * "Turn on" and flip to "Turn off" a moment later. So a `getBy` immediately
   * after `render` would be asserting against the first paint, in which the
   * section is legitimately absent whether the gate opened or not: the positive
   * test would fail and, worse, the negative one would pass for the wrong
   * reason and keep passing after the gate was deleted.
   *
   * The absences therefore wait too, through the same query, so that "not
   * there" means "not there after the component had its chance" — under
   * coverage, where everything is slower, as well as here.
   */
  const heading = () => screen.findByRole("heading", { name: "Notify this device" });

  test("is offered when the deployment has a key to subscribe with", async () => {
    vi.stubEnv(KEY, "BExamplePublicKey");

    render(await SettingsPage());

    expect(await heading()).toBeTruthy();
  });

  test("is absent entirely when it has none", async () => {
    // Not a disabled button and not a sentence explaining an absence. There is
    // nothing to subscribe WITH, so there is nothing to say — P9 asks push to
    // degrade silently, and the banner is unaffected either way.
    vi.stubEnv(KEY, "");

    render(await SettingsPage());

    await expect(heading()).rejects.toThrow();
  });

  test("is offered to an account with no profile, unlike the export", async () => {
    // Deliberately NOT gated on the profile. A subscription is a row against a
    // user id; the timezone the scheduled job needs is that job's problem, and
    // it checks for one itself. Asserted because the neighbouring section IS
    // gated, and copying that gate here would be the easy mistake.
    vi.stubEnv(KEY, "BExamplePublicKey");
    loadSchedule.mockResolvedValue(undefined);

    render(await SettingsPage());

    expect(await heading()).toBeTruthy();
  });
});

describe("the route itself", () => {
  test("sends a caller with no session to the login screen, reading nothing", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(loadSchedule).not.toHaveBeenCalled();
  });
});
