import { describe, expect, test } from "vitest";

import { seedMeals } from "@/lib/seed/meals";

import { type Inline, isMealId, parseInline, parseMethod, parseProse, plain } from "./recipe";

const byKey = (key: string) => {
  const meal = seedMeals.find((candidate) => candidate.key === key);
  if (!meal) throw new Error(`no seeded meal ${key}`);
  return meal;
};

describe("every seeded method", () => {
  // The sweep the ticket asks for. Run over the seed rather than a fixture, so
  // a recipe added in a shape this module does not read fails here first.
  test.each(seedMeals.map((meal) => [meal.key, meal.method] as const))(
    "%s yields steps, and none of them is a heading, a table row, a number or a variant",
    (_key, method) => {
      const parsed = parseMethod(method);

      expect(parsed).not.toBeNull();
      expect(parsed!.steps.length).toBeGreaterThan(0);

      for (const step of parsed!.steps) {
        const text = plain(step);

        expect(text.trim()).not.toBe("");
        expect(text).not.toMatch(/^#/);
        expect(text).not.toMatch(/^\|/);
        expect(text).not.toMatch(/^\d+\.\s/);
        // A variant's lead is a bold run ending in a colon. The steak's
        // "**Chips.**" is a step's own lead and ends in a full stop.
        expect(step[0]?.strong && step[0].text.endsWith(":"), text).toBeFalsy();
      }
    },
  );

  test("only the steak reads anything before its steps", () => {
    const withBefore = seedMeals
      .filter((meal) => parseMethod(meal.method)!.before.length > 0)
      .map((meal) => meal.key);

    expect(withBefore).toEqual(["steak-chips-peppercorn"]);
  });
});

describe("the seed's own shape", () => {
  test("the chilli is ten steps and one variant under them", () => {
    const parsed = parseMethod(byKey("beef-mince-chilli").method)!;

    expect(parsed.steps).toHaveLength(10);
    expect(plain(parsed.steps[0]!)).toMatch(/^Start the rice first\./);
    expect(plain(parsed.steps[9]!)).toMatch(/^Season with salt and pepper\./);

    expect(parsed.after).toHaveLength(1);
    expect(parsed.after[0]).toMatchObject({ kind: "paragraph" });

    const [lead, ...rest] = (parsed.after[0] as { inline: ReturnType<typeof parseInline> }).inline;
    expect(lead).toEqual({ text: "Baked potato instead of rice:", strong: true });
    expect(plain(rest)).toMatch(/^ scrub the potato/);
  });

  test("an oats jar is five steps and a keeping note", () => {
    const parsed = parseMethod(byKey("oats-pb-cocoa").method)!;

    expect(parsed.steps).toHaveLength(5);
    expect(parsed.after.map((block) => block.kind)).toEqual(["paragraph"]);
    expect(plain((parsed.after[0] as { inline: Inline[] }).inline)).toMatch(/^Jars keep 4 days\./);
  });

  test("a method with no blank line is all steps", () => {
    const parsed = parseMethod(byKey("lemon-garlic-baked-fish").method)!;

    expect(parsed.steps).toHaveLength(10);
    expect(parsed.after).toEqual([]);
  });

  test("leading blank lines do not end the steps before they start", () => {
    expect(parseMethod("\n\nOne.\nTwo.\n\nAfter.")).toEqual({
      before: [],
      steps: [[{ text: "One." }], [{ text: "Two." }]],
      after: [{ kind: "paragraph", inline: [{ text: "After." }] }],
    });
  });
});

describe("a method that numbers its own steps", () => {
  const parsed = parseMethod(byKey("steak-chips-peppercorn").method)!;

  test("its numbered lines are the steps, numbers stripped", () => {
    expect(parsed.steps).toHaveLength(9);
    expect(parsed.steps[0]?.[0]).toEqual({ text: "Chips.", strong: true });
    expect(plain(parsed.steps[8]!)).toBe("Plate the steak with the chips, sauce over or alongside.");
  });

  test("the heat guide is read before them, and '### Steps' is dropped", () => {
    expect(parsed.before.map((block) => block.kind)).toEqual(["heading", "paragraph", "table"]);
    expect(parsed.before[0]).toEqual({ kind: "heading", text: "Heat guide" });

    const table = parsed.before[2] as Extract<(typeof parsed.before)[number], { kind: "table" }>;
    expect(table.head.map(plain)).toEqual(["Stage", "Heat"]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]?.[1]?.[0]).toEqual({ text: "HIGH", strong: true });
    expect(plain(table.rows[3]![0]!)).toBe("Sauce, once the cream is in");
  });

  test("italic inside a step survives", () => {
    expect(parsed.steps[7]).toContainEqual({ text: "immediately", em: true });
  });

  test("nothing is left after the last step", () => {
    expect(parsed.after).toEqual([]);
  });

  test("an unnumbered line straight after a step continues it", () => {
    expect(parseMethod("1. One\nstill one.\n2. Two")!.steps.map(plain)).toEqual([
      "One still one.",
      "Two",
    ]);
  });

  test("a blank line between numbered steps does not end them; prose after does", () => {
    expect(parseMethod("1. One\n\n2. Two\n\nServe hot.")).toEqual({
      before: [],
      steps: [[{ text: "One" }], [{ text: "Two" }]],
      after: [{ kind: "paragraph", inline: [{ text: "Serve hot." }] }],
    });
  });
});

