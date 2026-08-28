import { beforeEach, describe, expect, test, vi } from "vitest";

import { RECENT_WEIGH_INS } from "@/lib/weigh-in";

/**
 * P5's action layer — what a weigh-in is allowed to write (FUEL-34).
 *
 * Mocked the way `training.test.ts` and `plan.test.ts` are: the session, the
 * database and `refresh()` all ARE the request, so what is left is the part
 * only this file does.
 *
 * What carries the weight here is different from every other action in the app,
 * and it is worth naming. `training.ts` is trusted to re-resolve the date and
 * take the workout id from its OWN answer, so the interesting assertions there
 * are about what the caller could not name. Nothing is re-derived here: a
 * weigh-in has no plan to sit on and any past date is legitimate. So the
 * assertions are about the boundary itself — that the parser runs BEFORE the
 * write, that the timezone the future-date refusal uses is the user's, and that
 * no path throws.
 *
 * The statement — that a second weigh-in on one date REPLACES the first rather
 * than adding a row — is covered against real Postgres in
 * tests/integration/weight.test.ts. It cannot be asserted here, because the
 * unique index that makes it true lives in the database.
 */

const {
  getSession,
  weighInToday,
  recordWeighIn,
  removeWeighIn,
  loadEarlierWeighIns,
  loadWeighInOn,
  refresh,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  weighInToday: vi.fn(),
  recordWeighIn: vi.fn(),
  removeWeighIn: vi.fn(),
  loadEarlierWeighIns: vi.fn(),
  loadWeighInOn: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/weight", () => ({
  weighInToday,
  recordWeighIn,
  removeWeighIn,
  loadEarlierWeighIns,
  loadWeighInOn,
}));
vi.mock("next/cache", () => ({ refresh }));

const { deleteWeighIn, earlierWeighIns, saveWeighIn, weighInOn } = await import("./weight");

const USER = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };

const TODAY = "2026-08-21";

/** A stored row, carrying everything `weight_logs` really holds. */
const STORED = {
  id: "b2f1c0de-0000-4000-8000-000000000001",
  userId: USER,
  date: "2026-07-04",
  weightKg: 81.6,
  note: "before breakfast",
  createdAt: new Date("2026-07-04T05:30:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  weighInToday.mockResolvedValue(TODAY);
  recordWeighIn.mockResolvedValue(undefined);
  removeWeighIn.mockResolvedValue(true);
  loadEarlierWeighIns.mockResolvedValue([STORED]);
  loadWeighInOn.mockResolvedValue(STORED);
});

