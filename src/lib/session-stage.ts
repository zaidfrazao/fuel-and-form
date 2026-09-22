/**
 * The session as three stages, not one — § P10, FUEL-125.
 *
 * FUEL-92 made the warm-up and the cool-down first-class sections of the list,
 * and the session state kept stepping through the work alone. So the reader
 * warmed up from the plan-state list BEFORE tapping Start session, and cooled
 * down AFTER Mark done had already left the state. The session did not start
 * when the workout did, and the cool-down came after the app had said you were
 * finished — of the cool-down whose own cue is "don't skip it after skipping".
 *
 * This module is the sequence that fixes that: the warm-up rows, then the work,
 * then the cool-down rows. It owns where the reader stands ACROSS those three
 * and nothing about what happens inside the middle one.
 *
 * ## The work is still derived, and this does not touch it
 *
 * `exercise-set.ts`' `sessionPosition` and `stepSession` are unchanged and still
 * read the working position off the sets. That is the schema's own principle —
 * derive from an absolute, never accumulate — and it is what buys the reload for
 * free. A bookend cannot join it: it logs no sets, so there is no absolute to
 * read, and `exercise_sets` will never say whether somebody has done their arm
 * circles. PRD § P10 puts set logging on the working section only, and that is
 * the whole reason.
 *
 * So the two halves are kept apart rather than merged into one cursor. Inside
 * the work the data wins, as it always has. Across the three stages a stored id
 * says where the reader is, because nothing else can.
 *
 * ## What is stored is ONE id, and the row says the rest
 *
 * A bookend's own `section` says whether it is before the work or after it, so a
 * stage needs no second field and no direction. The absence of a stored id is
 * "in the work", which makes crossing INTO the work a removal rather than a
 * write, and that is what keeps the derivation authoritative: the reader lands
 * where the sets say, not where they last stood.
 *
 * It also decides the legacy case by construction. A session entered before this
 * ticket has the entered instant and no stage id, so it reads as in the work —
 * a reader mid-session is not yanked back to the warm-up by a deploy.
 *
 * An id that names no row in today's session is read as nothing stored, for
 * `parseMoved`'s reason: the value comes back from `localStorage` as whatever was
 * left there, by this code, an older copy of it, or a person with devtools. A
 * rotated day is the honest version of the same case. The worst a bad value does
 * is forget which bookend the reader was on.
 *
 * ## Pure, like every module the client imports
 *
 * No database access, no storage access and no React. `training.tsx` reads and
 * writes the key, as it does for the entered instant and `Moved`; this says what
 * the value MEANS. Same contract as `section.ts`, which it builds on.
 */

import { SECTIONS, type Section, WORKING_SECTION } from "@/lib/section";

/** The least a row needs to be a step of a session. */
type Row = { id: string; section: string };

/**
 * Which side of the work a section falls, or `null` for one that is not a stage.
 *
 * Read off `SECTIONS` rather than by naming 'warmup' and 'cooldown' here.
 * `section.ts` says the array IS the presentation order and that every reader
 * takes its order from there; a pair of literals in this file would be a second
 * spelling of that order, free to disagree with it the day a section is added.
 *
 * `null` for the work itself and for a section this build does not know. The
 * unknown case is `working()`'s conservatism from the other side: an
 * unrecognised section gets a heading and its rows in the plan list, and does
 * not join the session's sequence until somebody decides it should. It is not
 * silently made a cool-down by sorting last.
 */
const WORK_AT = SECTIONS.indexOf(WORKING_SECTION as Section);

function side(section: string): "before" | "after" | null {
  const at = SECTIONS.indexOf(section as Section);

  if (at === -1 || at === WORK_AT) return null;

  return at < WORK_AT ? "before" : "after";
}

/** The stage sections on one side of the work, in the order they are performed. */
function sideSections(of: "before" | "after"): readonly string[] {
  return SECTIONS.filter((section) => side(section) === of);
}

/**
 * Where the reader stands, across the three stages.
 *
 * `work` carries no position: which working exercise, and which round, is
 * `sessionPosition`'s answer and this module has no business restating it.
 */
export type Stage =
  | { kind: "bookend"; section: string; index: number }
  | { kind: "work" };

/** Where a session with no stored id opens: the work, as it always did. */
export const IN_WORK: Stage = { kind: "work" };

/**
 * The rows of one bookend section, in the order they are performed.
 *
 * `resolve-training.ts` delivers the exercises in section order and in
 * `sort_order` within one, so this filters and does not sort — the ordering is
 * `sort_order`'s job and `section.ts`' `SECTIONS` array's, and a second sort
 * here would be a third place that could disagree with them.
 *
 * Note this takes a section and not "the non-working rows": an unrecognised
 * section is not a bookend either. `working()` refuses it rep entry, and this
 * refuses it a step, which is the same conservatism from the other side — a
 * section this build has never heard of gets a heading and its rows in the plan
 * list, and does not join the session's sequence until somebody decides it
 * should.
 */
export function sectionRows<T extends Row>(
  exercises: readonly T[],
  section: string,
): readonly T[] {
  return exercises.filter((exercise) => exercise.section === section);
}

/**
 * The rows performed BEFORE the work, in order — today, the warm-up.
 *
 * Named for the job rather than for the section, because `SECTIONS` decides
 * which sections those are and this has to keep meaning the same thing if that
 * array gains a value. `enter` needs the first of them, which is where a session
 * now begins.
 */
