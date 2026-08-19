import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Meal, Profile } from "@/lib/db/schema";
import type { ResolvedDay } from "@/lib/resolve-plan";

/**
 * The grid's action layer — what a tap on a CELL is allowed to write.
 *
 * `swap.test.ts`'s sibling, and mocked the same way: the session, the database
 * and the router's refresh all ARE the request. What is left is the part only
 * this file does, and here it carries a wider security argument than `swap.ts`
 * does — because this endpoint takes a DATE.
 *
 * `swapMeal` cannot be pointed at another day: it addresses a slot by a key
 * into today's resolved timeline, so the date is never an argument. These three
 * take one off the wire, which makes four things worth pinning: that a
 * malformed date is refused before a query runs, that a slot the enum does not
 * have is refused, that the one client-supplied meal is checked against the
 * caller's own library, and that a revert re-derives the row id server-side
 * rather than deleting whatever uuid it is handed.
 *
 * The statements themselves are covered against real Postgres in
 * tests/integration/week.test.ts — including the guarantee this file cannot
 * observe, that `plan_template_entries` is untouched.
 */

const { getSession, loadWeek, writeOverride, writeOverrides, deleteOverride, refresh } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    loadWeek: vi.fn(),
    writeOverride: vi.fn(),
    writeOverrides: vi.fn(),
    deleteOverride: vi.fn(),
    refresh: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/week", () => ({ loadWeek }));
vi.mock("@/lib/db/queries/swap", () => ({
  writeOverride,
  writeOverrides,
  deleteOverride,
}));
vi.mock("next/cache", () => ({ refresh }));

const { repeatFromDate, revertOnDate, swapOnDate } = await import("./plan");

const USER = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };

/** Monday 9 March 2026, and the Tuesday PRD § Problem Statement swaps. */
const MON = "2026-03-09";
const TUE = "2026-03-10";

