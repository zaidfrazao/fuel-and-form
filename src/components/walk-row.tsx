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
import { openWalkRoute } from "@/app/actions/walk-route";
import { Button } from "@/components/ui/button";
import { type RouteLoad, WalkSheet } from "@/components/walk-sheet";
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
import { FOCUS_RING, HOVER_LIFT, POINTER } from "@/lib/pointer";
import { countPoints, distanceMetres, simplifyToCap, storableRoute } from "@/lib/route";
import { kilometres } from "@/lib/route-trace";
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
 * Records or clears one row's draft: the cache first, then the mirror.
 *
 * The in-memory value is set before the mirror is attempted, so a refused write
 * costs the recovery and not the render.
 *
 * ## The cache is written on EVERY fix, and that is not an optimisation
 *
 * `draftSnapshot` reads `localStorage` once per key and the map outlives every
 * mount, so a write that touched only storage would leave the cache holding
 * whatever was read on the first mount. Recording a walk and then navigating
 * `/` → `/training` and back would come back offering **Record**, with a good
 * recording sitting in storage that nothing short of a full page reload would
 * ever surface again. That is the silent loss this feature is written against,
 * reached without anything failing.
 */
function store(key: string, recording: Recording | null, notify: boolean): void {
  drafts.set(key, recording);

  try {
    if (recording === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(recording));
  } catch {
    // See the header. Nothing to do and nothing a reader could act on.
  }

  if (notify) for (const listener of listeners.get(key) ?? []) listener();
}

/** A draft the row is being told about — a stop, a refusal, a discard. */
const keepDraft = (key: string, recording: Recording | null) =>
  store(key, recording, true);

/**
 * The running recording's own write, on every fix.
 *
 * Silent, because the row is already re-rendering from `recording` state and
 * the draft affordance is not on screen while a recording runs — so notifying
 * would be a second render per fix to change nothing anybody can see.
 */
