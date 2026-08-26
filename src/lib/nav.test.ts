import { describe, expect, test } from "vitest";

import { DESTINATIONS, type DestinationId, resolveActive } from "@/lib/nav";

/**
 * The route table is the half of the shell that is not a claim about pixels, so
 * it is the half that gets unit tests. Geometry — the 46×40 box, the 1px border,
 * the pill clearing `/`'s action bar — is checked at `/dev/nav-shell` and on the
 * Testing Strategy's manual Appearance checklist, the same split `dot-grid` uses.
 *
 * What is worth pinning here is that the table is a TABLE. The obvious
 * implementation resolves the active item from the first path segment, and it
 * passes for five of the seven routes; `/shopping` and `/settings` are the two
 * that catch it, and they are the reason § Navigation says "The shell reads this
 * table, not the URL."
 */

describe("DESTINATIONS", () => {
  /*
   * § Navigation: "**The four:** **Now** `/` · **Plan** `/plan` · **Training**
   * `/training` · **Weight** `/weight`". Order included — the guide lists them
   * in the order they are rendered, and the pill has no other cue about which
   * slot is which.
   */
  test("are the guide's four, in the guide's order", () => {
    expect(DESTINATIONS.map((d) => [d.label, d.href])).toEqual([
      ["Now", "/"],
      ["Plan", "/plan"],
      ["Training", "/training"],
      ["Weight", "/weight"],
    ]);
  });

  /*
   * The mock's fourth destination is More, and FUEL-56 replaced it. Asserted
   * rather than assumed because the mock is the source of truth for appearance
   * and someone reconciling this component against it will find four items that
   * do not match and be tempted to "fix" the one that is right.
   */
  test("do not include the mock's More", () => {
    expect(DESTINATIONS.map((d) => d.label)).not.toContain("More");
  });
});

describe("resolveActive", () => {
  /*
   * Every row of § Navigation's route table, level-1 and level-2 together. The
   * level-2 rows are the ones with something to say: each resolves to its
   * parent's slot rather than to nothing.
   */
  const table: [route: string, active: DestinationId, level: 1 | 2][] = [
    ["/", "now", 1],
    ["/plan", "plan", 1],
    ["/training", "training", 1],
    ["/weight", "weight", 1],
    ["/plan/template", "plan", 2],
    ["/shopping", "plan", 2],
    ["/settings", "now", 2],
  ];

  test.each(table)("%s lights %s (level %i)", (route, active) => {
    expect(resolveActive(route)).toBe(active);
  });

  /*
   * The two rows a prefix match would get wrong, called out on their own so a
   * failure names the reason rather than just a row.
   *
   * `/shopping` is level 2 under `/plan` while keeping a flat URL, because the
   * list is addressed by week through `?week=` rather than nested inside one.
   * Its first segment is `shopping`, which is not a destination.
   */
  test("resolves a level-2 route whose URL does not contain its parent", () => {
    expect(resolveActive("/shopping")).toBe("plan");
  });

  /* `/settings` is parented to `/`, whose URL is a prefix of every route. */
  test("resolves the route parented to the root", () => {
    expect(resolveActive("/settings")).toBe("now");
  });

  /*
   * § Navigation places these outside the hierarchy rather than at level 1 of
   * it, and neither carries the shell. Four inactive items and no active one is
   * the right answer if one is ever rendered there — notably the specimen, which
   * lives at `/dev/nav-shell` and would otherwise light Now on the strength of
   * the leading slash.
   */
  test.each(["/login", "/dev/nav-shell", "/dev/dot-grid"])(
    "%s is outside the hierarchy",
    (route) => {
      expect(resolveActive(route)).toBeNull();
    },
  );

  /*
   * A route added later and not added to the table gets no active item. The
   * honest failure: lighting a neighbouring slot because its URL happens to be a
   * prefix would assert a parent nobody assigned.
   */
  test("an unknown route lights nothing rather than guessing a parent", () => {
    expect(resolveActive("/plan/template/edit")).toBeNull();
    expect(resolveActive("/weight/2026-08-26")).toBeNull();
  });

  test("ignores a trailing slash", () => {
    expect(resolveActive("/plan/")).toBe("plan");
    expect(resolveActive("/shopping/")).toBe("plan");
  });

  /*
   * `/` is the one route that is only a slash, so the trailing-slash trim has to
   * leave it alone or it becomes an empty string matching nothing.
   */
  test("does not trim the root to nothing", () => {
    expect(resolveActive("/")).toBe("now");
  });
});
