"use client";

import { type ReactNode, startTransition, useOptimistic, useState } from "react";

import { logItem, undoLastLog } from "@/app/actions/log";
import {
  ACTION_BAR_CONTROLS,
  ACTION_BAR_PRIMARY,
  ACTION_BAR_SECONDARY,
  ACTION_BAR_SPLIT,
  APP_ACTION_BAR,
} from "@/components/action-bar";
import { repeatMeal, revertSwap, swapMeal } from "@/app/actions/swap";
import { DayComplete } from "@/components/day-complete";
import Link from "next/link";

import { DayRuler, RULER_AT } from "@/components/day-ruler";
import { ExerciseList } from "@/components/exercise-list";
import { KeyValueGrid, SlashMeta } from "@/components/kv-grid";
import { MacroGrid, MealDayGrid } from "@/components/macro-grid";
import { PageMain } from "@/components/page-main";
import { SwapSheet, type PlannedMeal, type SwappableMeal } from "@/components/swap-sheet";
import { WalkRow } from "@/components/walk-row";
import { Button } from "@/components/ui/button";
import type { CalendarDate } from "@/lib/date";
import {
  type DayRow,
  type LoggedEntry,
  pendingEntry,
  STATUS_LABEL,
  theDay,
} from "@/lib/day-summary";
import type { WorkoutExercise } from "@/lib/db/schema";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_ASIDE_UNWRAP,
  PAGE_BAND_GRAPHIC,
  PAGE_HEADER_BAND,
  PAGE_MEASURE_COLUMN,
  PAGE_MEASURE_FOOT,
} from "@/lib/frame";
import type { LogVerb } from "@/lib/log-intent";
import { type MacroBearing, type MacroTarget, summariseDay } from "@/lib/macros";
import { folioLabel, itemLabel, itemName, rulerSlots } from "@/lib/now-display";
import { FOCUS_RING, HOVER_LINK } from "@/lib/pointer";
import { swapNote } from "@/lib/swap-note";
import { cn } from "@/lib/utils";
import { isWalk, type WalkEntryView } from "@/lib/walk";
import {
  type AnytimeItem,
  type NowItem,
  type NowView,
  type NowViewBase,
  positionAt,
  positionOf,
  type ScheduledItem,
} from "@/lib/resolve-now";

/**
 * The "Right Now" screen — PRD § P1, Brand Guide § Seven screens.
 *
 * The screen the app exists for, and the only one that has to answer its
 * question before a word is read: one dominant card for what is happening now,
 * the day's shape beneath it, what is next after that, and the actions in the
 * bottom third where a thumb already is.
 *
 * ## Given its view rather than resolving one
 *
 * Takes a resolved `NowView` and renders it. No database handle, no session, no
 * clock — `src/lib/db/queries/today.ts` does all three and `app/page.tsx` wires
 * the two together in a dozen lines. That split is what makes this file testable
 * at all: an async component that opened a connection could not be rendered by
 * the hermetic suite, and every acceptance criterion this task has is about what
 * ends up on the screen.
 *
 * ## Why this is a client component (FUEL-19)
 *
 * Not a preference. § Feedback is "optimistic by default — the PRD budgets 300ms
 * and optimism is how that is met", and advancing on the CURRENT FRAME means the
 * next item's name, macros and exercise list have to already be in the browser
 * when the thumb lands. Any arrangement that leaves the card server-rendered can
 * only advance after a round trip, which is the thing being avoided.
 *
 * The consequence, stated rather than buried: the payload for `/` now carries
 * today's resolved timeline instead of only its rendered HTML. That is the
 * signed-in user's own data travelling over their own authenticated response —
 * no other user's rows are resolvable into it, because everything upstream is
 * scoped — but it is a real change from FUEL-18 and worth knowing about. Only
 * what the optimistic advance genuinely needs crosses: FUEL-19 sent the day's
 * log history as a count, and FUEL-20 widened that to one line per log — a name
 * and a status — because the day-complete summary that prints them is reached
 * optimistically too. The rows themselves still stay on the server; `dayLog`
 * derives the lines in `app/page.tsx` and only the answer travels.
 *
 * Progressive enhancement goes with it: these controls need JavaScript, because
 * optimistic UI is JavaScript. Neither the PRD nor the Brand Guide asks for a
 * no-JS path, and pretending otherwise with a `<form>` wrapper would buy a
 * degraded mode nobody specified.
 *
 * ## The two rules this screen is checked against
 *
 * **One umber element, and it means "now"** (§ The Four Rules). That element is
 * the day ruler's NOW marker. Nothing else here may reach for `accent` — not a
 * button, not a highlight, not the active item's own name. The only other
 * accent in the tree is the focus ring every interactive element carries, which
 * is not a persistent element of the screen.
 *
 * **Actions are ink, not colour.** The primary is `Button`'s `default` variant,
 * which FUEL-2 re-pointed at `ink`. There is exactly one per screen.
 *
 * ## The swap (FUEL-23)
 *
 * Swap is no longer `disabled`: it opens `swap-sheet.tsx`, and confirming one
 * writes a dated override through `actions/swap.ts`. Three consequences are
 * worth naming here rather than leaving to be discovered:
 *
 * **The payload grew again.** The meal library now crosses, narrowed in
 * `app/page.tsx` to what the picker draws and the preview totals, plus what the
 * template plans today. Both are the signed-in user's own data over their own
 * authenticated response, and both are needed in the browser for the same
 * reason the timeline is: the sheet's totals have to move on the frame a tile
 * is tapped, and a request per tap is the latency § Feedback rules out.
 *
 * **A swap is optimistic, but it does not advance.** The chosen meal replaces
 * the slot's on the current frame — new name, new macros, Swapped tag, note —
 * while the position stays exactly where it was. A swap changes WHAT the active
 * item is, not whether it is done, and the server agrees: `swapMeal` writes no
 * cursor.
 *
 * **The Swapped tag does not break the one-umber rule.** It is `accent-subtle`,
 * a tinted ground, not `accent`. See `SwappedTag` below.
 *
 * ## The repeat (FUEL-24)
 *
 * The sheet's second exit: the same meal on today and the days after it. It
 * changes nothing structural here, and the reason is worth stating because it
 * looks like it should.
 *
 * `/` renders ONE day. A repeat writes several, but only one of them has a card
 * on this screen — so the optimistic move is the same `swapped` move a plain
 * swap makes, for today's key, and the other dates are simply not this screen's
 * business. They arrive through `refresh()` on whatever screen does show them,
 * which today is none and after FUEL-28 is the weekly grid.
 *
 * The count travels on the `Attempt` rather than living in the sheet, because
 * "Try again" has to re-run the same repeat and the sheet has closed by the
 * time a refusal comes back. That is the same argument the `Attempt` union was
 * built on, applied to the one piece of state a repeat has and a swap does not.
 */

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** Micro eyebrow above a section. 14px to its content — § Spacing & Layout. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="text-micro uppercase text-text-secondary">{children}</h2>;
}

/**
 * The mark on a slot that has diverged from the template — P2's "overridden
 * cells are visually marked".
 *
 * `accent-subtle`, which the palette table names for exactly this: "Swapped
 * cells and the Swapped tag — the only tinted grounds in the system".
 *
 * ## Why the text is `text-primary` and not `accent`
 *
 * § The Four Rules says umber "marks the present moment and nothing else",
 * lists "the swap tint" among the things it marks, and then says **one umber
 * element per screen**. On `/` that element is already spoken for — it is the
 * ruler's NOW marker. Drawing this tag in saturated `accent` would make two.
 *
 * The tint is not the accent, so both sentences hold at once: the ground is
 * `accent-subtle`, the label is ordinary text on it, and the one thing on this
 * screen wearing umber is still the marker that says "you are here".
 *
 * Not colour alone, either (§ Accessibility): the word "Swapped" is the signal
 * and the tint reinforces it, so the mark survives greyscale and a colour-blind
 * reader loses nothing.
 */
function SwappedTag() {
  return (
    <span className="rounded-[4px] bg-accent-subtle px-1.5 py-0.5 text-micro uppercase text-text-primary">
      Swapped
    </span>
  );
}

/**
 * The subject of the screen: what it is, at 40px, and when it was due.
 *
 * The eyebrow is the slot and the Title is the item's own name, which is the
 * 7× scale contrast the guide asks for — 40px against 10.5px. The scheduled
 * time sits underneath as slash metadata rather than beside the eyebrow, so
 * the name has the row to itself at the size that makes it readable across a
 * kitchen.
 */
