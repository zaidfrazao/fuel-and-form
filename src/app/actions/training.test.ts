import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Training } from "@/lib/db/queries/training";
import type { Workout, WorkoutExercise } from "@/lib/db/schema";
import { WORKING_SECTION } from "@/lib/section";

/**
 * P3's action layer — what a tap on a STATUS is allowed to write.
 *
 * Mocked the way `plan.test.ts` and `swap.test.ts` are: the session, the
 * database and `refresh()` all ARE the request, so what is left is the part
 * only this file does. Two things carry the weight here, and neither is
 * observable from the screen:
 *
 *   1. **The workout id is never taken from the caller.** The client sends a
 *      template entry id; this action re-resolves the date and reads the
 *      workout off its own answer. A `workoutId` parameter would let a forged
 *      request file a session against a workout that date never scheduled —
 *      stored, invisible to every screen, and still summed by the export.
 *   2. **A date before the program starts is refused**, because it resolves to
 *      no sessions at all and there is therefore no entry to match.
 *
 * The statement itself — that a second status REPLACES the first rather than
 * adding a row — is covered against real Postgres in
 * tests/integration/training.test.ts. It cannot be asserted here, because the
 * unique index that makes it true lives in the database.
 */

const {
  getSession,
  loadTraining,
  recordSession,
  clearSession,
  logSet,
  removeSet,
  refresh,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadTraining: vi.fn(),
  recordSession: vi.fn(),
  clearSession: vi.fn(),
  logSet: vi.fn(),
  removeSet: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/training", () => ({
  loadTraining,
  recordSession,
  clearSession,
  logSet,
  removeSet,
}));
vi.mock("next/cache", () => ({ refresh }));

const {
  clearSessionStatus,
  logExerciseSet,
  removeExerciseSet,
  setSessionStatus,
} = await import("./training");

const USER = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };

const DATE = "2026-03-09"; // a Monday inside the program
const ENTRY = "entry-monday-circuit";
const CIRCUIT = "workout-circuit-b";
const WALK_ENTRY = "entry-daily-walk";

const EXERCISE = "exercise-press-ups";

/** An exercise of the circuit, narrowed to what the resolver hands over. */
const exercise = (id: string): WorkoutExercise => ({
  id,
  userId: USER,
  workoutId: CIRCUIT,
  name: "Press-ups",
  prescription: "3 x 12",
  sortOrder: 0,
  notes: null,
  section: WORKING_SECTION,
  targetSets: 3,
  targetRepsLow: 12,
  targetRepsHigh: 12,
});

const workout = (id: string, name: string, type: string): Workout => ({
  id,
  userId: USER,
  name,
  type,
  description: null,
  rotationGroup: null,
  rotationIndex: null,
});

/** A resolved day with the circuit and the walk on it, as the screen sees it. */
const training = (): Training => ({
  date: DATE,
  today: DATE,
  day: {
    date: DATE,
    sessions: [
      {
        workout: workout(CIRCUIT, "Bodyweight Circuit B", "circuit"),
        source: "rotation",
        entryId: ENTRY,
        kind: "session",
        exercises: [exercise(EXERCISE)],
      },
      {
        workout: workout("workout-daily-walk", "Daily Walk", "walk"),
        source: "fixed",
        entryId: WALK_ENTRY,
        kind: "walk",
        exercises: [],
      },
    ],
  },
  logs: [],
  sets: [],
  adherence: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadTraining.mockResolvedValue(training());
  recordSession.mockResolvedValue(undefined);
  clearSession.mockResolvedValue(true);
  logSet.mockResolvedValue(undefined);
  removeSet.mockResolvedValue(true);
});

