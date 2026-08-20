import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Meal, MealLog, Workout, WorkoutLog } from "@/lib/db/schema";
import type { DayLogs } from "@/lib/log-intent";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";

/**
 * The action layer — what a tap is allowed to do, and what it refuses.
 *
 * The collaborators are all mocked, because all of them ARE the request: a
 * session cookie, a database connection, a cookie jar and the router's refresh.
 * What is left is the part only this file does, and it is the part with the
 * security argument in it — that the client sends a KEY and the server derives
 * the row, that nothing is written without a session, and that no path throws.
 *
 * The writes themselves are covered against real Postgres in
 * tests/integration/log.test.ts, and the decision they carry out in
 * src/lib/log-intent.test.ts.
 */

const { getSession, loadToday, recordLog, deleteLog, readCursor, writeCursor, refresh } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    loadToday: vi.fn(),
    recordLog: vi.fn(),
    deleteLog: vi.fn(),
    readCursor: vi.fn(),
    writeCursor: vi.fn(),
    refresh: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/today", () => ({ loadToday }));
vi.mock("@/lib/db/queries/log", () => ({ recordLog, deleteLog }));
vi.mock("@/lib/cursor-cookie", () => ({ readCursor, writeCursor }));
vi.mock("next/cache", () => ({ refresh }));

const { logItem, undoLastLog } = await import("./log");

const USER = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };
const MON = "2026-03-09";

