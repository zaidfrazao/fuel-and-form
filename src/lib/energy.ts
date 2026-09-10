import { type CalendarDate, daysBetween } from "./date";
import { WALK_TYPE } from "./resolve-training";
import { WORKING_SECTION } from "./section";

/**
 * What a session cost, estimated — § P10's energy figure, FUEL-95.
 *
 * The standard MET formula, `kcal/min = MET × 3.5 × bodyweight_kg / 200`,
 * against the bodyweight of the weigh-in nearest the session's own date.
 *
 * ## The constraint this file exists to hold
 *
 * **The figure is never subtracted from `target_kcal`, never added to a day's
 * remaining allowance, and never combined with any macro total — not in the UI,
 * not in the export, not in a summary anywhere.** PRD § P10 states it and
 * `energy.convention.test.ts` enforces it mechanically, by refusing any import
 * of this module from the modules that do intake arithmetic.
 *
 * The reason is the asymmetry between the two sides. Intake here is MEASURED:
 * `macros.ts` sums stored per-serving figures in fixed point precisely because
 * "binary floating point accumulates a visible error over a fortnight of totals"
 * and "a total that disagrees with the sum of its parts is a real defect". What
 * this file produces is a population average with a wide error bar — wide enough
 * that it is not a number at all but a pair of them. Netting a modelled figure
 * against a measured one produces something that looks like arithmetic and is
 * not, and in a deficit it is the specific mistake that eats the deficit, which
 * is the whole premise of the program the PRD describes.
 *
 * So it is shown BESIDE the day's numbers and never inside them, and this module
 * is the only place the arithmetic lives.
 *
 * ## Why a range, and what its bounds actually are
 *
 * A single kcal figure would claim a precision this method does not have, in the
 * same way a percentage was the wrong answer for § Adherence — that section
 * "shows the pattern and refuses to grade it", and the dot grid exists because
 * of it. A ± that is not derived from anything would be decoration, so both
 * bounds here are the product of two independently-sourced bands:
 *
 *   low  = MET_low  × duration_low
 *   high = MET_high × duration_high
 *
 * The **MET band** is the activity's own spread — a compendium value for
 * 'circuit training' is a range because the population it was measured over is.
 * The **duration band** is exact when a duration was logged (both bounds are the
 * logged figure) and a spread when it was modelled from sets. The two are
 * multiplied corner to corner, which is the widest honest reading: nothing here
 * knows that a session run at the top of its MET band was also run long.
 *
 * ## The measured widths, and the ceiling they justify
 *
 * At the demo persona's weight, as this file actually computes them:
 *
 * | Case                                    | Range        | Width |
 * |-----------------------------------------|--------------|-------|
 * | circuit, 30 min LOGGED, all work        | 190–320 kcal | 1.6×  |
 * | circuit, 30 min LOGGED, 2 / 6 / 2 rows  | 150–240 kcal | 1.6×  |
 * | intervals, 25 min LOGGED                | 260–400 kcal | 1.5×  |
 * | circuit, MODELLED from 15 sets of 12    | 100–350 kcal | 3.2×  |
 *
 * The logged ones are honest and readable, and every one of them is the MET
 * band's own width and nothing else. The last is the case FUEL-95 predicted when
 * it said "if the honest range turns out to be so wide it says nothing, that is
 * a finding worth reporting, and no number beats a wide one dressed up as a
 * narrow one". `100–350 kcal` is that number: it spans a light half-hour and a
 * hard hour, and a reader who acted on either end would be acting on noise.
 *
 * `MAX_WIDTH_RATIO` below is the answer, and it is deliberately a RULE about
 * width rather than a special case about modelled durations. Stated as "no
 * estimate without a logged duration" it would be a fact about today's
 * constants; stated as a ceiling it is an invariant a test can pin, it keeps the
 * set-derived duration live behind it rather than leaving dead code, and a
 * tighter duration model later is measured against it rather than exempted
 * from it.
 *
 * **What that means today, stated plainly rather than left to be discovered:**
 * no modelled duration passes the ceiling. Every modelled band is a factor of
 * two wide and the narrowest MET band is 1.5, so the product is never under 3.
 * The estimate therefore appears only against a session whose duration was
 * written down. The model is still computed, still exported and still asserted
 * — see `modelledMinutes` — because the constants would otherwise be
 * unconstrained, and because what changes this is a tighter model rather than a
 * softer ceiling.
 *
 * ## Pure, and given its values
 *
 * No database, no clock, no `server-only`, and structural parameter types — the
 * contract `section.ts`, `exercise-set.ts` and `resolve-plan.ts` all keep. That
 * is not tidiness here, it is what lets `training.tsx` compute the figure from
 * its OWN optimistic state: the screen has no revalidation, so a server-computed
 * estimate would sit stale beside a duration box the reader had just saved.
 * § Feedback is "optimistic by default", and this is the module being importable
 * that makes the estimate obey it.
 */

