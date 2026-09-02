import { describe, expect, test } from "vitest";

import {
  KCAL_STEP,
  MAX_WIDTH_RATIO,
  MET_BANDS,
  modelledMinutes,
  nearestWeight,
  REST_SECONDS,
  SECONDS_PER_REP,
  sessionEnergy,
  SUPPORT_BAND,
  type WeighIn,
} from "./energy";

/**
 * The estimate — § P10's energy figure, FUEL-95.
 *
 * Two properties are worth more here than coverage, and both are named on the
 * ticket:
 *
 *   1. **Determinism.** "Recomputing a past session after a new weigh-in returns
 *      the same number" is not testable by pinning today's figure — a test that
 *      does that passes against an implementation reading the LATEST weigh-in,
 *      because today's session and the latest weigh-in are the same day. So the
 *      assertions below cost a MARCH session across two different "current"
 *      weights and compare the two answers to each other.
 *   2. **The constants.** 100% coverage of this file would mean the lines ran.
 *      Every number in the formula is asserted against a figure worked out by
 *      hand below, so changing 3.5, 200, a MET bound or a rest bound fails a
 *      test rather than moving a total nothing looks at.
 *
 * The expected figures are written as arithmetic rather than as literals where
 * the arithmetic is the point — `MET × 3.5 × kg / 200 × min` spelled out — so a
 * reader can check the expectation against the formula instead of against a
 * previous run of the code. Where the assertion is about ROUNDING the literal is
 * the point, and the literal is written.
 */

/** `n` exercise rows in one section. Only the section is ever read. */
const rows = (count: number, section: string) =>
  Array.from({ length: count }, () => ({ section }));

/** A session's rows as the seed shapes one: a warm-up, the work, a cool-down. */
const SESSION_ROWS = [...rows(2, "warmup"), ...rows(6, "work"), ...rows(2, "cooldown")];

/** `count` sets of `reps`, which is all the duration model reads. */
const sets = (count: number, reps: number) =>
  Array.from({ length: count }, () => ({ reps }));

/**
 * The bodyweight every worked example below is costed at.
 *
 * The demo persona's, which is a fictional figure this repository already
 * carries and `scripts/check-no-metrics.sh` already allows — its own note asks
 * a new fixture to reuse an existing value rather than lengthen the list.
 */
const WEIGHT = 76;

/** kcal/min at one MET, for one bodyweight — the formula, written once. */
const rate = (met: number, kg: number) => (met * 3.5 * kg) / 200;

