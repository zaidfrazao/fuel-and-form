import { describe, expect, test } from "vitest";

import {
  IN_WORK,
  leadIn,
  readStage,
  sectionRows,
  stageLabel,
  stageRow,
  stepStage,
} from "@/lib/session-stage";

/**
 * The seed's own shape: a warm-up, the work, a cool-down — FUEL-125.
 *
 * Ids rather than names, because the stored value is an id and every assertion
 * below is about which row a step lands on.
 */
const row = (id: string, section: string) => ({ id, section });

const SESSION = [
  row("w1", "warmup"),
  row("w2", "warmup"),
  row("e1", "work"),
  row("e2", "work"),
  row("c1", "cooldown"),
  row("c2", "cooldown"),
];

/** Every session stored before FUEL-92 — all working rows, no sections. */
const FLAT = [row("e1", "work"), row("e2", "work")];

const bookend = (section: string, index: number) =>
  ({ kind: "bookend", section, index }) as const;

describe("reading the stored stage", () => {
  test("nothing stored is the work", () => {
    // Which is what makes the legacy case right by construction: a session
    // entered before this ticket has the entered instant and no stage id, so a
    // deploy does not yank a mid-session reader back to the warm-up.
    expect(readStage(SESSION, null)).toEqual(IN_WORK);
  });

  test("a bookend id is that row, with its own index within its section", () => {
    expect(readStage(SESSION, "w2")).toEqual(bookend("warmup", 1));
    expect(readStage(SESSION, "c1")).toEqual(bookend("cooldown", 0));
  });

  test("a working row's id is the work, not a stage", () => {
    // The id only ever means "this bookend". The work's own position is derived
    // from the sets and this module has no business restating it.
    expect(readStage(SESSION, "e1")).toEqual(IN_WORK);
  });

  test("an id this session does not have is the work", () => {
    // `localStorage` is anyone's to edit, and a rotated day is the honest
    // version of the same case. The worst a bad value does is forget which
    // bookend the reader was on — it never lands them on a row that is not there.
    expect(readStage(SESSION, "gone")).toEqual(IN_WORK);
    expect(stageRow(SESSION, readStage(SESSION, "gone"))).toBeUndefined();
  });

  test("an unrecognised section is not a stage", () => {
    // `working()` refuses it rep entry; this refuses it a step. A section this
    // build has never heard of gets a heading and its rows in the plan list, and
    // is not silently made a cool-down by sorting last.
    const withFinisher = [...SESSION, row("f1", "finisher")];

    expect(readStage(withFinisher, "f1")).toEqual(IN_WORK);
  });
});

describe("the rows of a stage", () => {
  test("leadIn is what is performed before the work", () => {
    expect(leadIn(SESSION).map((one) => one.id)).toEqual(["w1", "w2"]);
  });

  test("a session with no bookends has no lead-in", () => {
    expect(leadIn(FLAT)).toEqual([]);
  });

  test("stageRow indexes within the section, not the session", () => {
    expect(stageRow(SESSION, bookend("cooldown", 1))?.id).toBe("c2");
  });

  test("the work stands on no row", () => {
    expect(stageRow(SESSION, IN_WORK)).toBeUndefined();
  });

  test("sectionRows keeps the order it was given", () => {
    // `resolve-training.ts` delivers `(sort_order, id)` and that is the ordering
    // `sort_order` is for. A sort here would be a third place free to disagree.
    expect(sectionRows(SESSION, "warmup").map((one) => one.id)).toEqual(["w1", "w2"]);
  });
});

describe("stepping across the stages", () => {
  const at = (id: string | null) => readStage(SESSION, id);

  test("the warm-up steps through its own rows", () => {
    expect(stepStage(SESSION, at("w1"), "next", false)).toEqual({ kind: "to", id: "w2" });
    expect(stepStage(SESSION, at("w2"), "previous", false)).toEqual({
      kind: "to",
      id: "w1",
    });
  });

  test("the first row of the session has nothing before it", () => {
    // The boundary an overloaded "nothing that way" gets wrong: collapsing it
    // with "ask the working stepper" draws a Previous button on the first
    // warm-up row that jumps the reader into the work.
    expect(stepStage(SESSION, at("w1"), "previous", false)).toBeNull();
    expect(stepStage(SESSION, at("w1"), "previous", true)).toBeNull();
  });

  test("past the last warm-up row is the work", () => {
    // `null` rather than an id, so the caller REMOVES the key and the reader
    // lands on the derived position rather than a stored one.
    expect(stepStage(SESSION, at("w2"), "next", false)).toEqual({ kind: "to", id: null });
  });

  test("inside the work, the working stepper answers", () => {
    expect(stepStage(SESSION, IN_WORK, "next", true)).toEqual({ kind: "working" });
    expect(stepStage(SESSION, IN_WORK, "previous", true)).toEqual({ kind: "working" });
  });

  test("out of the work is the adjacent bookend row, from each side's own end", () => {
    // Forwards: the FIRST cool-down row. Backwards: the LAST warm-up row. Only
    // where the working stepper has no step that way.
    expect(stepStage(SESSION, IN_WORK, "next", false)).toEqual({ kind: "to", id: "c1" });
    expect(stepStage(SESSION, IN_WORK, "previous", false)).toEqual({
      kind: "to",
      id: "w2",
    });
  });

  test("before the first cool-down row is the work", () => {
    expect(stepStage(SESSION, at("c1"), "previous", false)).toEqual({
      kind: "to",
      id: null,
    });
  });

  test("the last row of the session has nothing after it", () => {
    expect(stepStage(SESSION, at("c2"), "next", false)).toBeNull();
  });

  test("a session with no bookends never leaves the work", () => {
    // AC: "A session with no bookends behaves exactly as today." With nothing
    // either side of the work, every step is the working stepper's, and where
    // that has none there is no control at all — which is exactly FUEL-120.
    expect(stepStage(FLAT, IN_WORK, "next", true)).toEqual({ kind: "working" });
    expect(stepStage(FLAT, IN_WORK, "previous", true)).toEqual({ kind: "working" });
    expect(stepStage(FLAT, IN_WORK, "next", false)).toBeNull();
    expect(stepStage(FLAT, IN_WORK, "previous", false)).toBeNull();
  });

  test("a session with only a warm-up has no step past the work", () => {
    const noCooldown = [row("w1", "warmup"), row("e1", "work")];

    expect(stepStage(noCooldown, IN_WORK, "next", false)).toBeNull();
    expect(stepStage(noCooldown, IN_WORK, "previous", false)).toEqual({
      kind: "to",
      id: "w1",
    });
  });

  test("a session with only a cool-down opens in the work and can reach it", () => {
    const noWarmup = [row("e1", "work"), row("c1", "cooldown")];

    expect(leadIn(noWarmup)).toEqual([]);
    expect(stepStage(noWarmup, IN_WORK, "previous", false)).toBeNull();
    expect(stepStage(noWarmup, IN_WORK, "next", false)).toEqual({ kind: "to", id: "c1" });
  });
});

describe("what a bookend calls its position", () => {
  test("counts from one, within its own stage", () => {
    expect(stageLabel("Warm-up", 0, 2)).toBe("Warm-up 1 of 2");
    expect(stageLabel("Cool-down", 1, 2)).toBe("Cool-down 2 of 2");
  });
});
