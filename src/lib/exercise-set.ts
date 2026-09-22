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
 * The longest a single timed set can record, in seconds — FUEL-123.
 *
 * An hour, on `MAX_REPS`'s terms: far above the longest hold this program
 * prescribes (a minute of plank) and far below the point where a figure stops
 * meaning a set. `exercise_sets_seconds_range` holds the column to the same.
 */
export const MAX_SECONDS = 3600;

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
 * All nullable and none implying the others — see schema.ts. An exercise with
 * no structured target at all is all nulls, and still logs sets. A reps target
 * and a seconds target never coexist (`workout_exercises_one_target_unit`).
 */
export type SetTarget = {
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
  targetSecondsLow: number | null;
  targetSecondsHigh: number | null;
};

/**
 * What an exercise's sets are counted in — FUEL-123.
 *
 * `seconds` for an exercise with a seconds target, and `reps` for everything
 * else, including an exercise with no target at all: that is what every set
 * was before timed sets existed, so an untargeted row keeps meaning what it
 * meant. Decided from the TARGET and never from the prescription, which is
 * still displayed verbatim and never parsed.
 */
export type SetKind = "reps" | "seconds";

export function setKind(target: SetTarget): SetKind {
  return target.targetSecondsLow === null ? "reps" : "seconds";
}

/**
 * The low end of the target in the exercise's own unit, or `null` for none.
 *
 * What an empty box offers as its placeholder and what the tick logs from it —
 * one function for both, so the box can never offer one number while the tick
 * records another.
 */
export function targetLow(target: SetTarget): number | null {
  return setKind(target) === "seconds" ? target.targetSecondsLow : target.targetRepsLow;
}

/**
 * A set that has been performed, narrowed to what the screen draws.
 *
 * `value` is reps or seconds, and which is the exercise's `setKind` — the
 * number alone, because every set of one exercise is in one unit.
 */
export type LoggedSet = {
  setIndex: number;
  value: number;
};

/**
 * One row of the sub-list: its ordinal, and what was recorded against it.
 *
 * `value: null` is a row that exists because a target asked for it or because
 * the next set has to be enterable somewhere — not a set of nothing, which is
 * refused. The row is the offer; the absence of a number is the whole state.
 */
export type SetRow = {
  index: number;
  value: number | null;
};

/**
 * A stored set's one number, whichever column holds it — FUEL-123.
 *
 * `exercise_sets_one_unit` makes exactly one of the two non-null, so the throw
 * is unreachable against the schema. It is a throw rather than a `0` for the
 * reason `parseSetValue` refuses zero: a set of nothing did not happen, and a
 * reader handed one would draw it as performed.
 */
export function setValue(row: { reps: number | null; seconds: number | null }): number {
  const value = row.seconds ?? row.reps;

  if (value === null) throw new Error("A set row holds neither reps nor seconds.");

  return value;
}

/**
 * `setValue` the other way round: a number in its unit's column and null in
 * the other, which is the row `exercise_sets_one_unit` accepts. The write and
 * the screen's own estimate (which costs the optimistic sets, FUEL-95) both
 * build a stored set here, so the two cannot disagree about which is which.
 */
export function storedSet(
  kind: SetKind,
  value: number,
): { reps: number | null; seconds: number | null } {
  return kind === "seconds" ? { reps: null, seconds: value } : { reps: value, seconds: null };
}

/**
 * The set's number as it will be stored, or `undefined` for one that will not.
 *
 * Bounded by the unit: `MAX_REPS` for reps, `MAX_SECONDS` for seconds.
 *
 * Two-state rather than the three `parseNote` and `parseDuration` return, and
 * the difference is real: a note and a duration are optional columns where
 * `null` means "deliberately cleared", and a set must hold a number. A set with
 * no number is not a set with a blank field — it is a set that was not
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
export function parseSetValue(value: unknown, kind: SetKind): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isInteger(parsed)) return undefined;

  const max = kind === "seconds" ? MAX_SECONDS : MAX_REPS;

  return parsed >= 1 && parsed <= max ? parsed : undefined;
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
    .map(({ setIndex, value }) => ({ setIndex, value }))
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

  const byIndex = new Map(logged.map((set) => [set.setIndex, set.value]));

  return Array.from({ length: count }, (_row, position) => {
    const index = position + 1;

    return { index, value: byIndex.get(index) ?? null };
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
 * Whether a workout of this type is stepped round by round — FUEL-119.
 *
 * Keyed on `workouts.type` and nothing else. The format is written in the
 * workout's description — "3 rounds. Each exercise back to back" — and § P10
 * forbids parsing prose, so the type is the only structured thing that says it.
 * A `rounds` column would store the exercises' own `target_sets` a second
 * time. Every other type, including one the app has never seen, steps exercise
 * by exercise, which is what it did before this existed.
 */
