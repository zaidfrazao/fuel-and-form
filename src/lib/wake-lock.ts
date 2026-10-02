import type { RefObject } from "react";

/**
 * The screen wake lock, held by whatever needs the screen to stay up.
 *
 * Extracted from `rest-timer.tsx` by FUEL-101, unchanged, because a second
 * feature now needs it and a second copy would be two files spelling one
 * literal — each with its own test, both agreeing with each other rather than
 * with the platform. The two callers want it for reasons that sound similar and
 * are not:
 *
 *   - **The rest timer** wants the readout glanceable, and the lock is a
 *     convenience. It says so: the lock is explicitly *not* a substitute for
 *     the buzz and the beep, because the case that feature exists for is a
 *     phone face-down on a bench.
 *   - **A walk recording** wants the lock because without it the feature does
 *     not work at all. `watchPosition` stops when the screen locks, there is no
 *     background geolocation on the web, and PRD § P11 makes that the design
 *     constraint rather than a caveat. A walk recorded with the phone in a
 *     pocket records nothing after the screen times out.
 *
 * What both share, and the reason this is worth a module: **the platform drops
 * the lock when the tab is hidden and does not reacquire it.** Every caller
 * therefore owes a re-request on `visibilitychange`, and — for a phone that
 * comes back from the bfcache after an hour in another app, which fires nothing
 * else — on `pageshow`. That obligation is stated here because it is the part
 * that is invisible when it is missing: the lock is held, then quietly is not,
 * and nothing on screen changes.
 *
 * ## Not a hook
 *
 * Two functions over a ref rather than a `useWakeLock(active)` hook, which was
 * the obvious shape and is refused: the rest timer's `visibilitychange`
 * handler does more than the lock — it also recomputes the readout on the frame
 * the screen returns, before a throttled interval gets to run — and the
 * ordering of that is tested. A hook would bind a second listener and the two
 * would race for no gain. The tricky part of this is not the listener, it is
 * `hold`'s two guards, and those are what is shared here.
 */

/**
 * Takes the lock, or quietly does not.
 *
 * `sentinel.released` is checked rather than the ref alone, because a dropped
 * lock leaves a sentinel object behind: a ref that is merely non-null would
 * make the re-request a no-op in exactly the case it was added for.
 *
 * ## `wanted` is not defensive — it closes a leak
 *
 * `request` is asynchronous, and the reason for holding it can end while the
 * platform is still deciding: a Stop tapped just after a start, a timer expiring
 * on the next tick, or the screen being left altogether. The effect's cleanup
 * runs first and finds the ref still null, so `release` has nothing to let go
 * of — and then this `await` resolves and files a LIVE lock in a ref nothing
 * will ever read again. The result is a screen that never sleeps, with nothing
 * on it to explain why, until the tab is closed.
 *
 * So the answer is re-checked after the await, and a lock that is no longer
 * wanted is released immediately rather than stored. Callers must set
 * `wanted.current = false` BEFORE calling `release`, or the two guards do not
 * meet.
 *
 * ## Nor is a second grant — two requests can be in flight at once
 *
 * The first guard only sees a lock that has already been *stored*, so two
 * calls made before either is answered both ask, and both answers arrive
 * wanted. Storing the second overwrote the first, which was then held by
 * nothing anyone would release: the same invisible leak as above, outliving
 * the screen that took it until the tab was hidden. It is reachable three
 * ways — a return that fires `visibilitychange` and `pageshow` together,
 * React's development double-mount, and a Stop then Start inside the
 * platform's answer (FUEL-145). So a grant that finds a live lock already
 * filed is released, and the one that got there first is kept.
 */
export async function hold(
  ref: RefObject<WakeLockSentinel | null>,
  wanted: RefObject<boolean>,
): Promise<void> {
  if (ref.current && !ref.current.released) return;

  try {
    const sentinel = await navigator.wakeLock.request("screen");

    const held = ref.current !== null && !ref.current.released;

    if (!wanted.current || held) {
      void sentinel.release().catch(() => {});
      return;
    }

    ref.current = sentinel;
  } catch {
    // Unsupported — Firefox, and every iOS before 16.4 — or refused because the
    // document was not visible at the moment of asking. Nothing depends on it.
  }
}

/** Lets the lock go. Safe to call when there is none. */
export function release(ref: RefObject<WakeLockSentinel | null>): void {
  const sentinel = ref.current;

  // Cleared first, so a release that rejects does not leave a sentinel the next
  // `hold` would decline to replace.
  ref.current = null;

  try {
    void sentinel?.release().catch(() => {});
  } catch {
    // Already released by the platform. There is nothing this could do about it.
  }
}
