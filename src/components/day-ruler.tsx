import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * The Day Ruler — Brand Guide § Signature Graphics.
 *
 * A horizontal timeline of the day's slots across a 06:00–22:00 span with a NOW
 * marker. It answers "where am I in the day?" before a single word is read.
 *
 * The geometry below is transcribed from `docs/BRAND_GUIDE.html`, which the
 * guide names as the source of truth for appearance. One deliberate deviation:
 * the mock's `.ruler` carries 16px of top padding, which put the topmost mark at
 * y=12 and the bottom of the NOW pill at y≈53 — a 41px band inside a 42px box
 * that the pill then overflowed. Everything here is shifted up by that 12px, so
 * the band starts at 0 and the box is exactly as tall as its contents. Relative
 * geometry is untouched, which is what the approved picture actually fixes; the
 * leading whitespace is the parent's business and is now the parent's to set.
 *
 * No draw-in animation. The Brand Guide requires any ruler draw-in to be dropped
 * under `prefers-reduced-motion`, and the cheapest way to honour that is to have
 * no motion at all. If one is added later, it needs the guard.
 */

export type SlotStatus = "logged" | "skipped" | "upcoming";

export type Slot = {
  id: string;
  /** Shown in the data table and the accessible summary, never on the graphic. */
  label: string;
  /** Minutes since local midnight. See the note on `Span`. */
  minutes: number;
  status: SlotStatus;
};

/**
 * Minutes since local midnight, both ends inclusive.
 *
 * Times are plain numbers rather than `Date`s so this component cannot be wrong
 * about timezones or DST. Resolving a wall-clock time for a given date is
 * `lib/resolve-plan.ts`'s job, where the Testing Strategy already enumerates the
 * DST cases at 100% coverage. A graphic should not be a second place that can
 * disagree about what day it is.
 */
export type Span = { start: number; end: number };

/** 06:00–22:00 — Brand Guide § The Day Ruler. */
export const DEFAULT_SPAN: Span = { start: 6 * 60, end: 22 * 60 };

const SIX_HOURS = 6 * 60;

/**
 * `"07:00"` → `420`. For callers and fixtures, so nobody hand-computes 690.
 *
 * Throws on malformed input: this is a helper for configuration and test data,
 * not a render path, so failing loudly at the boundary beats rendering a mark at
 * a silently wrong position.
 */
export function parseClock(clock: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);

  if (!match || hours > 23 || minutes > 59) {
    throw new RangeError(`Not a HH:MM clock time: ${JSON.stringify(clock)}`);
  }

  return hours * 60 + minutes;
}

/** `420` → `"07:00"`. */
function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);

  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Where a time sits along the span, as a percentage — the whole of the ruler's
 * arithmetic, and the reason slot positions derive from configurable times
 * rather than being hardcoded.
 *
 * Out-of-span times clamp rather than disappear. Dropping a mark would silently
 * lose data from a graphic whose entire job is showing the day's shape; a slot
 * pinned to the edge is at least honest about existing.
 */
export function positionInSpan(minutes: number, span: Span = DEFAULT_SPAN): number {
  const width = span.end - span.start;

  if (width <= 0) return 0;

  const fraction = (minutes - span.start) / width;

  return Math.min(100, Math.max(0, fraction * 100));
}

/**
 * The scale: span start, every six hours after it, then the span end. For the
 * 06:00–22:00 default that is exactly 06 · 12 · 18 · 22.
 *
 * A custom span ending just after a six-hour mark (say 06:00–18:30) would label
 * two adjacent positions "18". No shipping surface lets the span be set yet, and
 * the acceptance criterion pins only the default, so this is left as-is rather
 * than solved speculatively.
 */
function scaleMarks(span: Span): number[] {
  const marks: number[] = [span.start];

  for (let at = span.start + SIX_HOURS; at < span.end; at += SIX_HOURS) {
    marks.push(at);
  }

  return [...marks, span.end];
}

const STATUS_LABEL: Record<SlotStatus, string> = {
  logged: "Logged",
  skipped: "Skipped",
  upcoming: "Upcoming",
};

/**
 * Status is carried by fill, hatch and hairline — never by colour — so the ruler
 * survives greyscale, which it already is in both modes.
 *
 * The hatch and its outline are inline rather than Tailwind arbitrary values.
 * A `repeating-linear-gradient` inside `bg-[...]` needs underscore-escaped
 * spaces and fails *silently* when it is wrong — a missing background, not a
 * build error. The mark already carries an inline `left`, so this costs nothing
 * and is deterministic. Both reference `--text-tertiary`, so they still flip
 * with the mode and no hex appears outside the token layer.
 */
