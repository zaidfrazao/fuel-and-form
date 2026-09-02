import { describe, expect, it } from "vitest";

import {
  MAX_REST_MS,
  parseRestEnd,
  REST_PRESETS,
  restLabel,
  restReading,
} from "./rest-timer";

/**
 * The rest timer's arithmetic — FUEL-93, PRD § P10.
 *
 * The module comment argues that an interval-counted timer is wrong in exactly
 * the situation the feature exists for. This file is where that argument is
 * held to something: every case below is a `now` a test can name, and the one
 * that separates the two spellings is the last group — a clock that moved a
 * long way while nothing ticked.
 *
 * Hermetic. No clock is read here, because the module does not read one either.
 */

/** An arbitrary instant, so nothing passes by coinciding with an epoch. */
const NOW = Date.UTC(2026, 8, 2, 18, 30, 0);

describe("the presets", () => {
  it("are three durations in seconds, following the walk's precedent", () => {
    // Asserted as literals rather than derived from the array under test, for
    // `section.test.ts`'s reason: a test that reads the values off the same
    // constant it is checking passes on any edit to it, including one that
    // makes a rest four minutes long.
    expect([...REST_PRESETS]).toEqual([60, 90, 120]);
  });

  it("are all well inside the cap a stored value is refused for", () => {
    // The cap exists to refuse values that cannot have come from a tap. If a
    // preset ever approached it, the refusal would start rejecting timers this
    // app itself started — which is the one way `MAX_REST_MS` could be wrong
    // without anything looking wrong.
    for (const seconds of REST_PRESETS) expect(seconds * 1000).toBeLessThan(MAX_REST_MS);
  });
});

describe("the readout", () => {
  it("shows the full duration for the first second, not one less", () => {
    /*
     * The ceiling, and the one arithmetic choice in the module that is not
     * forced. With `floor` this reads `1:29` on the frame a 90-second timer is
     * started — a number the reader did not tap, one millisecond after they
     * tapped one that they did.
     */
    expect(restLabel(90_000)).toBe("1:30");
    expect(restLabel(89_999)).toBe("1:30");
    expect(restLabel(89_001)).toBe("1:30");
  });

  it("moves to the next second only once that second is genuinely gone", () => {
    expect(restLabel(89_000)).toBe("1:29");
    expect(restLabel(60_001)).toBe("1:01");
    expect(restLabel(60_000)).toBe("1:00");
    expect(restLabel(59_999)).toBe("1:00");
  });

  it("pads the seconds, so the figure does not change width as it counts", () => {
    // `9:9` would be a readout that reflows the row it sits in, on a bar the
    // reader is looking at precisely because they are not looking at the screen
    // steadily.
    expect(restLabel(9_000)).toBe("0:09");
    expect(restLabel(69_000)).toBe("1:09");
  });

  it("reaches zero rather than passing it", () => {
    expect(restLabel(0)).toBe("0:00");
    expect(restLabel(1)).toBe("0:01");
  });

  it("clamps a negative rather than rendering one", () => {
    // Reachable in the app: a device clock corrected forward while a timer runs
    // hands this a negative on the next repaint. `-1:-3` is not a duration.
    expect(restLabel(-1)).toBe("0:00");
    expect(restLabel(-90_000)).toBe("0:00");
  });

  it("does not cap the minutes at sixty", () => {
    // A figure that should never arrive is better arriving visibly wrong than
    // quietly plausible — `60:00` says something is broken, `0:00` says the
    // rest is over.
    expect(restLabel(3_600_000)).toBe("60:00");
    expect(restLabel(3_660_000)).toBe("61:00");
  });
});

