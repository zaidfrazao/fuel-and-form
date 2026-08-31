/**
 * The `/` loading state — Brand Guide § Feedback: "skeletons matching final
 * layout. **No spinner on `/` ever.**"
 *
 * Every block below is the size and position of the thing it stands in for in
 * `right-now.tsx`: the 10.5px eyebrow, the 40px title, the 41px ruler band, the
 * macro grid, two up-next rows, and the action bar held at the foot by the same
 * `mt-auto`. Nothing shifts when the real content swaps in, which is the only
 * property a skeleton has that a spinner does not.
 *
 * ## Three shapes, because the screen has three — FUEL-77
 *
 * `/` is not one layout any more and has not been since FUEL-82. Below 768px
 * the meal and the day share one grid and the ruler follows it; from 768 the two
 * named grids separate and the ruler precedes them; at 1272 the ruler and Up
 * next move to the second column and the bar sits under the first. A skeleton
 * that drew one of those three would shift on swap-in at the other two, which is
 * the one thing this file exists not to do — so it takes the same variants the
 * screen does, from the same constants, and the same `data-` handles so a test
 * can hold the two side by side (`loading.test.tsx`).
 *
 * Two of the screen's sections are still absent here and always have been:
 * Anytime and the foot link. Both are lists of unknown length — a skeleton
 * cannot stand in for a number of rows it does not know — and both are below the
 * fold on the phone this file was measured against.
 *
 * ## No pulse
 *
 * § Animation & Motion lists what animates, and a placeholder is not on it —
 * "motion clarifies origin and is otherwise absent". A static block also has
 * nothing to guard under `prefers-reduced-motion`, which is the cheapest way to
 * honour the requirement.
 *
 * Marked `aria-hidden` beneath a live region that says the one useful thing.
 * A screen reader reading out a dozen empty boxes is worse than silence, and
 * the boxes are, literally, nothing.
 */

import type { ReactNode } from "react";

import { APP_ACTION_BAR } from "@/components/action-bar";
import { RULER_AT } from "@/components/day-ruler";
import { PageMain } from "@/components/page-main";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_ASIDE_UNWRAP,
  PAGE_MEASURE_COLUMN,
  PAGE_MEASURE_FOOT,
} from "@/lib/frame";
import { cn } from "@/lib/utils";

/** A placeholder block. `surface` is the stone fill, so it recedes in both modes. */
function Block({ className }: { className: string }) {
  return <div className={`rounded-sm bg-surface ${className}`} />;
}

/** The ruler's own band, to the pixel — see day-ruler.tsx. */
function RulerBand({ className, at }: { className: string; at: string }) {
  return (
    <div className={className} data-ruler={at}>
      <Block className="h-[41px] w-full" />
    </div>
  );
}

/**
 * One cell of a macro grid: a Micro label over a 22px value, and on the day's
 * figures a slash line under it.
 *
 * `lines` is what separates the two shapes. The merged grid is three lines and
 * so is `Today`; `This meal` is two, because a meal's macros carry no target to
 * be measured against — `macro-grid.tsx` sets out which is which.
 */
function Cell({ lines }: { lines: 2 | 3 }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <Block className="h-[10px] w-14" />
      <Block className="h-[26px] w-20" />
      {lines === 3 && <Block className="h-[13px] w-16" />}
    </div>
  );
}

/** A four-cell grid, at the row gap its shape uses. */
function Grid({ lines, gap }: { lines: 2 | 3; gap: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4", gap)}>
      {[0, 1, 2, 3].map((cell) => (
        <Cell key={cell} lines={lines} />
      ))}
    </div>
  );
}

/** An eyebrow with something under it — the shape every named section takes. */
function Section({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[14px]">
      <Block className="h-[10px] w-16" />
      {children}
    </div>
  );
}

export default function Loading() {
  return (
    <PageMain className={`pt-3 md:pt-[22px] ${PAGE_ASIDE_GRID}`}>
      <p className="sr-only" role="status">
        Loading today&rsquo;s plan.
      </p>

      {/* The screen's own rhythm, which steps at 768 — FUEL-82. */}
      <div
        aria-hidden
        className={`flex flex-col gap-[22px] md:gap-[30px] ${PAGE_ASIDE_UNWRAP}`}
      >
        <div className={PAGE_MEASURE_COLUMN} data-column="measure">
          {/* Subject — eyebrow, 40px title, slash metadata. */}
          <div className="flex flex-col gap-1">
            <Block className="h-[10px] w-20" />
            <Block className="h-[41px] w-4/5" />
            <Block className="h-[13px] w-16" />
          </div>

          {/* 768–1271, where the ruler precedes the figures. */}
          <RulerBand className={RULER_AT.wide} at="wide" />

          {/* Below 768 the meal and the day are one grid at a 14px row gap;
              above it they are two named sections at 22. */}
          <div className="md:hidden" data-shape="merged">
            <Grid lines={3} gap="gap-y-[14px]" />
          </div>

          <div className="hidden md:flex md:flex-col md:gap-[30px]" data-shape="split">
            <Section>
              <Grid lines={2} gap="gap-y-[22px]" />
            </Section>
            <Section>
              <Grid lines={3} gap="gap-y-[22px]" />
            </Section>
          </div>
        </div>

        <div className={PAGE_ASIDE_COLUMN} data-column="aside">
          {/* The phone's position for the ruler, and the frame's. */}
          <RulerBand className={RULER_AT.phone} at="phone" />
          <RulerBand className={RULER_AT.aside} at="aside" />

          {/* Up next — eyebrow plus two 54px rows. */}
          <Section>
            {[0, 1].map((row) => (
              <div
                key={row}
                className="flex min-h-[54px] items-center justify-between border-b border-border py-3 last:border-b-0"
              >
                <Block className="h-[23px] w-40" />
                <Block className="h-[23px] w-12" />
              </div>
            ))}
          </Section>
        </div>
      </div>

      {/* The action bar, at the same 52px / 46px heights, the same 30px off the
          content above it and pinned the same way, so the primary does not move
          on swap-in. "Pinned the same way" used to be a claim about two class
          strings that happened to match — a skeleton pinned to 0 while the real
          bar cleared `--nav-shell-h` would put its primary 86px lower and the
          swap-in would jump. FUEL-83 made it the same string: `APP_ACTION_BAR`,
          which both take, so the two cannot disagree about the pinning or about
          the fade over the bar's top.

          FUEL-72 is what that mechanism was for. It unpinned the bar at ≥1024px
          — `lg:static` — and this skeleton needed the change as much as the real
          bar did, since a skeleton still pinned to the viewport while the bar it
          stands in for sat at the end of its column would jump by whatever the
          two were apart. Nothing was edited here to get that: the release is in
          the shared string, so the skeleton took it by taking the string.

          `PAGE_MEASURE_FOOT` is the second half of the same idea and had to be
          written: it is the bar's place in the page's grid rather than anything
          about the bar, so it lives beside the columns it refers to and both
          `/`'s bar and this one wear the pair. */}
      <div aria-hidden className={cn(APP_ACTION_BAR, PAGE_MEASURE_FOOT)}>
        <Block className="h-13 w-full rounded-md" />
        <div className="flex gap-3">
          <Block className="h-[2.875rem] flex-1 rounded-md" />
          <Block className="h-[2.875rem] flex-1 rounded-md" />
        </div>
      </div>
    </PageMain>
  );
}