describe("no method", () => {
  test.each([null, undefined, "", "  \n \n"])("%j is null, not an empty method", (value) => {
    expect(parseMethod(value)).toBeNull();
  });
});

describe("parseInline", () => {
  test("bold and italic, left to right", () => {
    expect(parseInline("a **b** c *d* e")).toEqual([
      { text: "a " },
      { text: "b", strong: true },
      { text: " c " },
      { text: "d", em: true },
      { text: " e" },
    ]);
  });

  test("an unmatched asterisk is text", () => {
    expect(parseInline("5% fat *")).toEqual([{ text: "5% fat *" }]);
  });

  test("markup that is not honoured is printed as written", () => {
    expect(parseInline("<b>x</b> [link](y) `z`")).toEqual([{ text: "<b>x</b> [link](y) `z`" }]);
  });
});

describe("parseProse", () => {
  test("the steak's notes are five paragraphs, two with a bold lead", () => {
    const blocks = parseProse(byKey("steak-chips-peppercorn").notes);

    expect(blocks.map((block) => block.kind)).toEqual(Array(5).fill("paragraph"));
    const leads = blocks.filter(
      (block) => block.kind === "paragraph" && block.inline[0]?.strong,
    );
    // ESTIMATED's own bold lead, plus the butter and the salt.
    expect(leads).toHaveLength(3);
  });

  test("lines without a blank between them are one paragraph", () => {
    expect(parseProse("one\ntwo")).toEqual([{ kind: "paragraph", inline: [{ text: "one two" }] }]);
  });

  test("a pipe line with no rule under it is prose, not a table", () => {
    expect(parseProse("| a | b |")).toEqual([
      { kind: "paragraph", inline: [{ text: "| a | b |" }] },
    ]);
  });

  test.each([null, undefined, ""])("%j is no blocks", (value) => {
    expect(parseProse(value)).toEqual([]);
  });
});

describe("isMealId", () => {
  test.each([
    ["3f2b8a1e-9c4d-4e5f-8a6b-7c8d9e0f1a2b", true],
    ["3F2B8A1E-9C4D-4E5F-8A6B-7C8D9E0F1A2B", true],
    ["not-a-uuid", false],
    ["3f2b8a1e-9c4d-4e5f-8a6b-7c8d9e0f1a2", false],
    ["3f2b8a1e-9c4d-4e5f-8a6b-7c8d9e0f1a2b'; drop table meals; --", false],
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(isMealId(value)).toBe(expected);
  });
});