const MARK: Record<SlotStatus, { className: string; style?: CSSProperties }> = {
  logged: { className: "top-1 h-[15px] w-[5px] rounded-[1px] bg-text-primary" },
  skipped: {
    className: "top-1 h-[15px] w-[5px] rounded-[1px]",
    style: {
      backgroundImage:
        "repeating-linear-gradient(-45deg, var(--text-tertiary) 0 1px, transparent 1px 3px)",
      boxShadow: "inset 0 0 0 1px var(--text-tertiary)",
    },
  },
  upcoming: { className: "top-[10px] h-[9px] w-px bg-text-tertiary" },
};

function summarise(slots: Slot[], span: Span, now?: number): string {
  const counts = slots.reduce<Partial<Record<SlotStatus, number>>>(
    (tally, slot) => ({ ...tally, [slot.status]: (tally[slot.status] ?? 0) + 1 }),
    {},
  );

  const tallied = (["logged", "skipped", "upcoming"] as const)
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${status}`)
    .join(", ");

  // Reports, never congratulates — Brand Guide § Tone of Voice.
  return [
    `Day ruler, ${formatClock(span.start)} to ${formatClock(span.end)}.`,
    tallied ? `${slots.length} slots: ${tallied}.` : "No slots.",
    now === undefined ? "" : `Now ${formatClock(now)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function DayRuler({
  slots,
  now,
  span = DEFAULT_SPAN,
  className,
}: {
  slots: Slot[];
  /**
   * Minutes since local midnight. Optional, and omitted entirely when out of
   * span — a day being reviewed after the fact has no "now" on it, and a marker
   * pinned to an edge would assert a present moment that isn't one.
   *
   * Passed in rather than read from the clock here: this is a server component,
   * and one that read `Date.now()` itself would hydrate at a different position
   * than it rendered at.
   */
  now?: number;
  span?: Span;
  className?: string;
}) {
  const ordered = [...slots].sort((a, b) => a.minutes - b.minutes);
  const marks = scaleMarks(span);
  const showNow = now !== undefined && now >= span.start && now <= span.end;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* 41px: the NOW pill's baseline at 26 plus its 10.5px cap height and 2px
          of padding either side. "Roughly 40px including its scale", as the
          guide has it. */}
      <div
        role="img"
        aria-label={summarise(ordered, span, showNow ? now : undefined)}
        className="relative h-[41px]"
      >
        <div className="absolute inset-x-0 top-[18px] h-px bg-border" />

        {ordered.map((slot) => (
          <span
            key={slot.id}
            className={cn("absolute -translate-x-1/2", MARK[slot.status].className)}
            style={{
              left: `${positionInSpan(slot.minutes, span)}%`,
              ...MARK[slot.status].style,
            }}
          />
        ))}

        {marks.map((at, index) => (
          <span
            key={at}
            className={cn(
              "absolute top-[26px] text-micro leading-none uppercase text-text-tertiary",
              // The end labels would otherwise hang half outside the ruler.
              index === 0 && "translate-x-0",
              index > 0 && index < marks.length - 1 && "-translate-x-1/2",
              index === marks.length - 1 && "-translate-x-full",
            )}
            style={{ left: `${positionInSpan(at, span)}%` }}
          >
            {formatClock(at).slice(0, 2)}
          </span>
        ))}

        {showNow && (
          <>
            <span
              className="absolute top-0 h-[23px] w-[2px] -translate-x-1/2 bg-accent"
              style={{ left: `${positionInSpan(now, span)}%` }}
            />
            {/* Shares the scale's row, as in the mock, and wins the overlap when
                the present moment falls near a six-hour mark. The scale can be
                inferred from the ruler; the accent mark is the one thing on the
                screen that says "you are here". */}
            <span
              className="absolute top-[26px] z-10 -translate-x-1/2 rounded-full bg-accent px-[7px] py-[2px] text-micro leading-none uppercase text-accent-foreground"
              style={{ left: `${positionInSpan(now, span)}%` }}
            >
              Now
            </span>
          </>
        )}
      </div>

      {/* Brand Guide § Accessibility — "a mark on a screen is not the data".
          Built from the same array as the marks, so the two cannot drift, and a
          sibling of the positioned box rather than a child so nothing clips it.
          Hidden because the Right Now screen shows no table and the ~40px budget
          has no room for one; the requirement is that the data exists, not that
          it is drawn twice. */}
      <table className="sr-only">
        <caption>
          The day&rsquo;s slots, {formatClock(span.start)} to{" "}
          {formatClock(span.end)}
        </caption>
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Time</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((slot) => (
            <tr key={slot.id}>
              <th scope="row">{slot.label}</th>
              <td>{formatClock(slot.minutes)}</td>
              <td>{STATUS_LABEL[slot.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
