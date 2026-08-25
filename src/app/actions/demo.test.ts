import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * P7's entry point — what happens when a stranger clicks "Try the demo"
 * (FUEL-40).
 *
 * Mocked the way `weight.test.ts` and `training.test.ts` are: the headers, the
 * database and the cookie jar all ARE the request, so what is left is the part
 * only this file does. Which is less than it looks — the limits are decided in
 * `src/lib/demo.ts` and asserted there, and whether the rows land is asserted
 * against real Postgres in tests/integration/demo.test.ts.
 *
 * What can only be asserted here is ORDER, and every case below is about it:
 *
 *   - the client is hashed before it reaches the database, never sent raw;
 *   - the cookie is issued only AFTER provisioning has committed;
 *   - a refusal issues no cookie and does not redirect;
 *   - `redirect` is not swallowed by the catch that wraps everything else.
 *
 * That last one is the reason this file exists. `redirect` works by throwing,
 * so a `try` one line too wide turns every SUCCESSFUL provision into "could not
 * be started" — after an account has already been created and a cookie already
 * set. It looks exactly like a failure and passes any manual test that only
 * ever checks the unhappy path.
 */

const { headers, provisionDemoUser, startSession, sessionSecret, redirect } = vi.hoisted(
  () => ({
    headers: vi.fn(),
    provisionDemoUser: vi.fn(),
    startSession: vi.fn(),
    sessionSecret: vi.fn(),
    redirect: vi.fn(),
  }),
);

vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ startSession }));
vi.mock("@/lib/db/queries/demo", () => ({ provisionDemoUser }));
vi.mock("@/lib/env", () => ({ sessionSecret }));

const { startDemo } = await import("./demo");
const { hashClientIp } = await import("@/lib/demo");

const USER = "11111111-2222-3333-4444-555555555555";
const SECRET = "action-secret-not-a-real-one";
const CLIENT = "203.0.113.7";

/** The two arguments `useActionState` passes; this action reads neither. */
const submit = () => startDemo(undefined, new FormData());

/** `redirect` throws in production. Left as a no-op mock except where noted. */
beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers({ "x-forwarded-for": CLIENT }));
  provisionDemoUser.mockResolvedValue({ ok: true, userId: USER });
  sessionSecret.mockReturnValue(SECRET);
});

describe("provisioning a session", () => {
  test("hashes the client before it reaches the database", async () => {
    await submit();

    const [ipHash] = provisionDemoUser.mock.calls[0] ?? [];

    // The address itself must not be what is passed down: `users.ip_hash` is
    // committed to a row in a public project's database, and the column's whole
    // justification is that it holds provenance rather than an address.
    expect(ipHash).toBe(hashClientIp(CLIENT, SECRET));
    expect(ipHash).not.toContain(CLIENT);
  });

  test("still provisions when nothing identifies the client", async () => {
    // `next dev` sets no `x-forwarded-for`. The demo must still work locally —
    // the limit falls back to a shared bucket rather than to a refusal.
    headers.mockResolvedValue(new Headers());

    await submit();

    expect(provisionDemoUser).toHaveBeenCalledWith(
      hashClientIp(undefined, SECRET),
      expect.any(Date),
    );
  });

  test("issues the demo cookie for the account that was created", async () => {
    await submit();

    expect(startSession).toHaveBeenCalledWith(USER, "demo");
  });

  test("issues the cookie only after provisioning has returned", async () => {
    // The ordering, asserted rather than read off the source. Reversed, a
    // rolled-back transaction leaves a cookie naming a user that was never
    // committed — resolve.ts refuses it, and the visitor is bounced back to the
    // login screen with nothing on it to explain why.
    const order: string[] = [];

    provisionDemoUser.mockImplementation(async () => {
      order.push("provision");

      return { ok: true, userId: USER };
    });
    startSession.mockImplementation(async () => {
      order.push("cookie");
    });

    await submit();

    expect(order).toEqual(["provision", "cookie"]);
  });

  test("sends the visitor to the Right Now view", async () => {
    await submit();

    // P7: "lands directly on a populated Right Now view" — not to a
    // confirmation, and not back to the login screen.
    expect(redirect).toHaveBeenCalledWith("/");
  });

  test("redirects rather than returning an error, when redirect throws", async () => {
    // What `redirect` really does. If the try block ever grows to cover it,
    // this is the assertion that fails — and it is the only one that can,
    // because every other case here would still pass.
    const bail = new Error("NEXT_REDIRECT");

    redirect.mockImplementation(() => {
      throw bail;
    });

    await expect(submit()).rejects.toBe(bail);
  });
});

describe("when a session is refused", () => {
  test("says how long to wait when the client has had its allowance", async () => {
    provisionDemoUser.mockResolvedValue({ ok: false, refusal: "rate-limited" });

    await expect(submit()).resolves.toEqual({
      error: "You have opened several demos already. Try again in a few minutes.",
    });
  });

  test("says the site is busy when the cap is reached", async () => {
    provisionDemoUser.mockResolvedValue({ ok: false, refusal: "at-capacity" });

    await expect(submit()).resolves.toEqual({
      error: "The demo is at capacity right now. Try again in a little while.",
    });
  });

  test("distinguishes the two, because neither is a secret", async () => {
    // The opposite of login/actions.ts, deliberately — see the note there and
    // the one on `Refusal` in src/lib/demo.ts. Collapsing these to one sentence
    // would be a silent loss of the only actionable thing either of them says.
    provisionDemoUser.mockResolvedValue({ ok: false, refusal: "rate-limited" });
    const limited = await submit();

    provisionDemoUser.mockResolvedValue({ ok: false, refusal: "at-capacity" });
    const full = await submit();

    expect(limited).not.toEqual(full);
  });

  test("issues no cookie and goes nowhere", async () => {
    provisionDemoUser.mockResolvedValue({ ok: false, refusal: "at-capacity" });

    await submit();

    expect(startSession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("when something breaks", () => {
  const failures = [
    ["the database is unreachable", () => provisionDemoUser.mockRejectedValue(new Error("ECONNREFUSED"))],
    ["SESSION_SECRET is not configured", () => sessionSecret.mockImplementation(() => { throw new Error("Missing required environment variable SESSION_SECRET"); })],
    ["the cookie cannot be written", () => startSession.mockRejectedValue(new Error("headers already sent"))],
  ] as const;

  test.each(failures)("returns one message rather than throwing: %s", async (_name, arrange) => {
    // A thrown Server Action is a 500 with nothing for the client to render,
    // and Brand Guide § Feedback asks for an inline banner — which needs
    // something to come back. None of these three is anything a visitor can act
    // on, so unlike the two refusals above they are collapsed into one.
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange();

    await expect(submit()).resolves.toEqual({
      error: "The demo could not be started. Try again.",
    });

    expect(redirect).not.toHaveBeenCalled();
  });

  test("logs the failure without the client's address in it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    provisionDemoUser.mockRejectedValue(new Error("ECONNREFUSED"));

    await submit();

    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(CLIENT);
  });
});
