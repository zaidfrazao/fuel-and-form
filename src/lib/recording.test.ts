import { describe, expect, it } from "vitest";

import {
  appendFix,
  durationMinutes,
  elapsedSeconds,
  type Fix,
  MAX_ACCURACY_M,
  MAX_SPEED_MPS,
  NOTHING_RECORDED,
  type Recording,
  SEGMENT_GAP_S,
  track,
} from "./recording";
import { distanceMetres, EARTH_RADIUS_M } from "./route";

/**
 * FUEL-101 — the receiver's stream turned into a track.
 *
 * The ticket's own instruction: *"Distance derivation is pure and should be
 * tested as such — feed synthetic tracks with known geometry, including a gap,
 * a stationary cluster and a single wild outlier. That is where the real bugs
 * are, and it needs no browser."* Every case it names is below, plus the two
 * it does not: an outlier that poisons what follows it, and a run of refusals
 * that never recovers.
 *
 * ## Not one coordinate literal in this file
 *
 * `route.test.ts`'s rule, for PRD § P11's reason and enforced by the same
 * scan: the geometry is written in METRES from an origin of zero and projected
 * by `fix`. Every assertion here is about metres or seconds, which is what the
 * module is actually about.
 */

/** Degrees per metre at the equator, from the module's own radius. */
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * An arbitrary epoch instant to count from.
 *
 * Fixed rather than `Date.now()`: nothing in this module reads a clock, and a
 * test that supplied one would be a test that could pass for a reason it did
 * not state.
 */
const START = 1_700_000_000_000;

/**
 * A reading `east` and `north` metres from the origin, `after` ms into the walk.
 *
 * The origin is zero, where a degree of longitude is the same length as a
 * degree of latitude. Nowhere anybody walks, which is the point. The default
 * accuracy is a settled receiver, so a test that says nothing about accuracy is
 * a test about something else.
 */
const fix = (east: number, north: number, after: number, accuracy = 5): Fix => ({
  lat: north / METRES_PER_DEGREE,
  lng: east / METRES_PER_DEGREE,
  accuracy,
  at: START + after,
});

/** Folds a sequence of readings into a recording, in order. */
const record = (...fixes: readonly Fix[]): Recording =>
  fixes.reduce(appendFix, NOTHING_RECORDED);

/** Every point of every segment, flattened — for counting, never for distance. */
const points = (recording: Recording) => track(recording).flat();

describe("appendFix — what it refuses", () => {
  it("refuses a fix whose accuracy radius is wider than the threshold", () => {
    // The 300m outlier the ticket names: it adds 600m to a walk in one hop, and
    // it arrives labelled as a reading the receiver does not trust.
    const recording = record(fix(0, 0, 0, MAX_ACCURACY_M + 1));

    expect(points(recording)).toHaveLength(0);
    expect(recording.discarded).toBe(1);
    expect(recording.startedAt).toBeNull();
  });

  it("keeps a fix exactly at the threshold", () => {
    // The boundary is inclusive, and asserted rather than assumed: a `>=` here
    // would discard every fix from a receiver that reports a round 50, and the
    // symptom would be a feature that records nothing on one particular phone.
    expect(points(record(fix(0, 0, 0, MAX_ACCURACY_M)))).toHaveLength(1);
  });

  it("refuses a position that is not a position", () => {
    // These do not come from `watchPosition`. They come from `localStorage`,
    // where a resumed draft can hold anything at all, and it is parsed by this
    // same reducer — so this is the gate for both.
    const nonsense: Fix[] = [
      { lat: Number.NaN, lng: 0, accuracy: 5, at: START },
      { lat: 0, lng: Number.POSITIVE_INFINITY, accuracy: 5, at: START },
      { lat: 91, lng: 0, accuracy: 5, at: START },
      { lat: 0, lng: 181, accuracy: 5, at: START },
      { lat: 0, lng: 0, accuracy: -1, at: START },
      { lat: 0, lng: 0, accuracy: 5, at: Number.NaN },
    ];

    for (const bad of nonsense) {
      expect(points(record(bad))).toHaveLength(0);
    }
  });

  it("refuses a jump no walker could have made", () => {
    // A second apart and far enough to imply a sprint: a bad fix, not a sprint.
    const fast = record(fix(0, 0, 0), fix(MAX_SPEED_MPS + 2, 0, 1000));

    expect(points(fast)).toHaveLength(1);
    expect(fast.discarded).toBe(1);

    // And the control, one metre per second under the line, so the assertion
    // above is about the threshold rather than about the second fix existing.
    expect(points(record(fix(0, 0, 0), fix(MAX_SPEED_MPS - 1, 0, 1000)))).toHaveLength(
      2,
    );
  });

  it("refuses a reading that arrives out of order or twice", () => {
    // Two readings at one instant imply an infinite speed if they differ at
    // all, and one out of order would give a `t` that goes backwards in a track
    // every consumer reads as increasing.
    const repeated = record(fix(0, 0, 1000), fix(5, 0, 1000), fix(5, 0, 0));

    expect(points(repeated)).toHaveLength(1);
    expect(repeated.discarded).toBe(2);
  });
});