export function stepsByRound(type: string): boolean {
  return type === "circuit";
}

/**
 * Where the session state is: which exercise, and in a circuit which round.
 *
 * `round` and `rounds` are `null` where there are no rounds to name, which is
 * every session not stepped by round, and a circuit whose exercises have one
 * set each, where "Round 1 of 1" would count nothing.
 */
export type SessionPosition = {
  index: number;
  round: number | null;
  rounds: number | null;
};

/**
 * Where the reader has moved without logging — FUEL-120.
 *
 * The one thing the position cannot read off the sets, because it is exactly
 * the thing the sets do not say: that a set was NOT done and the reader went on
 * anyway. Held in `localStorage` beside the entered boolean and never in the
 * database. A stored "skipped" set would be a new kind of set, and a step
 * towards the completion arithmetic § P10 refuses.
 *
 * `passed` is the steps moved on from before they were logged. They count as
 * behind the reader, so finishing the next exercise moves on to the one after
 * it rather than back to the one passed. `at` is a step behind the derived
 * position that the reader went back to. It is honoured only while it IS
 * behind: anything that moves the derived position back to or before it (a
 * removed set) makes it inert, and the data wins.
 *
 * Both hold step KEYS rather than indexes, for the reason `SessionList` holds
 * an id: a key names an exercise, and one the plan no longer has names nothing
 * and is ignored rather than landing on whatever now sits at its index.
 */
export type Moved = {
  passed: readonly string[];
  at: string | null;
};

/** Where every session starts: nothing moved, the position purely derived. */
export const NOT_MOVED: Moved = { passed: [], at: null };

/**
 * The most steps `passed` is read with.
 *
 * `localStorage` is anyone's to edit, and this bounds what a hand-edited value
 * can make the screen do per render. No session this program prescribes has
 * more than a few dozen steps — five exercises by three rounds is fifteen.
 */
export const MAX_PASSED = 100;

/**
 * A stored `Moved`, or `NOT_MOVED` for anything that is not one.
 *
 * The value comes back from `localStorage` as whatever was left there, by this
 * code, an older copy of it, or a person with devtools. Anything malformed is
 * read as nothing moved, which is the position as the data has it: the worst a
 * bad value can do is forget where the reader went.
 */
export function parseMoved(raw: string | null): Moved {
  if (raw === null) return NOT_MOVED;

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return NOT_MOVED;
  }

  if (typeof value !== "object" || value === null) return NOT_MOVED;

  const { passed, at } = value as Record<string, unknown>;

  if (!Array.isArray(passed) || !passed.every((key) => typeof key === "string")) {
    return NOT_MOVED;
  }

  if (at !== null && typeof at !== "string") return NOT_MOVED;

  return { passed: passed.slice(0, MAX_PASSED), at };
}

/**
 * The session as the ordered steps the state walks through — FUEL-119, FUEL-120.
 *
 * Not by round: one step per exercise, done when `isComplete` says so. By round:
 * one step per exercise per round it takes part in, round-major, done when that
 * round's set number is logged. That is `sessionPosition`'s rule written out as
 * a list, which is what a Previous and a Next need: a derivation says where the
 * reader IS, and only a sequence says what is either side.
 */
function sessionSteps<T extends SetTarget & { id: string }>(
  exercises: readonly T[],
  sets: readonly (LoggedSet & { exerciseId: string })[],
  byRound: boolean,
) {
  const roundsOf = (exercise: T) => exercise.targetSets ?? 1;
  const rounds = Math.max(0, ...exercises.map(roundsOf));

  if (!byRound || rounds < 2) {
    return {
      rounds: null,
      steps: exercises.map((exercise, index) => ({
        index,
        round: null,
        key: exercise.id,
        done: isComplete(exercise, setsFor(exercise.id, sets)),
      })),
    };
  }

  const logged = new Set(sets.map((set) => `${set.exerciseId}#${set.setIndex}`));

  const steps = Array.from({ length: rounds }, (_unused, at) => at + 1).flatMap((round) =>
    exercises.flatMap((exercise, index) => {
      if (roundsOf(exercise) < round) return [];

      const key = `${exercise.id}#${round}`;

      return [{ index, round, key, done: logged.has(key) }];
    }),
  );

  return { rounds, steps };
}

