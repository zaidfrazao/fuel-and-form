import {
  type Coordinate,
  distanceMetres,
  EARTH_RADIUS_M,
  metresBetween,
  type Track,
  type TrackPoint,
  TRIM_METRES,
} from "@/lib/route";

/**
 * The drawn walk — Brand Guide § Data Display → The Route Trace, FUEL-102.
 *
 * Everything the trace needs that is arithmetic rather than markup: the fit
 * into the box, the shape word, the sentence a screen reader gets, and the
 * string handed to the operating system for a map. `route-trace.tsx` draws what
 * this returns and decides nothing.
 *
 * Separate from `route.ts` because that file is the WRITE path — precision,
 * trimming, simplification, the storable row — and is imported by
 * `db/schema.ts` for its constants. This is the read path, imported by a client
 * component, and nothing here is allowed to be a second opinion about what was
 * stored.
 *
 * ## The graphic is transcribed, not invented
 *
 * `BRAND_GUIDE.html` § 02 draws two specimens beside the ruler and the grid,
 * and that file's caption makes a drawn graphic an obligation on whoever builds
 * the screen. What is transcribed is the RENDERING — the box, the stroke, the
 * marks, the unscaled overlay — and not the specimen's coordinates, which are
 * hand-drawn illustrations rather than the output of a fit. Those points span
 * neither the full box nor a consistent inset, which is what tells you they
 * were drawn by eye; copying them would be transcribing an artist's hand as if
 * it were a specification.
 */

/* -------------------------------------------------------------------------- */
/* The box                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The user-unit box, at § The Route Trace's fixed 3:2 landscape.
 *
 * "Not square: an out-and-back is a long thin thing, and a square box spends a
 * third of the sheet's height on the empty half of it."
 *
 * 120×80 rather than 3×2 or 300×200 because the specimen is drawn at 120×80 and
 * the overlay's percentages are read off those units — a reader comparing the
 * mock to the component should find the same numbers in both. The absolute size
 * is otherwise arbitrary: the box stretches to the sheet's column at every
 * width, which is 331px at 375 and 596px at 1272.
 */
export const TRACE_VIEW_WIDTH = 120;
export const TRACE_VIEW_HEIGHT = 80;

/**
 * The inset the fitted route keeps from the box's edge, in user units.
 *
 * It exists for the MARKS rather than for the drawing. The start ring is 9px
 * and is painted in the unscaled overlay, so its 4.5px radius is a constant
 * number of CSS pixels while the box's units are not: at 375 the column is
 * 331px, so one unit is about 2.76px and the ring's radius is about 1.6 units;
 * at 1272 the column is 596px and the same radius is 0.9. The binding case is
 * therefore the SMALLEST column, which is the opposite of where a padding
 * chosen by eye on a desktop would have been checked.
 *
 * Four units is about 11px at 375 and about 20px at 1272 — clear of the ring at
 * both, with room for the stroke's own round cap, which also paints outward
 * from the geometry by half its 2px width.
 *
 * It is not a plate margin. § The Route Trace refuses a plate outright, so
 * there is no edge for this to sit inside; it is the distance between the
 * furthest point walked and the point where a mark would be clipped.
 */
export const TRACE_PADDING = 4;

/* -------------------------------------------------------------------------- */
/* The shape word                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How near the ends must be for the walk to be called a loop, in metres.
 *
 * ## Derived from the trim, because the guide's stated rule cannot work
 *
 * § The Route Trace says a loop is when "the start and end meet within the
 * recording's own accuracy". That was written before FUEL-100 chose to trim,
 * and the two do not compose: `trimEnds` removes 150 metres from each end
 * before the trace is stored, so a walk that returned to its own front door has
 * a STORED start 150m out along the way there and a stored end 150m back along
 * the way home. Those two points are nowhere near each other — they are as far
 * apart as the two legs are — and an accuracy-sized tolerance would therefore
 * call every loop point-to-point.
 *
 * That is the one failure the section names: *"a wrong shape word is worse than
 * none, because it is the one part of this summary a reader cannot check
 * against the figures sitting beside it."* So the tolerance comes from the
 * thing that actually displaced the ends. Two trims is the worst case — the
 * outbound and inbound legs at their furthest — and a loop whose legs share a
 * road lands far inside it.
 *
 * `2 × TRIM_METRES` rather than the number 300, so that a future change to the
 * trim moves this with it. The two are one decision read twice, and the failure
 * of writing the literal is that the trim would change and this would silently
 * keep answering for the old one.
 */