describe("setting a status", () => {
  test("records the entry against the workout the date resolved to", async () => {
    const result = await setSessionStatus({
      date: DATE,
      entryId: ENTRY,
      status: "partial",
      note: "  cut it at three rounds  ",
      durationMin: "22",
    });

    expect(result).toEqual({ ok: true });
    expect(recordSession).toHaveBeenCalledWith(USER, {
      date: DATE,
      workoutId: CIRCUIT,
      status: "partial",
      note: "cut it at three rounds",
      durationMin: 22,
    });
    // The screen is server-rendered from the row that just changed.
    expect(refresh).toHaveBeenCalled();
  });

  test("takes the workout id from its own resolution, never from the caller", async () => {
    // The heart of it. A caller that smuggles a workout id gets it ignored: the
    // entry is what is matched, and the workout comes off the resolved day.
    await setSessionStatus({
      date: DATE,
      entryId: ENTRY,
      status: "done",
      // @ts-expect-error -- not in the signature; this is a forged request.
      workoutId: "workout-something-else",
    });

    expect(recordSession).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ workoutId: CIRCUIT }),
    );
  });

  test("resolves the date being written, not today", async () => {
    await setSessionStatus({ date: DATE, entryId: ENTRY, status: "done" });

    // Third argument is the instant; the second is the date under edit. A past
    // session is the point of the screen, so loading today here would file
    // every correction against the wrong day.
    expect(loadTraining).toHaveBeenCalledWith(USER, DATE, expect.any(Date));
  });

  test("refuses an entry the date does not hold, and re-renders the screen", async () => {
    const result = await setSessionStatus({
      date: DATE,
      entryId: "entry-from-another-day",
      status: "done",
    });

    expect(result).toEqual({ ok: false });
    expect(recordSession).not.toHaveBeenCalled();
    // A plan that changed underneath the screen is the innocent explanation,
    // and this is what makes a retry able to succeed.
    expect(refresh).toHaveBeenCalled();
  });

  test("refuses a date the program has not started on", async () => {
    // `loadTraining` resolves no sessions before `program_start_date`, so there
    // is nothing to match and the refusal needs no separate check. The row it
    // would otherwise write is one no screen could ever show or take back.
    loadTraining.mockResolvedValue({ ...training(), day: { date: DATE, sessions: [] } });

    expect(await setSessionStatus({ date: "2026-01-01", entryId: ENTRY, status: "done" })).toEqual(
      { ok: false },
    );
    expect(recordSession).not.toHaveBeenCalled();
  });

  test("refuses a malformed date before it costs a query", async () => {
    const result = await setSessionStatus({
      date: "not-a-date",
      entryId: ENTRY,
      status: "done",
    });

    expect(result).toEqual({ ok: false });
    // A refusal that costs a round trip is one an attacker can use to make the
    // database work. `plan.ts` parses first for the same reason.
    expect(loadTraining).not.toHaveBeenCalled();
  });

  test("refuses a bad status, a bad note and a bad duration without querying", async () => {
    const bad = [
      { status: "finished" },
      { status: "eaten" },
      { status: "done", note: "x".repeat(501) },
      { status: "done", durationMin: -5 },
      { status: "done", durationMin: 20.5 },
    ];

    for (const input of bad) {
      expect(await setSessionStatus({ date: DATE, entryId: ENTRY, ...input })).toEqual({
        ok: false,
      });
    }

    expect(loadTraining).not.toHaveBeenCalled();
    expect(recordSession).not.toHaveBeenCalled();
  });

  test("refuses without a session, and never reaches the data layer", async () => {
    getSession.mockResolvedValue(null);

    expect(await setSessionStatus({ date: DATE, entryId: ENTRY, status: "done" })).toEqual({
      ok: false,
    });
    expect(loadTraining).not.toHaveBeenCalled();
    expect(recordSession).not.toHaveBeenCalled();
  });

  test("refuses when the user has no profile row", async () => {
    // No timezone, so no resolved day and nothing to log against.
    loadTraining.mockResolvedValue(undefined);

    expect(await setSessionStatus({ date: DATE, entryId: ENTRY, status: "done" })).toEqual({
      ok: false,
    });
    expect(recordSession).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the write fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    recordSession.mockRejectedValue(new Error("connection lost"));

    expect(await setSessionStatus({ date: DATE, entryId: ENTRY, status: "done" })).toEqual({
      ok: false,
    });
    // § Feedback wants an inline banner and a "Try again", which needs a value
    // to come back. A thrown action is a 500 with nothing to render.
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  test("refuses the walk, which is on the plan but has no control", async () => {
    // The walk resolves on this date — it is on the template every day — so
    // this refusal is not "the entry does not exist". It is deliberate: the
    // screen renders the walk as a row and offers nothing to set, edit or clear
    // it, so a walk row written here would be one no screen can show or take
    // back. That is the same failure the action refuses for a workout the date
    // does not schedule. FUEL-29 opens the path and adds the control together.
    const result = await setSessionStatus({
      date: DATE,
      entryId: WALK_ENTRY,
      status: "done",
    });

    expect(result).toEqual({ ok: false });
    expect(recordSession).not.toHaveBeenCalled();
  });

  test("still resolves the session on a day that also holds a walk", async () => {
    // The filter is on `kind`, not on position, so the walk sitting beside the
    // session cannot shadow it — the seed puts the walk second on every weekday.
    await setSessionStatus({ date: DATE, entryId: ENTRY, status: "done" });

    expect(recordSession).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ workoutId: CIRCUIT }),
    );
  });
});

