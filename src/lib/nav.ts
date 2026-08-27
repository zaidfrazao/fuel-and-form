/**
 * The navigation route table — Brand Guide § Navigation, in code.
 *
 * FUEL-56 decided the information architecture and wrote it down as a table of
 * seven routes, each with one level and one parent. It shipped as documentation
 * only; nothing in `src/` encoded it. This is that table, and it is the single
 * place two questions are asked of it: "which destination am I in?" for the
 * shell, and "where does up go, and what is it called?" for the up-link.
 *
 * FUEL-58 encoded the first column and FUEL-59 the other two. Between them the
 * four screens with an up-link each named their own parent, and one named a
 * screen that merely links to it — the failure mode of a table that ships as
 * prose.
 *
 * ## Why a table and not a prefix match
 *
 * § Navigation says it outright: "The shell reads this table, not the URL." The
 * temptation is to resolve the active item by taking the first path segment,
 * and `/shopping` is the counter-example that kills it — it is a level-2 screen
 * parented to `/plan` while keeping a flat URL, because the list is addressed by
 * week through `?week=` rather than nested inside one. A prefix match would find
 * no destination for it and light nothing. `/settings` is the same shape under
 * `/`.
 *
 * So every route is listed, and a route that is not listed resolves to `null`.
 */

/**
 * The four top-level destinations, in the order they appear in the shell.
 *
 * § Navigation: "**The four:** **Now** `/` · **Plan** `/plan` · **Training**
 * `/training` · **Weight** `/weight`", and of the labels: "The `aria-label` is
 * the label, so the four names above are the only names these destinations have
 * anywhere." That sentence is why `label` is not a free-form prop on the
 * component — there is one name per destination and it lives here.
 */
export type DestinationId = "now" | "plan" | "training" | "weight";

export type Destination = {
  id: DestinationId;
  /** The only name this destination has, per § Navigation. */
  label: string;
  href: string;
};

export const DESTINATIONS: readonly Destination[] = [
  { id: "now", label: "Now", href: "/" },
  { id: "plan", label: "Plan", href: "/plan" },
  { id: "training", label: "Training", href: "/training" },
  { id: "weight", label: "Weight", href: "/weight" },
] as const;

/**
 * One row of § Navigation's route table.
 *
 * `name` is the table's Destination column and `parent` is its Parent column —
 * `null` for a level-1 route, which is how Level is encoded without a third
 * field: a route with no parent is at level 1, and § Navigation caps the depth
 * at two, so there is no case where that inference is wrong.
 */
type Route = {
  /** Whose slot this route lights in the shell. */
  destination: DestinationId;
  /**
   * The one name this route has, from the table's Destination column.
   *
   * § Navigation, of the four: "The `aria-label` is the label, so the four names
   * above are the only names these destinations have anywhere." That sentence
   * was written about the shell and it binds every link that names a
   * destination, which is why the up-links no longer spell `/` "Right Now" on
   * one screen and "Right now" on another. A destination is named once, here.
   *
   * The four level-1 names are the same strings `DESTINATIONS` carries, and are
   * deliberately repeated rather than read across: that array is ordered because
   * the pill has no other cue about which slot is which, and this table is keyed
   * because a lookup is what it is for. Deriving one from the other would tie an
   * order to a lookup for the sake of four short strings.
   */
  name: string;
  /** The route this one goes up to, or `null` at level 1. */
  parent: string | null;
};

/**
 * Every authenticated route — § Navigation's route table, in code.
 *
 * This used to hold the Destination column alone, with Level and Parent
 * "collapsed into the one question the shell actually asks". The collapse is
 * what FUEL-59 came back for: with no Parent column here, the four screens that
 * render an up-link each had to name their own parent, and one of them
 * (`/plan/template`) named `/settings` — a screen that links TO it, which
 * § Navigation answers directly: "a link is not a parent."
 *
 * `destination` is still the question the shell asks. A level-1 route lights
 * itself; a level-2 route lights its parent, which is what makes
 * `/plan/template` and `/shopping` both light Plan, and `/settings` light Now.
 * For every route here that is `parent`'s destination, but the two fields are
 * not the same thing and are not derived from one another — `destination` is
 * about which slot glows, `parent` is about where "up" goes, and only the first
 * survives a hypothetical level-3 route.
 *
 * `/login` and `/dev/*` are deliberately absent rather than mapped to `null`
 * entries: § Navigation places them outside the hierarchy rather than at level 1
 * of it — "one is what you see instead of the app, the others are specimens of
 * it" — and they do not carry the shell at all. They resolve to `null` by virtue
 * of not being here, which is the same answer with less to maintain.
 *
 * A `Map` rather than an object literal, which is not a style preference. An
 * object literal inherits `Object.prototype`, so `ROUTES["toString"]` returns a
 * FUNCTION and `?? null` does not catch it — `resolveActive` would return
 * something that is not a `DestinationId` while claiming in its signature that
 * it cannot. Nothing reaches that today, because every caller passes a pathname
 * and every inherited key lacks the leading slash. It is still a signature that
 * lies, and a `Map` has no prototype chain to inherit from.
 */
