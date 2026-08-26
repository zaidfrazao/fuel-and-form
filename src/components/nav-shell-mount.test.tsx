import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NavShellMount } from "@/components/nav-shell-mount";

/**
 * The shell's mount — FUEL-58.
 *
 * `nav-shell.test.tsx` owns the shell's accessibility contract and
 * `/dev/nav-shell` owned its pixels. What is left for this file is the one
 * thing neither could check, because neither had a router: that the pathname
 * the shell resolves against is the REAL one.
 *
 * `usePathname` is mocked rather than driven through a router, for the reason
 * every other suite here mocks `next/navigation` — the hermetic suite has no
 * Next request context to give it. That is the whole of the boundary this
 * component draws, so mocking it leaves nothing untested but the framework.
 */
const usePathname = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));

beforeEach(() => {
  usePathname.mockReset();
});

/** The active item, by its accessible name — `aria-current` is the tell. */
const current = () =>
  screen.getByRole("navigation", { name: "Primary" }).querySelector("[aria-current='page']")
    ?.getAttribute("aria-label") ?? null;

describe("the mounted shell", () => {
  test("lights the destination for the route it is actually on", () => {
    usePathname.mockReturnValue("/training");

    render(<NavShellMount />);

    expect(current()).toBe("Training");
  });

  test("lights a level-2 route's parent, not nothing", () => {
    // The case that made `lib/nav.ts` a table rather than a prefix match, now
    // proved through the real hook: `/shopping` is level 2 under Plan with a
    // flat URL, so segment matching would light nothing at all here.
    usePathname.mockReturnValue("/shopping");

    expect(render(<NavShellMount />) && current()).toBe("Plan");
  });

  test("follows the pathname when it changes, rather than freezing on first paint", () => {
    // The reason this component exists at all. The layout does NOT re-render on
    // navigation within the route group — that is the point of putting the
    // shell in a layout — so without a router subscription here the active item
    // would stay on whatever route was loaded first.
    usePathname.mockReturnValue("/");

    const { rerender } = render(<NavShellMount />);
    expect(current()).toBe("Now");

    usePathname.mockReturnValue("/weight");
    rerender(<NavShellMount />);

    expect(current()).toBe("Weight");
  });

  test("renders the shell with nothing lit on a route outside the hierarchy", () => {
    // `/login` and `/dev/*` are held out by the route group and never reach
    // this component. If one ever does — a route added to the group by mistake,
    // or a route added to neither — it resolves to null and lights nothing,
    // rather than lighting a neighbour whose URL happens to be a prefix.
    usePathname.mockReturnValue("/dev/nav-shell");

    render(<NavShellMount />);

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeDefined();
    expect(current()).toBeNull();
  });

  test("forwards the arrangement the layout gives it", () => {
    // The sidebar's placement is the layout's argument, not this component's,
    // so the class has to survive the hop. Asserted because a dropped
    // `className` would fail silently: the shell would render, correctly, in
    // the wrong place and only at ≥1024px.
    usePathname.mockReturnValue("/");

    render(<NavShellMount className="lg:order-first" />);

    expect(screen.getByRole("navigation", { name: "Primary" }).className).toContain(
      "lg:order-first",
    );
  });
});
