import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `GET /api/cron/walk-reminder` — the gate, and what one bad subscription does
 * to the others. FUEL-47, § P9.
 *
 * `src/lib/push.test.ts` covers what the notification SAYS and which statuses
 * mean a row is dead, against values. `src/lib/cron.test.ts` covers who may
 * call this. What is left here is the part only the route does, and every one of
 * them is invisible from either of those files — and from a running deployment,
 * because this route has no user on the other end and no screen anywhere:
 *
 *   - an unauthorized caller sends NOTHING. Not "its result is discarded",
 *     which is the version of this test that passes while a phone has already
 *     buzzed.
 *   - unset VAPID keys are a 200, deliberately unlike the reaper's 500 for an
 *     unset CRON_SECRET. P9 asks push to degrade silently; an unconfigured
 *     deployment is a supported state, not a fault.
 *   - a subscription already reached today is skipped, which is the whole of
 *     "one notification per day maximum".
 *   - a 410 prunes the row and a 500 does NOT. This is the only branch in the
 *     feature that destroys something, and getting it wide silently
 *     unsubscribes a working phone.
 *   - one failure does not stop the sends behind it.
 *
 * The secret is invented and set per test, never read from the environment.
 */

const {
  isAuthorizedCron,
  cronSecret,
  vapidKeys,
  walksOwedANotification,
  markNotified,
  dropSubscription,
  sendNotification,
  setVapidDetails,
  WebPushError,
} = vi.hoisted(() => {
  // The library's own error shape, reproduced rather than imported: the route
  // narrows on `instanceof`, so the class the test throws must be the class the
  // route checks against — which means the mock has to own it.
  class WebPushError extends Error {
    statusCode: number;

    constructor(statusCode: number) {
      super(`push failed with ${statusCode}`);
      this.statusCode = statusCode;
    }
  }

  return {
    isAuthorizedCron: vi.fn(),
    cronSecret: vi.fn(),
    vapidKeys: vi.fn(),
    walksOwedANotification: vi.fn(),
    markNotified: vi.fn(),
    dropSubscription: vi.fn(),
    sendNotification: vi.fn(),
    setVapidDetails: vi.fn(),
    WebPushError,
  };
});

vi.mock("web-push", () => ({
  default: { setVapidDetails, sendNotification },
  WebPushError,
}));
vi.mock("@/lib/cron", () => ({ isAuthorizedCron }));
vi.mock("@/lib/env", () => ({ cronSecret, vapidKeys }));
vi.mock("@/lib/db/queries/push", () => ({
  walksOwedANotification,
  markNotified,
  dropSubscription,
}));

const { GET } = await import("./route");

const SECRET = "Nq8vT2mZ0rLk6hYb3wXc5JpD1sFgA7eU";

const KEYS = {
  publicKey: "BExamplePublicKey",
  privateKey: "example-private-key",
  subject: "https://example.test",
};

/** A subscription owed a notification: never reached before. */
const target = (id: string, lastNotifiedOn: string | null = null) => ({
  id,
  endpoint: `https://push.example.test/${id}`,
  p256dh: "key",
  auth: "auth",
  lastNotifiedOn,
});

const owed = (...targets: ReturnType<typeof target>[]) => [
  { userId: "user-1", at: "19:00", today: "2026-08-26", targets },
];

const requestWith = (authorization?: string) =>
  new Request("https://example.test/api/cron/walk-reminder", {
    headers: authorization === undefined ? {} : { authorization },
  });

