import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Meal, Workout } from "@/lib/db/schema";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";

/**
 * The swap's action layer — what a tap on Swap is allowed to write.
 *
 * The collaborators are all mocked, because all of them ARE the request: a
 * session cookie, a database connection, a cookie jar and the router's refresh.
 * What is left is the part only this file does, and it is the part carrying the
 * security argument — that the DATE and the SLOT are re-derived on the server
 * from a key, that the one client-supplied value is checked against the
 * caller's own library before it reaches a statement, and that no path throws.
 *
 * The statement itself is covered against real Postgres in
 * tests/integration/swap.test.ts — including the two guarantees this file
 * cannot observe, that the template is untouched and that next week's same
 * weekday is unaffected.
 */

const {
  getSession,
  loadToday,
  writeOverride,
  writeOverrides,
  deleteOverride,
  readCursor,
  refresh,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadToday: vi.fn(),
  writeOverride: vi.fn(),
  writeOverrides: vi.fn(),
  deleteOverride: vi.fn(),
  readCursor: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/today", () => ({ loadToday }));
vi.mock("@/lib/db/queries/swap", () => ({ writeOverride, writeOverrides, deleteOverride }));
vi.mock("@/lib/cursor-cookie", () => ({ readCursor }));
vi.mock("next/cache", () => ({ refresh }));

const { repeatMeal, swapMeal, revertSwap } = await import("./swap");

const USER = "11111111-2222-3333-4444-555555555555";
const OTHER_USER = "99999999-8888-7777-6666-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };
const MON = "2026-03-09";

const meal = (id: string, name: string, fields: Partial<Meal> = {}): Meal => ({
  id,
  userId: USER,
  name,
  slotType: "dinner",
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  method: null,
  notes: null,
  isArchived: false,
  ...fields,
});

const workout = (id: string, name: string): Workout => ({
  id,
  userId: USER,
  name,
  type: "circuit",
  description: null,
  rotationGroup: null,
  rotationIndex: null,
});

const CHILLI = meal("meal-chilli", "Chilli con Carne");
const CURRY = meal("meal-curry", "Chickpea Curry", { kcal: 560, proteinG: 24 });
const STEW = meal("meal-stew", "Beef Stew", { isArchived: true });
const OWNERS_ONLY = meal("meal-elsewhere", "Someone else's dinner", { userId: OTHER_USER });

const LIBRARY = [CHILLI, CURRY, STEW];

const scheduled = (item: NowItem, key: string, at: string, minutes: number): ScheduledItem => ({
  ...item,
  key,
  at,
  minutes,
});

/** Dinner, resolved from the TEMPLATE — the ordinary starting state. */
const DINNER = scheduled(
  {
    kind: "meal",
    meal: { slot: "dinner", meal: CHILLI, source: "template", entryId: "template-entry" },
  },
  "meal:template-entry",
  "18:30",
  1110,
);

/** The same slot after a swap — resolved from an override row. */
const SWAPPED_DINNER = scheduled(
  {
    kind: "meal",
    meal: { slot: "dinner", meal: CURRY, source: "override", entryId: "override-row" },
  },
  "meal:override-row",
  "18:30",
  1110,
);

const CIRCUIT = scheduled(
  {
    kind: "workout",
    workout: { workout: workout("workout-1", "Circuit A"), source: "rotation", entryId: "e2" },
  },
  "workout:e2",
  "06:30",
  390,
);

/** A meal with no configured window — reachable, but not on the timeline. */
const SNACK: AnytimeItem = {
  kind: "meal",
  meal: { slot: "snack", meal: CHILLI, source: "template", entryId: "snack-entry" },
  key: "meal:snack-entry",
};

const view = (active: ScheduledItem = DINNER): NowView =>
  ({
    date: MON,
    minutesOfDay: 18 * 60,
    timeline: [CIRCUIT, active],
    anytime: [SNACK],
    state: "active",
    index: 1,
    active,
    upcoming: [],
  }) as NowView;

const today = (active?: ScheduledItem, meals: Meal[] = LIBRARY) => ({
  view: view(active),
  profile: {},
  exercises: new Map(),
  logs: { meals: [], workouts: [] },
  meals,
});

beforeEach(() => {
  // `reset`, not `clear`: the refusal cases below install rejections, and
  // `clearAllMocks` keeps implementations while forgetting calls — so a
  // rejection set in one test would still be in place for the next.
  vi.restoreAllMocks();
  vi.resetAllMocks();

  getSession.mockResolvedValue(SESSION);
  readCursor.mockResolvedValue(null);
  loadToday.mockResolvedValue(today());
  writeOverride.mockResolvedValue(undefined);
  writeOverrides.mockResolvedValue(undefined);
  deleteOverride.mockResolvedValue(true);
});

/* -------------------------------------------------------------------------- */
/* What it writes                                                             */
/* -------------------------------------------------------------------------- */

describe("swapMeal", () => {
  test("writes the override for the resolved date and slot", async () => {
    expect(await swapMeal("meal:template-entry", CURRY.id)).toEqual({ ok: true });

    expect(writeOverride).toHaveBeenCalledWith(USER, {
      date: MON,
      slot: "dinner",
      mealId: CURRY.id,
    });
  });

  test("takes the date and the slot from its own resolution, never the caller", async () => {
    // The security property. The client names an item and a meal; everything
    // that decides WHERE the row lands comes back out of `loadToday`. There is
    // no date in the payload to tamper with because there is no date in the
    // payload.
    await swapMeal("meal:template-entry", CURRY.id);

    const [, override] = writeOverride.mock.calls[0]!;

    expect(override.date).toBe(MON);
    expect(override.slot).toBe("dinner");
  });

  test("scopes the write to the session's user", async () => {
    await swapMeal("meal:template-entry", CURRY.id);

    expect(writeOverride.mock.calls[0]![0]).toBe(USER);
  });

  test("swaps a slot that has already been swapped", async () => {
    // Second thoughts about dinner are ordinary. The row is unique on
    // (user_id, date, slot), so this lands on the one already there — see
    // queries/swap.ts. What matters here is that the action does not refuse it.
    loadToday.mockResolvedValue(today(SWAPPED_DINNER));

    expect(await swapMeal("meal:override-row", CHILLI.id)).toEqual({ ok: true });
    expect(writeOverride).toHaveBeenCalledWith(USER, {
      date: MON,
      slot: "dinner",
      mealId: CHILLI.id,
    });
  });

  test("swaps a meal that has no configured window", async () => {
    // `anytime` is searched as well as the timeline. A slot whose time was
    // cleared in settings is still a slot, and still swappable.
    expect(await swapMeal("meal:snack-entry", CURRY.id)).toEqual({ ok: true });
    expect(writeOverride).toHaveBeenCalledWith(USER, {
      date: MON,
      slot: "snack",
      mealId: CURRY.id,
    });
  });

  test("does not move the cursor", async () => {
    // A swap changes WHAT the active item is, not whether it is done. The
    // module imports no cursor writer at all, which is the strongest form of
    // this assertion available — `refresh()` is the whole of the reconciliation.
    await swapMeal("meal:template-entry", CURRY.id);

    expect(refresh).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

describe("what swapMeal refuses", () => {
  test("writes nothing without a session", async () => {
    // A Server Action is reachable by anyone who can POST to the app, whatever
    // the screen offers. The session is resolved here, never trusted.
    getSession.mockResolvedValue(undefined);

    expect(await swapMeal("meal:template-entry", CURRY.id)).toEqual({ ok: false });
    expect(loadToday).not.toHaveBeenCalled();
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("writes nothing for a user with no profile", async () => {
    loadToday.mockResolvedValue(undefined);

    expect(await swapMeal("meal:template-entry", CURRY.id)).toEqual({ ok: false });
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("refuses a key today's plan does not hold", async () => {
    expect(await swapMeal("meal:not-on-the-plan", CURRY.id)).toEqual({ ok: false });
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("still reconciles the screen when the key is stale", async () => {
    // A genuine tap on a card another tab changed underneath. This path returns
    // before the `refresh()` at the end, so without one here the screen would
    // be refused and left stale.
    await swapMeal("meal:not-on-the-plan", CURRY.id);

    expect(refresh).toHaveBeenCalled();
  });

  test("refuses a key naming a workout", async () => {
    // There is no such thing as swapping a session, and `day_plan_overrides`
    // has no column that could hold one. Unrefused, this would reach
    // `item.meal` on a workout item.
    expect(await swapMeal("workout:e2", CURRY.id)).toEqual({ ok: false });
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("refuses a meal id that is not in the caller's library", async () => {
    // The one client-supplied value. Unchecked, a hand-rolled POST could
    // schedule any uuid at all, and the failure would surface as a foreign-key
    // violation — a 500, with no banner for the screen to show.
    expect(await swapMeal("meal:template-entry", "00000000-0000-0000-0000-000000000000")).toEqual({
      ok: false,
    });
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("refuses another user's meal", async () => {
    // `loadToday` is scoped, so the owner's library never contains it and the
    // lookup simply fails. The composite foreign key (meal_id, user_id) is the
    // second line underneath; this is the first, and it is the one that answers
    // with `{ ok: false }` rather than an exception.
    expect(await swapMeal("meal:template-entry", OWNERS_ONLY.id)).toEqual({ ok: false });
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("reconciles the screen when the meal is gone or retired", async () => {
    // Both refusals mean the browser's library disagrees with the database —
    // the meal was archived or deleted in another tab. Without a refresh the
    // picker would go on offering it and every retry would fail identically,
    // which is a loop with no way out of it.
    await swapMeal("meal:template-entry", STEW.id);
    expect(refresh).toHaveBeenCalled();

    refresh.mockClear();

    await swapMeal("meal:template-entry", "00000000-0000-0000-0000-000000000000");
    expect(refresh).toHaveBeenCalled();
  });

  test("refuses an archived meal", async () => {
    // The picker filters archived meals out, so no screen offers one. That is
    // only a rule if the write path agrees with it — otherwise the way anyone
    // finds out is a retired meal reappearing on a plan.
    expect(await swapMeal("meal:template-entry", STEW.id)).toEqual({ ok: false });
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("never throws, whatever the database does", async () => {
    // A thrown action is a 500 with no value for the card to render, and the
    // banner § Feedback asks for needs something to come back.
    writeOverride.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await swapMeal("meal:template-entry", CURRY.id)).toEqual({ ok: false });
  });
});

/* -------------------------------------------------------------------------- */
/* Repeat                                                                     */
/* -------------------------------------------------------------------------- */

/** The resolved day, moved to a date the run has to step off the end of. */
const todayOn = (date: string) => ({ ...today(), view: { ...view(), date } });

/** The dates a call actually wrote, in the order it wrote them. */
const written = () =>
  (writeOverrides.mock.calls[0]?.[1] as { date: string }[]).map((row) => row.date);

describe("repeatMeal", () => {
  test("writes the meal onto the resolved date and the days after it", async () => {
    // "Repeat for 2 days" is Monday AND Tuesday — the count includes the day it
    // starts on, which is what makes the button's copy and its write agree.
    expect(await repeatMeal("meal:template-entry", CURRY.id, 2)).toEqual({ ok: true });

    expect(writeOverrides).toHaveBeenCalledWith(USER, [
      { date: "2026-03-09", slot: "dinner", mealId: CURRY.id },
      { date: "2026-03-10", slot: "dinner", mealId: CURRY.id },
    ]);
  });

  test("writes every date in ONE call", async () => {
    // The acceptance criterion's "in one action", read as a property of the
    // database rather than of the tap. A loop here would be a repeat that can
    // land on Monday and Tuesday and not Wednesday.
    await repeatMeal("meal:template-entry", CURRY.id, 5);

    expect(writeOverrides).toHaveBeenCalledTimes(1);
    expect(written()).toHaveLength(5);
  });

  test("keeps the slot the server resolved, on every date", async () => {
    // The slot is re-derived from the key exactly as `swapMeal` derives it, and
    // a repeat cannot vary it per date — one slot and one meal is what makes it
    // a repeat rather than five separate swaps.
    await repeatMeal("meal:template-entry", CURRY.id, 3);

    const rows = writeOverrides.mock.calls[0]?.[1] as { slot: string; mealId: string }[];

    expect(rows.every((row) => row.slot === "dinner")).toBe(true);
    expect(rows.every((row) => row.mealId === CURRY.id)).toBe(true);
  });

  test("crosses a week boundary", async () => {
    // Saturday into Sunday into Monday. The resolver stores day_of_week
    // 0 = Sunday and displays Monday-first, so a run that stopped at either
    // week end would be the most plausible-looking bug available here.
    loadToday.mockResolvedValue(todayOn("2026-03-07"));

    await repeatMeal("meal:template-entry", CURRY.id, 3);

    expect(written()).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  test("crosses a month boundary", async () => {
    loadToday.mockResolvedValue(todayOn("2026-03-30"));

    await repeatMeal("meal:template-entry", CURRY.id, 3);

    expect(written()).toEqual(["2026-03-30", "2026-03-31", "2026-04-01"]);
  });

  test("crosses a year boundary", async () => {
    loadToday.mockResolvedValue(todayOn("2026-12-31"));

    await repeatMeal("meal:template-entry", CURRY.id, 2);

    expect(written()).toEqual(["2026-12-31", "2027-01-01"]);
  });

  test("starts from the resolved day, not the process clock", async () => {
    // The suite runs in America/New_York and the resolved day is a London date.
    // A version that read `new Date()` here would start the run on whatever
    // today happens to be when the suite is run — and be wrong on EVERY date in
    // the run rather than on one of them.
    loadToday.mockResolvedValue(todayOn("2026-03-30"));

    await repeatMeal("meal:template-entry", CURRY.id, 2);

    expect(written()[0]).toBe("2026-03-30");
  });

  test("repeats from a slot that is already overridden", async () => {
    // "I made too much, ignore what I said about Wednesday." The starting date
    // already carries an override, and repeating from it is ordinary.
    loadToday.mockResolvedValue(today(SWAPPED_DINNER));

    expect(await repeatMeal("meal:override-row", CHILLI.id, 2)).toEqual({ ok: true });
    expect(written()).toEqual(["2026-03-09", "2026-03-10"]);
  });

  test("re-resolves the day, so the screen catches up", async () => {
    await repeatMeal("meal:template-entry", CURRY.id, 2);

    expect(refresh).toHaveBeenCalled();
  });
});

describe("what repeatMeal refuses", () => {
  test("a count outside the range, writing nothing", async () => {
    // Nothing the sheet can produce reaches here — this is the hand-rolled
    // POST, and `days` is the one client value that multiplies rows written.
    for (const days of [0, 1, 8, 30, 100_000, -3]) {
      expect(await repeatMeal("meal:template-entry", CURRY.id, days)).toEqual({
        ok: false,
      });
    }

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("a count that is not a whole number", async () => {
    for (const days of [2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await repeatMeal("meal:template-entry", CURRY.id, days)).toEqual({
        ok: false,
      });
    }

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("a count that is not a number at all", async () => {
    expect(
      await repeatMeal("meal:template-entry", CURRY.id, "3" as unknown as number),
    ).toEqual({ ok: false });

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("a bad count without refreshing — the screen is not the thing that is wrong", async () => {
    // The two refusals below DO refresh, because they mean the browser's copy
    // of the library disagrees with the database. A bad count says nothing
    // about the data, so re-resolving would cost a render and fix nothing.
    await repeatMeal("meal:template-entry", CURRY.id, 99);

    expect(refresh).not.toHaveBeenCalled();
  });

  test("a meal that is not in the caller's own library", async () => {
    expect(await repeatMeal("meal:template-entry", OWNERS_ONLY.id, 3)).toEqual({
      ok: false,
    });

    expect(writeOverrides).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test("an archived meal, on the same terms swapMeal refuses one", async () => {
    // A retired meal must not be schedulable — and a repeat is the way to put
    // one on seven days at once, so the check cannot be left to the picker.
    expect(await repeatMeal("meal:template-entry", STEW.id, 3)).toEqual({ ok: false });

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("a key today's plan does not hold", async () => {
    expect(await repeatMeal("meal:not-today", CURRY.id, 3)).toEqual({ ok: false });

    expect(writeOverrides).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test("a key naming a workout — there is no repeating a session", async () => {
    expect(await repeatMeal("workout:e2", CURRY.id, 3)).toEqual({ ok: false });

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("no session", async () => {
    getSession.mockResolvedValue(null);

    expect(await repeatMeal("meal:template-entry", CURRY.id, 3)).toEqual({ ok: false });
    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("no resolved day", async () => {
    loadToday.mockResolvedValue(undefined);

    expect(await repeatMeal("meal:template-entry", CURRY.id, 3)).toEqual({ ok: false });
    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("never throws, whatever the database does", async () => {
    writeOverrides.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await repeatMeal("meal:template-entry", CURRY.id, 3)).toEqual({ ok: false });
  });
});

/* -------------------------------------------------------------------------- */
/* Revert                                                                     */
/* -------------------------------------------------------------------------- */

describe("revertSwap", () => {
  test("deletes the override row the slot resolved from", async () => {
    loadToday.mockResolvedValue(today(SWAPPED_DINNER));

    expect(await revertSwap("meal:override-row")).toEqual({ ok: true });
    expect(deleteOverride).toHaveBeenCalledWith(USER, "override-row");
  });

  test("takes the row id from its own resolution, never the caller", async () => {
    // The browser holds this id too — it is on the resolved item. Accepting it
    // from there would mean deleting whatever uuid arrived: the scope refuses
    // another user's row, but not this user's OTHER overrides, on other dates.
    loadToday.mockResolvedValue(today(SWAPPED_DINNER));

    await revertSwap("meal:override-row");

    expect(deleteOverride.mock.calls[0]![1]).toBe("override-row");
  });

  test("deletes nothing for a slot resolved from the template", async () => {
    // Nothing was overridden, so there is no row and nothing to revert. `ok`,
    // not a failure: the card offers no Revert control in this state, so
    // reaching here means the screen was behind and `refresh()` corrects it.
    expect(await revertSwap("meal:template-entry")).toEqual({ ok: true });
    expect(deleteOverride).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test("never deletes a template entry id", async () => {
    // The regression that would be catastrophic and quiet: `entryId` names a
    // row in `plan_template_entries` when the source is "template", and
    // deleting it would take the meal out of every future week.
    await revertSwap("meal:template-entry");

    expect(deleteOverride).not.toHaveBeenCalledWith(USER, "template-entry");
  });

  test("refuses without a session", async () => {
    getSession.mockResolvedValue(undefined);

    expect(await revertSwap("meal:override-row")).toEqual({ ok: false });
    expect(deleteOverride).not.toHaveBeenCalled();
  });

  test("refuses a user with no profile", async () => {
    loadToday.mockResolvedValue(undefined);

    expect(await revertSwap("meal:override-row")).toEqual({ ok: false });
    expect(deleteOverride).not.toHaveBeenCalled();
  });

  test("refuses a stale key and reconciles the screen", async () => {
    expect(await revertSwap("meal:not-on-the-plan")).toEqual({ ok: false });
    expect(deleteOverride).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test("refuses a key naming a workout", async () => {
    expect(await revertSwap("workout:e2")).toEqual({ ok: false });
    expect(deleteOverride).not.toHaveBeenCalled();
  });

  test("never throws, whatever the database does", async () => {
    loadToday.mockResolvedValue(today(SWAPPED_DINNER));
    deleteOverride.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await revertSwap("meal:override-row")).toEqual({ ok: false });
  });
});

/* -------------------------------------------------------------------------- */
/* The guarantee                                                              */
/* -------------------------------------------------------------------------- */

describe("the template", () => {
  test("is not reachable from the swap's write path", async () => {
    // The ticket's headline promise — "the template is physically unchanged" —
    // asserted at the level a hermetic test can reach it. The integration suite
    // proves the rows do not move; this proves there is no statement in the
    // path capable of moving them, which is the half that keeps holding after
    // someone edits the file.
    //
    // Read as text rather than by inspecting the modules, because the claim is
    // about what the source may MENTION. An import added for a plausible reason
    // — "while we're here, update the template too" — is exactly the change
    // this should refuse, and it would be invisible to any runtime assertion
    // that only watched the mocks.
    const { readFile } = await import("node:fs/promises");

    for (const path of ["src/app/actions/swap.ts", "src/lib/db/queries/swap.ts"]) {
      const source = await readFile(path, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

      expect(code, path).not.toMatch(/planTemplateEntries|plan_template_entries/);
    }
  });
});
