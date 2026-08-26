import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The shopping list's action layer — what a tap on a checkbox is allowed to
 * write.
 *
 * The collaborators are mocked because all of them ARE the request: a session
 * cookie, a database connection and the router's refresh. What is left is the
 * part only this file does, and it is the part carrying the argument that the
 * two client-supplied values are narrowed before they reach a statement — the
 * week snapped to its Monday, the key re-normalised and bounded — and that no
 * path throws.
 *
 * The statements themselves are covered against real Postgres in
 * tests/integration/shopping.test.ts, including the one thing this file cannot
 * observe: that a tick survives a swap.
 */

const { getSession, checkItem, uncheckItem, refresh } = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkItem: vi.fn(),
  uncheckItem: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/shopping", () => ({ checkItem, uncheckItem }));
vi.mock("next/cache", () => ({ refresh }));

const { setChecked } = await import("./shopping");

const USER = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };

/** Monday 9 March 2026 — the resolver's fixture week, used across the suite. */
const MON = "2026-03-09";
const WED = "2026-03-11";

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  checkItem.mockResolvedValue(undefined);
  uncheckItem.mockResolvedValue(undefined);
});

const tick = (over: Partial<Parameters<typeof setChecked>[0]> = {}) =>
  setChecked({ week: MON, key: "beef mince", checked: true, ...over });

/* -------------------------------------------------------------------------- */
/* The two directions                                                         */
/* -------------------------------------------------------------------------- */

describe("ticking a line", () => {
  test("writes the tick for the session's own user", async () => {
    await expect(tick()).resolves.toEqual({ ok: true });

    // The user id comes from the resolved session and from nowhere else: there
    // is no argument a caller could have supplied it in.
    expect(checkItem).toHaveBeenCalledWith(USER, MON, "beef mince");
    expect(uncheckItem).not.toHaveBeenCalled();
  });

  test("clears the tick when asked to uncheck", async () => {
    await expect(tick({ checked: false })).resolves.toEqual({ ok: true });

    expect(uncheckItem).toHaveBeenCalledWith(USER, MON, "beef mince");
    expect(checkItem).not.toHaveBeenCalled();
  });

  test("refreshes the screen behind the optimistic row", async () => {
    // The list is server-rendered. Without this the optimistic answer would
    // stand with nothing behind it — right until the next navigation.
    await tick();

    expect(refresh).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* What the client is allowed to name                                         */
/* -------------------------------------------------------------------------- */

describe("the week is snapped rather than accepted", () => {
  test("a mid-week date writes the week's Monday", async () => {
    // The whole point: the URL may name any day of the week, and the tick has
    // to land in the same week the list was computed for.
    await expect(tick({ week: WED })).resolves.toEqual({ ok: true });

    expect(checkItem).toHaveBeenCalledWith(USER, MON, "beef mince");
  });

  test("a Sunday belongs to the week it ends, not the one it precedes", async () => {
    // Sunday 15 March is the last day of the week beginning Monday the 9th.
    // The off-by-one here would put half the shop in the wrong list.
    await expect(tick({ week: "2026-03-15" })).resolves.toEqual({ ok: true });

    expect(checkItem).toHaveBeenCalledWith(USER, MON, "beef mince");
  });

  test("refuses a malformed date rather than falling back to this week", async () => {
    // `requestedWeek` falls back for a URL, because a person can edit one and
    // should get a page. This is a write, and a tick on a week nobody named is
    // an invented fact.
    await expect(tick({ week: "not-a-date" })).resolves.toEqual({ ok: false });

    expect(checkItem).not.toHaveBeenCalled();
  });

  test("refuses an impossible date", async () => {
    await expect(tick({ week: "2026-02-30" })).resolves.toEqual({ ok: false });

    expect(checkItem).not.toHaveBeenCalled();
  });
});

describe("the key is re-normalised rather than trusted", () => {
  test("stores the normalised spelling of a display name", async () => {
    // What a client would send if it read the visible label rather than the
    // key. Stored raw, it would tick nothing and look like a broken list.
    await expect(tick({ key: "  Beef   Mince " })).resolves.toEqual({ ok: true });

    expect(checkItem).toHaveBeenCalledWith(USER, MON, "beef mince");
  });

  test("refuses a key that normalises to nothing", async () => {
    // The aggregation skips a blank ingredient name, so no line could match.
    await expect(tick({ key: "   " })).resolves.toEqual({ ok: false });

    expect(checkItem).not.toHaveBeenCalled();
  });

  test("refuses a key longer than any ingredient name", async () => {
    // The one thing an unvalidated key genuinely allows is volume. Refused
    // rather than truncated: a truncated key stores something the caller did
    // not name and then ticks nothing.
    await expect(tick({ key: "a".repeat(201) })).resolves.toEqual({ ok: false });

    expect(checkItem).not.toHaveBeenCalled();
  });

  test("accepts a key exactly at the bound", async () => {
    // The boundary itself, so the comparison cannot quietly be `>=`.
    await expect(tick({ key: "a".repeat(200) })).resolves.toEqual({ ok: true });

    expect(checkItem).toHaveBeenCalledWith(USER, MON, "a".repeat(200));
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing throws                                                             */
/* -------------------------------------------------------------------------- */

describe("failures are answers", () => {
  test("refuses without a session, and touches nothing", async () => {
    getSession.mockResolvedValue(null);

    await expect(tick()).resolves.toEqual({ ok: false });

    expect(checkItem).not.toHaveBeenCalled();
    expect(uncheckItem).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the write fails", async () => {
    // A thrown action is a 500 with no value for the client to render, and
    // § Feedback wants an inline banner with the row reverted.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    checkItem.mockRejectedValue(new Error("connection reset"));

    await expect(tick()).resolves.toEqual({ ok: false });
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  test("answers rather than throwing when the session cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    getSession.mockRejectedValue(new Error("cookie jar unavailable"));

    await expect(tick()).resolves.toEqual({ ok: false });

    logged.mockRestore();
  });
});
