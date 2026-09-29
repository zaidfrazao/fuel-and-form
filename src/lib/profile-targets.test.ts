import { describe, expect, it } from "vitest";

import {
  MAX_KCAL,
  MAX_MACRO_G,
  MAX_PACE_KG,
  MIN_KCAL,
  MIN_PACE_KG,
  parseProfileTargets,
  type ProfileTargets,
  supportedTimezones,
  TARGET_FIELD,
  targetFields,
  targetsChanged,
} from "./profile-targets";
import { demoProfile } from "./seed/persona";
import { MAX_HEIGHT_CM, MIN_HEIGHT_CM } from "./steps";
import { MAX_KG, MIN_KG } from "./weigh-in";

/**
 * The targets form's trust boundary — FUEL-136.
 *
 * The persona's figures and nothing else. Every valid value below is read off
 * `demoProfile` rather than written out, so no figure in this file is anyone's
 * — and the probes are keyed by FORM field names, which the metrics scan's
 * profile-column pattern does not match, so an out-of-range probe is never
 * mistaken for a body metric.
 */

const persona = demoProfile(new Date("2026-06-17T12:00:00Z"));

const SAM: ProfileTargets = {
  targetKcal: persona.targetKcal,
  targetProteinG: persona.targetProteinG,
  targetFatG: persona.targetFatG,
  targetCarbG: persona.targetCarbG,
  startWeightKg: persona.startWeightKg,
  targetWeightKg: persona.targetWeightKg,
  goalPaceKgPerWeek: persona.goalPaceKgPerWeek,
  heightCm: persona.heightCm,
  timezone: persona.timezone,
};

const ZONES = ["Europe/London", "America/New_York", "UTC"];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(fields)) data.append(name, value);

  return data;
}

/** Sam's form with one field replaced. */
const withField = (name: string, value: string) =>
  form({ ...targetFields(SAM), [name]: value });

const errorsOf = (result: ReturnType<typeof parseProfileTargets>) => {
  if (result.ok) throw new Error("Expected a refusal, got a parse");

  return result.errors;
};

