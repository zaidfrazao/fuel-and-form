import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { FRAME, FRAME_MEASURE, FRAME_RAIL } from "@/lib/frame";

/**
 * The frame's one claim — Brand Guide § Desktop, FUEL-70.
 *
 * Everything about this grid is a computed style, and jsdom computes none of it:
 * it has no layout, so it cannot be asked where the demo banner's sentence
 * begins or how wide a track resolved to. The offsets are measured in a browser
 * (the PR carries the numbers) and the baselines hold the picture.
 *
 * What jsdom CAN hold is the structural claim underneath all of it, and it is
 * the one a later edit is most likely to break by accident: the content column
 * and the two notice bands take the SAME column of the SAME template. Not
 * similar classes — the same string, from one module.
 *
 * That is worth an assertion rather than a convention because the failure it
 * guards is exactly the one this ticket existed to fix. Three components each
 * centring themselves against a different reference looked correct in every
 * file, and disagreed by 124px on a screen. Any future edit that re-writes one
 * of these three boxes by hand will pass its own component's tests and fail
 * here, which is the only place the disagreement is visible.
 *
 * `walk-reminder.tsx` reads a session and a query, so those are mocked to the
 * shortest path that renders a band; who gets one is `walk-reminder.test.tsx`'s.
 */

const { getSession, loadWalkReminder } = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadWalkReminder: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/walk-reminder", () => ({ loadWalkReminder }));
vi.mock("@/app/actions/demo-banner", () => ({ dismissDemoBanner: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

getSession.mockResolvedValue({
  userId: "11111111-2222-3333-4444-555555555555",
  kind: "demo",
});
loadWalkReminder.mockResolvedValue({ at: "19:00" });

const { DemoBannerBar } = await import("@/components/demo-banner-bar");
const { WalkReminder } = await import("@/components/walk-reminder");
const { PageMain } = await import("@/components/page-main");
const { default: AppLayout } = await import("@/app/(app)/layout");

/**
 * A band's inner box: `aside` > frame > measure. Walked rather than queried, so
 * that a fourth element quietly inserted between them fails here too.
 */
const measureBoxOf = (band: Element) =>
  band.firstElementChild?.firstElementChild ?? null;

const classesOf = (element: Element | null) =>
  new Set((element?.className ?? "").split(" ").filter(Boolean));

/** Every class of the shared constant, present on the element. */
const wears = (element: Element | null, constant: string) => {
  const worn = classesOf(element);

  return constant.split(" ").every((className) => worn.has(className));
};

describe("the frame", () => {
  test("puts <main> and both notice bands in the same column", async () => {
    const { container: bannerTree } = render(<DemoBannerBar />);
    const { container: reminderTree } = render(await WalkReminder());
    const { container: mainTree } = render(<PageMain>content</PageMain>);

    const boxes = [
      measureBoxOf(bannerTree.querySelector("aside")!),
      measureBoxOf(reminderTree.querySelector("aside")!),
      mainTree.querySelector("main"),
    ];

    for (const box of boxes) {
      expect(box).not.toBeNull();
      // The whole constant, not a substring of it: `lg:col-start-2` alone is a
      // column with no width below the breakpoint, and `max-w` alone is the
      // 124px offset this ticket removed.
      expect(wears(box, FRAME_MEASURE)).toBe(true);
    }
  });

  test("holds the bands' outer boxes and the app layout to one container", async () => {
    const { container: bannerTree } = render(<DemoBannerBar />);
    const { container: reminderTree } = render(await WalkReminder());
    const { container: layoutTree } = render(
      <AppLayout>
        <main>Today</main>
      </AppLayout>,
    );

    const frames = [
      bannerTree.querySelector("aside")?.firstElementChild,
      reminderTree.querySelector("aside")?.firstElementChild,
      layoutTree.firstElementChild,
    ];

    for (const frame of frames) {
      expect(wears(frame ?? null, FRAME)).toBe(true);
    }
  });

  test("leaves the hairline full-bleed and moves only the inner box", async () => {
    // § Desktop: "Both notice bands keep their full-bleed hairline and their
    // independence; only the position of their inner box changes." The band's
    // border is on the `aside`, which is not in the frame — put the frame on
    // the `aside` instead and the rule stops at 1272px, which reads as the page
    // ending rather than as a band.
    const { container } = render(<DemoBannerBar />);

    const band = container.querySelector("aside")!;

    expect(classesOf(band).has("border-b")).toBe(true);
    expect(wears(band, FRAME)).toBe(false);
  });

  test("places the rail without moving it in the DOM", () => {
    const { container } = render(
      <AppLayout>
        <main>Today</main>
      </AppLayout>,
    );

    const shell = container.querySelector("nav")!;

    // Column one, and still the last child — `skip-link.tsx` and the layout's
    // own argument both rest on the shell coming after the content at every
    // width. `lg:order-first` said the same thing by shuffling siblings; this
    // says it by naming a column, and the DOM claim is the half that has to
    // hold either way.
    expect(wears(shell, FRAME_RAIL)).toBe(true);
    expect(shell.parentElement?.lastElementChild).toBe(shell);
  });
});
