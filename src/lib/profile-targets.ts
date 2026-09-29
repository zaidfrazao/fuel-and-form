import type { Profile } from "./db/schema";
import { MAX_HEIGHT_CM, MIN_HEIGHT_CM } from "./steps";
import { DECIMAL, MAX_KG, MIN_KG, parseWeightKg } from "./weigh-in";

/**
 * Settings' side of the profile's figures — FUEL-136, PRD § P7's "or entered in
 * the app".
 *
 * Until this module the only way to change a macro target, a goal weight, the
 * pace, the height or the timezone was the gitignored seed script, run against
 * production. PRD § Target Users recalibrates targets "every ~5kg lost", so that
 * was a script run every couple of months for what is one form.
 *
 * ## A module, for `slot-times.ts`'s reason
 *
 * The values arrive through a Server Action, which anyone who can POST can
 * reach, and the columns behind them carry no CHECK. So an unvalidated value is
 * not refused by the database — it is STORED, and then every screen reads it: a
 * dropped separator in the kcal target makes `/`'s whole macro grid read ten
 * times over. The refusal has to be here, and here is where a test can hold it
 * still.
 *
 * ## Every field is required
 *
 * Unlike a slot time, none of these has a blank that means something. The
 * columns are NOT NULL and every screen assumes a number, so a cleared field is
 * refused rather than read as "leave it alone" — a form that silently kept the
 * old value for a field it showed as empty would be showing one number and
 * storing another.
 *
 * ## All or nothing
 *
 * `slot-times.ts`'s rule and reason: one bad field refuses the submission, and
 * the errors come back per field.
 *
 * ## Pure, and safe for the browser
 *
 * Only type imports from the schema, and two modules that are themselves kept
 * free of pg-core so client components can import their bounds. The form reads
 * the field names and the bounds from here.
 */

/** The columns this form writes. */
export type ProfileTargets = Pick<
  Profile,
  | "targetKcal"
  | "targetProteinG"
  | "targetFatG"
  | "targetCarbG"
  | "startWeightKg"
  | "targetWeightKg"
  | "goalPaceKgPerWeek"
  | "heightCm"
  | "timezone"
>;

/** Field name → what is wrong with it. */
export type TargetErrors = Record<string, string>;

export type TargetsParseResult =
  | { ok: true; update: ProfileTargets }
  | { ok: false; errors: TargetErrors };

/**
 * Form field names, prefixed like `slot.` and `workout.` in slot-times.ts.
 *
 * Deliberately NOT the column names. `check-no-metrics.sh` treats a literal
 * assigned to a profile column name as a body metric, so a test fixture keyed by
 * these names can carry an out-of-range probe without the scan mistaking it for
 * someone's figure.
 */
export const TARGET_FIELD = {
  kcal: "target.kcal",
  protein: "target.protein",
  fat: "target.fat",
  carb: "target.carb",
  startWeight: "weight.start",
  goalWeight: "weight.goal",
  pace: "weight.pace",
  height: "profile.height",
  timezone: "profile.timezone",
} as const;

/**
 * Bounds on the daily energy target.
 *
 * What they buy is the typo, as `MIN_KG` argues for weigh-ins: a dropped digit
 * or a doubled one lands outside, and every target a person could plausibly be
 * given lands inside. Not a judgement about anyone's intake.
 */
export const MIN_KCAL = 800;
export const MAX_KCAL = 6000;

/** A macro target in grams — `numeric(6, 1)`, so one decimal is kept. */
export const MAX_MACRO_G = 999.9;

/**
 * The goal pace in kilograms a week — `numeric(4, 2)`.
 *
 * A magnitude, not a signed rate: `weight-stats.ts` states its pace band in
 * LOSS, "the direction the pace is configured in". Zero is refused because a
 * pace of nothing is not a pace, and `onPace` would then call every stalled
 * week on target.
 */
export const MIN_PACE_KG = 0.05;
export const MAX_PACE_KG = 2;

const INTEGER = /^\d+$/;

/** Rounds to `places` decimals — the app decides, not `numeric`'s silent rounding. */
function round(value: number, places: number): number {
  const factor = 10 ** places;

  return Math.round(value * factor) / factor;
}

/** A decimal from one untrusted field, on `parseWeightKg`'s grammar. */
function parseDecimal(
  value: unknown,
  places: number,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();

  if (!DECIMAL.test(trimmed)) return undefined;

  const number = round(Number(trimmed.replace(",", ".")), places);

  // After rounding, for `parseWeightKg`'s reason: the rounded value is what
  // would be stored, so it is the one the bound has to describe.
  return number >= min && number <= max ? number : undefined;
}

/** A whole number from one untrusted field. `172.5` is refused, not truncated. */
function parseInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();

  if (!INTEGER.test(trimmed)) return undefined;

  const number = Number(trimmed);

  return number >= min && number <= max ? number : undefined;
}

/**
 * The zones the form offers, and the only ones it accepts.
 *
 * `Intl`'s own list, so the select and the refusal cannot disagree. `UTC` is
 * added because some ICU builds leave it out of the list while every one of them
 * accepts it — and a profile set to UTC must be able to save without moving.
 *
 * Computed on the SERVER and handed to the form as a prop. A browser's ICU is
 * not the server's, and a list built on both sides would be a hydration
 * mismatch the first time they differed by one zone.
 */
export function supportedTimezones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");

  return zones.includes("UTC") ? zones : [...zones, "UTC"].sort();
}

