/**
 * What a recorded route is allowed to keep — § P11's storage rules, FUEL-100.
 *
 * This module is the whole of the "on the way in" half of PRD § Risks' leak
 * row. Everything a route gives up before it is stored happens here: the
 * precision it is truncated to, the ends that are trimmed off it, and the
 * points that are dropped to hold it under a cap. A route that reached the
 * database without passing through `storableRoute` would be a route stored at
 * whatever precision the receiver happened to report, which is centimetres.
 *
 * ## Why the rules live in a pure module and not in the write path
 *
 * The same two reasons `exercise-set.ts` gives, and one more that is specific
 * to this data.
 *
 * The refusal reason: every value here arrives from `watchPosition` by way of a
 * Server Action, which is to say from anyone who can POST to this app. A
 * privacy rule exercised only through a Server Action is one no hermetic test
 * can hold still, and this is the one rule in the app whose failure cannot be
 * corrected afterwards — a coordinate stored at seven decimals and then
 * truncated on read is still stored at seven decimals.
 *
 * The derivation reason: distance is a COLUMN (`workout_logs.distance_m`) and
 * the trace is a row in another table, so two readers derive from the same
 * track and must agree. `resolve-plan.ts` states that principle; this file
 * follows it.
 *
 * The third is that geometry is exactly the kind of thing a test should be able
 * to choose. The ticket says a synthetic trace is strictly better than a real
 * one for testing because its shape can be picked, and that is only true if the
 * functions take plain arrays rather than a database row.
 *
 * ## No coordinate literal appears in this file, or in its tests
 *
 * PRD § P11: no coordinate reaches a seed, a fixture, a test or the repository.
 * That reads like it collides with needing test data, and it does not: the
 * tests express geometry in METRES from an origin of zero and project it, so
 * what is written down is `100 metres east` rather than a latitude. The
 * assertions are about metres anyway, so this is the clearer way round as well
 * as the compliant one. `scripts/check-no-metrics.sh` will see a coordinate
 * anywhere in the tree — including in this file — so the rule is enforced
 * rather than merely stated.
 *
 * ## Pure, and given its values
 *
 * No database, no clock, no session, and no import from `schema.ts` — the same
 * contract `exercise-set.ts` and `walk.ts` keep, and the reason FUEL-101's
 * recording component can import `MAX_ROUTE_POINTS` without dragging pg-core
 * into the browser bundle.
 */

/* -------------------------------------------------------------------------- */
/* The three figures PRD § P11 left to this ticket                            */
/* -------------------------------------------------------------------------- */

/**
 * How many decimal places of a degree survive the write. Five.
 *
 * A ten-thousandth of a degree of latitude is about eleven metres and a
 * hundred-thousandth is about one; the longitude figure shrinks with the
 * cosine of the latitude, so five decimals is at worst a metre and usually
 * less. That is more than enough to draw a line, and it is the resolution at
 * which a trace stops being able to say which side of a road someone was on.
 *
 * Seven decimals — what a phone's receiver will happily report — is
 * centimetres. No walk is measured that well by any consumer GPS, so the extra
 * digits are not accuracy: they are a claim about a doorway, and they are
 * noise with a claim's shape.
 *
 * This is stated again in the column comment on `walk_routes.points`, because
 * the database is where someone reads a value and asks what it means.
 */
export const COORD_DECIMALS = 5;

/**
 * The most points one route may store. Five hundred.
 *
 * Derived from the graphic rather than picked. Brand Guide § The Route Trace
 * fixes the box at a 3:2 landscape filling the sheet's column, and § Desktop
 * puts that column at 331px on a 375 screen and 596px at 1272. So 596 CSS
 * pixels is the widest a trace is ever drawn, and five hundred points across it
 * is roughly one per pixel — the resolution at which two consecutive points
 * stop being tellable apart no matter how good the eye or the display.
 *
 * The volume argument arrives at a similar place from the other side: a
 * 45-minute walk sampled once a second is about 2,700 fixes, twice a day is a
 * megabyte a month of coordinates nothing ever queries, and this holds it to
 * roughly a fifth of that.
 *
 * It is a BACKSTOP and not the mechanism. `simplifyToCap` reduces by shape
 * first — a walk down a straight road needs two points to draw, whatever its
 * duration — and a real walk normally lands far below this. The cap is what
 * stops a pathological track (a stationary phone with a jittering receiver,
 * an hour of it) from being stored in full.
 */
