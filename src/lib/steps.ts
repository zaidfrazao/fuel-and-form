import { figure } from "./format";

/**
 * A walk's step count — § P11's estimate, and the seam a real one arrives on.
 *
 * `steps = distance / step length`, with the step length derived from
 * `profiles.height_cm`. Pure arithmetic over two numbers, on `energy.ts`'s
 * precedent: a coefficient that carries its source, a refusal in place of a
 * wrong answer, and a display precision chosen to match the accuracy rather
 * than the arithmetic.
 *
 * ## Why estimated at all, since the phone in your pocket already knows
 *
 * **There is no step-counter API on the web.** The Generic Sensor family is
 * Accelerometer, LinearAccelerationSensor, GravitySensor, Gyroscope,
 * Magnetometer, the orientation sensors and ambient light. No pedometer, on any
 * browser or OS; Android's `TYPE_STEP_COUNTER` and iOS's `CMPedometer` are
 * native-only.
 *
 * A DIY peak detector over the raw accelerometer is buildable — Chrome on
 * Android exposes it without the permission gesture iOS demands — and was
 * rejected for the same reason `recording.ts` is foreground-only: the native
 * counters run on a low-power coprocessor that keeps counting while the phone
 * is asleep, and a web page cannot. A detector that only counts while the
 * screen is on would undercount every real walk and disagree with the phone's
 * own figure, which is the worst available outcome — a number that is wrong in
 * a way that looks precise.
 *
 * So the figure is estimated, it says so on every screen that draws it
 * (`stepsLabel`), and the origin is stored beside the number so a device count
 * can replace it without anything having to guess which kind it is holding.
 * FUEL-105 is the ticket that would supply one.
 *
 * ## No daily total, and that is enforced rather than intended
 *
 * This is steps FOR A WALK. The app sees no walking outside a recorded walk, so
 * a "daily steps" figure would read low every day while looking like a health
 * metric rather than an app-usage one. `steps.convention.test.ts` refuses any
 * import of this module from the modules that aggregate a day or a week, on
 * `energy.convention.test.ts`'s precedent: the failure mode is the file nobody
 * thought to write a test for, and an import is the one thing a daily total
 * cannot be built without.
 *
 * ## Pure, and the direction the dependency runs
 *
 * No database access, no `server-only`, and nothing imported but `format.ts`.
 * `schema.ts` imports `STEP_SOURCES` from here to build its enum — the same
 * direction `MEDIA_KINDS`, `SECTIONS` and `MAX_ROUTE_POINTS` already run, and
 * the reason `walk-row.tsx` can call `stepsLabel` in the browser without
 * dragging pg-core into the bundle.
 */

/**
 * The step length a height implies, as a fraction of that height.
 *
 * **STEP length, not STRIDE length, and the difference is a factor of two.** A
 * stride is two steps — one full gait cycle, left heel-strike to left
 * heel-strike — and the two words are used interchangeably in casual writing,
 * including in the ticket that asked for this. Dividing a distance by a stride
 * would halve every count in the app. The corresponding stride ratio is
 * ~0.83 × height; this is half of it.
 *
 * The figure is the commonly cited stature ratio from forensic gait work,
 * ~0.415 for men and ~0.413 for women, taken as one value because this app
 * stores no sex and the two differ by less than the rounding below can show.
 *
 * Sanity check against the demo persona: 172cm × 0.414 = 71.2cm per step, so
 * ~1,405 steps per kilometre — inside the usual 1,250–1,550 band, which is the
 * check worth doing on any coefficient that is a ratio of one measurement to
 * another.
 *
 * It is right for a walking pace and wrong for a stroll or a march, which is
 * precisely why the figure it produces is drawn with a `~` in front of it and
 * rounded to two significant figures.
 */
export const STEP_LENGTH_TO_HEIGHT = 0.414;

