"use server";

import { refresh } from "next/cache";

import { resolveWalk } from "@/app/actions/resolve-walk";
import { loadWalkRoute, nameWalkRoute, type WalkRouteView } from "@/lib/db/queries/route";
import type { CalendarDate } from "@/lib/date";
import { MAX_ROUTE_NAME } from "@/lib/route";

/**
 * Opening and naming one walk's route — FUEL-102, PRD § P11.
 *
 * Two actions: the sheet asks for a trace when it opens, and writes a name when
 * somebody gives one.
 *
 * ## Why the trace is fetched on open rather than sent with the page
 *
 * `db/schema.ts` keeps `walk_routes` out of every list query, and the rule
 * survives here rather than being worked around: a page that shipped both of
 * the day's traces would put two point arrays into the HTML of every render of
 * `/` and `/training`, for a sheet that is opened rarely and for one walk at a
 * time. It would also put a coordinate into the served markup of a screen
 * nobody asked a route question on — which § P11's storage rules are the whole
 * reason to avoid.
 *
 * So the geometry crosses only when a sheet is opened, only for the walk it was
 * opened on, and never for a walk that has no route, because the row draws no
 * control for one.
 */

export type RouteResult = { ok: boolean };

const DONE: RouteResult = { ok: true };
const FAILED: RouteResult = { ok: false };

/**
 * The trace for one walk, or null.
 *
 * Null covers every refusal without distinguishing them — no session, a date
 * the template does not hold, an entry that is a session rather than a walk, a
 * walk with no route — which is `resolveWalk`'s own arrangement and keeps a
 * visitor unable to tell "not yours" from "not there".
 */
export async function openWalkRoute(input: {
  date: CalendarDate;
  entryId: string;
}): Promise<WalkRouteView | null> {
  try {
    const resolved = await resolveWalk(input.date, input.entryId);

    if (!resolved) return null;

    return await loadWalkRoute(resolved.userId, input.date, resolved.workoutId);
  } catch (error) {
    console.error("Could not read the walk's route.", error);

    return null;
  }
}

/**
 * Give the walk's route a name, or take its name away with null.
 *
 * `name` is `unknown` because this is a public POST endpoint and nothing has
 * checked it by the time it arrives — the shape `logWalk` takes its duration
 * in, for the same reason. Parsed before the walk is resolved, since a refusal
 * that costs a query is a refusal that can be used to make the database work.
 *
 * The trim is not tidying. A name of spaces satisfies "not null" and names
 * nothing, and the column's CHECK refuses it outright, so a caller sending one
 * would otherwise get a constraint violation where they meant to clear the
 * name. Trimming to empty IS clearing it, which is also the honest reading of
 * somebody deleting the text in the field and confirming.
 */
export async function nameRoute(input: {
  date: CalendarDate;
  entryId: string;
  name?: unknown;
}): Promise<RouteResult> {
  try {
    const name = parseRouteName(input.name);

    if (name === undefined) return FAILED;

    const resolved = await resolveWalk(input.date, input.entryId);

    if (!resolved) {
      refresh();

      return FAILED;
    }

    const written = await nameWalkRoute(
      resolved.userId,
      input.date,
      resolved.workoutId,
      name,
    );

    // The row's own figures do not change with a name, but the sheet is opened
    // from a server-rendered row and the next open must not be handed a stale
    // suggestion — a route named here is a candidate for the other walk of the
    // same day.
    refresh();

    return written ? DONE : FAILED;
  } catch (error) {
    console.error("Could not name the walk's route.", error);

    return FAILED;
  }
}

/**
 * A name, `null` to clear it, or `undefined` for anything else.
 *
 * Three outcomes rather than two, because "clear the name" and "this request is
 * malformed" are different answers and collapsing them would let a bad payload
 * quietly erase a name somebody chose.
 */
function parseRouteName(value: unknown): string | null | undefined {
  if (value === null) return null;

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();

  if (trimmed === "") return null;

  return trimmed.length <= MAX_ROUTE_NAME ? trimmed : undefined;
}