const meal = (id: string, name: string): Meal => ({
  id,
  userId: USER,
  name,
  slotType: "breakfast",
  kcal: 420,
  proteinG: 32.5,
  fatG: 12,
  carbG: 48,
  method: null,
  notes: null,
  isArchived: false,
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

const scheduled = (item: NowItem, key: string, at: string, minutes: number): ScheduledItem => ({
  ...item,
  key,
  at,
  minutes,
});

const OATS = scheduled(
  {
    kind: "meal",
    meal: { slot: "breakfast", meal: meal("meal-1", "Oats"), source: "template", entryId: "e1" },
  },
  "meal:e1",
  "07:00",
  420,
);

const CIRCUIT = scheduled(
  {
    kind: "workout",
    workout: { workout: workout("workout-1", "Circuit A", "circuit"), source: "rotation", entryId: "e2" },
  },
  "workout:e2",
  "17:30",
  1050,
);

const WALK: AnytimeItem = {
  kind: "workout",
  workout: { workout: workout("workout-2", "Daily walk", "walk"), source: "fixed", entryId: "e3" },
  key: "workout:e3",
};

/**
 * A meal with no window — a slot whose time was cleared in settings.
 *
 * The OTHER way an item lands in `anytime`, and since FUEL-29 the only one this
 * module still writes: the walk beside it has `actions/log-walk.ts` and is
 * refused here. Without this fixture the anytime cases below would all be about
 * the walk, and there would be nothing left proving `itemFor` searches that list
 * at all.
 */
const SNACK: AnytimeItem = {
  kind: "meal",
  meal: { slot: "snack", meal: meal("meal-2", "Greek yoghurt"), source: "template", entryId: "e4" },
  key: "meal:e4",
};

const TIMELINE = [OATS, CIRCUIT];

const NO_LOGS: DayLogs = { meals: [], workouts: [] };

const view = (index: number): NowView =>
  ({
    date: MON,
    minutesOfDay: 8 * 60,
    timeline: TIMELINE,
    anytime: [WALK, SNACK],
    state: "active",
    index,
    active: TIMELINE[index]!,
    upcoming: TIMELINE.slice(index + 1),
  }) as NowView;

const today = (index = 0, logs: DayLogs = NO_LOGS) => ({
  view: view(index),
  profile: {},
  exercises: new Map(),
  logs,
});

/** A row against the day's walk — `workout-2`, the fixture's anytime walk. */
const walkLog = (fields: Partial<WorkoutLog> = {}): WorkoutLog => ({
  id: "walk-log",
  userId: USER,
  date: MON,
  workoutId: "workout-2",
  status: "done",
  note: null,
  durationMin: null,
  loggedAt: new Date("2026-03-09T19:30:00Z"),
  ...fields,
});

const log = (fields: Partial<MealLog> = {}): MealLog => ({
  id: "log-1",
  userId: USER,
  date: MON,
  slot: "breakfast",
  mealId: "meal-1",
  status: "eaten",
  note: null,
  loggedAt: new Date("2026-03-09T07:05:00Z"),
  ...fields,
});

beforeEach(() => {
  // `reset`, not `clear`: the refusal cases below install rejections, and
  // `clearAllMocks` keeps implementations while forgetting calls — so a
  // rejection set in one test would still be in place for the next, failing a
  // test that is not the one at fault.
  vi.restoreAllMocks();
  vi.resetAllMocks();

  getSession.mockResolvedValue(SESSION);
  readCursor.mockResolvedValue(null);
  loadToday.mockResolvedValue(today());
  deleteLog.mockResolvedValue(true);
});

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

describe("what it refuses", () => {
  test("writes nothing without a session", async () => {
    // A Server Action is reachable by anyone who can POST to the app, whatever
    // the screen offers. The session is resolved here, never trusted.
    getSession.mockResolvedValue(undefined);

    expect(await logItem("meal:e1", "log")).toEqual({ ok: false });
    expect(loadToday).not.toHaveBeenCalled();
    expect(recordLog).not.toHaveBeenCalled();
  });

  test("writes nothing for a user with no profile", async () => {
    loadToday.mockResolvedValue(undefined);

    expect(await logItem("meal:e1", "log")).toEqual({ ok: false });
    expect(recordLog).not.toHaveBeenCalled();
  });

  test("refuses a key today's plan does not hold", async () => {
    // The forged request, and the honest one made against a plan that changed
    // in another tab. Both are refused, and neither writes.
    expect(await logItem("meal:not-on-the-plan", "log")).toEqual({ ok: false });
    expect(recordLog).not.toHaveBeenCalled();
    expect(writeCursor).not.toHaveBeenCalled();
  });

  test("still reconciles the screen when the key is stale", async () => {
    // The second of those two cases is a screen that is out of date, and this
    // path returns before reaching the `refresh()` at the end. Without one
    // here, a tap on a card the plan changed underneath would be refused and
    // left stale — the opposite of "never wrong for longer than one tap".
    await logItem("meal:not-on-the-plan", "log");

    expect(refresh).toHaveBeenCalled();
  });

  test("refuses a verb it does not recognise, without writing", async () => {
    // `LogVerb` is a compile-time type and this is a public POST endpoint, so
    // nothing has checked the value by the time it arrives. Unchecked, it would
    // fall through to "not 'log'" and be recorded as a SKIP — a write chosen by
    // whoever sent the request.
    expect(await logItem("meal:e1", "eat" as never)).toEqual({ ok: false });
    expect(recordLog).not.toHaveBeenCalled();
    expect(loadToday).not.toHaveBeenCalled();
  });

  test("refuses an undo without a session", async () => {
    getSession.mockResolvedValue(undefined);

    expect(await undoLastLog()).toEqual({ ok: false });
    expect(deleteLog).not.toHaveBeenCalled();
  });

  test("never throws, whatever the database does", async () => {
    // A thrown action is a 500 with no value for the card to render, and the
    // banner it must show needs something to come back.
    recordLog.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await logItem("meal:e1", "log")).toEqual({ ok: false });

    deleteLog.mockRejectedValue(new Error("connection refused"));
    loadToday.mockResolvedValue(today(0, { meals: [log()], workouts: [] }));

    expect(await undoLastLog()).toEqual({ ok: false });
  });
});

/* -------------------------------------------------------------------------- */
/* Logging                                                                    */
/* -------------------------------------------------------------------------- */

describe("logging the active item", () => {
  test("derives the row from its own resolution, not from the caller", async () => {
    expect(await logItem("meal:e1", "log")).toEqual({ ok: true });

    // Nothing here came off the wire except the key: the date, the slot and the
    // meal id are all read out of the day the server resolved for itself.
    expect(recordLog).toHaveBeenCalledWith(USER, {
      kind: "meal",
      date: MON,
      slot: "breakfast",
      mealId: "meal-1",
      status: "eaten",
    });
  });

  test("resolves today with the cursor the request carries", async () => {
    const cursor = { date: MON, advancedPast: "meal:e1" };

    readCursor.mockResolvedValue(cursor);

    await logItem("workout:e2", "log");

    expect(loadToday).toHaveBeenCalledWith(USER, expect.any(Date), cursor);
  });

  test("advances past the item it just logged", async () => {
    await logItem("meal:e1", "log");

    expect(writeCursor).toHaveBeenCalledWith({ date: MON, advancedPast: "meal:e1" });
  });

  test("records a skip and advances the same way", async () => {
    await logItem("meal:e1", "skip");

    expect(recordLog).toHaveBeenCalledWith(USER, expect.objectContaining({ status: "skipped" }));
    expect(writeCursor).toHaveBeenCalledWith({ date: MON, advancedPast: "meal:e1" });
  });

  test("does not write the same log twice", async () => {
    // The double-tap, and the retry after a response that was lost. Either
    // would double-count in P4's totals, and `meal_logs` has no unique
    // constraint to refuse it.
    loadToday.mockResolvedValue(today(0, { meals: [log()], workouts: [] }));

    expect(await logItem("meal:e1", "log")).toEqual({ ok: true });
    expect(recordLog).not.toHaveBeenCalled();
  });

  test("does not advance twice for a tap on an item already passed", async () => {
    // A second tap arriving after the first advanced. It names an item that is
    // no longer active, so the cursor stays where it is — one tap, one item.
    loadToday.mockResolvedValue(today(1, { meals: [log()], workouts: [] }));

    expect(await logItem("meal:e1", "log")).toEqual({ ok: true });
    expect(writeCursor).not.toHaveBeenCalled();
  });

  test("logs an anytime item without moving the cursor", async () => {
    // A slot whose time was cleared in settings has no place in the timeline,
    // so advancing for it would skip whatever the clock says is happening.
    expect(await logItem("meal:e4", "log")).toEqual({ ok: true });

    expect(recordLog).toHaveBeenCalledWith(USER, {
      kind: "meal",
      date: MON,
      slot: "snack",
      mealId: "meal-2",
      status: "eaten",
    });
    expect(writeCursor).not.toHaveBeenCalled();
  });

  test("refreshes even when no cookie was written", async () => {
    // Reconciliation cannot depend on the cookie's own re-render, or logging an
    // unscheduled item would leave the screen showing a day without it.
    await logItem("meal:e4", "log");

    expect(refresh).toHaveBeenCalled();
  });

  test("refuses the daily walk, which is not this module's to write — FUEL-29", async () => {
    // The walk's key RESOLVES here — it is an item of the day like any other —
    // and no control sends it. But "no control sends it" is not a guard, and
    // this is a public POST endpoint: a forged request reaching `recordLog`
    // would INSERT a walk row with a status the walk's row cannot represent,
    // and the same row would then read "Done" on that row and "Skipped" in the
    // day summary beside it.
    expect(await logItem("workout:e3", "skip")).toEqual({ ok: false });

    expect(recordLog).not.toHaveBeenCalled();
    expect(writeCursor).not.toHaveBeenCalled();
  });

  test("refuses the walk however it is addressed", async () => {
    // Not only the skip. 'done' through this path would be a plain INSERT
    // colliding with the unique index the moment `logWalk` had already written
    // one — a refusal the user would read as "Try again" for a walk that is
    // already logged.
    expect(await logItem("workout:e3", "log")).toEqual({ ok: false });

    expect(recordLog).not.toHaveBeenCalled();
  });

  test("corrects a screen that sent the walk, rather than leaving it stale", async () => {
    await logItem("workout:e3", "log");

    expect(refresh).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Undo                                                                       */
/* -------------------------------------------------------------------------- */

describe("undo", () => {
  test("removes the most recent log of the day", async () => {
    const early = log({ id: "a", loggedAt: new Date("2026-03-09T07:05:00Z") });
    const late = log({ id: "b", loggedAt: new Date("2026-03-09T13:05:00Z") });

    loadToday.mockResolvedValue(today(1, { meals: [early, late], workouts: [] }));

    expect(await undoLastLog()).toEqual({ ok: true });
    expect(deleteLog).toHaveBeenCalledWith(USER, { kind: "meal", log: late });
  });

  test("steps the view back to the item it took back", async () => {
    loadToday.mockResolvedValue(today(1, { meals: [log()], workouts: [] }));

    await undoLastLog();

    // Position 1 is the circuit; stepping back to the oats means having
    // advanced past nothing at all, which is a cleared cookie.
    expect(writeCursor).toHaveBeenCalledWith(null);
  });

  test("leaves the view alone when the row was already gone", async () => {
    // Another tab got there first. Moving the cursor for a delete that removed
    // nothing would take the card back past an item that is still logged.
    loadToday.mockResolvedValue(today(1, { meals: [log()], workouts: [] }));
    deleteLog.mockResolvedValue(false);

    expect(await undoLastLog()).toEqual({ ok: true });
    expect(writeCursor).not.toHaveBeenCalled();
  });

  test("is not a failure when there is nothing to take back", async () => {
    // The card offers no undo in that state, so reaching here means the screen
    // was behind. A banner would report a problem the user does not have.
    expect(await undoLastLog()).toEqual({ ok: true });
    expect(deleteLog).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test("steps past the walk to the meal beneath it — FUEL-29", async () => {
    // The walk is logged from its own row and reverted from there. It is also
    // the MOST RECENT row here, so without the narrowing this control would
    // silently take back the walk when the user meant the meal.
    const meal = log({ id: "a", loggedAt: new Date("2026-03-09T07:05:00Z") });
    const walk = walkLog({ loggedAt: new Date("2026-03-09T19:30:00Z") });

    loadToday.mockResolvedValue(today(1, { meals: [meal], workouts: [walk] }));

    expect(await undoLastLog()).toEqual({ ok: true });
    expect(deleteLog).toHaveBeenCalledWith(USER, { kind: "meal", log: meal });
  });

  test("takes back nothing when the walk is all there is", async () => {
    // And does not move the cursor. The walk never advanced it, so retreating
    // would step the card past an item that is still logged — the failure the
    // narrowing exists to prevent, rather than merely the wrong row deleted.
    loadToday.mockResolvedValue(today(1, { meals: [], workouts: [walkLog()] }));

    expect(await undoLastLog()).toEqual({ ok: true });
    expect(deleteLog).not.toHaveBeenCalled();
    expect(writeCursor).not.toHaveBeenCalled();
  });

  test("still takes back a session logged from the bar", async () => {
    // The narrowing is the WALK's, not every workout's. A session logged from
    // the card is the bar's own row and has to stay in its stack.
    const session = walkLog({ id: "s", workoutId: "workout-1" });

    loadToday.mockResolvedValue(today(1, { meals: [], workouts: [session] }));

    await undoLastLog();

    expect(deleteLog).toHaveBeenCalledWith(USER, { kind: "workout", log: session });
  });
});
