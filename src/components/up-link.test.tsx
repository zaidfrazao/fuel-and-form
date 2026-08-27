import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { UpLink } from "@/components/up-link";

/**
 * Four things are tested here and none of them is a Tailwind class.
 *
 * That the parent is the table's and not the caller's; that the accessible name
 * says which way the link goes; that a week travels up when there is one; and
 * that a screen with no parent renders nothing. The register — Micro caps,
 * `text-secondary`, tertiary underline — is a claim about pixels, checked on the
 * Testing Strategy's manual Appearance checklist alongside the shell's geometry,
 * the same division `nav-shell.test.tsx` sets out.
 *
 * The one thing a class assertion would be right for is the register's absence:
 * two of these four used to render `text-label`, which has no token in
 * `globals.css` and emitted nothing. A test naming `text-micro` would catch that
 * and would also fail the next time the class list is reordered, so it is not
 * here — the dead class is gone from the tree entirely and `check:metrics`
 * watches for its return.
 */

describe("the parent", () => {
  /*
   * The regression FUEL-59 was filed for. `/plan/template` sent people to
   * `/settings`, a screen that links TO it — § Navigation: "Settings keeps its
   * link to it... but a link is not a parent." Arriving from the weekly plan,
   * where the template's effect is visible, the only way out was a screen you
   * were never on.
   */
  test("takes the weekly template up to the plan, not to Settings", () => {
    render(<UpLink pathname="/plan/template" />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/plan");
    expect(link.getAttribute("href")).not.toBe("/settings");
  });

  /*
   * There is no `href` prop and no `label` prop, and that is the design rather
   * than an omission: four call sites each naming a parent is what produced four
   * different answers. This asserts the consequence a signature cannot — the
   * component is given the route it IS, and the destination is not negotiable
   * from outside.
   */
  test.each([
    ["/plan/template", "/plan"],
    ["/shopping", "/plan"],
    ["/settings", "/"],
  ])("resolves %s from the route table, to %s", (pathname, href) => {
    render(<UpLink pathname={pathname} />);

    expect(screen.getByRole("link").getAttribute("href")).toBe(href);
  });
});

describe("the direction", () => {
  /*
   * "Back to Plan", not "Plan".
   *
   * § Navigation forbids a cross-link being styled as an up-link, "because a
   * second thing that looks like a way back is a second parent in everything but
   * name" — and `/plan` carries two cross-links in this same register. The glyph
   * separates them by eye; this is what separates them by ear. A bare
   * destination name announces identically to a link pointing the other way.
   */
  test.each([
    ["/plan/template", "Back to Plan"],
    ["/shopping", "Back to Plan"],
    ["/settings", "Back to Now"],
  ])("names %s's link %s", (pathname, name) => {
    render(<UpLink pathname={pathname} />);

    expect(screen.getByRole("link", { name })).toBeTruthy();
  });

  /*
   * The name each of these used to have. Asserted as absent rather than left to
   * the positive above, because "Plan" is a substring of "Back to Plan" and an
   * accessible-name query is not: a link named "Plan" would fail the test above
   * and this one names why.
   */
  test.each(["/plan/template", "/shopping", "/settings"])(
    "does not leave %s's link named for the destination alone",
    (pathname) => {
      render(<UpLink pathname={pathname} />);

      expect(screen.queryByRole("link", { name: "Plan" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Now" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    },
  );

  /*
   * The glyph is `week-nav.tsx`'s, and it is hidden for that component's reason:
   * the `aria-label` is the name, so a visible copy of the text would be
   * appended to it by browsers that concatenate. What is left in the tree is the
   * name and nothing else.
   */
  test("carries a glyph the reader does not have to hear", () => {
    const { container } = render(<UpLink pathname="/shopping" />);

    expect(container.textContent).toContain("‹");
    expect(screen.getByRole("link").textContent).toContain("Plan");
    expect(
      container.querySelector("[aria-hidden='true']")?.textContent,
    ).toContain("‹");
  });

  /*
   * WCAG 2.5.3 Label in Name: the visible word has to be inside the accessible
   * name, not replaced by it. "Plan" ⊂ "Back to Plan" holds; "Weekly plan" would
   * not have.
   */
  test("keeps the visible word inside the accessible name", () => {
    render(<UpLink pathname="/plan/template" />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toContain("Plan");
    expect(link.textContent).toContain("Plan");
  });
});

describe("the week", () => {
  /*
   * `/shopping` and `/plan` are both addressed by `?week=`. Going up from the
   * week of the 24th to whichever week the server calls "now" would land on a
   * different week's plan, behind the link that claims to be the way back.
   */
  test("travels up when the parent is addressed by one", () => {
    render(<UpLink pathname="/shopping" week="2026-08-24" />);

    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/plan?week=2026-08-24",
    );
  });

  /*
   * And is absent when there is none. `/plan` and `/settings` go up to `/`,
   * which takes no `searchParams` — a trailing `?week=` there would be a
   * parameter the destination cannot read, appended to look thorough.
   */
  test.each(["/plan/template", "/settings"])(
    "is not invented for %s, whose parent has no week",
    (pathname) => {
      render(<UpLink pathname={pathname} />);

      expect(screen.getByRole("link").getAttribute("href")).not.toContain("?");
    },
  );
});

describe("no parent", () => {
  /*
   * Level 1 renders nothing, which is what lets this be dropped into a header
   * without the call site asking first. § Navigation gives the four no parent,
   * and a link home from the home screen is not an up-link.
   */
  test.each(["/", "/plan", "/training", "/weight"])(
    "%s is already the top and renders no link",
    (pathname) => {
      const { container } = render(<UpLink pathname={pathname} />);

      expect(screen.queryByRole("link")).toBeNull();
      expect(container.innerHTML).toBe("");
    },
  );

  /*
   * Outside the hierarchy, and a route nobody added to the table. The second is
   * the one worth having: a missing up-link is visible on the screen, where a
   * parent guessed from the URL would look correct and send people somewhere
   * nobody chose.
   */
  test.each(["/login", "/dev/nav-shell", "/plan/template/edit"])(
    "%s renders no link rather than a guessed one",
    (pathname) => {
      render(<UpLink pathname={pathname} />);

      expect(screen.queryByRole("link")).toBeNull();
    },
  );
});