describe("clearing a status", () => {
  test("deletes the row at that date and workout", async () => {
    expect(await clearSessionStatus({ date: DATE, entryId: ENTRY })).toEqual({ ok: true });
    expect(clearSession).toHaveBeenCalledWith(USER, DATE, CIRCUIT);
    expect(refresh).toHaveBeenCalled();
  });

  test("reports ok when there was nothing to clear", async () => {
    // The screen offers no revert in that state, so reaching here means it was
    // behind. `refresh()` is the correction; a banner would report a problem
    // the user does not have.
    clearSession.mockResolvedValue(false);

    expect(await clearSessionStatus({ date: DATE, entryId: ENTRY })).toEqual({ ok: true });
  });

  test("refuses an entry the date does not hold", async () => {
    expect(await clearSessionStatus({ date: DATE, entryId: "entry-elsewhere" })).toEqual({
      ok: false,
    });
    expect(clearSession).not.toHaveBeenCalled();
  });

  test("refuses without a session", async () => {
    getSession.mockResolvedValue(null);

    expect(await clearSessionStatus({ date: DATE, entryId: ENTRY })).toEqual({ ok: false });
    expect(clearSession).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the delete fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    clearSession.mockRejectedValue(new Error("connection lost"));

    expect(await clearSessionStatus({ date: DATE, entryId: ENTRY })).toEqual({ ok: false });
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* FUEL-91 — a set, and the two things a caller may not choose                */
/* -------------------------------------------------------------------------- */

const logging = (overrides: Record<string, unknown> = {}) => ({
  date: DATE,
  entryId: ENTRY,
  exerciseId: EXERCISE,
  setIndex: 1,
  reps: 12,
  ...overrides,
});

describe("logging a set", () => {
  test("writes it against the workout the date resolved to", async () => {
    expect(await logExerciseSet(logging())).toEqual({ ok: true });

    // The workout comes from the server's own resolution — the client sent an
    // entry id and an exercise id, and nothing else about the address.
    expect(logSet).toHaveBeenCalledWith(USER, {
      date: DATE,
      workoutId: CIRCUIT,
      exerciseId: EXERCISE,
      setIndex: 1,
      reps: 12,
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("takes the numbers a form sends as strings", async () => {
    expect(await logExerciseSet(logging({ setIndex: "2", reps: "8" }))).toEqual({
      ok: true,
    });
    expect(logSet).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ setIndex: 2, reps: 8 }),
    );
  });

  test("refuses an exercise the session does not hold", async () => {
    // The hole the composite foreign key does NOT close: another user's
    // exercise is refused by Postgres, but one of your OWN belonging to a
    // different workout would store — a set performed in a session that never
    // contained that movement, invisible to every screen and still exported.
    expect(await logExerciseSet(logging({ exerciseId: "exercise-elsewhere" }))).toEqual({
      ok: false,
    });
    expect(logSet).not.toHaveBeenCalled();
  });

  test("refuses an entry the date does not hold", async () => {
    expect(await logExerciseSet(logging({ entryId: "entry-elsewhere" }))).toEqual({
      ok: false,
    });
    expect(logSet).not.toHaveBeenCalled();
  });

  test("refuses the walk, which is not a session", async () => {
    expect(await logExerciseSet(logging({ entryId: WALK_ENTRY }))).toEqual({ ok: false });
    expect(logSet).not.toHaveBeenCalled();
  });

  test("refuses a date the program does not cover", async () => {
    // No sessions resolve, so there is no entry to match — the same refusal the
    // status makes, at the same end of the calendar.
    loadTraining.mockResolvedValue({ ...training(), day: { date: DATE, sessions: [] } });

    expect(await logExerciseSet(logging())).toEqual({ ok: false });
    expect(logSet).not.toHaveBeenCalled();
  });

  test.each([
    ["zero reps", { reps: 0 }],
    ["negative reps", { reps: -8 }],
    ["a fraction", { reps: 8.5 }],
    ["a number that is not one", { reps: "eight" }],
    ["more reps than anyone performs", { reps: 100000 }],
    ["a zeroth set", { setIndex: 0 }],
    ["a set index past the ceiling", { setIndex: 1e9 }],
  ])("refuses %s before it reaches the database", async (_case, overrides) => {
    expect(await logExerciseSet(logging(overrides))).toEqual({ ok: false });
    expect(logSet).not.toHaveBeenCalled();
  });

  test("refuses out-of-range values without asking the database anything", async () => {
    // The refusal costs no query, on `plan.ts`'s reasoning: a refusal that
    // costs a round trip is a refusal that can be used to make the database
    // work.
    await logExerciseSet(logging({ reps: 0 }));

    expect(loadTraining).not.toHaveBeenCalled();
  });

  test("refuses without a session", async () => {
    getSession.mockResolvedValue(null);

    expect(await logExerciseSet(logging())).toEqual({ ok: false });
    expect(logSet).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the write fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    logSet.mockRejectedValue(new Error("connection lost"));

    expect(await logExerciseSet(logging())).toEqual({ ok: false });
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  test("does not touch the session's status", async () => {
    // PRD § P10: the status is never derived from set data. The parent row is
    // `logSet`'s to create, at a default it never revisits — see queries.
    await logExerciseSet(logging());

    expect(recordSession).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
});

describe("removing a set", () => {
  const removal = { date: DATE, entryId: ENTRY, exerciseId: EXERCISE, setIndex: 1 };

  test("removes it at the address the date resolved to", async () => {
    expect(await removeExerciseSet(removal)).toEqual({ ok: true });
    expect(removeSet).toHaveBeenCalledWith(USER, {
      date: DATE,
      workoutId: CIRCUIT,
      exerciseId: EXERCISE,
      setIndex: 1,
    });
  });

  test("is ok when the set was already gone", async () => {
    // The screen offers no tick to untick in that state, so reaching here means
    // it was behind — `refresh()` is the correction, and a banner would report
    // a problem the reader does not have.
    removeSet.mockResolvedValue(false);

    expect(await removeExerciseSet(removal)).toEqual({ ok: true });
  });

  test("refuses an exercise the session does not hold", async () => {
    expect(
      await removeExerciseSet({ ...removal, exerciseId: "exercise-elsewhere" }),
    ).toEqual({ ok: false });
    expect(removeSet).not.toHaveBeenCalled();
  });

  test("refuses a set index that was never storable", async () => {
    expect(await removeExerciseSet({ ...removal, setIndex: 1e9 })).toEqual({ ok: false });
    expect(removeSet).not.toHaveBeenCalled();
  });

  test("refuses without a session", async () => {
    getSession.mockResolvedValue(null);

    expect(await removeExerciseSet(removal)).toEqual({ ok: false });
    expect(removeSet).not.toHaveBeenCalled();
  });

  test("leaves the session's own record alone", async () => {
    // Deriving nothing from set data cuts both ways: a status the reader chose
    // is not something a set removal may take away.
    await removeExerciseSet(removal);

    expect(clearSession).not.toHaveBeenCalled();
    expect(recordSession).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the delete fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    removeSet.mockRejectedValue(new Error("connection lost"));

    expect(await removeExerciseSet(removal)).toEqual({ ok: false });
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});
