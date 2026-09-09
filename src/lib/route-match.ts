import { distanceMetres, metresBetween, type Track } from "@/lib/route";
import { shapeWord } from "@/lib/route-trace";

/**
 * Recognising a route you have walked before — FUEL-102, PRD § P11.
 *
 * "A route can be named; a later matching walk **offers** that name and never
 * applies it silently."
 *
 * ## The whole design is in the word "offers"
 *
 * Everything below is a suggestion engine and nothing below is an
 * identification. A route that guesses wrong and applies itself silently is
 * worse than one that asks — the walk's own record would then carry a claim
 * about where somebody was that they never made, and the way to notice would be
 * to re-read a figure they had no reason to check. So this returns a candidate
 * and the interface asks. There is deliberately no threshold anywhere in this
 * file above which a name is taken automatically, and adding one would be a
 * change to the requirement rather than a tuning of it.
 *
 * That is also why the test is allowed to be coarse. A miss costs one tap. A
 * false positive that is OFFERED costs one glance. Neither justifies curve
 * matching, a Fréchet distance or a spatial index, and § Non-Goals rules out
 * the features that would ever want one.
 */

/**
 * How near two walks must begin to be the same route, in metres.
 *
 * The ticket's "~100m", and the trim is what makes it selective rather than
 * generous. `trimEnds` removed the first 150 metres of both walks, so these are
 * not two front doors a hundred metres apart — they are two points a hundred
 * metres apart 150 metres INTO the walk, which means the two walks left by the
 * same door and took the same way out of it. A hundred metres of tolerance on
 * that is a receiver settling differently on two mornings, not a different
 * route.
 */
export const MATCH_START_METRES = 100;

/**
 * And how much longer or shorter the later walk may be.
 *
 * A quarter, which is the same fraction `LOOP_MAX_FRACTION` uses and for a
 * related reason: it is the width of "about the same" for a figure nobody
 * measured deliberately. The same circuit walked twice varies by a corner cut
 * or a lap of the park; a walk half as long again is a different walk that
 * happens to start in the same street.
 *
 * This is the "coarse shape comparison" the ticket asks for, together with the
 * shape word below. Comparing the fitted geometries point by point was the
 * alternative and is refused: each walk is fitted to its own box, so two traces
 * are explicitly not comparable to each other (§ The Route Trace), and a
 * comparison built on top of that fit would be reading a drawing that was
 * designed not to be read that way.
 */
export const MATCH_LENGTH_TOLERANCE = 0.25;

/** A route somebody has already named, and the shape they named it on. */
export type NamedRoute = {
  name: string;
  track: Track;
};

/** What the sheet offers, and what it needs to say why. */
export type RouteMatch = {
  name: string;
  /** How far apart the two walks began. Shown, so the offer can be judged. */
  metresApart: number;
};

/**
 * The one name worth offering for this walk, or null.
 *
 * Three tests, all of which must pass: the walks began within
 * `MATCH_START_METRES` of each other, they went about the same distance, and
 * they have the same shape word — a loop is not the point-to-point that shares
 * its street.
 *
 * Exactly one is returned, and it is the nearest start rather than the first
 * candidate. A list of possible names would turn a suggestion into a decision
 * the interface is asking somebody to make, which is more than the feature is
 * worth: the point is that a route you walk twice a day is offered its own name
 * without being asked for it, and the way out of a wrong guess is to ignore it.
 *
 * Null where the subject has no route, where nothing is near, or where the only
 * near thing is a different shape. Null is the ordinary answer and costs
 * nothing — the sheet simply offers a plain naming control instead.
 */
export function matchNamedRoute(
  subject: Track,
  candidates: readonly NamedRoute[],
): RouteMatch | null {
  const start = subject.flat().at(0);

  if (!start) return null;

  const walked = distanceMetres(subject);
  const shape = shapeWord(subject);

  let best: RouteMatch | null = null;

  for (const candidate of candidates) {
    const theirStart = candidate.track.flat().at(0);

    if (!theirStart) continue;

    const metresApart = metresBetween(start, theirStart);

    if (metresApart > MATCH_START_METRES) continue;

    // A shape word of null on either side is not a match on "both unknown": it
    // is two walks that measured no distance, which is not a route anybody
    // named. Comparing them would offer a name on the strength of two absences.
    if (shape === null || shape !== shapeWord(candidate.track)) continue;

    const theirs = distanceMetres(candidate.track);

    if (!withinLength(walked, theirs)) continue;

    if (best === null || metresApart < best.metresApart) {
      best = { name: candidate.name, metresApart };
    }
  }

  return best;
}

/**
 * Whether two distances are the same distance, within the tolerance.
 *
 * A ratio rather than an absolute band, so the tolerance means the same thing
 * for a two-kilometre walk and a ten-kilometre one — a fixed metre count would
 * be most of the first and a rounding error on the second.
 *
 * Two zero-length walks are not "the same length": they are two walks that went
 * nowhere, and `shapeWord` has already refused to describe either. Guarding
 * here as well keeps the ratio from being 0/0.
 */
function withinLength(a: number, b: number): boolean {
  const longer = Math.max(a, b);

  if (longer <= 0) return false;

  return Math.min(a, b) / longer >= 1 - MATCH_LENGTH_TOLERANCE;
}
