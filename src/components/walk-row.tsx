"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { clearWalk, logWalk, saveWalkRecording } from "@/app/actions/log-walk";
import { Button } from "@/components/ui/button";
import type { CalendarDate } from "@/lib/date";
import {
  appendFix,
  elapsedSeconds,
  MAX_RECORDED_POINTS,
  NOTHING_RECORDED,
  parseRecording,
  type Recording,
  track,
  trackMinutes,
} from "@/lib/recording";
import { distanceMetres, simplifyToCap } from "@/lib/route";
import { hold, release } from "@/lib/wake-lock";
import { WALK_PRESETS, type WalkEntryView } from "@/lib/walk";

/**
 * The daily walk's row — FUEL-29, FUEL-101, PRD § P3 and § P11.
 *
 * "A separate, always-present item logged with a single tap", every day
 * including weekends, with an optional duration — and, since FUEL-101, an
 * optional recording beside it. One component, rendered by both screens that
 * show the walk: `/`'s Anytime list and `/training`'s.
 *
 * ## Why it is shared rather than written twice
 *
 * The two screens agree about the walk in every respect that matters — the same
 * row, the same one tap, the same presets, the same way back — and they disagree
 * only about which DATE they are showing, which is a prop. Two copies would be
 * two places for the preset list to drift, and two chances for one screen to
 * offer a control the other's action would refuse.
 *
 * ## It owns its own optimism, and its own banner
 *
 * Unlike every other control on `/`, this one is not part of the card's
 * optimistic layer. It cannot be: that layer is a POSITION in the day's
 * timeline plus the log the action bar wrote, and the walk is on neither —
 * `lib/walk.ts` sets out why. So the row holds its own `useOptimistic` over its
 * own entry, which resets when the server's render arrives exactly as the card's
 * does, and reverts on a refusal the same way.
 *
 * The banner is here for the same reason, and § Feedback agrees with the
 * arrangement rather than merely tolerating it: "inline banner at the point of
 * action". The point of action is this row. It also has to be here — `/`'s
 * banner lives in the action bar, and `/training`'s bar is not rendered at all
 * on a rest day, which is precisely a day when the walk is the only thing there
 * is to log.
 *
 * ## One tap, and the duration after it
 *
 * The tap writes the row. Nothing sits between the two — no sheet, no keypad, no
 * confirmation — because "loggable in one tap" is the criterion, and a duration
 * asked for first would make it two. Once the row exists, the presets appear
 * beneath it: § Progressive Disclosure's one question per screen, with the
 * optional second question asked only after the first is answered.
 *
 * A preset that is already set clears it when tapped again. That is what makes
 * the duration genuinely optional in both directions — a walk recorded as 45
 * minutes by a mistap has a way back that is not "delete the whole row and log
 * it again" — and `aria-pressed` is what says so to a screen reader.
 *
 * ## Recording is ADDITIVE, and the tap above is untouched
 *
 * PRD § P11: "§ P3's criterion does not bend here". A denied permission, a
 * receiver that never settles, or simply a walk you did not feel like recording
 * each logs exactly as it does today, from both screens, with no error surfaced
 * — the same shape § P9's push takes when it degrades to the banner. So Record
 * is a SECOND control beside "Log walk" rather than a replacement for it, and
 * everything below can fail without the row losing its one tap.
 *
 * Brand Guide § The Route Trace (FUEL-99) ruled the finished walk's sheet in
 * full and said nothing about this state, because the graphic was written
 * before the recorder. The placement is therefore decided here and written into
 * the guide in the same change, so FUEL-102 inherits it rather than settling it
 * again from a ticket.
 */

/* -------------------------------------------------------------------------- */
/* The draft                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where an in-progress recording is kept between fixes.
 *
 * Keyed by DATE and ENTRY, not by the app. There are two walks on an ordinary
 * weekday since FUEL-98, and a single key would have the afternoon's recording
 * resume the morning's — one walk's geometry filed against the other's row,
 * which no screen could show was wrong.
 */
const draftKey = (date: CalendarDate, entryId: string) =>
  `fuel:walk-recording:${date}:${entryId}`;