const MACRO_MESSAGE = `Enter grams from 0 to ${MAX_MACRO_G}.`;
const WEIGHT_MESSAGE = `Enter a weight in kg between ${MIN_KG} and ${MAX_KG}, like 76.5.`;

/**
 * Reads the submitted form. Nothing reaches the row unless every field passes.
 *
 * `timezones` is the list to accept, passed in rather than read here so a test
 * can hold it still; the action passes `supportedTimezones()`.
 */
export function parseProfileTargets(
  form: FormData,
  timezones: readonly string[],
): TargetsParseResult {
  const errors: TargetErrors = {};
  const field = (name: string) => form.get(name);

  const targetKcal = parseInteger(field(TARGET_FIELD.kcal), MIN_KCAL, MAX_KCAL);
  if (targetKcal === undefined) {
    errors[TARGET_FIELD.kcal] = `Enter a whole number from ${MIN_KCAL} to ${MAX_KCAL}.`;
  }

  const targetProteinG = parseDecimal(field(TARGET_FIELD.protein), 1, 0, MAX_MACRO_G);
  if (targetProteinG === undefined) errors[TARGET_FIELD.protein] = MACRO_MESSAGE;

  const targetFatG = parseDecimal(field(TARGET_FIELD.fat), 1, 0, MAX_MACRO_G);
  if (targetFatG === undefined) errors[TARGET_FIELD.fat] = MACRO_MESSAGE;

  const targetCarbG = parseDecimal(field(TARGET_FIELD.carb), 1, 0, MAX_MACRO_G);
  if (targetCarbG === undefined) errors[TARGET_FIELD.carb] = MACRO_MESSAGE;

  // The weigh-in's own parser, not a copy of it: a goal weight the weigh-in
  // screen would refuse is a goal no reading could ever reach, and one grammar
  // for "a weight" means a comma that works there works here.
  const startWeightKg = parseWeightKg(field(TARGET_FIELD.startWeight));
  if (startWeightKg === undefined) errors[TARGET_FIELD.startWeight] = WEIGHT_MESSAGE;

  const targetWeightKg = parseWeightKg(field(TARGET_FIELD.goalWeight));
  if (targetWeightKg === undefined) errors[TARGET_FIELD.goalWeight] = WEIGHT_MESSAGE;

  const goalPaceKgPerWeek = parseDecimal(field(TARGET_FIELD.pace), 2, MIN_PACE_KG, MAX_PACE_KG);
  if (goalPaceKgPerWeek === undefined) {
    errors[TARGET_FIELD.pace] = `Enter kg per week from ${MIN_PACE_KG} to ${MAX_PACE_KG}, like 0.5.`;
  }

  // `steps.ts`'s band, imported rather than restated: a height this form
  // accepted and the step estimate then refused would be a walk that silently
  // stopped showing steps.
  const heightCm = parseInteger(field(TARGET_FIELD.height), MIN_HEIGHT_CM, MAX_HEIGHT_CM);
  if (heightCm === undefined) {
    errors[TARGET_FIELD.height] = `Enter a whole number of cm from ${MIN_HEIGHT_CM} to ${MAX_HEIGHT_CM}.`;
  }

  const zone = field(TARGET_FIELD.timezone);
  const timezone = typeof zone === "string" && timezones.includes(zone) ? zone : undefined;
  if (timezone === undefined) errors[TARGET_FIELD.timezone] = "Choose a timezone from the list.";

  if (
    targetKcal === undefined ||
    targetProteinG === undefined ||
    targetFatG === undefined ||
    targetCarbG === undefined ||
    startWeightKg === undefined ||
    targetWeightKg === undefined ||
    goalPaceKgPerWeek === undefined ||
    heightCm === undefined ||
    timezone === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    update: {
      targetKcal,
      targetProteinG,
      targetFatG,
      targetCarbG,
      startWeightKg,
      targetWeightKg,
      goalPaceKgPerWeek,
      heightCm,
      timezone,
    },
  };
}

/** What the form renders from: field name → the stored value as text. */
export function targetFields(stored: ProfileTargets): Record<string, string> {
  return {
    [TARGET_FIELD.kcal]: String(stored.targetKcal),
    [TARGET_FIELD.protein]: String(stored.targetProteinG),
    [TARGET_FIELD.fat]: String(stored.targetFatG),
    [TARGET_FIELD.carb]: String(stored.targetCarbG),
    [TARGET_FIELD.startWeight]: String(stored.startWeightKg),
    [TARGET_FIELD.goalWeight]: String(stored.targetWeightKg),
    [TARGET_FIELD.pace]: String(stored.goalPaceKgPerWeek),
    [TARGET_FIELD.height]: String(stored.heightCm),
    [TARGET_FIELD.timezone]: stored.timezone,
  };
}

/**
 * Whether a save moves what a week is MEASURED AGAINST — the question
 * `profiles.targets_changed_at` answers.
 *
 * The four macro targets, the goal weight and the pace. Not the start weight,
 * which is where the journey began rather than what a week is judged by; not
 * the height, which feeds only the step estimate; and not the timezone.
 */
export function targetsChanged(before: ProfileTargets, after: ProfileTargets): boolean {
  return (
    before.targetKcal !== after.targetKcal ||
    before.targetProteinG !== after.targetProteinG ||
    before.targetFatG !== after.targetFatG ||
    before.targetCarbG !== after.targetCarbG ||
    before.targetWeightKg !== after.targetWeightKg ||
    before.goalPaceKgPerWeek !== after.goalPaceKgPerWeek
  );
}
