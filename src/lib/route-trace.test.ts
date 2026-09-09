import { describe, expect, it } from "vitest";

import { EARTH_RADIUS_M, type Track, type TrackPoint, TRIM_METRES } from "@/lib/route";
import {
  absences,
  drawnSegments,
  gapMinutes,
  gapSeconds,
  geoUri,
  kilometres,
  pace,
  LOOP_MAX_FRACTION,
  LOOP_TOLERANCE_M,
  percent,
  shapeWord,
  startCoordinate,
  summarise,
  TRACE_PADDING,
  TRACE_VIEW_HEIGHT,
  TRACE_VIEW_WIDTH,
  traceGeometry,
} from "@/lib/route-trace";

/**
 * Tracks are built from METRE OFFSETS and never from coordinate literals.
 *
 * `route.test.ts` established the shape and the reason is the same one, plus a
 * sharper one for this file. PRD § P11 requires that no coordinate reaches a
 * seed, a fixture, a test or the repository, and `check-no-metrics.sh` exists to
 * catch one — a test file full of plausible positions would be the exact leak
 * the scan was written for, sitting in the repository that made the scan
 * necessary. Offsets in metres describe the SHAPE, which is the only thing any
 * assertion here is about.
 */
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * A latitude away from the equator, and the whole point of choosing one.
 *
 * `route.test.ts` builds at the equator, where a degree of longitude and a
 * degree of latitude are the same distance and a missing projection is
 * invisible. Every fit assertion below would pass on raw degrees there. Fifty-one
 * degrees is a latitude rather than a place — nothing here is anywhere — and
 * `cos(51°)` is about 0.629, so an unprojected fit draws every east-west span
 * about 1.59 times too wide and the squareness test catches it.
 */
const TEST_LATITUDE = 51;
const COS_TEST_LATITUDE = Math.cos((TEST_LATITUDE * Math.PI) / 180);

/** A point `east` and `north` of the test origin, in metres. */
const at = (east: number, north: number, t = 0): TrackPoint => ({
  lat: TEST_LATITUDE + north / METRES_PER_DEGREE,
  lng: east / (METRES_PER_DEGREE * COS_TEST_LATITUDE),
  t,
});

