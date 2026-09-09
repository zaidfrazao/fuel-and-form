import { type Coordinate, type Track, type TrackPoint, metresBetween } from "./route";

/**
 * A walk being recorded — the receiver's readings turned into a `Track`.
 *
 * FUEL-101, PRD § P11. `route.ts` is the other half of this and the division is
 * deliberate: that file knows what a recorded walk IS once it exists — how far
 * it went, how to thin it, what may be stored — and this file knows how one
 * gets built out of a stream of fixes that is dirty in three specific ways.
 *
 * ## Pure, and the reason it is worth the seam
 *
 * No DOM types cross into this module. `GeolocationPosition` is flattened into
 * a `Fix` by the component, so everything below is a total function over plain
 * numbers and every case that matters is reachable from a test with no browser
 * in it. The ticket says as much — *"Distance derivation is pure and should be
 * tested as such… That is where the real bugs are"* — and the three bugs it
 * names are all in here rather than in the recording UI.
 *
 * ## A reducer, not a buffer
 *
 * The obvious shape is "collect every fix in an array, process the array on
 * Stop". It is refused, and by two acceptance criteria rather than by taste:
 * the in-progress track must be persisted on EVERY fix, and an interrupted
 * recording must be resumable. If what is persisted IS the reducer's state,
 * those are one mechanism. With a buffer they are two — the raw fixes and a
 * derived track — which can disagree, and the one that gets written to
 * `localStorage` is the one nobody tested.
 *
 * `appendFix` is therefore total and returns a new state: it never throws, it
 * never mutates, and a `Recording` round-tripped through `JSON.stringify` is
 * the same `Recording`. That last property is load-bearing rather than
 * incidental — it is what makes the draft in `localStorage` resumable at all.
 *
 * ## What it is not
 *
 * It does not measure distance, trim, simplify or truncate precision —
 * `storableRoute` does all four on the way to the database, and doing any of
 * them here would be a second copy of a decision PRD § P11 fixed with numbers.
 * What comes out of `track()` is the honest shape of what the receiver saw.
 */

/* -------------------------------------------------------------------------- */
/* The thresholds                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The accuracy radius, in metres, above which a fix is not used.
 *
 * The ticket's own number: *"early fixes are routinely 50m+ before the receiver
 * settles"*, so 50 is the line between a receiver that has settled and one that
 * has not. A 300m fix is what turns a walk into a 600m hop in one step, and it
 * arrives with a label saying it is a 300m fix — `coords.accuracy` is the one
 * piece of self-assessment the platform gives, and refusing to read it while
 * inventing heuristics downstream would be strange.
 *
 * Checked BEFORE the speed rule below, and the order is not cosmetic: a 300m
 * outlier fails both, and if speed ran first the fix would be discarded for
 * implying a sprint when what was actually wrong with it is that the receiver
 * said it did not know where it was.
 *
 * ## This is a judgement, not a measurement
 *
 * Nobody has walked with this app and sampled what its receiver reports. The
 * number is the ticket's, and the ticket's is the platform's usual behaviour
 * rather than this phone's. It is a constant so that a real walk can move it,
 * which is what PRD § Data Model asks for after FUEL-89: a figure that was
 * guessed should say so rather than be presented as derived.
 */
export const MAX_ACCURACY_M = 50;

/**
 * The speed, in metres per second, above which a fix is a bad reading.
 *
 * 8 m/s is 28.8 km/h — comfortably above any walk, any jog and a sprinter's
 * average, and far below what a receiver reports when it relocates you across
 * a suburb between two readings. The ticket puts it exactly: *"a jump is a bad
 * fix, not a sprint"*.
 *
 * Deliberately generous. The cost of the two errors is not symmetric: a
 * threshold set too high keeps one bad fix, which `simplifyToCap` will often
 * thin away and which moves the distance by metres; one set too low silently
 * discards real walking, and a recording that quietly drops half of what
 * happened is exactly the "never silently lost" failure this ticket is written
 * against.
 *
 * ## Measured against the last KEPT fix, and never across a gap
 *
 * See `appendFix`. Both halves of that sentence are bugs this constant would
 * otherwise cause rather than prevent.
 */
export const MAX_SPEED_MPS = 8;