export const LOOP_TOLERANCE_M = 2 * TRIM_METRES;

/**
 * And the second half of the test: the ends must be near RELATIVE to the walk.
 *
 * The absolute tolerance alone would call a 400-metre stroll down a lane and
 * back to a bus stop a loop, because 300m is most of it. A loop is a walk whose
 * ends are close compared to how far it went, and a quarter is a generous
 * reading of "close" that still refuses the short point-to-point.
 *
 * A walk shorter than twice the trim stores no trace at all, so there is no
 * case below this threshold that the fraction has to rescue.
 */
export const LOOP_MAX_FRACTION = 0.25;

/** Every point of a track, in order, across every segment. */
function points(track: Track): readonly TrackPoint[] {
  return track.flat();
}

/**
 * The word § The Route Trace permits, or null where none is safe.
 *
 * "A **loop** when the start and end meet within the recording's own accuracy,
 * and **point-to-point** when they do not" — with the tolerance as
 * `LOOP_TOLERANCE_M` argues it has to be.
 *
 * *There-and-back* is deliberately never derived. It is a claim about the
 * middle of a path rather than about its ends, it shares its ends with a loop,
 * and a walk that came home a different way would be named wrongly by any test
 * cheap enough to be worth writing.
 *
 * Null for a track that measured no distance — one point, or a receiver that
 * never moved. Both ends are then the same position, which satisfies "the ends
 * meet" arithmetically while describing nothing: a walk that went nowhere is
 * not a loop, and the honest answer is to say no shape at all rather than to
 * pick the word the arithmetic happens to fall into.
 */
export function shapeWord(track: Track): "a loop" | "point to point" | null {
  const all = points(track);
  const first = all.at(0);
  const last = all.at(-1);

  if (!first || !last) return null;

  const walked = distanceMetres(track);

  if (walked <= 0) return null;

  const separation = metresBetween(first, last);

  return separation <= LOOP_TOLERANCE_M && separation <= walked * LOOP_MAX_FRACTION
    ? "a loop"
    : "point to point";
}

/* -------------------------------------------------------------------------- */
/* The gap                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The seconds between segments — time the app did not observe.
 *
 * Read off the points' own `t`, which is seconds from the walk's first fix, so
 * the hole between the last fix of one segment and the first of the next IS the
 * gap. Nothing is inferred about what happened in it, which is the drawing's
 * rule stated in arithmetic: § The Route Trace bans a dashed chord across a gap
 * because it "would draw a path nobody walked", and a gap that contributed
 * distance would be the same falsehood in a figure.
 *
 * Clamped at zero per gap rather than in the total. A negative interval means
 * two segments whose clocks overlap, which is not a gap running backwards but a
 * track that was assembled wrongly; letting it subtract would quietly cancel a
 * real gap elsewhere in the same walk.
 */
export function gapSeconds(track: Track): number {
  let total = 0;

  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1]?.at(-1);
    const next = track[index]?.at(0);

    if (!previous || !next) continue;

    total += Math.max(0, next.t - previous.t);
  }

  return total;
}

/** The gap in whole minutes, or null where there is nothing to name. */
export function gapMinutes(track: Track): number | null {
  const minutes = Math.round(gapSeconds(track) / 60);

  return minutes > 0 ? minutes : null;
}

