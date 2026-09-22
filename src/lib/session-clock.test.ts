import { describe, expect, it } from "vitest";

import {
  MAX_PREFILL_MS,
  MAX_START_AGE_MS,
  MAX_START_SKEW_MS,
  elapsedLabel,
  parseEnteredAt,
  prefillMinutes,
} from "./session-clock";

/**
 * The session clock's arithmetic — FUEL-124.
 *
 * Hermetic, as `rest-timer.test.ts` is: no clock is read here, because the
 * module does not read one. Every case is an instant a test can name.
 */

/** An arbitrary instant, so nothing passes by coinciding with an epoch. */
const NOW = Date.UTC(2026, 8, 22, 18, 30, 0);

const MINUTE = 60_000;

describe("the bounds", () => {
  // Literals rather than values read off the constants under test, for
  // `rest-timer.test.ts`' reason: a test that derives the figure from the
  // constant it checks passes on any edit to it.
  it("pre-fills up to three hours", () => {
    expect(MAX_PREFILL_MS).toBe(3 * 60 * MINUTE);
  });

  it("believes a start up to a day old and a minute ahead", () => {
    expect(MAX_START_AGE_MS).toBe(24 * 60 * MINUTE);
    expect(MAX_START_SKEW_MS).toBe(MINUTE);
  });
});

describe("parseEnteredAt", () => {
  it("reads an instant this app wrote", () => {
    expect(parseEnteredAt(String(NOW - 20 * MINUTE), NOW)).toBe(NOW - 20 * MINUTE);
  });

  it("reads a start written this instant", () => {
    expect(parseEnteredAt(String(NOW), NOW)).toBe(NOW);
  });

  it.each([
    ["absent", null],
    ["empty", ""],
    ["prose", "soon"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["a float", String(NOW - 0.5)],
  ])("refuses %s", (_name, raw) => {
    expect(parseEnteredAt(raw, NOW)).toBeNull();
  });

  it('refuses the legacy "1", which is an integer and not an instant', () => {
    // Every session entered before FUEL-124 stored this. Read as an instant it
    // is 1970, and a clock would show fifty-six years.
    expect(parseEnteredAt("1", NOW)).toBeNull();
  });

  it("believes a start exactly a day old, and refuses one a millisecond older", () => {
    expect(parseEnteredAt(String(NOW - MAX_START_AGE_MS), NOW)).toBe(NOW - MAX_START_AGE_MS);
    expect(parseEnteredAt(String(NOW - MAX_START_AGE_MS - 1), NOW)).toBeNull();
  });

  it("believes a start a minute ahead — a clock corrected backwards — and no further", () => {
    expect(parseEnteredAt(String(NOW + MAX_START_SKEW_MS), NOW)).toBe(NOW + MAX_START_SKEW_MS);
    expect(parseEnteredAt(String(NOW + MAX_START_SKEW_MS + 1), NOW)).toBeNull();
  });
});

describe("elapsedLabel", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [1000, "0:01"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [(27 * 60 + 40) * 1000, "27:40"],
    [60 * MINUTE - 1, "59:59"],
    [60 * MINUTE, "1:00:00"],
    [(3600 + 5 * 60 + 7) * 1000, "1:05:07"],
    [(10 * 3600 + 59 * 60 + 59) * 1000, "10:59:59"],
  ])("reads %i ms as %s", (ms, label) => {
    // Floor, so no second is claimed before it has passed: 999ms is still 0:00.
    expect(elapsedLabel(ms)).toBe(label);
  });

  it("reads a start slightly ahead of the clock as zero, not a negative", () => {
    expect(elapsedLabel(-3000)).toBe("0:00");
  });
});

describe("prefillMinutes", () => {
  it("rounds to the nearest whole minute", () => {
    expect(prefillMinutes(NOW - (27 * 60 + 40) * 1000, NOW)).toBe(28);
    expect(prefillMinutes(NOW - (27 * 60 + 20) * 1000, NOW)).toBe(27);
    expect(prefillMinutes(NOW - 90 * 1000, NOW)).toBe(2);
  });

  it("records nothing for a session under half a minute, and a minute from there", () => {
    // `session-entry.ts` refuses zero, and a session finished in seconds was
    // started by mistake.
    expect(prefillMinutes(NOW, NOW)).toBeNull();
    expect(prefillMinutes(NOW - 29_999, NOW)).toBeNull();
    expect(prefillMinutes(NOW - 30_000, NOW)).toBe(1);
  });

  it("records nothing for a start ahead of the clock", () => {
    expect(prefillMinutes(NOW + 30_000, NOW)).toBeNull();
  });

  it("records exactly three hours, and nothing a millisecond past", () => {
    // Left empty rather than capped: a capped figure is one this app invented.
    expect(prefillMinutes(NOW - MAX_PREFILL_MS, NOW)).toBe(180);
    expect(prefillMinutes(NOW - MAX_PREFILL_MS - 1, NOW)).toBeNull();
  });
});
