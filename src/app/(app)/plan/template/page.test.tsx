import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `/plan/template` — the route, not the editor.
 *
 * `template-editor.test.tsx` covers the grid this screen renders. What is left
 * is what the route itself decides, and until FUEL-59 it decided one thing
 * wrong: the link above the `<h1>` was hardcoded to `/settings`.
 *
 * That is worth a file of its own rather than leaving it to
 * `up-link.test.tsx`, which proves the component resolves `/plan/template` to
 * `/plan`. It cannot prove this page passes the component its own pathname —
 * a `pathname` typo here would render the wrong screen's up-link, or none, and
 * every test in that other file would still pass.
 */

const { redirect, getSession, loadTemplate } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates the render. A mock
    // that only recorded the call would let the page run on with no session.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadTemplate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/template", () => ({ loadTemplate }));
// The editor is a client component importing a "use server" module, which
// cannot be imported under jsdom — the reason `/settings` and `/weight` mock
// their actions too.
vi.mock("@/app/actions/template", () => ({
  setTemplateMeal: vi.fn(),
  clearTemplateMeal: vi.fn(),
}));

const { default: TemplatePage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadTemplate.mockResolvedValue({ entries: [], meals: [] });
});

describe("the up-link", () => {
  /*
   * The bug, at the one place it was visible.
   *
   * Two screens link here — `/plan` ("Edit the weekly template") and
   * `/settings` ("Weekly template") — and only one of them is the parent.
   * § Navigation: "**`/plan/template` has one parent and it is `/plan`**...
   * Settings keeps its link to it... but a link is not a parent." Arriving
   * from the weekly plan, which is the likelier route since that is where the
   * template's effect shows up, the only way out sent you to Settings.
   */
  test("goes up to the plan, not to the screen that links here", async () => {
    render(await TemplatePage());

    const link = screen.getByRole("link", { name: "Back to Plan" });

    expect(link.getAttribute("href")).toBe("/plan");
    expect(link.getAttribute("href")).not.toBe("/settings");
  });

  /*
   * One up-link and no second candidate for it. § Navigation: a cross-link
   * "must never be styled as an up-link, because a second thing that looks
   * like a way back is a second parent in everything but name." This screen
   * has no cross-links today, so the assertion is that it stays that way.
   */
  test("is the only way back this screen offers", async () => {
    render(await TemplatePage());

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  /*
   * No `?week=`. The template is what recurs EVERY week — it is the one plan
   * screen not addressed by one — so a week appended here would name a week
   * the user was never looking at.
   */
  test("carries no week, because the template has none", async () => {
    render(await TemplatePage());

    expect(
      screen.getByRole("link", { name: "Back to Plan" }).getAttribute("href"),
    ).not.toContain("?");
  });
});

describe("the session", () => {
  /* The gate, asserted on its closed side — `/settings`' test's reasoning. */
  test("sends a signed-out visitor to the login screen", async () => {
    getSession.mockResolvedValue(null);

    await expect(TemplatePage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(loadTemplate).not.toHaveBeenCalled();
  });
});