/**
 * Which step the state is showing, and which step the data alone would show.
 *
 * The derived step is the first one neither done nor passed, or the LAST step
 * when there is none, for the reason `currentExercise` gives. The shown step is
 * `at` where that is behind the derived one, and the derived one otherwise.
 */
function locate<T extends SetTarget & { id: string }>(
  exercises: readonly T[],
  sets: readonly (LoggedSet & { exerciseId: string })[],
  byRound: boolean,
  moved: Moved,
) {
  const { rounds, steps } = sessionSteps(exercises, sets, byRound);
  const passed = new Set(moved.passed);

  const open = steps.findIndex((step) => !step.done && !passed.has(step.key));
  const derived = open === -1 ? steps.length - 1 : open;

  const back = moved.at === null ? -1 : steps.findIndex((step) => step.key === moved.at);
  const current = back !== -1 && back < derived ? back : derived;

  return { rounds, steps, derived, current };
}

/**
 * Which exercise the session state is showing, and which round — Brand Guide
 * § The two states of `/training`, FUEL-119 and FUEL-120.
 *
 * Not a round-by-round session: `currentExercise`, unchanged.
 *
 * A round-by-round session: the round is the lowest set number some exercise
 * still lacks, among the exercises whose target reaches it, and the exercise is
 * the first one lacking it. So squats' set 1 is followed by push-ups' set 1,
 * and round 2 begins at the first exercise once round 1 has reached the last.
 *
 * SET NUMBERS, not counts, and that is what makes the position move back
 * consistently. Removing squats' set 1 in round 2 leaves squats without set 1,
 * so the position returns to exactly that gap, and a set logged ahead of its
 * round (squats' set 3 in round 1) fills no gap and moves nothing. A count
 * would read that stray set 3 as round 1 done.
 *
 * An exercise's target decides the rounds it takes part in: a shorter target
 * drops out of the later rounds, and no target at all is one round, which is
 * `isComplete`'s own reading of an untargeted exercise. The number of rounds is
 * the largest target, and never stored.
 *
 * When every round is done it holds on the last step: the last exercise that
 * takes part in the last round, for the reason `currentExercise` gives.
 *
 * `moved` is FUEL-120's way past, and with `NOT_MOVED` this is the derivation
 * above exactly. A passed step counts as behind the reader, and a step gone back
 * to is shown while it is behind the derived one. See `Moved`.
 */
export function sessionPosition<T extends SetTarget & { id: string }>(
  exercises: readonly T[],
  sets: readonly (LoggedSet & { exerciseId: string })[],
  byRound: boolean,
  moved: Moved = NOT_MOVED,
): SessionPosition {
  const { rounds, steps, current } = locate(exercises, sets, byRound, moved);
  const step = steps[current];

  return step
    ? { index: step.index, round: step.round, rounds }
    : { index: -1, round: null, rounds: null };
}

/**
 * One step towards the end of the session or back towards its start, without
 * logging anything — FUEL-120.
 *
 * `null` when there is no step that way, which is what the screen reads to draw
 * no control at all rather than a disabled one.
 *
 * Otherwise where the step lands, and the `Moved` that puts it there, for the
 * caller to store. Exactly ONE step either way, whatever the sets say about the
 * steps beyond it:
 *
 *   - Next from a step not yet done passes it. Next from one that is done (one
 *     gone back to) passes nothing, because a logged step needs no marker to be
 *     behind the reader.
 *   - Next lands by going back to the following step when that is still behind
 *     the derived position, and by clearing `at` when it is the derived one.
 *     Only the first is possible in a circuit with a set logged ahead of its
 *     round, where the derived position can be several steps on.
 *   - Previous goes back to the step before, logged or passed alike: the way to
 *     correct a set or to finish an exercise passed too soon.
 *
 * Nothing here writes a set or reads a status. § P10 forbids deriving the
 * session's status from set data, and a move is less than set data.
 */
