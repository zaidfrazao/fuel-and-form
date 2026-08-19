import { describe, expect, test } from "vitest";

import { weekLabel } from "./now-display";

/**
 * The week header's label — FUEL-28.
 *
 * Small, and worth pinning for one reason: it drops the parts that repeat, so
 * every case is a decision about what may be left out. Leaving out too much is
 * a header that says something false — "28 Dec – 3 Jan 2026" claims a December
 * that never happened — and the suite runs in New York deliberately, so a
 * formatter that reached for a `Date` rather than the date's own parts reads
 * back a day early here rather than only in production.
 */

describe("weekLabel", () => {
  test("names the month once when the week is inside one", () => {
    expect(weekLabel("2026-08-10")).toBe("10 – 16 Aug 2026");
  });

  test("names both months when the week crosses one", () => {
    expect(weekLabel("2026-07-27")).toBe("27 Jul – 2 Aug 2026");
  });

  test("names both years when the week crosses one", () => {
    // The case where dropping either year would be a lie about which December.
    expect(weekLabel("2025-12-29")).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  test("reads the date's own parts, not a UTC midnight", () => {
    // `new Date("2026-08-10")` is the 9th in New York, which is the zone this
    // suite pins. A label built that way would be off by one here.
    expect(weekLabel("2026-08-10")).toContain("10 ");
  });

  test("refuses a malformed date rather than formatting one", () => {
    expect(() => weekLabel("2026-8-10")).toThrow();
  });
});
