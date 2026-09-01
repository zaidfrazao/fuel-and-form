/**
 * What a set is allowed to say, and everything derived from a session's sets —
 * § P10's per-set logging, FUEL-91.
 *
 * The counterpart of `session-entry.ts` one table down, and it exists for the
 * same two reasons that file gives.
 *
 * The first is refusal. Every value here arrives from a Server Action, which is
 * to say from anyone who can POST to this app, and a refusal exercised only
 * through a Server Action is one no hermetic test can hold still. `reps` is an
 * `integer` column: unchecked, `-5` and `1e9` are both storable, and both are
 * numbers FUEL-95's estimate and FUEL-97's export would later present as fact.
 *
 * The second is derivation, which is new here and is the larger half. The
 * session state has no stored notion of where you are: Brand Guide § Desktop
 * rules that "the current exercise is derived, not stored — the first exercise
 * whose sets are incomplete, read off the rows FUEL-91 writes". That is the
 * schema's own principle of deriving from an absolute rather than accumulating,
 * and it is what makes a phone locked mid-session and woken twenty minutes
 * later resume exactly where the data says it is. But it only works if every
 * reader derives it the SAME way — the screen, the aside beside it, and the
 * export that comes later — so the rule lives here, once, rather than as a
 * `filter` written out three times.
 *
 * ## Pure, and given its values
 *
 * No database, no clock, no session, and no import from `schema.ts` at all —
 * not even a type. The shapes below are structural, so a client component can
 * import this module without dragging pg-core into the browser bundle, and so
 * the derivations can be tested against three-line objects rather than against
 * a row. `resolve-plan.ts` states the rule and `template-plan.ts` follows it.
 */

/**
 * The most reps a single set can record.
 *
 * Not a judgement about training. It is an upper bound on a number that will be
 * summed and presented, chosen far above anything this program prescribes —
 * § P3's sessions are circuits of 8 to 15 — and far below the point where a
 * figure stops meaning anything. Three digits is also every rep count a human
 * performs and the typo class that is not: a stray keypress cannot turn 8 into
 * 800, because the input carries the same `maxLength` the duration field does.
 */
export const MAX_REPS = 999;

/**
 * The most sets one exercise can hold in one session.
 *
 * The screen offers rows from a target and from what is already logged, so this
 * is not a limit anybody meets by training. It is the bound on `set_index`,
 * which a forged request would otherwise be free to send as 1e9 — and since the
 * unique index makes `(log, exercise, set_index)` the address of a set, an
 * unbounded index is an unbounded number of rows at unbounded addresses.
 * Brand Guide § Lists sizes the sub-list at "three to five rows"; twenty is far
 * enough above that to never be reached and low enough to refuse a probe.
 */
export const MAX_SET_INDEX = 20;

/**
 * An exercise's structured target, as `workout_exercises` stores it.
 *
 * All three nullable and none implying the others — see schema.ts. '3 × 45s' is
 * three sets with no rep target; an exercise with no structured target at all
 * is three nulls, and still logs sets.
 */
export type SetTarget = {
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
};

/** A set that has been performed, narrowed to what the screen draws. */
export type LoggedSet = {
  setIndex: number;
  reps: number;
};

/**
 * One row of the sub-list: its ordinal, and what was recorded against it.
 *
 * `reps: null` is a row that exists because a target asked for it or because
 * the next set has to be enterable somewhere — not a set of no reps, which is
 * refused. The row is the offer; the absence of a number is the whole state.
 */
export type SetRow = {
  index: number;
  reps: number | null;
};

/**
 * The reps as they will be stored, or `undefined` for a value that will not be.
 *
 * Two-state rather than the three `parseNote` and `parseDuration` return, and
 * the difference is real: a note and a duration are optional columns where
 * `null` means "deliberately cleared", and `reps` is `not null`. A set with no
 * rep count is not a set with a blank field — it is a set that was not
 * performed, and the way to say that is to remove the row.
 *
 * `Number.isInteger` refuses `NaN`, `Infinity` and `8.5` in one test. The column
 * is an `integer`, so a fraction would be rounded by Postgres and come back as a
 * number nobody entered — the same failure `parseDuration` names.
 *
 * An empty string is a refusal here rather than a `null`, for the reason above:
 * the screen's control for "no set" is the tick that removes it, not an emptied
 * box. `logSet` is never the way a set is taken back.
 */
export function parseReps(value: unknown): number | undefined {
  const reps = typeof value === "string" ? Number(value) : value;

  if (typeof reps !== "number" || !Number.isInteger(reps)) return undefined;

  return reps >= 1 && reps <= MAX_REPS ? reps : undefined;
}

/**
 * The set's ordinal as it will be stored, or `undefined` for one that will not.
 *
 * 1-based, because it is printed. `01` is what § Lists asks a sub-list row to
 * carry and what the mock draws, and an index the screen renders as one number
 * and stores as another is a difference somebody eventually debugs.
 */
export function parseSetIndex(value: unknown): number | undefined {
  const index = typeof value === "string" ? Number(value) : value;

  if (typeof index !== "number" || !Number.isInteger(index)) return undefined;

  return index >= 1 && index <= MAX_SET_INDEX ? index : undefined;
}

/**
 * This exercise's sets, in the order they are performed.
 *
 * Sorted here rather than relied on from SQL. The query does order them, but
 * the screen filters one exercise out of the whole session's rows and an
 * ordering that survives a filter only by accident is one that breaks the first
 * time somebody adds a second reader.
 */
