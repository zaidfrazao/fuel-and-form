import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Who gets a demo banner — FUEL-42, § P7.
 *
 * What the banner LOOKS like is `demo-banner-bar.test.tsx`. This is the gate in
 * front of it, and every case is a decision that would be invisible if it went
 * wrong in the quiet direction:
 *
 *   - the OWNER must never see it. It sits in the root layout, so a gate that
 *     read "is there a demo cookie" rather than "what kind is this session"
 *     would tell the owner — who may hold both cookies, which `auth/session.ts`
 *     deliberately supports — that their own data is about to be deleted.
 *   - a dismissal must be honoured, and must belong to THIS session. A cookie
 *     from the previous visit naming a different account is not a dismissal of
 *     this one.
 *   - `/login` has no session, and must not be a 500.
 *
 * The bar is mocked to a marker: this file is about the decision, and rendering
 * the real one would make every case here depend on its markup as well.
 */

const { getSession, cookies } = vi.hoisted(() => ({
  getSession: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("./demo-banner-bar", () => ({
  DemoBannerBar: () => <div data-testid="banner" />,
}));

const { DemoBanner } = await import("./demo-banner");
const { DEMO_BANNER_COOKIE } = await import("@/lib/demo-banner");

const USER_ID = "11111111-2222-3333-4444-555555555555";
const PREVIOUS_VISIT = "99999999-8888-7777-6666-555555555555";

/** The jar as this component reads it: one `get`, by name. */
const jarHolding = (value?: string) => ({
  get: (name: string) => (name === DEMO_BANNER_COOKIE && value ? { value } : undefined),
});

/** Renders the async server component. */
const renderBanner = async () => render(await DemoBanner());

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: USER_ID, kind: "demo" });
  cookies.mockResolvedValue(jarHolding());
});

describe("DemoBanner", () => {
  test("shows on a demo session", async () => {
    await renderBanner();

    expect(screen.getByTestId("banner")).toBeTruthy();
  });

  test("never shows for the owner", async () => {
    // Decided by the session's KIND, not by the presence of a demo cookie —
    // the owner is allowed to hold one, having tried their own demo.
    getSession.mockResolvedValue({ userId: USER_ID, kind: "owner" });

    await renderBanner();

    expect(screen.queryByTestId("banner")).toBeNull();
  });

  test("does not show with no session at all", async () => {
    // `/login`. It renders through this layout like every other route, and the
    // answer has to be "nothing" rather than a throw.
    getSession.mockResolvedValue(undefined);

    await renderBanner();

    expect(screen.queryByTestId("banner")).toBeNull();
  });

  test("reads no cookie when there is no banner to hide", async () => {
    // The owner's render costs nothing beyond the session it was already going
    // to resolve.
    getSession.mockResolvedValue({ userId: USER_ID, kind: "owner" });

    await renderBanner();

    expect(cookies).not.toHaveBeenCalled();
  });

  test("stays hidden once this session has dismissed it", async () => {
    cookies.mockResolvedValue(jarHolding(USER_ID));

    await renderBanner();

    expect(screen.queryByTestId("banner")).toBeNull();
  });

  test("shows again for a session the previous visit's dismissal named", async () => {
    // The reason the cookie holds an id. Each visit provisions an independent
    // account, so this one's changes are newly temporary and it has not been
    // told so yet.
    cookies.mockResolvedValue(jarHolding(PREVIOUS_VISIT));

    await renderBanner();

    expect(screen.getByTestId("banner")).toBeTruthy();
  });

  test("shows when the cookie holds something malformed", async () => {
    // Reachable by anyone editing a cookie in their own browser. The honest
    // answer is the answer to no cookie, and it must not be a 500 — this
    // renders on every screen in the app.
    cookies.mockResolvedValue(jarHolding("}{not-a-uuid"));

    await renderBanner();

    expect(screen.getByTestId("banner")).toBeTruthy();
  });
});
