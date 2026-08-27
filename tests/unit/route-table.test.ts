import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ROUTE_PATHS } from "@/lib/nav";

/**
 * The route table against the route TREE — FUEL-62.
 *
 * `src/lib/nav.test.ts` asserts what the table answers. This asserts what is in
 * it, against the only other thing that knows: the filesystem. Next builds the
 * app's URLs from the directory layout, so `src/app/**\/page.tsx` is the real
 * list of routes and `lib/nav.ts` is a hand-maintained claim about it. Two lists
 * that must agree, and until this file existed nothing compared them.
 *
 * ## What drifts, and why neither half notices
 *
 * A route added to the tree and not to the table gets `null` from
 * `resolveActive` and `resolveParent` — which nav.ts argues for at length and
 * calls "the honest failure". Honest, but silent: the page renders, the shell
 * renders, and four inactive items light nothing. Nobody reads a nav bar to
 * check that one of it is bold.
 *
 * A row added to the table with no page behind it is quieter still. It affects
 * nothing at all until someone links to it, and then it is a 404 from a table
 * that promised a screen.
 *
 * FUEL-62's acceptance criterion is the first of those — "adding a route to the
 * route table without wiring it makes the test fail" — and this asserts both
 * directions, because the two lists drifting apart is one fault with two faces
 * and a test that watched one face would pass while the other happened.
 *
 * ## The group is the authentication boundary, so it is what is compared
 *
 * `src/app/(app)/layout.tsx` mounts the shell, and a route renders the shell if
 * and only if its file sits under that group — the layout's own header makes
 * that argument, and it is why the group exists rather than a
 * `pathname.startsWith("/dev")` test inside the component. So the set compared
 * against the table is the `(app)` group's pages, and the third assertion below
 * is the one that catches the failure the layout cannot: a route added OUTSIDE
 * the group, which renders no shell and is therefore unreachable from
 * everywhere, while every per-screen test in the suite goes on passing.
 */

/** Every `page.tsx` under `src/app`, as a path relative to it. */
function pageFiles(dir = "src/app", prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return pageFiles(join(dir, entry.name), `${prefix}${entry.name}/`);
    }
    return entry.name === "page.tsx" ? [`${prefix}page.tsx`] : [];
  });
}

/**
 * The URL a `page.tsx` answers on.
 *
 * Route groups contribute nothing to the URL — that is the whole point of the
 * parentheses — so `(app)/plan/page.tsx` is `/plan` and `(app)/page.tsx` is `/`.
 *
 * Dynamic segments are not handled, because there are none: every route in this
 * app is a literal path, and `?week=`/`?date=` are query parameters rather than
 * segments. A `[slug]` added later would arrive here as the literal `[slug]` and
 * fail the comparison below, which is the correct outcome — § Navigation's table
 * has no way to express one, so it would owe a decision rather than a mapping.
 */
function urlOf(file: string): string {
  const segments = file
    .split("/")
    .slice(0, -1)
    .filter((segment) => !segment.startsWith("("));

  return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

const files = pageFiles();

const inGroup = files.filter((file) => file.startsWith("(app)/"));
const outsideGroup = files.filter((file) => !file.startsWith("(app)/"));

describe("the route table and the route tree", () => {
  test("hold the same seven routes", () => {
    // Sorted rather than compared in order: `ROUTE_PATHS` is § Navigation's
    // table order and `readdirSync` is the filesystem's, and neither is a claim
    // the other should have to satisfy. What matters is the SET.
    expect([...inGroup.map(urlOf)].sort()).toEqual([...ROUTE_PATHS].sort());
  });

  /*
   * The two directions the assertion above collapses, named individually so a
   * failure says which drift happened rather than printing two sorted arrays and
   * leaving the reader to diff them.
   *
   * Worth the duplication because the two have different fixes. A page with no
   * row needs a level and a parent decided — a § Navigation question, not a
   * typing one. A row with no page is either a typo or a screen someone meant to
   * build.
   */
  test("has no page that the table forgot", () => {
    const missing = inGroup.map(urlOf).filter((url) => !ROUTE_PATHS.includes(url));

    expect(missing, "pages under (app) with no row in lib/nav.ts").toEqual([]);
  });

  test("has no row that the tree forgot", () => {
    const urls = new Set(inGroup.map(urlOf));
    const missing = ROUTE_PATHS.filter((path) => !urls.has(path));

    expect(missing, "rows in lib/nav.ts with no page under (app)").toEqual([]);
  });

  /*
   * The pages deliberately outside the hierarchy, pinned as a whole set.
   *
   * § Navigation: `/login` and `/dev/*` are outside the table rather than at
   * level 1 of it — "one is what you see instead of the app, the others are
   * specimens of it". nav.ts records the same decision and leaves them out of
   * `ROUTES` entirely.
   *
   * This is the assertion that catches the failure the (app) group cannot catch
   * for itself. Every test above compares two lists that both describe the
   * group, so a new authenticated screen added at `src/app/reports/page.tsx`
   * satisfies all of them — it is in neither list, and neither list notices. It
   * would render with no shell, no up-link and no way back, and its own page
   * test would pass.
   *
   * Asserted as the whole set rather than as "is not in ROUTE_PATHS", so a new
   * route outside the group has to come through this test and say which kind of
   * thing it is. The `/dev/*` specimens are matched by prefix because they are a
   * category that grows with each component — a specimen per motif is the
   * pattern — while `/login` is one screen and is named.
   */
  test("keeps /login and the specimens outside the table", () => {
    const unexpected = outsideGroup
      .map(urlOf)
      .filter((url) => url !== "/login" && !url.startsWith("/dev/"));

    expect(
      unexpected,
      "a page outside (app) is a page with no shell — give it a row and move it into the group, or say here why it is outside",
    ).toEqual([]);

    // And the ones that are outside really are absent from the table, rather
    // than outside the group while claiming a level inside it.
    for (const url of outsideGroup.map(urlOf)) {
      expect(ROUTE_PATHS, url).not.toContain(url);
    }
  });
});