/**
 * The silence, in seconds, that ends a segment and starts a new one.
 *
 * This is the constant that makes *"a gap is not a straight line"* true in
 * production. `route.ts` already makes it true in arithmetic — `distanceMetres`
 * sums WITHIN segments, so a join contributes nothing by construction — but
 * arithmetic over one flat segment has no gap in it to exclude. Something has
 * to decide where the walk stopped being observed, and it is this.
 *
 * 30 seconds. `watchPosition` with `enableHighAccuracy` reports every second or
 * two while the screen is on, so half a minute of nothing is not a slow
 * receiver, it is a screen that locked or an app that went to the background —
 * the case PRD § P11 says the whole feature is built for. A walker standing
 * still still produces fixes; a phone in a pocket produces none.
 *
 * Set too long, a genuine six-minute hole gets drawn and counted as a straight
 * line, which is the 3km-becomes-5km failure. Set too short, an ordinary walk
 * is chopped into dozens of segments, each of which loses the distance between
 * itself and the next — the same failure with the sign flipped, and quieter,
 * because a distance that reads low looks like a short walk rather than a bug.
 */
export const SEGMENT_GAP_S = 30;

/* -------------------------------------------------------------------------- */
/* The state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One reading from the receiver, flattened.
 *
 * `accuracy` is the radius the platform reports around the position, and `at`
 * is the wall clock instant it was taken at — both straight off
 * `GeolocationPosition`, with the nested `coords` and the `DOMTimeStamp`
 * dropped so that nothing here depends on a browser type.
 */
export type Fix = Coordinate & {
  /** The receiver's own accuracy radius, in metres. Smaller is better. */
  accuracy: number;
  /** When the fix was taken — epoch milliseconds. */
  at: number;
};

/**
 * A walk in progress, and the whole of what gets persisted between fixes.
 *
 * Every field is JSON — no `Date`, no `Map`, nothing with a prototype — because
 * this is what goes into `localStorage` on every fix and comes back out after
 * an interruption. A field that did not survive that round trip would be a
 * field that is correct until the moment the feature is actually needed.
 */
export type Recording = {
  /**
   * The instant of the first KEPT fix — the origin every `t` counts from.
   *
   * Null until one arrives, which is a real state and not an initialisation
   * detail: a recording started indoors can run for a minute with every fix
   * refused for accuracy, and during that minute there is no walk yet.
   *
   * The first kept fix rather than the tap that started the recording, because
   * `route.ts` defines `TrackPoint.t` as *"seconds since the first fix of the
   * walk"* and two origins for one number is how they drift.
   */
  startedAt: number | null;
  /** The track so far — one array per continuous stretch of recording. */
  segments: readonly (readonly TrackPoint[])[];
  /**
   * The last fix that was KEPT, which is what the next one is judged against.
   *
   * Kept rather than seen, and that is the fix for the poisoning bug: if a
   * discarded outlier became `last`, every good fix after it would be measured
   * against a position the walker was never at, and a single wild reading would
   * silently reject the whole rest of the walk.
   */
  last: Fix | null;
  /**
   * How many fixes were refused.
   *
   * Not shown to anyone and not stored. It exists so that "the receiver never
   * settled" and "nothing was ever received" are different states in a test and
   * in a console — a recording that produced no track because it discarded
   * forty fixes is a different problem from one that was handed none.
   */
  discarded: number;
};

/** A recording that has been started and has been given nothing yet. */
export const NOTHING_RECORDED: Recording = {
  startedAt: null,
  segments: [],
  last: null,
  discarded: 0,
};

/* -------------------------------------------------------------------------- */
/* The reducer                                                                */
/* -------------------------------------------------------------------------- */

/** Whether a number is real and finite — `NaN` and both infinities are not. */
const isReal = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Whether a fix is usable at all, before any comparison with its predecessor.
 *
 * Range checks rather than trust: `watchPosition` will not invent a latitude of
 * 200, but this same shape arrives from `localStorage`, where anything can be,
 * and a resumed draft is parsed by the same reducer as a live fix. One gate for
 * both is one gate to be right.
 */
function isUsable(fix: Fix): boolean {
  return (
    isReal(fix.lat) &&
    isReal(fix.lng) &&
    isReal(fix.at) &&
    isReal(fix.accuracy) &&
    fix.lat >= -90 &&
    fix.lat <= 90 &&
    fix.lng >= -180 &&
    fix.lng <= 180 &&
    fix.accuracy >= 0 &&
    fix.accuracy <= MAX_ACCURACY_M
  );
}

/** The same recording with one more refusal counted against it. */
const refuse = (recording: Recording): Recording => ({
  ...recording,
  discarded: recording.discarded + 1,
});

/** A kept fix as a point on the track, its second counted from the origin. */
const pointAt = (fix: Fix, startedAt: number): TrackPoint => ({
  lat: fix.lat,
  lng: fix.lng,
  t: Math.round((fix.at - startedAt) / 1000),
});

