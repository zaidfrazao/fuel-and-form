"use client";

import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { REST_PRESETS, parseRestEnd, restLabel, restReading } from "@/lib/rest-timer";

/**
 * The rest timer — FUEL-93, PRD § P10, Brand Guide § Desktop and § Feedback.
 *
 * A row of `/training`'s session action bar, above the controls, in the slot
 * § Feedback gives the failure banner. FUEL-90 ruled the position and the
 * behaviour before this ticket was picked up: "the bar is a flex column of at
 * most three things — banner, timer, controls — rather than growing a fourth
 * button. A fourth control would be a third row of slabs on a phone, and it
 * would misfile a readout as an action."
 *
 * Two of the ticket's criteria are therefore already met by where this renders.
 * It is **not a modal** — § Progressive Disclosure rules those out, and nothing
 * here opens anything — and it is **visible while the exercise list scrolls**,
 * because `SESSION_ACTION_BAR` is pinned at every width. That pinning is
 * § Desktop's one named exception to FUEL-72's desktop release, and `rest
 * timer` is the reason it exists: `action-bar.ts` carries the argument.
 *
 * ## The arithmetic is not here
 *
 * `lib/rest-timer.ts` is, and it carries the reasoning for why the stored value
 * is an end instant rather than a remaining count. What is here is everything
 * that needs a browser: the store, the repaint interval, the three completion
 * signals and the wake lock. All four degrade to nothing, silently, and the
 * component still renders — which is the shape P9 already established for push,
 * and the PRD's words for it are "degrades silently — no errors surfaced to the
 * user".
 *
 * ## Zero writes
 *
 * No Server Action, no row, no `user_id`. § P10 ruled that a rest interval is
 * not worth a row and this ticket restates it, so the only thing that outlives
 * the render is thirteen bytes in `localStorage`.
 */

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where the running timer is kept, so a reload or a hop to `/` and back does
 * not lose it.
 *
 * One key rather than one per date, unlike `training.tsx`'s session boolean. A
 * rest is not a property of a day — it is ninety seconds long and the only date
 * it can belong to is the one it was started on — and `parseRestEnd` refuses an
 * instant already past, so a key left behind by yesterday is refused on the
 * next read rather than needing a date in its name to be unreachable.
 */
const KEY = "fuel:rest-timer";

/**
 * The end instant, as React sees it. `undefined` means "not read yet".
 *
 * A module variable mirrored to `localStorage`, and NOT `training.tsx`'s
 * arrangement, where the snapshot reads storage on every call. That shape is
 * right for the boolean it serves and wrong here, in two ways that both matter:
 *
 *   - **A snapshot computed against the clock cannot be a snapshot.**
 *     `parseRestEnd` refuses a past instant, so a storage-reading snapshot would
 *     silently change its answer the moment the clock passed the end, with
 *     nothing having notified React. `useSyncExternalStore` requires a value
 *     that only changes when the store says so. Expiry is a tick's job, below,
 *     and it goes through the same write path a Stop tap does.
 *
 *   - **A throwing `localStorage` would break the feature rather than a
 *     convenience of it.** It throws outright in a Safari private window and in
 *     any browser set to block site data. If storage were the state, the start
 *     button would do nothing at all in those browsers. Here the write is a
 *     MIRROR: it is attempted, its failure is swallowed, and the timer runs for
 *     the life of the page regardless. What is lost is the reload, which is
 *     what `rememberEntered` already documents losing for the same reason.
 *
 * Seeded lazily rather than at module scope, because this file is imported by a
 * component the server renders and `window` is not there.
 */
let cached: number | null | undefined;