/**
 * A low and a high bound.
 *
 * One type for all four bands here — METs, seconds per rep, rest, minutes —
 * because they compose: every bound below is the product of a `low` with a
 * `low` and a `high` with a `high`, and a second shape spelling the same two
 * fields would be a second thing to keep in step.
 */
export type Band = { low: number; high: number };

/**
 * The MET band per `workouts.type`, and the reason a lookup can miss.
 *
 * `workouts.type` is deliberately open text — schema.ts argues it at length, and
 * the short version is that a Postgres enum would make the gym restart
 * `ALTER TYPE ... ADD VALUE`, which is a migration, which is what the PRD's
 * gym-restart claim rules out. The consequence lands here: this table must have
 * a defined answer for a type it has never seen, and that answer is **nothing**.
 * A missing MET renders no estimate; it does not render a zero, because a zero
 * is a claim that the session cost nothing.
 *
 * The `walk` entry arrived with FUEL-104 and is the FALLBACK half of the walk's
 * estimate, not the whole of it. FUEL-95 deferred the walk to P11 "where a
 * measured distance and duration make a much better estimate than a MET guess",
 * and `WALK_PACE_POINTS` below is that better estimate; this entry is what a
 * walk is costed at when it has no distance to derive a pace from. Until
 * FUEL-104 there was no entry at all and the deferral was expressed by the
 * lookup missing — that is no longer true, and the reason it changed is that a
 * walk with a duration and no distance is a real case (a one-tap walk, and
 * every walk logged before P11) which was rendering no estimate rather than the
 * honest wide one.
 *
 * Values are the Compendium of Physical Activities' bands for the three things
 * this program actually schedules: general circuit training and calisthenics
 * (5.0–8.0), rope-skipping intervals (8.0–12.0), and walking at an unknown pace
 * (2.8–4.3, the compendium's 3.2 km/h and 5.6 km/h figures — see
 * `WALK_PACE_POINTS` for why those two bound "an ordinary walk").
 */
/**
 * What a walk is costed at when its pace is not known — the fallback rung of
 * `walkBand`'s ladder, and `MET_BANDS[WALK_TYPE]`'s value.
 *
 * A named constant rather than a literal inside the table because `walkBand`
 * returns it directly. Reaching it back out of `MET_BANDS` would be an index
 * into a `Record<string, Band>`, which is `Band | undefined` — so the one
 * function guaranteeing a walk always has a band would need a non-null
 * assertion to say so. Naming the value moves that guarantee into the types.
 *
 * The bounds are the compendium's figures for 3.2 km/h and 5.6 km/h, which is
 * the span `WALK_PACE_POINTS` covers between "slow" and "brisk" — an ordinary
 * walk, in other words, with neither end of the table's stroll or its charge
 * included. A walk whose pace is unknown is far likelier to be an ordinary one
 * than either extreme, and widening this to the table's full 2.0–7.0 would
 * trip `MAX_WIDTH_RATIO` and render nothing at all.
 */
export const WALK_UNKNOWN_PACE_BAND: Band = { low: 2.8, high: 4.3 };

export const MET_BANDS: Record<string, Band> = {
  circuit: { low: 5.0, high: 8.0 },
  intervals: { low: 8.0, high: 12.0 },
  [WALK_TYPE]: WALK_UNKNOWN_PACE_BAND,
};

