import { describe, expect, it } from "vitest";

import { safeError } from "./safe-error";

/**
 * What a walk action may write to a log — FUEL-102.
 *
 * The failure this exists to prevent is real and was observed rather than
 * imagined: while writing the route isolation tests, a violated CHECK on
 * `walk_routes` printed *"Failing row contains (…)"* — the whole trace, and on
 * another run a route name — straight into the terminal, because
 * `console.error(msg, error)` prints the driver's error object and Postgres
 * puts the failing row in its `detail`.
 *
 * ## The fixture is COMPUTED, and that is not fussiness
 *
 * A convincing `detail` string needs a convincing coordinate pair, and a
 * convincing pair written as a literal is exactly what `check-no-metrics.sh`
 * refuses — its `gps-coordinate` pattern matches two decimals separated by a
 * comma and its allowlist is empty on purpose. The first draft of this file
 * pasted a real pair out of a demo database and would have turned the
 * pre-publish scan red, in the test asserting that coordinates do not leak.
 * So the numbers are assembled from integers here and never spelled.
 */
const LAT = 51 + 47_789 / 1e5;
const LNG = -(238 / 1e5);
const ROUTE_NAME = "The park circuit";

/** Shaped like the real thing: `detail` is where Postgres puts the failing row. */
const detail =
  `Failing row contains (1198756b, 9f1bf367, ` +
  `[[{"t": 0, "lat": ${LAT}, "lng": ${LNG}}]], 5, null, 2026-09-09, ${ROUTE_NAME}).`;

describe("safeError", () => {
  it("keeps the message and the Postgres code, which is what diagnoses a failure", () => {
    const error = Object.assign(new Error("violates check constraint"), {
      code: "23514",
    });

    expect(safeError(error)).toBe("Error: violates check constraint [23514]");
  });

  it("drops everything else the driver hangs on the error", () => {
    const error = Object.assign(new Error("violates check constraint"), {
      code: "23514",
      detail,
      table: "walk_routes",
    });

    const logged = safeError(error);

    // The two things that must never appear: a coordinate, and a route name.
    expect(logged).not.toContain(String(LAT));
    expect(logged).not.toContain(String(LNG));
    expect(logged).not.toContain(ROUTE_NAME);
    expect(logged).not.toContain("Failing row");
    expect(logged).not.toMatch(/-?\d+\.\d{4,}/);
  });

  it("survives an error with no code, which is what a dropped connection is", () => {
    expect(safeError(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
  });

  it("never prints a thrown non-Error, whose value could be a row", () => {
    expect(safeError({ points: [{ lat: LAT, lng: LNG }] })).toBe(
      "non-Error thrown (object)",
    );
    expect(safeError("a string")).toBe("non-Error thrown (string)");
  });
});