const meal = (id: string, fields: Partial<Meal> = {}): Meal => ({
  id,
  userId: USER,
  name: `Meal ${id}`,
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

const CHILLI = meal("m1");
const CURRY = meal("m2");
const RETIRED = meal("m3", { isArchived: true });

const profile = { targetKcal: 1780 } as Profile;

/** Tuesday dinner, resolved from wherever the test says. */
const dinner = (source: "template" | "override", entryId: string): ResolvedDay => ({
  date: TUE,
  meals: [{ slot: "dinner", meal: CHILLI, source, entryId }],
});

function week(days: ResolvedDay[] = [dinner("template", "t1")]) {
  loadWeek.mockResolvedValue({
    monday: MON,
    today: MON,
    profile,
    days,
    templateDays: days,
    meals: [CHILLI, CURRY, RETIRED],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  week();
});

describe("swapOnDate", () => {
  test("writes the override for the date and slot it is given", async () => {
    await expect(swapOnDate(TUE, "dinner", "m2")).resolves.toEqual({ ok: true });

    expect(writeOverride).toHaveBeenCalledWith(USER, {
      date: TUE,
      slot: "dinner",
      mealId: "m2",
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("swaps into a slot the template leaves empty", async () => {
    // An override is consulted first and unconditionally, so filling an empty
    // slot on one date is an ordinary action rather than an error.
    week([{ date: TUE, meals: [] }]);

    await expect(swapOnDate(TUE, "lunch", "m2")).resolves.toEqual({ ok: true });
    expect(writeOverride).toHaveBeenCalled();
  });

  test("refuses a slot the enum does not have, before any query", async () => {
    await expect(swapOnDate(TUE, "brunch", "m2")).resolves.toEqual({ ok: false });

    expect(loadWeek).not.toHaveBeenCalled();
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("refuses a malformed date before any query", async () => {
    // The refusal costs nothing. One that ran a query first would let anyone
    // who can POST make the database work by sending rubbish.
    await expect(swapOnDate("2026-3-9", "dinner", "m2")).resolves.toEqual({
      ok: false,
    });

    expect(loadWeek).not.toHaveBeenCalled();
    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("refuses a meal that is not in the caller's library", async () => {
    await expect(swapOnDate(TUE, "dinner", "someone-elses")).resolves.toEqual({
      ok: false,
    });

    expect(writeOverride).not.toHaveBeenCalled();
    // Refreshed, unlike the two above: this one means the BROWSER's copy of the
    // library disagrees with the database, and re-resolving is what lets a
    // retry succeed.
    expect(refresh).toHaveBeenCalled();
  });

  test("refuses an archived meal", async () => {
    // The picker filters retired meals from the tiles, but a rendering decision
    // is not a rule until the write path agrees with it.
    await expect(swapOnDate(TUE, "dinner", "m3")).resolves.toEqual({ ok: false });

    expect(writeOverride).not.toHaveBeenCalled();
  });

  test("refuses without a session", async () => {
    getSession.mockResolvedValue(null);

    await expect(swapOnDate(TUE, "dinner", "m2")).resolves.toEqual({ ok: false });

    expect(loadWeek).not.toHaveBeenCalled();
  });

  test("refuses when there is no profile row", async () => {
    loadWeek.mockResolvedValue(undefined);

    await expect(swapOnDate(TUE, "dinner", "m2")).resolves.toEqual({ ok: false });
  });

  test("answers rather than throwing when the write fails", async () => {
    writeOverride.mockRejectedValue(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(swapOnDate(TUE, "dinner", "m2")).resolves.toEqual({ ok: false });
  });
});

describe("repeatFromDate", () => {
  test("writes one row per date, from the cell forward", async () => {
    await expect(repeatFromDate(TUE, "dinner", "m2", 3)).resolves.toEqual({
      ok: true,
    });

    expect(writeOverrides).toHaveBeenCalledWith(USER, [
      { date: TUE, slot: "dinner", mealId: "m2" },
      { date: "2026-03-11", slot: "dinner", mealId: "m2" },
      { date: "2026-03-12", slot: "dinner", mealId: "m2" },
    ]);
  });

  test("spills past the end of the week rather than stopping at it", async () => {
    // Overrides are dated, not week-bound. A repeat that stopped at Sunday
    // would silently write fewer days than the button named.
    await expect(repeatFromDate("2026-03-14", "dinner", "m2", 3)).resolves.toEqual({
      ok: true,
    });

    expect(writeOverrides).toHaveBeenCalledWith(USER, [
      { date: "2026-03-14", slot: "dinner", mealId: "m2" },
      { date: "2026-03-15", slot: "dinner", mealId: "m2" },
      { date: "2026-03-16", slot: "dinner", mealId: "m2" },
    ]);
  });

  test("refuses a count out of range, without refreshing", async () => {
    // Nothing the stepper can produce. A bad count says nothing about the data,
    // so the screen is already correct and a refresh would fix nothing.
    await expect(repeatFromDate(TUE, "dinner", "m2", 99)).resolves.toEqual({
      ok: false,
    });

    expect(writeOverrides).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("refuses a fractional count", async () => {
    await expect(repeatFromDate(TUE, "dinner", "m2", 2.5)).resolves.toEqual({
      ok: false,
    });

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("refuses an archived meal", async () => {
    await expect(repeatFromDate(TUE, "dinner", "m3", 3)).resolves.toEqual({
      ok: false,
    });

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("refuses a bad slot and a bad date", async () => {
    await expect(repeatFromDate(TUE, "brunch", "m2", 3)).resolves.toEqual({
      ok: false,
    });
    await expect(repeatFromDate("nonsense", "dinner", "m2", 3)).resolves.toEqual({
      ok: false,
    });

    expect(writeOverrides).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the write fails", async () => {
    writeOverrides.mockRejectedValue(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(repeatFromDate(TUE, "dinner", "m2", 3)).resolves.toEqual({
      ok: false,
    });
  });
});

describe("revertOnDate", () => {
  test("deletes the override the cell resolved from", async () => {
    week([dinner("override", "o1")]);

    await expect(revertOnDate(TUE, "dinner")).resolves.toEqual({ ok: true });

    expect(deleteOverride).toHaveBeenCalledWith(USER, "o1");
    expect(refresh).toHaveBeenCalled();
  });

  test("re-derives the row id rather than taking one from the caller", async () => {
    // The signature is the assertion: there is no parameter an attacker could
    // put a uuid in. The id passed to the delete comes from re-resolving the
    // cell server-side, so "delete any one of my overrides, on any date" is not
    // a capability this endpoint offers.
    week([dinner("override", "o1")]);

    await revertOnDate(TUE, "dinner");

    expect(deleteOverride).toHaveBeenCalledWith(USER, "o1");
    expect(revertOnDate).toHaveLength(2);
  });

  test("a cell resolved from the template deletes nothing, and is ok", async () => {
    // The sheet offers no Revert in that state, so reaching here means the
    // screen was behind. A banner would report a problem the user does not have.
    week([dinner("template", "t1")]);

    await expect(revertOnDate(TUE, "dinner")).resolves.toEqual({ ok: true });

    expect(deleteOverride).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test("an empty cell deletes nothing, and is ok", async () => {
    week([{ date: TUE, meals: [] }]);

    await expect(revertOnDate(TUE, "dinner")).resolves.toEqual({ ok: true });

    expect(deleteOverride).not.toHaveBeenCalled();
  });

  test("a date outside the loaded week deletes nothing, and is ok", async () => {
    week([dinner("override", "o1")]);

    await expect(revertOnDate(MON, "dinner")).resolves.toEqual({ ok: true });

    expect(deleteOverride).not.toHaveBeenCalled();
  });

  test("refuses a bad slot, a bad date and no session", async () => {
    await expect(revertOnDate(TUE, "brunch")).resolves.toEqual({ ok: false });
    await expect(revertOnDate("nonsense", "dinner")).resolves.toEqual({ ok: false });

    getSession.mockResolvedValue(null);
    await expect(revertOnDate(TUE, "dinner")).resolves.toEqual({ ok: false });

    expect(deleteOverride).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the delete fails", async () => {
    week([dinner("override", "o1")]);
    deleteOverride.mockRejectedValue(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(revertOnDate(TUE, "dinner")).resolves.toEqual({ ok: false });
  });
});