/**
 * The heights this model will answer for, in centimetres.
 *
 * § P11: *"A profile with no height (or an implausible one) yields no estimate
 * rather than a wrong one."* `profiles.height_cm` is `NOT NULL` so a missing
 * height is unreachable through the schema, but this function is pure and takes
 * whatever it is given — a hand-edited row, a future import, a settings screen
 * with a typo in it.
 *
 * The band is adult heights rather than the human record: the ratio above is
 * calibrated on adult gait and says nothing useful about a child's, so a bound
 * that admitted 90cm would be a bound that let a wrong answer through while
 * looking careful. A refusal here is a walk that shows a distance and no step
 * figure, which is a state every screen already renders — a one-tap walk is
 * that state — so nothing has to be designed for it.
 */
export const MIN_HEIGHT_CM = 120;
export const MAX_HEIGHT_CM = 220;

/**
 * The ceiling `workout_logs.steps` is checked against.
 *
 * Derived rather than picked, which is what makes it defensible: the distance
 * column is already capped at 100,000m, and the shortest step length a
 * plausible height yields is 120 × 0.414 = 49.7cm — so no estimate this module
 * can produce exceeds ~201,000, and nothing below a walk of that shape is
 * excluded by rounding down to 200,000. `steps.test.ts` asserts the relation
 * rather than trusting this paragraph.
 *
 * A device count is bounded by the same number, which is a judgement rather
 * than a derivation: 200,000 steps in one walk is roughly 140km on foot, far
 * past § P3's twice-daily walk and far past the point where the figure means
 * anything. The bound exists for the reason the distance bound does — without
 * it a forged or faulty write stores 1e9 and the export presents it as fact.
 */
export const MAX_STEPS = 200_000;

/**
 * Where a step count came from — the seam this ticket exists to build.
 *
 * A closed vocabulary of exactly two, and closed by argument rather than by
 * convenience: a figure from a coprocessor and a figure from a division are
 * different claims, and there is no third kind. `schema.ts` builds its
 * `step_source` enum from this array, so the database and the display cannot
 * come to disagree about what the words are.
 *
 * `'device'` is declared with nothing in the app writing it. That is the point
 * — the column and the vocabulary are free to add now and cost a migration on a
 * table with history later, and `queries/training.ts` already refuses to
 * overwrite a row that carries it.
 */
export const STEP_SOURCES = ["estimated", "device"] as const;

export type StepSource = (typeof STEP_SOURCES)[number];

/**
 * Two significant figures, and never a fraction.
 *
 * The rounding is the honest half of this module. The stride model carries
 * something like ±10% for an individual, so a figure written to the unit —
 * 4,317 — is a lie with three significant figures it has not earned, and § The
 * Four Rules' stance is to show the pattern and refuse to grade it. Two
 * significant figures caps the displayed precision at roughly ±5%, comfortably
 * inside the model's own error.
 *
 * **Rounding to the nearest hundred was the obvious alternative and is wrong**
 * in the one place it matters. It is ±1% at 4,300 and ±50% at 100, and this app
 * records two walks a day, some of them short — so the coarse rule is least
 * accurate exactly where the figures are smallest. Significant figures are
 * precision proportional to magnitude, which is what "a precision that matches
 * its accuracy" actually means.
 *
 * `Math.max(0, …)` is what keeps the step size at least 1, so the result is an
 * integer at every magnitude: 87 rounds to 87, not to 87.0 and not to 90.
 */
function twoSignificantFigures(value: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);

  return Math.round(value / step) * step;
}