function Subject({
  item,
  at,
  swapped,
  name,
}: {
  item: NowItem;
  at?: string;
  swapped?: boolean;
  /**
   * Overrides the item's own name.
   *
   * An un-confirmed swap has changed which meal this is, and the heading is the
   * first thing that has to say so — it is the answer to the question the
   * screen exists to ask. Without this the macros and the tag would update on
   * the frame while the 40px title still named the meal that was replaced.
   */
  name?: string;
}) {
  return (
    <header className="flex flex-col gap-1">
      {/* The tag sits beside the slot label rather than beside the name: it
          qualifies WHICH dinner this is, and the Title is meant to have its row
          to itself at the size that makes it readable across a kitchen. */}
      <div className="flex items-center gap-2">
        <p className="text-micro uppercase text-text-secondary">
          {itemLabel(item)}
          {/*
           * The time joins the slot label on one line below 768px — FUEL-82,
           * and it is what `docs/BRAND_GUIDE.html` draws: the mock's Right Now
           * frame carries `Dinner · 19:00` as a single Micro line, where this
           * screen had split it into an eyebrow here and a slash line beneath
           * the title. Rejoining them returns the 17px line and the 4px gap
           * above it — 21px, and the margin that takes the merged grid clear of
           * the action bar rather than level with it.
           *
           * Both facts survive; only the line count changes. Above 768px the
           * slash treatment is restored, where § Slash Metadata's "the fact the
           * number is measured against, set beneath it" reads as intended and
           * there is no fold paying for it.
           */}
          {at !== undefined && <span className="md:hidden"> &middot; {at}</span>}
        </p>
        {swapped && <SwappedTag />}
      </div>
      {/* The one h1 on the page. A screen whose whole job is answering "what
          now?" should have the answer as its heading, not the product name. */}
      <h1 className="text-title text-text-primary">{name ?? itemName(item)}</h1>
      {at !== undefined && <SlashMeta className="hidden md:block">{at}</SlashMeta>}
    </header>
  );
}

/**
 * A meal's numbers — Brand Guide § Key/Value Grid, which "replaces the macro
 * strip entirely".
 *
 * Two columns rather than three: the guide allows three only for short figures,
 * and a four-digit kcal beside a one-decimal gram weight is not that at 375px.
 * Protein carries `emphasis`, which is weight 700 against 600 — § Typography's
 * "protein stays emphasised by weight, not colour", because colour is spoken
 * for by the accent.
 *
 * ## Why it grew a heading
 *
 * It had none until FUEL-31, and did not need one: it was the only grid on the
 * screen, sitting directly beneath the 40px name of the thing it described. The
 * day's totals now sit 30px below it with the same four labels in the same
 * order, and two unlabelled grids reading `Calories / Protein / Fat / Carbs`
 * one after the other are not a layout a reader can resolve. Both are named, and
 * neither name is a decoration.
 */
function MealMacros({
  meal,
  className,
  ...rest
}: { meal: MacroBearing; className?: string } & { "data-shape"?: string }) {
  return (
    <section className={cn("flex flex-col gap-[14px]", className)} {...rest}>
      <Eyebrow>This meal</Eyebrow>

      {/*
       * Four-across on the measure, 2×2 in an aside — § Desktop's density rule
       * as FUEL-85 amended it: "the four-macro grid, which this rule names out
       * of scope, goes four-across on a measure and stays 2×2 in an aside. At
       * 584 the 2×2 puts around 300px between a label and the next value, which
       * is four islands rather than a grid."
       *
       * On the MEASURE, which is 584px from 768px up and not only at the frame's
       * cap — so the four arrive at 768 since FUEL-79. They used to wait for
       * 1272, which drew those four islands for the whole of the tablet band on
       * a column that was already the width the rule was written about.
       *
       * This grid is the measure's, so it takes the four. `DayTotals` below is
       * the aside's and keeps the two. Same component, same rule about content,
       * two column counts because the two columns are different widths — which
       * is why the count is a prop rather than something the grid works out.
       *
       * `columns={4}` is the whole shape and not just the desktop half — see
       * `kv-grid.tsx`, which owns the breakpoint. Four across a 375px phone is
       * 83px a column against the guide's own 110px test, so a `4` that meant
       * four at every width would be a count no screen could use.
       */}
      <KeyValueGrid
        columns={4}
        items={[
          { label: "Calories", value: `${meal.kcal}` },
          { label: "Protein", value: `${meal.proteinG} g`, emphasis: true },
          { label: "Fat", value: `${meal.fatG} g` },
          { label: "Carbs", value: `${meal.carbG} g` },
        ]}
      />
    </section>
  );
}

/**
 * What the day comes to, against target — PRD § P4, FUEL-31.
 *
 * *"The day's planned macros, summed from whatever meals are actually scheduled
 * for that date after overrides, shown against target with the delta. A swap
 * that costs the day 30g of protein says so at the moment of the swap, not in
 * hindsight."*
 *
 * ## It recomputes because there is nothing to recompute
 *
 * The criterion is that the totals move on any swap, revert or template edit,
 * and no code below does anything to make that true. `planned` is
 * `plannedToday`, which is the resolved day with any un-confirmed swap already
 * applied — the same value the sheet previews against. So a swap moves these
 * figures on the frame it is tapped, a revert moves them back, and a template
 * edit arrives as new props from the server. There is no cached sum anywhere to
 * invalidate, which is `macros.ts`'s point in refusing to hold one.
 *
 * ## Present on a workout card too
 *
 * The totals belong to the DAY, not to the item in the middle of the screen. A
 * grid that appeared at breakfast and vanished at the afternoon session would be
 * hiding the day's numbers exactly when the next meal is the one being decided.
 */
function DayTotals({
  planned,
  target,
  className,
}: {
  planned: readonly PlannedMeal[];
  target: MacroTarget;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-[14px]", className)}>
      {/* "Today" rather than "Day totals": § Content Guidelines asks for the
          shortest true label, and the screen is already about today. */}
      <Eyebrow>Today</Eyebrow>

      <MacroGrid totals={summariseDay(planned)} target={target} />
    </section>
  );
}

/**
 * What comes after this, with the times it comes at.
 *
 * Two of them. `NowView.upcoming` holds every remaining item precisely so the
 * view decides how many to show (resolve-now.ts:203-208), and the PRD's
 * criterion is "the next two upcoming items are shown with their scheduled
 * times". More than two turns a glance into a list to be read.
 *
 * ## It stands down at the frame's cap — FUEL-86
 *
 * `The day` below lists every item with its status, so it contains the next two
 * and `Up next` beside it would be the same fact printed twice — § Desktop's
 * "say a thing once", which names "the figure, a bar showing its ratio, and the
 * remainder in words" as the draft it was written against.
 *
 * The phone keeps this one. The PRD's criterion is measured on the phone and it
 * asks for exactly two; a desktop aside is 356px of column with the whole day's
 * worth of room in it, and the two devices are answering different questions.
 *
 * A second DOM copy rather than a slice of one list, which is the choice
 * FUEL-86 asked to be made deliberately. `display: none` on the copy that is
 * off, so exactly one is in the accessibility tree at any width and neither is
 * reordered — the device the three ruler copies already use. `xl:hidden` alone
 * is safe from the emission-order trap that produced two rulers in FUEL-77:
 * that needed two VARIANTS on one property, and there is no `md:` rule on this
 * one for `xl:` to have to outrank.
 */