describe("appendFix — the bugs a refusal causes", () => {
  it("does not let one wild outlier poison the fixes after it", () => {
    // The bug this guards: if a DISCARDED fix became `last`, every good reading
    // afterwards would be measured against a position the walker was never at,
    // and the whole rest of the walk would be silently refused. The recording
    // would still be running and the screen would still say so.
    const walk = record(
      fix(0, 0, 0),
      fix(5, 0, 1000),
      fix(5000, 0, 2000), // the outlier
      fix(10, 0, 3000),
      fix(15, 0, 4000),
    );

    expect(points(walk)).toHaveLength(4);
    expect(walk.discarded).toBe(1);
    // 15m of real walking, and not a metre of the outlier.
    expect(distanceMetres(track(walk))).toBeCloseTo(15, 3);
  });

  it("recovers from a sustained run of refusals once the gap threshold passes", () => {
    // The other half of the same problem, and the reason a gap is accepted
    // without a speed check. A `last` that goes stale would otherwise reject
    // every reading forever; instead it ages past `SEGMENT_GAP_S` and the next
    // fix starts a fresh segment.
    const refused = Array.from({ length: 10 }, (_value, index) =>
      fix(5000, 0, (index + 1) * 1000),
    );

    const walk = record(
      fix(0, 0, 0),
      ...refused,
      fix(5000, 0, (SEGMENT_GAP_S + 1) * 1000),
    );

    expect(walk.discarded).toBe(10);
    expect(track(walk)).toHaveLength(2);
    expect(points(walk)).toHaveLength(2);
  });

  it("judges accuracy before speed, so a wide fix is refused for being wide", () => {
    // Both rules refuse the 300m outlier and the order decides which one gets
    // the blame. It is not cosmetic: the thresholds are judgement calls that a
    // real walk is expected to move, and moving the wrong one moves nothing.
    const wideAndFar = record(fix(0, 0, 0), fix(5000, 0, 1000, MAX_ACCURACY_M + 1));

    expect(wideAndFar.discarded).toBe(1);
    // `last` is untouched by either refusal, so the next good fix still lands.
    expect(points(record(fix(0, 0, 0), fix(5000, 0, 1000, MAX_ACCURACY_M + 1), fix(5, 0, 2000)))).toHaveLength(2);
  });
});