beforeEach(() => {
  vi.clearAllMocks();
  cronSecret.mockReturnValue(SECRET);
  isAuthorizedCron.mockReturnValue(true);
  vapidKeys.mockReturnValue(KEYS);
  walksOwedANotification.mockResolvedValue([]);
  sendNotification.mockResolvedValue({ statusCode: 201 });
  markNotified.mockResolvedValue(undefined);
  dropSubscription.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("when the caller cannot prove who it is", () => {
  beforeEach(() => {
    isAuthorizedCron.mockReturnValue(false);
    walksOwedANotification.mockResolvedValue(owed(target("a")));
  });

  test("answers 401", async () => {
    expect((await GET(requestWith("Bearer wrong"))).status).toBe(401);
  });

  test("sends nothing, and does not even look", async () => {
    // The assertion this block exists for. A route that sent first and checked
    // afterwards would pass the status test above while a phone had buzzed.
    await GET(requestWith("Bearer wrong"));

    expect(walksOwedANotification).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("says nothing about why", async () => {
    const response = await GET(requestWith("Bearer wrong"));

    expect(await response.text()).toBe("Unauthorized");
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("when the deployment has no VAPID keys", () => {
  beforeEach(() => {
    vapidKeys.mockReturnValue(null);
    walksOwedANotification.mockResolvedValue(owed(target("a")));
  });

  test("answers 200, not 500", async () => {
    // Deliberately unlike `cronSecret`, which throws. P9: push degrades
    // silently to the banner, so a deployment with no keys is the app with one
    // of two layers off — not a fault to be reported every evening forever.
    expect((await GET(requestWith(`Bearer ${SECRET}`))).status).toBe(200);
  });

  test("sends nothing and reports zero", async () => {
    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(await response.json()).toEqual({ sent: 0, capped: 0, pruned: 0, failed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("says so in the log, because nothing else can", async () => {
    // "Push is not configured" and "push is configured and nobody was owed one"
    // are identical from outside, and this line is the only thing separating
    // them for whoever is wondering why no notification arrived.
    await GET(requestWith(`Bearer ${SECRET}`));

    expect(console.info).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("the once-a-day cap", () => {
  test("skips a browser already reached today, and counts it", async () => {
    walksOwedANotification.mockResolvedValue(owed(target("a", "2026-08-26")));

    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(sendNotification).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ sent: 0, capped: 1 });
  });

  test("still reaches a second device that has not been", async () => {
    // The reason the cap is per-subscription rather than per-profile: a phone
    // reached this morning must not silence the laptop.
    walksOwedANotification.mockResolvedValue(
      owed(target("phone", "2026-08-26"), target("laptop")),
    );

    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ sent: 1, capped: 1 });
  });
});

describe("a successful send", () => {
  beforeEach(() => {
    walksOwedANotification.mockResolvedValue(owed(target("a")));
  });

  test("goes to the browser's own endpoint and keys", async () => {
    await GET(requestWith(`Bearer ${SECRET}`));

    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.test/a",
        keys: { p256dh: "key", auth: "auth" },
      },
      expect.any(String),
    );
  });

  test("carries the banner's sentence and the deep link", async () => {
    await GET(requestWith(`Bearer ${SECRET}`));

    const payload = JSON.parse(sendNotification.mock.calls[0]?.[1] as string);

    expect(payload.body).toBe("Walk not logged. Reminder set for 19:00. Log the walk.");
    expect(payload.url).toBe("/");
  });

  test("records the date only after the send resolves", async () => {
    // The other order would cap a browser for the day on the strength of a
    // request that never arrived — silence today AND tomorrow's run believing
    // it had already done the job.
    const order: string[] = [];

    sendNotification.mockImplementation(async () => {
      order.push("send");
      return { statusCode: 201 };
    });
    markNotified.mockImplementation(async () => {
      order.push("mark");
    });

    await GET(requestWith(`Bearer ${SECRET}`));

    expect(order).toEqual(["send", "mark"]);
    expect(markNotified).toHaveBeenCalledWith("a", "2026-08-26");
  });
});

describe("when a send fails", () => {
  test("prunes the row on a 410, because the browser threw it away", async () => {
    walksOwedANotification.mockResolvedValue(owed(target("a")));
    sendNotification.mockRejectedValue(new WebPushError(410));

    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(dropSubscription).toHaveBeenCalledWith("a");
    expect(markNotified).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ sent: 0, pruned: 1, failed: 0 });
  });

  test("keeps the row on a 500, and does not cap it either", async () => {
    // The direction that matters. Deleting here would silently unsubscribe a
    // working phone on one bad night, with nothing on any screen to say so —
    // and leaving `lastNotifiedOn` alone is what lets tomorrow try again.
    walksOwedANotification.mockResolvedValue(owed(target("a")));
    sendNotification.mockRejectedValue(new WebPushError(500));

    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(dropSubscription).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ sent: 0, pruned: 0, failed: 1 });
  });

  test("keeps the row when the failure carried no status at all", async () => {
    walksOwedANotification.mockResolvedValue(owed(target("a")));
    sendNotification.mockRejectedValue(new Error("socket hang up"));

    await GET(requestWith(`Bearer ${SECRET}`));

    expect(dropSubscription).not.toHaveBeenCalled();
  });

  test("logs the status but never the endpoint", async () => {
    // The endpoint is a credential. This route's whole caution is about reading
    // across users, and a log line is the easiest place for one to escape to.
    walksOwedANotification.mockResolvedValue(owed(target("a")));
    sendNotification.mockRejectedValue(new WebPushError(500));

    await GET(requestWith(`Bearer ${SECRET}`));

    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "push.example.test",
    );
  });

  test("does not stop the sends behind it", async () => {
    // One dead subscription must not silence every device after it in the loop.
    walksOwedANotification.mockResolvedValue(
      owed(target("dead"), target("live-1"), target("live-2")),
    );
    sendNotification
      .mockRejectedValueOnce(new WebPushError(410))
      .mockResolvedValue({ statusCode: 201 });

    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(await response.json()).toMatchObject({ sent: 2, pruned: 1 });
  });
});

describe("the response itself", () => {
  test("is never cached", async () => {
    // A cached "sent 0" served to tomorrow's invocation is a job that silently
    // stopped running while continuing to report success.
    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("names the deployment to the push service before sending", async () => {
    walksOwedANotification.mockResolvedValue(owed(target("a")));

    await GET(requestWith(`Bearer ${SECRET}`));

    expect(setVapidDetails).toHaveBeenCalledWith(
      KEYS.subject,
      KEYS.publicKey,
      KEYS.privateKey,
    );
  });
});