/**
 * Segments that actually drew something.
 *
 * A segment holding one point paints no polyline — a line needs two ends — so
 * counting it would tell a reader the drawing has a piece in it that they
 * cannot see. The count is a description of the picture, and this is the
 * numerator the picture actually has.
 */
export function drawnSegments(track: Track): number {
  return track.filter((segment) => segment.length > 1).length;
}

/* -------------------------------------------------------------------------- */
/* The fit                                                                    */
/* -------------------------------------------------------------------------- */

/** A position in the box's user units. */
export type TracePoint = { x: number; y: number };

export type TraceGeometry = {
  /** One `points` attribute per segment, in draw order. Never joined. */
  segments: string[];
  /** Where the walk's first stored fix landed. */
  start: TracePoint;
  /** Where its last one did. */
  end: TracePoint;
};

/**
 * Metres east and north of an origin, on a plane tangent at that origin.
 *
 * ## Why the projection exists at all, and what it prevents
 *
 * Latitude and longitude are not interchangeable units. A degree of latitude is
 * about 111km everywhere; a degree of longitude is 111km at the equator and
 * shrinks by the cosine of the latitude — about 69km in London, half of it in
 * Reykjavík. Fitting raw degrees "isotropically" would therefore scale both
 * axes by the same factor while the axes themselves mean different distances,
 * and every trace would be drawn stretched east-to-west by exactly that cosine.
 *
 * That is not a rounding error, it is the thing § The Route Trace forbids in as
 * many words: "a route stretched to a box is a different shape, and shape is
 * the only thing a trace carries". A walk with a square block in it would draw
 * a rectangle, and nobody looking at it could tell.
 *
 * An equirectangular projection about the walk's own first point is enough and
 * is not an approximation worth improving. Its error grows with distance from
 * the origin and a walk is a few kilometres across; over that span it is far
 * inside the metre the coordinates were truncated to before they were stored.
 * A conformal projection here would be a fifth decimal place of correctness on
 * a picture that is explicitly not comparable to any other picture.
 */
function project(point: Coordinate, origin: Coordinate): TracePoint {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;

  return {
    x: EARTH_RADIUS_M * radians(point.lng - origin.lng) * Math.cos(radians(origin.lat)),
    // Negated because SVG's y grows downward and north does not. Doing it here
    // rather than in the fit keeps every later comparison in one orientation.
    y: -EARTH_RADIUS_M * radians(point.lat - origin.lat),
  };
}

/** Two decimals is a hundredth of a user unit — far under a device pixel. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fit one walk to the box, on its own — § The Route Trace's central rule.
 *
 * "The route is scaled **isotropically** — both axes by the same factor, never
 * stretched to fill — and centred with even padding." So a 1.5km loop and a 6km
 * out-and-back both fill the frame, and **the two drawings are not comparable
 * to each other**. The size is carried by the distance figure beneath, which is
 * where this system puts a measured quantity anyway.
 *
 * Fitting every walk to one common scale was the alternative and § The Route
 * Trace refuses it: a short walk would draw as a smudge in the middle of an
 * empty box, spending the sheet's full width to say "this one was shorter" —
 * which the figure says exactly, in four characters.
 *
 * Null for a track with no points in it. That is not a degenerate drawing to be
 * rendered carefully, it is the absence of a route, and § The Route Trace gives
 * it the same answer the plan state gives an exercise with no form media: draw
 * nothing, and offer no control that would open nothing.
 */