/** The drawn extent of a fitted geometry, read back off its polylines. */
function extent(segments: string[]): { width: number; height: number } {
  const pairs = segments
    .flatMap((segment) => segment.split(" "))
    .map((pair) => pair.split(",").map(Number));
  const xs = pairs.map(([x]) => x ?? 0);
  const ys = pairs.map(([, y]) => y ?? 0);

  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

describe("traceGeometry", () => {
  /**
   * The test the projection exists for, and the one that fails without it.
   *
   * A square walked on the ground must draw square. Fitting raw lat/lng would
   * draw it 1.59 times wider than tall at this latitude — a rectangle, silently,
   * with nothing on screen to say the shape had been changed. § The Route Trace:
   * "a route stretched to a box is a different shape, and shape is the only
   * thing a trace carries".
   */
  it("draws a square walk square, rather than stretched by the latitude", () => {
    const side = 400;
    const square: Track = [
      [at(0, 0, 0), at(side, 0, 100), at(side, side, 200), at(0, side, 300), at(0, 0, 400)],
    ];

    const fitted = traceGeometry(square);
    const drawn = extent(fitted!.segments);

    expect(drawn.width).toBeCloseTo(drawn.height, 1);
  });

  it("scales isotropically, so the same shape at two sizes draws identically", () => {
    const shape = (size: number): Track => [
      [at(0, 0, 0), at(size, 0, 60), at(size, size / 2, 120), at(0, 0, 240)],
    ];

    const small = traceGeometry(shape(500));
    const large = traceGeometry(shape(6000));

    // Not "similar" — the same string. Each walk is fitted to the box on its
    // own, so a walk twelve times longer of the same shape IS the same drawing.
    // The figure beneath carries the size, which is the rule this asserts.
    expect(large!.segments).toEqual(small!.segments);
  });

  it("fills the governing axis to the padding and centres the other", () => {
    // Wider than 3:2, so width governs and height is left with slack.
    const wide: Track = [[at(0, 0, 0), at(1000, 0, 300), at(1000, 100, 400)]];

    const fitted = traceGeometry(wide);
    const drawn = extent(fitted!.segments);

    expect(drawn.width).toBeCloseTo(TRACE_VIEW_WIDTH - 2 * TRACE_PADDING, 1);
    expect(drawn.height).toBeLessThan(TRACE_VIEW_HEIGHT - 2 * TRACE_PADDING);

    const pairs = fitted!.segments[0]!.split(" ").map((pair) => pair.split(",").map(Number));
    const ys = pairs.map(([, y]) => y ?? 0);

    // Centred: the slack above equals the slack below.
    expect(Math.min(...ys)).toBeCloseTo(TRACE_VIEW_HEIGHT - Math.max(...ys), 1);
  });

  it("draws a walk due north, where one axis has no extent at all", () => {
    const northward: Track = [[at(0, 0, 0), at(0, 500, 300)]];

    const fitted = traceGeometry(northward);
    const drawn = extent(fitted!.segments);

    // Height governs; the line stands in the middle of an empty width rather
    // than dividing by a zero span.
    expect(drawn.height).toBeCloseTo(TRACE_VIEW_HEIGHT - 2 * TRACE_PADDING, 1);
    expect(drawn.width).toBeCloseTo(0, 5);
    expect(fitted!.start.x).toBeCloseTo(TRACE_VIEW_WIDTH / 2, 1);
  });

  it("draws two points as a line rather than as a broken box", () => {
    const twoPoints: Track = [[at(0, 0, 0), at(300, 200, 240)]];

    const fitted = traceGeometry(twoPoints);

    expect(fitted!.segments).toHaveLength(1);
    expect(fitted!.segments[0]!.split(" ")).toHaveLength(2);
    // The marks are the two ends, not one end and a default.
    expect(fitted!.start).not.toEqual(fitted!.end);
  });

  it("centres a walk that never moved, instead of dividing by a zero span", () => {
    const stationary: Track = [[at(0, 0, 0), at(0, 0, 60), at(0, 0, 120)]];

    const fitted = traceGeometry(stationary);

    for (const mark of [fitted!.start, fitted!.end]) {
      expect(mark.x).toBeCloseTo(TRACE_VIEW_WIDTH / 2, 5);
      expect(mark.y).toBeCloseTo(TRACE_VIEW_HEIGHT / 2, 5);
    }

    expect(Number.isFinite(fitted!.start.x)).toBe(true);
  });

  it("gives one point a place rather than a NaN", () => {
    const single: Track = [[at(0, 0, 0)]];

    const fitted = traceGeometry(single);

    // No polyline — a line needs two ends — and both marks land in the middle.
    expect(fitted!.segments).toEqual([]);
    expect(fitted!.start).toEqual({ x: TRACE_VIEW_WIDTH / 2, y: TRACE_VIEW_HEIGHT / 2 });
  });

  it("is null where there is no route, so nothing draws and nothing opens", () => {
    expect(traceGeometry([])).toBeNull();
    expect(traceGeometry([[]])).toBeNull();
  });

  /**
   * § The Route Trace: "A gap — nothing at all. Each segment is its own
   * polyline." A dashed connector was the obvious alternative and is refused,
   * because "it would draw a path nobody walked, which is the one thing this
   * graphic must not do."
   */
  it("draws a gap as two polylines and never as a chord between them", () => {
    const withGap: Track = [
      [at(0, 0, 0), at(200, 0, 120)],
      [at(900, 400, 480), at(1100, 400, 600)],
    ];

    const fitted = traceGeometry(withGap);

    // Two `points` attributes, and each holds exactly its own segment's fixes:
    // no polyline spans the hole, and no connecting point was invented to carry
    // one across. Counting is what proves the absence — a chord would show up
    // as a third segment or as a fifth point in one of these two.
    expect(fitted!.segments).toHaveLength(2);
    expect(fitted!.segments.map((segment) => segment.split(" ").length)).toEqual([2, 2]);

    const [first, second] = fitted!.segments;

    expect(first).not.toContain(second!.split(" ")[0]!);
    expect(second).not.toContain(first!.split(" ").at(-1)!);
  });

  it("both segments share one fit, so the gap keeps its real proportion", () => {
    const withGap: Track = [
      [at(0, 0, 0), at(100, 0, 60)],
      [at(900, 0, 600), at(1000, 0, 660)],
    ];

    const fitted = traceGeometry(withGap);
    const first = fitted!.segments[0]!.split(" ").map((p) => Number(p.split(",")[0]));
    const second = fitted!.segments[1]!.split(" ").map((p) => Number(p.split(",")[0]));

    // Each drawn segment is a tenth of the whole span, and the hole between
    // them is eight tenths — the shape of the walk, not two segments each
    // fitted to the box.
    const span = TRACE_VIEW_WIDTH - 2 * TRACE_PADDING;

    expect(Math.max(...first) - Math.min(...first)).toBeCloseTo(span * 0.1, 1);
    expect(Math.min(...second) - Math.max(...first)).toBeCloseTo(span * 0.8, 1);
  });

  it("drops a one-point segment rather than emitting an empty polyline", () => {
    const stray: Track = [
      [at(0, 0, 0), at(400, 0, 240)],
      [at(800, 0, 900)],
    ];

    expect(traceGeometry(stray)!.segments).toHaveLength(1);
    expect(drawnSegments(stray)).toBe(1);
  });

  it("marks the first and last stored fix, across segments", () => {
    const withGap: Track = [
      [at(0, 0, 0), at(100, 100, 60)],
      [at(400, 400, 600), at(500, 500, 660)],
    ];

    const fitted = traceGeometry(withGap);
    const firstDrawn = fitted!.segments[0]!.split(" ")[0]!;
    const lastDrawn = fitted!.segments[1]!.split(" ").at(-1)!;

    expect(`${fitted!.start.x},${fitted!.start.y}`).toBe(firstDrawn);
    expect(`${fitted!.end.x},${fitted!.end.y}`).toBe(lastDrawn);
  });
});

describe("shapeWord", () => {
  /**
   * The case the Brand Guide's own wording gets wrong, and why the tolerance is
   * derived from the trim instead.
   *
   * § The Route Trace says a loop is when the ends "meet within the recording's
   * own accuracy". FUEL-100 trims 150m off each end before storing, so a real
   * loop's STORED ends sit 150m out along the outbound leg and 150m back along
   * the inbound one. On an accuracy-sized tolerance this walk — which came home
   * — reads "point to point", which is the wrong shape word the section says is
   * worse than none.
   */
  it("calls a trimmed loop a loop, though its stored ends do not meet", () => {
    // A 2km circuit whose legs are TRIM_METRES apart at the stored ends: what
    // `trimEnds` leaves behind when somebody walks out and comes back.
    const trimmedLoop: Track = [
      [
        at(0, 0, 0),
        at(600, 300, 300),
        at(900, -200, 700),
        at(300, -400, 1000),
        at(0, TRIM_METRES, 1300),
      ],
    ];

    expect(shapeWord(trimmedLoop)).toBe("a loop");
  });

  it("still calls a walk that ended elsewhere point to point", () => {
    const across: Track = [[at(0, 0, 0), at(1500, 0, 600), at(3000, 0, 1200)]];

    expect(shapeWord(across)).toBe("point to point");
  });

  /**
   * The absolute tolerance alone would swallow this: 300m is most of a 400m
   * stroll. The fraction is what refuses it.
   */
  it("refuses a short there-and-gone whose ends are near only in absolute terms", () => {
    const short: Track = [[at(0, 0, 0), at(200, 0, 120), at(280, 0, 200)]];

    expect(shapeWord(short)).toBe("point to point");
  });

  it("says nothing at all about a walk that measured no distance", () => {
    expect(shapeWord([[at(0, 0, 0), at(0, 0, 60)]])).toBeNull();
    expect(shapeWord([[at(0, 0, 0)]])).toBeNull();
    expect(shapeWord([])).toBeNull();
  });

  it("takes its tolerance from the trim, so the two move together", () => {
    expect(LOOP_TOLERANCE_M).toBe(2 * TRIM_METRES);
    expect(LOOP_MAX_FRACTION).toBeLessThan(1);
  });
});

describe("the words for an absence", () => {
  const withGap: Track = [
    [at(0, 0, 0), at(400, 0, 240)],
    [at(900, 0, 600), at(1300, 0, 840)],
  ];

  it("counts the gap off the points' own clock", () => {
    expect(gapSeconds(withGap)).toBe(360);
    expect(gapMinutes(withGap)).toBe(6);
  });

  it("names segments and the hole, in the Slash register", () => {
    expect(absences(withGap)).toBe("2 segments · 6 min not recorded");
  });

  it("says nothing about an ordinary unbroken walk", () => {
    expect(absences([[at(0, 0, 0), at(500, 0, 300)]])).toBeNull();
  });

  it("never lets an overlapping clock cancel a real gap", () => {
    const overlapping: Track = [
      [at(0, 0, 0), at(100, 0, 600)],
      // Starts BEFORE the previous segment ended — not a gap running backwards.
      [at(200, 0, 300), at(300, 0, 400)],
      [at(400, 0, 800), at(500, 0, 900)],
    ];

    // The 400s hole between the second and third segments survives; the
    // negative interval before it contributes zero rather than -300.
    expect(gapSeconds(overlapping)).toBe(400);
  });
});

describe("summarise", () => {
  /** The sentence § The Route Trace writes out, and the mock's own aria-label. */
  it("writes the section's example verbatim", () => {
    const loop: Track = [
      [at(0, 0, 0), at(600, 300, 600), at(900, -200, 1200), at(0, 100, 2040)],
    ];

    expect(
      summarise({ walk: "Morning Walk", distanceM: 3200, durationMin: 34, track: loop }),
    ).toBe("Morning Walk, 3.2 km in 34 minutes, a loop, recorded in one segment.");
  });

  it("names the gap where there is one", () => {
    const withGap: Track = [
      [at(0, 0, 0), at(2000, 0, 1200)],
      [at(3000, 0, 1560), at(5800, 0, 3660)],
    ];

    expect(
      summarise({
        walk: "Afternoon Walk",
        distanceM: 5800,
        durationMin: 61,
        track: withGap,
      }),
    ).toBe(
      "Afternoon Walk, 5.8 km in 61 minutes, point to point, " +
        "recorded in two segments with 6 minutes not recorded.",
    );
  });

  it("drops what the walk does not have rather than rendering an absence", () => {
    const line: Track = [[at(0, 0, 0), at(900, 0, 600)]];

    expect(summarise({ walk: "Walk", distanceM: null, durationMin: null, track: line })).toBe(
      "Walk, point to point, recorded in one segment.",
    );
  });

  it("does not say a duration is 'in' a distance that is not there", () => {
    expect(
      summarise({ walk: "Walk", distanceM: null, durationMin: 20, track: [] }),
    ).toBe("Walk, 20 minutes.");
  });

  /**
   * § The Route Trace's ruling, asserted rather than assumed: a coordinate must
   * never reach the accessibility tree, which is "the one surface PRD § P11's
   * storage rules do not otherwise reach".
   */
  it("puts no coordinate in the accessible name", () => {
    const walk: Track = [[at(0, 0, 0), at(1200, 800, 900)]];
    const sentence = summarise({
      walk: "Morning Walk",
      distanceM: 1400,
      durationMin: 15,
      track: walk,
    });

    for (const point of walk.flat()) {
      expect(sentence).not.toContain(String(point.lat));
      expect(sentence).not.toContain(String(point.lng));
    }

    expect(sentence).not.toMatch(/-?\d+\.\d{4,}/);
  });
});

describe("the hand-off", () => {
  it("hands over the stored start, which the trim has already moved", () => {
    const walk: Track = [[at(0, 0, 0), at(500, 500, 300)]];
    const start = startCoordinate(walk);

    expect(start).toEqual({ lat: walk[0]![0]!.lat, lng: walk[0]![0]!.lng });
  });

  it("writes latitude first, which is geo: and not GeoJSON", () => {
    const uri = geoUri({ lat: 12, lng: 34 });

    expect(uri).toBe("geo:12,34");
  });

  it("names no host, no provider and no scheme that fetches anything", () => {
    const uri = geoUri({ lat: 1, lng: 2 });

    expect(uri.startsWith("geo:")).toBe(true);
    expect(uri).not.toMatch(/https?:|\/\/|maps|google|apple/i);
  });

  it("is null where there is nothing to open", () => {
    expect(startCoordinate([])).toBeNull();
  });
});

describe("the readout", () => {
  it("says a distance the way the app says it everywhere", () => {
    expect(kilometres(3247)).toBe("3.2 km");
    expect(kilometres(0)).toBe("0.0 km");
  });

  it("states a walking pace in minutes and seconds per kilometre", () => {
    // 3.2km in 34 minutes — the section's own example walk.
    expect(pace(3200, 34)).toBe("10:38 /km");
    expect(pace(5000, 50)).toBe("10:00 /km");
  });

  it("has no pace where either figure is missing, rather than a zero", () => {
    expect(pace(null, 34)).toBeNull();
    expect(pace(3200, null)).toBeNull();
    // A one-tap walk, and a walk that measured no distance: neither was walked
    // at a speed of nothing.
    expect(pace(0, 34)).toBeNull();
    expect(pace(3200, 0)).toBeNull();
  });

  it("turns a user unit into the overlay's percentage", () => {
    expect(percent(TRACE_VIEW_WIDTH / 2, TRACE_VIEW_WIDTH)).toBe("50%");
    expect(percent(0, TRACE_VIEW_HEIGHT)).toBe("0%");
  });
});
