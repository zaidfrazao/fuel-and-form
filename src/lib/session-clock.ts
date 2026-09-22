/**
 * The session clock's arithmetic — FUEL-124, Brand Guide § The two states of
 * `/training`.
 *
 * The session state used to remember one thing per date: THAT it was entered.
 * The instant `Start session` was tapped was thrown away, so there was no clock
 * to draw during the session and nothing to put in the duration box at the end
 * of it. This file is what storing the instant instead makes possible, and it is
 * `rest-timer.ts`' shape turned the other way up: that file counts down to a
 * stored end, this one counts up from a stored start, and both read the clock
 * as a subtraction rather than accumulating ticks — for `rest-timer.ts`' reason,
 * which is that a locked phone and a throttled tab stop an interval and do not
 * stop time.
 *
 * `now` is an argument, as it is there and for the same reason: every property
 * worth proving here is a statement about named instants.
 *
 * Pure and hermetic, and gated at 100% in `vitest.config.mts`: the pre-fill
 * writes a number into somebody's training record that they did not type, so
 * every way it can be wrong is a plausible figure nobody will notice.
 */

/**
 * How far in the future a stored start may be and still be believed.
 *
 * A start is written by `Date.now()` on the tap, so in principle it is never
 * after `now`. In practice a device clock is corrected — by the network, by a
 * timezone change, by hand — and a correction BACKWARDS mid-session puts the
 * stored instant a little ahead of the clock that reads it. A minute of that is
 * a clock being tidied and reads as `0:00`; more is not a start this app wrote,
 * and is refused rather than drawn as a clock stuck at zero for an hour.
 */
export const MAX_START_SKEW_MS = 60 * 1000;

/**
 * The longest session the pre-fill will put a number to.
 *
 * Three hours. The longest workout this program prescribes is well under one,
 * so a session reading past this is not a long session — it is one somebody
 * forgot to finish, and whatever minute count it has reached is a count of the
 * afternoon rather than of the training. Past it the box is left EMPTY rather
 * than capped: a capped figure would be a number this app invented and wrote
 * into the reader's record, and an empty box is the state they already had
 * before FUEL-124, with the clock still on screen to tell them roughly why.
 *
 * The key is per date, so a session cannot carry into tomorrow; this is only
 * the same-day case, which is the common one — started at lunch, recorded after
 * dinner.
 */
export const MAX_PREFILL_MS = 3 * 60 * 60 * 1000;

/**
 * The oldest start a stored value may claim: a day.
 *
 * The key is per date, so no session this app entered can be older than the
 * day it was entered on. The bound is relative to `now` rather than a calendar
 * instant for two reasons. It refuses `"1"` — the value every session entered
 * before FUEL-124 was stored as, a positive integer that would otherwise read
 * as a start one millisecond after 1970 and draw a clock showing fifty-six
 * years. And it keeps holding under a frozen clock: the visual suite runs in
 * June 2026, before this file existed, and a fixed "nothing predates FUEL-124"
 * date would have refused every start it photographed.
 */
export const MAX_START_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The stored start instant, or `null` for anything that is not one.
 *
 * `rest-timer.ts`' `parseRestEnd` refusals, re-aimed at a start: absent or
 * empty; not an integer (`NaN`, `Infinity`, a float); older than
 * `MAX_START_AGE_MS`; and further ahead of `now` than `MAX_START_SKEW_MS`.
 * Between those, an old start is a long session, and what to do about that is
 * `prefillMinutes`' question rather than a reason to refuse the reading.
 */
export function parseEnteredAt(raw: string | null, now: number): number | null {
  if (raw === null || raw === "") return null;

  const startedAt = Number(raw);

  if (!Number.isInteger(startedAt)) return null;
  if (now - startedAt > MAX_START_AGE_MS) return null;
  if (startedAt - now > MAX_START_SKEW_MS) return null;

  return startedAt;
}

/**
 * Elapsed time as `m:ss`, or `h:mm:ss` from an hour.
 *
 * **Floor, not ceiling** — the one place this file departs from `restLabel`,
 * and for the reason that one rounds up. A countdown should reach `0:00` exactly
 * when the rest ends; a count UP should not claim a second before it has passed,
 * which is what every stopwatch does. Clamped at zero, so a start a few seconds
 * ahead of the clock (see `MAX_START_SKEW_MS`) reads `0:00` rather than `-0:03`.
 */
export function elapsedLabel(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * The duration to record when the reader left the box empty, or `null` for
 * "leave it empty".
 *
 * Whole minutes, rounded to the nearest, because the box is whole minutes and
 * a 27:40 session is closer to 28 than to 27. Two refusals:
 *
 *   - **Under a minute rounds to nothing.** `session-entry.ts` refuses a zero
 *     duration, and a session finished within seconds of starting was started
 *     by mistake rather than trained for a minute.
 *   - **Past `MAX_PREFILL_MS`**, for the reason that constant gives.
 */
export function prefillMinutes(startedAt: number, now: number): number | null {
  const elapsed = now - startedAt;

  if (elapsed > MAX_PREFILL_MS) return null;

  const minutes = Math.round(elapsed / 60_000);

  return minutes >= 1 ? minutes : null;
}