describe("the formula", () => {
  test("costs a logged duration at the type's MET band", () => {
    // All-work rows, so the support band is out of it and the figure is the
    // formula and nothing else: 5 and 8 METs, the fixture weight, 30 minutes.
    const range = sessionEnergy({
      type: "circuit",
      exercises: rows(6, "work"),
      sets: [],
      durationMin: 30,
      weightKg: WEIGHT,
    });

    expect(rate(5, WEIGHT) * 30).toBeCloseTo(199.5);
    expect(rate(8, WEIGHT) * 30).toBeCloseTo(319.2);
    expect(range).toEqual({ lowKcal: 190, highKcal: 320 });
  });

  test("scales with bodyweight, because the formula does", () => {
    const at = (weightKg: number) =>
      sessionEnergy({
        type: "circuit",
        exercises: rows(6, "work"),
        sets: [],
        // Forty minutes, so the low bound is exactly 3.5 × the weight and the
        // rounding step divides both figures below. At thirty it does not, and
        // a test written there would be asserting `Math.floor` rather than the
        // formula.
        durationMin: 40,
        weightKg,
      });

    // Double the weight, double the cost — the property `× 3.5` and `/ 200`
    // produce together, asserted as a relationship rather than as two literals
    // so a changed constant has nowhere to hide. Arbitrary scalars, not
    // anybody's weight: they are chosen for the arithmetic.
    expect(rate(5, 40) * 40).toBe(140);
    expect(rate(5, 80) * 40).toBe(280);
    expect(at(80)?.lowKcal).toBe(2 * (at(40)?.lowKcal ?? 0));
  });

  test("costs the warm-up and cool-down at the support band, not the work's", () => {
    const range = sessionEnergy({
      type: "circuit",
      exercises: SESSION_ROWS,
      sets: [],
      durationMin: 30,
      weightKg: WEIGHT,
    });

    // Six work rows of ten, four support rows of ten: 18 minutes at the circuit
    // band and 12 at the support band.
    expect(rate(5, WEIGHT) * 18 + rate(SUPPORT_BAND.low, WEIGHT) * 12).toBeCloseTo(151.62);
    expect(rate(8, WEIGHT) * 18 + rate(SUPPORT_BAND.high, WEIGHT) * 12).toBeCloseTo(239.4);
    expect(range).toEqual({ lowKcal: 150, highKcal: 240 });
  });

  test("costs a session with no rows entirely at the working band", () => {
    // Nothing to apportion by. A workout that lasted 30 minutes and lists no
    // exercises is 30 minutes of that workout's own activity.
    expect(
      sessionEnergy({
        type: "circuit",
        exercises: [],
        sets: [],
        durationMin: 30,
        weightKg: WEIGHT,
      }),
    ).toEqual(
      sessionEnergy({
        type: "circuit",
        exercises: rows(3, "work"),
        sets: [],
        durationMin: 30,
        weightKg: WEIGHT,
      }),
    );
  });

  test("gives an unrecognised section the support band, not the work's", () => {
    const finisher = sessionEnergy({
      type: "circuit",
      exercises: [...rows(6, "work"), ...rows(4, "finisher")],
      sets: [],
      durationMin: 30,
      weightKg: WEIGHT,
    });

    // The same shape as the warm-up case above and the same answer: a section
    // this build has never heard of does not get the working rate.
    expect(finisher).toEqual({ lowKcal: 150, highKcal: 240 });
  });

  test("uses the type's own band — intervals cost more than a circuit", () => {
    const same = {
      exercises: rows(4, "work"),
      sets: [],
      durationMin: 25,
      weightKg: WEIGHT,
    };

    expect(sessionEnergy({ ...same, type: "intervals" })).toEqual({
      lowKcal: 260,
      highKcal: 400,
    });
    expect(sessionEnergy({ ...same, type: "circuit" })?.lowKcal).toBeLessThan(260);
    // `Record<string, Band>` is indexed under `noUncheckedIndexedAccess`, which
    // is the type system saying the same thing this module does: a lookup on an
    // open vocabulary can miss.
    expect(MET_BANDS.intervals?.low).toBeGreaterThanOrEqual(MET_BANDS.circuit!.high);
  });
});

describe("where the duration comes from", () => {
  test("a logged duration wins over the sets, even with sets to model from", () => {
    const withSets = sessionEnergy({
      type: "circuit",
      exercises: rows(6, "work"),
      sets: sets(15, 12),
      durationMin: 30,
      weightKg: WEIGHT,
    });
    const withoutSets = sessionEnergy({
      type: "circuit",
      exercises: rows(6, "work"),
      sets: [],
      durationMin: 30,
      weightKg: WEIGHT,
    });

    // A measured number beats a modelled one: the sets change nothing at all.
    expect(withSets).toEqual(withoutSets);
  });

  test("models the duration as reps plus rest, per set", () => {
    // Three sets of ten: 3 × (10 × 2 + 40) = 180s at the low bound, and
    // 3 × (10 × 4 + 80) = 360s at the high one.
    expect(modelledMinutes(sets(3, 10))).toEqual({ low: 3, high: 6 });
    expect((3 * (10 * SECONDS_PER_REP.low + REST_SECONDS.low)) / 60).toBe(3);
    expect((3 * (10 * SECONDS_PER_REP.high + REST_SECONDS.high)) / 60).toBe(6);
  });

  test("more reps model a longer session, and more sets model a longer one", () => {
    // The half of "sets and reps feed the duration estimate" that reps do. Both
    // bounds move, because both are `reps × seconds + rest`.
    expect(modelledMinutes(sets(3, 20)).low).toBeGreaterThan(
      modelledMinutes(sets(3, 8)).low,
    );
    expect(modelledMinutes(sets(3, 20)).high).toBeGreaterThan(
      modelledMinutes(sets(3, 8)).high,
    );
    expect(modelledMinutes(sets(6, 10)).low).toBe(2 * modelledMinutes(sets(3, 10)).low);
  });

  test("no sets model no time at all", () => {
    // Which is what makes "no duration and no sets" yield nothing rather than a
    // zero-length session costed at zero kcal.
    expect(modelledMinutes([])).toEqual({ low: 0, high: 0 });
  });

  test("but no modelled duration survives the ceiling, at today's constants", () => {
    // The finding, pinned as an invariant rather than as one example. Every
    // modelled band is a factor of two wide and the narrowest MET band is 1.5,
    // so the product never comes under 3 — see the module comment. If a future
    // model tightens this, this test is what says so out loud.
    const modelled = modelledMinutes(sets(3, 10));

    expect(modelled.high / modelled.low).toBe(2);
    expect(2 * Math.min(...Object.values(MET_BANDS).map((b) => b.high / b.low))).
      toBeGreaterThan(MAX_WIDTH_RATIO);
    expect(
      sessionEnergy({
        type: "circuit",
        exercises: rows(1, "work"),
        sets: sets(3, 10),
        durationMin: null,
        weightKg: WEIGHT,
      }),
    ).toBeNull();
  });

  test("treats a non-positive duration as no duration at all", () => {
    // Only ever a forged write — `session-entry.ts` refuses it at the edge — and
    // the honest reading of "this session lasted −5 minutes" is that nobody said.
    // With no sets either there is no evidence, so it is null and not a negative.
    for (const durationMin of [0, -5]) {
      expect(
        sessionEnergy({
          type: "circuit",
          exercises: rows(6, "work"),
          sets: [],
          durationMin,
          weightKg: WEIGHT,
        }),
      ).toBeNull();
    }
  });
});

