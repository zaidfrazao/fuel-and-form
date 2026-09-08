import { describe, expect, it } from "vitest";

import {
  COORD_DECIMALS,
  countPoints,
  distanceMetres,
  EARTH_RADIUS_M,
  MAX_ROUTE_POINTS,
  metresBetween,
  reducePrecision,
  reduceTrackPrecision,
  simplifyToCap,
  storableRoute,
  type Track,
  type TrackPoint,
  TRIM_METRES,
  trimEnds,
} from "./route";

/**
 * FUEL-100 — what a recorded route gives up before it is stored.
 *
 * Gated at 100% in vitest.config.mts, and these tests are shaped around the
 * reason given there: every rule in this module fails by STORING something,
 * and a coordinate stored at full precision cannot be un-stored. Nothing here
 * throws, and none of it is visible in a diff.
 *
 * ## Not one coordinate literal in this file
 *
 * PRD § P11: no coordinate reaches a seed, a fixture, a test or the
 * repository, and `scripts/check-no-metrics.sh` enforces it over this file
 * like any other. So the geometry is written in METRES from an origin of zero
 * and projected by `at`, which is the clearer way round in any case: every
 * assertion below is about metres, and a test that says `at(300, 0)` states
 * its own intent in a way a latitude never could.
 */

/** Degrees per metre at the equator, from the module's own radius. */
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * A fix `east` and `north` metres from the origin, at second `t`.
 *
 * The origin is zero, where a degree of longitude is the same length as a
 * degree of latitude, so the projection is a division and the geometry in a
 * test reads as the shape it is. Nowhere anybody walks, which is the point.
 */
const at = (east: number, north: number, t = 0): TrackPoint => ({
  lat: north / METRES_PER_DEGREE,
  lng: east / METRES_PER_DEGREE,
  t,
});

/** A straight run east, one fix per `spacing` metres. */
const straightLine = (points: number, spacing = 10): TrackPoint[] =>
  Array.from({ length: points }, (_value, index) =>
    at(index * spacing, 0, index),
  );

describe("metresBetween", () => {
  it("measures a degree of latitude at about 111 km", () => {
    // The one assertion that pins the absolute scale rather than trusting the
    // projection `at` shares with the implementation. Without it every other
    // distance in this file would agree with a wrong earth radius.
    expect(metresBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      111_195,
      0,
    );
  });

  it("is zero for a position and itself", () => {
    expect(metresBetween(at(120, 40), at(120, 40))).toBe(0);
  });

  it("keeps its precision over the few metres between consecutive fixes", () => {
    // The reason this is haversine and not the spherical law of cosines: at a
    // walking pace fixes arrive about a metre apart, and the law of cosines
    // loses its significant digits entirely at that separation. The failure
    // mode is a distance that reads zero for a slow walk.
    expect(metresBetween(at(0, 0), at(1, 0))).toBeCloseTo(1, 3);
  });
});

describe("distanceMetres", () => {
  it("sums the fixes along a segment", () => {
    expect(distanceMetres([straightLine(4, 25)])).toBeCloseTo(75, 3);
  });

  it("is zero for an empty track and for a single fix", () => {
    expect(distanceMetres([])).toBe(0);
    expect(distanceMetres([[at(0, 0)]])).toBe(0);
  });

  it("adds nothing for the gap between two segments", () => {
    // FUEL-101's headline failure, made structurally impossible here: the
    // screen was off for six minutes and the walker covered 500m the app never
    // saw. The distance is the two segments and NOT the chord across the hole
    // — that is how a 3km walk becomes 5km.
    const before: TrackPoint[] = [at(0, 0, 0), at(100, 0, 100)];
    const after: TrackPoint[] = [at(600, 0, 460), at(700, 0, 560)];

    expect(distanceMetres([before, after])).toBeCloseTo(200, 3);
    // And the proof that the gap is what was excluded rather than the second
    // segment: joined into one segment, the chord is counted.
    expect(distanceMetres([[...before, ...after]])).toBeCloseTo(700, 3);
  });
});