/**
 * The instant the screen is currently painting, and the reason the component
 * body reads no clock at all.
 *
 * `Date.now()` during render is impure — the same render can produce two
 * answers — and `react-hooks/purity` refuses it, correctly: React is entitled
 * to render a component twice and expect the same output, and a timer that
 * disagreed with itself between those two renders would be a value nothing
 * could have made stable.
 *
 * So the clock is part of the store rather than something render reaches for.
 * `emit` stamps this instant and notifies; a snapshot returns what was stamped;
 * and the tick, whose whole job is to say "paint again", is what advances it.
 * The reading is then a pure function of two numbers React was handed, and the
 * arithmetic is unchanged — it is still `end − now`, and `now` is still the
 * clock, read a few microseconds earlier and written down.
 *
 * `undefined` until the first read, for `cached`'s reason: this module is
 * imported by a component the server renders, and there is no clock question to
 * answer there.
 */
let painted: number | undefined;

const listeners = new Set<() => void>();

/** Never throws. A store that cannot be read is a page with no timer running. */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function snapshot(): number | null {
  if (cached === undefined) cached = parseRestEnd(readStored(), Date.now());

  return cached;
}

function paintedSnapshot(): number {
  if (painted === undefined) painted = Date.now();

  return painted;
}

/**
 * One repaint: the clock is stamped and everybody watching is told.
 *
 * Every notification stamps, including the one a Stop or a start produces.
 * A notification that left the stamp alone would paint a rest that had just
 * been started against an instant from whenever the screen last moved — a
 * ninety-second timer opening at `2:15` because the reader had been reading.
 */
function emit(): void {
  painted = Date.now();

  for (const listener of listeners) listener();
}

/**
 * Starts, stops and expiry all come through here — one write, one notification.
 *
 * The mirror is attempted after the in-memory value is already set, so a store
 * that refuses the write costs the reload and nothing on this page.
 */
function write(endsAt: number | null): void {
  cached = endsAt;

  try {
    if (endsAt === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(endsAt));
  } catch {
    // Nothing to do and nothing to say — see the header. The timer runs.
  }

  emit();
}

/** The tap that starts a rest. Module scope, so no clock is read in render. */
function startRest(seconds: number, audio: RefObject<AudioContext | null>): void {
  // On the tap, because this is the gesture — see `prime`.
  prime(audio);
  write(Date.now() + seconds * 1000);
}

/**
 * `storage` is subscribed to for `training.tsx`'s reason: a timer started in
 * another tab is not a tab left showing presets. It does not fire in the tab
 * that made the change, which is what `emit` is for.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const invalidate = () => {
    cached = undefined;
    emit();
  };

  window.addEventListener("storage", invalidate);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", invalidate);

    // Nothing is observing any more, so nothing needs the value held stable —
    // and a cache kept past its subscribers is a cache that can only go stale.
    // The next mount reads the store again, which is what makes a rest started
    // here still running after a hop to `/` and back.
    //
    // The one thing this gives up is the page where `localStorage` THROWS, and
    // it gives it up knowingly: there the in-memory value is the only record, so
    // leaving the screen loses the timer. That browser has already lost the
    // reload for the same reason, and a module variable outliving every mount
    // in order to serve it would be a second source of truth for the sake of a
    // case that is degraded either way.
    if (listeners.size === 0) {
      cached = undefined;
      painted = undefined;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* The signals — every one of them best-effort, none of them able to throw      */
/* -------------------------------------------------------------------------- */

/**
 * How often the screen repaints while a timer runs.
 *
 * 250ms and not 1000, and the reason is that the interval does not decide the
 * reading. A one-second interval drifts against the true second boundary by
 * whatever fraction the timer was started at, so the readout holds one figure
 * for nearly two seconds and then skips one. At 250 the label changes within a
 * quarter-second of the boundary it belongs to, and the cost is 360 repaints of
 * a single text node over a ninety-second rest.
 */
const TICK_MS = 250;

/** A pattern rather than a buzz: two pulses read as a signal, one as a knock. */
const VIBRATION = [120, 90, 120];

const TONE_HZ = 880;
const TONE_SECONDS = 0.18;
/** Quiet on purpose. This is a phone on a gym floor, not an alarm clock. */
const TONE_GAIN = 0.14;

/**
 * § Tone of Voice, and the same division `push.ts` makes for the walk: the
 * app's name identifies an unexpected notification, and the statement goes in
 * the body. No exclamation mark, nothing addressed to a person about what they
 * have not done, and no encouragement — "Back to it!" is one edit away and
 * forbidden.
 */
