import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { NavShell } from "@/components/nav-shell";

/**
 * The shell's geometry is not tested here. The 46×40 box, the 1px border and 4px
 * padding, the pill clearing `/`'s sticky action bar at 375×667, and the sidebar
 * appearing at 1024px are claims about pixels that jsdom cannot evaluate — they
 * are checked at `/dev/nav-shell` and on the Testing Strategy's manual
 * Appearance checklist, the same division `dot-grid.test.tsx` sets out. No
 * assertion below re-states a Tailwind class, with one exception that says why.
 *
 * What is tested is the accessibility contract, because that is where this
 * component makes claims nothing else in the app has made: the first primary
 * landmark, and the first `aria-current="page"` that means "this is the section
 * you are in". Both are invisible, so neither would be caught by looking.
 */

describe("the landmark", () => {
  /*
   * The app's only two landmarks were paginators — `<nav aria-label="Date">` in
   * training.tsx and `<nav aria-label="Week">` in week-nav.tsx — so a
   * screen-reader user jumping by landmark found a week stepper and nothing that
   * moved between sections. "Primary" is the mock's own label, on all five of
   * the `<nav>`s it renders.
   */
  test("is a nav named Primary, which collides with neither paginator", () => {
    render(<NavShell pathname="/" />);

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Date" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Week" })).toBeNull();
  });

  /*
   * One landmark, not one per breakpoint.
   *
   * A pill and a sidebar rendered separately and toggled with `hidden` would put
   * two "Primary" landmarks in the document, and CSS would hide one from the
   * accessibility tree at any given width — so a real user would hear one and
   * this query would still find two. `getByRole` throws on the duplicate, which
   * is the assertion.
   */
  test("is rendered once, not once per breakpoint", () => {
    render(<NavShell pathname="/" />);

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });
});

describe("the destinations", () => {
  test("are the guide's four, in DOM order", () => {
    render(<NavShell pathname="/" />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav)
      .getAllByRole("link")
      /* The sidebar's Settings foot is not one of the four; see below. */
      .filter((link) => link.getAttribute("href") !== "/settings");

    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Now",
      "Plan",
      "Training",
      "Weight",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/plan",
      "/training",
      "/weight",
    ]);
  });

  /*
   * § Navigation: "Inactive items are 46×40px icon-only with an `aria-label`."
   *
   * The label text is in the DOM at every width and hidden by CSS while
   * inactive, so this is the assertion that the accessible name does NOT come
   * from it. Were the name coming from the text, it would vanish from the
   * accessibility tree exactly when the CSS says `display: none` — and jsdom,
   * applying no CSS, would never show it.
   */
  test("every inactive item is named by aria-label rather than by its text", () => {
    render(<NavShell pathname="/" />);

    for (const label of ["Plan", "Training", "Weight"]) {
      expect(screen.getByRole("link", { name: label }).getAttribute("aria-label")).toBe(
        label,
      );
    }
  });

  /*
   * § Accessibility: "Icon-only tabs carry an `aria-label`; the active tab shows
   * its label as text." The text and the `aria-label` are the same string, so
   * WCAG 2.5.3 Label in Name is satisfied rather than worked around.
   */
  test("the active item shows its label as text", () => {
    render(<NavShell pathname="/plan" />);

    expect(screen.getByRole("link", { name: "Plan" }).textContent).toBe("Plan");
  });

  /*
   * § Deliberately Absent opens with "icons that repeat their own label", and
   * this is the component most at risk of it — its active item shows a mark and
   * its name together. The mark stays out of the accessibility tree, so nothing
   * is repeated: `Motif` reads the rule the same way.
   */
  test("the marks are decorative", () => {
    const { container } = render(<NavShell pathname="/" />);

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("aria-current", () => {
  const current = () =>
    screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

  test.each([
    ["/", "Now"],
    ["/plan", "Plan"],
    ["/training", "Training"],
    ["/weight", "Weight"],
  ])("%s marks %s as the current page", (pathname, label) => {
    render(<NavShell pathname={pathname} />);

    expect(current().map((link) => link.getAttribute("aria-label"))).toEqual([label]);
  });

  /*
   * The claim this component exists to make. The active item's visual tells are
   * an `ink` fill and a label that appears — colour, and a change of name that a
   * screen reader announces as a different item rather than as the current one.
   * Neither says "you are here" without this attribute.
   */
  test.each([
    ["/shopping", "Plan"],
    ["/plan/template", "Plan"],
    ["/settings", "Now"],
  ])("%s marks its level-1 parent, %s", (pathname, label) => {
    render(<NavShell pathname={pathname} />);

    expect(current().map((link) => link.getAttribute("aria-label"))).toEqual([label]);
  });

  /*
   * Exactly one, always. Two elements claiming to be the current page in one
   * landmark is the failure mode the Settings foot link was kept clear of.
   */
  test("is never on more than one item", () => {
    for (const pathname of ["/", "/plan", "/shopping", "/settings", "/weight"]) {
      const { unmount } = render(<NavShell pathname={pathname} />);
      expect(current()).toHaveLength(1);
      unmount();
    }
  });

  /*
   * `/login` and `/dev/*` sit outside the hierarchy. Four inactive items and no
   * current one — which is what the specimen itself renders, since it lives at
   * `/dev/nav-shell`.
   */
  test("is absent on a route outside the hierarchy", () => {
    render(<NavShell pathname="/dev/nav-shell" />);

    expect(current()).toHaveLength(0);
  });
});

describe("the sidebar foot", () => {
  /*
   * § Navigation: "On desktop the sidebar has a foot, and Settings sits there
   * under a rule." Present in the DOM at every width and revealed by CSS at
   * 1024px, so jsdom sees it always — that it is desktop-only is a pixel claim
   * and belongs to the specimen.
   */
  test("links to Settings", () => {
    render(<NavShell pathname="/" />);

    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  /*
   * Not even when the user is on `/settings`. The landmark reports which
   * DESTINATION you are in, and `/settings` is parented to `/`, so Now carries
   * the mark. The alternative is two current-page claims in one landmark.
   */
  test("never claims to be the current page", () => {
    render(<NavShell pathname="/settings" />);

    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  /*
   * The pill is four wide. Settings gave up its slot because "a slot is earned
   * by how often you come back to a screen", and a rule that bends the first
   * time it is applied was never a rule — so the foot must not quietly become a
   * fifth destination.
   */
  test("does not make the pill five wide", () => {
    render(<NavShell pathname="/" />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(4);
  });
});

/*
 * The one class assertion in this file, on `right-now.test.tsx`'s precedent for
 * the same value.
 *
 * The shell is the last thing in the page column, so it owns the bottom inset —
 * FUEL-58 moves it off `/`'s action bar, which has carried it until now. A
 * missing inset is invisible in every browser without a notch and on every
 * screenshot taken in one, so nothing else would catch its removal.
 */
test("clears the bottom safe-area inset", () => {
  render(<NavShell pathname="/" />);

  expect(screen.getByRole("navigation", { name: "Primary" }).className).toContain(
    "safe-area-inset-bottom",
  );
});
