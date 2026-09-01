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

import {
  ACTION_BAR_CONTROLS,
  ACTION_BAR_PRIMARY,
  ACTION_BAR_SECONDARY,
  ACTION_BAR_SPLIT,
  APP_ACTION_BAR,
} from "@/components/action-bar";
import { RULER_AT } from "@/components/day-ruler";
import { KV_GRID_COLUMNS } from "@/components/kv-grid";
import { PageMain } from "@/components/page-main";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_ASIDE_UNWRAP,
  PAGE_HEADER_BAND,
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

/**
 * A four-cell grid, at the row gap its shape uses.
 *
 * `columns` is `kv-grid.tsx`'s own shape, READ from it rather than spelled the
 * same way here — FUEL-79.
 *
 * It was a hand-copied literal, with a comment promising it matched. FUEL-79
 * moved the real grid from `xl` to `md` (the measure is 584px at both widths,
 * so the count was never a width decision) and this copy stayed behind, which
 * drew 2×2 here against four across on the screen for the whole of 768–1271 —
 * a shift on swap-in, the one thing a skeleton exists to prevent.
 *
 * Importing the map is what makes that impossible rather than merely noticed:
 * the two grids cannot be given different counts by an edit to one of them,
 * which is what the test below has always claimed and could not enforce while
 * there were two literals.
 */
function Grid({
  lines,
  gap,
  columns = 2,
}: {
  lines: 2 | 3;
  gap: string;
  columns?: 2 | 4;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-4",
        columns === 4 && KV_GRID_COLUMNS[4],
        gap,
      )}
    >
      {[0, 1, 2, 3].map((cell) => (
        <Cell key={cell} lines={lines} />
      ))}
    </div>
  );
}

/**
 * A list of rows at one height — `The day`'s 44 and `Up next`'s 54.
 *
 * Two shapes rather than one, because the aside holds a different list at each
 * side of the frame's cap: `Up next`'s two rows below it, `The day`'s whole
 * timeline above. `right-now.tsx` carries the argument for the pair.
 */
function Rows({ count, height }: { count: number; height: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <div
          key={row}
          className={cn(
            "flex items-center justify-between border-b border-border last:border-b-0",
            height,
          )}
        >
          <Block className="h-[23px] w-40" />
          <Block className="h-[23px] w-12" />
        </div>
      ))}
    </>
  );
}

/** An eyebrow with something under it — the shape every named section takes. */
function Section({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & { "data-section"?: string }) {
  return (
    <div className={cn("flex flex-col gap-[14px]", className)} {...rest}>
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
        {/*
         * `aria-hidden` on each group as well as on their wrapper, which is
         * redundant on purpose — raised by the FUEL-77 precommit review.
         *
         * The wrapper carries it, and the wrapper is `display: contents` at
         * `xl`. Every implementation resolves `aria-hidden` by walking the DOM
         * rather than the box tree, so the descendants are hidden either way —
         * but `display: contents` has a history of accessibility bugs, the
         * property being guarded is "a screen reader is never read a dozen
         * empty boxes", and the failure would be silent to every test in this
         * repository. Two attributes is a cheap way not to depend on it.
         */}
        {/* The header band — the folio and the ruler, both drawn only at the
            frame's cap, exactly as the screen draws them. Below it this group
            is `display: contents` with two `display: none` children, so it
            contributes nothing at all — which is what keeps the phone's
            skeleton the one it was. */}
        <div aria-hidden className={cn(PAGE_HEADER_BAND, "xl:gap-[2px]")} data-column="header">
          <Block className="hidden h-[10px] w-40 xl:block" />
          <RulerBand className={RULER_AT.header} at="header" />
        </div>

        <div aria-hidden className={PAGE_MEASURE_COLUMN} data-column="measure">
          {/* Subject — eyebrow, 40px title, slash metadata. */}
          <div className="flex flex-col gap-1">
            <Block className="h-[10px] w-20" />
            <Block className="h-[41px] w-4/5" />
            <Block className="h-[13px] w-16" />
          </div>

          {/* 768–1271, where the ruler precedes the figures. */}
          <RulerBand className={RULER_AT.wide} at="wide" />

          {/* Below 768 the meal and the day are one grid at a 14px row gap;
              above it they are two named sections at 22 — and above the frame's
              cap the day's half is in the aside, so this half stands alone and
              goes four across. `data-shape="split"` names the meal's grid at
              both widths it is drawn at. */}
          <div className="md:hidden" data-shape="merged">
            <Grid lines={3} gap="gap-y-[14px]" />
          </div>

          <div className="hidden md:flex md:flex-col md:gap-[30px]" data-shape="split">
            <Section>
              <Grid lines={2} gap="gap-y-[22px]" columns={4} />
            </Section>
          </div>
        </div>

        <div aria-hidden className={PAGE_ASIDE_COLUMN} data-column="aside">
          {/* `Today` — first in this column, and first for the reason the screen
              gives: it was the last section of the measure before FUEL-86 and
              this group follows immediately, so the flat column below the cap is
              unchanged. Gated at `md` like the screen's, because below 768 the
              merged grid above is already carrying these four figures. */}
          <div className="hidden md:flex md:flex-col" data-shape="day">
            <Section>
              <Grid lines={3} gap="gap-y-[22px]" />
            </Section>
          </div>

          {/* The phone's position for the ruler. The band above has the cap's. */}
          <RulerBand className={RULER_AT.phone} at="phone" />

          {/* `The day` at the cap and `Up next` below it — the two lists the
              screen swaps between, at their own row heights, so neither width
              swaps in against a skeleton drawn for the other. */}
          <Section className="hidden xl:flex" data-section="the-day">
            <Rows count={6} height="min-h-[44px] py-[10px]" />
          </Section>

          <Section className="xl:hidden" data-section="up-next">
            <Rows count={2} height="min-h-[54px] py-3" />
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
        {/*
         * The controls, in the shapes the bar takes — `action-bar.ts`, FUEL-86.
         * A column of slabs below the frame's cap and a row of content-width
         * controls at it.
         *
         * ## The widths at the cap are measured rather than derived
         *
         * `xl:w-auto` on a real button is its label plus the size variant's
         * padding. A `Block` has no label, so the same utility would draw it at
         * zero and the row would swap in from nothing. The three numbers below
         * are the rendered widths of `Log eaten`, `Swap` and `Skip` at 1272,
         * read out of the browser rather than computed from the padding — the
         * label's own width is a font metric and § Desktop's mock is drawn at a
         * different type scale from the app's, which `kv-grid`'s 86-versus-100
         * already cost one ticket.
         *
         * They are approximate by nature: a workout card's primary says `Mark
         * done` and has no Swap beside it, so one skeleton cannot be exact for
         * both cards. It is exact for the meal card, which is what `/` shows for
         * most of a day, and the error on the other is horizontal — the bar's
         * height and its distance from the content above are identical either
         * way, so nothing moves vertically on swap-in at any width.
         */}
        <div className={ACTION_BAR_CONTROLS}>
          <Block className={cn("h-13 rounded-md", ACTION_BAR_PRIMARY, "xl:w-[121px]")} />
          <div className={ACTION_BAR_SPLIT}>
            <Block
              className={cn("h-[2.875rem] rounded-md", ACTION_BAR_SECONDARY, "xl:w-[76px]")}
            />
            <Block
              className={cn("h-[2.875rem] rounded-md", ACTION_BAR_SECONDARY, "xl:w-[66px]")}
            />
          </div>
        </div>
      </div>
    </PageMain>
  );
}