const NOTIFICATION_TITLE = "Fuel & Form";
const NOTIFICATION_BODY = "Rest over.";
/** So a second rest replaces the first on the lock screen rather than stacking. */
const NOTIFICATION_TAG = "fuel-rest-timer";

function vibrate(): void {
  try {
    // Chrome on Android honours it, Safari makes it a no-op, and neither asks
    // for permission. The cheapest real signal there is, and the only one that
    // reaches a phone that is muted and in a pocket.
    navigator.vibrate?.(VIBRATION);
  } catch {
    // A browser that has the method and refuses the call. Nothing to report.
  }
}

/**
 * Builds or wakes the audio context, **on the start tap**.
 *
 * This is why it exists as a separate step rather than living inside `beep`.
 * Mobile browsers refuse to start audio outside a user gesture, so a context
 * first constructed when the timer runs out is a context that is suspended at
 * the one moment it is needed. The tap that starts the rest is the gesture, and
 * priming there is the whole of what makes the sound arrive ninety seconds
 * later.
 *
 * Kept for the life of the component rather than closed on stop: the gesture
 * has already happened, and a second rest should not need a second one.
 */
function prime(ref: RefObject<AudioContext | null>): void {
  try {
    if (ref.current) {
      void ref.current.resume().catch(() => {});
      return;
    }

    // Absent in a browser with no Web Audio, and in jsdom. Silence is the
    // documented outcome, so there is nothing to fall back to.
    if (typeof AudioContext === "undefined") return;

    ref.current = new AudioContext();
  } catch {
    // Blocked by a policy, or too many contexts open. The other two signals
    // are unaffected, which is the whole reason each of these is wrapped alone.
  }
}

function beep(context: AudioContext | null): void {
  if (!context) return;

  try {
    const at = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.value = TONE_HZ;

    // Ramped rather than switched. A gain that jumps from silence to full is a
    // click before it is a tone, which on a phone speaker is most of what you
    // hear.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(TONE_GAIN, at + 0.02);
    gain.gain.linearRampToValueAtTime(0, at + TONE_SECONDS);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + TONE_SECONDS);
  } catch {
    // A context suspended by the platform despite the priming above. Silent.
  }
}

/**
 * The lock-screen signal, and the one criterion in this ticket that is met by
 * something NOT being written.
 *
 * "Never double-prompts against P9's existing notification permission." There
 * is exactly one call to `Notification.requestPermission` this app could make,
 * and it is not here and never will be: P9 mints its grant through
 * `pushManager.subscribe()` in `settings/push-form.tsx`, which is the browser's
 * own prompt raised by a control that says what it is for. This reads that
 * grant and asks for nothing. A rest timer that raised a permission dialog
 * mid-session — over a phone propped against a bench, from a tap that meant
 * "ninety seconds" — would be the app asking for something at the worst moment
 * it could, for a signal it is allowed to do without.
 *
 * So the degradation is not a fallback path. It is the ordinary case for anyone
 * who has not turned the walk reminder on, and it is silent by construction.
 *
 * `registration.showNotification` rather than `new Notification(...)`, because
 * the latter throws on Android in a page a service worker controls — which is
 * every page of this app.
 */
async function notify(): Promise<void> {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator)) return;

    const registration = await navigator.serviceWorker.ready;

    await registration.showNotification(NOTIFICATION_TITLE, {
      body: NOTIFICATION_BODY,
      tag: NOTIFICATION_TAG,
    });
  } catch {
    // No registration, or a platform that refused to show it. P9's words:
    // "no errors surfaced to the user".
  }
}

/**
 * All three, and not the first that works.
 *
 * The ticket lists them "in rough order of how well each survives a locked
 * Android phone", which is an order of reliability rather than a fallback
 * chain: a vibration is felt through a pocket, a tone is heard across a room,
 * and a notification is what is still there when you pick the phone up a minute
 * later. They answer different situations and none of them is redundant with
 * another, so each available one fires and each unavailable one is skipped.
 */