export function stepSession<T extends SetTarget & { id: string }>(
  exercises: readonly T[],
  sets: readonly (LoggedSet & { exerciseId: string })[],
  byRound: boolean,
  moved: Moved,
  direction: "next" | "previous",
): { position: SessionPosition; moved: Moved } | null {
  const { rounds, steps, current } = locate(exercises, sets, byRound, moved);
  const target = direction === "next" ? current + 1 : current - 1;
  const step = steps[target];

  if (!step) return null;

  const position = { index: step.index, round: step.round, rounds };

  if (direction === "previous") return { position, moved: { ...moved, at: step.key } };

  // Defined whenever `step` is: a step either side means this one exists.
  const leaving = steps[current]!;
  const passed =
    leaving.done || moved.passed.includes(leaving.key)
      ? moved.passed
      : [...moved.passed, leaving.key];

  const { derived } = locate(exercises, sets, byRound, { passed, at: null });

  return { position, moved: { passed, at: target < derived ? step.key : null } };
}

/**
 * The word a logged set's number is counted in, as the set row prints it —
 * FUEL-123.
 *
 * `sec` rather than `s` or `seconds`: it is the seed's own spelling ('3 x
 * 30–60 sec'), so the prescription above the rows and the rows themselves
 * name the unit the same way. The TARGET is written `30–60s` instead — see
 * `targetLabel` — because that line has no room for the word.
 */
export const UNIT_WORD: Readonly<Record<SetKind, string>> = {
  reps: "reps",
  seconds: "sec",
};

/**
 * What an unlogged row offers, as words — the mock's `Target 8`.
 *
 * `Target 8–12` for reps, and `Target 30–60s` for seconds (FUEL-123). The
 * reps form names no unit because it never did, and a number beside a box is
 * read as reps; a seconds target has to say so, or a plank reads `Target
 * 30–60` and is logged as thirty of something.
 *
 * `s` against the figure, not ` sec`, and that is width: with last time's
 * clause, `Target 30–60 sec · 60 last time` is wider than the 375 row's unit
 * line and wraps. Brand Guide § Lists › Sub-lists records the measurement.
 *
 * `null` when there is no target in the exercise's unit, which is not the same
 * as no target at all: a set count alone is a row with nothing to say about
 * what belongs in it.
 *
 * An en dash for a range, not a hyphen — the same figure-dash the seed's own
 * prescriptions use ('8–12 rounds'), so the two spellings of a range on one
 * screen are the same character.
 */
export function targetLabel(target: SetTarget): string | null {
  const kind = setKind(target);
  const [low, high] =
    kind === "seconds"
      ? [target.targetSecondsLow, target.targetSecondsHigh]
      : [target.targetRepsLow, target.targetRepsHigh];

  if (low === null || high === null) return null;

  const range = low === high ? `${low}` : `${low}–${high}`;

  return kind === "seconds" ? `Target ${range}s` : `Target ${range}`;
}

/**
 * What this set was done at last time — § P10's recall, FUEL-122 — or `null`.
 *
 * In the exercise's own unit, since `LoggedSet` is: last time's plank is
 * seconds, not reps (FUEL-123).
 *
 * By SET NUMBER, not by position in the list: last time's third set is what
 * row 3 is compared against, and a last time that stopped at two sets gives
 * row 3 nothing rather than its second set's figure.
 *
 * Recall, and never more than one number. Not the best of last time's sets,
 * not an average, not a suggestion — PRD § P10 records why each of those is
 * the progression engine § Non-Goals rules out.
 */
export function lastTimeValue(index: number, previous: readonly LoggedSet[]): number | null {
  return previous.find((set) => set.setIndex === index)?.value ?? null;
}

/**
 * The words beside a set's box: the unit, and what last time was.
 *
 * `Target 8–12` for a row still on offer, `reps` once it is logged, and `reps`
 * alone for an exercise with no rep target — or `Target 30–60s` and `sec`
 * for a timed one (FUEL-123). Last time follows as a clause — `Target 8–12 ·
 * 10 last time` — in the slash lines' own middle dot, and names no unit of its
 * own: the line already has, and a second `sec` is width the 375 row does not
 * have to spare. A row with no last time carries no clause at all: no dash, no
 * zero, no "first time". § Tone of Voice describes what is there.
 *
 * Text, and never the box's placeholder. The placeholder is the target's low
 * end because that is what the tick logs from an empty box (see `targetLow`),
 * and a placeholder reading last time's figure would have the box offer one
 * number while the tick recorded another.
 */
export function setUnitLine(
  target: SetTarget,
  logged: boolean,
  lastTime: number | null,
): string {
  const word = UNIT_WORD[setKind(target)];
  const unit = logged ? word : (targetLabel(target) ?? word);

  return lastTime === null ? unit : `${unit} · ${lastTime} last time`;
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