/**
 * Folds one reading into the walk so far.
 *
 * Total: every input produces a `Recording`, and a refused fix produces the one
 * it was given with `discarded` raised. Nothing throws, so a malformed reading
 * cannot take the recording down with it — which matters more here than it
 * usually would, because the alternative to a running recording is a walk that
 * was not recorded and cannot be re-walked.
 *
 * ## The four answers, in the order they are decided
 *
 *  1. **Unusable** — out of range, not a number, or an accuracy radius wider
 *     than `MAX_ACCURACY_M`. Refused, and `last` is untouched.
 *  2. **The first** — no `last` yet, so this fix is the walk's origin and its
 *     own first segment. No speed to check against, because there is nothing
 *     to check it against.
 *  3. **After a gap** — more than `SEGMENT_GAP_S` since the last kept fix. A
 *     new segment begins, and the fix is accepted WITHOUT a speed check.
 *  4. **Continuing** — appended to the open segment, if the implied speed is
 *     believable.
 *
 * ## Why case 3 does not check the speed, which looks like a hole and is not
 *
 * It is the escape hatch that keeps case 4's rejection from being permanent.
 * A refused fix leaves `last` where it was, which is right for a lone outlier —
 * the good fix after it is measured against a real position and kept. But a
 * SUSTAINED run of refusals would otherwise compare every new fix against a
 * `last` that is minutes and kilometres stale, and reject all of them forever:
 * the recording would still be running, the screen would still say so, and
 * nothing more would ever be written. Because a stale `last` is by definition
 * more than `SEGMENT_GAP_S` old, case 3 catches it first and the recording
 * heals itself within half a minute.
 *
 * The cost is that the first fix after a gap is trusted on its accuracy alone.
 * That is the right trade: the accuracy radius is a direct statement about that
 * one reading, whereas an average speed across a six-minute hole is a statement
 * about an interval nobody observed — it cannot distinguish a walk home from a
 * receiver that woke up confused, and would refuse both or neither.
 *
 * ## Time going backwards
 *
 * A fix at or before `last.at` is refused rather than reordered. Two readings
 * sharing an instant imply an infinite speed if they differ at all, and one
 * that arrives out of order would give a negative `t` in a track whose points
 * every consumer reads as increasing. Neither is worth a sort on a hot path
 * for a case the platform does not produce.
 */
