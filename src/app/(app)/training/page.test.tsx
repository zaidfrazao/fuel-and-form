import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Training as TrainingView } from "@/lib/db/queries/training";
import type { Workout, WorkoutExercise, WorkoutLog } from "@/lib/db/schema";
import { WORKING_SECTION } from "@/lib/section";

/**
 * The `/training` route — the wire between the fetch and the screen.
 *
 * How the screen LOOKS is training.test.tsx's, against a fixture. What is left
 * here is the part only the route does: it refuses a caller with no session, it
 * turns a query parameter into a date without trusting it, it reads the clock
 * once, and it narrows the payload before anything crosses to the browser.
 *
 * The narrowing is the case worth the file. `workouts.description` holds the
 * session's entire protocol — a warm-up, a format, a cool-down, several hundred
 * words — and the browser has no use for a word of it. So does the row's
 * `user_id`, which Testing Strategy § 1.5 is about. Neither would look wrong in
 * a diff, and both are the sort of thing a later `...session.workout` spread
 * would quietly reintroduce.
 */

const { redirect, getSession, loadTraining } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates rendering of the
    // segment. A mock that merely recorded the call would let execution run on
    // into `loadTraining` with no session — the exact bug this test exists to
    // catch would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadTraining: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/training", () => ({ loadTraining }));
// The screen is a client component importing a "use server" module, which
// cannot be imported under jsdom. Same reason `/plan`'s test mocks its actions.
vi.mock("@/app/actions/training", () => ({
  setSessionStatus: vi.fn(),
  clearSessionStatus: vi.fn(),
}));

const { default: TrainingPage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const TODAY = "2026-03-12";
const USER = SESSION.userId;

/**
 * A workout carrying everything the row really holds — the protocol, the owner,
 * the rotation — so that "none of it crosses" is assertable rather than merely
 * visible.
 */
const WORKOUT: Workout = {
  id: "workout-circuit-a",
  userId: USER,
  name: "Bodyweight Circuit A",
  type: "circuit",
  description: "### Warm-up\n30 sec light skipping…\n### Format\n3 rounds…",
  rotationGroup: "bodyweight-circuit",
  rotationIndex: 0,
};

const EXERCISE: WorkoutExercise = {
  id: "exercise-1",
  userId: USER,
  workoutId: WORKOUT.id,
  name: "Press-ups",
  prescription: "3 x 12",
  sortOrder: 0,
  notes: null,
  section: WORKING_SECTION,
  targetSets: 3,
  targetRepsLow: 12,
  targetRepsHigh: 12,
};

const LOG: WorkoutLog = {
  id: "log-1",
  userId: USER,
  date: TODAY,
  workoutId: WORKOUT.id,
  status: "partial",
  note: "cut it short",
  durationMin: 18,
  loggedAt: new Date("2026-03-12T18:04:00Z"),
};

const training = (overrides: Partial<TrainingView> = {}): TrainingView => ({
  date: TODAY,
  today: TODAY,
  day: {
    date: TODAY,
    sessions: [
      {
        workout: WORKOUT,
        source: "rotation",
        entryId: "entry-circuit",
        kind: "session",
        exercises: [EXERCISE],
      },
    ],
  },
  logs: [LOG],
  sets: [],
  adherence: [[{ date: TODAY, label: WORKOUT.name, status: "partial" }]],
  bodyweightKg: 75,
  ...overrides,
});

/** The page is an async server component; render what it resolves to. */
const renderPage = async (date?: string) =>
  render(await TrainingPage({ searchParams: Promise.resolve({ date }) }));

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadTraining.mockResolvedValue(training());
});

describe("who is allowed in", () => {
  test("sends a caller with no session to the login screen", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    // The check is next to the data rather than in a layout, so nothing is
    // fetched for a caller who has not been let in.
    expect(loadTraining).not.toHaveBeenCalled();
  });
});

describe("the date the URL asks for", () => {
  test("passes a valid date through", async () => {
    await renderPage("2026-03-09");

    expect(loadTraining).toHaveBeenCalledWith(USER, "2026-03-09", expect.any(Date));
  });

  test("asks for today when no date is given", async () => {
    await renderPage();

    expect(loadTraining).toHaveBeenCalledWith(USER, null, expect.any(Date));
  });

  test("renders today rather than failing on a date it cannot read", async () => {
    // The one input on this screen a stranger fully controls, and
    // `parseCalendarDate` throws. The question is not whether a bad value is
    // rejected but whether rejecting it costs a 500 on a screen that could
    // perfectly well have shown today.
    for (const bad of ["not-a-date", "2026-02-31", "", "2026-3-9", "../../etc"]) {
      await renderPage(bad);

      expect(loadTraining).toHaveBeenLastCalledWith(USER, null, expect.any(Date));
    }
  });

  test("refuses a repeated parameter rather than picking one of its values", async () => {
    // `?date=x&date=y` arrives as an array. A URL that says two different
    // things has not asked a question this screen can answer.
    render(
      await TrainingPage({
        searchParams: Promise.resolve({ date: ["2026-03-09", "2026-03-10"] }),
      }),
    );

    expect(loadTraining).toHaveBeenCalledWith(USER, null, expect.any(Date));
  });

  test("reads the clock once, here", async () => {
    await renderPage();

    // Everything below takes the instant as an argument, which is what makes
    // the date a test asks for the date it gets.
    expect(loadTraining).toHaveBeenCalledWith(USER, null, expect.any(Date));
  });
});