export function leadIn<T extends Row>(exercises: readonly T[]): readonly T[] {
  return sideSections("before").flatMap((section) => sectionRows(exercises, section));
}

/**
 * The stage a stored id names, or the work.
 *
 * The id is looked up in THIS session's rows, so a stale one — a rotated day, a
 * plan edited between two tabs — reads as the work rather than landing the
 * reader on a row that no longer exists. A working row's id reads as the work
 * too: the id only ever means "this bookend", and the work's own position is
 * derived.
 */
export function readStage<T extends Row>(
  exercises: readonly T[],
  storedId: string | null,
): Stage {
  if (storedId === null) return IN_WORK;

  const row = exercises.find((exercise) => exercise.id === storedId);

  if (!row || row.section === WORKING_SECTION) return IN_WORK;

  return {
    kind: "bookend",
    section: row.section,
    index: sectionRows(exercises, row.section).findIndex((one) => one.id === storedId),
  };
}

/**
 * The bookend row a stage stands on, or `undefined` in the work.
 *
 * `undefined` rather than null, so it reads as an array access, which is what it
 * is — and so `training.tsx` can fall through to the derived working exercise
 * with a single `??`.
 */
export function stageRow<T extends Row>(
  exercises: readonly T[],
  stage: Stage,
): T | undefined {
  if (stage.kind === "work") return undefined;

  return sectionRows(exercises, stage.section)[stage.index];
}

/**
 * What lies one step out of this stage — FUEL-125.
 *
 * Three answers, and they are three rather than two because "there is nothing
 * that way" and "that way is the working stepper's question" are different
 * facts about the same control. Collapsing them draws a Previous button on the
 * first warm-up row that jumps into the work.
 *
 *   - `null` — nothing that way. The caller draws no control at all, which is
 *     what FUEL-120's own `null` already means one level up.
 *   - `{ kind: "working" }` — inside the work, where `stepSession` answers.
 *   - `{ kind: "to"; id }` — a bookend by id, or the work when `id` is `null`.
 */
export type StageStep = { kind: "working" } | { kind: "to"; id: string | null };

/**
 * Where a step out of this stage lands.
 *
 * The three stages hand off at their ends and nowhere else:
 *
 *   - Warm-up, past the last row, is the work.
 *   - The work is only left where `sessionPosition` has no step that way — the
 *     first working step backwards, the last one forwards — which is why this
 *     takes `hasWorkStep` rather than the sets. Inside the work it defers.
 *   - Cool-down, before the first row, is the work.
 *
 * Crossing into the work in either direction stores nothing, so the reader lands
 * on the derived position. Coming back from the warm-up to the work does NOT
 * return them to the working step they left from a stored cursor; it returns
 * them to the step the sets say is open, which is the same step unless they
 * logged one in between. That is the data winning, and it is the rule the whole
 * screen already keeps.
 */
export function stepStage<T extends Row>(
  exercises: readonly T[],
  stage: Stage,
  direction: "next" | "previous",
  /** Whether `stepSession` has a step that way. Only consulted in the work. */
  hasWorkStep: boolean,
): StageStep | null {
  if (stage.kind === "work") {
    if (hasWorkStep) return { kind: "working" };

    // Out of the work is into the nearest stage on that side: the FIRST row of
    // the first section after it, or the LAST row of the last section before it.
    // Both are "the adjacent step", read from each side's own end.
    const rows = sideSections(direction === "next" ? "after" : "before").flatMap(
      (section) => sectionRows(exercises, section),
    );
    // Flattened in performance order, so the adjacent row is that list's near
    // end: the first row of the run-out, the last row of the lead-in.
    const into = direction === "next" ? rows[0] : rows[rows.length - 1];

    return into ? { kind: "to", id: into.id } : null;
  }

  const rows = sectionRows(exercises, stage.section);
  const target = direction === "next" ? stage.index + 1 : stage.index - 1;
  const row = rows[target];

  if (row) return { kind: "to", id: row.id };

  /*
   * Off the end of a stage section, so the step leaves it.
   *
   * Towards the work, the next section on this side is tried first and the work
   * is what lies past the last of them. Away from the work — backwards out of
   * the first warm-up section, forwards out of the last cool-down one — is the
   * session's own end, and there is nothing beyond it.
   *
   * With today's three sections each side holds exactly one, so this is the
   * warm-up handing forward to the work and the cool-down handing back to it.
   * It is written against `SECTIONS` rather than against that count because the
   * module above promises to keep working when the array gains a value.
   */
  const of = side(stage.section);

  if (of === null) return null;

  const towardsWork = (of === "before") === (direction === "next");

  if (!towardsWork) return null;

  const sections = sideSections(of);
  const at = sections.indexOf(stage.section);
  const rest = direction === "next" ? sections.slice(at + 1) : sections.slice(0, at).reverse();

  for (const section of rest) {
    const siblings = sectionRows(exercises, section);
    const row = direction === "next" ? siblings[0] : siblings[siblings.length - 1];

    if (row) return { kind: "to", id: row.id };
  }

  return { kind: "to", id: null };
}

/**
 * What a bookend step calls its position — "Warm-up 1 of 2".
 *
 * Its own label rather than "Exercise N of M", which keeps counting the working
 * rows and only them. A warm-up in that denominator would be a session reporting
 * itself as longer than the work it is asking for, which is the reason
 * `training.tsx` gives for narrowing the count in the first place.
 */
export function stageLabel(label: string, index: number, total: number): string {
  return `${label} ${index + 1} of ${total}`;
}
