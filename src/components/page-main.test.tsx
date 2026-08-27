import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MAIN_ID, PageMain } from "@/components/page-main";

/**
 * The content column — FUEL-61.
 *
 * Two of this component's three jobs are invisible at runtime and silent when
 * broken, which is what makes them worth pinning here.
 *
 * The `id` and `tabIndex` are what the skip link and Next's route-change focus
 * both land on. Drop either and nothing throws: the skip link scrolls without
 * moving focus, and Next's `domNode.focus()` becomes the no-op it was before
 * this component existed. Both failures look exactly like success from the
 * outside, so neither would be caught by anything but an assertion.
 *
 * The layout classes are the same shape of failure one level up — a `<main>`
 * that is not `flex-1` ends above the fold and takes the sticky action bars with
 * it, and one that is not `min-w-0` pushed `/plan`'s week grid off the right of
 * the screen at 1024px. jsdom cannot evaluate either, but it can hold the class
 * that prevents them.
 */
describe("PageMain", () => {
  test("is a <main> the skip link and Next's focus call can both land on", () => {
    render(<PageMain>content</PageMain>);

    const main = screen.getByRole("main");

    expect(main.id).toBe(MAIN_ID);
    // -1 and not 0: focusable by script, never in the tab order. A content
    // column the user has to Tab through is a regression, not a fix.
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  test("carries the layout invariants a page cannot be trusted to repeat", () => {
    render(<PageMain>content</PageMain>);

    const className = screen.getByRole("main").className;

    // The three from FUEL-58 that fail silently, plus the column itself.
    for (const invariant of ["flex", "w-full", "min-w-0", "flex-1", "flex-col"]) {
      expect(className).toContain(invariant);
    }
  });

  test("takes a screen's own classes without losing its own", () => {
    render(<PageMain className="gap-7 py-8">content</PageMain>);

    const className = screen.getByRole("main").className;

    expect(className).toContain("gap-7");
    expect(className).toContain("py-8");
    expect(className).toContain("flex-1");
  });

  test("lets one screen widen the column, which only /plan does", () => {
    // `/plan`'s week grid is 1023px and needs the room. This asserts the
    // override actually wins rather than sitting beside the default and losing
    // to it — `cn` resolves the conflict, and a plain string join would not.
    render(<PageMain className="max-w-[1024px]">content</PageMain>);

    const className = screen.getByRole("main").className;

    expect(className).toContain("max-w-[1024px]");
    expect(className).not.toContain("max-w-[640px]");
  });
});