function UpNext({ items }: { items: readonly ScheduledItem[] }) {
  const next = items.slice(0, 2);

  if (next.length === 0) return null;

  return (
    <section className="flex flex-col gap-[14px] xl:hidden">
      <Eyebrow>Up next</Eyebrow>
      <ul className="flex flex-col">
        {next.map((item) => (
          <li
            key={item.key}
            className="flex min-h-[54px] items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className="truncate text-body text-text-primary">{itemName(item)}</span>
              <span className="text-micro uppercase text-text-tertiary">{itemLabel(item)}</span>
            </span>
            <span className="text-body text-text-secondary">{item.at}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The whole day, with what became of each item — FUEL-86, and the frame's cap
 * only.
 *
 * § Desktop gives the aside "the record, the pattern, the day around it", and
 * the redrawn `/` spends that on the day itself: every scheduled item, in
 * order, with its status. It is the one section on this screen that is not a
 * reflow of something the phone already draws — `Up next` above stands down for
 * it, and the argument for the pair being two DOM copies is written there.
 *
 * `day-summary.ts`'s `theDay` does the joining and carries the reasoning for
 * it. Nothing here fetches: the timeline and the log are both already props.
 *
 * ## Marked by weight, never by colour
 *
 * § The Four Rules allows "one umber element per screen, and it always says:
 * you are here" — on `/` that is the ruler's NOW marker, which is now directly
 * above this list in the header band. So the current row is marked the way
 * `recent-sessions.tsx` marks one: the rows behind it recede to
 * `text-secondary` and it does not. FUEL-85 records the first draft of this
 * frame having had three umber elements and this list holding one of them.
 *
 * ## The row is day-complete's row
 *
 * 44px with 10px of padding, a name on the left and a Micro word on the right —
 * `day-complete.tsx`'s `Logged` exactly, because it is the same row saying the
 * same thing about the same day. § Desktop's "nothing else gets denser above
 * 1024px" is not in tension with it: this is not a tightened 54px row, it is
 * the height that row already has everywhere it appears, and the mock draws
 * these two lists at the same 44.
 *
 * An item the cursor has walked past without logging keeps its time rather than
 * inventing a word for it. That is the manual advance's own state — "I'm done"
 * without a tap on anything — and § Tone of Voice would rather say nothing than
 * name it something it was not.
 */
function TheDay({ rows }: { rows: readonly DayRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="hidden flex-col gap-[14px] xl:flex">
      <Eyebrow>The day</Eyebrow>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex min-h-[44px] items-center justify-between gap-4 border-b border-border py-[10px] last:border-b-0"
          >
            <span
              className={cn(
                "truncate text-body",
                row.place === "past" ? "text-text-secondary" : "text-text-primary",
              )}
            >
              {row.name}
            </span>

            {row.place === "now" ? (
              <span className="text-micro uppercase text-text-primary">Now</span>
            ) : row.status ? (
              <span
                className={cn(
                  "text-micro uppercase text-text-secondary",
                  // The same step down day-complete makes, and for the reason
                  // it gives: "a skip is a neutral fact about the day, and
                  // greying it out is the closest this screen could come to a
                  // judgement. Weight recedes without dimming."
                  row.status === "skipped" && "font-normal",
                )}
              >
                {STATUS_LABEL[row.status]}
              </span>
            ) : (
              <span className="text-body text-text-secondary">{row.at}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Things with no window — the daily walk, and any slot with no time set.
 *
 * Offered alongside the active card and never as it, which is the distinction
 * `resolveNow` draws by putting them in a separate bucket: the walk is on the
 * template every day, and an item pinned to a window it has no basis for would
 * displace dinner every evening.
 */
/**
 * The day's unscheduled items — the daily walk, and any slot whose time was
 * cleared in settings.
 *
 * Only one of them is loggable from here, and that is the point of the split
 * below. The walk is "a separate, always-present item logged with a single tap"
 * (PRD § P3, FUEL-29), so it gets `walk-row.tsx` and its own control; a meal
 * that merely has no window is still an ordinary meal, and logging it is the
 * action bar's job once the card reaches it.
 */
function Anytime({
  items,
  date,
  walks,
}: {
  items: readonly AnytimeItem[];
  date: CalendarDate;
  /** What is recorded against each walk, by entry id. See `RightNow`. */
  walks: ReadonlyMap<string, WalkEntryView>;
}) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-[14px]">
      <Eyebrow>Anytime</Eyebrow>
      <ul className="flex flex-col">
        {items.map((item) =>
          isWalk(item) ? (
            <WalkRow
              key={item.key}
              date={date}
              entryId={item.workout.entryId}
              name={itemName(item)}
              entry={walks.get(item.workout.entryId) ?? null}
            />
          ) : (
            <li
              key={item.key}
              className="flex min-h-[54px] items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
            >
              <span className="truncate text-body text-text-primary">{itemName(item)}</span>
              <span className="text-micro uppercase text-text-tertiary">
                {itemLabel(item)}
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * The action bar — § Touch Targets: "primary actions sit in the bottom third,
 * within thumb reach".
 *
 * Everything under that heading is a phone's, and since FUEL-72 it is scoped to
 * one: below 1024px the bar is pinned, for the reasons argued at length below.
 * At and above it the bar is `static` and sits at the end of its column, because
 * § Desktop's carry-over rule retires the sentence this section is built on — a
 * mobile decision carries to desktop unless its written rationale names the
 * phone, and "within thumb reach" names it. `action-bar.ts` carries that half.
 * The 44×44 minimum in the same section names no posture, so it carries and the
 * primary below is the same 52px at every width.
 *
 * ## Sticky as well as `mt-auto`, because `mt-auto` alone was not enough
 *
 * `mt-auto` on a `min-h-dvh` column puts the bar at the foot of the viewport
 * when the content is short. It does nothing when the content is tall, and on
 * P1 the content usually is: measured at 375×667 with a ruler, four macros, two
 * up-next rows and the walk, the document ran to 893px and the primary landed
 * at y=703 — thirty-six pixels below the fold, reachable only by scrolling.
 * That is the criterion failing on the default case, not an edge.
 *
 * `sticky` fixes the reach without giving up the natural placement:
 * the bar keeps its own box at the end of the column, so it never overlaps the
 * last row once the page is scrolled to the end, and it is pinned inside the
 * viewport until then. `bg-background` is what makes it opaque as content
 * passes beneath it, and the 30px of it above the primary is the separation —
 * no border and no shadow, since § Materials allows neither outside sheets.
 *
 * What that opacity used to arrive as was a hard edge, cutting whatever line of
 * type it landed on through the x-height. `action-bar-fade` masks the top 24px
 * of the bar below `lg` so the line runs out instead — FUEL-83, and globals.css
 * carries the argument for a mask over the alternatives. The fill, the height
 * and the offset are all untouched by it.
 *
 * The safe-area inset used to live here, because a bar pinned to `bottom: 0`
 * sits below any padding its parent has. It has moved to the § Navigation shell
 * — FUEL-58 — which is now the last thing in the page column and the only thing
 * with the home indicator beneath it. A bar that kept its own inset would be
 * clearing an indicator that is two elements away, and the gap would show.
 *
 * ## It sticks to the shell's height, not to zero
 *
 * FUEL-65 pinned that shell to the bottom of the viewport, and two boxes
 * claiming `bottom: 0` means the later one wins — the shell, covering this bar
 * and the one action P1 is measured on. So the bar stops at `--nav-shell-h`
 * instead, the shell's own height, declared once in globals.css and read here
 * and in `training.tsx` and `loading.tsx`.
 *
 * That offset is the phone's problem and it ends where the phone does. Above
 * 1024px the shell is a sidebar to the left, so there is nothing under this bar
 * to clear — but the answer to that is not a different offset. `lg:bottom-0` was
 * written here first and was one: it released the shell's height while leaving
 * the bar pinned, which at 1440×900 held the bottom ~130px of the viewport over
 * content nobody could then read. FUEL-72 released the pinning instead —
 * `lg:static`, in `action-bar.ts` — and the inset above goes inert with it,
 * since an inset does nothing to a static box.
 *
 * Swap is offered for a meal and not for a session: a swap substitutes one meal
 * for another from the library (PRD § P2), and there is no equivalent for a
 * scheduled session — a session that isn't happening is a skip.
 *
 * ## It renders on the quiet states too, when there is something to undo
 *
 * "Undo is available from where the action was performed, for the rest of the
 * day" (§ Feedback) has an edge that is easy to miss: logging the LAST item of
 * the day turns the screen into the day-complete state, which has no active card
 * and, before FUEL-19, no bar at all. The undo for that final tap would have had
 * nowhere to live. So the bar appears whenever there is an item to act on, a log
 * to take back, or a failure to report — and returns `null` only when there is
 * genuinely none of the three.
 */
function Actions({
  item,
  undoable,
  failure,
  onAct,
  onSwap,
}: {
  item?: ScheduledItem;
  undoable: boolean;
  failure: Attempt | null;
  onAct: (attempt: Attempt) => void;
  onSwap: () => void;
}) {
  if (!item && !undoable && !failure) return null;

  return (
    // `PAGE_MEASURE_FOOT` places the bar under the first column at ≥1272 —
    // FUEL-77. Inert everywhere else, including on day-complete, where the
    // screen never becomes a grid and a grid-placement property on a flex item
    // does nothing. Stated on the bar rather than passed in per state, because
    // it says the same thing in all three: the primary action is at the end of
    // the measure, and never in the aside.
    <div className={cn(APP_ACTION_BAR, PAGE_MEASURE_FOOT)}>
      {/*
       * § Feedback: "inline banner at the point of action, value reverted,
       * 'Try again'. Never a modal." The point of action is this bar, so the
       * banner is in it — above the controls, where the thumb is already
       * heading, rather than at the top of a screen that may be scrolled away.
       *
       * `role="alert"` so the refusal is heard and not merely coloured. The
       * value has already reverted by the time this renders: the optimistic
       * position resets when the transition ends without the server having
       * moved the cursor, so the card the user was looking at is back.
       */}
      {failure && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-border pb-3"
        >
          <p className="text-caption text-error">{banner(failure)}</p>
          <Button variant="link" size="xs" onClick={() => onAct(failure)}>
            Try again
          </Button>
        </div>
      )}

      {/* The controls, which are a column of slabs on a phone and a row of
          content-width buttons at the frame's cap — § Buttons, FUEL-85. The
          banner above stays outside it: it is a block that spans the column,
          and `action-bar.ts` carries the argument. */}
      <div className={ACTION_BAR_CONTROLS}>
        {item && (
          <>
            <Button
              className={ACTION_BAR_PRIMARY}
              onClick={() => onAct({ kind: "act", item, verb: "log" })}
            >
              {item.kind === "meal" ? "Log eaten" : "Mark done"}
            </Button>
            <div className={ACTION_BAR_SPLIT}>
              {/* No longer disabled — FUEL-23 gives it the sheet it was waiting
                  for. Secondary, per § Buttons, which names Swap as its example
                  of "a real action that isn't the main one". */}
              {item.kind === "meal" && (
                <Button
                  variant="secondary"
                  className={ACTION_BAR_SECONDARY}
                  onClick={onSwap}
                >
                  Swap
                </Button>
              )}
              <Button
                variant="secondary"
                className={ACTION_BAR_SECONDARY}
                onClick={() => onAct({ kind: "act", item, verb: "skip" })}
              >
                Skip
              </Button>
            </div>
          </>
        )}

      {/*
       * Tertiary, so the Text variant — § Buttons gives that one to "Revert",
       * and Undo has it for the same reason: the common case is a tap that was
       * correct, and the control for taking it back is for the uncommon one.
       *
       * Undo is the only control left on this row. Revert used to sit beside it
       * and now lives on the card — see `SwapNote`, which carries the argument.
       * Undo stays because it belongs to the tap that was just made HERE: it
       * takes back the log the primary button above it wrote, seconds ago, and
       * moving it away from that button would be moving it away from its cause.
       */}
        {/* The fourth item in the row, at the cap — which is § Buttons' own
            stated reason for the row existing: "a row is what lets a fourth
            control — Undo, when there is a log to take back — be a fourth item
            rather than a third row of slabs". Below the cap it is the third
            row it has always been. */}
        {undoable && (
          <div className={cn("flex items-center gap-4", ACTION_BAR_PRIMARY)}>
            <Button variant="link" onClick={() => onAct({ kind: "undo" })}>
              Undo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The swap's state, and the control that takes it back — FUEL-25.
 *
 * ## Why Revert is here and not in the action bar
 *
 * § Touch Targets: "destructive controls never sit adjacent to a frequently
 * tapped one". In the bar it sat 12px below the Swap/Skip row and 64px below
 * the 52px primary — inside the bottom third the guide reserves for the actions
 * a thumb reaches for without looking, which on this screen are "Log eaten",
 * "Skip" and "Swap". A slightly low tap on Swap landed on Revert, and the two
 * are near-opposites: one opens a sheet that asks a question, the other
 * silently deletes the override the sheet wrote.
 *
 * Up here it is a scroll-length away from all three, and § Feedback's
 * "revertible from where it was performed, for the rest of that day" still
 * holds in the sense that matters. The swap is DISPLAYED here — the Swapped tag
 * beside the eyebrow, the note beneath the macros — and P2 words the criterion
 * the same way round: "overridden cells are visually marked and can be reverted
 * to template in one tap". The mark and the revert are one thought.
 *
 * The banner for a refused revert stays in the action bar with every other
 * refusal, and that is not an inconsistency: § Feedback puts it "at the point of
 * action", the bar is where this screen reports what it could not do, and the
 * message names the operation — "Couldn't revert that." — so it is legible
 * wherever it is read from.
 *
 * ## Offered by the state, not by the tap
 *
 * Rendered only while the slot IS overridden, which is what makes it survive a
 * reload and appear in every tab: nothing has to remember that a swap happened,
 * because the override itself is the memory. That was true of the old placement
 * too and is worth restating, since it is the reason this is a conditional
 * control rather than a disabled one.
 *
 * `size="sm"` is the guide's 46px, unchanged by the move: the button is inline
 * with a caption now, and shrinking it to match the text would take it under
 * the 44px minimum.
 */
function SwapNote({
  note,
  onRevert,
}: {
  /** `lib/swap-note.ts`'s sentence, or `null` when nothing was swapped. */
  note: string | null;
  /** Absent when the slot is not overridden — there is nothing to revert. */
  onRevert?: () => void;
}) {
  if (!note && !onRevert) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      {/*
       * § Feedback keeps routine success silent, and this is not an
       * acknowledgement of a tap — it is the state of a slot that has diverged
       * from the template, present for as long as the override is and in every
       * tab, not just the one that swapped. See lib/swap-note.ts, which argues
       * the distinction in full.
       */}
      <p className="text-caption text-text-secondary">{note}</p>

      {onRevert && (
        <Button variant="link" className="shrink-0 px-0" onClick={onRevert}>
          Revert
        </Button>
      )}
    </div>
  );
}

/**
 * The page frame.
 *
 * `flex-1` rather than `min-h-dvh`: the viewport height belongs to
 * `app/(app)/layout.tsx` now, because the shell sits below this column and a
 * `<main>` that claims the whole screen leaves the shell no room but its own
 * overflow. This fills what is left instead. The argument for the DYNAMIC unit
 * over `100vh` moved to the layout with the class that acts on it.
 *
 * `flex-1` and not merely `flex` — `Actions` below is pinned and `mt-auto`
 * inside this box, and a content-sized `<main>` on a short day ends above the
 * fold with the bar clamped to it, floating mid-screen instead of in the thumb's
 * reach.
 *
 * That is still the argument at ≥1024px, where FUEL-72 unpinned the bar, and it
 * is the reason unpinning it was not the same as untethering it. `mt-auto` is
 * unscoped: it puts the bar at the foot of this box on a short day at every
 * width. What `flex-1` decides is where that foot is — the bottom of the screen
 * rather than the bottom of the content. Drop it and the desktop bar lands mid-
 * screen with a gap beneath, which is the phone's old failure with no thumb to
 * explain it.
 *
 * The bottom gutter is not here and is not on the action bar either — it is on
 * the § Navigation shell, which sits below this column and is the only thing
 * with the home indicator under it. Before FUEL-58 the bar carried its own, and
 * the two quiet states carried a copy because their bar is conditional; all
 * three are gone, which is what stops the screens that kept one from ending up
 * with two.
 *
 * ## The second column, taken by two of the three states — FUEL-77
 *
 * `className` is here so that the grid arrives per state rather than per screen.
 * Two of the three take it and one refuses it: § Desktop gives day-complete "the
 * same column, with more air", because "a second column would set something
 * beside a screen whose whole argument is that there is nothing left". A grid on
 * this component would have handed it one.
 *
 * At ≥1272 that grid also decides where the bar sits, and the paragraph above
 * about `flex-1` stops applying there. `PAGE_ASIDE_GRID` packs its rows to the
 * top, so the bar is 30px under the last figure the way the mock draws it rather
 * than at the foot of the window — which is `mt-auto` going inert, exactly as
 * `bottom-[…]` went inert under FUEL-72's `lg:static`. Below 1272, including the
 * whole 1024–1271 band, `flex-1` and `mt-auto` do what they have always done.
 */
function Screen({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // 12px of head clearance below 768px rather than 22 — FUEL-82. This screen
    // opens under up to two notice bands, each with its own hairline, so the gap
    // between the last of them and the eyebrow is already read as separation;
    // the full 22 is head room the fold cannot spare. Above 768px there is no
    // fold to spare it from and the gutter's own 22 is restored.
    <PageMain className={cn("pt-3 md:pt-[22px]", className)}>
      {children}
    </PageMain>
  );
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A tap, in the form the retry needs.
 *
 * "Try again" has to re-run the SAME thing that failed, so a failure is stored
 * as the attempt itself rather than as a message. One shape, two constructors,
 * and the banner hands it straight back to the handler.
 */
type Attempt =
  | { kind: "act"; item: ScheduledItem; verb: LogVerb }
  | { kind: "undo" }
  | { kind: "revert"; item: ScheduledItem }
  | { kind: "swap"; item: ScheduledItem; meal: SwappableMeal }
  /**
   * The same meal on this date and the days after it — FUEL-24.
   *
   * Carries `days` because a retry has to re-run the SAME repeat: "Try again"
   * on a failed five-day run must not quietly write two. The sheet is gone by
   * then, so the count has nowhere else to be remembered.
   */
  | { kind: "repeat"; item: ScheduledItem; meal: SwappableMeal; days: number };

/**
 * What the banner says about a refused attempt.
 *
 * Three sentences rather than one, because § Tone of Voice asks copy to "name
 * what happened" and forbids "Something went wrong". "Couldn't save that" is
 * accurate for a log and wrong for a revert, which was not saving anything.
 *
 * A swap's refusal is reported here, on the card, even though the tap happened
 * in the sheet: § Feedback puts the banner "at the point of action", and by the
 * time an answer comes back the sheet has closed. The card is where the swap
 * was started and where its result is visible, so it is the point of action
 * that still exists.
 */
function banner(failure: Attempt): string {
  if (failure.kind === "undo") return "Couldn’t undo that.";
  if (failure.kind === "revert") return "Couldn’t revert that.";
  if (failure.kind === "swap") return "Couldn’t swap that.";
  if (failure.kind === "repeat") return "Couldn’t repeat that.";

  return "Couldn’t save that.";
}

/**
 * What a tap does to the screen before the server has answered.
 *
 * A position and the day's log, moved together: logging advances the card, makes
 * an undo available AND adds a line to the day-complete summary; undoing does
 * all three in reverse. Holding them in ONE optimistic value is what keeps them
 * consistent — two `useOptimistic` calls could revert independently, leaving an
 * undo control offered for a log that failed to write.
 *
 * The log is the ENTRIES rather than a count (FUEL-20). Logging the last item of
 * the day is the only way to reach the summary by tapping, so a count would
 * leave that screen missing the very line the tap produced, and its calorie
 * figure short by that meal, for as long as the request took. Appending the
 * entry the tap implies is what makes the finished page right on the frame it
 * appears. `dayLog` orders the server's entries by `logged_at` — the same order
 * undo takes them back in — so popping the last one is the reverse of pushing.
 */
type Progress = {
  position: number;
  entries: LoggedEntry[];
  /**
   * The meal a swap put into a slot, before the server has confirmed it.
   *
   * Keyed by item key and holding the CHOSEN meal, so the card can show the new
   * name, the new macros and the Swapped tag on the frame the sheet closes —
   * § Feedback's 300ms budget applies to a swap exactly as it does to a log.
   *
   * In this value rather than in a second `useOptimistic` for the reason the
   * doc above gives: two optimistic values can revert independently, and a swap
   * that reverted while the position did not would leave the card showing the
   * old meal under a Revert button for an override that was never written.
   *
   * A map because the anytime list is reachable too, and because a key is
   * exactly what the action takes — nothing here has to decide which slot a
   * swap belongs to, which is a decision only the server is allowed to make.
   *
   * `null` is a REVERT: the slot is going back to the template. Present as a
   * key rather than absent, because absence already means "the server's answer
   * stands" — and the server's answer for a slot being reverted is still the
   * override. Deleting the key would leave the card showing the swap it was
   * just asked to undo until the round trip finished.
   */
  swaps: ReadonlyMap<string, SwappableMeal | null>;
};

type Move =
  | { kind: "logged"; entry: LoggedEntry }
  | { kind: "undone" }
  | { kind: "swapped"; key: string; meal: SwappableMeal }
  | { kind: "reverted"; key: string };

function applyMove(current: Progress, move: Move): Progress {
  if (move.kind === "logged") {
    return {
      ...current,
      position: current.position + 1,
      entries: [...current.entries, move.entry],
    };
  }

  if (move.kind === "undone") {
    return {
      ...current,
      position: current.position - 1,
      entries: current.entries.slice(0, -1),
    };
  }

  const swaps = new Map(current.swaps);

  swaps.set(move.key, move.kind === "reverted" ? null : move.meal);

  // Position untouched: a swap changes WHAT the active item is, not whether it
  // is done. The server agrees — `swapMeal` writes no cursor.
  return { ...current, swaps };
}

/**
 * What the screen shows the instant a control is tapped, before the server has
 * been asked.
 *
 * One function per direction — this builds the optimistic move, `perform` runs
 * the write — so that a fifth control cannot be added to one and forgotten in
 * the other: both are exhaustive over `Attempt`, and TypeScript says so.
 */
function optimistic(attempt: Attempt, date: CalendarDate): Move {
  switch (attempt.kind) {
    case "undo":
      return { kind: "undone" };
    case "swap":
    // A repeat and a swap look IDENTICAL on this screen, which is why they
    // share a move rather than getting a fourth. The run covers days that have
    // no card here — `/` renders one day — so the only date the optimistic
    // layer can honestly speak for is today's, and today's is a swap. Inventing
    // state for tomorrow would be the client asserting something about a day it
    // has never resolved, and `refresh()` is what makes the rest true.
    case "repeat":
      return { kind: "swapped", key: attempt.item.key, meal: attempt.meal };
    case "revert":
      return { kind: "reverted", key: attempt.item.key };
    default:
      // The entry the tap implies, built through `logIntent` so the word this
      // screen prints and the status the row is written with are the same
      // decision. `view.date` rather than the clock: the day being logged is
      // the day that was resolved.
      return { kind: "logged", entry: pendingEntry(attempt.item, attempt.verb, date) };
  }
}

/** The write a tap asks for. Every one of these answers rather than throwing. */
function perform(attempt: Attempt): Promise<{ ok: boolean }> {
  switch (attempt.kind) {
    case "undo":
      return undoLastLog();
    case "swap":
      // The KEY and the meal id, and nothing else. The date and the slot are
      // re-derived on the server from the key — see actions/swap.ts.
      return swapMeal(attempt.item.key, attempt.meal.id);
    case "repeat":
      // The key, the meal and the count. The start date and the slot are
      // re-derived on the server from the key, exactly as a swap's are.
      return repeatMeal(attempt.item.key, attempt.meal.id, attempt.days);
    case "revert":
      return revertSwap(attempt.item.key);
    default:
      return logItem(attempt.item.key, attempt.verb);
  }
}

export function RightNow({
  view,
  exercises,
  entries,
  target,
  meals,
  templatePlan,
  walks,
}: {
  view: NowView;
  /** `workouts.id` → its exercises, from `loadToday`. */
  exercises: ReadonlyMap<string, WorkoutExercise[]>;
  /**
   * The day's log as the summary prints it — `dayLog(...)`, in logged order.
   *
   * Derived rows rather than the rows themselves: a name, a status, and the
   * macros of an eaten meal. Everything else `meal_logs` and `workout_logs`
   * hold — the note, the instant, the ids — stays on the server, because
   * nothing on this screen shows it. Its length is also what offers the undo
   * control, which is why it covers every row rather than only the ones it
   * could name.
   */
  entries: LoggedEntry[];
  /**
   * The four target figures from `profiles`.
   *
   * Read twice: by the day-complete summary, and by the swap sheet's preview,
   * which shows the resulting day against target before the swap is confirmed.
   */
  target: MacroTarget;
  /**
   * The meal library the picker offers — narrowed in `app/page.tsx`.
   *
   * Archived rows may be present; `meal-picker.tsx` filters them, and
   * `actions/swap.ts` refuses them again on the way in.
   */
  meals: readonly SwappableMeal[];
  /**
   * What the TEMPLATE plans today, overrides ignored — `loadToday`'s answer.
   *
   * The "before" half of every swap note on this screen. It does not change
   * when a swap is made, which is the whole point of the override model and is
   * why the optimistic layer above can leave it alone: swapping dinner twice
   * still measures both against the same template dinner.
   */
  templatePlan: readonly PlannedMeal[];
  /**
   * What is recorded against today's walks, keyed by template entry — FUEL-29.
   *
   * A missing key is a walk that has not been logged; a plan with no walk on it
   * is an empty map. The row is rendered from the ITEM being in `anytime`, so
   * the two do not need telling apart here. Narrowed in `app/page.tsx` to the
   * one field a row draws — the `workout_logs` row also carries an id, an
   * instant, a status that is always 'done' and a note no screen shows.
   *
   * A prop rather than part of `entries`, because the walk is not part of the
   * card's optimistic layer: `walk-row.tsx` holds its own, for the reason
   * `lib/walk.ts` gives.
   */
  walks: ReadonlyMap<string, WalkEntryView>;
}) {
  /*
   * The optimistic layer — § Feedback's "optimistic by default", and the whole
   * of how the PRD's 300ms budget is met.
   *
   * The state is a POSITION, not a view: `positionAt` below turns it back into
   * one using the same rule the server used, so the client cannot disagree with
   * `resolveNow` about whether advancing past the last item means day-complete.
   *
   * Both fields reset to the server's values whenever a new render arrives,
   * which is the reconciliation: on success the action moved the cursor and
   * wrote the log, so the base has caught up and nothing moves; on failure it
   * wrote neither, so the card and the undo control revert together.
   */
  const [progress, move] = useOptimistic<Progress, Move>(
    { position: positionOf(view), entries, swaps: new Map() },
    applyMove,
  );

  const [failure, setFailure] = useState<Attempt | null>(null);
  const [picking, setPicking] = useState(false);

  function act(attempt: Attempt) {
    setFailure(null);

    startTransition(async () => {
      move(optimistic(attempt, view.date));

      // The `try` covers the CALL, not the action. `logItem` and `undoLastLog`
      // catch everything themselves and answer `{ ok: false }` — but reaching
      // them is a network request, and that request can fail on its own: no
      // signal in a kitchen, a dropped connection, a cold start that times out.
      // Those reject rather than resolve, and without this the rejection would
      // escape the transition: no banner, no "Try again", and an unhandled
      // rejection in the console. The optimistic value reverts either way, so
      // the screen would silently undo the tap and never say why — which is
      // the failure mode § Feedback exists to rule out, on the connection this
      // app is most likely to meet.
      try {
        const result = await perform(attempt);

        // Success is silent — § Feedback: "the UI reflecting the new state IS
        // the confirmation". There is no toast here on purpose; the card has
        // already moved on, which is the only acknowledgement a routine log
        // gets.
        //
        // The transition wrapper is not optional. React does not treat a state
        // update after an `await` as part of the transition it was started in,
        // so without it the banner would paint a frame before the optimistic
        // value reverts — the failure message arriving over the card that is
        // about to disappear.
        if (!result.ok) startTransition(() => setFailure(attempt));
      } catch {
        // The same banner as a refused action. The two are one event to whoever
        // is holding the phone: it did not save, and here is how to try again.
        startTransition(() => setFailure(attempt));
      }
    });
  }

  // The day's shape, which a tap does not change — only the position within it
  // does. Restated field by field rather than spread from `view`, so that a new
  // field on `NowViewBase` is a compile error here rather than a stale value
  // silently riding along inside an optimistic render.
  const base: NowViewBase = {
    date: view.date,
    minutesOfDay: view.minutesOfDay,
    timeline: view.timeline,
    anytime: view.anytime,
  };

  const now = positionAt(base, progress.position);

  /*
   * Today's walk, if the plan has one — the item, not its log.
   *
   * Needed on its own only for the day-complete branch below, which does not
   * render the Anytime list. Everywhere else the row comes out of that list.
   */
  const walkItem = base.anytime.find(isWalk);

  const active = now.state === "active" ? now.active : undefined;

  /**
   * What is planned for a slot right now, with any un-confirmed swap applied.
   *
   * The server's answer unless the optimistic layer holds a swap for this key,
   * in which case the chosen meal wins and the slot counts as an override —
   * which is what puts the Swapped tag and the note on the card on the frame
   * the sheet closes, rather than after a round trip.
   */
  const shown = (item: NowItem & { key: string }) => {
    if (item.kind !== "meal") return undefined;

    const slot = item.meal.slot;
    const server = {
      slot,
      meal: item.meal.meal,
      isOverride: item.meal.source === "override",
    };

    if (!progress.swaps.has(item.key)) return server;

    const chosen = progress.swaps.get(item.key);

    if (chosen) return { slot, meal: chosen, isOverride: true };

    // A revert in flight. What it goes back to is the template's meal, which is
    // why `templatePlan` carries names as well as macros.
    //
    // No template entry means the swap had filled a slot the template leaves
    // empty, so reverting removes the item from the day altogether — a change
    // to the day's SHAPE, which the optimistic layer deliberately does not
    // make (see `applyMove`: the position is never touched here). The server's
    // answer stands for the length of the round trip, and `refresh()` drops the
    // item. Rare, brief, and correct in the meantime.
    const template = templatePlan.find((entry) => entry.slot === slot);

    return template ? { slot, meal: template.meal, isOverride: false } : server;
  };

  const activeMeal = active ? shown(active) : undefined;

  /**
   * Every meal planned today, in slot order, with un-confirmed swaps applied.
   *
   * The base the sheet's preview edits. Built from the timeline AND the anytime
   * list, because both are meals that count towards the day — a slot whose time
   * was cleared in settings still has calories in it, and a preview that
   * omitted it would under-report the whole day rather than one row.
   */
  const plannedToday = [...base.timeline, ...base.anytime]
    .map(shown)
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  /**
   * The sentence under a swapped card — the Brand Guide's Swap copy.
   *
   * `null` for a slot resolved from the template, because nothing was swapped
   * and there is nothing to state. The "before" is `templatePlan`, which does
   * not move when a swap is made, so swapping twice still measures against the
   * template rather than against the previous swap — the day's cost is what it
   * is, not the sum of how many times the user changed their mind.
   */
  const note = activeMeal?.isOverride
    ? swapNote(
        templatePlan.find((item) => item.slot === activeMeal.slot)?.meal ?? null,
        activeMeal.meal,
      )
    : null;

  const actions = (
    <Actions
      item={active}
      /*
       * Every line except the walk's — FUEL-29.
       *
       * This control is a stack over what the BAR logged, and `lib/walk.ts`
       * explains why the walk is not one of those: undoing moves the card back,
       * and the walk never moved it forward. `actions/log.ts` narrows the same
       * way on the server, so a day whose only log is the walk offers no Undo
       * here AND has none to give if one were asked for.
       */
      undoable={progress.entries.some((entry) => !entry.walk)}
      failure={failure}
      onAct={act}
      onSwap={() => setPicking(true)}
    />
  );

  /*
   * The picker, mounted only while the active item is a meal.
   *
   * Rendered outside the two early-returning states below on purpose: it
   * portals to `document.body`, so where it sits in this tree does not affect
   * where it draws — but a sheet that outlived the card it was opened from
   * would be asking about a slot that is no longer active.
   */
  const sheet = active && activeMeal && (
    <SwapSheet
      open={picking}
      onOpenChange={setPicking}
      slot={activeMeal.slot}
      date={base.date}
      planned={plannedToday}
      meals={meals}
      target={target}
      onConfirm={(meal) => act({ kind: "swap", item: active, meal })}
      onRepeat={(meal, days) => act({ kind: "repeat", item: active, meal, days })}
    />
  );

  // The ruler answers "where am I in the day?", so it is drawn wherever that
  // question is still open — beneath the active card, and on a day with nothing
  // planned, where the shape is worth showing even though nothing is active.
  //
  // The day-complete summary is the exception, and the only one: the day is
  // over, so the question has no live answer, and § Materials frames that screen
  // as a closed page rather than a position within one. The Brand Guide's mock
  // of it carries no ruler either.
  const ruler = (
    // The extra 8px of head was tuned when the section rhythm was 30px at every
    // width. Below 768px it is 22 — FUEL-82 — and `pt-2` there would give the
    // ruler 30px of clearance while every other block on the screen has 22,
    // which is the inconsistency rather than the rhythm. Restored from 768px up,
    // where the rhythm it was tuned against is still what runs.
    //
    // And spent again at 1272 — FUEL-77, and still spent after FUEL-86 moved
    // this copy into the header band. The 8px is clearance from a block the
    // ruler has to clear, and in the band the block above it is the folio,
    // which the mock draws 2px away: a caption and the graphic it captions are
    // one unit, so the band sets that 2px as its own gap and the ruler adds
    // nothing to it. One string for all three copies, since the two that are
    // hidden at this width cannot care.
    //
    // `md:max-xl:` and not `md:pt-2 xl:pt-0`, for the reason `RULER_AT` sets out
    // at length: Tailwind emits the redefined `xl` media block BEFORE `md`, so
    // the `md` rule is the later one at 1272 and an `xl:` override of it never
    // lands. Bounded to the band it is for, there is nothing to override.
    <DayRuler
      slots={rulerSlots(base.timeline)}
      now={base.minutesOfDay}
      className="md:max-xl:pt-2"
    />
  );

  /*
   * On a phone the ruler follows the numbers instead of preceding them —
   * FUEL-82.
   *
   * A meal's name runs to fifty characters and the Title is 40/41 with no
   * smaller step in the scale, so `Roasted Red Pepper & Provolone Ciabatta Roll`
   * is four lines and 164px — 46% of the 354px the chrome leaves. Measured
   * across the seventeen meals in the library, the ruler above the grid put
   * three of them under the action bar. Below it, all seventeen clear.
   *
   * Which is to say the trade is not "ruler or macros" in the abstract: it is
   * that on the longest names something must go under the bar, and the four
   * figures are what § P4 is measured on while the ruler is orientation with a
   * complete `aria-label` summary of its own. The numbers win.
   *
   * Two positions rather than one with `order`: CSS `order` moves the box and
   * not the sequence, so a screen reader would meet the ruler in a different
   * place from a sighted user at one of the two widths. Rendered twice, the
   * hidden copy is `display: none` and out of the accessibility tree entirely,
   * so the DOM order a screen reader walks matches the visual order at BOTH
   * widths. That is the same reasoning the two macro shapes above are built on.
   */
  /*
   * Only a meal card moves it. On a workout card there is no merged grid to move
   * it past — the middle of the screen is `ExerciseList`, which runs to six rows
   * — so demoting the ruler below that would push it most of a screen down to
   * buy nothing. The card that has the fold problem is the one that gets the
   * reordering.
   */
  /*
   * A third position, and the same device — FUEL-77.
   *
   * At ≥1272 the ruler is not on the measure at all. FUEL-77 read § Desktop as
   * putting it in the aside; FUEL-85 asked what each zone is for and moved it
   * to the header band, which is the zone whose question it answers — "where am
   * I in this?" — and whose hairline it now IS. Either way the copy that serves
   * 768–1271 stands down at `xl` and another takes over; what changed is which
   * group the third copy is written in.
   *
   * Three copies rather than two, for the reason there were two: `order` and
   * grid placement both move the box without moving the sequence, so a screen
   * reader would meet the ruler somewhere a sighted reader does not. The hidden
   * copies are `display: none` and out of the accessibility tree, so exactly one
   * is announced at every width — which is why the tests count what is drawn by
   * `data-ruler` rather than by counting `img` roles.
   *
   * The workout card now takes a wrapper it did not have. It renders one visible
   * ruler as it always did; what changed is that "the original place" is now a
   * place it leaves at 1272 like every other, so the copy needs something to
   * hang `xl:hidden` on.
   */
  const rulerAbove = (
    // On a workout card this copy is the one that serves the phone as well, so
    // it drops the `hidden md:block` half and keeps only the stand-down at the
    // cap — there is no merged grid here for the ruler to move around.
    <div
      className={cn(
        activeMeal ? RULER_AT.wide : RULER_AT.belowCap,
        PAGE_BAND_GRAPHIC,
      )}
      data-ruler="wide"
    >
      {ruler}
    </div>
  );

  const rulerBelow = activeMeal ? (
    <div className={RULER_AT.phone} data-ruler="phone">
      {ruler}
    </div>
  ) : null;

  const rulerBelowCap = (
    <div className={cn(RULER_AT.belowCap, PAGE_BAND_GRAPHIC)} data-ruler="below-cap">
      {ruler}
    </div>
  );

  /*
   * The header band — § Desktop's "one job per zone", FUEL-85/86.
   *
   * "Where am I in this?", answered by a Micro folio line and the screen's own
   * time graphic, "whose hairline closes the band, so the separator is the
   * graphic rather than a rule drawn near it". Nothing else goes here: a second
   * heading would arrive before the subject, and a figure would put the reader
   * in front of three things that all want to be read first.
   *
   * Both children are `hidden` below the cap, so the band contributes nothing
   * to the phone — not even a gap, since a `display: none` child of a
   * `display: contents` group is not a flex item and the wrapper's `gap` has
   * nothing to draw between. That is the whole of how the 375 and 820 baselines
   * come back byte-identical with a new zone in the DOM.
   *
   * The 2px gap is the mock's, and it is a caption's gap rather than a section
   * rhythm: the folio and the graphic it captions are one unit, which is why
   * this is not the 30px that separates everything else.
   */
  const rulerHeader = (
    <div className={RULER_AT.header} data-ruler="header">
      {ruler}
    </div>
  );

  const header = (
    <div className={cn(PAGE_HEADER_BAND, "xl:gap-[2px]")} data-column="header">
      {/* Micro, tertiary, and a caption rather than a heading — § Desktop:
          "the folio is a caption, not a heading. Micro is this system's
          register for metadata and a date on a screen that is always today is
          metadata." Not an `h1`/`h2` for the same reason, so the screen's
          heading order is untouched at every width. The same treatment
          `day-complete.tsx` already gives the date in its own corner. */}
      <p className="hidden text-micro uppercase text-text-tertiary xl:block">
        {folioLabel(base.date)}
      </p>

      {base.timeline.length > 0 && rulerHeader}
    </div>
  );

  /*
   * The way to `/settings` — FUEL-21, and now the only link at the foot of `/`.
   *
   * Named `Settings`, which it was not until FUEL-60. It read `Slot times`,
   * which was true when FUEL-21 added it and slot times were the whole screen,
   * and a subset of the destination ever since: `/settings` also holds the walk
   * reminder, the push subscription, the export, the template link and
   * sign-out, and its own `<h1>` says Settings. The string is not lost — the
   * form there still carries it as one `<h2>` of the sections on that page,
   * which is where a name for one section belongs. § Navigation's route table
   * names this route `Settings`, and a link that names a destination uses the
   * table's name; the shell and the four up-links already do.
   *
   * It used to be four. `Weekly plan`, `Training` and `Weight` were added one
   * task at a time because there was no other way to reach those screens, and
   * FUEL-58 gave them one: § Navigation's shell carries all four destinations
   * on every authenticated screen, so three text links here are a second, worse
   * copy of it — same targets, no active state, different on every screen that
   * grew its own set.
   *
   * Settings is not one of the four and does not go in the pill. § Navigation
   * settles where it goes instead: "To the foot of `/`... Two taps from
   * anywhere: the Now pill, then the link." `nav-shell.tsx` renders a Settings
   * link in the sidebar's foot at ≥1024px and explicitly leaves the phone to
   * this one, so deleting it would strand `/settings` behind `/plan/template`
   * on every phone in the app.
   *
   * The register is unchanged and so is the argument for it: below everything
   * the screen is for, so `/` still "renders the current item with no
   * navigation" — PRD § P1, which now carries the written reading of that
   * criterion.
   *
   * Rendered in all three states, INCLUDING day-complete, which never had it.
   * That is a change and not an oversight. "Two taps from anywhere" is false
   * every evening if the finished page omits it: once the day is logged, `/` IS
   * this screen, so the tap that § Navigation promises lands on a page with no
   * link on it. FUEL-29 already narrowed the closed-page rule once, for the
   * walk row directly above, and on the same grounds — a rule about how the day
   * reads should not hide the one thing still outstanding after dark.
   */
  const settingsFootLink = (
    // Still a flex row, so the anchor is sized to its text rather than
    // stretching the width of the column as a block-level child would.
    //
    // `lg:hidden` — FUEL-77. The paragraph above says this link exists because
    // `nav-shell.tsx` "renders a Settings link in the sidebar's foot at ≥1024px
    // and explicitly leaves the phone to this one". Both halves were rendering
    // above 1024, so `/` carried two links to the same destination — the only
    // screen in the app that did, since it is the only one with a foot link at
    // all. § Desktop's frames draw one. The rail's is the one that stays: it is
    // on every screen, it shows where you are, and § Navigation puts Settings in
    // the sidebar's foot by name.
    <span className="flex items-center lg:hidden">
      <Link
        href="/settings"
        className={`text-slash text-text-tertiary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
      >
        Settings
      </Link>
    </span>
  );

  /*
   * The finished page — FUEL-20.
   *
   * Everything the active screen carries is deliberately absent here: no ruler,
   * no "up next", no anytime list. § Materials calls this a closed page and puts
   * crop marks at its corners on that basis, and a summary still offering the
   * day's shape and the things left to log would not be one. The two are
   * different screens that happen to share a route, which is why this branch
   * returns rather than decorating the one below.
   *
   * The action bar stays, and stays conditional: it is there when there is a log
   * to take back, which is the case § Feedback names — the tap that produced
   * this screen is the one most likely to want undoing, "from where it was
   * performed".
   */
  if (now.state === "day-complete") {
    return (
      <Screen>
        <div className="flex flex-1 flex-col gap-[30px]">
          <DayComplete date={base.date} entries={progress.entries} target={target} />

          {/*
           * The one thing the closed page still offers — FUEL-29.
           *
           * A deliberate narrowing of the rule above, and worth stating because
           * it reads as a contradiction of it. The walk is on the template every
           * single day and is logged whenever, which in practice is the evening
           * — PRD § P9 exists precisely because it is the thing most likely to
           * be still outstanding after dark. The last item of the day is often
           * dinner, so "the day is walked through" and "the walk is unlogged"
           * routinely overlap, and a closed page in that state would be a screen
           * that hid the only thing left to do until midnight rolled the date.
           *
           * Only while it is UNLOGGED, which is what keeps the page closed in
           * every other respect: once the row exists it becomes a line in the
           * summary above like every other log, and nothing is offered here at
           * all. The transition covers the change-over, so there is no frame
           * where the walk is in neither place.
           */}
          {walkItem && !walks.has(walkItem.workout.entryId) && (
            <section className="flex flex-col gap-[14px]">
              {/* Labelled like the list it is a narrowing of, rather than left
                  as a bare row under the crop marks — an unlabelled control
                  below a closed page reads as something that fell off it. */}
              <Eyebrow>Anytime</Eyebrow>
              <ul className="flex flex-col">
                <WalkRow
                  date={base.date}
                  entryId={walkItem.workout.entryId}
                  name={itemName(walkItem)}
                  entry={null}
                />
              </ul>
            </section>
          )}

          {settingsFootLink}
        </div>

        {actions}
      </Screen>
    );
  }

  if (now.state === "nothing-planned") {
    return (
      /*
       * The same two columns as the timeline state — FUEL-77.
       *
       * The mock draws no frame for this state, so the ruling is written down
       * rather than transcribed: it is `/` with an empty subject, not a screen
       * of its own, and the aside's contents are exactly what they are next
       * door. Giving it one column instead would mean the reader's page
       * rearranged itself on a day the plan happens not to cover — the aside
       * appearing and disappearing with the data rather than with the width.
       *
       * Day-complete is the one that genuinely differs, and § Desktop says why
       * in a sentence this state cannot borrow: "a second column would set
       * something beside a screen whose whole argument is that there is nothing
       * left". Nothing is planned here; there is still a day going on.
       */
      <Screen className={PAGE_ASIDE_GRID}>
        <div className={`flex flex-col gap-[30px] ${PAGE_ASIDE_UNWRAP}`}>
          {/* The same header band as the timeline state, and the same reason
              this state takes it: the band answers "where am I in this?", and a
              day the plan does not cover is still a day the reader is somewhere
              in. The ruler only appears if there is a timeline to draw. */}
          {header}

          <div className={PAGE_MEASURE_COLUMN} data-column="measure">
            <header className="flex flex-col gap-2">
              {/* Stood down at the cap, where the folio in the band above says
                  the same word 40px higher — § Desktop's "say a thing once",
                  which is the rule FUEL-85 wrote against exactly this: a header
                  that "stated one fact three ways". This is the only state
                  where the two collide; the timeline's eyebrow is the slot and
                  its time, and day-complete has no band.

                  Hidden rather than removed, because below the cap there is no
                  folio and the h1 would lose its caption entirely. It is a `p`
                  and not a heading, so nothing about the document outline moves
                  at either width. */}
              <p className="text-micro uppercase text-text-secondary xl:hidden">Today</p>
              <h1 className="text-title text-text-primary">Nothing planned</h1>
              {/* § Tone of Voice — empty states describe what will appear, they
                  do not nudge. */}
              <p className="text-body text-text-secondary">
                Meals and sessions appear here once the week&rsquo;s plan covers today.
              </p>
            </header>
          </div>

          <div className={PAGE_ASIDE_COLUMN} data-column="aside">
            {/* Two copies, not three: there is no macro grid here for the ruler
                to move around, so the phone and the wide band share this one
                and the band above takes the cap. `xl:pt-0` in the shared string
                is what lands it level with the heading beside it. */}
            {base.timeline.length > 0 && rulerBelowCap}

            <Anytime items={base.anytime} date={base.date} walks={walks} />

            {settingsFootLink}
          </div>
        </div>

        {actions}
      </Screen>
    );
  }

  return (
    <Screen className={PAGE_ASIDE_GRID}>
      {/*
       * § Spacing & Layout's section rhythm is 30px between blocks, and that is
       * what this screen uses from 768px up. Below it the rhythm steps to 22 —
       * FUEL-82.
       *
       * 22 is on the guide's own base scale (4, 8, 12, 14, 20, 22, 26, 30), so
       * this is a step down the rhythm rather than an off-scale value invented
       * for one screen. It is scoped to `/` and to phones because that is where
       * the constraint is: 313px of the 667 is chrome, and three of these gaps
       * fall inside the 354px that leaves.
       *
       * At 1272 this wrapper stops generating a box — `PAGE_ASIDE_UNWRAP` —
       * and the three groups inside it become `<main>`'s grid items. That is
       * what lets one DOM serve both shapes: below the breakpoint the groups
       * are `display: contents` and this is the single flex column it has
       * always been, with the sections in the order they are written and the
       * rhythm above between them. Nothing is reordered at any width, which is
       * the whole reason the composition is grouped rather than placed.
       *
       * Three since FUEL-86, and the third is first: the header band spans both
       * columns above them. Everything in it is hidden below the cap, so the
       * phone's column is the same list of visible sections it was.
       */}
      <div className={`flex flex-col gap-[22px] md:gap-[30px] ${PAGE_ASIDE_UNWRAP}`}>
        {header}

        {/* The measure: the subject, the figures it is measured on, and — as a
            grid item below this group — the action bar. § Desktop, redrawn:
            "the measure keeps the meal, its four figures four-across, and the
            actions in a row, each sized to its content". The day's own totals
            left for the aside, which is the redraw's one real move on this
            screen: a grid saying the day's numbers and a grid saying the meal's
            were two identical four-figure grids stacked. */}
        <div className={PAGE_MEASURE_COLUMN} data-column="measure">
        <Subject
          item={now.active}
          at={now.active.at}
          swapped={activeMeal?.isOverride}
          name={activeMeal?.meal.name}
        />

        {rulerAbove}

        {activeMeal ? (
          <div className="flex flex-col gap-3">
            {/*
             * Two shapes, and CSS picks one — FUEL-82, the same arrangement
             * `/plan`'s week grid settled on in FUEL-81 and for the same reason.
             * The page is server-rendered into one HTML for every viewport, so a
             * `matchMedia` read would have the server guess a width and every
             * phone paint the wrong shape for a frame before hydration swapped
             * it. The cost is four extra cells in the DOM; the hidden shape is
             * `display: none`, so it is out of the accessibility tree and only
             * one grid is ever announced.
             *
             * Below 768px the meal and the day share one grid, because the fold
             * does not fit two — see `MealDayGrid`. At 768px and above there is
             * no fold to fit and the two named sections read better apart, which
             * is where `MealMacros` and `DayTotals` still render.
             */}
            <div className="md:hidden" data-shape="merged">
              <MealDayGrid
                meal={activeMeal.meal}
                totals={summariseDay(plannedToday)}
                target={target}
              />
            </div>

            <MealMacros
              meal={activeMeal.meal}
              className="hidden md:flex"
              data-shape="split"
            />

            {/*
             * The swap's state and its revert, together — FUEL-25. Gated on
             * `isOverride` rather than on the note: they describe the same
             * condition, but the control is about whether a row exists to
             * delete, and reading that off a sentence would make the criterion
             * depend on copy.
             */}
            <SwapNote
              note={note}
              onRevert={
                active && activeMeal.isOverride
                  ? () => act({ kind: "revert", item: active })
                  : undefined
              }
            />
          </div>
        ) : (
          <ExerciseList
            exercises={
              now.active.kind === "workout"
                ? (exercises.get(now.active.workout.workout.id) ?? [])
                : []
            }
          />
        )}

        </div>

        {/*
         * The aside — § Desktop, as FUEL-85 redrew it: "the aside takes the
         * day's totals, the day's own items with their status, and the Anytime
         * list". The zone's question is "what is the context?", and each of the
         * three answers a part of it — the day against target, the day itself,
         * and what can still be logged.
         *
         * The ruler left this column for the header band, where its question is
         * the band's. Up next stayed and stood down: `The day` contains its two
         * items and § Desktop's "say a thing once" decides between them.
         *
         * ## Nothing moves below the cap, and the order is why
         *
         * `DayTotals` is first, which is the position it already occupied: it
         * was the last section of the measure group and this group follows
         * immediately, so in the flat column below `xl` the sequence is
         * unchanged to the element. That is the whole trick of moving a section
         * between columns without moving it on a phone — the two groups are
         * `display: contents` there, so a section's column is decided by which
         * side of the boundary it is written on and its POSITION is decided by
         * the order of the whole list.
         *
         * Below 1272 the sequence reads: the figures, the ruler's phone copy,
         * Up next, Anytime, the foot link. Exactly as it did.
         */}
        <div className={PAGE_ASIDE_COLUMN} data-column="aside">
          {/* After the swap note, and that order is the argument: the note says
              what the swap cost, and these are the figures it cost it from.

              Hidden below 768px when there is a meal, because `MealDayGrid` in
              the measure is already carrying these four figures — FUEL-82. On a
              workout card there is no meal to merge into, so the section renders
              at every width and the day's numbers are still on the screen, which
              is the point `DayTotals` makes about being present on a session
              too. In the aside at the cap both cases are already visible, so
              FUEL-86 needed no third rule: `md:flex` is true at 1272. */}
          <DayTotals
            planned={plannedToday}
            target={target}
            className={activeMeal ? "hidden md:flex" : undefined}
          />

          {/* The phone's position for the ruler — see `rulerBelow`. Below the
              figures, because on the longest meal names one of the two has to go
              under the action bar and it should not be the numbers. */}
          {rulerBelow}

          <TheDay rows={theDay(base.timeline, progress.position, progress.entries)} />

          <UpNext items={now.upcoming} />

          <Anytime items={base.anytime} date={base.date} walks={walks} />

          {settingsFootLink}
        </div>
      </div>

      {actions}
      {sheet}
    </Screen>
  );
}