describe("appendFix — segments", () => {
  it("starts the walk at the first kept fix, not at the first fix offered", () => {
    // A recording started indoors runs for a minute with everything refused.
    // The origin has to be the first reading that survived, because `route.ts`
    // defines `t` as seconds from the first fix of the WALK.
    const walk = record(fix(0, 0, 0, MAX_ACCURACY_M + 1), fix(0, 0, 5000), fix(10, 0, 7000));

    expect(walk.startedAt).toBe(START + 5000);
    expect(points(walk).map((point) => point.t)).toEqual([0, 2]);
  });

  it("opens a new segment after a gap and keeps the old one closed", () => {
    const walk = record(
      fix(0, 0, 0),
      fix(100, 0, 20_000),
      // Six minutes with the screen off, and 500m the app never saw.
      fix(600, 0, 380_000),
      fix(700, 0, 400_000),
    );

    expect(track(walk)).toHaveLength(2);
    expect(track(walk)[0]).toHaveLength(2);
    expect(track(walk)[1]).toHaveLength(2);
  });

  it("excludes the gap from the distance end to end", () => {
    // FUEL-101's headline failure, proven through THIS module rather than only
    // through `route.ts`'s arithmetic. `distanceMetres` sums within segments,
    // so the whole question is whether the reducer put the hole on a segment
    // boundary — which is what `SEGMENT_GAP_S` decides and nothing else does.
    const walk = record(
      fix(0, 0, 0),
      fix(100, 0, 20_000),
      fix(600, 0, 380_000),
      fix(700, 0, 400_000),
    );

    expect(distanceMetres(track(walk))).toBeCloseTo(200, 3);

    // The negative control: the SAME 700m, walked with the app watching all of
    // it — a fix every 100m at a believable pace, so nothing is ever more than
    // `SEGMENT_GAP_S` apart. One segment, and the full distance. Without this
    // the assertion above would pass on a reducer that simply lost the second
    // half of every walk.
    const continuous = record(
      ...Array.from({ length: 8 }, (_value, index) =>
        fix(index * 100, 0, index * 20_000),
      ),
    );

    expect(track(continuous)).toHaveLength(1);
    expect(distanceMetres(track(continuous))).toBeCloseTo(700, 3);
  });

  it("holds a stationary cluster in one segment and measures nothing", () => {
    // Standing at a crossing. The fixes keep arriving, they are all believable,
    // and none of them is movement. Nothing here should split a segment.
    const waiting = record(
      ...Array.from({ length: 20 }, (_value, index) => fix(0, 0, index * 1000)),
    );

    expect(track(waiting)).toHaveLength(1);
    expect(points(waiting)).toHaveLength(20);
    expect(distanceMetres(track(waiting))).toBeCloseTo(0, 6);
  });
});

describe("elapsedSeconds and durationMinutes", () => {
  it("is zero for a recording with nothing in it, and for a single fix", () => {
    // A position is an instant, not a duration.
    expect(elapsedSeconds(NOTHING_RECORDED)).toBe(0);
    expect(elapsedSeconds(record(fix(0, 0, 0)))).toBe(0);
  });

  it("measures the first kept fix to the last, and counts the gap", () => {
    // The one figure a gap DOES contribute to: six minutes with the screen off
    // is six minutes that passed on the walk. Stated here beside the distance
    // test above, where the same gap contributes nothing.
    const walk = record(fix(0, 0, 0), fix(100, 0, 20_000), fix(600, 0, 380_000));

    expect(elapsedSeconds(walk)).toBe(380);
  });

  it("excludes the time before the receiver settled", () => {
    const walk = record(fix(0, 0, 0, MAX_ACCURACY_M + 1), fix(0, 0, 60_000), fix(50, 0, 120_000));

    expect(elapsedSeconds(walk)).toBe(60);
  });

  it("reports no duration rather than zero for a walk that never got going", () => {
    // `parseDuration` refuses zero — a session that took no time did not happen
    // — so a 20-second recording that rounded to 0 would fail the write instead
    // of recording a walk with fewer figures.
    expect(durationMinutes(record(fix(0, 0, 0), fix(10, 0, 20_000)))).toBeNull();
    expect(durationMinutes(NOTHING_RECORDED)).toBeNull();
  });

  it("rounds to the nearest minute", () => {
    expect(durationMinutes(record(fix(0, 0, 0), fix(100, 0, 100_000)))).toBe(2);
  });
});

describe("the draft that survives an interruption", () => {
  it("round-trips through JSON unchanged", () => {
    // This is what `localStorage` holds, and it is the whole resumability
    // story: a field that did not survive this would be a field that is correct
    // until the moment the feature is actually needed. A `Date` or a `Map` here
    // would pass every other test in this file.
    const walk = record(fix(0, 0, 0), fix(100, 0, 20_000), fix(600, 0, 380_000));
    const resumed = JSON.parse(JSON.stringify(walk)) as Recording;

    expect(resumed).toEqual(walk);
    // And it is still a recording afterwards: appending to the restored draft
    // continues the same walk rather than starting a second one.
    const continued = appendFix(resumed, fix(650, 0, 400_000));

    expect(continued.startedAt).toBe(walk.startedAt);
    expect(distanceMetres(track(continued))).toBeCloseTo(150, 3);
  });
});
