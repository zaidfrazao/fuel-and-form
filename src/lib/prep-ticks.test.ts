import { describe, expect, test } from "vitest";

import {
  ingredientTickId,
  parsePrep,
  prepKey,
  serialisePrep,
  staleKeys,
  stepTickId,
} from "./prep-ticks";
import { parseInline } from "./recipe";

/**
 * The pure half of FUEL-144's prep lists. What is stored is anyone's to edit,
 * so most of this file is what a bad value reads as — always "no ticks", never
 * a throw.
 */

const KNOWN = new Set(["i:a", "i:b", "s:0:deadbeef"]);

describe("parsePrep", () => {
  test("reads back what serialisePrep wrote", () => {
    expect(parsePrep(serialisePrep(new Set(["i:a", "s:0:deadbeef"])), KNOWN)).toEqual(
      new Set(["i:a", "s:0:deadbeef"]),
    );
  });

  test("drops ids the screen does not draw", () => {
    expect(parsePrep(JSON.stringify({ ticked: ["i:a", "i:gone"] }), KNOWN)).toEqual(new Set(["i:a"]));
  });

  test.each([
    ["nothing stored", null],
    ["an empty string", ""],
    ["not JSON", "{ticked:"],
    ["JSON null", "null"],
    ["a number", "42"],
    ["a string", '"i:a"'],
    ["a bare array", '["i:a"]'],
    ["no ticked field", '{"done":["i:a"]}'],
    ["ticked not an array", '{"ticked":"i:a"}'],
    ["ticked an object", '{"ticked":{"0":"i:a"}}'],
  ])("%s is no ticks, not a throw", (_, raw) => {
    expect(parsePrep(raw, KNOWN)).toEqual(new Set());
  });

  test("skips non-string entries and keeps the strings beside them", () => {
    expect(
      parsePrep(JSON.stringify({ ticked: [1, null, { id: "i:a" }, ["i:b"], "i:b"] }), KNOWN),
    ).toEqual(new Set(["i:b"]));
  });
});

describe("serialisePrep", () => {
  test("an empty set removes the key", () => {
    expect(serialisePrep(new Set())).toBeNull();
  });

  test("is stable whatever order the ticks were made in", () => {
    expect(serialisePrep(new Set(["i:b", "i:a"]))).toBe(serialisePrep(new Set(["i:a", "i:b"])));
  });
});

describe("what a tick is called", () => {
  test("the key names the user, the date and the meal", () => {
    expect(prepKey("u1", "2026-10-02", "m1")).toBe("fuel:prep:u1:2026-10-02:m1");
  });

  test("an ingredient is its row", () => {
    expect(ingredientTickId("row-7")).toBe("i:row-7");
  });

  test("a step is its place and its text", () => {
    const step = parseInline("Brown the **mince**.");

    expect(stepTickId(0, step)).toBe(stepTickId(0, parseInline("Brown the **mince**.")));
    expect(stepTickId(0, step)).toMatch(/^s:0:[0-9a-f]{8}$/);
  });

  test("a reworded step is a different step, so its tick does not carry", () => {
    const before = stepTickId(2, parseInline("Simmer 20 minutes."));
    const after = stepTickId(2, parseInline("Simmer 25 minutes."));

    expect(after).not.toBe(before);
    expect(parsePrep(serialisePrep(new Set([before])), new Set([after]))).toEqual(new Set());
  });

  test("a step moved down by an inserted one does not keep its tick", () => {
    const text = parseInline("Season.");
    expect(stepTickId(3, text)).not.toBe(stepTickId(4, text));
  });
});

describe("staleKeys", () => {
  const TODAY = "2026-10-02";
  const key = (date: string) => `fuel:prep:u1:${date}:m1`;

  test("keeps today, a week ago and the week ahead", () => {
    expect(staleKeys([key(TODAY), key("2026-09-25"), key("2026-10-09")], TODAY)).toEqual([]);
  });

  test("drops the day before a week ago", () => {
    expect(staleKeys([key("2026-09-24"), key("2025-01-01")], TODAY)).toEqual([
      key("2026-09-24"),
      key("2025-01-01"),
    ]);
  });

  test("drops a prep key it cannot read", () => {
    const bad = ["fuel:prep:", "fuel:prep:u1", "fuel:prep:u1:yesterday:m1", "fuel:prep:u1:2026-02-30:m1"];
    expect(staleKeys(bad, TODAY)).toEqual(bad);
  });

  test("drops the library's memory-only shape if one ever reaches storage", () => {
    expect(staleKeys(["fuel:prep:u1:library:m1"], TODAY)).toEqual(["fuel:prep:u1:library:m1"]);
  });

  test("never touches a key outside the prefix", () => {
    expect(
      staleKeys(["fuel:training-session:2020-01-01", "fuel:demo-banner", "other"], TODAY),
    ).toEqual([]);
  });
});
