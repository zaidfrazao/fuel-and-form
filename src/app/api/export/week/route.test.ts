import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { WeekExportPayload } from "@/lib/db/queries/week-export";

/**
 * `GET /api/export/week` — the wire between the session and the file. FUEL-38,
 * P6.
 *
 * What the document CONTAINS is `lib/export-week.test.ts`, against a value.
 * That it contains only the caller's rows is `tests/integration/`, against a
 * real database. What is left here is the part only the route does, and none of
 * it is visible from the document itself:
 *
 *   - it refuses a caller with no session, before reading anything;
 *   - it reads `?week=` the way `/plan` does, so the link and the grid name the
 *     same seven days, and a value it cannot read is the current week rather
 *     than a 500;
 *   - it reads the clock once and hands it down;
 *   - it sets the three headers that make a response a download, including the
 *     `no-store` that keeps one person's week out of a cache;
 *   - and a failed read is a short 500 rather than an error page saved to disk
 *     under a `.csv` name.
 */

const { redirect, getSession, loadWeekExport } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what stops the handler. A mock that
    // merely recorded the call would let execution run on into the read with no
    // session — the exact bug this file exists to catch would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadWeekExport: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/week-export", () => ({ loadWeekExport }));

const { GET } = await import("./route");

const USER_ID = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER_ID, kind: "owner" as const };
const MONDAY = "2026-08-17";

/**
 * A week that is not the runner's.
 *
 * The suite runs in `America/New_York` and this payload is Auckland's, so a
 * filename or a week taken from the server's clock cannot coincidentally match
 * one taken from the profile's zone. `vitest.config.mts` pins the zone for
 * exactly this class of assertion.
 */
const PAYLOAD: WeekExportPayload = {
  monday: MONDAY,
  input: {
    monday: MONDAY,
    timezone: "Pacific/Auckland",
    exportedAt: new Date("2026-08-22T09:30:00.000Z"),
    days: [],
    templateDays: [],
    trainingDays: [],
    mealLogs: [],
    workoutLogs: [],
    weightLogs: [],
    meals: [],
    workouts: [],
  },
};

/** The request the browser makes when the link on `/plan` is clicked. */
const request = (query = "") =>
  new Request(`https://fuel.example/api/export/week${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadWeekExport.mockResolvedValue(PAYLOAD);
});

describe("refusals", () => {
  test("sends a caller with no session to the login screen, reading nothing", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(GET(request())).rejects.toThrow("NEXT_REDIRECT:/login");

    // The order is the assertion: nothing is read before the caller is known.
    expect(loadWeekExport).not.toHaveBeenCalled();
  });

  test("answers 404 for a user with no profile row", async () => {
    // No timezone, so no week to be in and no date to name a file with.
    // Defensive rather than reachable: `/plan` renders an empty state instead
    // of the link in that case.
    loadWeekExport.mockResolvedValue(undefined);

    expect((await GET(request())).status).toBe(404);
  });
});

describe("the week the URL asks for", () => {
  const weekPassed = () => loadWeekExport.mock.calls[0]?.[2] as string | null;

  test("is handed down as it arrived", async () => {
    await GET(request("?week=2026-08-17"));

    expect(weekPassed()).toBe("2026-08-17");
  });

  test("is null when there is no parameter, which is the current week", async () => {
    await GET(request());

    expect(weekPassed()).toBeNull();
  });

  test("is null for a value that is not a date, rather than a 500", async () => {
    // A query parameter is the one input a stranger fully controls. An edited
    // URL should answer the question it can — this week — not fall over.
    const response = await GET(request("?week=next-week"));

    expect(response.status).toBe(200);
    expect(weekPassed()).toBeNull();
  });

  test("is null when the parameter is repeated", async () => {
    // `getAll`, not `get`: a URL saying two different things has not named a
    // week, and picking the first value would answer a question nobody asked.
    await GET(request("?week=2026-08-17&week=2026-09-01"));

    expect(weekPassed()).toBeNull();
  });
});

describe("the response", () => {
  test("is a download, named for the week rather than for today", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    // P6's dated-filename criterion. What it pins here is that the name comes
    // from the PAYLOAD's Monday: the runner's clock is a different day in a
    // different week, so a handler deriving its own would fail this line.
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="fuel-form-week-2026-08-17.csv"',
    );
  });

  test("forbids caching, because the body is one person's week", async () => {
    // Uncached today by two accidents — GET route handlers are not cached by
    // default, and reading cookies makes this one dynamic. Neither is a
    // decision, and an edge configuration that cached by URL would serve one
    // visitor's check-in to the next.
    expect((await GET(request())).headers.get("Cache-Control")).toBe("no-store");
  });

  test("is the document the builder makes from the payload", async () => {
    // Not a re-implementation of the file here — that is
    // `lib/export-week.test.ts` — only that this route returns what the builder
    // returned, so the assertions there are assertions about what leaves.
    const body = await (await GET(request())).text();

    expect(body).toContain("week,2026-08-17");
    expect(body).toContain("timezone,Pacific/Auckland");
    expect(body).toContain("exported_at,2026-08-22T09:30:00.000Z");
  });

  test("reads the clock once and hands it down", async () => {
    await GET(request());

    expect(loadWeekExport).toHaveBeenCalledOnce();

    // The instant the file is stamped with and the week a missing `?week=`
    // resolves to are then the same moment, rather than two moments a query
    // apart.
    expect(loadWeekExport.mock.calls[0]?.[1]).toBeInstanceOf(Date);
  });

  test("scopes the read to the session's own user", async () => {
    // The acceptance criterion — "runs against the logged-in account only" —
    // begins here, with the id the route hands down. That it is then enforced
    // in SQL is the integration suite's.
    await GET(request());

    expect(loadWeekExport.mock.calls[0]?.[0]).toBe(USER_ID);
  });
});

describe("when the read fails", () => {
  /**
   * Silenced, not ignored. The route logs the failure on purpose — that is the
   * assertion in the second test — and a real `console.error` here would print
   * a stack into the suite's output on every run, which is how genuine errors
   * stop being noticed.
   */
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logged.mockRestore();
  });

  test("answers 500 without a body that could be mistaken for a check-in", async () => {
    // A download link makes this worse than an ordinary 500: the browser saves
    // whatever comes back under the name in the header, so a framework error
    // page would land on disk as `fuel-form-week-<date>.csv` full of HTML —
    // and be opened in a spreadsheet weeks later. So: a short body, and above
    // all no `Content-Disposition`.
    loadWeekExport.mockRejectedValue(new Error("neon: connection refused"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.text()).toBe("Export failed");
  });

  test("names the failure in the log and nowhere else", async () => {
    // The shape every Server Action here uses: the detail goes to whoever runs
    // the app, and the caller is told only that it failed. A database error in
    // the response body is an internals leak on a public URL.
    const failure = new Error("neon: password authentication failed for user");

    loadWeekExport.mockRejectedValue(failure);

    const body = await (await GET(request())).text();

    expect(logged).toHaveBeenCalledWith("Could not build the weekly export.", failure);
    expect(body).not.toContain("password");
    expect(body).not.toContain("neon");
  });

  test("still sends a signed-out caller to the login screen", async () => {
    // `redirect()` works by throwing, so a `try` that enclosed it would swallow
    // the redirect and answer 500 to every signed-out visitor. This is the test
    // that would fail if someone ever moved it inside.
    getSession.mockResolvedValue(undefined);

    await expect(GET(request())).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