describe("parseProfileTargets", () => {
  it("round-trips the stored values through the form", () => {
    expect(parseProfileTargets(form(targetFields(SAM)), ZONES)).toEqual({
      ok: true,
      update: SAM,
    });
  });

  it("reads a comma as the decimal separator, like a weigh-in", () => {
    const result = parseProfileTargets(
      withField(TARGET_FIELD.goalWeight, String(SAM.targetWeightKg + 0.5).replace(".", ",")),
      ZONES,
    );

    expect(result.ok && result.update.targetWeightKg).toBe(SAM.targetWeightKg + 0.5);
  });

  it("trims whitespace around a value", () => {
    const result = parseProfileTargets(
      withField(TARGET_FIELD.kcal, ` ${SAM.targetKcal} `),
      ZONES,
    );

    expect(result.ok && result.update.targetKcal).toBe(SAM.targetKcal);
  });

  it("rounds a macro to one decimal and the pace to two, as the columns hold them", () => {
    const macro = parseProfileTargets(withField(TARGET_FIELD.protein, "10.26"), ZONES);
    const pace = parseProfileTargets(withField(TARGET_FIELD.pace, "0.456"), ZONES);

    expect(macro.ok && macro.update.targetProteinG).toBe(10.3);
    expect(pace.ok && pace.update.goalPaceKgPerWeek).toBe(0.46);
  });

  it("accepts a macro target of zero", () => {
    const result = parseProfileTargets(withField(TARGET_FIELD.carb, "0"), ZONES);

    expect(result.ok && result.update.targetCarbG).toBe(0);
  });

  /*
   * Each bound on both sides: the last value in, the first value out. A bound
   * asserted from one side only survives being moved.
   */
  it.each([
    [TARGET_FIELD.kcal, String(MIN_KCAL), String(MIN_KCAL - 1)],
    [TARGET_FIELD.kcal, String(MAX_KCAL), String(MAX_KCAL + 1)],
    [TARGET_FIELD.protein, String(MAX_MACRO_G), "1000"],
    [TARGET_FIELD.fat, String(MAX_MACRO_G), "1000"],
    [TARGET_FIELD.carb, String(MAX_MACRO_G), "1000"],
    [TARGET_FIELD.startWeight, String(MIN_KG), String(MIN_KG - 0.01)],
    [TARGET_FIELD.goalWeight, String(MAX_KG), String(MAX_KG + 0.01)],
    [TARGET_FIELD.pace, String(MIN_PACE_KG), "0.04"],
    [TARGET_FIELD.pace, String(MAX_PACE_KG), "2.01"],
    [TARGET_FIELD.height, String(MIN_HEIGHT_CM), String(MIN_HEIGHT_CM - 1)],
    [TARGET_FIELD.height, String(MAX_HEIGHT_CM), String(MAX_HEIGHT_CM + 1)],
  ])("%s accepts %s and refuses %s", (name, inside, outside) => {
    expect(parseProfileTargets(withField(name, inside), ZONES).ok).toBe(true);
    expect(Object.keys(errorsOf(parseProfileTargets(withField(name, outside), ZONES)))).toEqual([
      name,
    ]);
  });

  it.each([
    ["blank", ""],
    ["a sign", "-5"],
    ["hex", "0x4d"],
    ["an exponent", "1e2"],
    ["both separators", "1.234,5"],
    ["words", "lots"],
  ])("refuses %s in a decimal field", (_label, value) => {
    expect(errorsOf(parseProfileTargets(withField(TARGET_FIELD.protein, value), ZONES))).toHaveProperty(
      TARGET_FIELD.protein,
    );
  });

  it("refuses a fraction where the column is an integer, rather than truncating it", () => {
    expect(
      errorsOf(parseProfileTargets(withField(TARGET_FIELD.height, `${SAM.heightCm}.5`), ZONES)),
    ).toHaveProperty(TARGET_FIELD.height);
    expect(
      errorsOf(parseProfileTargets(withField(TARGET_FIELD.kcal, `${SAM.targetKcal},0`), ZONES)),
    ).toHaveProperty(TARGET_FIELD.kcal);
  });

  it("refuses a timezone that is not on the list, however plausible", () => {
    expect(
      errorsOf(parseProfileTargets(withField(TARGET_FIELD.timezone, "Europe/Paris"), ZONES)),
    ).toHaveProperty(TARGET_FIELD.timezone);
    expect(parseProfileTargets(withField(TARGET_FIELD.timezone, "UTC"), ZONES).ok).toBe(true);
  });

  it("refuses a missing field — a POST that leaves one out does not keep the old value", () => {
    const fields = targetFields(SAM);
    delete fields[TARGET_FIELD.pace];

    expect(Object.keys(errorsOf(parseProfileTargets(form(fields), ZONES)))).toEqual([
      TARGET_FIELD.pace,
    ]);
  });

  it("reports every bad field at once, not the first", () => {
    const errors = errorsOf(
      parseProfileTargets(
        form({ ...targetFields(SAM), [TARGET_FIELD.kcal]: "", [TARGET_FIELD.height]: "" }),
        ZONES,
      ),
    );

    expect(Object.keys(errors).sort()).toEqual([TARGET_FIELD.kcal, TARGET_FIELD.height].sort());
  });

  /*
   * No goal-equals-start refusal, on purpose. `weight-stats.ts` already reads a
   * zero journey as "no percentage", and a maintenance phase is a real state.
   */
  it("accepts a goal weight equal to the start weight", () => {
    expect(
      parseProfileTargets(withField(TARGET_FIELD.goalWeight, String(SAM.startWeightKg)), ZONES).ok,
    ).toBe(true);
  });
});

describe("supportedTimezones", () => {
  it("includes the persona's zone and UTC, sorted", () => {
    const zones = supportedTimezones();

    expect(zones).toContain(SAM.timezone);
    expect(zones).toContain("UTC");
    expect(zones).toEqual([...zones].sort());
  });
});

describe("targetsChanged", () => {
  it("is false for an unchanged save", () => {
    expect(targetsChanged(SAM, { ...SAM })).toBe(false);
  });

  it.each([
    ["targetKcal", SAM.targetKcal + 1],
    ["targetProteinG", SAM.targetProteinG + 1],
    ["targetFatG", SAM.targetFatG + 1],
    ["targetCarbG", SAM.targetCarbG + 1],
    ["targetWeightKg", SAM.targetWeightKg - 1],
    ["goalPaceKgPerWeek", SAM.goalPaceKgPerWeek + 0.25],
  ] as const)("is true when %s moves", (key, value) => {
    expect(targetsChanged(SAM, { ...SAM, [key]: value })).toBe(true);
  });

  it.each([
    ["startWeightKg", SAM.startWeightKg + 1],
    ["heightCm", SAM.heightCm + 1],
    ["timezone", "UTC"],
  ] as const)("is false when only %s moves — it is not what a week is judged by", (key, value) => {
    expect(targetsChanged(SAM, { ...SAM, [key]: value })).toBe(false);
  });
});
