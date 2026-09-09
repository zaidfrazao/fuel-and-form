import { describe, expect, it } from "vitest";

import { EARTH_RADIUS_M, type Track, type TrackPoint } from "@/lib/route";
import {
  MATCH_LENGTH_TOLERANCE,
  MATCH_START_METRES,
  matchNamedRoute,
  type NamedRoute,
} from "@/lib/route-match";

/** Metre offsets, never coordinate literals — `route-trace.test.ts` says why. */
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;
const TEST_LATITUDE = 51;
const COS_TEST_LATITUDE = Math.cos((TEST_LATITUDE * Math.PI) / 180);

const at = (east: number, north: number, t = 0): TrackPoint => ({
  lat: TEST_LATITUDE + north / METRES_PER_DEGREE,
  lng: east / (METRES_PER_DEGREE * COS_TEST_LATITUDE),
  t,
});

/** A point-to-point walk of roughly `metres`, beginning `offset` east. */
const walk = (metres: number, offset = 0): Track => [
  [at(offset, 0, 0), at(offset + metres / 2, 0, 300), at(offset + metres, 0, 600)],
];

/** A circuit that comes back near where it began. */
const loop = (size: number, offset = 0): Track => [
  [
    at(offset, 0, 0),
    at(offset + size, 0, 300),
    at(offset + size, size, 600),
    at(offset, size, 900),
    at(offset, 0, 1200),
  ],
];

describe("matchNamedRoute", () => {
  it("offers the name of a route that began in the same place and went as far", () => {
    const named: NamedRoute[] = [{ name: "The river loop", track: loop(500) }];

    const match = matchNamedRoute(loop(500, 40), named);

    expect(match?.name).toBe("The river loop");
    expect(match?.metresApart).toBeCloseTo(40, 0);
  });

  it("offers nothing for a walk that began somewhere else", () => {
    const named: NamedRoute[] = [{ name: "The river loop", track: loop(500) }];

    expect(matchNamedRoute(loop(500, MATCH_START_METRES + 50), named)).toBeNull();
  });

  it("offers nothing for a walk of a different length from the same door", () => {
    const named: NamedRoute[] = [{ name: "The short one", track: walk(1000) }];

    // Half as long again — a different walk that happens to share a street.
    expect(matchNamedRoute(walk(1500), named)).toBeNull();
  });

  it("accepts the same walk taken a little differently", () => {
    const named: NamedRoute[] = [{ name: "The river loop", track: loop(1000) }];

    // Inside the tolerance on both start and length.
    const match = matchNamedRoute(loop(1000 * (1 - MATCH_LENGTH_TOLERANCE / 2), 30), named);

    expect(match?.name).toBe("The river loop");
  });

  it("will not offer a loop's name to the point-to-point that shares its street", () => {
    const named: NamedRoute[] = [{ name: "The river loop", track: loop(600) }];

    // Starts in the same place and covers a comparable distance, but does not
    // come home: a different route, and the shape word is what says so.
    const straight = matchNamedRoute(walk(2400), named);

    expect(straight).toBeNull();
  });

  it("offers the nearest start when two named routes both qualify", () => {
    const named: NamedRoute[] = [
      { name: "The far one", track: loop(500, 80) },
      { name: "The near one", track: loop(500, 10) },
    ];

    expect(matchNamedRoute(loop(500), named)?.name).toBe("The near one");
  });

  it("offers nothing when there is nothing named yet", () => {
    expect(matchNamedRoute(loop(500), [])).toBeNull();
  });

  it("offers nothing for a walk with no route at all", () => {
    const named: NamedRoute[] = [{ name: "The river loop", track: loop(500) }];

    expect(matchNamedRoute([], named)).toBeNull();
    expect(matchNamedRoute([[]], named)).toBeNull();
  });

  /**
   * Two walks that measured nothing are not "the same route" on the strength of
   * both being unknown. Without the guard the ratio would be 0/0 and both shape
   * words would be null, which compares equal — a name offered for two
   * absences.
   */
  it("offers nothing when neither walk went anywhere", () => {
    const stationary: Track = [[at(0, 0, 0), at(0, 0, 60)]];
    const named: NamedRoute[] = [{ name: "Nowhere", track: stationary }];

    expect(matchNamedRoute(stationary, named)).toBeNull();
  });

  it("skips a named row whose track is empty rather than throwing on it", () => {
    const named: NamedRoute[] = [
      { name: "Empty", track: [] },
      { name: "The river loop", track: loop(500) },
    ];

    expect(matchNamedRoute(loop(500), named)?.name).toBe("The river loop");
  });
});
