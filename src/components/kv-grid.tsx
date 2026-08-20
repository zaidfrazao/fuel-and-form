import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The key/value grid — Brand Guide § Component Patterns.
 *
 * The default way to present numbers, and the thing that replaces the macro
 * "strip" entirely. Micro label above, Value below, optional slash metadata
 * beneath. Two columns on mobile, three when the figures are short.
 *
 * Geometry transcribed from `docs/BRAND_GUIDE.html`: 22px row gap, 16px column
 * gap, 3px between the three lines of a pair.
 */

export type KeyValueItem = {
  /** The Micro label. Set in caps by the type token, so write it in sentence case. */
  label: string;
  value: ReactNode;
  /** Rendered beneath the value, prefixed with the slash mark. */
  meta?: ReactNode;
  /**
   * Weight 700 instead of 600.
   *
   * This exists for exactly one thing: Brand Guide § Typography — "Protein stays
   * emphasised by weight, not colour", because colour is spoken for. Reach for it
   * when a figure genuinely outranks its neighbours, not to decorate a row.
   */
  emphasis?: boolean;
};

/**
 * The secondary grey of a TINTED ground — `text-primary` at 68%.
 *
 * `text-secondary` is measured against the three untinted grounds and holds
 * there: 4.80:1 on `raised`, 4.26:1 on `surface`. On `accent-subtle` it falls to
 * **4.07:1**, under § Accessibility's WCAG AA floor of 4.5:1 for text this size
 * — so a panel that merely swapped its background would take every label and
 * every metadata line below the standard the guide sets for itself.
 *
 * Stepping down from `currentColor` instead reaches 5.53:1 in light and 7.56:1
 * in dark, which is the same move `subdued` makes for the ink tile and for the
 * same reason: on a ground that is not `raised`, a fixed grey is the wrong grey.
 *
 * Every ratio here is measured in a browser rather than derived: Tailwind emits
 * the alpha as an oklab `color-mix`, which lands a shade off what compositing
 * the hex in sRGB predicts.
 *
 * Exported so the one panel using it can put a sentence of its own on the tint
 * without guessing at the value — the swap preview's untracked-meal caveat sits
 * beside this grid on the same ground, and two hand-written alphas would be two
 * greys one edit away from disagreeing.
 *
 * That export is a narrow concession, not a pattern to follow. It is a class
 * STRING crossing a component boundary, which is exactly the coupling `tinted`
 * exists to avoid, and it earns its place only because the caveat is one
 * sentence that cannot reasonably move inside the grid. A second caller wanting
 * this grey is the signal that the tinted panel should become a component of
 * its own and own its own text — reach for that rather than for a third import.
 */
export const TINTED_TEXT = "text-text-primary/[0.68]";

/**
 * The slash mark's grey on a tinted ground, a step further back — 2.33:1 light,
 * 3.27:1 dark, against `text-tertiary`'s 2.19:1 on `raised` today.
 *
 * A ratio this low is a floor rather than a failure: the mark is punctuation,
 * `aria-hidden`, and § Slash Metadata wants it "recede[d] behind the thing it
 * introduces". Matching the recession is the point — a mark rendered at the
 * fact's own weight would read as part of the number.
 */
const TINTED_MARK = "text-text-primary/[0.38]";

/**
 * How a slash line meets its ground.
 *
 * `default` is the palette pair — the fact in `text-secondary`, the mark in
 * `text-tertiary` — and it is correct on `canvas`, `surface` and `raised`.
 *
 * `subdued` steps the whole line down from `currentColor` through `opacity`. It
 * is the ink tile's, where a tertiary grey is all but invisible and the line has
 * to work on both materials in both modes.
 *
 * `tinted` reaches comparable greys on a tinted ground, but through the COLOUR
 * channel rather than through `opacity` — and the difference is not cosmetic.
 * `opacity` applies to a whole subtree, so it dims anything nested inside the
 * line; a `color` is simply overridden by a descendant that sets its own. The
 * swap preview's calorie delta is a `text-error` span *inside* its metadata
 * line, and § Semantic Colors gives that red a meaning. Under `subdued` it would
 * be greyed by 32% — the panel softening the one figure on it that is trying to
 * be noticed.
 */
export type SlashTone = "default" | "subdued" | "tinted";