export const MAX_ROUTE_POINTS = 500;

/**
 * How much of each end is trimmed away before the trace is stored. 150 metres.
 *
 * The decision this ticket was asked to make, and the honest note that has to
 * travel with it: **this protects against the repository far more than it
 * protects against the database.** The row that remains still carries the
 * walk's date, its duration and its distance, and the untrimmed middle of a
 * twice-daily walk still identifies a neighbourhood to anyone who reads ten of
 * them. What the trim removes is the specific thing a leak would otherwise
 * hand over for free: the point the walk starts and ends at, which is the front
 * door, repeated twice a day and timestamped.
 *
 * It is applied on WRITE and is therefore irreversible. That is the point. A
 * trim applied on read would leave the doorstep in the database, protecting
 * nothing that a leak of the database would not immediately undo, and it would
 * be one flag away from being switched off by someone who wanted a complete
 * line.
 *
 * The cost is stated rather than hidden: every stored trace is a slightly short
 * line, and a walk shorter than twice this figure stores no trace at all —
 * see `trimEnds`. The distance column is NOT trimmed, and `storableRoute` says
 * why.
 *
 * ## What this number does NOT promise, measured rather than assumed
 *
 * It is metres of WALKING removed, not a radius cleared around the door. On a
 * loop the two differ, because a path that curves covers ground without getting
 * proportionally further away: measured across the demo's forty generated
 * routes, the closest surviving point sits about **96 metres** from the origin,
 * not a hundred and fifty. Every trace still begins and ends well clear of the
 * door, which is the property this exists for, but a reader assuming a cleared
 * circle would be assuming something stronger than what is done.
 *
 * A radius trim was considered for that reason and refused. It would delete a
 * short local loop entirely — a walk twice round the block never leaves the
 * circle — so the trace would vanish for exactly the walks somebody does most
 * often, and silently. Trimming by path length always leaves the middle of a
 * walk that had a middle.
 *
 * Neither version defeats the attack that matters, and that is worth saying
 * plainly: ten traces that all begin and end on a ring still have the door at
 * the centre of that ring. The trim raises the cost of reading an address off
 * one leaked trace. It is not a claim that many of them are anonymous.
 */
export const TRIM_METRES = 150;

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** A position on the earth, in degrees. */
export type Coordinate = {
  lat: number;
  lng: number;
};

/**
 * A position with the second it was recorded at, counted from the walk's start.
 *
 * Relative rather than absolute, and that is a storage decision rather than a
 * convenience: `workout_logs` already carries the date and `logged_at`, so an
 * absolute timestamp on every point would be the walk's clock written out five
 * hundred times. It would also make the trace independently re-identifying —
 * a coordinate plus a wall-clock instant is a stronger claim than either — for
 * a field the drawing never reads.
 */
export type TrackPoint = Coordinate & {
  /** Seconds since the first fix of the walk. */
  t: number;
};

/**
 * A recorded walk: one array per continuous stretch of recording.
 *
 * Segments rather than one flat array with a break flag, because that is the
 * shape both readers want. Brand Guide § The Route Trace: *"A gap — nothing at
 * all. Each segment is its own polyline"*, so the drawing maps segments to
 * `<polyline>` elements directly. And `distanceMetres` sums WITHIN segments, so
 * the gap contributes no length by construction rather than by a condition
 * someone has to remember to write — which is FUEL-101's "a 3km walk becomes
 * 5km" failure made structurally impossible here rather than tested for there.
 */
export type Track = readonly (readonly TrackPoint[])[];

/** What `storableRoute` hands the write path. */
export type StorableRoute = {
  /** The trimmed, simplified, truncated track — `walk_routes.points`. */
  points: Track;
  /** How many points survived, across every segment — `walk_routes.point_count`. */
  pointCount: number;
  /**
   * The FULL walk's distance in whole metres, untrimmed —
   * `workout_logs.distance_m`. Null when there is none to report.
   *
   * Null rather than zero, and the column's CHECK is why it has to be: a
   * recording that produced one usable fix, or two a handspan apart, measures
   * no distance at all. Zero is a measurement — it reads as a walk where
   * somebody stood still — and `workout_logs_distance_range` refuses it
   * outright, so a caller passing the zero through would turn a degenerate
   * recording into a failed insert rather than into a walk with fewer figures.
   * § P11's "absent rather than zeroed", decided here so that every caller
   * inherits it instead of each remembering.
   */
  distanceM: number | null;
  /**
   * The tolerance the track was thinned at, or null if nothing was dropped —
   * `walk_routes.simplified_tolerance_m`.
   *
   * Provenance rather than data, and the only record of how lossy the stored
   * shape is. Without it a straight two-point line and a walk whose shape was
   * thinned away by an escalating cap are the same picture.
   */
  toleranceM: number | null;
};

