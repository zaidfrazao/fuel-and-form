"use client";

import { useEffect, useSyncExternalStore } from "react";

import { elapsedLabel, parseEnteredAt } from "@/lib/session-clock";

/**
 * The session clock — FUEL-124, Brand Guide § The two states of `/training`.
 *
 * How long the session has been running, beside the session state's eyebrow.
 * The arithmetic is `lib/session-clock.ts`; what is here is the repaint, for
 * `rest-timer.tsx`' reason: the reading is `now − start` on every frame, and
 * the interval only decides how often there is a frame. A tab throttled for
 * twenty minutes is right on the frame it comes back, because nothing was
 * counted to be lost.
 *
 * **Where it is drawn is the ruling, not this file.** The pinned bar is at most
 * three things — banner, timer, controls — and the header zone belongs to the
 * paginator. The eyebrow already names the session, which is the thing this
 * measures; the slash line under the Title is the exercise's. So the clock
 * joins the eyebrow's row, and is kept OUT of the `<h2>`: a heading whose
 * accessible name changed every second would re-announce itself to anybody
 * navigating by headings, and would be a different heading to every query that
 * names it.
 *
 * A `<time>` and not `role="timer"`. That role is the rest timer's, a few
 * hundred pixels below, and two on one screen would make "the timer" mean
 * nothing. Nor is it a live region: a count announced every second is noise
 * over the one thing a screen reader is there to read, which is the set.
 *
 * Renders nothing for a start the clock refuses — the legacy `"1"`, or an
 * instant too old or too far ahead to believe. The session state is still
 * entered (`isEntered`); it is only the clock that has no honest figure.
 */

/** Once a second: the label has no finer figure to change. */
const TICK_MS = 1000;

/**
 * The instant being painted — `rest-timer.tsx`' `painted`, and for its reason.
 *
 * `Date.now()` in render is impure and `react-hooks/purity` refuses it, so the
 * clock is part of a store: the tick stamps it and notifies, and the snapshot
 * returns what was stamped. Separate from the rest timer's store because the
 * two tick at different rates and neither should repaint the other.
 */
let painted: number | undefined;

const listeners = new Set<() => void>();

function emit(): void {
  painted = Date.now();

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number {
  if (painted === undefined) painted = Date.now();

  return painted;
}

export function SessionClock({ stored }: { stored: string | null }) {
  const now = useSyncExternalStore(subscribe, snapshot, () => 0);
  const startedAt = parseEnteredAt(stored, now);

  useEffect(() => {
    // Stamped on mount, so a clock entered a minute after the page loaded does
    // not paint the instant the page loaded.
    emit();

    const interval = window.setInterval(emit, TICK_MS);

    // The frame the screen comes back on, before a suspended interval gets its
    // turn — `rest-timer.tsx`' `restore`, without anything to signal.
    const restore = () => {
      if (document.visibilityState === "visible") emit();
    };

    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", restore);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  if (startedAt === null) return null;

  const elapsed = now - startedAt;

  return (
    <time
      dateTime={`PT${Math.floor(Math.max(0, elapsed) / 1000)}S`}
      className="shrink-0 text-micro tabular-nums text-text-secondary"
    >
      <span className="sr-only">Elapsed </span>
      {elapsedLabel(elapsed)}
    </time>
  );
}