/**
 * What walking costs at the paces the Compendium of Physical Activities quotes
 * it at — § P11's estimate, FUEL-104.
 *
 * ## Why a walk gets its own table when no other type does
 *
 * A walk has something a circuit does not: a MEASURED DISTANCE. Distance over
 * duration is a pace, and pace is most of what determines what walking costs —
 * a 6 km/h walk and a 3 km/h stroll are genuinely different rates and the app
 * can tell them apart, which is exactly the reason FUEL-95 refused to guess a
 * single walking MET and deferred to here.
 *
 * ## The band between two points, rather than a point with an invented spread
 *
 * A pace lands between two of these entries and takes the METs of the two it
 * falls between. So every bound this file prints for a walk is a compendium
 * figure rather than one of ours, and the WIDTH of the range is the width of
 * the bracket the walk's pace fell in — which is the honest statement of what a
 * pace can and cannot pin down. The alternative, a central MET ± some
 * percentage, would have required inventing the percentage.
 *
 * The bands come out narrower than `MET_BANDS[WALK_TYPE]`, and that is the
 * point: a measurement replaced a guess, so the estimate got tighter. It does
 * not get tighter than `KCAL_STEP`, which still rounds both bounds outward to
 * ten kcal and still refuses a range narrower than one step.
 *
 * ## What is NOT modelled, said out loud
 *
 * Individual variation. The compendium's figures are population averages and
 * two people walking at 5 km/h do not burn identically. Nothing in this app
 * measures what would be needed to model that, so it is not modelled and the
 * range should not be read as covering it. § P11's requirement that the figure
 * present as an estimate is what carries this to the reader; the alternative —
 * padding the band by a made-up factor to look suitably humble — would put a
 * number in the file that no source could be given for.
 *
 * ## The ends
 *
 * Below 2.4 km/h and above 7.2 km/h a walk is off this table, and
 * `paceBand` treats that as a distance it cannot believe rather than as a very
 * slow or very fast walk. See there.
 */
export const WALK_PACE_POINTS: readonly { kmh: number; met: number }[] = [
  { kmh: 2.4, met: 2.0 },
  { kmh: 3.2, met: 2.8 },
  { kmh: 4.0, met: 3.0 },
  { kmh: 4.8, met: 3.5 },
  { kmh: 5.6, met: 4.3 },
  { kmh: 6.4, met: 5.0 },
  { kmh: 7.2, met: 7.0 },
];

/**
 * The MET band for a walk that covered `distanceM` metres in `durationMin`
 * minutes, or `undefined` where no pace can be believed.
 *
 * Four ways to get nothing, and each is a real row rather than a defensive one:
 *
 *   - No distance. A one-tap walk, and every walk logged before P11.
 *   - No duration, or a non-positive one. `sessionEnergy` has already reduced
 *     the latter to `null`; this repeats the `> 0` test because the function is
 *     exported and a caller could hand it anything.
 *   - A non-positive distance, for the same reason — zero metres over twenty
 *     minutes is not a stationary walk, it is a row nobody wrote.
 *   - A pace off the ends of `WALK_PACE_POINTS`.
 *
 * That last one is a judgement and it is worth stating. A walk averaging 12
 * km/h is not a fast walk, it is a distance or a duration that is wrong — a
 * mistyped figure, a forged write, or a recording that kept running in a car.
 * Clamping to the top of the table would answer it with a confident 7-MET
 * brisk-walk price. Returning `undefined` instead hands it back to
 * `MET_BANDS[WALK_TYPE]`, so the walk is still costed, but on its duration
 * alone and at the wide band that says the pace was not known. The same
 * applies under 2.4 km/h, which is a walk with more standing in it than
 * walking, and where the duration is the more trustworthy of the two numbers.
 */
export function paceBand(
  distanceM: number | null,
  durationMin: number | null,
): Band | undefined {
  if (distanceM === null || distanceM <= 0) return undefined;
  if (durationMin === null || durationMin <= 0) return undefined;

  const kmh = (distanceM / 1000) * (60 / durationMin);

  // Walked as adjacent pairs rather than by index, which keeps the bounds check
  // out of it entirely — there is no `i + 1` to run off the end of.
  let slower: { kmh: number; met: number } | undefined;

  for (const faster of WALK_PACE_POINTS) {
    // The bracket is closed at BOTH ends, so a pace landing exactly on an
    // interior point takes the band below it rather than falling through to
    // the one above. Either is defensible; what is not is having no rule and
    // letting the loop's direction decide.
    if (slower && kmh >= slower.kmh && kmh <= faster.kmh) {
      return { low: slower.met, high: faster.met };
    }

    slower = faster;
  }

  return undefined;
}