describe("the reading", () => {
  it("is the subtraction, and says so in both of its fields", () => {
    const reading = restReading(NOW + 90_000, NOW);

    expect(reading.remainingMs).toBe(90_000);
    expect(reading.label).toBe("1:30");
    expect(reading.elapsed).toBe(false);
  });

  it("elapses exactly on the end instant and not a millisecond before", () => {
    expect(restReading(NOW, NOW - 1).elapsed).toBe(false);
    expect(restReading(NOW, NOW).elapsed).toBe(true);
    expect(restReading(NOW, NOW).label).toBe("0:00");
  });

  it("floors at zero, so a reading taken late is over rather than negative", () => {
    const reading = restReading(NOW, NOW + 40_000);

    expect(reading.remainingMs).toBe(0);
    expect(reading.label).toBe("0:00");
    expect(reading.elapsed).toBe(true);
  });

  /**
   * The clause the ticket says must not be got wrong, as an assertion.
   *
   * A phone is locked with a 90-second rest running. The tab is throttled, so
   * the interval fires — at best — once a minute, and on a locked screen not at
   * all. Sixty seconds of wall clock pass and the timer is repainted ONCE.
   *
   * An interval-counted timer has decremented once and reads 1:29. Every case
   * below reads what the clock says, because nothing was accumulated to be lost:
   * the number of times this was called between the two instants is not an
   * input to it.
   */
  it("depends on the clock alone and not on how often it was asked", () => {
    const endsAt = NOW + 90_000;

    // Asked once, sixty seconds later.
    expect(restReading(endsAt, NOW + 60_000).label).toBe("0:30");

    // Asked two hundred and forty times over the same span. Same answer.
    for (let elapsed = 0; elapsed <= 60_000; elapsed += 250) {
      restReading(endsAt, NOW + elapsed);
    }

    expect(restReading(endsAt, NOW + 60_000).label).toBe("0:30");

    // Never asked at all until after the rest was over.
    expect(restReading(endsAt, NOW + 600_000).elapsed).toBe(true);
  });
});

describe("what comes back out of localStorage", () => {
  it("restores a timer that is still running", () => {
    // The reload criterion, at the layer that decides it.
    expect(parseRestEnd(String(NOW + 45_000), NOW)).toBe(NOW + 45_000);
  });

  it("refuses an absent or empty value, which is the ordinary state", () => {
    expect(parseRestEnd(null, NOW)).toBeNull();
    expect(parseRestEnd("", NOW)).toBeNull();
  });

  it("refuses anything that is not a whole number of milliseconds", () => {
    expect(parseRestEnd("soon", NOW)).toBeNull();
    expect(parseRestEnd("NaN", NOW)).toBeNull();
    /*
     * The one that matters. `Infinity` survives `Number()`, and `Infinity - now`
     * is `Infinity` — which formats as `NaN:NaN` and never elapses, so the tick
     * that would clear it never fires. A timer that cannot be got rid of except
     * by clearing site data.
     */
    expect(parseRestEnd("Infinity", NOW)).toBeNull();
    expect(parseRestEnd("-Infinity", NOW)).toBeNull();
    expect(parseRestEnd(String(NOW + 0.5), NOW)).toBeNull();
  });

  it("refuses a rest that has already ended, which is also the reaper", () => {
    // Nothing sweeps this key on a schedule, because nothing needs to: a value
    // left behind by yesterday's session is refused on the next read. The
    // boundary is inclusive — an instant equal to now has no time left in it.
    expect(parseRestEnd(String(NOW), NOW)).toBeNull();
    expect(parseRestEnd(String(NOW - 1), NOW)).toBeNull();
    expect(parseRestEnd("-1", NOW)).toBeNull();
    expect(parseRestEnd(String(NOW + 1), NOW)).toBe(NOW + 1);
  });

  it("refuses an end instant no tap could have produced", () => {
    /*
     * A corrupt value, or the ordinary case that is not corrupt at all: a
     * device clock corrected BACKWARDS while a timer ran leaves a stored
     * instant hours ahead of a `now` that is legitimate. Without this the row
     * shows a countdown from an implausible figure that the reader cannot stop
     * without finding the Stop button — which is there, but they have to trust
     * the screen enough to look.
     */
    expect(parseRestEnd(String(NOW + MAX_REST_MS + 1), NOW)).toBeNull();
    expect(parseRestEnd(String(NOW + 86_400_000), NOW)).toBeNull();

    // The boundary itself is allowed. The refusal is of values beyond the cap,
    // not of the cap.
    expect(parseRestEnd(String(NOW + MAX_REST_MS), NOW)).toBe(NOW + MAX_REST_MS);
  });
});
