import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { WeighInHistory } from "@/lib/db/queries/weight";
import type { WeightLog } from "@/lib/db/schema";
import { RECENT_WEIGH_INS } from "@/lib/weigh-in";

/**
 * The `/weight` route — the wire between the fetch and the screen.
 *
 * How the screen LOOKS is weigh-ins.test.tsx's, against a fixture. What is left
 * here is the part only the route does: it refuses a caller with no session, it
 * reads the clock once, and it narrows the payload before anything crosses to
 * the browser.
 *
 * The narrowing is the case worth the file, and it is a slightly different case
 * from `/training`'s. There is no several-hundred-word protocol to leave behind
 * — a weigh-in row is small — but it carries an `id`, and an id is exactly what
 * this feature must not hand the client. The date is the address (see
 * `queries/weight.ts`), so an id in the payload would be an identifier the
 * browser could hold and send back and have ignored. That, and `user_id`, which
 * Testing Strategy § 1.5 is about. Neither would look wrong in a diff, and both
 * are the sort of thing a later `...entry` spread would quietly reintroduce.
 */

const { redirect, getSession, loadWeighIns } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates rendering of the
    // segment. A mock that merely recorded the call would let execution run on
    // into `loadWeighIns` with no session — the exact bug this test exists to
    // catch would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadWeighIns: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/weight", () => ({ loadWeighIns }));
// The screen is a client component importing a "use server" module, which
// cannot be imported under jsdom. Same reason `/training`'s test mocks its
// actions.
vi.mock("@/app/actions/weight", () => ({
  saveWeighIn: vi.fn(),
  deleteWeighIn: vi.fn(),
  earlierWeighIns: vi.fn(),
  weighInOn: vi.fn(),
}));

const { default: WeightPage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };
const TODAY = "2026-08-20";

/** A row carrying everything the table really holds, so "none of it crosses" is
 * assertable rather than merely visible. */
const ROW: WeightLog = {
  id: "b2f1c0de-0000-4000-8000-000000000001",
  userId: SESSION.userId,
  date: "2026-08-13",
  weightKg: 80.1,
  note: "before breakfast",
  createdAt: new Date("2026-08-13T05:30:00Z"),
};

/** The persona's own figures, invented — Testing Strategy § 1.5 keeps the
 * owner's real metrics out of a public repository. */
const START_KG = 84.2;
const TARGET_KG = 76;
const GOAL_PACE = 0.5;

/**
 * Fourteen consecutive days, newest first — four more than the window.
 *
 * Every row carries a note, and the notes are distinct, so "which notes crossed"
 * is a question the rendered markup can answer.
 */