/**
 * The band a warm-up or a cool-down is costed at — stretching and light
 * mobility.
 *
 * FUEL-92 exists so that "a mobility drill is a row distinguishable from a
 * working set", and schema.ts names this file when it says why: without the
 * section column "FUEL-95 would count it at the working exercise's MET". So the
 * non-working parts are costed at their own lower rate.
 *
 * Costed rather than EXCLUDED, which was the other option the ticket offered.
 * Excluding them would make the estimate depend on how a session happens to be
 * divided — the same eight minutes of the same movements would cost more when
 * nobody had marked them as a warm-up — and a warm-up is time spent moving, so
 * pricing it at zero is the same false claim as pricing an unknown type at zero.
 *
 * An unrecognised section takes this band too, which is `section.ts`'s own
 * conservatism: "an unrecognised section is NOT working", and a part of a
 * session this build has never heard of does not get the working rate until
 * somebody decides it should.
 */
export const SUPPORT_BAND: Band = { low: 2.0, high: 3.0 };

/**
 * How long one logged set takes, in seconds, when nobody wrote a duration down.
 *
 * Sets and reps were § P10's original ask and are the weaker half of it: reps
 * say how much work happened, not how long it took, and the formula is a rate.
 * So they feed the DURATION and nothing else, and only where `duration_min` is
 * absent — a measured number beats a modelled one, always.
 *
 * The model is `reps × SECONDS_PER_REP + REST_SECONDS`, per set. Two to four
 * seconds a rep covers the range from a fast bodyweight squat to a controlled
 * push-up; forty to eighty seconds of rest takes the seed's own '40 sec on /
 * 40 sec off' as its floor and twice that as its ceiling.
 *
 * Both bands are a factor of two wide, so the modelled duration is a factor of
 * two wide however many reps are in it. That is the honest statement of what is
 * known here — a set takes somewhere between about a minute and about two — and
 * it is also why the compounded figure trips `MAX_WIDTH_RATIO`. See the module
 * comment's table.
 *
 * Targets are deliberately not consulted. `target_sets` is what was ASKED for
 * and an `exercise_sets` row is what happened; costing a session by its
 * prescription would put a price on a workout nobody performed. The prescription
 * string itself is not read at all, here or anywhere — schema.ts calls it
 * "displayed verbatim, never parsed", and a duration regexed out of prose reads
 * 8 for '8–12 rounds'.
 */
export const SECONDS_PER_REP: Band = { low: 2, high: 4 };

/** The rest between two sets. See `SECONDS_PER_REP` for both bounds. */
export const REST_SECONDS: Band = { low: 40, high: 80 };

/**
 * How wide a range may be before it stops saying anything — high ÷ low.
 *
 * 2.5 sits above every logged-duration case this build can produce (1.6× for a
 * circuit, 1.5× for intervals — the MET band alone) and below the compounded
 * modelled one (3.2×). The module comment argues why this is a ceiling on WIDTH
 * rather than a rule about logged durations.
 *
 * Measured on the raw figures, before rounding: it is a property of the method,
 * not of the printer.
 */
export const MAX_WIDTH_RATIO = 2.5;

/**
 * What both bounds are rounded to.
 *
 * Ten kcal, outward, so the printed figure never carries a digit the method
 * could defend. The same instinct as § Adherence's dot grid — the presentation
 * is not allowed to be more precise than the thing being presented.
 */
export const KCAL_STEP = 10;

/** An estimate. Two figures, because one would be a claim. */
export type EnergyRange = { lowKcal: number; highKcal: number };

/** A weigh-in, as `weight_logs` stores it and as this file needs it. */
export type WeighIn = { date: CalendarDate; weightKg: number };

/** What a session's cost is computed from. Structural — see the module note. */
export type EnergyInput = {
  /** `workouts.type`. A value with no MET band yields no estimate. */
  type: string;
  /** The session's rows, for their sections only. */
  exercises: readonly { section: string }[];
  /** The sets performed on this date, against this session — FUEL-91's rows. */
  sets: readonly { reps: number }[];
  /** `workout_logs.duration_min`. Wins outright over the modelled duration. */
  durationMin: number | null;
  /**
   * `workout_logs.distance_m` — the walk's measured distance, and null for
   * everything else in the table.
   *
   * Read only for a walk (see `sessionEnergy`), because it is the only type
   * with a pace table to look a distance up in. A distance on a circuit would
   * be ignored rather than rejected: the column is nullable for every session
   * and a value there would be data this file has no model for, not an error.
   */
  distanceM: number | null;
  /** From `nearestWeight`, never from "the latest weigh-in". */
  weightKg: number;
};

