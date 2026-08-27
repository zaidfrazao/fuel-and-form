import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MAIN_ID } from "@/components/page-main";
import { RouteFocus } from "@/components/route-focus";

/**
 * Route-change focus — FUEL-61.
 *
 * Two of the three behaviours here are things this component deliberately does
 * NOT do, and both look like bugs to anyone reading it without the argument:
 * a cold load leaves focus alone, and a query-only navigation leaves focus
 * alone. Each is a decision recorded in `route-focus.tsx` and on the ticket, so
 * each gets a test — a deliberate omission that nothing asserts is one the next
 * person "fixes".
 *
 * What jsdom cannot reach is the streaming case: the skeleton being swapped for
 * the real screen mid-navigation, and the MutationObserver that re-asserts focus
 * when it is. That was measured in a browser instead (122ms to the skeleton,
 * 452ms to the content) and is written up where the observer is.
 */
const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

/** A stand-in for the page's own `PageMain`, which the layout renders beside this. */
const withMain = () => {
  const main = document.createElement("main");
  main.id = MAIN_ID;
  main.tabIndex = -1;
  document.body.append(main);
  return main;
};

beforeEach(() => {
  document.body.innerHTML = "";
  pathname.current = "/";
});

describe("RouteFocus", () => {
  test("leaves focus alone on a cold load", () => {
    // The skip link is the first thing a Tab reaches, and it only works if focus
    // starts at the top of the document. Focusing <main> on first paint would
    // step over the bypass on the one load where the user has not asked to go
    // anywhere yet.
    const main = withMain();

    render(<RouteFocus />);

    expect(document.activeElement).not.toBe(main);
    expect(document.activeElement).toBe(document.body);
  });

  test("moves focus into <main> when the destination changes", () => {
    const main = withMain();
    const view = render(<RouteFocus />);

    pathname.current = "/plan";
    view.rerender(<RouteFocus />);

    expect(document.activeElement).toBe(main);
  });

  test("moves focus without scrolling", () => {
    // jsdom does not scroll, so the only way to hold this is to watch the call.
    // It matters: Next already owns scroll position on navigation, and anything
    // here that scrolled would owe § Accessibility a `prefers-reduced-motion`
    // answer. `preventScroll` means there is no motion to suppress.
    const main = withMain();
    const focus = vi.spyOn(main, "focus");
    const view = render(<RouteFocus />);

    pathname.current = "/weight";
    view.rerender(<RouteFocus />);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  test("leaves focus alone when only the query changed", () => {
    // `/training?date=` and `/plan?week=` re-render this component without
    // changing the path. Both paginators are built on focus STAYING on the
    // control — they carry `aria-live` labels for exactly that reason — so
    // moving it here would break repeat-stepping and double-announce.
    const main = withMain();
    const control = document.createElement("a");
    control.href = "/training?date=2026-08-26";
    document.body.append(control);
    control.focus();

    const view = render(<RouteFocus />);

    // Same pathname, as a query-only navigation produces.
    view.rerender(<RouteFocus />);

    expect(document.activeElement).toBe(control);
    expect(document.activeElement).not.toBe(main);
  });
});
