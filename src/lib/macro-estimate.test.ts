import { describe, expect, test } from "vitest";

import {
  deltaOf,
  energyGap,
  ESTIMATE_SCHEMA,
  estimateKey,
  estimatePrompt,
  MAX_ASSUMPTION,
  MAX_ASSUMPTIONS,
  MAX_RATIONALE,
  parseEstimateRequest,
  readEstimate,
} from "./macro-estimate";
import { MAX_MACRO_G } from "./profile-targets";
import { blankIngredient, MAX_INGREDIENTS, MAX_MEAL_KCAL, MAX_PAYLOAD, type RecipeDraft } from "./recipe-edit";

/**
 * FUEL-148. The pure half of the reassessment: what is read from the sheet's
 * draft, what is asked, and the second reading of the answer. The request is
 * `openrouter.test.ts`'s and the session check `recipe-estimate.test.ts`'s.
 */

const DRAFT: RecipeDraft = {
  name: "Chilli",
  kcal: "",
  proteinG: "oops",
  fatG: "14",
  carbG: "62",
  method: "Brown the mince.\nSimmer.",
  notes: "Freezes well.",
  ingredients: [
    { ...blankIngredient(), name: "Mince", nonScaleMeasure: "1 pack", grams: "125" },
    { ...blankIngredient(), name: "Garlic", nonScaleMeasure: "2 cloves", grams: "" },
    { ...blankIngredient(), name: "Beans", grams: "12,5" },
  ],
};

const ANSWER = {
  kcal: 612.4,
  proteinG: 48.46,
  fatG: 14,
  carbG: 62.04,
  rationale: "  USDA figures for each row.  ",
  assumptions: ["Garlic: 2 cloves at 3 g each", "  "],
};