describe("reducePrecision", () => {
  it("keeps five decimal places", () => {
    const reduced = reducePrecision({ lat: 1 / 3, lng: -1 / 7 });

    expect(reduced.lat).toBeCloseTo(0.33333, 10);
    expect(reduced.lng).toBeCloseTo(-0.14286, 10);
  });

  it("drops everything past the fifth place, in both directions", () => {
    // The privacy property stated as an assertion rather than as a comment:
    // whatever arrives, what is stored has no sixth decimal. Asserted through
    // the exported constant so the two cannot drift.
    const factor = 10 ** COORD_DECIMALS;
    for (const value of [1 / 3, -1 / 3, 2 / 7, -123.456789, 0.000_004]) {
      const { lat } = reducePrecision({ lat: value, lng: 0 });
      expect(Math.abs(lat * factor - Math.round(lat * factor))).toBeLessThan(1e-6);
    }
  });

  it("rounds rather than truncating toward zero", () => {
    // The bias argument in the module. `Math.trunc` on a value a hair below
    // its own fifth decimal drops a whole unit in the last place — a metre,
    // biased consistently south and west, five hundred times per walk.
    const justUnder = 0.099_999_999;
    expect(reducePrecision({ lat: justUnder, lng: 0 }).lat).toBeCloseTo(0.1, 10);
  });
});

describe("reduceTrackPrecision", () => {
  it("collapses a stationary stretch to one point", () => {
    // A minute standing still is the same position sixty times over once the
    // decimals are gone. Those points draw nothing and count against the cap.
    const jitter = Array.from({ length: 60 }, (_value, index) =>
      at(0.001 * index, 0.001 * index, index),
    );

    expect(countPoints(reduceTrackPrecision([jitter]))).toBe(1);
  });

  it("keeps the first arrival's second, not the last", () => {
    const stationary = [at(0, 0, 10), at(0, 0, 11), at(0, 0, 12)];
    const [segment = []] = reduceTrackPrecision([stationary]);

    expect(segment.at(0)?.t).toBe(10);
  });

  it("keeps a position the walk genuinely returns to", () => {
    // Consecutive duplicates only. A loop that comes back to where it started
    // was there twice, and a loop is the commonest shape a daily walk has.
    const loop = [at(0, 0, 0), at(50, 0, 30), at(50, 50, 60), at(0, 0, 120)];

    expect(countPoints(reduceTrackPrecision([loop]))).toBe(4);
  });

  it("drops a segment that had nothing in it", () => {
    expect(reduceTrackPrecision([[], [at(0, 0), at(90, 0)]])).toHaveLength(1);
  });
});