/**
 * The bodyweight a session on `date` is costed at.
 *
 * The weigh-in NEAREST that date, not the latest one, which is the whole of
 * FUEL-95's determinism criterion: a session in March is costed at March's
 * weight and does not silently re-price itself every time a new weigh-in lands.
 * Deriving it rather than storing a `weight_kg` column on the log follows the
 * plan-resolution precedent — deterministic from the date, so it never drifts
 * and never depends on when it was computed.
 *
 * Nearest in BOTH directions rather than the last one on or before. A program's
 * first fortnight has sessions before its first weigh-in, and the honest weight
 * for those is the one measured a week later rather than a starting figure typed
 * into a profile months earlier.
 *
 * A tie — a session exactly between two weigh-ins — takes the EARLIER reading.
 * A tie needs a rule that does not depend on the order rows arrived in, and of
 * the two available the earlier one is the weight already measured when the
 * session happened rather than one measured after it.
 *
 * `profiles.start_weight_kg` is the fallback, and it is a real case rather than
 * a defensive one: a new account has a profile and no logs at all.
 *
 * Takes a list of ANY length, though `loadTraining` passes exactly two — the
 * last weigh-in on or before the date and the first after it, which is where the
 * nearest one must be. The function does not know that and does not rely on it:
 * a caller with a whole history in hand gets the same answer, because the scan
 * is over every candidate rather than over an assumed pair.
 */
export function nearestWeight(
  weighIns: readonly WeighIn[],
  date: CalendarDate,
  fallbackKg: number,
): number {
  let best: { weightKg: number; distance: number; after: boolean } | undefined;

  for (const weighIn of weighIns) {
    // Positive when the weigh-in is AFTER the session — `daysBetween(from, to)`.
    const offset = daysBetween(date, weighIn.date);
    const candidate = {
      weightKg: weighIn.weightKg,
      distance: Math.abs(offset),
      after: offset > 0,
    };

    if (
      !best ||
      candidate.distance < best.distance ||
      // The tie-break, and the only thing `after` is for.
      (candidate.distance === best.distance && best.after && !candidate.after)
    ) {
      best = candidate;
    }
  }

  return best?.weightKg ?? fallbackKg;
}

/**
 * The minutes one part of a session took, as a band.
 *
 * With a logged duration this apportions it across the sections by their share
 * of the session's exercise rows — a row being the only proxy for time this data
 * carries. It is a model on top of a measurement, and it is confined to
 * splitting a number that is itself exact: the session's total minutes are the
 * logged ones however the shares fall.
 *
 * With no rows at all the whole duration falls to the working band, which is the
 * only sensible reading of "a session that lasted 30 minutes and lists nothing".
 */
function apportion(durationMin: number, share: number): Band {
  return { low: durationMin * share, high: durationMin * share };
}

/**
 * The minutes the logged sets imply, as a band — see `SECONDS_PER_REP`.
 *
 * Sets are logged against working rows only (`section.ts`'s `working()`), so a
 * modelled duration covers the WORK and nothing else. That is a real consequence
 * worth naming rather than hiding: the section split does its job when a
 * duration was logged, and when one was not there is no warm-up time to
 * apportion because nothing recorded that a warm-up happened.
 *
 * **Exported because at today's constants nothing else can observe it.** Every
 * modelled band is a factor of two wide and every MET band is at least 1.5, so
 * the product always exceeds `MAX_WIDTH_RATIO` and `sessionEnergy` always
 * refuses — which would leave `SECONDS_PER_REP` and `REST_SECONDS` as four
 * numbers no test could constrain, changeable without a single failure. That is
 * the vacuous-coverage trap this project has hit before, so the model is part of
 * the module's surface and is asserted directly.
 */
export function modelledMinutes(sets: readonly { reps: number }[]): Band {
  let low = 0;
  let high = 0;

  for (const set of sets) {
    low += set.reps * SECONDS_PER_REP.low + REST_SECONDS.low;
    high += set.reps * SECONDS_PER_REP.high + REST_SECONDS.high;
  }

  return { low: low / 60, high: high / 60 };
}

