import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import AppLayout from "@/app/(app)/layout";
import { FRAME } from "@/lib/frame";

/**
 * The app's frame — FUEL-58.
 *
 * Three of this layout's four properties are claims about CSS that jsdom cannot
 * evaluate, and they were measured in a browser instead. What jsdom CAN hold is
 * the structural claim underneath them, which is the one a later edit is most
 * likely to break by accident: the shell is `<main>`'s SIBLING and comes after
 * it.
 *
 * That is not a stylistic preference. `/`'s action bar and `/training`'s are
 * `sticky bottom-0` inside `<main>`, and a sticky box is clamped to its own
 * parent — so with the shell outside main the bar can only reach main's bottom
 * edge, which is exactly where the shell begins. Move the shell inside `<main>`
 * and the bar floats over it. Nothing about that failure is visible in a unit
 * test, so this asserts the arrangement that prevents it.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const layout = () =>
  render(
    <AppLayout>
      <main>
        <h1>Today</h1>
      </main>
    </AppLayout>,
  );

describe("the app frame", () => {
  test("puts the shell after <main>, as its sibling", () => {
    const { container } = layout();

    const wrapper = container.firstElementChild;
    const children = [...(wrapper?.children ?? [])];

    expect(children.map((child) => child.tagName)).toEqual(["MAIN", "NAV"]);
    // The one that matters: not merely present, but NOT inside main.
    expect(screen.getByRole("main").querySelector("nav")).toBeNull();
  });

  test("owns the viewport height, which the pages gave up", () => {
    // Every screen in this group used to be `min-h-dvh` on its own `<main>`.
    // That cannot survive a shell below it — main fills the viewport, the shell
    // is appended underneath, and every page is taller than the screen before
    // it has any content. The constraint lives here now and the pages are
    // `flex-1`; if it ever moves back, everything scrolls by the shell's height.
    const { container } = layout();

    expect(container.firstElementChild?.className).toContain("min-h-dvh");
  });

  test("is the frame, and the shell is its first column", () => {
    // FUEL-70. Three of this layout's properties used to be flex ones and two
    // of those are gone — the row and the shell's own 220px width — because the
    // frame declares both. What replaced them has to be asserted here rather
    // than left to the baselines: a wrapper that is not the frame puts `<main>`
    // back on a centre of its own, which is the 124px the notice bands were out
    // by and which nothing below `lg` would show.
    const { container } = layout();

    for (const invariant of FRAME.split(" ")) {
      expect(container.firstElementChild?.className).toContain(invariant);
    }

    expect(screen.getByRole("navigation", { name: "Primary" }).className).toContain(
      "lg:col-start-1",
    );
  });

  test("renders exactly one Primary landmark", () => {
    // § Navigation's shell is a single `<nav>` that reflows rather than a pill
    // and a sidebar toggled with `hidden`/`lg:block`, precisely so this holds at
    // every width. Mounting it in a layout is the other half of the guarantee:
    // a page that rendered its own would put a second one in the document, and
    // a screen-reader user jumping by landmark would meet two.
    layout();

    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
  });
});