const ROUTES = new Map<string, Route>([
  ["/", { destination: "now", name: "Now", parent: null }],
  ["/plan", { destination: "plan", name: "Plan", parent: null }],
  ["/training", { destination: "training", name: "Training", parent: null }],
  ["/weight", { destination: "weight", name: "Weight", parent: null }],
  /*
   * `/plan`, not `/settings`.
   *
   * § Navigation: "**`/plan/template` has one parent and it is `/plan`,**
   * matching its URL. The template is what recurs each week before any swaps,
   * which is plan content — § Terminology reserves 'Plan' for exactly that.
   * Settings keeps its link to it, and the sentence there explaining which table
   * it writes is worth keeping where it is, but a link is not a parent."
   *
   * So the second entry point is not resolved with a `from` param or a
   * `referer` — there is nothing to resolve. Two screens link here and one of
   * them is the parent.
   */
  [
    "/plan/template",
    { destination: "plan", name: "Weekly template", parent: "/plan" },
  ],
  ["/shopping", { destination: "plan", name: "Shopping list", parent: "/plan" }],
  ["/settings", { destination: "now", name: "Settings", parent: "/" }],
]);

/**
 * Every path the table holds — the table's own census, for callers that need to
 * ask it what it contains rather than what one route resolves to.
 *
 * FUEL-62 is the reason this exists, and the reason is worth stating because the
 * export looks redundant beside the two functions below. `ROUTES` is private, so
 * until now the only questions anything could ask were about a path it already
 * had. Nothing could ask "what are all of them?" — and a reachability test that
 * cannot enumerate the table has to carry its own list of routes instead, which
 * is a COPY. A copy passes forever after someone adds a row here and forgets it,
 * which is precisely the drift FUEL-62 exists to catch. One list, two readers.
 *
 * Frozen, and a plain array rather than the `Map`: the shape a caller wants is a
 * list of strings, and handing out the `Map` itself would hand out `set` and
 * `delete` along with it. `readonly` alone is a compile-time claim, and the
 * consumer here is a test — the one place where a type assertion is least able
 * to stop a mistake, since a test can cast anything it likes.
 *
 * Order is `ROUTES`' insertion order, which is § Navigation's table order: the
 * four level-1 routes and then the three level-2 ones. Nothing depends on that
 * and no test should start to — `DESTINATIONS` is the array whose order is
 * load-bearing, and it is a different one for a different reason.
 */
export const ROUTE_PATHS: readonly string[] = Object.freeze([...ROUTES.keys()]);

/**
 * Strip a trailing slash, so `/plan/` and `/plan` are the same route.
 *
 * `usePathname` does not add one, so this is not defending against Next — it is
 * defending against a hand-written `pathname` prop, which the specimen and the
 * tests both supply. `/` is left alone: it is the one route that is only a
 * slash, and trimming it would produce an empty string that matches nothing.
 */
function normalise(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * Which destination's slot the given path lights, or `null` for a path outside
 * the hierarchy.
 *
 * `null` is a real answer and the shell renders it — four inactive items and no
 * active one. It is what `/login` and `/dev/*` get, and it is also what a route
 * added later and not added here gets. That last case is a silent-ish failure,
 * and it is the honest one: lighting a neighbouring slot because its URL happens
 * to be a prefix would assert a parent that FUEL-56 never assigned. A new route
 * owes this table an entry, the same way § Navigation says it owes one a level
 * and a parent.
 *
 * Query strings are not handled here because there are none to handle:
 * `usePathname` returns the pathname alone, so `/shopping?week=2026-08-24`
 * arrives as `/shopping`. That matters for `/shopping` and `/plan`, which are
 * both addressed by week.
 */
export function resolveActive(pathname: string): DestinationId | null {
  return ROUTES.get(normalise(pathname))?.destination ?? null;
}

/**
 * Where the given route's up-link goes, and what it is called — or `null` when
 * there is no up to go to.
 *
 * `null` is a real answer and `components/up-link.tsx` renders it as nothing.
 * Three kinds of path get it: a level-1 route, which is already the top; a path
 * outside the hierarchy, `/login` and `/dev/*`; and a route added later and not
 * added to the table. That last one is the same honest failure `resolveActive`
 * takes — a missing up-link is visible on the screen, where a guessed parent
 * would look correct and send people somewhere nobody chose.
 *
 * The label is the PARENT's name, not the child's, which is the whole point of
 * doing the lookup twice: the up-link says where it goes, and the `<h1>` under
 * it already says where you are.
 *
 * Query strings are not handled here, and not by accident. A parent's `?week=`
 * belongs to the caller — `/shopping` knows which week is on screen and this
 * table cannot — so the href returned is always the bare pathname and the
 * component appends. See `up-link.tsx`.
 */
export function resolveParent(
  pathname: string,
): { href: string; label: string } | null {
  const parent = ROUTES.get(normalise(pathname))?.parent;
  if (!parent) return null;

  const route = ROUTES.get(parent);
  /*
   * A parent named in the table but not keyed in it. Unreachable as the table
   * stands — all three parents are `/` or `/plan`, both of which are rows — and
   * `null` rather than a throw if that ever stops being true, for the reason
   * above: the app loses an up-link, not a screen.
   */
  if (!route) return null;

  return { href: parent, label: route.name };
}
