import { describe, expect, test } from "vitest";

import {
  estimateSteps,
  MAX_HEIGHT_CM,
  MAX_STEPS,
  MIN_HEIGHT_CM,
  STEP_LENGTH_TO_HEIGHT,
  stepsFigure,
  stepsLabel,
} from "./steps";

/** The demo persona's height, and the one every figure below is computed at. */
const HEIGHT = 172;

describe("the coefficient", () => {
  /*
   * The check that catches the one mistake this module is built to avoid.
   *
   * A stride is two steps, the words are used interchangeably in casual
   * writing, and taking the stride ratio (~0.83) instead of the step ratio
   * would halve every count in the app while leaving a figure that still looks
   * plausible on a screen. Steps-per-kilometre is the reading where the error
   * is obvious: the usual band is 1,250–1,550, and a stride ratio lands at
   * ~700, which is outside it by a factor this assertion can see.
   */
  test("puts a walking adult inside the usual steps-per-kilometre band", () => {
    const perKm = estimateSteps({ distanceM: 1000, heightCm: HEIGHT })!;

    expect(perKm).toBeGreaterThanOrEqual(1250);
    expect(perKm).toBeLessThanOrEqual(1550);
  });

  test("is the step ratio and not the stride ratio", () => {
    // Stated as a bound rather than as the literal, so the test says what is
    // wrong about 0.83 rather than merely restating the constant.
    expect(STEP_LENGTH_TO_HEIGHT).toBeGreaterThan(0.35);
    expect(STEP_LENGTH_TO_HEIGHT).toBeLessThan(0.5);
  });

  /*
   * The bound the schema's CHECK is written against — see `MAX_STEPS`.
   *
   * `distance_m` is capped at 100,000 and the shortest step length a plausible
   * height yields is `MIN_HEIGHT_CM`'s, so this is the largest figure this
   * module can produce. Asserted rather than trusted, because the CHECK and the
   * constant would otherwise be free to drift apart the moment either bound
   * moves — and the failure mode is a legal walk the database refuses to store.
   */
  test("cannot produce a figure the schema's ceiling would refuse", () => {
    const largest = estimateSteps({ distanceM: 100_000, heightCm: MIN_HEIGHT_CM })!;

    expect(largest).toBeLessThanOrEqual(MAX_STEPS);
  });
});

describe("the estimate", () => {
  test("divides the distance by the step length a height implies", () => {
    // 3200 / (1.72 × 0.414) = 4,493.9, and two significant figures of that.
    expect(estimateSteps({ distanceM: 3200, heightCm: HEIGHT })).toBe(4500);
  });

  test("scales with the distance", () => {
    expect(estimateSteps({ distanceM: 1600, heightCm: HEIGHT })).toBe(2200);
    expect(estimateSteps({ distanceM: 5800, heightCm: HEIGHT })).toBe(8100);
  });

  test("a taller walker takes fewer steps over the same ground", () => {
    const tall = estimateSteps({ distanceM: 3200, heightCm: 195 })!;
    const short = estimateSteps({ distanceM: 3200, heightCm: 150 })!;

    expect(tall).toBeLessThan(short);
  });
});

describe("the rounding", () => {
  /*
   * Two significant figures, not the nearest hundred — and these are the
   * magnitudes where the two rules disagree.
   *
   * A nearest-hundred rule would answer 500 and 100 for the second and third
   * cases: a 3% error dressed up as an 8% one, and a 15% error on a figure the
   * app shows twice a day. This is the assertion that would fail if somebody
   * "simplified" the rounding.
   */
  test("keeps two significant figures at every magnitude", () => {
    expect(estimateSteps({ distanceM: 3200, heightCm: HEIGHT })).toBe(4500);
    expect(estimateSteps({ distanceM: 368, heightCm: HEIGHT })).toBe(520);
    expect(estimateSteps({ distanceM: 62, heightCm: HEIGHT })).toBe(87);
  });

  test("never yields a fraction of a step", () => {
    for (const distanceM of [1, 7, 62, 368, 3200, 100_000]) {
      const steps = estimateSteps({ distanceM, heightCm: HEIGHT })!;

      expect(Number.isInteger(steps)).toBe(true);
    }
  });
});

describe("the refusals — a wrong figure is worse than none", () => {
  test("a walk with no recorded distance yields no figure rather than zero", () => {
    expect(estimateSteps({ distanceM: null, heightCm: HEIGHT })).toBeNull();
  });

  test("a zero or negative distance is not a walk somebody stood still for", () => {
    expect(estimateSteps({ distanceM: 0, heightCm: HEIGHT })).toBeNull();
    expect(estimateSteps({ distanceM: -3200, heightCm: HEIGHT })).toBeNull();
  });

  test("a non-finite distance", () => {
    expect(estimateSteps({ distanceM: Number.NaN, heightCm: HEIGHT })).toBeNull();
    expect(estimateSteps({ distanceM: Number.POSITIVE_INFINITY, heightCm: HEIGHT })).toBeNull();
  });

  test("a profile with no height", () => {
    expect(estimateSteps({ distanceM: 3200, heightCm: null })).toBeNull();
  });

  test("a non-finite height", () => {
    expect(estimateSteps({ distanceM: 3200, heightCm: Number.NaN })).toBeNull();
  });

  test("an implausible height, on either side of the band", () => {
    expect(estimateSteps({ distanceM: 3200, heightCm: MIN_HEIGHT_CM - 1 })).toBeNull();
    expect(estimateSteps({ distanceM: 3200, heightCm: MAX_HEIGHT_CM + 1 })).toBeNull();
  });

  test("the band itself answers at both of its edges", () => {
    expect(estimateSteps({ distanceM: 3200, heightCm: MIN_HEIGHT_CM })).not.toBeNull();
    expect(estimateSteps({ distanceM: 3200, heightCm: MAX_HEIGHT_CM })).not.toBeNull();
  });

  /*
   * A walk of under half a metre, which `workout_logs.distance_m` forbids and
   * this function's own arguments do not. Zero is the answer the arithmetic
   * gives and the one thing this module may not return: it is a row the
   * schema's CHECK refuses and a `0 steps` on a screen that means the opposite
   * of what it says.
   */
  test("a figure that rounds away to nothing is an absence, not a zero", () => {
    expect(estimateSteps({ distanceM: 0.4, heightCm: MAX_HEIGHT_CM })).toBeNull();
  });
});

describe("the copy", () => {
  /*
   * The tilde is spent by the SOURCE, and this is the pair of assertions that
   * says so. Nothing in the app writes `device` today, so without these the
   * branch would ship unmeasured and a real count would arrive labelled as a
   * guess.
   */
  test("an estimate is marked as one, on the row and in the sheet", () => {
    expect(stepsLabel(4500, "estimated")).toBe("~4,500 steps");
    expect(stepsFigure(4500, "estimated")).toBe("~4,500 (estimated)");
  });

  test("a counted figure takes no tilde and says it was counted", () => {
    expect(stepsLabel(4500, "device")).toBe("4,500 steps");
    expect(stepsFigure(4500, "device")).toBe("4,500 (counted)");
  });

  test("thousands are grouped, the way every other figure in the app is", () => {
    expect(stepsLabel(87, "estimated")).toBe("~87 steps");
    expect(stepsLabel(12_000, "device")).toBe("12,000 steps");
  });
});