export function traceGeometry(track: Track): TraceGeometry | null {
  const all = points(track);
  const origin = all.at(0);
  const final = all.at(-1);

  if (!origin || !final) return null;

  const projected = track.map((segment) =>
    segment.map((point) => project(point, origin)),
  );
  const flat = projected.flat();

  const xs = flat.map((point) => point.x);
  const ys = flat.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const room = {
    x: TRACE_VIEW_WIDTH - 2 * TRACE_PADDING,
    y: TRACE_VIEW_HEIGHT - 2 * TRACE_PADDING,
  };

  // `Infinity` on an axis with no extent, which is what makes `min` pick the
  // axis that HAS one — a walk due north has no width and is still a shape.
  // Both axes empty is the walk that never moved, and there is no scale that
  // means anything for it: the marks land on top of each other in the middle of
  // the box, which is a drawing of a walk that went nowhere and reads as one.
  const scale = Math.min(
    spanX > 0 ? room.x / spanX : Number.POSITIVE_INFINITY,
    spanY > 0 ? room.y / spanY : Number.POSITIVE_INFINITY,
  );
  const fitted = Number.isFinite(scale) ? scale : 0;

  // Centre what is left over, so the padding is even rather than applied to one
  // side. The axis that governed the scale ends up with exactly `TRACE_PADDING`
  // on each side; the other gets more, which is what "fitted to the box on its
  // own" means for a route that is not 3:2 itself.
  const offsetX = (TRACE_VIEW_WIDTH - spanX * fitted) / 2 - minX * fitted;
  const offsetY = (TRACE_VIEW_HEIGHT - spanY * fitted) / 2 - minY * fitted;

  const place = (point: TracePoint): TracePoint => ({
    x: round(point.x * fitted + offsetX),
    y: round(point.y * fitted + offsetY),
  });

  return {
    // A segment of one point is dropped rather than emitted as a one-point
    // `points` attribute: it paints nothing either way, and an empty-looking
    // element in the markup invites a later reader to "fix" it into a chord
    // between the segments, which is the one thing the drawing must not do.
    segments: projected
      .filter((segment) => segment.length > 1)
      .map((segment) =>
        segment
          .map(place)
          .map(({ x, y }) => `${x},${y}`)
          .join(" "),
      ),
    start: place(project(origin, origin)),
    end: place(project(final, origin)),
  };
}

/**
 * A user-unit position as a percentage of the box, for the unscaled overlay.
 *
 * The marks are drawn a layer up in CSS pixels so that the ink does not scale
 * with the geometry (§ Data Display's shared rule, inherited from the chart),
 * and a percentage is what makes the two layers agree at every width without
 * either being measured. It works because the box is exactly 3:2 and the SVG
 * beneath is `xMidYMid meet` at that same ratio, so there is no letterboxing
 * for the percentage to be wrong about.
 */
export function percent(value: number, extent: number): string {
  return `${Math.round((value / extent) * 10000) / 100}%`;
}

/* -------------------------------------------------------------------------- */
/* The words                                                                  */
/* -------------------------------------------------------------------------- */

