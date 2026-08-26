/**
 * The navigation route table — Brand Guide § Navigation, in code.
 *
 * FUEL-56 decided the information architecture and wrote it down as a table of
 * seven routes, each with one level and one parent. It shipped as documentation
 * only; nothing in `src/` encoded it. This is that table, and it is the single
 * place the shell asks "which destination am I in?".
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
 * Every authenticated route, mapped to the destination whose slot it lights.
 *
 * This is § Navigation's route table with its Level and Parent columns collapsed
 * into the one question the shell actually asks. A level-1 route maps to itself;
 * a level-2 route maps to its parent, which is what makes `/plan/template` and
 * `/shopping` both light Plan, and `/settings` light Now.
 *
 * `/login` and `/dev/*` are deliberately absent rather than mapped to `null`
 * entries: § Navigation places them outside the hierarchy rather than at level 1
 * of it — "one is what you see instead of the app, the others are specimens of
 * it" — and they do not carry the shell at all. They resolve to `null` by virtue
 * of not being here, which is the same answer with less to maintain.
 */
const ROUTES: Readonly<Record<string, DestinationId>> = {
  "/": "now",
  "/plan": "plan",
  "/training": "training",
  "/weight": "weight",
  "/plan/template": "plan",
  "/shopping": "plan",
  "/settings": "now",
};

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
  return ROUTES[normalise(pathname)] ?? null;
}
