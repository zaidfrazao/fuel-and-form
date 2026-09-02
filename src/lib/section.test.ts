import { describe, expect, it } from "vitest";

import {
  bySection,
  SECTIONS,
  sectionLabel,
  WORKING_SECTION,
  working,
} from "./section";

/**
 * The parts of a session — § P10, FUEL-92.
 *
 * Three questions, and every one of them fails quietly if it is wrong: which
 * order the parts present in, which rows are the work, and whether a group with
 * no rows can produce a heading. Nothing here throws on a bad answer, which is
 * why the module is gated at 100% rather than merely tested.
 */

/** A row, narrowed to the one field this module reads. */
const row = (id: string, section: string) => ({ id, section });

describe("the vocabulary", () => {
  it("is the presentation order, so nothing sorts a session by hand", () => {
    // The array IS the order — the module comment's central claim. Asserted as a
    // literal rather than derived, because a test that read the order off the
    // same array it is checking would pass on any permutation of it, including
    // the one that stretches before it squats.
    expect([...SECTIONS]).toEqual(["warmup", "work", "cooldown"]);
  });

  it("names the working section as a value, so no caller spells it", () => {
    // What decides whether an exercise is offered rep entry. A second spelling
    // of this string somewhere else is the bug `WALK_TYPE` exists to prevent.
    expect(WORKING_SECTION).toBe("work");
    expect(SECTIONS).toContain(WORKING_SECTION);
  });

  it("holds only values that are safe to write into DDL as literals", () => {
    /*
     * `schema.ts` builds the column's CHECK by interpolating these values into
     * `sql.raw` — it must, because a tagged `sql` template turns them into bound
     * parameters and drizzle-kit then writes `CHECK ("section" in ($1, $2, $3))`
     * into the migration, which is a syntax error in a file nothing runs until
     * deploy. That was caught once already, in FUEL-92's first draft.
     *
     * `sql.raw` does no escaping, so the safety of that construction rests
     * entirely on what this array contains. Today it is three lowercase words
     * and no user input can reach it. This is the assertion that keeps it that
     * way: a value with a quote in it would generate invalid SQL, and the place
     * to find that out is here rather than in a migration nobody runs locally.
     *
     * A test rather than a runtime guard on purpose — the values are a
     * compile-time constant, so the failure belongs at the commit that changes
     * them and not in anybody's request path.
     */
    for (const section of SECTIONS) {
      expect(section).toMatch(/^[a-z]+$/);
    }
  });

  it("labels each section for its heading", () => {
    expect(sectionLabel("warmup")).toBe("Warm-up");
    expect(sectionLabel("work")).toBe("Work");
    expect(sectionLabel("cooldown")).toBe("Cool-down");
  });

  it("prints an unrecognised section rather than blanking it", () => {
    // The open-vocabulary consequence: the column is text with a CHECK, so a
    // build can meet a value it predates. § Lists renders the heading uppercase,
    // so the raw slug reads as a heading rather than as an empty one.
    expect(sectionLabel("finisher")).toBe("finisher");
  });
});

describe("bySection", () => {
  it("presents the sections in their fixed order, whatever order the rows came in", () => {
    // The acceptance criterion, and the reason the order is code: these rows
    // arrive backwards, which is a thing a database can legitimately return.
    const groups = bySection([
      row("c1", "cooldown"),
      row("w1", "work"),
      row("u1", "warmup"),
    ]);

    expect(groups.map((group) => group.section)).toEqual([
      "warmup",
      "work",
      "cooldown",
    ]);
  });

  it("keeps the order it was given within a section", () => {
    // `sort_order` is a position WITHIN a section, and the queries deliver it.
    // Re-sorting here would be a second, weaker copy of that ordering.
    const groups = bySection([
      row("w1", "work"),
      row("w2", "work"),
      row("w3", "work"),
    ]);

    expect(groups[0]!.exercises.map((exercise) => exercise.id)).toEqual([
      "w1",
      "w2",
      "w3",
    ]);
  });

  it("interleaved rows still gather into one group each", () => {
    // The shape a real query returns when `sort_order` interleaves the sections
    // — which it does, because sort_order restarts per section.
    const groups = bySection([
      row("u1", "warmup"),
      row("w1", "work"),
      row("u2", "warmup"),
      row("w2", "work"),
    ]);

    expect(groups.map((group) => group.exercises.map((e) => e.id))).toEqual([
      ["u1", "u2"],
      ["w1", "w2"],
    ]);
  });

  it("returns no group for a section with no rows", () => {
    // § Lists: "a group with no rows renders nothing at all". Answered in the
    // data, so a renderer cannot draw an empty heading even by mistake.
    const groups = bySection([row("w1", "work"), row("w2", "work")]);

    expect(groups).toHaveLength(1);
    expect(groups.map((group) => group.section)).toEqual(["work"]);
  });

  it("gives a single-section list back as one group", () => {
    // What lets `ExerciseList` render every session stored before this ticket
    // exactly as it did: one group is not a grouping.
    const groups = bySection([row("w1", "work")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Work");
  });

  it("has nothing to group in an empty list", () => {
    // The daily walk. Ordinary data, not missing data.
    expect(bySection([])).toEqual([]);
  });

  it("carries the resolved label so a renderer does not repeat it", () => {
    const groups = bySection([row("u1", "warmup"), row("c1", "cooldown")]);

    expect(groups.map((group) => group.label)).toEqual(["Warm-up", "Cool-down"]);
  });

  it("puts an unrecognised section last rather than dropping it", () => {
    // The conservative half of the open vocabulary. Dropping it would hide
    // exercises somebody scheduled — silently, which is the failure this whole
    // module is gated against.
    const groups = bySection([
      row("f1", "finisher"),
      row("w1", "work"),
      row("u1", "warmup"),
    ]);

    expect(groups.map((group) => group.section)).toEqual([
      "warmup",
      "work",
      "finisher",
    ]);
  });

  it("keeps two unrecognised sections in the order they arrived", () => {
    // Both rank equally, so the sort must be stable between them — otherwise
    // two unknown groups could swap places between renders of the same data.
    const groups = bySection([
      row("f1", "finisher"),
      row("a1", "activation"),
      row("w1", "work"),
    ]);

    expect(groups.map((group) => group.section)).toEqual([
      "work",
      "finisher",
      "activation",
    ]);
  });
});

describe("working", () => {
  it("is the working rows and nothing else", () => {
    // FUEL-91's surface is scoped through this. A warm-up offered three set
    // rows is the exact fault the section column was added to prevent.
    const rows = [
      row("u1", "warmup"),
      row("w1", "work"),
      row("c1", "cooldown"),
      row("w2", "work"),
    ];

    expect(working(rows).map((exercise) => exercise.id)).toEqual(["w1", "w2"]);
  });

  it("does not treat an unrecognised section as working", () => {
    // A section this build has never heard of gets its rows and its heading,
    // and does not get rep entry until somebody decides it should.
    expect(working([row("f1", "finisher")])).toEqual([]);
  });

  it("is empty for a session with no rows at all", () => {
    expect(working([])).toEqual([]);
  });
});