describe("parseEstimateRequest", () => {
  test("reads the kitchen reading of each row, ignoring the four figures", () => {
    expect(parseEstimateRequest(JSON.stringify(DRAFT))).toEqual({
      name: "Chilli",
      ingredients: [
        { name: "Mince", measure: "1 pack", grams: 125 },
        { name: "Garlic", measure: "2 cloves", grams: null },
        { name: "Beans", measure: null, grams: 12.5 },
      ],
      method: "Brown the mince.\nSimmer.",
    });
  });

  test("sends no weight for one that is not a positive number", () => {
    const draft = {
      ...DRAFT,
      ingredients: [
        { ...blankIngredient(), name: "A", grams: "0" },
        { ...blankIngredient(), name: "B", grams: "ten" },
        { ...blankIngredient(), name: "C", grams: 40 },
      ],
    };

    expect(parseEstimateRequest(JSON.stringify(draft))?.ingredients.map((row) => row.grams)).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("skips a block with no name, and anything that is not a block", () => {
    const draft = {
      ...DRAFT,
      ingredients: [{ ...blankIngredient(), grams: "50" }, "Garlic", null, [1], DRAFT.ingredients[0]],
    };

    expect(parseEstimateRequest(JSON.stringify(draft))?.ingredients).toEqual([
      { name: "Mince", measure: "1 pack", grams: 125 },
    ]);
  });

  test("an empty method is no method", () => {
    expect(parseEstimateRequest(JSON.stringify({ ...DRAFT, method: "  \n " }))?.method).toBeNull();
  });

  test("caps the rows it sends", () => {
    const draft = {
      ...DRAFT,
      ingredients: Array.from({ length: MAX_INGREDIENTS + 5 }, (_, i) => ({ ...blankIngredient(), name: `Row ${i}` })),
    };

    expect(parseEstimateRequest(JSON.stringify(draft))?.ingredients).toHaveLength(MAX_INGREDIENTS);
  });

  test.each([
    ["no name", { ...DRAFT, name: "  " }],
    ["no named ingredient", { ...DRAFT, ingredients: [blankIngredient()] }],
    ["no ingredient list", { ...DRAFT, ingredients: "Garlic" }],
    ["an array", [DRAFT]],
  ])("is null for %s", (_, draft) => {
    expect(parseEstimateRequest(JSON.stringify(draft))).toBeNull();
  });

  test.each([
    ["not a string", DRAFT],
    ["not JSON", "{"],
    ["JSON null", "null"],
    ["over the payload cap", " ".repeat(MAX_PAYLOAD + 1)],
  ])("is null for a body that is %s", (_, raw) => {
    expect(parseEstimateRequest(raw)).toBeNull();
  });

  test("reads a non-string field as empty rather than trusting it", () => {
    const draft = { ...DRAFT, name: 42 };

    expect(parseEstimateRequest(JSON.stringify(draft))).toBeNull();
  });
});

describe("estimatePrompt", () => {
  test("states one serving, each row with what it has, and the method", () => {
    const prompt = estimatePrompt(parseEstimateRequest(JSON.stringify(DRAFT))!);

    expect(prompt).toBe(
      [
        "Recipe: Chilli",
        "",
        "Ingredients for one serving (name | measure | weight):",
        "- Mince | 1 pack | 125 g",
        "- Garlic | 2 cloves | no weight given",
        "- Beans | 12.5 g",
        "",
        "Method:",
        "Brown the mince.\nSimmer.",
      ].join("\n"),
    );
  });

  test("says so when there is no method", () => {
    expect(estimatePrompt({ name: "Oats", ingredients: [{ name: "Oats", measure: null, grams: 40 }], method: null })).toMatch(
      /Method:\n\(none given\)$/,
    );
  });

  test("carries nothing about the person: no figure from the form reaches it", () => {
    const prompt = estimatePrompt(parseEstimateRequest(JSON.stringify({ ...DRAFT, kcal: "9876", notes: "secret" }))!);

    expect(prompt).not.toContain("9876");
    expect(prompt).not.toContain("secret");
  });
});

describe("ESTIMATE_SCHEMA", () => {
  test("is strict: every field required and nothing else allowed", () => {
    expect(ESTIMATE_SCHEMA.additionalProperties).toBe(false);
    expect([...ESTIMATE_SCHEMA.required].sort()).toEqual(Object.keys(ESTIMATE_SCHEMA.properties).sort());
  });
});

describe("estimateKey", () => {
  test("changes with the name, an ingredient's reading, the order, or the method", () => {
    const key = estimateKey(DRAFT);
    const [mince, garlic, beans] = DRAFT.ingredients;

    expect(estimateKey({ ...DRAFT, name: "Curry" })).not.toBe(key);
    expect(estimateKey({ ...DRAFT, method: "Simmer." })).not.toBe(key);
    expect(estimateKey({ ...DRAFT, ingredients: [{ ...mince!, grams: "150" }, garlic!, beans!] })).not.toBe(key);
    expect(estimateKey({ ...DRAFT, ingredients: [{ ...mince!, nonScaleMeasure: "2 packs" }, garlic!, beans!] })).not.toBe(key);
    expect(estimateKey({ ...DRAFT, ingredients: [{ ...mince!, name: "Beef" }, garlic!, beans!] })).not.toBe(key);
    expect(estimateKey({ ...DRAFT, ingredients: [garlic!, mince!, beans!] })).not.toBe(key);
  });

  test("ignores the four figures, the notes, the shop's reading and outer space", () => {
    const [mince, ...rest] = DRAFT.ingredients;

    expect(
      estimateKey({
        ...DRAFT,
        name: " Chilli ",
        kcal: "600",
        proteinG: "40",
        fatG: "10",
        carbG: "50",
        notes: "",
        ingredients: [{ ...mince!, shopName: "Beef mince", shopQty: "1", pantry: true }, ...rest],
      }),
    ).toBe(estimateKey(DRAFT));
  });
});

describe("readEstimate", () => {
  test("rounds to the form's precision and trims the prose", () => {
    expect(readEstimate(JSON.stringify(ANSWER))).toEqual({
      kcal: 612,
      proteinG: 48.5,
      fatG: 14,
      carbG: 62,
      rationale: "USDA figures for each row.",
      assumptions: ["Garlic: 2 cloves at 3 g each"],
    });
  });

  test("accepts every bound exactly, and zero", () => {
    const estimate = readEstimate(
      JSON.stringify({ ...ANSWER, kcal: MAX_MEAL_KCAL, proteinG: MAX_MACRO_G, fatG: 0, carbG: 0 }),
    );

    expect(estimate).toMatchObject({ kcal: MAX_MEAL_KCAL, proteinG: MAX_MACRO_G, fatG: 0, carbG: 0 });
  });

  test("caps the rationale and the assumptions", () => {
    const estimate = readEstimate(
      JSON.stringify({
        ...ANSWER,
        rationale: "r".repeat(MAX_RATIONALE + 10),
        assumptions: Array.from({ length: MAX_ASSUMPTIONS + 3 }, () => "a".repeat(MAX_ASSUMPTION + 10)),
      }),
    );

    expect(estimate?.rationale).toHaveLength(MAX_RATIONALE);
    expect(estimate?.assumptions).toHaveLength(MAX_ASSUMPTIONS);
    expect(estimate?.assumptions[0]).toHaveLength(MAX_ASSUMPTION);
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "[1]"],
    ["JSON null", "null"],
    ["kcal missing", { ...ANSWER, kcal: undefined }],
    ["kcal as text", { ...ANSWER, kcal: "612" }],
    ["kcal negative", { ...ANSWER, kcal: -1 }],
    ["kcal over the form's cap", { ...ANSWER, kcal: MAX_MEAL_KCAL + 1 }],
    ["protein as text", { ...ANSWER, proteinG: "48" }],
    ["fat negative", { ...ANSWER, fatG: -0.5 }],
    ["carbs over the form's cap", { ...ANSWER, carbG: MAX_MACRO_G + 1 }],
    ["an empty rationale", { ...ANSWER, rationale: "  " }],
    ["a rationale that is not text", { ...ANSWER, rationale: 3 }],
    ["assumptions that are not a list", { ...ANSWER, assumptions: "Garlic" }],
    ["an assumption that is not text", { ...ANSWER, assumptions: ["Garlic", 3] }],
  ])("is null for %s", (_, answer) => {
    expect(readEstimate(typeof answer === "string" ? answer : JSON.stringify(answer))).toBeNull();
  });

  test("is null for content that is not a string", () => {
    expect(readEstimate(ANSWER)).toBeNull();
    expect(readEstimate(null)).toBeNull();
  });

  test("is null for a figure JSON cannot carry but a parser might", () => {
    // `1e999` parses to Infinity: finite is checked, not assumed.
    expect(readEstimate('{"kcal":1e999,"proteinG":1,"fatG":1,"carbG":1,"rationale":"r","assumptions":[]}')).toBeNull();
  });
});

describe("energyGap", () => {
  test("is null when the calories agree with 4P + 4C + 9F", () => {
    // 4 × 40 + 4 × 60 + 9 × 20 = 580.
    expect(energyGap({ kcal: 580, proteinG: 40, carbG: 60, fatG: 20 })).toBeNull();
  });

  test("allows 25 kcal on a small meal, where a tenth would be less", () => {
    // Computed 100: a tenth is 10, so the floor of 25 decides.
    expect(energyGap({ kcal: 125, proteinG: 10, carbG: 15, fatG: 0 })).toBeNull();
    expect(energyGap({ kcal: 126, proteinG: 10, carbG: 15, fatG: 0 })).toBe(26);
  });

  test("allows a tenth on a large meal, where 25 would be less", () => {
    expect(energyGap({ kcal: 638, proteinG: 40, carbG: 60, fatG: 20 })).toBeNull();
    expect(energyGap({ kcal: 639, proteinG: 40, carbG: 60, fatG: 20 })).toBe(59);
  });

  test("is signed, so a figure under the sum reads as under", () => {
    expect(energyGap({ kcal: 400, proteinG: 40, carbG: 60, fatG: 20 })).toBe(-180);
  });
});

describe("deltaOf", () => {
  test("is the proposed less the current, to a tenth", () => {
    expect(deltaOf("612", 640)).toBe(28);
    expect(deltaOf(" 48,5 ", 45.2)).toBe(-3.3);
  });

  test("is a true zero, never -0", () => {
    expect(Object.is(deltaOf("10", 10), 0)).toBe(true);
    expect(Object.is(deltaOf("10.04", 10), 0)).toBe(true);
  });

  test.each(["", "  ", "oops", "-4"])("is null when the form holds %j", (current) => {
    expect(deltaOf(current, 10)).toBeNull();
  });
});