const TONE: Record<SlashTone, { line: string; mark?: string }> = {
  default: { line: "text-text-secondary", mark: "text-text-tertiary" },
  // No mark class: the line steps down as a whole, so the mark is already 68%
  // of the same `currentColor` and a second reduction would erase it.
  subdued: { line: "opacity-[0.68]" },
  tinted: { line: TINTED_TEXT, mark: TINTED_MARK },
};

/**
 * The leading `/ ` that marks every secondary fact — Brand Guide § Slash
 * Metadata. Lives here rather than in a fifth file because the tile is the only
 * other user of it, and one import is cheaper than one more module.
 *
 * The mock draws it with `::before { content: "/ " }`. Generated content is
 * announced by VoiceOver and by several other screen readers, which would put a
 * spoken "slash" in front of every piece of secondary information in the app. A
 * literal span marked `aria-hidden` renders identically and says nothing.
 *
 * Which greys it uses is `tone`'s, above.
 */
export function SlashMeta({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: SlashTone;
  className?: string;
}) {
  // Indexed without a `?? TONE.default` fallback, deliberately.
  //
  // `tone` is a closed union with a default, reached from two typed callsites in
  // this repository and no deserialized or untyped consumer. A fallback would
  // therefore be unreachable — but the reason not to add it is what it would do
  // if it ever DID fire: silently render `text-secondary`, which on a tinted
  // ground is the 4.07:1 this whole treatment exists to avoid. "Degrading
  // gracefully" here means degrading into the exact accessibility failure the
  // tone was introduced to fix, and doing it quietly, on the one panel where
  // legibility is the point. A throw is the louder and more honest failure.
  const { line, mark } = TONE[tone];

  return (
    <span className={cn("text-slash", line, className)}>
      <span aria-hidden className={mark}>
        /{" "}
      </span>
      {children}
    </span>
  );
}

export function KeyValueGrid({
  items,
  columns = 2,
  tinted,
  className,
}: {
  items: KeyValueItem[];
  /** Three only when the figures are short — the guide's "compact stats" case. */
  columns?: 2 | 3;
  /**
   * This grid sits on `accent-subtle` rather than on a plain ground.
   *
   * Both greys move together, because both fail together: the Micro label and
   * the metadata line are the same `text-secondary`, and the tint is what takes
   * it under AA. A prop rather than a guess, because a grid cannot see what is
   * painted behind it — and a screen carrying one of these on a tint would
   * otherwise be relying on a class-name coincidence.
   */
  tinted?: boolean;
  className?: string;
}) {
  return (
    // A description list, not a stack of spans: each label genuinely describes
    // its value, and `dl` is the one element that says so. The `div` wrapper per
    // pair is valid HTML and is what lets the grid place a pair as one cell —
    // bare dt/dd children would be laid out as separate tracks.
    <dl
      className={cn(
        "grid gap-x-4 gap-y-[22px]",
        columns === 3 ? "grid-cols-3" : "grid-cols-2",
        className,
      )}
    >
      {items.map(({ label, value, meta, emphasis }, index) => (
        // Keyed by position, not by label. Labels are not unique — a day view
        // showing "Calories" per meal repeats one immediately — and a duplicate
        // key makes React reuse the wrong cell. The grid is a static ordered
        // list that is never reordered in place, which is exactly the case where
        // an index key is the correct one.
        //
        // `min-w-0` so a long figure truncates inside its column instead of
        // widening the track and pushing the page sideways at 200% zoom.
        <div key={index} className="flex min-w-0 flex-col gap-[3px]">
          {/* Micro at 10.5px is permitted here precisely because the value sits
              adjacent at 22px — Brand Guide § Accessibility. It is never a
              standalone label. */}
          <dt
            className={cn(
              "text-micro uppercase",
              tinted ? TINTED_TEXT : "text-text-secondary",
            )}
          >
            {label}
          </dt>
          <dd className="flex min-w-0 flex-col gap-[3px]">
            <span
              className={cn(
                "text-value text-text-primary",
                emphasis && "font-bold",
              )}
            >
              {value}
            </span>
            {meta !== undefined && (
              <SlashMeta tone={tinted ? "tinted" : "default"}>{meta}</SlashMeta>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
