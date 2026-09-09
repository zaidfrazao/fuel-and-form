import { describe, expect, it } from "vitest";

import {
  appendFix,
  elapsedSeconds,
  type Fix,
  MAX_ACCURACY_M,
  MAX_RECORDED_POINTS,
  MAX_SPEED_MPS,
  NOTHING_RECORDED,
  parseRecording,
  parseTrack,
  type Recording,
  SEGMENT_GAP_S,
  track,
  trackMinutes,
  trackSeconds,
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

describe("trackSeconds and trackMinutes", () => {
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
    // The same figure off the bare track, which is what the SERVER is handed —
    // the browser and the write path cannot report different durations for one
    // walk because there is only one derivation.
    expect(trackSeconds(track(walk))).toBe(380);
  });

  it("excludes the time before the receiver settled", () => {
    const walk = record(fix(0, 0, 0, MAX_ACCURACY_M + 1), fix(0, 0, 60_000), fix(50, 0, 120_000));

    expect(elapsedSeconds(walk)).toBe(60);
  });

  it("reports no duration rather than zero for a walk that never got going", () => {
    // `parseDuration` refuses zero — a session that took no time did not happen
    // — so a 20-second recording that rounded to 0 would fail the write instead
    // of recording a walk with fewer figures.
    expect(trackMinutes(track(record(fix(0, 0, 0), fix(10, 0, 20_000))))).toBeNull();
    expect(trackMinutes(track(NOTHING_RECORDED))).toBeNull();
  });

  it("rounds to the nearest minute", () => {
    expect(trackMinutes(track(record(fix(0, 0, 0), fix(100, 0, 100_000))))).toBe(2);
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

describe("parseTrack", () => {
  /** A well-formed segment of `count` points, as it would arrive over the wire. */
  const wire = (count: number) =>
    Array.from({ length: count }, (_value, index) => ({
      lat: 0,
      lng: index / METRES_PER_DEGREE,
      t: index,
    }));

  it("accepts what the recorder produces", () => {
    const walk = record(fix(0, 0, 0), fix(100, 0, 20_000), fix(600, 0, 380_000));

    expect(parseTrack(JSON.parse(JSON.stringify(track(walk))))).toEqual(track(walk));
  });

  it("refuses anything that is not an array of arrays", () => {
    for (const bad of [null, undefined, 0, "", {}, [null], [{}], [[1]], [["x"]]]) {
      expect(parseTrack(bad)).toBeUndefined();
    }
  });

  it("refuses a point that is not a position", () => {
    const bad = [
      [{ lat: 91, lng: 0, t: 0 }],
      [{ lat: 0, lng: 181, t: 0 }],
      [{ lat: 0, lng: 0, t: -1 }],
      [{ lat: Number.NaN, lng: 0, t: 0 }],
      [{ lat: 0, lng: 0 }],
    ];

    for (const segment of bad) {
      expect(parseTrack([segment])).toBeUndefined();
    }
  });

  it("bounds the point count across every segment, not within one", () => {
    // A body split into a thousand small segments is the same body. The bound
    // is on the total because the total is what gets walked, parsed and stored.
    expect(parseTrack([wire(MAX_RECORDED_POINTS)])).toHaveLength(1);
    expect(parseTrack([wire(MAX_RECORDED_POINTS + 1)])).toBeUndefined();
    expect(
      parseTrack([wire(MAX_RECORDED_POINTS), wire(1)]),
    ).toBeUndefined();
  });

  it("drops an empty segment rather than refusing the track", () => {
    // `trimEnds` produces these and `route.ts` already drops them. Refusing one
    // here would make a legal intermediate shape illegal at the boundary.
    expect(parseTrack([[], wire(2), []])).toEqual([wire(2)]);
  });

  it("refuses a segment with a HOLE in it", () => {
    /*
     * `Array.prototype.every` and `map` both SKIP holes rather than visiting
     * them, so `segment.every(isPoint)` passed vacuously for an array with a
     * length and no elements — and `map` then carried the holes straight
     * through. What came out was a "validated" track whose points were
     * `undefined`, which `for...of` in `distanceMetres` does not skip: it
     * yields them, and the first property read throws.
     *
     * A validator that passes by visiting nothing is the worst shape a check
     * can have, which is why this is asserted rather than left to the wire
     * format's good manners.
     */
    // eslint-disable-next-line @typescript-eslint/no-array-constructor -- a
    // sparse array is the subject of this test and there is no literal for one.
    expect(parseTrack([new Array(3)])).toBeUndefined();

    const punctured: unknown[] = [{ lat: 0, lng: 0, t: 0 }];

    punctured[2] = { lat: 0, lng: 0, t: 2 };

    expect(punctured).toHaveLength(3);
    expect(parseTrack([punctured])).toBeUndefined();
  });

  it("keeps only the three fields, so nothing else can ride along", () => {
    const smuggled = [[{ lat: 0, lng: 0, t: 0, accuracy: 5, note: "home" }]];

    expect(parseTrack(smuggled)).toEqual([[{ lat: 0, lng: 0, t: 0 }]]);
  });
});

describe("parseRecording", () => {
  const walk = record(fix(0, 0, 0), fix(100, 0, 20_000), fix(600, 0, 380_000));
  const stored = JSON.parse(JSON.stringify(walk)) as Record<string, unknown>;

  it("restores a draft this module wrote", () => {
    expect(parseRecording(stored)).toEqual(walk);
  });

  it("resumes on the SAME time base rather than starting a second walk", () => {
    // The reason `last` is restored at all. Dropped, the next fix would be
    // treated as the walk's first, `startedAt` would reset, and the restored
    // points would be counted from an origin that no longer exists.
    const resumed = parseRecording(stored);
    const continued = appendFix(resumed as Recording, fix(650, 0, 400_000));

    expect(continued.startedAt).toBe(walk.startedAt);
    expect(trackSeconds(track(continued))).toBe(400);
  });

  it("refuses a draft whose last fix is not a position", () => {
    // The check that would otherwise pass silently: `metresBetween` on a
    // nonsense `last` gives NaN, `NaN > MAX_SPEED_MPS` is false, and the speed
    // rule would accept every reading for the rest of the walk.
    for (const last of [null, {}, { lat: 0, lng: 0 }, { lat: 91, lng: 0, accuracy: 5, at: 1 }]) {
      expect(parseRecording({ ...stored, last })).toBeUndefined();
    }
  });

  it("refuses a draft whose fields disagree with each other", () => {
    expect(parseRecording({ ...stored, startedAt: null })).toBeUndefined();
    expect(parseRecording({ ...stored, startedAt: "soon" })).toBeUndefined();
    expect(parseRecording({ ...stored, segments: [] })).toBeUndefined();
    expect(parseRecording({ ...stored, segments: "walked" })).toBeUndefined();
  });

  it("refuses a draft whose last fix predates the walk's own origin", () => {
    // `appendFix` can never produce this. A hand-edited draft that holds it
    // would resume computing NEGATIVE seconds, and `parseTrack` then refuses
    // those on the way to the server — so the walk would record fine and fail
    // to save, with nothing on screen saying which half was wrong.
    expect(
      parseRecording({ ...stored, last: { ...(stored.last as object), at: 0 } }),
    ).toBeUndefined();
  });

  it("refuses what is not an object at all", () => {
    for (const bad of [null, undefined, 0, "", []]) {
      expect(parseRecording(bad)).toBeUndefined();
    }
  });

  it("repairs only the count it does not depend on", () => {
    // `discarded` is diagnostic and nothing reads it back, so a missing or
    // absurd one is zeroed rather than costing somebody their walk.
    expect(parseRecording({ ...stored, discarded: -1 })?.discarded).toBe(0);
    expect(parseRecording({ ...stored, discarded: undefined })?.discarded).toBe(0);
  });
});