describe("what yields no estimate", () => {
  test("an unknown workout type yields nothing, never a zero", () => {
    const range = sessionEnergy({
      type: "strength",
      exercises: rows(6, "work"),
      sets: sets(9, 8),
      durationMin: 45,
      weightKg: WEIGHT,
    });

    // Not `{ lowKcal: 0, highKcal: 0 }`. A zero is a claim that a 45-minute
    // session cost nothing; the honest answer is that this method has none.
    expect(range).toBeNull();
    expect(MET_BANDS.strength).toBeUndefined();
  });

  test("the walk yields nothing — it is P11's, not this method's", () => {
    expect(
      sessionEnergy({
        type: "walk",
        exercises: [],
        sets: [],
        durationMin: 45,
        weightKg: WEIGHT,
      }),
    ).toBeNull();
    expect(MET_BANDS.walk).toBeUndefined();
  });

  test("a session with no duration and no sets yields nothing", () => {
    expect(
      sessionEnergy({
        type: "circuit",
        exercises: SESSION_ROWS,
        sets: [],
        durationMin: null,
        weightKg: WEIGHT,
      }),
    ).toBeNull();
  });

  test("a bodyweight of nothing yields nothing rather than a zero range", () => {
    expect(
      sessionEnergy({
        type: "circuit",
        exercises: rows(6, "work"),
        sets: [],
        durationMin: 30,
        weightKg: 0,
      }),
    ).toBeNull();
  });

  test("a range wider than the ceiling is refused", () => {
    // The ticket's own finding, pinned: a real session with sets logged and no
    // duration written down comes out 3.2× wide, and 3.2 is over 2.5.
    const modelled = sessionEnergy({
      type: "circuit",
      exercises: SESSION_ROWS,
      sets: sets(15, 12),
      durationMin: null,
      weightKg: WEIGHT,
    });

    expect(modelled).toBeNull();

    // And the same session with the duration written down is not refused, which
    // is what says the ceiling is measuring width rather than refusing sets.
    expect(
      sessionEnergy({
        type: "circuit",
        exercises: SESSION_ROWS,
        sets: sets(15, 12),
        durationMin: 30,
        weightKg: WEIGHT,
      }),
    ).not.toBeNull();
  });

  test("every logged-duration band this build ships is inside the ceiling", () => {
    // The ceiling is a rule about width, so it is asserted against the constants
    // rather than against one session: a future MET band wider than 2.5 would
    // silently render nothing anywhere, and this is what says so.
    for (const band of [...Object.values(MET_BANDS), SUPPORT_BAND]) {
      expect(band.high / band.low).toBeLessThanOrEqual(MAX_WIDTH_RATIO);
    }
  });
});