/**
 * A walk's step count, estimated — or `null` where no honest figure exists.
 *
 * Four refusals, and every one of them is § P11's "absent rather than zeroed"
 * rather than a defensive branch:
 *
 *   - **No distance.** A one-tap walk, and every walk logged before P11. There
 *     is nothing to divide, and zero steps is a measurement — it would read as
 *     a walk somebody stood still for.
 *   - **A non-finite or non-positive distance.** Not reachable through
 *     `workout_logs.distance_m`, which is checked at 1..100000, and reachable
 *     through any other caller this module acquires.
 *   - **An implausible height** — see `MIN_HEIGHT_CM`.
 *   - **A figure that rounds to zero**, which is a walk of under half a metre.
 *     The schema forbids it and the arithmetic does not, and returning 0 would
 *     put a row in the database that `workout_logs_steps_range` refuses and a
 *     `0 steps` on a screen that means the opposite of what it says.
 *
 * The result is a whole number of steps, ready to store: this is the figure the
 * column holds and the figure the screen draws, computed once so the row, the
 * sheet and the export cannot each round it their own way.
 */
export function estimateSteps({
  distanceM,
  heightCm,
}: {
  distanceM: number | null;
  heightCm: number | null;
}): number | null {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM <= 0) return null;
  if (heightCm === null || !Number.isFinite(heightCm)) return null;
  if (heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM) return null;

  const stepLengthM = (heightCm * STEP_LENGTH_TO_HEIGHT) / 100;
  const steps = twoSignificantFigures(distanceM / stepLengthM);

  return steps > 0 ? steps : null;
}

/**
 * The figure as the walk's row writes it — `~4,500 steps`.
 *
 * Brand Guide § The Route Trace fixes the Slash line word for word:
 * `/ 3.2 km · 34 min · ~4,300 steps`. The tilde is the label § P11 asks for —
 * *"the figure is labelled as an estimate in the copy"* — and it is the whole
 * of that labelling on the row, because a dense row has no room for a word and
 * the sheet beneath it says the same thing in full.
 *
 * **The tilde is spent by the SOURCE, not printed unconditionally**, which is
 * the one line in this module that makes the seam do visible work today. A
 * count off a coprocessor is measured, not modelled, and drawing `~` in front
 * of it would relabel a real figure as a guess the first time FUEL-105 supplied
 * one. So the branch exists before anything can reach it, and
 * `steps.test.ts` covers both sides.
 */
export function stepsLabel(steps: number, source: StepSource): string {
  return `${source === "estimated" ? "~" : ""}${figure(steps)} steps`;
}

/**
 * The figure as the walk's SHEET writes it — a value and the slash line under
 * it, shaped to drop straight into one `KeyValueItem`.
 *
 * Brand Guide § The Route Trace: the trace's adjacent data table is *"distance,
 * duration, pace, the step estimate and its source, and the route's name when
 * it has one"* — *"the key/value grid § Component Patterns already carries,
 * with nothing invented for it"*. The estimate and its source are ONE grid item
 * rather than two, and the grid already has the slot for the second half: a
 * `meta` line beneath the value, in the Slash register, which is where this app
 * puts every secondary fact about a figure. `macro-grid.tsx` uses it for the
 * same shape — a number, and what to make of it.
 *
 * A `Source` row of its own was the alternative and is refused: it would read
 * `Estimated` for every walk in the app today, which is a column of one
 * repeated value, and this grid's rule is to drop what a walk does not have
 * rather than draw it.
 *
 * **The word was measured into this shape rather than reasoned into it.** It
 * first went in the value — `~2,800 (estimated)` — which fits one line at 1272
 * and wraps to two at 375, where it cost 26px of a sheet that had 36px of slack
 * left. The meta line is its own line at every width, so the composition stops
 * depending on how many characters the number happens to have.
 *
 * The word is what the row's tilde cannot be. `~` alone is a convention a
 * reader has to already know; the sheet is where there is room to say it, and
 * § Accessibility's data table is exactly the surface that should not depend on
 * a glyph being understood.
 */
export function stepsFigure(
  steps: number,
  source: StepSource,
): { value: string; meta: string } {
  return source === "estimated"
    ? { value: `~${figure(steps)}`, meta: "Estimated" }
    : { value: figure(steps), meta: "Counted" };
}
