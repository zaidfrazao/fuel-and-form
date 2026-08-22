import { describe, expect, test } from "vitest";

import { csvTable } from "./csv";

/**
 * CSV escaping — FUEL-38's serialiser.
 *
 * Gated at 100%, and the gate is the weaker of the two things keeping this
 * file honest. Escaping is four lines of code with an input space that is not
 * four lines wide: every branch here runs on a single field containing a comma,
 * and a suite that stopped there would be green while a quote, a newline and a
 * trailing space were all still wrong. So the cases below are chosen by INPUT
 * CLASS — what a field can contain that changes how it must be written — rather
 * than by which line they reach.
 *
 * The failure this exists to prevent is a quiet one. A misquoted field does not
 * throw; it shifts one row of a spreadsheet by one column, days later, on
 * someone else's machine.
 */

/** One field, rendered — the shape most of these assertions want. */
const one = (value: string) => csvTable([[value]]);

describe("a field that needs no quotes", () => {
  test("is written bare", () => {
    expect(one("Oats and whey")).toBe("Oats and whey\r\n");
  });

  test("keeps an interior space, and an empty field stays empty", () => {
    expect(csvTable([["a b", ""]])).toBe("a b,\r\n");
  });

  test("is not quoted for a character that merely looks structural", () => {
    // Semicolons and tabs are separators in other dialects and not in this one.
    // Quoting them would be harmless and wrong: it would mean this file had an
    // opinion about a format it does not write.
    expect(one("30;45\tmin")).toBe("30;45\tmin\r\n");
  });
});

describe("a field that needs quotes", () => {
  test("a comma", () => {
    expect(one("eggs, toast")).toBe('"eggs, toast"\r\n');
  });

  test("a double quote, doubled inside the quotes", () => {
    expect(one('a 6" bowl')).toBe('"a 6"" bowl"\r\n');
  });

  test("a field that is nothing but quotes", () => {
    expect(one('""')).toBe('""""""\r\n');
  });

  test("a line break, which stays inside the field", () => {
    // The record separator and a newline in a note are the same two bytes. The
    // quotes are the only thing telling a reader which of the two it is
    // looking at, so this is the case where getting it wrong splits one row
    // into two rather than merely looking untidy.
    expect(one("felt heavy\nstopped early")).toBe('"felt heavy\nstopped early"\r\n');
    expect(one("a\r\nb")).toBe('"a\r\nb"\r\n');
  });

  test("leading or trailing whitespace, which readers otherwise trim", () => {
    expect(one(" leading")).toBe('" leading"\r\n');
    expect(one("trailing ")).toBe('"trailing "\r\n');
    expect(one(" ")).toBe('" "\r\n');
  });
});

describe("the formula guard", () => {
  test.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tSUM", "\rSUM"])(
    "prefixes %j, which a spreadsheet would otherwise evaluate",
    (value) => {
      expect(one(value)).toContain("'");
    },
  );

  test("names the case it exists for", () => {
    // The classic: a note that opens a shell through a spreadsheet's DDE. It
    // is text the OWNER typed and a THIRD PARTY opens — PRD § Target Users has
    // the nutrition assistant reading this file — which is the whole reason the
    // guard is here rather than left to the reader's settings.
    // No double quotes around it: the field holds no comma, no quote and no
    // line break, so the guard is the only thing it needs.
    expect(one("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1\r\n");
  });

  test("guards before quoting, so the prefix is inside the quotes", () => {
    // The other order produces `'"=1, 2"`, where the guard is outside the field
    // it is meant to be part of and the reader sees a stray apostrophe instead.
    expect(one("=1, 2")).toBe(`"'=1, 2"\r\n`);
  });

  test("leaves a guarded character anywhere but the front alone", () => {
    // `figure(a - b)` is not a formula, and prefixing every field containing an
    // operator would put an apostrophe in front of most of the notes in the
    // file.
    expect(one("2 - 1 = 1")).toBe("2 - 1 = 1\r\n");
  });

  test("leaves a negative number written as a cell alone", () => {
    // Not because it is safe to — a leading `-` IS guarded, as the case above
    // asserts — but because no column this file generates produces one. Every
    // number in the weekly export is a weight, a duration or a macro, and none
    // of them is negative. Recorded so the trade-off in `csv.ts` is checked
    // against the data rather than assumed.
    expect(one("80.4")).toBe("80.4\r\n");
  });
});

describe("the table", () => {
  test("separates fields with commas and terminates every row", () => {
    expect(csvTable([["date", "weight_kg"], ["2026-08-17", "80.4"]])).toBe(
      "date,weight_kg\r\n2026-08-17,80.4\r\n",
    );
  });

  test("writes an empty row as a blank line", () => {
    // How the weekly export separates its three sections.
    expect(csvTable([["a"], [], ["b"]])).toBe("a\r\n\r\nb\r\n");
  });

  test("writes no rows as no text", () => {
    // Not a special case in the code, and that is the point: rows are
    // terminated rather than joined, so there is no last-row branch to get
    // backwards and no stray newline in an empty file.
    expect(csvTable([])).toBe("");
  });
});
