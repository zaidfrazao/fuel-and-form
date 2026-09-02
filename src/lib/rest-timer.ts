/**
 * The rest timer's arithmetic — FUEL-93, PRD § P10.
 *
 * "A manual rest timer between exercises, started and stopped by hand.
 * Client-only — nothing about a rest interval is worth a row — and counted from
 * a stored end instant rather than an accumulated one, since the phone is
 * locked for most of a ninety-second rest and a throttled tab stops counting."
 *
 * That second clause is the whole of this file, and it is here rather than in
 * the component because it is the half that can be held still. `rest-timer.tsx`
 * owns the interval, the signals and the wake lock; none of those can be
 * reasoned about without a browser. What CAN be reasoned about is the reading,
 * and the reading is a subtraction.
 *
 * ## Why an interval must not do the counting
 *
 * The obvious spelling — a `setInterval` that decrements a remaining count once
 * a second — is wrong in exactly the situation the feature exists for. Browsers
 * throttle timers in a backgrounded tab to about once a minute and suspend them
 * outright on a locked phone, so a decrementing timer comes back from a
 * ninety-second rest reading twelve seconds elapsed. It is not slightly wrong;
 * it is wrong every time it is used as intended.
 *
 * So the stored value is the **target end instant**, and every reading is
 * `end − now`. The interval then only decides how often the screen repaints: a
 * timer that was never repainted for a minute is still correct on the frame the
 * screen comes back, because nothing was accumulated to be lost. This is the
 * schema's own principle — `rotation.ts` derives the week's workout from the
 * calendar rather than from a stored cursor, `exercise-set.ts` derives the
 * current exercise from the rows rather than storing a position, and this
 * derives a duration from a clock rather than from a count of ticks.
 *
 * ## `now` is an argument
 *
 * As it is in `token.ts`, `demo.ts` and `walk-reminder.ts`, and for their
 * reason: a function that reads the clock itself can only be tested by
 * controlling the clock, and the one property this module has to prove is what
 * it says at instants a test has to be able to name — the moment the timer is
 * started, one tick before it ends, exactly on the end, and a minute after a
 * phone was picked back up.
 *
 * Pure and hermetic, and gated at 100% in `vitest.config.mts` for what depends
 * on it rather than for its size: every way it can be wrong is a plausible
 * number on a screen somebody is timing a rest against, and none of them throws.
 */

/**
 * The durations offered, in seconds.
 *
 * Three, following `WALK_PRESETS`' precedent in shape as well as in count: a
 * tap starts a common duration and there is no keypad, because a rest is chosen
 * from a handful of habits rather than dialled in. Sixty, ninety and a hundred
 * and twenty are the rests the seeded circuits are written around.
 *
 * Seconds rather than minutes — the walk's unit — because a rest is the one
 * duration in this app that is not a whole number of them.
 */
export const REST_PRESETS: readonly number[] = [60, 90, 120];

/**
 * The longest rest a stored value may claim, and the reason it is capped.
 *
 * `parseRestEnd` refuses an end instant further away than this. It is not a
 * limit on what anybody can start — no preset comes near it — but a refusal of
 * a value that cannot have come from a tap: a corrupt entry, a number written
 * by a different version of this file, or the ordinary case that is neither of
 * those, a device clock corrected BACKWARDS while a timer was running. All
 * three land as a timer counting down from an implausible figure with no way to
 * be rid of it but clearing site data, and `repeat.ts` makes the same refusal
 * for the same reason: an unbounded number that reached this app from outside
 * it is not a number to render.
 */
export const MAX_REST_MS = 60 * 60 * 1000;

/** What the screen says at one instant. */
export type RestReading = {
  /** `end − now`, floored at zero. Never negative and never accumulated. */
  remainingMs: number;
  /** That figure as `m:ss`. */
  label: string;
  /** Whether the rest is over — the tick's signal to fire and clear. */
  elapsed: boolean;
};

/**
 * A duration as `m:ss`.
 *
 * **Ceiling, not floor**, and this is the one arithmetic choice in the file
 * that is not forced. A ninety-second timer read with `floor` says `1:29` on
 * the frame it starts, because a millisecond has already gone; with `ceil` it
 * says `1:30` for the first full second and reaches `0:00` exactly when the
 * rest is over. The second is what a clock does and what the reader expects
 * from a number they just tapped.
 *
 * Clamped at zero rather than trusted, so a caller that passes a negative — a
 * clock that jumped forward, a reading taken after the end — gets `0:00` rather
 * than `-1:-3`. `restReading` already floors, and this floors again: the
 * formatter is exported for the preset labels too, and a formatter that is only
 * correct for one of its two callers is a trap.
 *
 * Minutes are not capped at sixty. `60:00` is a better answer than `0:00` for a
 * figure that should never arrive, because it is visibly wrong rather than
 * quietly plausible.
 */
export function restLabel(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * What the timer reads at `now`, given the instant it ends.
 *
 * The whole of the counting. There is no state here and nothing carried between
 * calls, which is what makes a throttled tab, a locked phone and a reload the
 * same case: each of them is a call with a larger `now`.
 */
export function restReading(endsAt: number, now: number): RestReading {
  const remainingMs = Math.max(0, endsAt - now);

  return { remainingMs, label: restLabel(remainingMs), elapsed: remainingMs === 0 };
}

/**
 * The stored end instant, or `null` for anything that is not one.
 *
 * FUEL-93's criterion: "a corrupt or absent stored value renders no timer
 * rather than throwing". `localStorage` is a string store that anybody with
 * devtools can write to, that survives a deployment, and that this app shares
 * an origin with everything else it has ever stored — so every value read out
 * of it is untrusted input, exactly as `cursor.ts` treats the cookie it parses.
 *
 * The refusals, and what each one is:
 *
 *   - Absent or empty — the ordinary state. No timer has been started.
 *   - Not an integer — `NaN`, `Infinity`, `"soon"`, a float. `Number.isInteger`
 *     is one predicate for all four, and it is the check rather than
 *     `Number.isNaN` because `Infinity - now` is `Infinity`, which formats as
 *     `NaN:NaN` and never elapses.
 *   - Already past. A rest that ended is a rest that is over: the row shows its
 *     presets again rather than a frozen `0:00` with a Stop button beside it.
 *     This is also the reaper — a key left behind by a session yesterday is
 *     refused on the next read rather than accumulating — which is why nothing
 *     sweeps this key on a schedule.
 *   - Beyond the cap. See `MAX_REST_MS`.
 *
 * `now` rather than a bare validity check, because two of those four are
 * statements about the clock and not about the string.
 */
export function parseRestEnd(raw: string | null, now: number): number | null {
  if (raw === null || raw === "") return null;

  const endsAt = Number(raw);

  if (!Number.isInteger(endsAt)) return null;
  if (endsAt <= now) return null;
  if (endsAt - now > MAX_REST_MS) return null;

  return endsAt;
}