describe("how the figures are printed", () => {
  test("rounds outward to the step, so neither bound overstates", () => {
    const range = sessionEnergy({
      type: "circuit",
      exercises: rows(6, "work"),
      sets: [],
      durationMin: 30,
      weightKg: WEIGHT,
    });

    // 199.5 and 319.2 exactly. The low rounds DOWN and the high rounds UP.
    expect(range?.lowKcal).toBe(190);
    expect(range?.highKcal).toBe(320);
    expect(range?.lowKcal).toBeLessThan(199.5);
    expect(range?.highKcal).toBeGreaterThan(319.2);
  });

  test("never prints a zero as the low bound", () => {
    // One minute: the raw low is 6.65 kcal, which rounds outward to zero — and
    // a low bound of zero is the claim this whole file refuses to make.
    const range = sessionEnergy({
      type: "circuit",
      exercises: rows(1, "work"),
      sets: [],
      durationMin: 1,
      weightKg: WEIGHT,
    });

    expect(rate(5, WEIGHT) * 1).toBeCloseTo(6.65);
    expect(range).toEqual({ lowKcal: KCAL_STEP, highKcal: 20 });
  });

  test("never prints a range narrower than the step", () => {
    // Both raw bounds inside one 10 kcal increment, which is a precision the
    // rounding has already thrown away — so the printed range widens to the step
    // rather than collapsing to a single repeated figure.
    const range = sessionEnergy({
      type: "circuit",
      exercises: rows(1, "warmup"),
      sets: [],
      durationMin: 1,
      weightKg: WEIGHT,
    });

    expect(rate(SUPPORT_BAND.low, WEIGHT)).toBeCloseTo(2.66);
    expect(rate(SUPPORT_BAND.high, WEIGHT)).toBeCloseTo(3.99);
    expect(range).toEqual({ lowKcal: KCAL_STEP, highKcal: 2 * KCAL_STEP });
  });
});

describe("the bodyweight a session is costed at", () => {
  const MARCH: WeighIn[] = [
    { date: "2026-03-01", weightKg: 88 },
    { date: "2026-03-29", weightKg: 86 },
  ];

  test("takes the weigh-in nearest the session's own date", () => {
    // 2026-03-08 is seven days after the first and twenty-one before the second.
    expect(nearestWeight(MARCH, "2026-03-08", 99)).toBe(88);
    expect(nearestWeight(MARCH, "2026-03-22", 99)).toBe(86);
  });

  test("a later weigh-in never re-prices a past session", () => {
    // THE determinism criterion, and the one the ticket warns a naive test will
    // miss. A test pinning today's figure passes against "read the latest
    // weigh-in", because today's session and the latest weigh-in coincide. So
    // this costs the same MARCH date under two different presents.
    const inMarch = nearestWeight(MARCH, "2026-03-08", 99);
    const inSeptember = nearestWeight(
      [...MARCH, { date: "2026-09-01", weightKg: 79 }],
      "2026-03-08",
      99,
    );
    const later = nearestWeight(
      [...MARCH, { date: "2026-09-01", weightKg: 79 }, { date: "2026-12-01", weightKg: 74 }],
      "2026-03-08",
      99,
    );

    expect(inMarch).toBe(88);
    expect(inSeptember).toBe(inMarch);
    expect(later).toBe(inMarch);
  });

  test("and the whole estimate is unchanged by one, not just the weight", () => {
    // The property the criterion is actually about, asserted end to end rather
    // than on the resolver alone.
    const cost = (weighIns: WeighIn[]) =>
      sessionEnergy({
        type: "circuit",
        exercises: rows(6, "work"),
        sets: [],
        durationMin: 30,
        weightKg: nearestWeight(weighIns, "2026-03-08", 99),
      });

    expect(cost([...MARCH, { date: "2026-09-01", weightKg: 79 }])).toEqual(cost(MARCH));
  });

  test("looks forward as well as back", () => {
    // A session in the program's first fortnight predates the first weigh-in.
    // The reading a week later is a better answer than a starting figure typed
    // into a profile months earlier, which is the fallback it beats.
    expect(nearestWeight(MARCH, "2026-02-25", 99)).toBe(88);
  });

  test("breaks a tie toward the earlier reading", () => {
    const evenly: WeighIn[] = [
      { date: "2026-03-05", weightKg: 90 },
      { date: "2026-03-15", weightKg: 80 },
    ];

    // Five days either side. The earlier one wins, and it wins whichever order
    // the rows arrive in — a tie-break that depended on that would make the
    // figure depend on a query's ORDER BY.
    expect(nearestWeight(evenly, "2026-03-10", 99)).toBe(90);
    expect(nearestWeight([...evenly].reverse(), "2026-03-10", 99)).toBe(90);
  });

  test("falls back to the starting weight when there are no weigh-ins", () => {
    // A new account has a profile and no logs, which is the ordinary case here
    // rather than a defensive one.
    expect(nearestWeight([], "2026-03-08", 99)).toBe(99);
  });

  test("a weigh-in on the session's own date is used", () => {
    expect(nearestWeight([...MARCH, { date: "2026-03-08", weightKg: 87 }], "2026-03-08", 99)).toBe(
      87,
    );
  });
});
