import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ExportPayload } from "@/lib/db/queries/export";
import type { Profile } from "@/lib/db/schema";

/**
 * `GET /api/export` — the wire between the session and the file. FUEL-37, P6.
 *
 * What the document CONTAINS is `lib/export.test.ts`, against a value. That it
 * contains only the caller's rows is `tests/integration/export.test.ts`, against
 * a real database. What is left here is the part only the route does, and all
 * four of them are invisible from the document itself:
 *
 *   - it refuses a caller with no session, before reading anything;
 *   - it reads the clock once, and the filename's date comes from the USER's
 *     zone rather than the runner's;
 *   - it sets the three headers that make a response a download rather than a
 *     page — including the `no-store` that keeps one person's history out of a
 *     cache;
 *   - and the bytes that leave carry no `user_id`, asserted against the body
 *     rather than the object, because the body is what crosses.
 */

const { redirect, getSession, loadExport } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what stops the handler. A mock that
    // merely recorded the call would let execution run on into `loadExport`
    // with no session — the exact bug this file exists to catch would pass.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadExport: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/export", () => ({ loadExport }));

const { GET } = await import("./route");

const USER_ID = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER_ID, kind: "owner" as const };

/** Invented figures, per Testing Strategy § 1.5. */
const PROFILE: Profile = {
  userId: USER_ID,
  heightCm: 172,
  startWeightKg: 84.2,
  targetWeightKg: 76,
  goalPaceKgPerWeek: 0.5,
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
  slotTimes: {},
  workoutTimes: {},
  programStartDate: "2026-06-01",
  timezone: "Pacific/Auckland",
};

/**
 * A payload whose date is a day ahead of the runner's.
 *
 * The suite runs in `America/New_York` and the profile here is in Auckland, so
 * a filename taken from the server's clock cannot coincidentally match the one
 * taken from the profile's zone. `vitest.config.mts` pins the zone for exactly
 * this class of assertion.
 */
const PAYLOAD: ExportPayload = {
  account: {
    id: USER_ID,
    kind: "owner",
    displayName: "Sam Rivera",
    timezone: "Pacific/Auckland",
  },
  tables: {
    profile: PROFILE,
    meals: [],
    mealIngredients: [],
    planTemplateEntries: [],
    dayPlanOverrides: [],
    mealLogs: [],
    workouts: [],
    workoutExercises: [],
    trainingTemplateEntries: [],
    workoutLogs: [],
    weightLogs: [],
  },
  today: "2026-08-22",
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadExport.mockResolvedValue(PAYLOAD);
});

describe("refusals", () => {
  test("sends a caller with no session to the login screen, reading nothing", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/login");

    // The order is the assertion: nothing is read before the caller is known.
    expect(loadExport).not.toHaveBeenCalled();
  });

  test("answers 404 for a user with no profile row", async () => {
    // No timezone, so no date to name a file with — and this app does not take
    // one from the server's clock instead. Defensive rather than reachable:
    // /settings only offers the link once a profile exists.
    loadExport.mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(404);
  });
});

describe("the response", () => {
  test("is a download, named from the profile's own zone", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    // P6's dated-filename criterion, and what it pins here is that the route
    // takes the date from the PAYLOAD rather than deriving one. The fixture's
    // date is Auckland's, a day ahead of the runner's zone, so a handler that
    // reached for its own clock would write the 21st and fail this line. That
    // the payload's date is itself `todayIn(profile.timezone)` is the query
    // layer's, asserted in tests/integration/export.test.ts.
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="fuel-form-2026-08-22.json"',
    );
  });

  test("forbids caching, because the body is one person's whole history", async () => {
    // Uncached today by two separate accidents — GET route handlers are not
    // cached by default, and reading cookies makes this one dynamic. Neither is
    // a decision, and an edge configuration that ever cached by URL would serve
    // one visitor's export to the next.
    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("reads the clock once, so the name and the stamp are one moment", async () => {
    const response = await GET();
    const document = JSON.parse(await response.text());

    expect(loadExport).toHaveBeenCalledOnce();

    const passed = loadExport.mock.calls[0]?.[1] as Date;

    expect(passed).toBeInstanceOf(Date);
    expect(document.exportedAt).toBe(passed.toISOString());
  });

  test("scopes the read to the session's own user", async () => {
    // The acceptance criterion — "runs against the logged-in account only" —
    // begins here, with the id the route hands down. That it is then enforced
    // in SQL is tests/integration/export.test.ts.
    await GET();

    expect(loadExport.mock.calls[0]?.[0]).toBe(USER_ID);
  });

  test("carries no user_id in the bytes that leave", async () => {
    const body = await (await GET()).text();

    expect(body).not.toContain("userId");
    expect(body).not.toContain("user_id");

    // And the document is real, so the assertions above cannot pass by
    // responding with nothing.
    const document = JSON.parse(body);

    expect(document.schemaVersion).toBe(1);
    expect(document.account.id).toBe(USER_ID);
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

  test("answers 500 without a body that could be mistaken for a backup", async () => {
    // A download link makes this worse than an ordinary 500: the browser saves
    // whatever comes back under the name in the header, so a framework error
    // page would land on disk as `fuel-form-<date>.json` full of HTML. The
    // failure must therefore be a short body and, above all, no
    // `Content-Disposition`.
    const failure = new Error("neon: connection refused");

    loadExport.mockRejectedValue(failure);

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.text()).toBe("Export failed");
  });

  test("names the failure in the log and nowhere else", async () => {
    // The shape every Server Action here uses: the detail goes to whoever runs
    // the app, and the caller is told only that it failed. A database error
    // reaching the response body is an internals leak on a public URL.
    const failure = new Error("neon: password authentication failed for user");

    loadExport.mockRejectedValue(failure);

    const body = await (await GET()).text();

    expect(logged).toHaveBeenCalledWith("Could not build the export.", failure);
    expect(body).not.toContain("password");
    expect(body).not.toContain("neon");
  });

  test("still sends a signed-out caller to the login screen", async () => {
    // `redirect()` works by throwing, so a `try` that enclosed it would swallow
    // the redirect and answer 500 to every signed-out visitor. This is the test
    // that would fail if someone ever moved it inside.
    getSession.mockResolvedValue(undefined);

    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