/**
 * Reads, writes and clears the draft, and never throws.
 *
 * `localStorage` throws OUTRIGHT — on the property access itself — in a private
 * window and with site data blocked, which is why every one of these is wrapped
 * rather than only the parses. `rest-timer.tsx` takes the same posture and it
 * costs the same one thing here: in that browser the recording still works, and
 * only the ability to resume an interrupted one is lost. That is the right half
 * to give up, because the alternative is a feature that throws on start.
 */
function readDraft(key: string): Recording | null {
  try {
    const raw = window.localStorage.getItem(key);

    return raw === null ? null : (parseRecording(JSON.parse(raw)) ?? null);
  } catch {
    return null;
  }
}

function writeDraft(key: string, recording: Recording): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(recording));
  } catch {
    // Full, blocked, or private. The recording continues in memory; what is
    // lost is the ability to recover it, and there is nothing to tell the user
    // that they could act on mid-walk.
  }
}

/**
 * The drafts React reads, mirrored to `localStorage` — `rest-timer.tsx`'s
 * arrangement, keyed.
 *
 * A store rather than a `useState` seeded in an effect, and that is a rule here
 * rather than a preference: `react-hooks/set-state-in-effect` refuses the
 * seeding shape, and the reason it gives is the one that applies — a `setState`
 * in an effect body is a second render pass on every mount, and a value living
 * outside React should be read during render instead.
 *
 * Keyed by date and entry where the rest timer needed only a single global,
 * because two walk rows are on screen on an ordinary weekday and each has a
 * draft of its own. A single slot would have the two rows overwrite each
 * other's recovery.
 *
 * The map is the value React sees; `localStorage` is a MIRROR of it. A store
 * that throws therefore costs the reload and nothing on this page, which is the
 * posture the rest timer argues at length and the reason a private window still
 * records.
 */
const drafts = new Map<string, Recording | null>();
const listeners = new Map<string, Set<() => void>>();

function draftSnapshot(key: string): Recording | null {
  if (!drafts.has(key)) drafts.set(key, readDraft(key));

  return drafts.get(key) ?? null;
}

function subscribeDraft(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set();

  listeners.set(key, set);
  set.add(listener);

  return () => {
    set.delete(listener);
  };
}

/**
 * Records or clears one row's draft — one write, one notification.
 *
 * The in-memory value is set before the mirror is attempted, so a refused write
 * costs the recovery and not the render.
 */
function keepDraft(key: string, recording: Recording | null): void {
  drafts.set(key, recording);

  try {
    if (recording === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(recording));
  } catch {
    // See the header. Nothing to do and nothing a reader could act on.
  }

  for (const listener of listeners.get(key) ?? []) listener();
}

/* -------------------------------------------------------------------------- */
/* The device                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `GeolocationPositionError.PERMISSION_DENIED`, as a number.
 *
 * Written out rather than read off the global, which does not exist in every
 * environment this component is rendered in. The code matters because the other
 * two are NOT fatal: `POSITION_UNAVAILABLE` fires when the receiver loses its
 * fix — under a bridge, between buildings — and a recorder that stopped on it
 * would end the walk at the first tunnel. Only a refusal ends the recording.
 */
const PERMISSION_DENIED = 1;

/**
 * `enableHighAccuracy` is the whole point and the whole cost.
 *
 * The ticket states the trade and settles it: it "is required for anything
 * usable, and is the expensive setting. That is the trade and it is the right
 * one here." Without it the platform answers from wifi and cell towers, at an
 * accuracy `MAX_ACCURACY_M` would discard anyway — a recording that spends the
 * battery and stores nothing.
 *
 * `maximumAge: 0` for the same reason: a cached position from before the walk
 * began would arrive as the first fix and put the walk's origin wherever the
 * phone last was. No `timeout`, because a timeout raises an error this
 * component deliberately ignores, and "still looking" is a state the row shows
 * rather than an event it needs.
 */
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0 };

/** Never fires — for reading a client-only capability without a mismatch. */
const subscribeNever = () => () => {};