const LONG: WeightLog[] = Array.from({ length: 14 }, (_, index) => ({
  ...ROW,
  id: `b2f1c0de-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
  date: `2026-08-${String(20 - index).padStart(2, "0")}`,
  weightKg: Math.round((80 - index / 10) * 10) / 10,
  note: `weighed on day ${index}`,
}));

const history = (entries: WeightLog[] = [ROW]): WeighInHistory => ({
  today: TODAY,
  entries,
  startWeightKg: START_KG,
  targetWeightKg: TARGET_KG,
  goalPaceKgPerWeek: GOAL_PACE,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadWeighIns.mockResolvedValue(history());
});

describe("the route", () => {
  test("sends a caller with no session to the login screen", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(WeightPage()).rejects.toThrow("NEXT_REDIRECT:/login");

    // The check is in front of the data, not beside it: nothing is fetched for
    // a request that has no user to fetch it for.
    expect(loadWeighIns).not.toHaveBeenCalled();
  });

  test("fetches for the session's own user, with one reading of the clock", async () => {
    await WeightPage();

    expect(loadWeighIns).toHaveBeenCalledOnce();
    expect(loadWeighIns.mock.calls[0]?.[0]).toBe(SESSION.userId);
    expect(loadWeighIns.mock.calls[0]?.[1]).toBeInstanceOf(Date);
  });

  test("renders an empty state rather than inventing a profile", async () => {
    // No profile row: no timezone, so no "today" to default the form to. §
    // Tone of Voice asks an empty state to describe what will appear.
    loadWeighIns.mockResolvedValue(undefined);

    render(await WeightPage());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No weigh-ins yet");
    expect(screen.queryByLabelText("Weight")).toBeNull();
  });

  test("keeps the row's id, owner and created_at out of the payload", async () => {
    const { container } = render(await WeightPage());
    const markup = container.innerHTML;

    // The id first: the date is the address, so an id here would be an
    // identifier the client could hold and nothing would honour.
    expect(markup).not.toContain(ROW.id);
    expect(markup).not.toContain(SESSION.userId);
    expect(markup).not.toContain("2026-08-13T05:30");

    // What SHOULD cross, so the assertions above cannot pass by rendering
    // nothing at all.
    expect(screen.getByRole("button", { name: /80.1 kg/ })).toBeTruthy();
    expect(screen.getByText(/before breakfast/)).toBeTruthy();
  });

  test("gives the screen today from the profile's zone, not the browser's", async () => {
    // The date input's ceiling is the user's today. It arrives as data from the
    // query layer; nothing under this route reads a clock of its own.
    render(await WeightPage());

    expect(screen.getByLabelText("Date").getAttribute("max")).toBe(TODAY);
  });

  test("gives the screen the profile's goal pace rather than a figure of its own", async () => {
    // FUEL-36. The pace is the only thing on this route the trailing rate is
    // judged against, and P7 gives the demo persona its own — so a constant
    // anywhere below here would grade a visitor's history against the owner's
    // program. Asserted through the rendered comparison because the pass-through
    // is the whole of what this route does with it.
    //
    // Two rows, because one weigh-in is not a rate and a screen with nothing to
    // compare would print no goal to check the pass-through against.
    loadWeighIns.mockResolvedValue(
      history([
        ROW,
        {
          ...ROW,
          id: "b2f1c0de-0000-4000-8000-000000000002",
          date: "2026-08-06",
          weightKg: 80.8,
          note: null,
        },
      ]),
    );

    render(await WeightPage());

    expect(screen.getByText(/goal 0.50 kg\/wk/)).toBeTruthy();
  });

  test("lists the newest weigh-ins and no more, however many the query returned", async () => {
    // FUEL-84. The list used to render every row there was — 58 on the demo
    // account, 4333px, six and a half screens — because nothing bounded it.
    loadWeighIns.mockResolvedValue(history(LONG));

    render(await WeightPage());

    expect(
      within(screen.getByRole("list", { name: "Weigh-ins" })).getAllByRole("listitem"),
    ).toHaveLength(RECENT_WEIGH_INS);
  });

  test("keeps the notes of unlisted weigh-ins out of the payload", async () => {
    /*
     * The criterion: the payload does not carry what the screen does not render.
     * The note is the whole of what that comes to here — it is the one field
     * only the list draws, and at `MAX_NOTE_LENGTH` it is five hundred
     * characters against a reading's thirty-odd.
     */
    loadWeighIns.mockResolvedValue(history(LONG));

    const { container } = render(await WeightPage());

    expect(container.innerHTML).not.toContain("weighed on day 13");
    expect(container.innerHTML).not.toContain("weighed on day 10");

    // The listed ones still carry theirs, so the assertions above cannot pass
    // by rendering no notes at all.
    expect(screen.getByText(/weighed on day 0/)).toBeTruthy();
    expect(screen.getByText(/weighed on day 9/)).toBeTruthy();
  });

  test("still sends every reading, because the chart draws every one", async () => {
    /*
     * The other half of the same criterion, and the reason the bound is on the
     * notes rather than on the rows. FUEL-35 asks for the full history and
     * § Accessibility obliges the chart to carry "an adjacent data table", so
     * an unlisted weigh-in is still rendered — as a point, and as a row of that
     * table. A payload narrowed to the window would narrow the chart with it.
     */
    loadWeighIns.mockResolvedValue(history(LONG));

    render(await WeightPage());

    const table = screen.getByRole("table").textContent;
    const oldest = LONG[LONG.length - 1]!;

    expect(table).toContain(`${oldest.weightKg} kg`);
    expect(table).toContain("Fri 7 Aug");
  });
});