export function setsFor(
  exerciseId: string,
  sets: readonly (LoggedSet & { exerciseId: string })[],
): LoggedSet[] {
  return sets
    .filter((set) => set.exerciseId === exerciseId)
    .map(({ setIndex, reps }) => ({ setIndex, reps }))
    .sort((a, b) => a.setIndex - b.setIndex);
}

/**
 * The rows the sub-list draws for one exercise.
 *
 * Three sources decide how many, and the largest wins:
 *
 *   1. The target. '3 × 12' draws three rows before anything is logged, which
 *      is what makes the target visible as an offer rather than as a sentence.
 *   2. What is already logged. A set logged at index 4 against a target of 3 —
 *      an extra set, which is a thing that happens — keeps its row.
 *   3. One more, once every row above is filled. Otherwise a target of three,
 *      fully logged, would leave a fourth set with nowhere to be entered, and
 *      an exercise with no target at all would have no first row.
 *
 * Capped at `MAX_SET_INDEX`, so the offer can never exceed what the action will
 * accept: a row the screen draws and the server refuses is a control that
 * reports a failure the reader cannot understand.
 */
export function setRows(target: SetTarget, logged: readonly LoggedSet[]): SetRow[] {
  const highest = logged.reduce((max, set) => Math.max(max, set.setIndex), 0);
  const wanted = Math.max(target.targetSets ?? 0, highest);

  // Every row up to `wanted` filled — which is also true of zero rows, and is
  // what gives an exercise with no target and no sets its single empty row.
  const complete = logged.length >= wanted;
  const count = Math.min(wanted + (complete ? 1 : 0), MAX_SET_INDEX);

  const byIndex = new Map(logged.map((set) => [set.setIndex, set.reps]));

  return Array.from({ length: count }, (_row, position) => {
    const index = position + 1;

    return { index, reps: byIndex.get(index) ?? null };
  });
}

/**
 * Whether this exercise has been trained enough to move past.
 *
 * With a target, that is the target met. WITHOUT one it is a single set, and
 * the asymmetry is deliberate: `setRows` always offers one more row than is
 * filled, so an exercise with no target is never "full", and a definition that
 * waited for it to be would leave the derived current exercise stuck on the
 * first untargeted movement for the whole session with no way past.
 *
 * Nothing here is a judgement about the SESSION. § P3 calls partial a
 * first-class outcome and PRD § P10 forbids deriving the status from set data —
 * this decides which exercise the screen shows next, and nothing else reads it.
 */
export function isComplete(target: SetTarget, logged: readonly LoggedSet[]): boolean {
  return target.targetSets === null
    ? logged.length >= 1
    : logged.length >= target.targetSets;
}

/**
 * Which exercise the session state is showing — Brand Guide § Desktop.
 *
 * The first one whose sets are incomplete, and the LAST one when every exercise
 * is complete. Not `undefined` for the finished case: the state is still
 * entered, the reader is still standing in the gym, and a screen that emptied
 * itself the moment the last set landed would take away the thing they were
 * looking at instead of showing them the primary they came for.
 *
 * `-1` only for a session with no exercises at all, which is ordinary data —
 * the daily walk is exactly that — and never reaches the session state, since
 * `actions/training.ts` refuses the walk and the state is only offered where
 * there are rows to work through.
 */
export function currentExercise<T extends SetTarget & { id: string }>(
  exercises: readonly T[],
  sets: readonly (LoggedSet & { exerciseId: string })[],
): number {
  const next = exercises.findIndex(
    (exercise) => !isComplete(exercise, setsFor(exercise.id, sets)),
  );

  return next === -1 ? exercises.length - 1 : next;
}

/**
 * What an unlogged row offers, as words — the mock's `Target 8`.
 *
 * `null` when there is no rep target, which is not the same as no target at
 * all: '3 × 45s' is three sets of something this app does not count, so the row
 * exists and has nothing to say about how many reps belong in it.
 *
 * An en dash for a range, not a hyphen — the same figure-dash the seed's own
 * prescriptions use ('8–12 rounds'), so the two spellings of a range on one
 * screen are the same character.
 */
export function targetLabel(target: SetTarget): string | null {
  const { targetRepsLow: low, targetRepsHigh: high } = target;

  if (low === null || high === null) return null;

  return low === high ? `Target ${low}` : `Target ${low}–${high}`;
}

/**
 * How far through an exercise a session got, as words — `3 of 3 sets`.
 *
 * `null` when nothing is logged, and that is what keeps the plan state looking
 * exactly as it did before this ticket for every date nobody trained: § Desktop
 * gives set progress to the exercise's own row as slash metadata, and a row
 * that announced "0 of 3 sets" on every unlogged exercise would be reporting an
 * absence on the one screen § Tone of Voice asks to describe what will appear
 * rather than nudge about what has not.
 *
 * One spelling for both readers — the plan state's slash line and the session
 * aside's trailing column. The mock draws the aside's shorter, but they are the
 * same fact, and two spellings of one fact is how they drift.
 */
export function setProgress(target: SetTarget, logged: readonly LoggedSet[]): string | null {
  if (logged.length === 0) return null;

  return target.targetSets === null
    ? `${logged.length} ${logged.length === 1 ? "set" : "sets"}`
    : `${logged.length} of ${target.targetSets} sets`;
}