function signal(context: AudioContext | null): void {
  vibrate();
  beep(context);
  void notify();
}

/* -------------------------------------------------------------------------- */
/* The wake lock                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Held only while a timer runs.
 *
 * Worth taking — a screen that stays up is the difference between glancing at
 * the readout and unlocking a phone to find it — and worth releasing the
 * instant the rest is over, because a lock held past its reason is a battery
 * cost with nothing on screen to explain it.
 *
 * It is **not** a substitute for the signals above and must not be treated as
 * one: the platform drops the lock when the tab is hidden and does not
 * reacquire it, so the case the timer exists for — a phone locked in a pocket —
 * is precisely the case the lock is not held in. That is what the
 * `visibilitychange` re-request in the effect below is for.
 *
 * `sentinel.released` is checked rather than the ref alone, because a dropped
 * lock leaves a sentinel object behind: a ref that is merely non-null would
 * make the re-request a no-op in exactly the case it was added for.
 *
 * ## `wanted` is not defensive — it closes a leak
 *
 * `request` is asynchronous, and the rest can end while the platform is still
 * deciding: a Stop tapped just after a start, an expiry on the next tick, or
 * `/training` being left altogether. The effect's cleanup runs first and finds
 * the ref still null, so `release` has nothing to let go of — and then this
 * `await` resolves and files a LIVE lock in a ref nothing will ever read again.
 * The result is a screen that never sleeps, with no timer on it, until the tab
 * is closed. It is the exact battery cost the paragraph above says to avoid,
 * reached by the one path that leaves nothing on screen to explain it.
 *
 * So the answer is re-checked after the await, and a lock that is no longer
 * wanted is released immediately rather than stored.
 */
async function hold(
  ref: RefObject<WakeLockSentinel | null>,
  wanted: RefObject<boolean>,
): Promise<void> {
  if (ref.current && !ref.current.released) return;

  try {
    const sentinel = await navigator.wakeLock.request("screen");

    if (!wanted.current) {
      void sentinel.release().catch(() => {});
      return;
    }

    ref.current = sentinel;
  } catch {
    // Unsupported — Firefox, and every iOS before 16.4 — or refused because the
    // document was not visible at the moment of asking. Nothing depends on it.
  }
}

