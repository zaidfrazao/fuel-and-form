import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MAIN_ID } from "@/components/page-main";
import { SkipLink } from "@/components/skip-link";

/**
 * The bypass — FUEL-61, WCAG 2.4.1.
 *
 * jsdom applies no CSS, so nothing here can prove the link is invisible until
 * focused or visible once it is. What it CAN hold is the pair of classes that
 * decide it, and the target it points at — and the target is the half that
 * breaks silently, because `href="#main"` against an id that has been renamed
 * scrolls nowhere and throws nothing.
 */
describe("SkipLink", () => {
  test("points at the id PageMain renders", () => {
    render(<SkipLink />);

    // Read from the constant rather than written as "#main": that is the whole
    // reason the constant is exported, and a test that hard-coded the string
    // would keep passing through exactly the rename it exists to catch.
    expect(screen.getByRole("link").getAttribute("href")).toBe(`#${MAIN_ID}`);
  });

  test("is reachable by keyboard while hidden, and shown once focused", () => {
    render(<SkipLink />);

    const className = screen.getByRole("link").className;

    // `sr-only` clips the link to 1px without removing it from the tab order or
    // the accessibility tree; `focus:not-sr-only` reverses that on focus. Drop
    // the first and it is visible on every screen; drop the second and a
    // sighted keyboard user tabs to something they cannot see.
    expect(className).toContain("sr-only");
    expect(className).toContain("focus:not-sr-only");
  });

  test("names its destination rather than what it skips", () => {
    render(<SkipLink />);

    // What sits above the content is a banner and a reminder as often as it is
    // the nav, so the name describes where the link goes. § Tone of Voice.
    expect(screen.getByRole("link").textContent).toBe("Skip to content");
  });
});