/** A thinned track, and the tolerance it took to fit. */
export type Simplified = {
  track: Track;
  /** Null when nothing was dropped — every point survived as recorded. */
  toleranceM: number | null;
};

/* -------------------------------------------------------------------------- */
/* Distance                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The earth's mean radius, in metres — IUGG's R1.
 *
 * A sphere, not an ellipsoid. Vincenty on WGS84 is accurate to millimetres and
 * the difference over a four-kilometre walk is a few metres, which is well
 * inside what the receiver itself contributes and far inside the precision this
 * file then truncates to. Carrying an ellipsoid here would be a fourth decimal
 * place of accuracy on a figure the app rounds before showing it.
 *
 * Exported because the tests project metres into degrees to build their
 * geometry, and a second copy of this number over there would be two files
 * spelling one literal — each with its own test, and both agreeing with each
 * other rather than with the earth.
 */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The great-circle distance between two positions, in metres.
 *
 * Haversine rather than the spherical law of cosines: the two agree to within
 * a rounding error at walking distances, but the law of cosines loses its
 * significant digits entirely for points a few metres apart — which is EVERY
 * pair here, since fixes arrive about once a second. The failure mode is a
 * distance that reads zero for a slow walk, which is exactly the case this app
 * has most of.
 */
export function metresBetween(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far the walk went, in metres — the sum of each segment's own length.
 *
 * The join between two segments contributes NOTHING. That is the whole reason
 * this type is nested: if the screen was off for six minutes, the straight line
 * across the gap is not distance anyone walked, and adding it is how a 3km walk
 * becomes 5km. Here there is no line across the gap to add, because the loop
 * never spans two segments.
 */
export function distanceMetres(track: Track): number {
  let total = 0;
  for (const segment of track) {
    let previous: TrackPoint | undefined;
    for (const point of segment) {
      if (previous !== undefined) total += metresBetween(previous, point);
      previous = point;
    }
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Precision                                                                  */
/* -------------------------------------------------------------------------- */

const PRECISION_FACTOR = 10 ** COORD_DECIMALS;

/**
 * One position with everything past the fifth decimal place removed.
 *
 * ## Why this rounds rather than calling `Math.trunc`
 *
 * "Truncate precision" is the requirement — drop the digits — and rounding is
 * the accurate way to perform it. `Math.trunc` looks like the literal reading
 * and is worse at the job: a decimal fraction has no exact binary
 * representation, so a value whose fifth decimal is exact is about as likely to
 * be held as `…733999999` as `…734000001`, and truncation turns half of those
 * into a value one whole unit in the last place too low. That is a metre of
 * error introduced by the privacy step, biased consistently in one direction —
 * south and west in the northern hemisphere — which over five hundred points
 * is a systematic skew rather than noise.
 *
 * Rounding discards exactly the same digits and is unbiased. The privacy
 * property is identical: what is removed is removed.
 */
export function reducePrecision(point: Coordinate): Coordinate {
  return {
    lat: Math.round(point.lat * PRECISION_FACTOR) / PRECISION_FACTOR,
    lng: Math.round(point.lng * PRECISION_FACTOR) / PRECISION_FACTOR,
  };
}

/**
 * The track at storage precision, with points that have collapsed onto each
 * other removed.
 *
 * The dedupe is not tidiness. After truncation a stationary minute is the same
 * position repeated sixty times, and those points cost storage, count against
 * the cap and draw nothing — a polyline through one position is a dot however
 * many times it is listed. Consecutive duplicates only: a route that returns to
 * a position it visited earlier genuinely was there twice, and a loop is the
 * commonest shape a daily walk has.
 *
 * The first point's `t` is the one kept, so a pause reads as the moment it
 * began rather than the moment it ended.
 */
export function reduceTrackPrecision(track: Track): Track {
  return track
    .map((segment) => {
      const reduced: TrackPoint[] = [];
      for (const point of segment) {
        const { lat, lng } = reducePrecision(point);
        const previous = reduced.at(-1);
        if (previous !== undefined && previous.lat === lat && previous.lng === lng) {
          continue;
        }
        reduced.push({ lat, lng, t: point.t });
      }
      return reduced;
    })
    .filter((segment) => segment.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Trimming the ends                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The track with the first and last `metres` of walking removed.
 *
 * ## Measured along the path, and across segment boundaries
 *
 * Not "drop the first segment" and not "drop the first N points". The quantity
 * that matters is how far from the door the trace now starts, so the walk is
 * consumed in path order until that many metres have been covered — through a
 * gap and into the second segment if the first one is short, which is the case
 * a phone that lost its fix on the doorstep produces every time.
 *
 * ## Points are dropped, never interpolated
 *
 * The cut lands on a real fix rather than on a position computed along the line
 * to it. Interpolating would be more precise about the trim length and would
 * mean the stored trace contains a coordinate nobody was ever at — a value that
 * looks exactly like a fix, in a table whose whole purpose is holding fixes. So
 * the trim is at LEAST this many metres and at most this many plus one sample
 * interval, which errs in the safe direction.
 *
 * ## A walk too short to trim stores no trace
 *
 * Under twice the trim length there is no middle: everything recorded is
 * doorstep at one end or the other. The empty track that comes back is the
 * honest answer, and `storableRoute` turns it into no `walk_routes` row at all
 * rather than a row holding a two-point stub. The walk still logs, still
 * carries its distance and its duration, and reads as a walk with no route —
 * which PRD § P11 already requires to render correctly, because a walk recorded
 * with no GPS at all produces the same state.
 */
export function trimEnds(track: Track, metres: number = TRIM_METRES): Track {
  if (metres <= 0) return track;

  const forward = consumeFromStart(track, metres);
  const backward = consumeFromStart(reverseTrack(forward), metres);
  return reverseTrack(backward);
}

/** Drop points in path order until `metres` of walking have been covered. */
function consumeFromStart(track: Track, metres: number): Track {
  let remaining = metres;
  const kept: TrackPoint[][] = [];

  for (const segment of track) {
    // The budget ran out in an earlier segment, so this one survives whole.
    if (remaining <= 0) {
      kept.push([...segment]);
      continue;
    }

    const tail: TrackPoint[] = [];
    let previous: TrackPoint | undefined;

    for (const point of segment) {
      if (remaining <= 0) {
        tail.push(point);
        continue;
      }
      // The gap BEFORE a segment costs nothing — the same rule
      // `distanceMetres` applies, and the reason `previous` resets per
      // segment: a stretch nobody recorded is not a stretch anybody walked,
      // so it cannot pay for the trim either.
      if (previous !== undefined) remaining -= metresBetween(previous, point);
      previous = point;
      // The fix that crossed the threshold is the first one kept, which is
      // what makes the cut land on a real position rather than on an
      // interpolated one. See the note above on why that matters.
      if (remaining <= 0) tail.push(point);
    }

    if (tail.length > 0) kept.push(tail);
  }

  return kept;
}

/** Every segment reversed, and their order reversed with them. */
function reverseTrack(track: Track): Track {
  return track.map((segment) => [...segment].reverse()).reverse();
}

/* -------------------------------------------------------------------------- */
/* Simplification                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Where simplification starts, in metres.
 *
 * Just above the resolution the coordinates are stored at: a point that sits
 * two metres off the line between its neighbours is at the edge of what
 * `COORD_DECIMALS` can even express, so removing it removes no shape that
 * survived the truncation anyway.
 */
const SIMPLIFY_EPSILON_M = 2;

/**
 * The perpendicular distance from `point` to the line through `start` and
 * `end`, in metres.
 *
 * The two positions are projected to a local plane first — longitude scaled by
 * the cosine of the latitude — which is exact enough over the tens of metres a
 * simplification decision spans and avoids a spherical cross-track formula
 * whose extra correctness lands well below the metre this file rounds to.
 */
function perpendicularMetres(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number {
  const scale = Math.cos(toRadians(start.lat));
  const metresPerDegree = (Math.PI / 180) * EARTH_RADIUS_M;

  const px = (point.lng - start.lng) * scale * metresPerDegree;
  const py = (point.lat - start.lat) * metresPerDegree;
  const ex = (end.lng - start.lng) * scale * metresPerDegree;
  const ey = (end.lat - start.lat) * metresPerDegree;

  const lengthSquared = ex * ex + ey * ey;
  // A segment whose ends coincide is a point, and the distance to it is the
  // ordinary one. Without this the projection below divides by zero — which is
  // reachable, because a closed loop that returns to its first fix is the
  // commonest shape a daily walk has.
  if (lengthSquared === 0) return Math.sqrt(px * px + py * py);

  const cross = px * ey - py * ex;
  return Math.abs(cross) / Math.sqrt(lengthSquared);
}

/**
 * Ramer–Douglas–Peucker over one segment.
 *
 * The method matters and the ticket says why: dropping every other point
 * distorts corners, and a corner is the only information a trace carries. RDP
 * keeps the points that are furthest from the line their neighbours make — the
 * turns — and discards the ones a straight stretch spends on saying it is
 * still straight. A walk down a long road reduces to its two ends, which is
 * exactly right, and a walk round a park keeps every bend.
 *
 * Iterative rather than recursive: five hundred points is nothing, but the
 * input is untrusted and arrives before the cap is applied, so a pathological
 * track should not be able to exhaust the stack of a Server Action.
 */
function simplifySegment(
  segment: readonly TrackPoint[],
  epsilon: number,
): TrackPoint[] {
  const first = segment.at(0);
  const last = segment.at(-1);
  // Narrows for `noUncheckedIndexedAccess` and states the floor in the same
  // breath — weight-chart.ts reads the same way, and for the same reason. Two
  // points are already a line and an empty segment has nothing to thin, so
  // both are returned as they came.
  if (first === undefined || last === undefined || segment.length <= 2) {
    return [...segment];
  }

  const keep = new Array<boolean>(segment.length).fill(false);
  keep[0] = true;
  keep[segment.length - 1] = true;

  // Each span carries its own endpoints as VALUES rather than as indices into
  // the segment. The indices are still needed to record what was kept, but
  // nothing has to re-read the array to find a point it already holds.
  type Span = { from: number; to: number; start: TrackPoint; end: TrackPoint };
  const stack: Span[] = [
    { from: 0, to: segment.length - 1, start: first, end: last },
  ];

  for (let span = stack.pop(); span !== undefined; span = stack.pop()) {
    let furthest: { index: number; point: TrackPoint } | undefined;
    let furthestDistance = epsilon;

    // `slice(...).entries()` rather than an index loop: it yields the points
    // themselves, so there is no indexed read to narrow and no unreachable
    // guard standing in front of the one thing this function does.
    for (const [offset, point] of segment.slice(span.from + 1, span.to).entries()) {
      const distance = perpendicularMetres(point, span.start, span.end);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthest = { index: span.from + 1 + offset, point };
      }
    }

    if (furthest !== undefined) {
      keep[furthest.index] = true;
      stack.push(
        { from: span.from, to: furthest.index, start: span.start, end: furthest.point },
        { from: furthest.index, to: span.to, start: furthest.point, end: span.end },
      );
    }
  }

  return segment.filter((_point, index) => keep[index] === true);
}

/** How many points a track holds across every segment. */
export function countPoints(track: Track): number {
  return track.reduce((total, segment) => total + segment.length, 0);
}

/**
 * The track reduced to at most `cap` points, by shape.
 *
 * One epsilon across every segment, doubled until the whole track fits. Doing
 * it globally rather than per segment is what keeps the segments comparable:
 * simplifying each to its own share of the cap would smooth a short segment
 * harder than a long one and draw two stretches of the same walk at two
 * different fidelities.
 *
 * ## The floor, and what happens at it
 *
 * RDP never drops an endpoint, so a track cannot reduce below two points per
 * segment however large the epsilon grows. A track with more segments than half
 * the cap therefore cannot fit by simplification at all — which takes a
 * recording that lost its fix hundreds of times, and is exactly the kind of
 * input a Server Action has to survive. The shortest segments go first: a
 * segment of a few metres is a receiver settling rather than a stretch of
 * walking, and it is the least shape lost per point recovered.
 */
export function simplifyToCap(
  track: Track,
  cap: number = MAX_ROUTE_POINTS,
): Simplified {
  let epsilon = SIMPLIFY_EPSILON_M;
  let simplified = track.map((segment) => simplifySegment(segment, epsilon));

  // Doubling from two metres reaches the width of a continent in about
  // twenty-five steps, so the bound is a guard against a non-terminating loop
  // rather than a limit anything reaches.
  for (let attempt = 0; attempt < 32 && countPoints(simplified) > cap; attempt += 1) {
    epsilon *= 2;
    simplified = track.map((segment) => simplifySegment(segment, epsilon));
  }

  // Null when the track came through untouched — a two-point segment, or a
  // walk already coarser than the tolerance. Recording a figure there would
  // claim a reduction that did not happen.
  const toleranceM = countPoints(simplified) === countPoints(track) ? null : epsilon;

  if (countPoints(simplified) <= cap) return { track: simplified, toleranceM };

  const longestFirst = simplified
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => distanceMetres([b.segment]) - distanceMetres([a.segment]));

  const keptIndices = new Set<number>();
  let total = 0;
  for (const { segment, index } of longestFirst) {
    if (total + segment.length > cap) continue;
    keptIndices.add(index);
    total += segment.length;
  }

  // Filtered by index rather than rebuilt from the sorted list, so what comes
  // back is still in the order it was walked. A trace is drawn segment by
  // segment and the order does not change the picture, but it does change what
  // `points[0]` means, and FUEL-102's map hand-off reads the start of the walk.
  return {
    track: simplified.filter((_segment, index) => keptIndices.has(index)),
    toleranceM: epsilon,
  };
}

/* -------------------------------------------------------------------------- */
/* The whole pipeline                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A recorded track, as it is allowed to be stored.
 *
 * The one function the write path calls. Everything above is exported for its
 * own tests and for FUEL-101's live recording, but the ORDER below is the part
 * that has to be in one place, because three of the four steps change what the
 * others see.
 *
 * ## Why distance is measured before the trim, and the trace after it
 *
 * `distanceM` is the FULL walk — every metre recorded, including the three
 * hundred that are about to be cut off the ends. The two are different claims
 * and only one of them is a privacy control.
 *
 * Distance is a measured quantity about a person's day. It reaches the export,
 * the energy estimate (FUEL-104) and the step estimate (FUEL-103), and a figure
 * short by up to three hundred metres on every walk would be a corrupted
 * measurement — twice a day, compounding through every derived number, to
 * protect a coordinate that the trim has already removed. The trim exists to
 * take the doorstep out of the STORED GEOMETRY. It has no privacy work left to
 * do on a scalar that says "3.2 km", and doing it there would cost accuracy for
 * nothing.
 *
 * So they disagree by design: the drawn trace is shorter than the figure
 * underneath it. Brand Guide § The Route Trace makes that safe without knowing
 * it — each walk is fitted to its own box, so the trace shows shape and not
 * size, and "the size is carried by the figure beneath it". A reader cannot
 * measure the line against the number because the line has no scale to measure
 * against.
 *
 * ## And why precision is reduced last
 *
 * Distance and the simplification both read the geometry, and both are more
 * accurate against what the receiver actually reported. Truncating first would
 * feed a metre of quantisation noise into every one of the five hundred
 * distance terms — biased in whichever direction each point happened to round —
 * and would move points across the simplification threshold on the strength of
 * digits that are about to be discarded anyway. The stored output is identical;
 * the figures derived from it are better.
 */
export function storableRoute(
  track: Track,
  options: { cap?: number; trimMetres?: number } = {},
): StorableRoute {
  const cap = options.cap ?? MAX_ROUTE_POINTS;
  const trimMetres = options.trimMetres ?? TRIM_METRES;

  // Rounded to the metre first, so a track measuring half a metre is the
  // "no distance" case rather than a stored 1 — see `distanceM` on the type.
  const metres = Math.round(distanceMetres(track));
  const distanceM = metres > 0 ? metres : null;

  const trimmed = trimEnds(track, trimMetres);
  const simplified = simplifyToCap(trimmed, cap);
  const points = reduceTrackPrecision(simplified.track);

  return {
    points,
    pointCount: countPoints(points),
    distanceM,
    toleranceM: simplified.toleranceM,
  };
}