describe("trimEnds", () => {
  it("removes the first and last stretch of the walk", () => {
    // 60 fixes ten metres apart is a 590m line. Trimming 150m from each end
    // leaves the middle, and the surviving ends are at least that far in.
    const trimmed = trimEnds([straightLine(60)], 150);
    const [segment = []] = trimmed;
    const first = segment.at(0);
    const last = segment.at(-1);

    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;

    expect(metresBetween(at(0, 0), first)).toBeGreaterThanOrEqual(150);
    expect(metresBetween(at(590, 0), last)).toBeGreaterThanOrEqual(150);
  });

  it("cuts on a real fix rather than interpolating one", () => {
    // Every surviving point is one that was recorded. A trim that interpolated
    // would put a position nobody was ever at into a table whose entire
    // purpose is holding positions people were at.
    const original = straightLine(60);
    const [segment = []] = trimEnds([original], 150);

    for (const point of segment) {
      expect(original).toContainEqual(point);
    }
  });

  it("spends the budget across a gap into the next segment", () => {
    // The case a phone that loses its fix on the doorstep produces every
    // time: the first segment is shorter than the trim, so the rest of the
    // budget has to come out of the second one. The gap itself pays nothing.
    const doorstep = straightLine(6); // 50m
    const rest = Array.from({ length: 60 }, (_value, index) =>
      at(200 + index * 10, 0, 100 + index),
    );

    const trimmed = trimEnds([doorstep, rest], 150);

    expect(trimmed).toHaveLength(1);
    const [segment = []] = trimmed;
    // 100m of the budget remained when the second segment began, so it starts
    // at least that far along it — and NOT 150m along it, which is what would
    // happen if the budget had reset at the segment boundary.
    const first = segment.at(0);
    if (first === undefined) throw new Error("expected a surviving fix");
    expect(metresBetween(at(200, 0), first)).toBeGreaterThanOrEqual(100);
    expect(metresBetween(at(200, 0), first)).toBeLessThan(150);
  });

  it("leaves the segments after the cut untouched", () => {
    // A walk that lost its fix twice. The budget is spent inside the first
    // segment, so the two after it survive whole — they are the middle of the
    // walk and the trim has no further claim on them.
    const start = straightLine(60); // 590m, more than the trim on its own
    const middle: TrackPoint[] = [at(900, 0, 200), at(1_000, 0, 260)];
    const end: TrackPoint[] = [at(1_400, 0, 400), at(1_900, 0, 700)];

    const trimmed = trimEnds([start, middle, end], 150);

    expect(trimmed).toHaveLength(3);
    expect(trimmed.at(1)).toEqual(middle);
  });

  it("leaves nothing of a walk shorter than twice the trim", () => {
    // Under 300m there is no middle: everything recorded is doorstep at one
    // end or the other, and the honest answer is no trace at all.
    expect(trimEnds([straightLine(20)], 150)).toEqual([]);
  });

  it("returns the track untouched when asked for no trim", () => {
    const track = [straightLine(4)];
    expect(trimEnds(track, 0)).toBe(track);
  });

  it("defaults to the documented trim", () => {
    expect(trimEnds([straightLine(20)])).toEqual(trimEnds([straightLine(20)], TRIM_METRES));
  });
});

describe("simplifyToCap", () => {
  it("reduces a straight run to its two ends", () => {
    // The whole argument for shape-preserving simplification: a walk down a
    // long straight road needs two points to draw, however long it took.
    expect(simplifyToCap([straightLine(200)])).toEqual([
      [expect.objectContaining({ t: 0 }), expect.objectContaining({ t: 199 })],
    ]);
  });

  it("keeps a corner that dropping every other point would round off", () => {
    // Stated against the alternative the ticket rejects. A right angle built
    // from a dense run of fixes has exactly one point that matters, and it is
    // the one an every-other-point decimation has a 50% chance of discarding.
    const east = Array.from({ length: 40 }, (_value, index) => at(index * 5, 0, index));
    const north = Array.from({ length: 40 }, (_value, index) =>
      at(195, index * 5, 40 + index),
    );

    const [simplified = []] = simplifyToCap([[...east, ...north]]);

    expect(simplified).toHaveLength(3);
    expect(simplified.at(1)).toEqual(at(195, 0, 39));
  });

  it("holds a dense track under the cap", () => {
    // A jittering receiver left running: 4,000 fixes wandering around a
    // square, which no epsilon at the starting value would thin far enough.
    const noisy = Array.from({ length: 4_000 }, (_value, index) =>
      at(index * 3, (index % 7) * 40, index),
    );

    expect(countPoints(simplifyToCap([noisy]))).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
  });

  it("drops the shortest segments when there are too many to thin", () => {
    // RDP never drops an endpoint, so a track with more segments than half the
    // cap cannot fit by simplification at all — a recording that lost its fix
    // hundreds of times. The stretches that go are the ones carrying the least
    // shape per point.
    const long: TrackPoint[] = [at(0, 0, 0), at(500, 0, 100)];
    const alsoLong: TrackPoint[] = [at(0, 100, 200), at(500, 100, 300)];
    const stub: TrackPoint[] = [at(0, 200, 400), at(2, 200, 401)];
    const alsoStub: TrackPoint[] = [at(0, 300, 500), at(2, 300, 501)];

    const kept = simplifyToCap([long, stub, alsoLong, alsoStub], 4);

    expect(kept).toEqual([long, alsoLong]);
  });

  it("simplifies a loop that ends where it started", () => {
    // The commonest shape a daily walk has, and the one that divides by zero
    // without a guard: RDP's first span runs from the first fix to the last,
    // and here they are the same position, so the line they define has no
    // length and no direction. Every corner must still survive.
    const loop: TrackPoint[] = [
      at(0, 0, 0),
      at(100, 0, 60),
      at(100, 100, 120),
      at(0, 100, 180),
      at(0, 0, 240),
    ];

    const [simplified = []] = simplifyToCap([loop]);

    expect(simplified).toEqual(loop);
    for (const point of simplified) {
      expect(Number.isFinite(point.lat)).toBe(true);
    }
  });

  it("leaves an empty segment alone", () => {
    expect(simplifyToCap([[]])).toEqual([[]]);
  });

  it("leaves a two-point segment alone", () => {
    const pair: TrackPoint[] = [at(0, 0, 0), at(400, 0, 90)];
    expect(simplifyToCap([pair])).toEqual([pair]);
  });
});

