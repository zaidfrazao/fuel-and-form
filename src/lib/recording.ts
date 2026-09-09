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
 * How long the walk was, in seconds — first kept fix to last kept fix.
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
 *   - It is a pure function of the state, with no `now` in it. A draft
 *     recovered the next morning therefore reports the length of the WALK
 *     rather than the length of the interruption, and needs no staleness rule
 *     to avoid claiming a nine-hour outing.
 *
 * Zero for a recording with no fixes and for one with exactly one — a single
 * position is an instant, not a duration.
 */
export function elapsedSeconds(recording: Recording): number {
  const { startedAt, last } = recording;

  if (startedAt === null || last === null) return 0;

  return Math.max(0, Math.round((last.at - startedAt) / 1000));
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
export function durationMinutes(recording: Recording): number | null {
  const minutes = Math.round(elapsedSeconds(recording) / 60);

  return minutes > 0 ? minutes : null;
}
