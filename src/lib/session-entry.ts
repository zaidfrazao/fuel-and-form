import type { WorkoutLogStatus } from "./db/schema";

/**
 * What a training entry is allowed to say — FUEL-27's refusals.
 *
 * Every value below arrives from a Server Action, which is to say from anyone
 * who can POST to this app. `actions/training.ts` resolves the session and the
 * date for itself, so the ADDRESS of a write cannot be chosen by a caller; what
 * remains choosable is the three fields here, and this is where they are
 * checked.
 *
 * ## Why it is a module and not three lines in the action
 *
 * `lib/repeat.ts` and `lib/template-plan.ts` both give the reason and it applies
 * unchanged: a refusal exercised only through a Server Action is one no hermetic
 * test can hold still, and these are refusals whose failure mode is silent. A
 * status that is not checked reaches Postgres as an invalid enum value and
 * throws — a 500 on a screen whose contract is that it never throws. A duration
 * that is not checked is stored: `-40`, `0.5`, `1e9`, each of them a number the
 * weekly export will later sum and present as fact.
 *
 * ## One function, not three guards
 *
 * The three fields are written together — one row, one statement — so they are
 * refused together. A caller that had to remember three separate checks would
 * eventually remember two, and the field it forgot would be the one nobody
 * looks at on the screen.
 *
 * ## Pure, and given its values
 *
 * No database, no clock, no session, and only a TYPE import from the schema.
 * The status list is restated here as a value rather than read from the Drizzle
 * enum so that a client component can import this module without dragging
 * pg-core into the browser bundle — the rule `resolve-plan.ts` states and
 * `template-plan.ts` follows. `session-entry.test.ts` asserts the list against
 * `workoutLogStatus.enumValues`, so it cannot drift from the database's idea of
 * a status without a failing test.
 */

/**
 * The three outcomes, in the order the screen offers them.
 *
 * Done first because it is the primary button — § Buttons, "the one action the
 * screen exists for" — and partial before skipped because that is the mock's
 * own order in the secondary row.
 */
export const SESSION_STATUSES = ["done", "partial", "skipped"] as const;

/**
 * The longest note that will be stored.
 *
 * `workout_logs.note` is unconstrained `text`, so this is a product decision
 * rather than a schema one. PRD § P3 describes the note as "reps achieved, how
 * it felt" — a sentence, not a journal — and something has to bound a column
 * that anyone who can POST to the app can fill.
 *
 * Refused rather than truncated. Silently storing the first 500 characters of
 * what someone wrote and dropping the rest is a worse answer than saying no:
 * the user would see their own note come back shortened with nothing to
 * explain it. The textarea carries the same limit as `maxLength`, so the
 * refusal is unreachable through the screen and is only ever a forged request.
 */
export const MAX_NOTE_LENGTH = 500;

/**
 * The longest session that can be recorded, in minutes — twelve hours.
 *
 * Not a judgement about training. It is an upper bound on a number the weekly
 * export will sum, chosen far above anything the program prescribes (§ P3's
 * sessions are 25-30 minutes) and far below the point where a total stops
 * meaning anything. A day has 1440 minutes, so this also refuses the class of
 * value that could only be a typo or a probe.
 */
export const MAX_DURATION_MIN = 12 * 60;

/** Whether `value` is one of the three statuses `workout_log_status` holds. */
export function isSessionStatus(value: unknown): value is WorkoutLogStatus {
  return (
    typeof value === "string" && SESSION_STATUSES.includes(value as WorkoutLogStatus)
  );
}

/** A validated row's worth of entry — what `recordSession` takes. */
export type SessionEntry = {
  status: WorkoutLogStatus;
  note: string | null;
  durationMin: number | null;
};

/**
 * The note as it will be stored, or `undefined` for one that will not be.
 *
 * `null` and `undefined` are different answers and the difference is the whole
 * function: `null` is a note deliberately cleared, which the update must write,
 * and `undefined` is a refusal. Returning `null` for both would let a
 * 10,000-character note silently clear the note that was already there.
 *
 * Trimmed, and whitespace alone becomes `null`. A note of three spaces is not a
 * note, and storing it would put an empty line on the screen that nothing
 * explains and no control obviously removes.
 */
function noteOf(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  return trimmed.length > MAX_NOTE_LENGTH ? undefined : trimmed;
}

/**
 * The duration as it will be stored, or `undefined` for one that will not be.
 *
 * The same three-state answer as `noteOf`, and the same reason for it.
 *
 * Exported, unlike `noteOf`, because the daily walk records a duration and no
 * note (FUEL-29) — `lib/walk.ts` parses its one untrusted field through this
 * function rather than restating the bound. Same column, same limit, and a
 * second copy of `Number.isInteger(...) && n > 0 && n <= MAX_DURATION_MIN` is a
 * second thing to get wrong in exactly the way this file exists to prevent.
 *
 * An empty string is `null` rather than a refusal, because that is what an
 * emptied number input sends and clearing the field is a thing the screen
 * offers. Everything else has to be a whole number of minutes in range:
 * `Number.isInteger` refuses `NaN`, `Infinity` and `20.5` in one test —
 * `duration_min` is an `integer` column, so a fraction would be rounded by
 * Postgres and come back as a number nobody entered.
 *
 * Zero is refused. A session that took no time did not happen, and the honest
 * way to say a duration is unknown is to leave it empty, which is `null`.
 */
export function parseDuration(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;

  const minutes = typeof value === "string" ? Number(value) : value;

  if (typeof minutes !== "number" || !Number.isInteger(minutes)) return undefined;

  return minutes > 0 && minutes <= MAX_DURATION_MIN ? minutes : undefined;
}

/**
 * The entry a request is asking to record, or `null` if it is not a valid one.
 *
 * One answer for every refusal, on `login/actions.ts`'s reasoning: the screen's
 * response to all of them is identical, and a caller who could tell a bad status
 * from an over-long note learns something about the deployment for nothing.
 */
export function parseSessionEntry(input: {
  status: unknown;
  note?: unknown;
  durationMin?: unknown;
}): SessionEntry | null {
  if (!isSessionStatus(input.status)) return null;

  const note = noteOf(input.note);
  const durationMin = parseDuration(input.durationMin);

  if (note === undefined || durationMin === undefined) return null;

  return { status: input.status, note, durationMin };
}