describe("storableRoute", () => {
  /** A 60-fix line, ten metres apart: 590m of walking. */
  const walk: Track = [straightLine(60)];

  it("measures the FULL walk and stores the TRIMMED trace", () => {
    // The one place the two figures disagree, and it is deliberate. Distance
    // is a measured quantity that reaches the export, the energy estimate and
    // the step estimate; shortening it by 300m every walk to protect a
    // coordinate the trim has already removed would corrupt a real
    // measurement for nothing.
    const stored = storableRoute(walk);

    expect(stored.distanceM).toBe(590);
    expect(distanceMetres(stored.points)).toBeLessThan(stored.distanceM);
  });

  it("rounds the distance to the metre", () => {
    expect(Number.isInteger(storableRoute(walk).distanceM)).toBe(true);
  });

  it("stores no points at all for a walk that is all doorstep", () => {
    const stored = storableRoute([straightLine(20)]);

    // The distance survives — the walk happened and is worth counting — and
    // there is simply no trace. `walk_routes` gets no row; the walk reads as
    // one recorded without GPS, which § P11 already requires to render.
    expect(stored.points).toEqual([]);
    expect(stored.pointCount).toBe(0);
    expect(stored.distanceM).toBe(190);
  });

  it("counts the points it actually stored", () => {
    const stored = storableRoute(walk);

    expect(stored.pointCount).toBe(countPoints(stored.points));
  });

  it("stores nothing past the fifth decimal place", () => {
    const factor = 10 ** COORD_DECIMALS;
    const stored = storableRoute([
      Array.from({ length: 200 }, (_value, index) =>
        at(index * 5 + 1 / 3, (index % 5) / 7, index),
      ),
    ]);

    expect(stored.pointCount).toBeGreaterThan(0);
    for (const segment of stored.points) {
      for (const point of segment) {
        expect(Math.abs(point.lat * factor - Math.round(point.lat * factor))).toBeLessThan(1e-6);
        expect(Math.abs(point.lng * factor - Math.round(point.lng * factor))).toBeLessThan(1e-6);
      }
    }
  });

  it("holds any track under the cap", () => {
    const noisy: Track = [
      Array.from({ length: 5_000 }, (_value, index) =>
        at(index * 2, (index % 11) * 30, index),
      ),
    ];

    expect(storableRoute(noisy).pointCount).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
  });

  it("takes an explicit cap and trim", () => {
    const stored = storableRoute(walk, { cap: 4, trimMetres: 0 });

    expect(stored.pointCount).toBeLessThanOrEqual(4);
    // Nothing trimmed, so the trace runs the whole length of the walk.
    expect(distanceMetres(stored.points)).toBeCloseTo(stored.distanceM, 0);
  });
});
