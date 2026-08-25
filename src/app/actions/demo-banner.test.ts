import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Dismissing the demo banner — FUEL-42, § P7.
 *
 * What the cookie IS — its name, its flags, what counts as dismissed — is
 * `src/lib/demo-banner.test.ts`, against a value. What is left here is the part
 * only the action does, and each case is about a decision rather than a shape:
 *
 *   - the account written is the one the SERVER resolved, never one the caller
 *     named — there is no parameter, and this proves it stays that way;
 *   - an owner session writes nothing, because the owner has no banner;
 *   - a caller with no session writes nothing;
 *   - a failure is swallowed into a banner that stays put, not a 500 on the
 *     dismiss button of every screen in the app.
 */

const { cookies, getSession, refresh } = vi.hoisted(() => ({
  cookies: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth/session", () => ({ getSession }));

const { dismissDemoBanner } = await import("./demo-banner");
const { DEMO_BANNER_COOKIE, demoBannerCookieOptions } = await import("@/lib/demo-banner");

const USER_ID = "11111111-2222-3333-4444-555555555555";

/** The one method of the jar this action touches. */
let set: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  set = vi.fn();
  cookies.mockResolvedValue({ set });
  getSession.mockResolvedValue({ userId: USER_ID, kind: "demo" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dismissDemoBanner", () => {
  describe("on a demo session", () => {
    test("remembers the account it was dismissed for", async () => {
      // The value is the id, not a flag: the next visit is a different account
      // and must be told again that its changes are temporary.
      await dismissDemoBanner();

      expect(set).toHaveBeenCalledWith(DEMO_BANNER_COOKIE, USER_ID, demoBannerCookieOptions());
    });

    test("takes the account from the session, not from the caller", async () => {
      // The action accepts no argument at all, which is what makes this true by
      // construction. Asserted anyway, because adding one later would be a
      // one-line change that lets a POST name any account it likes.
      getSession.mockResolvedValue({ userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", kind: "demo" });

      await dismissDemoBanner();

      expect(set).toHaveBeenCalledWith(
        DEMO_BANNER_COOKIE,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        expect.anything(),
      );
    });

    test("re-renders the layout holding the banner", async () => {
      // The no-JavaScript path: without this the cookie is written and the
      // banner is served back until the next navigation.
      await dismissDemoBanner();

      expect(refresh).toHaveBeenCalled();
    });
  });

  describe("refuses to write", () => {
    test("for the owner, who has no banner", async () => {
      getSession.mockResolvedValue({ userId: USER_ID, kind: "owner" });

      await dismissDemoBanner();

      expect(set).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    test("for a caller with no session at all", async () => {
      getSession.mockResolvedValue(undefined);

      await dismissDemoBanner();

      expect(set).not.toHaveBeenCalled();
    });
  });

  describe("when something fails", () => {
    test("does not throw", async () => {
      // A thrown Server Action is a 500. This one is behind the dismiss button
      // on every screen in the app, and the worst honest outcome is a banner
      // that stays where it was.
      getSession.mockRejectedValue(new Error("connection terminated"));

      await expect(dismissDemoBanner()).resolves.toBeUndefined();
    });

    test("names the failure for whoever runs the app", async () => {
      getSession.mockRejectedValue(new Error("connection terminated"));

      await dismissDemoBanner();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("dismiss"),
        expect.any(Error),
      );
    });
  });
});