/** Distance as the app says it everywhere — one decimal, in kilometres. */
export function kilometres(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five"] as const;

/** Small counts in words, because the summary is a sentence and not a readout. */
function count(value: number): string {
  return COUNT_WORDS[value] ?? String(value);
}

export type WalkSummary = {
  /** The walk's own name — the row's, "Morning Walk". Never the route's. */
  walk: string;
  distanceM: number | null;
  durationMin: number | null;
  track: Track;
};

/**
 * The trace's accessible name — § The Route Trace, and FUEL-50's standard.
 *
 * *"Morning Walk, 3.2 km in 34 minutes, a loop, recorded in one segment."*
 * § The Route Trace fixes this list exactly: the walk, its distance, its
 * duration, the shape in a word, and the segment count when there is more than
 * one. Each part is dropped where the walk does not have it rather than
 * rendered as an absence, because a sentence is not a form.
 *
 * **The route's name is deliberately not in it.** The section enumerates what
 * this string carries and a name is not on the list; it is rendered in the
 * figures beside the graphic, where it is visible to everyone rather than to
 * one reader. That is the same instinct as the ruling below it.
 *
 * **And no coordinate is in it, which is a ruling rather than an oversight.**
 * § The Route Trace: the data table for a route is not the coordinates —
 * "nobody can read a list of latitudes; it is not what any reader came for; and
 * it would write the trace into the accessibility tree, which is the one
 * surface PRD § P11's storage rules do not otherwise reach". *Never seeded,
 * never exported* is not a claim anyone can make about text a screen reader
 * will read aloud on a bus.
 */
export function summarise({
  walk,
  distanceM,
  durationMin,
  track,
}: WalkSummary): string {
  const parts: string[] = [walk];

  if (distanceM !== null) parts.push(kilometres(distanceM));

  if (durationMin !== null) {
    const minutes = `${durationMin} ${durationMin === 1 ? "minute" : "minutes"}`;

    // "3.2 km in 34 minutes" reads as one figure; a duration with no distance
    // beside it has nothing to be "in".
    if (distanceM !== null) parts[parts.length - 1] += ` in ${minutes}`;
    else parts.push(minutes);
  }

  const shape = shapeWord(track);

  if (shape !== null) parts.push(shape);

  const segments = drawnSegments(track);

  if (segments > 0) {
    parts.push(
      `recorded in ${count(segments)} ${segments === 1 ? "segment" : "segments"}`,
    );
  }

  const gap = gapMinutes(track);

  if (gap !== null) {
    parts[parts.length - 1] +=
      ` with ${gap} ${gap === 1 ? "minute" : "minutes"} not recorded`;
  }

  return `${parts.join(", ")}.`;
}

/**
 * What the drawing's absences say in words — § The Route Trace's gap rule.
 *
 * *"The segments simply stop and start, and the summary beneath names the
 * absence in words: `/ 2 segments · 6 min not recorded`. That is where an
 * absence belongs in this system, and it is the same answer § The Dot Grid
 * gives an unrecorded day."*
 *
 * Null for the ordinary walk. One unbroken segment and no hole in it is not a
 * fact worth a line — "1 segment" would be the app telling you that nothing
 * happened, which is § Tone of Voice's own objection to narrating a normal
 * state.
 */
export function absences(track: Track): string | null {
  const segments = drawnSegments(track);
  const gap = gapMinutes(track);

  if (segments <= 1 && gap === null) return null;

  const parts: string[] = [];

  if (segments > 1) parts.push(`${segments} segments`);
  if (gap !== null) parts.push(`${gap} min not recorded`);

  return parts.join(" · ");
}

/* -------------------------------------------------------------------------- */
/* The hand-off                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where the stored trace begins — the point the map hand-off opens.
 *
 * It is not the front door, and that is FUEL-100's doing rather than a caveat
 * on this feature: `trimEnds` has already removed the first 150 metres, so the
 * most this hands over is a point a few minutes into a walk. § P11 chose that
 * trim precisely so the thing a leak would otherwise give away for free — the
 * place somebody starts from, twice a day, timestamped — is not in the row to
 * begin with.
 */
export function startCoordinate(track: Track): Coordinate | null {
  const first = points(track).at(0);

  return first ? { lat: first.lat, lng: first.lng } : null;
}

/**
 * A `geo:` URI for the operating system to resolve.
 *
 * **This is not an integration, and the distinction is the point.** No request
 * is made, no key is held, no tile is fetched, and nothing is loaded from
 * another origin. The app hands a string to the platform and the platform
 * decides what opens it — which is why no map provider is named anywhere in
 * this codebase. PRD § Integrations still reads "None" and § P11 records why
 * that survives: "a link to a website has never been an integration, and this
 * is a link" — this one does not even name a website.
 *
 * RFC 5870's `geo:lat,lng`. Latitude first, which is the opposite of GeoJSON's
 * ordering and worth saying out loud in a file that also has to satisfy a
 * pre-publish scan built around the pair form.
 *
 * The five decimals are the ones already stored — `COORD_DECIMALS`, about a
 * metre — so this neither adds precision the row does not have nor drops any it
 * does. Formatting is left to the caller's `toString`, because the value was
 * truncated on write and re-rounding it here would be a second opinion about a
 * decision that has already been made irreversibly.
 */
export function geoUri({ lat, lng }: Coordinate): string {
  return `geo:${lat},${lng}`;
}
