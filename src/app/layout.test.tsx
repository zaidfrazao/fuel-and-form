import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import RootLayout from "@/app/layout";
import { PageMain } from "@/components/page-main";

/**
 * The root layout's one testable structural claim — FUEL-61.
 *
 * "The skip link is the first focusable element" is a property of ORDER, and
 * order is exactly what a later edit breaks without noticing: anything added to
 * this layout above the link demotes it, and the app still renders, still
 * passes every other test, and quietly stops satisfying WCAG 2.4.1. The link
 * itself is covered in `components/skip-link.test.tsx`; this file covers where
 * it sits relative to the chrome it exists to bypass.
 *
 * The two bars are stubbed rather than rendered. Both are async server
 * components that open a session and hit the database, and neither's real
 * content matters here — what matters is that they are focusable and above
 * `children`, which is what the stubs reproduce. Their own behaviour, including
 * the conditions under which they render nothing at all, is tested with them.
 */
vi.mock("@/components/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/demo-banner", () => ({
  DemoBanner: () => (
    <aside aria-label="Demo session">
      <a href="https://example.test">Repository</a>
      <button type="button">Dismiss</button>
    </aside>
  ),
}));

vi.mock("@/components/walk-reminder", () => ({
  WalkReminder: () => (
    <aside aria-label="Walk reminder">
      {/* `#walk` rather than the real `/`: what this stub owes the test is a
          focusable element above `children`, and an `<a href="/">` here trips
          the no-html-link-for-pages rule for a link that is not the real one. */}
      <a href="#walk">Log the walk.</a>
    </aside>
  ),
}));

/** Everything a keyboard reaches, in document order. */
const focusables = (root: ParentNode) => [
  ...root.querySelectorAll("a[href], button, input, select, textarea"),
];

describe("the root layout", () => {
  test("puts the skip link before every other focusable element", () => {
    const { baseElement } = render(
      <RootLayout>
        <PageMain>
          <h1>Today</h1>
          <button type="button">Log it</button>
        </PageMain>
      </RootLayout>,
    );

    const first = focusables(baseElement)[0];

    expect(first?.textContent).toBe("Skip to content");
    // Not merely first — first with the banner and the reminder both present,
    // which is the case that made a skip link owed at all. On a demo session at
    // reminder time there are three focusables above the content.
    expect(focusables(baseElement).length).toBeGreaterThan(3);
  });

  test("the skip link's target is the page's own <main>", () => {
    // The two halves are written in different files and neither can see the
    // other at runtime. This is the only place they are checked together: the
    // link's href against the id the page actually rendered.
    const { baseElement } = render(
      <RootLayout>
        <PageMain>
          <h1>Today</h1>
        </PageMain>
      </RootLayout>,
    );

    const href = screen.getByRole("link", { name: "Skip to content" }).getAttribute("href");

    expect(href).toBeTruthy();
    expect(baseElement.querySelector(href as string)).toBe(screen.getByRole("main"));
  });
});