function release(ref: RefObject<WakeLockSentinel | null>): void {
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

/* -------------------------------------------------------------------------- */

export function RestTimer() {
  /**
   * `useSyncExternalStore` rather than a `useState` seeded in an effect, for
   * `training.tsx`'s reason: a `setState` in an effect body is a second render
   * pass on every mount, and this hook exists so that a value living outside
   * React does not need one.
   *
   * `getServerSnapshot` is `null` — the server has no `localStorage`, and a
   * screen rendered there has no timer running. That is also what makes the
   * restore safe rather than a hydration mismatch: React renders the server's
   * snapshot, hydrates against it, and then switches to the client's.
   */
  const endsAt = useSyncExternalStore(subscribe, snapshot, () => null);

  /**
   * The instant this render is painting, from the same store.
   *
   * This is the counter the ticket warns about, kept to the one job it can do
   * correctly. Nothing is subtracted from it and nothing accumulates in it: it
   * is stamped from the clock every time the store emits, so losing a hundred
   * ticks costs a hundred repaints rather than a hundred seconds. The reading
   * below is `end − now` on every frame, whatever caused the frame.
   *
   * Zero on the server, where `endsAt` is null and the figure is never read.
   */
  const now = useSyncExternalStore(subscribe, paintedSnapshot, () => 0);

  const audio = useRef<AudioContext | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  /** Whether a lock is still wanted by the time the platform grants one. */
  const wantsLock = useRef(false);

  useEffect(() => {
    if (endsAt === null) return;

    wantsLock.current = true;
    void hold(lock, wantsLock);

    const interval = window.setInterval(() => {
      if (Date.now() < endsAt) {
        emit();
        return;
      }

      // The signal fires from here HOWEVER LATE the tick was allowed to run.
      // A backgrounded tab is throttled rather than stopped, so this can land a
      // minute after the rest ended — and it still fires, because a late signal
      // is the case the feature exists for and a suppressed one leaves the
      // phone in a pocket saying nothing at all.
      signal(audio.current);
      write(null);
    }, TICK_MS);

    /**
     * Recomputes on the way back, which is the other half of the ticket's
     * warning: the reading has to be right on the frame the screen returns,
     * before an interval that may have been suspended gets a chance to run.
     *
     * A timer that ran out while the tab was hidden is cleared here **without
     * signalling**. The reason to vibrate is that you are not looking at the
     * screen, and this event is the moment you started.
     */
    const restore = () => {
      if (document.visibilityState !== "visible") return;

      if (Date.now() >= endsAt) {
        write(null);
        return;
      }

      // The platform dropped the lock when the tab hid and does not give it
      // back on its own — see `hold`.
      void hold(lock, wantsLock);
      emit();
    };

    document.addEventListener("visibilitychange", restore);
    // `pageshow` and not `load`: a phone that comes back from the bfcache after
    // an hour in another app fires this and nothing else.
    window.addEventListener("pageshow", restore);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", restore);
      // Before the release, so a request still in flight is let go rather than
      // filed — see `hold`.
      wantsLock.current = false;
      release(lock);
    };
  }, [endsAt]);

  // The audio context outlives individual timers — the gesture that primed it
  // has already happened — but not the component.
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {});
      audio.current = null;
    },
    [],
  );

  const reading = endsAt === null ? null : restReading(endsAt, now);

  return (
    /*
     * The mock's `.timerrow`, and the failure banner's own shape above it: a
     * spread row with a hairline under it, so the bar reads as a column of
     * separated things rather than as a stack. § Feedback gives this slot to
     * the banner and FUEL-90 gives it to the timer as well; both can be
     * present, and the banner is written first because a refusal outranks a
     * readout.
     */
    <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
      <span className="text-micro uppercase text-text-tertiary">Rest</span>

      {reading === null ? (
        /*
         * Presets rather than a keypad — `WALK_PRESETS`' precedent, and
         * `walk-row.tsx` is where the interaction is drawn. Labelled in the
         * readout's own `m:ss` rather than in words, so the figure on the
         * button is the figure the timer starts from: a control reading `1:30`
         * beside a readout counting down from `1:30` is one number in one
         * register, where "90s" would be a second.
         */
        <div className="flex items-center gap-2">
          {REST_PRESETS.map((seconds) => (
            <Button
              key={seconds}
              variant="secondary"
              size="xs"
              className="tabular-nums"
              onClick={() => startRest(seconds, audio)}
            >
              {restLabel(seconds * 1000)}
            </Button>
          ))}
        </div>
      ) : (
        <>
          {/*
           * `role="timer"` — whose implicit live setting is `off`, which is the
           * point. A readout that announced itself every second would make a
           * screen reader unusable for the ninety seconds it matters most, and
           * § Accessibility asks for a name rather than a running commentary.
           * The `Rest` label beside it is the name.
           */}
          <span
            role="timer"
            className="font-mono text-value tabular-nums text-text-primary"
          >
            {reading.label}
          </span>

          {/*
           * Tertiary, so the Text variant — § Buttons gives that one to Revert,
           * and this is the same kind of thing.
           *
           * ## Why this is Stop and not the preset tapped again
           *
           * The ticket asks for `walk-row.tsx`'s interaction, "a preset already
           * set clears it when tapped again", and the mock draws this row with
           * no presets on it while a timer runs — `Rest`, the readout, and a
           * Stop button. The mock is what binds, and it is also the better
           * answer: the walk's presets stay on screen because a logged walk
           * keeps showing which duration it holds, whereas a running rest has a
           * readout in that space and the preset it would toggle is not drawn
           * to be tapped. So the toggle survives as the control it was for —
           * the way back from a tap that was made — and is spelled.
           */}
          <Button variant="link" size="xs" onClick={() => write(null)}>
            Stop
          </Button>
        </>
      )}
    </div>
  );
}
