import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * Where `/` draws this, at each of the three widths it has — FUEL-77.
 *
 * The ruler is the one element on the screen that moves between bands: below
 * 768px it follows the figures, from 768 it precedes them, and at the frame's
 * cap it is in the second column. `right-now.tsx` carries the argument for each
 * position; what lives here is the pairing of a position with the variant that
 * turns it on, because two files draw this screen and they may not disagree
 * about which copy is visible.
 *
 * The second is `app/(app)/loading.tsx`. A skeleton exists to hold the layout
 * still across the swap-in, so a skeleton with the ruler in a different place
 * from the screen is worse than none — it guarantees the shift it was added to
 * prevent, at whichever width the two disagree at. Three literals in two files
 * kept in step by hand is exactly what `action-bar.ts` was extracted to end.
 *
 * Rendered rather than switched: all three copies are in the DOM and CSS picks
 * one, because `order` and grid placement move the box without moving the
 * sequence a screen reader walks. The two that are off are `display: none` and
 * out of the accessibility tree, so exactly one is ever announced.
 */
export const RULER_AT = {
  /** Below 768px, under the merged grid — FUEL-82. */
  phone: "md:hidden",
  /**
   * 768–1271, above the two named grids.
   *
   * `md:max-xl:block` and not `md:block xl:hidden`, which is what this was and
   * which does not work. Tailwind v4 emits a redefined breakpoint's media block
   * **before** the framework's own, whatever order they are declared in — so
   * `@media (width >= 1272px)` comes out ahead of `@media (width >= 48rem)`,
   * `md:block` is the later rule at 1272, and the copy that was supposed to
   * stand down at the frame's cap stayed drawn beside the one in the aside.
   *
   * Two rulers is not a cosmetic fault: § The Four Rules allows "one umber
   * element per screen, and it always says: you are here", and each ruler
   * carries a NOW marker. It was found by looking at the 1272 baseline rather
   * than by any assertion, which is why `page-columns.spec.ts` now counts the
   * drawn copies at every width and `frame.css.test.ts` pins the emission order
   * that caused it.
   *
   * A single bounded utility has no cascade to lose. `md:max-xl:` is one rule
   * that is true in one band, and it says what this copy is for.
   */
  wide: "hidden md:max-xl:block",
  /**
   * Everything below the cap, in one copy.
   *
   * Two screens want this, and for the same reason: neither has a merged macro
   * grid for the ruler to move around, so there is only one position under the
   * cap rather than the phone's and the wide band's.
   *
   * The workout card is the first — the middle of that screen is
   * `ExerciseList`, so FUEL-82 left the ruler in one place. The quiet
   * nothing-planned state is the second, where there is no grid at all. Both
   * still stand down at the frame's cap like every other copy, which is what
   * they need a variant for at all.
   *
   * Named for the band rather than for the card since FUEL-86 gave it the
   * second caller; it was `wideOnSession`, which was true of the only screen
   * using it and would have been a lie about the next one.
   */
  belowCap: "xl:hidden",
  /**
   * The frame's cap and above, in the header band — FUEL-77, moved by FUEL-86.
   *
   * It spent one ticket at the top of the aside, which is where § Desktop put
   * it before FUEL-85 asked what each zone is FOR. The answer moved it: the
   * header's question is "where am I in this?", and the ruler is the screen's
   * own time graphic — "the graphic's own hairline closes the band, so the
   * separator is the graphic rather than a rule drawn near it".
   *
   * The class is unchanged, and that is the point of it being one: the copy
   * that is drawn at this width is decided here, and where it is drawn is
   * decided by which group `right-now.tsx` puts it in. Renamed rather than left
   * saying `aside`, because a variant named for a column it is no longer in is
   * the kind of thing the next reader trusts.
   */
  header: "hidden xl:block",
} as const;

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
export function positionInSpan(
  minutes: number,
  span: Span = DEFAULT_SPAN,
): number {
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

  // Deduplicated because a degenerate span would otherwise return the same
  // minute twice, which React sees as a duplicate key. `positionInSpan` already
  // renders such a span rather than throwing; this keeps the scale consistent
  // with that rather than trading a silent zero for a console warning.
  return [...new Set([...marks, span.end])];
}

/**
 * Half the rendered NOW pill, used to stop it hanging outside the ruler when the
 * present moment is near either end of the span — which for a 06:00 first slot
 * is every morning, not a rare edge.
 *
 * An approximation of a measured 44.7px, and allowed to be: it only takes effect
 * where the pill would otherwise overflow, and a pixel of slack at the very edge
 * is invisible. The accent rule is not clamped, so the precise moment is still
 * marked exactly — the pill is its label, not the reading.
 *
 * In `em` rather than `px` so it tracks the pill's own text under Dynamic Type.
 * The pill's padding is fixed while its text is not, so `em` over-estimates as
 * the text grows — which errs towards keeping the pill inside the ruler, the
 * direction that fails safely.
 */
const NOW_PILL_HALF = "2.2em";

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
    (tally, slot) => ({
      ...tally,
      [slot.status]: (tally[slot.status] ?? 0) + 1,
    }),
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
            className={cn(
              "absolute -translate-x-1/2",
              MARK[slot.status].className,
            )}
            style={{
              left: `${positionInSpan(slot.minutes, span)}%`,
              ...MARK[slot.status].style,
            }}
          />
        ))}

        {/* The scale and the pill are text inside a role="img", which the ARIA
            spec already makes presentational — but that depends on the browser
            pruning them, and Chrome still lists them in the tree. Hidden
            explicitly so no screen reader reads "06 12 18 22 Now" after a
            summary that has already said it better. */}
        {marks.map((at, index) => (
          <span
            key={at}
            aria-hidden
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
              aria-hidden
              className="absolute top-[26px] z-10 -translate-x-1/2 rounded-full bg-accent px-[7px] py-[2px] text-micro leading-none uppercase text-accent-foreground"
              style={{
                left: `clamp(${NOW_PILL_HALF}, ${positionInSpan(now, span)}%, calc(100% - ${NOW_PILL_HALF}))`,
              }}
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
          it is drawn twice.

          The wrapper is doing real work. `sr-only` hides an element by shrinking
          it to 1px and clipping, but a `display: table` box under automatic
          layout treats that width as a suggestion and lays out at its natural
          ~476px instead — which, being absolutely positioned, added itself to
          the document's scrollable width. At 100% it fitted inside the viewport
          and looked fine; at 200% Dynamic Type it pushed the page to 530px and
          scrolled sideways, against Brand Guide § Accessibility. A block wrapper
          honours the 1px and clips the table inside it, and the table keeps its
          semantics — forcing `display: block` onto the table itself would have
          hidden it from the accessibility tree instead. */}
      <div className="sr-only">
        <table>
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
    </div>
  );
}