/**
 * The band a walk is costed at — the two-step ladder § P11 asks for.
 *
 * Pace where a distance exists, the wide unknown-pace band where it does not.
 * Never nothing: `MET_BANDS[WALK_TYPE]` is a constant of this module, so this
 * function cannot return `undefined` and a walk therefore never falls out of
 * `sessionEnergy` for want of a band. The ticket's "falls back cleanly where it
 * does not, and never yields zero" is kept HERE, by the fallback existing,
 * rather than by a zero being filtered out somewhere downstream.
 *
 * A walk with no duration still yields no estimate, and that happens below
 * rather than here — it has no minutes for any band to be applied to. That is
 * the one gap the ladder deliberately does not fill, because filling it would
 * mean inventing how long the walk was.
 */
function walkBand(input: EnergyInput, loggedMin: number | null): Band {
  return paceBand(input.distanceM, loggedMin) ?? WALK_UNKNOWN_PACE_BAND;
}

/**
 * What a session cost, or `null` for a session this method has nothing to say
 * about.
 *
 * `null` in four cases, and every one of them is "no number" rather than a zero:
 * a `workouts.type` with no MET band, a session with no logged duration and no
 * logged sets, a bodyweight of nothing, and a range too wide to mean anything.
 * See `MAX_WIDTH_RATIO` for the last.
 *
 * The walk is no longer among the first of those — FUEL-104 gave it a band, and
 * `walkBand` below is the two-step ladder it resolves through. What a walk can
 * still return `null` for is the second case: a walk with no duration at all
 * has no minutes to price and no sets to model them from, which is a walk
 * nobody recorded rather than a walk that cost nothing.
 */
export function sessionEnergy(input: EnergyInput): EnergyRange | null {
  // A non-positive duration is treated as no duration. `session-entry.ts`
  // refuses one at the edge, so this is only ever a forged write — and the
  // honest reading of "this session lasted −5 minutes" is that nobody said.
  const logged =
    input.durationMin !== null && input.durationMin > 0 ? input.durationMin : null;

  // Resolved before the row shares below because a walk's band depends on its
  // DURATION as well as its type — everything else here is keyed by type alone.
  const band = input.type === WALK_TYPE ? walkBand(input, logged) : MET_BANDS[input.type];

  if (!band) return null;

  const rows = input.exercises.length;
  const workRows = input.exercises.filter(
    (exercise) => exercise.section === WORKING_SECTION,
  ).length;

  // Where the two bands apply. With a logged duration the session's minutes are
  // split by row share; with a modelled one the sets ARE the working minutes and
  // there is no support time to account for.
  const workMinutes =
    logged === null
      ? modelledMinutes(input.sets)
      : apportion(logged, rows === 0 ? 1 : workRows / rows);
  const supportMinutes =
    logged === null
      ? { low: 0, high: 0 }
      : apportion(logged, rows === 0 ? 0 : (rows - workRows) / rows);

  // kcal/min = MET × 3.5 × kg / 200 — the standard formula, written once.
  const rate = (met: number) => (met * 3.5 * input.weightKg) / 200;

  const low =
    rate(band.low) * workMinutes.low + rate(SUPPORT_BAND.low) * supportMinutes.low;
  const high =
    rate(band.high) * workMinutes.high + rate(SUPPORT_BAND.high) * supportMinutes.high;

  // No evidence, or no bodyweight. One guard rather than three, on
  // `weight-stats.ts`'s reasoning: a second check that never fires on its own is
  // a branch the coverage gate calls covered while nothing constrains it.
  if (high <= 0) return null;

  // Measured on the raw figures, before rounding — the width is a property of
  // the method, not of the printer.
  if (high / low > MAX_WIDTH_RATIO) return null;

  const lowKcal = Math.max(KCAL_STEP, Math.floor(low / KCAL_STEP) * KCAL_STEP);

  return {
    lowKcal,
    // Never narrower than the step itself: a range inside one rounding
    // increment is a precision the rounding has already thrown away.
    highKcal: Math.max(Math.ceil(high / KCAL_STEP) * KCAL_STEP, lowKcal + KCAL_STEP),
  };
}