/* -------------------------------------------------------------------------- */
/* The readout                                                                */
/* -------------------------------------------------------------------------- */

/** `m:ss`, the running-clock format `rest-timer.ts` already established. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Kilometres to one decimal — Brand Guide § The Route Trace's `3.2 km`. */
function kilometres(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * What the row says while a recording runs.
 *
 * Both figures come from the recording's own state rather than from a clock, so
 * the readout and what will be SAVED are the same numbers — there is no tick,
 * no interval and nothing to drift. It also means the reading stops advancing
 * when fixes stop, which is honest rather than broken: the app is showing what
 * it has actually seen, and a clock running on through a screen-off gap would
 * be claiming otherwise.
 */
function reading(recording: Recording): string {
  if (recording.startedAt === null) return "Finding your position…";

  return `${kilometres(distanceMetres(track(recording)))} · ${clock(elapsedSeconds(recording))}`;
}

/**
 * What "Try again" would re-run.
 *
 * Two shapes rather than one, because the two writes are not substitutes: an
 * entry is a plain log or a revert, and a recording carries geometry that a
 * plain log has no way to express.
 */
type Retry =
  | { kind: "entry"; entry: WalkEntryView | null }
  | { kind: "recording"; recording: Recording };

/* -------------------------------------------------------------------------- */

export function WalkRow({
  date,
  entryId,
  name,
  entry,
}: {
  /** The date being logged. Today on `/`; the viewed date on `/training`. */
  date: CalendarDate;
  /**
   * The `training_template_entries` row this walk resolved from.
   *
   * The entry and never the workout, for `resolve-training.ts`'s reason: the
   * action re-resolves the date and takes the workout id from its own answer.
   */
  entryId: string;
  name: string;
  /** What is recorded, from the server. `null` until the walk is logged. */
  entry: WalkEntryView | null;
}) {
  const [shown, apply] = useOptimistic(
    entry,
    (_current: WalkEntryView | null, next: WalkEntryView | null) => next,
  );

  /**
   * The attempt that failed, so "Try again" re-runs the same one.
   *
   * `right-now.tsx`'s arrangement and `training.tsx`'s: a failure is stored as
   * the tap rather than as a message, because a retry has to write what was
   * refused and not what the row happens to show a minute later.
   *
   * Since FUEL-101 it is discriminated, because there are now two different
   * things a retry can mean and they are not interchangeable: re-running an
   * ENTRY writes a plain log, and a recording retried as an entry would log the
   * walk correctly while silently throwing the route away — the failure this
   * row exists to prevent, arriving through the control offered to prevent it.
   */
  const [failure, setFailure] = useState<Retry | undefined>(undefined);

  const key = draftKey(date, entryId);

  /**
   * Whether this browser can record at all.
   *
   * Read through `useSyncExternalStore` with a server snapshot of `false`, and
   * not in an effect: the control must not be in the first client render if the
   * server did not draw it, and a subscription that never fires is how a
   * client-only constant is read without a hydration mismatch.
   *
   * A CAPABILITY check — is `watchPosition` callable — rather than
   * `"geolocation" in navigator`. The `in` operator walks the prototype chain
   * and answers true for a key that is present and undefined, which is what a
   * browser with the API disabled looks like; the only thing this component
   * actually needs is the function it is about to call.
   *
   * When it is false the Record control is not rendered — no disabled button
   * and no explanation, which is § P11's "no errors surfaced to the user" and
   * the same refusal the plan state makes for an exercise with no form media.
   * The walk still logs in one tap, which is the whole promise.
   */
  const canRecord = useSyncExternalStore(
    subscribeNever,
    () => typeof navigator?.geolocation?.watchPosition === "function",
    () => false,
  );

  /** The live recording, or `null` when none is running. */
  const [recording, setRecording] = useState<Recording | null>(null);

  /**
   * An interrupted recording on this row, waiting to be resumed or saved.
   *
   * Read from the store during render rather than seeded in an effect, so a
   * draft left by a killed tab is on screen in the first paint instead of
   * appearing a frame later.
   */
  const subscribe = useCallback(
    (listener: () => void) => subscribeDraft(key, listener),
    [key],
  );
  const draft = useSyncExternalStore(
    subscribe,
    useCallback(() => draftSnapshot(key), [key]),
    () => null,
  );

  /**
   * The recording as the position callback sees it.
   *
   * A ref beside the state, because `watchPosition`'s callback is registered
   * once and would otherwise fold every fix into the state it closed over at
   * the moment Record was tapped — an array that is always one fix long. The
   * ref is the value; the state is the render.
   */
  const live = useRef<Recording>(NOTHING_RECORDED);
  const watch = useRef<number | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const wantsLock = useRef(false);

  /** Ends the watch and gives the screen back. Safe when nothing is running. */
  const end = () => {
    if (watch.current !== null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    }

    // Before the release, so a request still in flight is let go rather than
    // filed — see `lib/wake-lock.ts`.
    wantsLock.current = false;
    release(lock);
  };

  /**
   * Starts recording, from nothing or from an interrupted draft.
   *
   * The permission is requested by this call and by nothing else: PRD § P11
   * asks for it "on the tap that starts a recording rather than on page load,
   * so the prompt arrives with a reason". Nothing on either screen asks for a
   * permission on mount, and `rest-timer.tsx` explicitly declines to ask for
   * notifications at all — so the two prompts § P9 and § P11 own cannot arrive
   * together, because the notification one is a control in `/settings`.
   */
  const begin = (from: Recording) => {
    live.current = from;
    setRecording(from);
    setFailure(undefined);

    wantsLock.current = true;
    void hold(lock, wantsLock);

    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const next = appendFix(live.current, {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: position.timestamp,
        });

        live.current = next;
        setRecording(next);
        // Every fix, which is the criterion. It is also what makes the recording
        // survive the tab being killed by the platform mid-walk — the case that
        // leaves no other trace.
        writeDraft(key, next);
      },
      (error) => {
        if (error.code !== PERMISSION_DENIED) return;

        // Refused. The row goes back to what it was with NOTHING said about it:
        // "a denial is a normal state, not an error". Whatever had been
        // recorded before the refusal is kept as a draft rather than dropped.
        end();
        setRecording(null);
        keepDraft(key, live.current.startedAt === null ? null : live.current);
      },
      WATCH_OPTIONS,
    );
  };

  /**
   * Re-takes the lock when the tab comes back, and lets it go on unmount.
   *
   * The platform drops the wake lock when the tab is hidden and does not
   * reacquire it, so without this the second half of every walk is recorded
   * with the screen free to sleep — and the failure is invisible, because
   * nothing on screen changes when the lock quietly goes.
   *
   * `pageshow` as well as `visibilitychange`, on `rest-timer.tsx`'s reason: a
   * phone coming back from the bfcache after an hour in another app fires that
   * and nothing else.
   */
  const active = recording !== null;

  useEffect(() => {
    if (!active) return;

    const restore = () => {
      if (document.visibilityState !== "visible") return;

      void hold(lock, wantsLock);
    };

    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", restore);

    return () => {
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", restore);
      // Covers leaving the screen mid-recording. `end` is idempotent, so the
      // ordinary Stop — which calls it before this runs — is not a second
      // release of something already gone.
      end();
    };
    // `end` is deliberately not a dependency: it touches only refs, so a fresh
    // closure each render is the same function, and listing it would rebind
    // both listeners on every fix.
  }, [active]);

  /**
   * Writes what the row should say, and says it on this frame.
   *
   * `null` is the revert — the row going back to unlogged — and an entry is a
   * log, with or without a duration. One function for both, because they are one
   * statement on the server too: `logWalk` upserts and `clearWalk` deletes, and
   * which of them runs is decided by what the row is being asked to become.
   */
  const act = (next: WalkEntryView | null) => {
    setFailure(undefined);

    startTransition(async () => {
      apply(next);

      // The `try` covers the CALL, not the action. Both actions catch everything
      // themselves and answer `{ ok: false }` — but reaching them is a network
      // request, and that request can fail on its own: no signal on the way back
      // from a walk, a dropped connection, a cold start that times out. Those
      // reject rather than resolve, and an escaping rejection would revert the
      // row with nothing on screen to say why. `right-now.tsx` carries the same
      // wrapper for the same reason.
      try {
        const result = next
          ? await logWalk({ date, entryId, durationMin: next.durationMin })
          : await clearWalk({ date, entryId });

        // The transition wrapper is not optional: React does not treat a state
        // update after an `await` as part of the transition it was started in,
        // so without it the banner paints a frame before the optimistic value
        // reverts — the message arriving over a row that is about to change
        // back.
        if (!result.ok) startTransition(() => setFailure({ kind: "entry", entry: next }));
      } catch {
        startTransition(() => setFailure({ kind: "entry", entry: next }));
      }
    });
  };

  /**
   * Saves a finished recording — the route, the distance and the duration.
   *
   * Only the geometry crosses the wire; `saveWalkRecording` derives every figure
   * from it. It is thinned to `MAX_RECORDED_POINTS` first, with the same
   * Ramer–Douglas–Peucker the storage path uses, so that a walk long enough to
   * exceed the wire bound is SHORTENED rather than refused — a recording that
   * came back too big to send would be exactly the silent loss this feature is
   * written against. In practice it engages for nothing: three hours of fixes.
   *
   * The draft is cleared only on success. A refusal keeps it, which is what
   * makes "Try again" mean something and what stops a dropped connection at the
   * front door from being the end of the walk.
   */
  const save = (finished: Recording) => {
    setFailure(undefined);

    startTransition(async () => {
      // The duration the SERVER will derive, shown on this frame — the same
      // function on the same track, so the optimistic row and the row that
      // arrives say the same thing rather than flashing from one to the other.
      apply({ durationMin: trackMinutes(track(finished)) });

      const refused = () =>
        startTransition(() => {
          keepDraft(key, finished);
          setFailure({ kind: "recording", recording: finished });
        });

      try {
        const { track: thinned } = simplifyToCap(track(finished), MAX_RECORDED_POINTS);
        const result = await saveWalkRecording({ date, entryId, track: thinned });

        if (result.ok) {
          startTransition(() => keepDraft(key, null));

          return;
        }

        refused();
      } catch {
        refused();
      }
    });
  };

  const stop = () => {
    const finished = live.current;

    end();
    setRecording(null);

    // A recording that never got a usable fix logs the walk plainly rather than
    // saving an empty route: the same row a tap would have produced, which is
    // "a complete walk with fewer figures, never a partial one".
    if (finished.startedAt === null) {
      keepDraft(key, null);
      act({ durationMin: null });

      return;
    }

    save(finished);
  };

  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      <div className="flex min-h-[54px] items-center justify-between gap-4 py-3">
        <span className="truncate text-body text-text-primary">{name}</span>

        {recording ? (
          <Button variant="secondary" size="xs" className="shrink-0" onClick={stop}>
            Stop
          </Button>
        ) : shown ? (
          /*
           * § Accessibility's "never colour alone" and § The Governing
           * Principle's equal visual weight, taken the same way `training.tsx`'s
           * `Recorded` takes them: what changes is the word, not the colour.
           *
           * `role="status"` — a polite live region — so a walk logged by a tap
           * is announced without moving focus, and what is announced is the
           * optimistic value, which is what the screen is showing.
           */
          <span role="status" className="text-micro uppercase text-text-secondary">
            Done
            {shown.durationMin !== null && (
              <span className="tabular-nums"> · {shown.durationMin} min</span>
            )}
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            {/*
             * Secondary, not primary. § Buttons allows one primary per screen
             * and on both screens that button is already spoken for — "Log
             * eaten" on `/`, "Mark done" on `/training` — so the walk's control
             * is the outlined variant. `xs` is 44px, the touch minimum, which is
             * what keeps a control this size legal inside a 54px row.
             */}
            <Button
              variant="secondary"
              size="xs"
              className="shrink-0"
              onClick={() => act({ durationMin: null })}
            >
              Log walk
            </Button>

            {/* Second, and second for a reason: the one tap is the criterion and
                the recording is additive, so the control that always works is
                the one the thumb reaches first. */}
            {canRecord && (
              <Button
                variant="secondary"
                size="xs"
                className="shrink-0"
                onClick={() => begin(draft ?? NOTHING_RECORDED)}
              >
                {draft ? "Resume" : "Record"}
              </Button>
            )}
          </div>
        )}
      </div>

      {recording && (
        <p role="status" className="pb-3 text-slash tabular-nums text-text-secondary">
          / {reading(recording)}
        </p>
      )}

      {/*
       * The cost, before it is paid — FUEL-101's criterion, and § P11's
       * "the foreground-only limitation is stated where recording is offered,
       * not only in this document". Shown only where the Record control is,
       * because a cost stated on a row that offers nothing to spend it on is
       * noise.
       *
       * A Slash METADATA line — `a · b`, the register `/ 3.2 km · 34 min` uses
       * — rather than the two sentences this was first written as, and the
       * change was forced by measuring rather than by taste. Two sentences ran
       * to 64 characters, which wrapped to two lines inside the row's measure
       * at 375 and cost 46px a row; there are TWO walk rows on an ordinary
       * weekday since FUEL-98, so the pair spent 92px of a screen § Desktop
       * measured a 354px window for. Two identical sentences stacked also read
       * as prose repeating itself, where two metadata lines read as what they
       * are. § Content Guidelines made the same call on the walk reminder for
       * the same reason, and named the measurement.
       */}
      {!recording && !shown && canRecord && !draft && (
        <p className="pb-3 text-slash text-text-tertiary">
          / Screen on, app open · uses battery
        </p>
      )}

      {/*
       * An interrupted recording, offered back. § Tone of Voice: name what
       * happened. Save writes what was collected; Resume carries on from it;
       * Discard is the way out, and it is a Text control because it is the
       * uncommon answer — § Buttons gives that variant to Revert.
       */}
      {draft && !recording && !shown && failure === undefined && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <p className="text-slash text-text-secondary">
            / A recording was interrupted · {reading(draft)}
          </p>
          <Button
            variant="secondary"
            size="xs"
            className="ml-auto"
            onClick={() => save(draft)}
          >
            Save it
          </Button>
          <Button
            variant="link"
            size="xs"
            onClick={() => keepDraft(key, null)}
          >
            Discard
          </Button>
        </div>
      )}

      {shown && !recording && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          {WALK_PRESETS.map((minutes) => (
            <Button
              key={minutes}
              variant="secondary"
              size="xs"
              // Which duration is set is said in WORDS, by the status above,
              // and not by promoting one of these buttons. `training.tsx` makes
              // the same call for its three statuses and gives the reason:
              // moving which button is emphasised shifts the row under the
              // reader's thumb between renders. `aria-pressed` is how the same
              // fact reaches a screen reader.
              aria-pressed={shown.durationMin === minutes}
              // Tapping the preset that is already set clears the duration
              // rather than rewriting it — the way back from a mistap that is
              // not "take the whole walk back and log it again".
              onClick={() =>
                act({ durationMin: shown.durationMin === minutes ? null : minutes })
              }
            >
              {minutes} min
            </Button>
          ))}

          {/* Tertiary, so the Text variant — § Buttons gives that one to Revert,
              and this is the same kind of thing: the way back from a tap that
              was made, for the uncommon case where it was the wrong one. */}
          <Button variant="link" className="ml-auto shrink-0" onClick={() => act(null)}>
            Undo
          </Button>
        </div>
      )}

      {failure !== undefined && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 pb-3"
        >
          {/* § Tone of Voice: name what happened. Never "Something went wrong". */}
          <p className="text-slash text-error">
            {failure.kind === "entry" && failure.entry === null
              ? "Couldn’t undo that."
              : "Couldn’t save that."}
          </p>
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              failure.kind === "entry" ? act(failure.entry) : save(failure.recording)
            }
          >
            Try again
          </Button>
        </div>
      )}
    </li>
  );
}