describe("what crosses to the browser", () => {
  test("renders the session, its exercises and what was recorded", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Bodyweight Circuit A",
    );
    expect(screen.getByText("Press-ups")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Partial · 18 min");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Note").value).toBe("cut it short");
  });

  test("leaves the protocol, the owner and the rotation behind", async () => {
    const { container } = await renderPage();
    const payload = container.innerHTML;

    // Several hundred words of markdown that this screen never draws.
    expect(payload).not.toContain("Warm-up");
    expect(payload).not.toContain("light skipping");
    // Testing Strategy § 1.5 — no user id in a page payload.
    expect(payload).not.toContain(USER);
    expect(payload).not.toContain("bodyweight-circuit");
    // Nor the ids of rows the screen addresses by entry.
    expect(payload).not.toContain(WORKOUT.id);
    expect(payload).not.toContain(LOG.id);
  });

  test("matches a log to its own workout, not to the day", async () => {
    // Two rows on one date — the session's and the walk's. Keying on the date
    // alone would put the walk's status on the session.
    loadTraining.mockResolvedValue(
      training({
        logs: [
          { ...LOG, id: "log-walk", workoutId: "workout-daily-walk", status: "done" },
        ],
      }),
    );

    await renderPage();

    expect(screen.getByRole("status").textContent).toBe("Not recorded.");
  });
});

describe("before there is anything to show", () => {
  test("describes what will appear when the user has no profile", async () => {
    // A user exists before it is set up: no timezone, so no day to resolve.
    // § Tone of Voice asks an empty state to describe rather than nudge.
    loadTraining.mockResolvedValue(undefined);

    await renderPage();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No training yet");
    expect(screen.getByText(/Sessions appear here once/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

/**
 * FUEL-30 — the route's half of "past sessions are viewable and editable by
 * date".
 *
 * The resolution is `queries/training.ts`'s and the rotation underneath it is
 * `lib/rotation.ts`'s, whose § 1.2 case 6 already pins that a past date answers
 * exactly as it did on the day. What is asserted here is that the route carries
 * that answer through unchanged: the date the URL asked for is what gets
 * resolved, the record shown is the one filed against THAT date, and today stays
 * today while an earlier date is being reviewed.
 */
describe("a date that has already happened", () => {
  const PAST = "2026-03-04"; // a Wednesday, eight days before TODAY

  const past = () =>
    training({
      date: PAST,
      today: TODAY,
      day: { date: PAST, sessions: training().day.sessions },
      logs: [{ ...LOG, date: PAST }],
      adherence: [
        [
          { date: PAST, label: WORKOUT.name, status: "partial" },
          { date: TODAY, label: WORKOUT.name, status: "none" },
        ],
      ],
    });

  test("resolves the date the URL asked for, not today", async () => {
    loadTraining.mockResolvedValue(past());

    await renderPage(PAST);

    expect(loadTraining).toHaveBeenCalledWith(USER, PAST, expect.any(Date));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(WORKOUT.name);
  });

  test("shows what was recorded against that date, ready to be corrected", async () => {
    loadTraining.mockResolvedValue(past());

    await renderPage(PAST);

    // The status, the duration and the boxes the correction is made in. The
    // write itself is `actions/training.test.ts`'s; what this asserts is that
    // an edit to a past date starts from what that date actually holds.
    expect(screen.getByRole("status").textContent).toContain("Partial");
    expect(screen.getByRole("status").textContent).toContain("18 min");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Note").value).toBe(LOG.note);
    expect(screen.getByLabelText<HTMLInputElement>("Duration").value).toBe(
      String(LOG.durationMin),
    );
  });

  test("keeps the present where it is, and offers the way back to it", async () => {
    loadTraining.mockResolvedValue(past());

    await renderPage(PAST);

    // Reviewing an earlier date does not move today: the nav still offers a
    // next day, and FUEL-30's list still links forward to today's own screen.
    expect(
      screen.getByRole("link", { name: /Next day, Thu 5 Mar/ }).getAttribute("href"),
    ).toBe("/training?date=2026-03-05");
    expect(
      screen.getByRole("link", { name: /12 Mar/ }).getAttribute("href"),
    ).toBe(`/training?date=${TODAY}`);
  });
});