const cacheDraft = (key: string, recording: Recording) =>
  store(key, recording, false);

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
  const [sheet, setSheet] = useState(false);
  const [load, setLoad] = useState<RouteLoad>({ state: "loading" });

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

    const onFix = (position: GeolocationPosition) => {
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
      cacheDraft(key, next);
    };

    const onRefusal = (error: GeolocationPositionError) => {
      if (error.code !== PERMISSION_DENIED) return;

      // Refused. The row goes back to what it was with NOTHING said about it:
      // "a denial is a normal state, not an error". Whatever had been recorded
      // before the refusal is kept as a draft rather than dropped.
      end();
      setRecording(null);
      keepDraft(key, live.current.startedAt === null ? null : live.current);
    };

    // Inside a `try` even though the capability was checked, because a
    // capability is not a promise that the call succeeds: an insecure context,
    // a Permissions-Policy, or an embedded webview can refuse at the call
    // itself rather than through the error callback. What that would otherwise
    // leave behind is the one state a user cannot get out of — a row showing
    // "Stop", no watch running, and the screen held awake — so it is unwound
    // into the ordinary refusal, which says nothing and leaves the walk
    // loggable in one tap.
    try {
      watch.current = navigator.geolocation.watchPosition(onFix, onRefusal, WATCH_OPTIONS);
    } catch {
      end();
      setRecording(null);
    }
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
  /**
   * A duration change, keeping whatever the walk already measured.
   *
   * `logWalk` writes a duration and nothing else, so the distance and the trace
   * are untouched by a preset tap — and the optimistic row has to say the same,
   * or tapping "20 min" would blank the figures line for a frame and take the
   * sheet's control with it.
   */
  const withDuration = (durationMin: number | null): WalkEntryView => ({
    durationMin,
    distanceM: shown?.distanceM ?? null,
    hasRoute: shown?.hasRoute ?? false,
  });

  /**
   * Open the sheet and ask for the trace — one tap, one request.
   *
   * The fetch lives here rather than in an effect inside the sheet because
   * opening it and asking for the route are the SAME user action; an effect
   * keyed on `open` would be re-deriving the trigger from the state the trigger
   * set. It also keeps the geometry's arrival on the path a reader can follow
   * from the control they pressed.
   */
  const openSheet = () => {
    setSheet(true);
    setLoad({ state: "loading" });

    void (async () => {
      try {
        const route = await openWalkRoute({ date, entryId });

        // A null answer is a refusal rather than an empty route: the row only
        // draws this control where a trace exists, so reaching here with
        // nothing means the walk moved under us or the session went.
        setLoad(route ? { state: "loaded", route } : { state: "failed" });
      } catch {
        // The CALL failed rather than the action — no signal on the way back
        // from a walk, a dropped connection, a cold start. The same wrapper
        // `act` carries, for the same reason: an escaping rejection would leave
        // the sheet empty with nothing on screen to say why.
        setLoad({ state: "failed" });
      }
    })();
  };

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
   * from it.
   *
   * ## It is thinned ONLY when it is actually too big, and the guard is the fix
   *
   * `simplifyToCap` applies its 2m base epsilon whether or not the track is over
   * the cap — "reduces a straight run to its two ends" is its first test — so
   * calling it unconditionally thinned EVERY walk on the way out. That was
   * written here as a one-line safeguard and it cost two things, both found by
   * recording a walk in a browser and reading the row back:
   *
   *   - **`simplified_tolerance_m` lied.** The server re-derives it from what it
   *     receives, so a track the client had already thinned arrived looking
   *     pristine and stored `null` — "nothing was dropped". That column is the
   *     only record of how lossy the stored shape is, and the schema says
   *     exactly why it matters: without it "a straight two-point line is
   *     indistinguishable from a walk down a straight road and a walk whose
   *     shape was thinned away".
   *   - **`distance_m` would have been short.** Distance is measured on what
   *     arrives, and RDP cuts corners. On the straight synthetic track this was
   *     found with, the figure survived; on a real walk round a park it would
   *     have read low — in a number that reaches the export, the step estimate
   *     and the energy range.
   *
   * So the raw track is sent, and the cap is a bound rather than a filter. It
   * engages for nothing a walk produces — three hours of fixes at one a second
   * — and when it does engage the walk is SHORTENED rather than refused, since
   * a recording that came back too big to send would be exactly the silent loss
   * this feature is written against.
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
      // The figures the SERVER will derive, shown on this frame — the same
      // functions on the same track, so the optimistic row and the row that
      // arrives say the same thing rather than flashing from one to the other.
      // `storableRoute` is what the action calls, so the distance is the
      // untrimmed measure and `pointCount` is exactly the test for whether a
      // trace survived the trim: a walk under 300m stores none, and its figures
      // must not offer a sheet with nothing in it.
      const stored = storableRoute(track(finished));

      apply({
        durationMin: trackMinutes(track(finished)),
        distanceM: stored.distanceM,
        hasRoute: stored.pointCount > 0,
      });

      const refused = () =>
        startTransition(() => {
          keepDraft(key, finished);
          setFailure({ kind: "recording", recording: finished });
        });

      try {
        const walked = track(finished);
        const sending =
          countPoints(walked) > MAX_RECORDED_POINTS
            ? simplifyToCap(walked, MAX_RECORDED_POINTS).track
            : walked;
        const result = await saveWalkRecording({ date, entryId, track: sending });

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
      act(withDuration(null));

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
          /*
           * The minutes moved OUT of this status in FUEL-102, and the move is
           * the point rather than a tidy-up. § The Route Trace makes the walk's
           * own figures the affordance that opens its sheet — "the row opens the
           * sheet rather than growing one" — and § Lists describes the logged
           * row as reading `/ 3.2 km · 34 min` in the Slash register, which it
           * did not yet do. Leaving the duration here as well would print it
           * twice on one row, a line apart.
           *
           * `Done` stays because it is the STATUS, and status is what this
           * corner of the row has always carried.
           */
          <span role="status" className="text-micro uppercase text-text-secondary">
            Done
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
              onClick={() => act(withDuration(null))}
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
       * The walk's own figures, which are also the way into its sheet —
       * § The Route Trace, FUEL-102.
       *
       * "On the row the walk reads in the Slash register — `/ 3.2 km · 34 min ·
       * ~4,300 steps` — and those figures are also the affordance, which is
       * FUEL-108's device applied a second time: the row opens the sheet rather
       * than growing one." The step estimate is FUEL-103's and is absent rather
       * than stubbed.
       *
       * The log control and the figures cannot collide, because the figures do
       * not exist until the walk is logged: before the tap there is a walk to
       * log and nothing to look at, and § P3's one tap is untouched.
       *
       * **A walk with no route gets the same line as plain text.** Not a
       * disabled control — § The row as a control refuses "a state that would
       * promise an action that does not exist", and § The Route Trace makes the
       * same refusal in as many words: "a walk with no route draws nothing".
       * A one-tap walk still has minutes worth reading, so the line stays and
       * only its interactivity goes.
       */}
      {shown && !recording && <Figures entry={shown} onOpen={openSheet} />}

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
                act(withDuration(shown.durationMin === minutes ? null : minutes))
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
      {/*
        Mounted only while it is open, and only where there is a route.

        Not a permanently mounted sheet with `open={false}`: this one FETCHES on
        open, and a mounted-but-closed sheet on every logged walk would be two
        components per row waiting to run an effect. `open` is redundant with
        the conditional and is passed anyway, because Radix needs the state to
        animate the close before the unmount.
      */}
      {shown?.hasRoute && (
        <WalkSheet
          open={sheet}
          onOpenChange={setSheet}
          date={date}
          entryId={entryId}
          name={name}
          durationMin={shown.durationMin}
          distanceM={shown.distanceM}
          load={load}
          onRetry={openSheet}
          onNamed={(named) =>
            setLoad((current) =>
              current.state === "loaded"
                ? {
                    state: "loaded",
                    // The suggestion goes with the name: an offer that has been
                    // answered is not still a question, and leaving it drawn
                    // would invite the reader to answer it twice.
                    route: { ...current.route, name: named, suggestion: null },
                  }
                : current,
            )
          }
        />
      )}
    </li>
  );
}

/**
 * The logged walk's figures — a line, and where there is a route, a control.
 *
 * § The Route Trace: "the row shows figures; the sheet shows the shape. There
 * is no rest state." The figures ARE the affordance, so this is a button when
 * there is something to open and a plain line when there is not.
 *
 * Nothing is drawn for a walk with neither figure. A bare one-tap walk with no
 * duration has `Done` beside its name and that is the whole of what is known
 * about it — an empty Slash line would be a `/` with nothing after it.
 */
function Figures({
  entry,
  onOpen,
}: {
  entry: WalkEntryView;
  onOpen: () => void;
}) {
  const parts = [
    entry.distanceM === null ? null : kilometres(entry.distanceM),
    entry.durationMin === null ? null : `${entry.durationMin} min`,
  ].filter((part) => part !== null);

  if (parts.length === 0) return null;

  const line = parts.join(" · ");

  if (!entry.hasRoute) {
    return <p className="pb-3 text-slash tabular-nums text-text-secondary">/ {line}</p>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex min-h-[34px] items-center pb-3 text-left text-slash tabular-nums text-text-secondary ${POINTER} ${FOCUS_RING}`}
    >
      {/* The mark stays `text-tertiary` under the lift, as § Slash Metadata
          draws it everywhere else: what the hover moves is the figures. */}
      <span aria-hidden className="text-text-tertiary">/&nbsp;</span>
      <span className={HOVER_LIFT}>{line}</span>
      {/* Named for a screen reader, which cannot see that a line of figures is
          a control. The visible text is the figures; this says what pressing
          them does, and § Navigation's rule that a label may say more than the
          name is the same containment. */}
      <span className="sr-only"> — see the route</span>
    </button>
  );
}
