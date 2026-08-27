import { describe, expect, test } from "vitest";

import {
  DESTINATIONS,
  type DestinationId,
  resolveActive,
  resolveParent,
} from "@/lib/nav";

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

  /*
   * The table is a `Map`, so it has no prototype to inherit from.
   *
   * Written as an object literal, `ROUTES["toString"]` returns a FUNCTION —
   * `?? null` does not catch it, and `resolveActive` hands back something that
   * is not a `DestinationId` while its signature says it cannot. No caller
   * reaches it, since every pathname starts with a slash and no inherited key
   * does, so this is the test standing in for a bug that has no other way to
   * announce itself.
   */
  test.each([
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ])("%s is not a destination, despite Object.prototype", (key) => {
    expect(resolveActive(key)).toBeNull();
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

/**
 * The Parent column, which shipped as prose and got re-invented four times.
 *
 * `resolveActive` above is about which slot glows; this is about where "up"
 * goes, and the two agree for every row today without being the same question.
 * The row worth the most is `/plan/template`: it pointed at `/settings` in the
 * page for as long as the page existed, and § Navigation had already answered
 * it — "Settings keeps its link to it... but a link is not a parent."
 */
describe("resolveParent", () => {
  /* § Navigation's route table, Parent column, level-2 rows. */
  const table: [route: string, href: string, label: string][] = [
    ["/plan/template", "/plan", "Plan"],
    ["/shopping", "/plan", "Plan"],
    ["/settings", "/", "Now"],
  ];

  test.each(table)("%s goes up to %s, named %s", (route, href, label) => {
    expect(resolveParent(route)).toEqual({ href, label });
  });

  /*
   * The regression, on its own so a failure names it. Not merely "some parent"
   * and not "not /settings" — the table gives one answer and this is it.
   */
  test("the weekly template goes up to the plan, not to the screen that links to it", () => {
    expect(resolveParent("/plan/template")?.href).toBe("/plan");
  });

  /*
   * Level 1 is already the top. `null` rather than `/` — a link home from the
   * home screen is not an up-link, and § Navigation gives these four no parent.
   */
  test.each(["/", "/plan", "/training", "/weight"])(
    "%s is level 1 and has no parent",
    (route) => {
      expect(resolveParent(route)).toBeNull();
    },
  );

  /*
   * Outside the hierarchy, and outside it in both directions: these do not
   * carry the shell and they are not owed a way up either. The specimen is the
   * live case — `/dev/nav-shell` renders the component with hand-written
   * pathnames, and its own route must not sprout an up-link to `/`.
   */
  test.each(["/login", "/dev/nav-shell", "/dev/dot-grid"])(
    "%s is outside the hierarchy",
    (route) => {
      expect(resolveParent(route)).toBeNull();
    },
  );

  /*
   * A route added later and not added to the table renders no up-link. The
   * honest failure, the same one `resolveActive` takes: a missing link is
   * visible on the screen, where a parent guessed from the URL would look
   * correct and send people somewhere nobody chose.
   */
  test("an unknown route has no parent rather than a guessed one", () => {
    expect(resolveParent("/plan/template/edit")).toBeNull();
    expect(resolveParent("/weight/2026-08-26")).toBeNull();
  });

  /* The `Map`'s reason, applied to the second lookup. See `resolveActive`. */
  test.each([
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ])("%s has no parent, despite Object.prototype", (key) => {
    expect(resolveParent(key)).toBeNull();
  });

  test("ignores a trailing slash", () => {
    expect(resolveParent("/plan/template/")).toEqual({
      href: "/plan",
      label: "Plan",
    });
    expect(resolveParent("/shopping/")).toEqual({ href: "/plan", label: "Plan" });
  });

  /*
   * One name per destination, which is the fix for "Right Now" on `/settings`
   * and "Right now" on `/plan` naming the same screen. § Navigation: "the four
   * names above are the only names these destinations have anywhere", so an
   * up-link's label is the shell's label, character for character.
   *
   * Built as a list and compared whole rather than looped over with an
   * assertion inside: a loop across a `filter` passes when the filter is empty,
   * and an empty pass here would mean the two names had stopped matching at all.
   */
  test("names a parent exactly as the shell names it", () => {
    const byShell = new Map(DESTINATIONS.map((d) => [d.href, d.label]));

    expect(
      table.map(([route]) => {
        const parent = resolveParent(route);
        return [route, parent?.label, byShell.get(parent?.href ?? "")];
      }),
    ).toEqual([
      ["/plan/template", "Plan", "Plan"],
      ["/shopping", "Plan", "Plan"],
      ["/settings", "Now", "Now"],
    ]);
  });

  /*
   * The query string is the caller's, not the table's. `/shopping` goes up to
   * `/plan` carrying the week on screen, and it can only do that if what it
   * gets back is a bare pathname to append to.
   */
  test("returns a bare pathname for the caller to append to", () => {
    expect(resolveParent("/shopping")?.href).toBe("/plan");
    expect(resolveParent("/shopping")?.href).not.toContain("?");
  });
});
