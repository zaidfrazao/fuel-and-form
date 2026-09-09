import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { CalendarDate } from "@/lib/date";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";
import { matchNamedRoute, type NamedRoute, type RouteMatch } from "@/lib/route-match";
import type { Track } from "@/lib/route";

/**
 * Reading one walk's route — FUEL-102.
 *
 * `walk_routes` is deliberately absent from every list query, which
 * `db/schema.ts` states as a property of the table rather than a habit of its
 * callers: "this is read when one walk's sheet is opened, and never in a list".
 * This file is that read, and it is the only one.
 *
 * Separate from `training.ts` because that file is the walk's WRITE path and is
 * already long. Nothing here writes geometry — the trace is stored by
 * `recordWalkRecording` and only ever read back.
 */

/**
 * How many named routes are considered when offering a name.
 *
 * The match reads the candidates' geometry, which is the one thing the schema
 * warns against pulling around. The warning is about LIST queries — a join that
 * puts a point array in front of every row of every day — and this is neither:
 * it runs once, when a sheet is opened, over rows a person deliberately named.
 * A user with fifty named routes has named a route a week for a year.
 *
 * Bounded anyway rather than trusted to stay small, because the cost of being
 * wrong about that is a jsonb array per row on a query that runs during a tap.
 * Most recent first, so the bound drops the routes least likely to be walked
 * again rather than an arbitrary fifty.
 */
export const NAMED_ROUTE_CANDIDATES = 50;

/** One walk's stored shape, as the sheet needs it. */
export type WalkRouteView = {
  points: Track;
  /** What this route is called, or null until somebody says. */
  name: string | null;
  /**
   * The name worth offering, when this walk has none of its own.
   *
   * Always null where `name` is set: a route that has been named is not asking
   * a question, and computing a suggestion for it would be work done to be
   * discarded. § P11 requires the offer and forbids applying one, so this
   * crosses to the interface as a suggestion and never as a value.
   */
  suggestion: RouteMatch | null;
};

/** The walk log for a date and workout, or undefined. */
async function walkLog(userId: string, date: CalendarDate, workoutId: string) {
  return scope(userId, getDb()).selectOne(
    schema.workoutLogs,
    and(eq(schema.workoutLogs.date, date), eq(schema.workoutLogs.workoutId, workoutId)),
  );
}

/**
 * The trace for one walk, with its name and — where it has none — an offer.
 *
 * Null for a walk that was logged with one tap, for one too short to survive
 * the trim, and for one recorded before P11. All three are the same answer and
 * § The Route Trace gives it: "a walk with no route draws nothing". The sheet
 * is never opened for them because the row offers no control.
 */
export async function loadWalkRoute(
  userId: string,
  date: CalendarDate,
  workoutId: string,
): Promise<WalkRouteView | null> {
  const log = await walkLog(userId, date, workoutId);

  if (!log) return null;

  const s = scope(userId, getDb());
  const route = await s.selectOne(
    schema.walkRoutes,
    eq(schema.walkRoutes.workoutLogId, log.id),
  );

  if (!route) return null;

  if (route.name !== null) {
    return { points: route.points, name: route.name, suggestion: null };
  }

  // Only where there is a question to answer. The candidates carry geometry, so
  // this query is skipped entirely for a route that is already named — which is
  // every route the second time its sheet is opened.
  const candidates = await s.select(
    schema.walkRoutes,
    and(isNotNull(schema.walkRoutes.name), ne(schema.walkRoutes.id, route.id)),
    { orderBy: desc(schema.walkRoutes.createdAt), limit: NAMED_ROUTE_CANDIDATES },
  );

  const named: NamedRoute[] = candidates.flatMap((row) =>
    // `isNotNull` in the WHERE does not narrow the TYPE, and the alternative to
    // this guard is a non-null assertion that would be wrong the day somebody
    // edits the predicate above.
    row.name === null ? [] : [{ name: row.name, track: row.points }],
  );

  return {
    points: route.points,
    name: null,
    suggestion: matchNamedRoute(route.points, named),
  };
}

/**
 * Name a walk's route, or unname it with null.
 *
 * Returns whether a row was written, so the action can answer honestly rather
 * than reporting success over a walk that has no route to name — which is what
 * a forged request naming an arbitrary date would be.
 *
 * The name is written on THIS walk's row and is never propagated to the routes
 * it matched. `schema.ts` argues why there is no canonical route to propagate
 * to: each row says what that walk was called, which is the whole claim.
 */
export async function nameWalkRoute(
  userId: string,
  date: CalendarDate,
  workoutId: string,
  name: string | null,
): Promise<boolean> {
  const log = await walkLog(userId, date, workoutId);

  if (!log) return false;

  const written = await scope(userId, getDb()).update(
    schema.walkRoutes,
    { name },
    eq(schema.walkRoutes.workoutLogId, log.id),
  );

  return written.length > 0;
}

/**
 * Which of a date's logs have a trace behind them — the row's affordance.
 *
 * § The Route Trace makes the walk's figures the control that opens the sheet,
 * and "a walk with no route draws nothing — not a disabled control". So the
 * list needs to know whether a trace exists, and `distance_m` cannot answer:
 * a walk shorter than twice the trim has a measured distance and stores no
 * trace at all, so a row keyed off the figure would offer a sheet with nothing
 * in it for exactly the walks that are hardest to notice.
 *
 * This selects `workout_log_id` and nothing else. That is what keeps it inside
 * the schema's rule rather than an exception to it: the ban is on pulling the
 * POINT ARRAY into a list, and existence is not the array. One extra query per
 * page against an index, returning at most one id per walk.
 */
export async function routedLogIds(
  userId: string,
  date: CalendarDate,
): Promise<ReadonlySet<string>> {
  const db = getDb();

  const rows = await db
    .select({ workoutLogId: schema.walkRoutes.workoutLogId })
    .from(schema.walkRoutes)
    .where(
      and(
        eq(schema.walkRoutes.userId, userId),
        inArray(
          schema.walkRoutes.workoutLogId,
          db
            .select({ id: schema.workoutLogs.id })
            .from(schema.workoutLogs)
            .where(
              and(
                eq(schema.workoutLogs.userId, userId),
                eq(schema.workoutLogs.date, date),
              ),
            ),
        ),
      ),
    );

  return new Set(rows.map((row) => row.workoutLogId));
}
