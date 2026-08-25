import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `GET /api/cron/reap-demos` — the gate on the delete. FUEL-42, § P7.
 *
 * WHAT is deleted is `tests/integration/reap.test.ts`, against a real Postgres,
 * because it is a claim about SQL. WHO may delete it is `src/lib/cron.test.ts`,
 * against a value. What is left here is the part only the route does, and each
 * one is invisible from either of those files:
 *
 *   - an unauthorized caller does not reach the reaper AT ALL — not "its result
 *     is discarded", which is the version of this test that passes while the
 *     rows are already gone;
 *   - an unconfigured `CRON_SECRET` is a 500 rather than a 401, so a job that
 *     has never once run cannot be mistaken for a job being probed;
 *   - the response carries `no-store`, so a cached "deleted 0" cannot stand in
 *     for tomorrow's run;
 *   - a database failure is a 500 that says nothing, with the cause logged.
 *
 * The secret is invented and set per test, never read from the environment.
 */

const { isAuthorizedCron, reapExpiredDemos, cronSecret } = vi.hoisted(() => ({
  isAuthorizedCron: vi.fn(),
  reapExpiredDemos: vi.fn(),
  cronSecret: vi.fn(),
}));

vi.mock("@/lib/cron", () => ({ isAuthorizedCron }));
vi.mock("@/lib/db/queries/demo", () => ({ reapExpiredDemos }));
vi.mock("@/lib/env", () => ({ cronSecret }));

const { GET } = await import("./route");

const SECRET = "kc4Qh4mM1sPjxq7dVJ4C9Yz2R0aGm5tw";

/** A request carrying whatever header the case is about. */
const requestWith = (authorization?: string) =>
  new Request("https://example.test/api/cron/reap-demos", {
    headers: authorization === undefined ? {} : { authorization },
  });

beforeEach(() => {
  vi.clearAllMocks();
  cronSecret.mockReturnValue(SECRET);
  isAuthorizedCron.mockReturnValue(true);
  reapExpiredDemos.mockResolvedValue({ deleted: 0, complete: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/cron/reap-demos", () => {
  describe("when the caller cannot prove who it is", () => {
    beforeEach(() => {
      isAuthorizedCron.mockReturnValue(false);
    });

    test("answers 401", async () => {
      expect((await GET(requestWith("Bearer wrong"))).status).toBe(401);
    });

    test("deletes nothing", async () => {
      // The assertion this file exists for. A route that reaped first and
      // checked afterwards would pass every other test here.
      await GET(requestWith("Bearer wrong"));

      expect(reapExpiredDemos).not.toHaveBeenCalled();
    });

    test("says nothing about why", async () => {
      // No count, no reason, no header naming the scheme. A probe learns that
      // it failed and nothing else.
      const response = await GET(requestWith());

      expect(await response.text()).toBe("Unauthorized");
      expect(console.error).not.toHaveBeenCalled();
    });

    test("hands the gate the header and the configured secret", async () => {
      await GET(requestWith("Bearer wrong"));

      expect(isAuthorizedCron).toHaveBeenCalledWith("Bearer wrong", SECRET);
    });

    test("hands the gate null when there is no header at all", async () => {
      await GET(requestWith());

      expect(isAuthorizedCron).toHaveBeenCalledWith(null, SECRET);
    });
  });

  describe("when CRON_SECRET is not configured", () => {
    beforeEach(() => {
      // What `requireEnv` does: names the variable and where to define it.
      cronSecret.mockImplementation(() => {
        throw new Error("Missing required environment variable CRON_SECRET.");
      });
    });

    test("throws rather than answering 401", async () => {
      // Deliberately NOT caught into a 401. A deployment turning its own
      // scheduler away, daily, would be indistinguishable from a probe — and
      // the symptom arrives weeks later as rows nobody deleted.
      await expect(GET(requestWith(`Bearer ${SECRET}`))).rejects.toThrow("CRON_SECRET");
    });

    test("deletes nothing", async () => {
      await expect(GET(requestWith(`Bearer ${SECRET}`))).rejects.toThrow();

      expect(reapExpiredDemos).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is the scheduler", () => {
    test("answers 200 with what it deleted", async () => {
      reapExpiredDemos.mockResolvedValue({ deleted: 7, complete: true });

      const response = await GET(requestWith(`Bearer ${SECRET}`));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted: 7, complete: true });
    });

    test("reports a run that ran out of budget", async () => {
      // The only signal that a day's provisioning has outgrown one run.
      reapExpiredDemos.mockResolvedValue({ deleted: 4000, complete: false });

      expect(await (await GET(requestWith(`Bearer ${SECRET}`))).json()).toEqual({
        deleted: 4000,
        complete: false,
      });
    });

    test("is never stored", async () => {
      // A cached response would serve tomorrow's invocation a "deleted 0" from
      // today — a job that stopped running while still reporting success.
      const response = await GET(requestWith(`Bearer ${SECRET}`));

      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    test("reaps against the current instant", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T04:00:00.000Z"));

      try {
        await GET(requestWith(`Bearer ${SECRET}`));

        expect(reapExpiredDemos).toHaveBeenCalledWith(new Date("2026-08-25T04:00:00.000Z"));
      } finally {
        vi.useRealTimers();
      }
    });

    test("logs what it did", async () => {
      // This route has no human on the other end, so its log line is its only
      // user interface.
      reapExpiredDemos.mockResolvedValue({ deleted: 7, complete: true });

      await GET(requestWith(`Bearer ${SECRET}`));

      expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Reaped"), {
        deleted: 7,
        complete: true,
      });
    });
  });

  describe("when the database is unreachable", () => {
    beforeEach(() => {
      reapExpiredDemos.mockRejectedValue(new Error("connection terminated"));
    });

    test("answers 500 without the cause in the body", async () => {
      const response = await GET(requestWith(`Bearer ${SECRET}`));

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Reaping failed");
    });

    test("names the failure for whoever runs the app", async () => {
      await GET(requestWith(`Bearer ${SECRET}`));

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("reap"), expect.any(Error));
    });
  });
});