export function appendFix(recording: Recording, fix: Fix): Recording {
  if (!isUsable(fix)) return refuse(recording);

  const { last, startedAt, segments } = recording;

  // Case 2 — the origin. `startedAt` and `last` become non-null together and
  // are never cleared, so this branch runs exactly once per recording.
  if (last === null || startedAt === null) {
    return {
      startedAt: fix.at,
      segments: [[{ lat: fix.lat, lng: fix.lng, t: 0 }]],
      last: fix,
      discarded: recording.discarded,
    };
  }

  const elapsedS = (fix.at - last.at) / 1000;

  if (elapsedS <= 0) return refuse(recording);

  // Case 3 — the gap. A new segment, on its accuracy alone.
  if (elapsedS > SEGMENT_GAP_S) {
    return {
      startedAt,
      segments: [...segments, [pointAt(fix, startedAt)]],
      last: fix,
      discarded: recording.discarded,
    };
  }

  // Case 4 — continuing. `last` is deliberately not advanced on a refusal.
  if (metresBetween(last, fix) / elapsedS > MAX_SPEED_MPS) return refuse(recording);

  // Rebuilt by index rather than `segments.at(-1) ?? []`, which reads as the
  // obvious way to reach the open segment and carries a branch nothing can
  // execute: `last` and the first segment are created together in case 2 and
  // neither is ever cleared, so there is always a segment to append to. A
  // fallback for it would be a line that can only ever be wrong.
  const open = segments.length - 1;

  return {
    startedAt,
    segments: segments.map((segment, index) =>
      index === open ? [...segment, pointAt(fix, startedAt)] : segment,
    ),
    last: fix,
    discarded: recording.discarded,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading it                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The walk as `storableRoute` wants it.
 *
 * The segments unchanged — this is a named seam rather than a transformation,
 * so that the write path names what it is being given instead of reaching into
 * a field. Empty segments cannot occur: one is only ever created around a
 * point.
 */
export function track(recording: Recording): Track {
  return recording.segments;
}

/**
 * How long the walk was, in seconds — its first point to its last.
 *
 * Derived from the TRACK rather than from the recording's own clock, and that
 * is what lets the server compute it. The two are the same number by
 * construction — every kept fix becomes a point, and `t` counts from the first
 * of them — so deriving it from the track means the browser and the write path
 * cannot report different durations for one walk. The alternative was to send
 * the figure alongside the geometry, which is a second thing to trust from a
 * public endpoint and a second thing to keep in step.
 *
 * The span the receiver actually saw, and NOT the wall clock from the tap on
 * Record to the tap on Stop. Three things follow, and the third is why:
 *
 *   - A gap is included. Six minutes with the screen off is six minutes that
 *     passed on the walk, and the walker was walking through them. This is the
 *     one figure a gap does contribute to, which is worth stating beside
 *     `distanceMetres`, where it contributes nothing.
 *   - The minute spent indoors before the receiver settled is excluded, along
 *     with any fumbling after arriving home. Neither was walking.
 *   - There is no `now` in it. A draft recovered the next morning therefore
 *     reports the length of the WALK rather than the length of the
 *     interruption, and needs no staleness rule to avoid claiming a nine-hour
 *     outing.
 *
 * Zero for an empty track and for one with a single point — a position is an
 * instant, not a duration.
 */
export function trackSeconds(track: Track): number {
  let last = 0;

  for (const segment of track) {
    for (const point of segment) {
      if (point.t > last) last = point.t;
    }
  }

  return last;
}

/**
 * The duration as `workout_logs.duration_min` takes it, or null.
 *
 * Null rather than zero for anything under thirty seconds, and the column is
 * why it has to be: `parseDuration` refuses zero outright — *"a session that
 * took no time did not happen"* — so a recording that rounded to 0 would fail
 * the write rather than record a walk with fewer figures. The same shape
 * `storableRoute` gives `distanceM`, for the same reason, decided here so that
 * every caller inherits it rather than each remembering.
 */
export function trackMinutes(track: Track): number | null {
  const minutes = Math.round(trackSeconds(track) / 60);

  return minutes > 0 ? minutes : null;
}

/** The walk's span so far, for the readout on the row. */
export function elapsedSeconds(recording: Recording): number {
  return trackSeconds(track(recording));
}

/* -------------------------------------------------------------------------- */
/* Coming back from somewhere untrusted                                       */
/* -------------------------------------------------------------------------- */

/**
 * The most points a single recording may hand the write path.
 *
 * Not `MAX_ROUTE_POINTS`. That is the cap on what is STORED, after
 * `storableRoute` has thinned the geometry; this is the cap on what may be
 * SENT, before it. A 45-minute walk at one fix a second is about 2,700
 * positions, all of them real, and refusing them because five hundred is the
 * storage bound would be enforcing the wrong number in the wrong place.
 *
 * Ten thousand is a little under three hours at that rate — past any walk this
 * app is for, and past `WALK_PRESETS` by two orders of magnitude — while
 * keeping the request comfortably inside the 1MB a Server Action accepts by
 * default. The recorder thins its own track to this bound before sending, so a
 * genuinely enormous walk is shortened rather than refused; the check on the
 * far side is for a body that did not come from the recorder at all.
 */
export const MAX_RECORDED_POINTS = 10_000;

/** Whether a value is a `TrackPoint` and not merely shaped like one. */
function isPoint(value: unknown): value is TrackPoint {
  if (typeof value !== "object" || value === null) return false;

  const { lat, lng, t } = value as Record<string, unknown>;

  return (
    isReal(lat) &&
    isReal(lng) &&
    isReal(t) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    t >= 0
  );
}

/**
 * A track from a source that is not this module — or `undefined`.
 *
 * Two callers, and they are less different than they look: a Server Action,
 * where the body is whatever anyone chose to POST, and a `localStorage` draft,
 * where the JSON is whatever survived and whatever else was put there. Neither
 * has been checked by anything, and both are parsed here so there is one gate
 * rather than two that drift.
 *
 * ## What it refuses, and the order
 *
 * The point count is bounded BEFORE the points are walked, so a body claiming a
 * million positions is rejected by its length rather than by validating a
 * million objects — the check is cheap only if it comes first.
 *
 * Then every point: a real, finite, in-range coordinate with a non-negative
 * second. `t` monotonic within a segment is deliberately NOT required. It is
 * true of anything this recorder produces, but `distanceMetres` never reads
 * `t`, `trackSeconds` takes a maximum, and FUEL-102 draws in order — so a
 * shuffled track is ugly rather than dangerous, and a rule enforced here that
 * nothing downstream depends on is a rule that will be quietly wrong one day.
 *
 * Empty segments are dropped rather than refused. `trimEnds` already produces
 * them and `route.ts` already drops them; refusing one here would make a legal
 * intermediate shape illegal at the boundary.
 *
 * ## Holes are refused, and `every` is why this is written with an index
 *
 * A SPARSE array — `new Array(3)`, or one with a gap punched in it — has a
 * length but no elements at those positions, and both `every` and `map` SKIP
 * holes rather than visiting them. So `segment.every(isPoint)` returns true
 * for a segment containing no points at all, vacuously, and `map` then carries
 * the holes through untouched. What comes out is a "validated" track whose
 * points are `undefined`, which `for...of` in `distanceMetres` does NOT skip —
 * it yields them, and the first property read throws.
 *
 * A validator that passes by visiting nothing is the worst shape a check can
 * have, so the walk is by INDEX and a missing position is a refusal. Whether a
 * hole can survive the wire format is not the question: the cost of the check
 * is three lines, and the cost of being wrong about the serialiser is a gate
 * that reports CLEAN on input it never looked at.
 */
export function parseTrack(value: unknown): Track | undefined {
  if (!Array.isArray(value)) return undefined;

  let total = 0;

  for (const segment of value) {
    if (!Array.isArray(segment)) return undefined;

    total += segment.length;

    if (total > MAX_RECORDED_POINTS) return undefined;
  }

  const segments: TrackPoint[][] = [];

  for (const segment of value as unknown[][]) {
    if (segment.length === 0) continue;

    const points: TrackPoint[] = [];

    for (let index = 0; index < segment.length; index += 1) {
      // `in` rather than an undefined check: a hole and a stored `undefined`
      // are different things, and only the first is invisible to `every`.
      if (!(index in segment)) return undefined;

      const point: unknown = segment[index];

      if (!isPoint(point)) return undefined;

      points.push({ lat: point.lat, lng: point.lng, t: point.t });
    }

    segments.push(points);
  }

  return segments;
}

/**
 * An interrupted recording read back out of `localStorage` — or `undefined`.
 *
 * The draft is the whole of what survives an interruption, and it is stored
 * somewhere anyone with devtools can edit, that survives a deployment, and that
 * this app shares an origin with everything else it has ever stored. So it is
 * untrusted input, exactly as `rest-timer.ts` treats the instant it parses and
 * `cursor.ts` treats its cookie — and for a stronger reason here, since what is
 * restored is fed straight back into `appendFix`.
 *
 * ## `last` is the field that has to be checked
 *
 * It is tempting to restore the segments and drop `last`, since the points are
 * what gets drawn. It does not work: with `last` null the next fix is treated
 * as the walk's FIRST, which resets `startedAt` and throws away the origin every
 * `t` in the restored track is counted from. The resumed walk would then hold
 * two different time bases in one array.
 *
 * And it cannot be restored unchecked either. `metresBetween` on a `last` of
 * `{lat: undefined}` returns `NaN`, `NaN > MAX_SPEED_MPS` is **false**, and the
 * speed rule would accept every fix for the rest of the walk — a check that
 * silently passes rather than failing, which is the worst shape a check can
 * have. So `last` goes through the same gate a live reading does.
 *
 * ## The three fields agree, or there is no draft
 *
 * `startedAt`, `last` and a non-empty `segments` are created together by
 * `appendFix` and none is ever cleared, so a draft holding some but not others
 * did not come from this module. Refused whole rather than repaired: a repaired
 * draft is a walk with invented parts in it, and the honest answer to "this is
 * not a recording" is to offer the walk's ordinary one-tap log instead.
 */
export function parseRecording(value: unknown): Recording | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const { startedAt, segments, last, discarded } = value as Record<string, unknown>;

  const track = parseTrack(segments);

  if (!track) return undefined;

  // The empty draft — started, nothing kept. Nothing to resume and nothing to
  // save, so it is not a draft at all.
  if (track.length === 0) return undefined;

  if (!isReal(startedAt)) return undefined;

  if (typeof last !== "object" || last === null) return undefined;

  const fix = last as Fix;

  if (!isUsable(fix)) return undefined;

  // The last kept fix cannot predate the walk's own origin. `appendFix` can
  // never produce that, and a draft that holds it would resume computing
  // NEGATIVE seconds through `pointAt` — points that `parseTrack` then refuses
  // on the way to the server, so the walk would record fine and fail to save
  // with nothing on screen explaining which of the two was wrong.
  if (fix.at < startedAt) return undefined;

  return {
    startedAt,
    segments: track,
    last: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: fix.at },
    discarded: isReal(discarded) && discarded >= 0 ? discarded : 0,
  };
}
