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
 * The leading `/ ` that marks every secondary fact — Brand Guide § Slash
 * Metadata. Lives here rather than in a fifth file because the tile is the only
 * other user of it, and one import is cheaper than one more module.
 *
 * The mock draws it with `::before { content: "/ " }`. Generated content is
 * announced by VoiceOver and by several other screen readers, which would put a
 * spoken "slash" in front of every piece of secondary information in the app. A
 * literal span marked `aria-hidden` renders identically and says nothing.
 *
 * The mark is `text-tertiary` while the fact itself is `text-secondary`, so the
 * punctuation recedes behind the thing it introduces. Tiles pass `subdued`
 * instead: on an `ink` fill a tertiary grey is all but invisible, so the whole
 * line steps down from `currentColor` together and keeps working on both
 * materials in both modes.
 */
export function SlashMeta({
  children,
  subdued,
  className,
}: {
  children: ReactNode;
  subdued?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-slash",
        subdued ? "opacity-[0.68]" : "text-text-secondary",
        className,
      )}
    >
      <span aria-hidden className={subdued ? undefined : "text-text-tertiary"}>
        /{" "}
      </span>
      {children}
    </span>
  );
}

export function KeyValueGrid({
  items,
  columns = 2,
  className,
}: {
  items: KeyValueItem[];
  /** Three only when the figures are short — the guide's "compact stats" case. */
  columns?: 2 | 3;
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
          <dt className="text-micro uppercase text-text-secondary">{label}</dt>
          <dd className="flex min-w-0 flex-col gap-[3px]">
            <span
              className={cn(
                "text-value text-text-primary",
                emphasis && "font-bold",
              )}
            >
              {value}
            </span>
            {meta !== undefined && <SlashMeta>{meta}</SlashMeta>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