describe("saving a weigh-in", () => {
  test("writes the parsed values against the session's own user", async () => {
    await expect(
      saveWeighIn({ date: TODAY, weight: "77,4", note: "  after the walk  " }),
    ).resolves.toEqual({ ok: true });

    // The comma is resolved and the note trimmed before the write, not after —
    // what reaches the database is what `lib/weigh-in.ts` decided.
    expect(recordWeighIn).toHaveBeenCalledWith(USER, {
      date: TODAY,
      weightKg: 77.4,
      note: "after the walk",
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("records a past date, including one before the program started", async () => {
    // The refusal every other date-taking action in this app makes, and the one
    // this one must not: the starting weight predates the program.
    await expect(saveWeighIn({ date: "2019-01-01", weight: "84.2" })).resolves.toEqual({
      ok: true,
    });

    expect(recordWeighIn).toHaveBeenCalledWith(USER, {
      date: "2019-01-01",
      weightKg: 84.2,
      note: null,
    });
  });

  test("refuses a date after today in the USER's zone", async () => {
    // Today comes from `profiles.timezone`, not from the server's clock. A
    // phone west of the server would otherwise be able to log tomorrow.
    weighInToday.mockResolvedValue("2026-08-21");

    await expect(saveWeighIn({ date: "2026-08-22", weight: "77.4" })).resolves.toEqual({
      ok: false,
    });

    expect(recordWeighIn).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("refuses a weight the parser refuses, before touching the database", async () => {
    await expect(saveWeighIn({ date: TODAY, weight: "774" })).resolves.toEqual({ ok: false });
    await expect(saveWeighIn({ date: TODAY, weight: "" })).resolves.toEqual({ ok: false });
    await expect(saveWeighIn({ date: TODAY, weight: "1,234.5" })).resolves.toEqual({
      ok: false,
    });

    expect(recordWeighIn).not.toHaveBeenCalled();
  });

  test("writes nothing for a request with no session", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(saveWeighIn({ date: TODAY, weight: "77.4" })).resolves.toEqual({ ok: false });

    // Not even the timezone is fetched: an unauthenticated request should cost
    // the database nothing at all.
    expect(weighInToday).not.toHaveBeenCalled();
    expect(recordWeighIn).not.toHaveBeenCalled();
  });

  test("writes nothing when the user has no profile row", async () => {
    // No timezone, so no "today" to measure a future date against, and the
    // server's own would be the wrong answer for a user in another zone.
    weighInToday.mockResolvedValue(undefined);

    await expect(saveWeighIn({ date: TODAY, weight: "77.4" })).resolves.toEqual({ ok: false });

    expect(recordWeighIn).not.toHaveBeenCalled();
  });

  test("returns a result rather than throwing when the write fails", async () => {
    // The contract the screen depends on: a thrown Server Action is a 500 with
    // nothing to render, and § Feedback asks for an inline banner.
    recordWeighIn.mockRejectedValue(new Error("connection terminated"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(saveWeighIn({ date: TODAY, weight: "77.4" })).resolves.toEqual({ ok: false });
  });
});

describe("deleting a weigh-in", () => {
  test("removes the row at that date for the session's own user", async () => {
    await expect(deleteWeighIn({ date: "2026-08-14" })).resolves.toEqual({ ok: true });

    expect(removeWeighIn).toHaveBeenCalledWith(USER, "2026-08-14");
    expect(refresh).toHaveBeenCalled();
  });

  test("is ok when the row is already gone", async () => {
    // The screen offers no delete for a date with no row, so reaching this
    // means the screen was behind. `refresh()` is the correction; a banner
    // would report a problem the user does not have.
    removeWeighIn.mockResolvedValue(false);

    await expect(deleteWeighIn({ date: "2026-08-14" })).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalled();
  });

  test("refuses a malformed or future date without touching the database", async () => {
    await expect(deleteWeighIn({ date: "2026-02-30" })).resolves.toEqual({ ok: false });
    await expect(deleteWeighIn({ date: "2026-08-22" })).resolves.toEqual({ ok: false });
    await expect(deleteWeighIn({ date: undefined })).resolves.toEqual({ ok: false });

    expect(removeWeighIn).not.toHaveBeenCalled();
  });

  test("removes nothing for a request with no session", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(deleteWeighIn({ date: TODAY })).resolves.toEqual({ ok: false });

    expect(removeWeighIn).not.toHaveBeenCalled();
  });

  test("returns a result rather than throwing when the delete fails", async () => {
    removeWeighIn.mockRejectedValue(new Error("connection terminated"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(deleteWeighIn({ date: TODAY })).resolves.toEqual({ ok: false });
  });
});

/**
 * FUEL-84's two reads — the rest of a bounded history, on request.
 *
 * `/weight` lists a window and sends the notes for that window only, so these
 * are how anything older reaches the screen. Two things are asserted that the
 * write paths cannot be asked about: that the page size is the SERVER's, and
 * that a row crosses narrowed. Both are payload promises, and a payload promise
 * is exactly the kind that rots without a word.
 */
describe("reading earlier weigh-ins", () => {
  test("returns the page narrowed to what the browser may hold", async () => {
    await expect(earlierWeighIns({ before: "2026-08-11" })).resolves.toEqual({
      ok: true,
      entries: [{ date: STORED.date, weightKg: STORED.weightKg, note: STORED.note }],
    });

    expect(loadEarlierWeighIns).toHaveBeenCalledWith(USER, "2026-08-11", RECENT_WEIGH_INS);
  });

  test("takes the page size from this module, never from the caller", async () => {
    // A limit the client could name is a limit a hand-rolled POST sets to a
    // year of rows, which is the payload this ticket exists to bound.
    await earlierWeighIns({ before: "2026-08-11", limit: 5000 } as { before: unknown });

    expect(loadEarlierWeighIns.mock.calls[0]?.[2]).toBe(RECENT_WEIGH_INS);
  });

  test("does not refuse a date in the future, and does not fetch a timezone to check one", async () => {
    /*
     * The read paths deliberately part company with the writes here. "Older
     * than tomorrow" is this user's own history in pages of ten — not a refusal
     * worth a round trip to `profiles.timezone`, and not a way to learn
     * anything about anyone else.
     */
    await expect(earlierWeighIns({ before: "2099-01-01" })).resolves.toEqual({
      ok: true,
      entries: [{ date: STORED.date, weightKg: STORED.weightKg, note: STORED.note }],
    });

    expect(weighInToday).not.toHaveBeenCalled();
  });

  test("refuses a malformed date without touching the database", async () => {
    await expect(earlierWeighIns({ before: "2026-02-30" })).resolves.toEqual({ ok: false });
    await expect(earlierWeighIns({ before: 20260811 })).resolves.toEqual({ ok: false });

    expect(loadEarlierWeighIns).not.toHaveBeenCalled();
  });

  test("reads nothing for a request with no session", async () => {
    getSession.mockResolvedValue(null);

    await expect(earlierWeighIns({ before: "2026-08-11" })).resolves.toEqual({ ok: false });

    expect(loadEarlierWeighIns).not.toHaveBeenCalled();
  });

  test("returns a result rather than throwing when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadEarlierWeighIns.mockRejectedValue(new Error("connection terminated"));

    await expect(earlierWeighIns({ before: "2026-08-11" })).resolves.toEqual({ ok: false });
  });

  test("does not invalidate the render, which would fold the pages back up", async () => {
    await earlierWeighIns({ before: "2026-08-11" });

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("reading the weigh-in on one date", () => {
  test("returns the entry narrowed, so the form can see the note it would replace", async () => {
    await expect(weighInOn({ date: STORED.date })).resolves.toEqual({
      ok: true,
      entry: { date: STORED.date, weightKg: STORED.weightKg, note: STORED.note },
    });

    expect(loadWeighInOn).toHaveBeenCalledWith(USER, STORED.date);
  });

  test("says a date has no weigh-in without calling it a failure", async () => {
    // The screen acts on the difference: no entry means the fields stay empty,
    // a failure means it warns that logging would replace a note it never saw.
    loadWeighInOn.mockResolvedValue(undefined);

    await expect(weighInOn({ date: "2026-07-05" })).resolves.toEqual({ ok: true, entry: null });
  });

  test("refuses a malformed date without touching the database", async () => {
    await expect(weighInOn({ date: "the fourth" })).resolves.toEqual({ ok: false });

    expect(loadWeighInOn).not.toHaveBeenCalled();
  });

  test("reads nothing for a request with no session", async () => {
    getSession.mockResolvedValue(null);

    await expect(weighInOn({ date: STORED.date })).resolves.toEqual({ ok: false });

    expect(loadWeighInOn).not.toHaveBeenCalled();
  });

  test("returns a result rather than throwing when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadWeighInOn.mockRejectedValue(new Error("connection terminated"));

    await expect(weighInOn({ date: STORED.date })).resolves.toEqual({ ok: false });
  });
});
