"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  type ReactNode,
  startTransition,
  useOptimistic,
  useState,
  useSyncExternalStore,
} from "react";

import {
  clearSessionStatus,
  logExerciseSet,
  removeExerciseSet,
  setSessionStatus,
} from "@/app/actions/training";
import {
  ACTION_BAR_CONTROLS,
  ACTION_BAR_PRIMARY,
  ACTION_BAR_SECONDARY,
  ACTION_BAR_SPLIT,
  APP_ACTION_BAR,
  SESSION_ACTION_BAR,
} from "@/components/action-bar";
import { DotGrid, type Week } from "@/components/dot-grid";
import { ExerciseList, type ListedExercise } from "@/components/exercise-list";
import { SlashMeta } from "@/components/kv-grid";
import { PageMain } from "@/components/page-main";
import { RecentSessions } from "@/components/recent-sessions";
import { RestTimer } from "@/components/rest-timer";
import { Button } from "@/components/ui/button";
import { WalkRow } from "@/components/walk-row";
import { recentSessions, weekStanding } from "@/lib/adherence";
import { addDays, type CalendarDate } from "@/lib/date";
import type { WorkoutLogStatus } from "@/lib/db/schema";
import { type EnergyRange, sessionEnergy } from "@/lib/energy";
import { figure } from "@/lib/format";
import type { ResolvedFormMedia } from "@/lib/form-media";
import {
  PAGE_ASIDE_COLUMN,
  PAGE_ASIDE_GRID,
  PAGE_ASIDE_UNWRAP,
  PAGE_HEADER_BAND,
  PAGE_MEASURE_COLUMN,
  PAGE_MEASURE_FOOT,
} from "@/lib/frame";
import {
  currentExercise,
  type LoggedSet,
  type SetTarget,
  setProgress,
  setRows,
  setsFor,
  targetLabel,
} from "@/lib/exercise-set";
import { dayLabel } from "@/lib/now-display";

/**
 * The form sheet, kept out of this screen's first payload — § P10, FUEL-94.
 *
 * The ticket's criterion is that media is "never loaded on `/`", and this is
 * how it is met rather than asserted. `/` renders `exercise-list.tsx` and never
 * imports this module at all, so the requirement is already true there; what
 * `dynamic` adds is that `/training` does not pay for the sheet either until
 * somebody presses "Show form". The chunk holds the sheet, its Radix dialog and
 * the `<img>`/`<video>` decision — none of which is on the path to the screen's
 * 1.5s interactive target.
 *
 * `ssr: false` because there is nothing to render server-side: the sheet is
 * closed until a click, and prerendering a closed dialog is work for markup
 * nobody sees. `tests/unit/bundle-boundaries.test.ts` holds the `/` half.
 */
const FormMediaSheet = dynamic(
  () => import("@/components/form-media-sheet").then((m) => m.FormMediaSheet),
  { ssr: false },
);
import { sectionLabel, WORKING_SECTION, working } from "@/lib/section";
import { FOCUS_RING, HOVER_LINK } from "@/lib/pointer";
import { MAX_NOTE_LENGTH } from "@/lib/session-entry";
import { cn } from "@/lib/utils";

/**
 * The Training screen — PRD § P3, Brand Guide § Seven screens → Training.
 *
 * A date's session with its full exercise list, the three statuses it can be
 * given, an optional note and duration, and six weeks of adherence underneath.
 * Still deliberately not a workout tracker — but that sentence is narrower than
 * it was. § P10 reversed the per-set half of it (FUEL-89), so per-set entry is
 * here; what stays out is a progression engine, prescribed load increases,
 * personal records, and anything that decides what to do next.
 *
 * ## Two states, and why the second is a state rather than a route
 *
 * Brand Guide § Desktop, "The two states of `/training`" (FUEL-90). This screen
 * is a checklist you read BEFORE and AFTER, and a surface you operate DURING,
 * and those are two compositions:
 *
 *   - the PLAN state holds the whole list, the session's record, and set
 *     progress as slash metadata on each exercise's own row;
 *   - the SESSION state holds the exercise you are on and its sets, with the
 *     rest of the list moving to the aside at ≥1272 where there is room for it.
 *
 * The alternative — sets expanding in place under the row you are working — is
 * an accordion, which § Progressive Disclosure has banned by name since long
 * before this milestone. So the second state is a consequence rather than a
 * preference.
 *
 * A state and not a route: § Navigation allows two levels, `/` already carries
 * three states, and a session behind a URL is a URL that means nothing the next
 * day. Only TODAY has one — a past date is a record, which is the same refusal
 * `actions/training.ts` already makes at the other end of the calendar.
 *
 * The current exercise is DERIVED — the first whose sets are incomplete, read
 * off the rows themselves. That is the schema's own "derive from an absolute,
 * never accumulate", and it makes a phone locked mid-session and woken twenty
 * minutes later resume where the data says it is. The only thing stored on the
 * client is whether the state is entered at all: one boolean in `localStorage`.
 *
 * ## Why it is a screen of its own and not a branch of `/`
 *
 * The mock is drawn at `/`, and `right-now.tsx` does already render a session's
 * exercise list when the active item is one. Three things moved it here:
 *
 *   1. § The Four Rules #4 splits the two signature graphics by time-scale and
 *      says they "never appear as alternatives to each other on the same
 *      screen". `/` carries the day ruler. The dot grid cannot go there.
 *   2. "Past sessions are viewable and editable by date" needs an addressable
 *      date. `/` holds its position in a COOKIE, deliberately — `lib/cursor.ts`
 *      argues why — and a cookie is not a place you can navigate to.
 *   3. A date is a place, so it belongs in the URL, exactly as `/plan?week=`
 *      put a week there: back works, the page can be shared, and prev/next as
 *      `<Link>`s are prefetched and need no client state to move.
 *
 * ## Given its day rather than resolving one
 *
 * No database handle, no session, no clock: `queries/training.ts` does all
 * three and `app/training/page.tsx` is the wire between them. That split is
 * what makes this file testable — every criterion here is about what ends up
 * on the screen.
 *
 * ## Optimistic, for the same 300ms as everywhere else
 *
 * § Feedback is "optimistic by default", so a status lands on the frame it is
 * tapped and the banner reverts it if the server refuses. The note and the
 * duration travel WITH the status rather than saving separately — § Progressive
 * Disclosure's one question per screen, which here is "how did that session
 * go": a status saved apart from the sentence explaining it would make closing
 * the app after tapping Partial lose the half that said why.
 */

/* -------------------------------------------------------------------------- */
/* What the screen is given                                                   */
/* -------------------------------------------------------------------------- */

/** What was recorded against a session. Absent until something is. */
export type SessionEntryView = {
  status: WorkoutLogStatus;
  note: string | null;
  durationMin: number | null;
};

/**
 * One of the date's items, narrowed to what this screen draws.
 *
 * `entryId` is the template entry, never the workout, and it is the only id
 * that crosses back on a write — see `actions/training.ts`. A rotated day's
 * workout changes with the date, so the entry is the stable thing to name.
 */
export type TrainingItem = {
  entryId: string;
  name: string;
  /**
   * `workouts.type` — the slash line under the name.
   *
   * The type and not `workouts.description`, which the seed fills with the
   * session's whole protocol: a warm-up, a format, a cool-down, several hundred
   * words of markdown. That is a document, and § Progressive Disclosure allows
   * it a sheet or a screen of its own but not a slash line — one question per
   * screen, and this screen's question is how the session went. The exercise
   * rows below carry the per-exercise guidance, which is the part needed mid-set.
   *
   * An open vocabulary: schema.ts keeps `type` as text so the gym restart adds
   * rows rather than a migration, and says outright that "the UI must handle a
   * value it does not recognise". This one prints whatever it is given.
   */
  type: string;
  /** The walk is offered as a row; a session is what the actions act on. */
  kind: "session" | "walk";
  exercises: readonly TrainingExercise[];
  entry: SessionEntryView | null;
  /**
   * The sets performed against this session on this date — § P10, FUEL-91.
   *
   * Empty for every session before this ticket and for every one nobody logged
   * a set against, which is the same array and deliberately so: PRD § P10 asks
   * that "existing sessions render identically and need no backfill", and an
   * absent set list is not a state this screen distinguishes from an empty one.
   */
  sets: readonly LoggedSetView[];
};

/**
 * An exercise as this screen needs it: the row `/` also draws, plus the
 * structured target the sub-list compares a set against.
 *
 * The target rather than the prescription, which stays exactly what it was —
 * rendered verbatim, never parsed. See schema.ts on why these are columns.
 */
export type TrainingExercise = ListedExercise &
  SetTarget & {
    /**
     * Form reference media, already resolved — § P10, FUEL-94.
     *
     * A `ResolvedFormMedia` or `null`, never a stored string: `page.tsx` runs
     * `resolveFormMedia` at the boundary, so an unrecognised `media_key` has
     * become `null` before this type exists. That is what lets the session state
     * decide whether to draw the affordance by testing for null, with no notion
     * of a path and nothing to validate.
     *
     * `null` for most exercises, and the plan list never reads it: the affordance
     * is the session state's alone (FUEL-90's ruling), because FUEL-92's group
     * headings spent the plan list's row budget.
     */
    media: ResolvedFormMedia | null;
  };

/** One set, narrowed to what the sub-list draws. */
export type LoggedSetView = LoggedSet & { exerciseId: string };

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** Micro eyebrow above a section — 14px to its content, § Spacing & Layout. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="text-micro uppercase text-text-secondary">{children}</h2>;
}

const STATUS_LABEL: Record<WorkoutLogStatus, string> = {
  done: "Done",
  partial: "Partial",
  skipped: "Skipped",
};

/**
 * Prev, this date, next — and the way back to today.
 *
 * `<Link>`s rather than buttons, exactly as `/plan`'s week navigation is: the
 * date is a real destination, so back works and Next prefetches the neighbours.
 * The chevrons are decorative and the accessible name is the day each one leads
 * to, because "previous" alone tells a screen-reader user nothing about where
 * they would land.
 *
 * "Today" appears only when the screen is not already showing it. A control
 * that takes you where you are is a control that does nothing.
 */
function DateNav({ date, today }: { date: CalendarDate; today: CalendarDate }) {
  const previous = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    // Full width below the frame's cap, where this is a section of the measure
    // and `justify-between` puts Prev and Next at its two edges. In the header
    // band it is a flex item sized to its content, so the spread has nothing to
    // spread and the three parts sit together at the left of the band with the
    // mock's 20px between them — the week's standing takes the right.
    <nav aria-label="Date" className="flex items-center justify-between gap-3 xl:gap-5">
      <Link
        href={`/training?date=${previous}`}
        aria-label={`Previous day, ${dayLabel(previous)}`}
        className={`text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
      >
        <span aria-hidden="true">&lsaquo; Prev</span>
      </Link>

      {/*
       * Live, because the label changes on navigation while focus stays on the
       * link that moved it — without this a screen-reader user would hear
       * nothing about where they had arrived. `/plan`'s week label does the
       * same, for the same reason.
       */}
      <p aria-live="polite" className="text-body tabular-nums text-text-primary">
        {dayLabel(date)}
        {date === today && <span className="text-text-tertiary"> · Today</span>}
      </p>

      {date === today ? (
        /*
         * Today is where forward stops. A future session cannot have happened,
         * and a screen that offered to record one would be inviting a row the
         * user would then have to notice and take back. Held as an inert span
         * rather than a disabled button so the three-part row keeps its widths:
         * `aria-hidden`, because a control that does nothing should not be
         * announced as one.
         */
        <span aria-hidden="true" className="text-micro uppercase text-text-tertiary">
          Next &rsaquo;
        </span>
      ) : (
        <Link
          href={`/training?date=${next}`}
          aria-label={`Next day, ${dayLabel(next)}`}
          className={`text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
        >
          <span aria-hidden="true">Next &rsaquo;</span>
        </Link>
      )}
    </nav>
  );
}

/**
 * The session, at 40px, with whatever the library says about it underneath.
 *
 * The eyebrow, the Title and the slash line are the guide's 7× scale contrast —
 * 40px against 10.5px — and the name has the row to itself at the size that
 * makes it readable at arm's length, which is where a phone is during a set.
 */
function Subject({ item }: { item: TrainingItem }) {
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>{item.kind === "walk" ? "Walk" : "Training"}</Eyebrow>
      <h1 className="text-title text-text-primary">{item.name}</h1>
      <SlashMeta>{item.type}</SlashMeta>
    </div>
  );
}

/**
 * What is recorded, as a sentence.
 *
 * § Accessibility's "never colour alone" and § The Governing Principle's "a
 * missed workout and a completed workout are rendered with the same visual
 * weight — only the status label differs", taken literally: skipped and done
 * are the same type, the same colour and the same row. What differs is the
 * word.
 *
 * `role="status"` — a polite live region — so a status set by a tap is
 * announced without moving focus. The optimistic value is what is read, which
 * is the point: it is what the screen is showing.
 */
function Recorded({ entry }: { entry: SessionEntryView | null }) {
  return (
    <p role="status" className="text-body text-text-secondary">
      {entry ? (
        <>
          <span className="text-text-primary">{STATUS_LABEL[entry.status]}</span>
          {entry.durationMin !== null && (
            <span className="tabular-nums"> · {entry.durationMin} min</span>
          )}
        </>
      ) : (
        // § Tone of Voice: an empty state describes what will appear rather
        // than nudging. Not "You haven't logged this yet!".
        "Not recorded."
      )}
    </p>
  );
}

/**
 * What the session is estimated to have cost — § P10's energy figure, FUEL-95.
 *
 * A `SlashMeta` under the record, which is § Content Guidelines' device for a
 * secondary fact and the whole of "presented as an estimate, not drawn with the
 * weight of a measured figure". No new device is invented for it: § Data Display
 * gives Display type to "the one number a screen is about", and this screen is
 * about whether the session happened. No colour either — § Semantic Colors spends
 * its one umber element per screen elsewhere, and a modelled figure is the last
 * thing that should be the brightest on the page.
 *
 * "Estimated" in full rather than "Est.", because § Tone of Voice asks for plain
 * and direct and the line has the room at 375px. The word is doing the
 * acceptance criterion's work, so it is not the place to save four characters.
 *
 * A null range renders NOTHING — no line, no placeholder, no "unavailable". The
 * method has nothing to say about a session with an unrecognised type or with no
 * evidence of how long it took, and § Tone of Voice refuses to describe an
 * absence as a failure. `lib/energy.ts` argues why a zero would be worse than
 * silence.
 *
 * ## The plan state only, and deliberately
 *
 * This sits in the "This session" block, which the session state does not draw.
 * Usually the point is moot — mid-session nobody has written a duration down
 * yet, so the range is null anyway — but not always: a duration saved before
 * entering the session state would produce a figure the working surface does not
 * show. That is the right way round. PRD § P3's criterion is re-aimed along the
 * states, and "the active exercise is what is visible when you are working"
 * spends that window on the sets being performed. An estimate of what the
 * session cost is a thing to read after it, which is exactly when the plan
 * state is what you are looking at.
 */
function Estimate({ range }: { range: EnergyRange | null }) {
  if (!range) return null;

  return (
    <SlashMeta>
      <span className="tabular-nums">{`Estimated ${figure(range.lowKcal)}–${figure(
        range.highKcal,
      )} kcal`}</span>
    </SlashMeta>
  );
}

/**
 * The sets performed against one exercise — Brand Guide § Lists, "Sub-lists".
 *
 * "A sub-list is the 46px dense row, indented to its parent's content column,
 * and it appears only where its parent is the screen's subject." The indent is
 * 30px because that is the parent row's own content column: the ordinal's 18px
 * plus the row's 12px gap. One level, and never nested inside a row of another
 * list — that is the accordion § Progressive Disclosure bans, and it is banned
 * geometrically as well as by name.
 *
 * ## The row is an ordinal, a reps figure and one control
 *
 * The mock draws the figure as text — `8 reps` for a set performed, `Target 8`
 * for one still offered. Here it is an input holding that same number, because
 * the acceptance criteria ask for sets to be CORRECTABLE and because an
 * exercise with no structured target has no number to tick at: a plank has
 * three sets and no rep count, and '8–12 rounds — 40 sec on / 40 sec off' has
 * neither. At rest the row reads as the mock draws it; the difference is only
 * that the figure can be typed into.
 *
 * The tick is the one control, and it means the same thing in both directions:
 * a set is logged or it is not. Correcting a logged set is the input, committed
 * when it loses focus, and untapping the tick is what removes it.
 *
 * ## What the tick does with an empty box
 *
 * It falls back to the target's low rep, which is what "Target 8" is offering.
 * Without a target and without a typed number there is nothing to record, so the
 * control is disabled — the alternative is a button that reports a refusal for a
 * value the reader never entered.
 */
function SetList({
  exercise,
  logged,
  drafts,
  onDraft,
  onLog,
  onRemove,
}: {
  exercise: TrainingExercise;
  logged: readonly LoggedSet[];
  drafts: ReadonlyMap<string, string>;
  onDraft: (setIndex: number, value: string) => void;
  onLog: (setIndex: number, reps: number) => void;
  onRemove: (setIndex: number) => void;
}) {
  const target = targetLabel(exercise);

  return (
    // 30px — the parent row's content column. § Lists gives the figure and this
    // is where it is spent; `exercise-list.tsx` draws the 18px ordinal and the
    // 12px gap that add up to it.
    <ol className="ml-[30px] flex flex-col">
      {setRows(exercise, logged).map((row) => {
        const key = `${exercise.id}#${row.index}`;
        // The typed value if there is one, otherwise what is stored. An empty
        // string is a real draft — it is how a box is cleared — so the fallback
        // is on the key's absence rather than on the value being falsy.
        const draft = drafts.get(key);
        const value = draft ?? (row.reps === null ? "" : String(row.reps));
        const typed = Number(value);
        const entered = value !== "" && Number.isInteger(typed);
        // What the tick would record: what is in the box, or the target it is
        // offering. `null` is a control with nothing to write.
        const wouldLog = entered ? typed : exercise.targetRepsLow;

        return (
          <li
            key={key}
            className="flex min-h-[46px] items-center gap-3 border-t border-border py-[11px] first:border-t-0"
          >
            <span className="w-[18px] shrink-0 font-mono text-slash text-text-tertiary">
              {String(row.index).padStart(2, "0")}
            </span>

            <span className="flex flex-1 items-center gap-2">
              <input
                // The label is the ordinal beside it, which is decorative to a
                // screen reader — a bare "01" says nothing about what the box
                // holds. § Accessibility asks for a name, not a position.
                aria-label={`Set ${row.index} reps`}
                value={value}
                /*
                 * Digits only, stripped as they arrive — the identical
                 * treatment the duration box takes above, for the identical
                 * reason: `inputMode` asks for a numeric keypad and does not
                 * stop a paste, and "1e2" reaching `Number()` as `NaN` would
                 * render as a set of NaN reps while the request was in flight.
                 */
                onChange={(event) =>
                  onDraft(row.index, event.target.value.replace(/\D/g, ""))
                }
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || wouldLog === null) return;

                  // A number typed and confirmed is a set logged, so the reader
                  // never has to reach for the tick to commit what they just
                  // wrote. The tick stays the way back.
                  event.preventDefault();
                  onLog(row.index, wouldLog);
                }}
                onBlur={() => {
                  // Only a CORRECTION commits here — a row already logged whose
                  // number changed. An unlogged row committing on blur would
                  // mean tapping anywhere on the screen after typing a number
                  // recorded a set nobody confirmed.
                  if (row.reps === null || !entered || typed === row.reps) return;

                  onLog(row.index, typed);
                }}
                inputMode="numeric"
                // Three digits, and `MAX_REPS` is three digits: the box cannot
                // hold a value the action would refuse.
                maxLength={3}
                className="h-11 w-14 rounded-md border border-border bg-surface px-2 text-body tabular-nums text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                placeholder={
                  exercise.targetRepsLow === null ? "" : String(exercise.targetRepsLow)
                }
              />
              {/* The mock's two states, in words: `8 reps` for a set performed
                  and `Target 8` for one still on offer. An exercise with no rep
                  target says neither and just names the unit. */}
              <span className="text-slash text-text-tertiary">
                {row.reps === null ? (target ?? "reps") : "reps"}
              </span>
            </span>

            <button
              type="button"
              // 44px of target around an 18px mark — § Touch Targets' minimum,
              // which names no posture and so carries to every width. The
              // negative margin pulls the box's edge back to the row's, so the
              // mark lands where the mock draws it rather than 13px inside it.
              className={`-mr-[13px] flex h-11 w-11 shrink-0 items-center justify-center ${FOCUS_RING}`}
              aria-label={
                row.reps === null ? `Log set ${row.index}` : `Remove set ${row.index}`
              }
              // One control with two states rather than two controls — the
              // reason `Recorded`'s three status buttons carry it too.
              aria-pressed={row.reps !== null}
              disabled={row.reps === null && wouldLog === null}
              onClick={() => {
                if (row.reps !== null) {
                  onRemove(row.index);

                  return;
                }

                if (wouldLog !== null) onLog(row.index, wouldLog);
              }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-[18px] rounded-[4px] border border-border",
                  // Ink rather than umber. § The Four Rules allows one accent
                  // element per screen and the day's dot has it; a filled tick
                  // is a mark, which is what the dot grid's own filled dots are.
                  row.reps !== null && "border-text-primary bg-text-primary",
                )}
              />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The rest of the session, beside the exercise being worked — § Desktop.
 *
 * "At ≥1272 the two states are one composition. The measure swaps its contents;
 * the aside gains the rest of the list above what it already holds. The current
 * row is marked by WEIGHT rather than colour — the rows behind it recede to
 * `text-secondary` and it does not."
 *
 * This is the FIRST implementation of that device, not a reuse. § Desktop
 * carried an attribution to `recent-sessions.tsx` from v4.7 until FUEL-90
 * withdrew it: that component marks its viewed row with a `· Viewing` suffix,
 * `aria-current="page"` and the absence of a link — the current row loses the
 * hover ground, the others do not lose their weight. Nothing in `src/` recedes
 * a list's other rows.
 *
 * `aria-current="step"` is what carries the same fact to a screen reader, and
 * it is not optional: a distinction made by weight alone is a distinction made
 * by rendering alone, which is § Accessibility's objection to colour restated.
 * The exercise's name is also the measure's `h1`, so it is said in words too.
 *
 * The rows are not links and have no hover ground, which matters more than it
 * looks: § Accessibility requires 4.5:1 for body text and `text-secondary`
 * measures 4.26:1 on the hover ground. A receded row on the canvas is fine; the
 * same row on a tinted ground would not be.
 */
function SessionList({
  exercises,
  sets,
  currentId,
}: {
  exercises: readonly TrainingExercise[];
  sets: readonly LoggedSetView[];
  /**
   * The exercise the measure is showing, BY ID — § P10, FUEL-92.
   *
   * An id and not an index, because this list and the one the index came from
   * are no longer the same list. The measure steps through the WORKING rows;
   * this aside holds the rest of the session, warm-up and cool-down included,
   * because that is what § Desktop means by "the rest of the list". An index
   * into the first, read against the second, marks the wrong row — with the
   * seed's circuit it lands on "Joint prep" while the measure shows "Squats".
   *
   * That is not a bug a test here would have caught either: jsdom has no width
   * and this column is `hidden` below the cap, and the screen baselines
   * photograph the plan state rather than this one. Identity removes the class
   * of fault rather than correcting one instance of it — there is no index to
   * translate, so there is nothing to get wrong the next time the two lists
   * diverge.
   *
   * `undefined` for a session with no current exercise, which marks no row.
   */
  currentId: string | undefined;
}) {
  return (
    <ol className="flex flex-col">
      {exercises.map((exercise) => {
        const logged = setsFor(exercise.id, sets);
        const isCurrent = exercise.id === currentId;

        return (
          <li
            key={exercise.id}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-h-[44px] items-baseline justify-between gap-3 border-b border-border py-[10px] last:border-b-0"
          >
            <span
              className={cn(
                "text-body",
                isCurrent ? "text-text-primary" : "text-text-secondary",
              )}
            >
              {exercise.name}
            </span>
            {/* What was done, or what is asked for. The prescription is the
                fallback rather than a blank, so a row nobody has reached yet
                still says what it wants — and it is rendered verbatim here as
                everywhere else. */}
            <span
              className={cn(
                "shrink-0 text-slash tabular-nums",
                isCurrent ? "text-text-secondary" : "text-text-tertiary",
              )}
            >
              {setProgress(exercise, logged) ?? exercise.prescription}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A tap, in the form a retry needs.
 *
 * "Try again" has to re-run the SAME thing that failed, so a failure is stored
 * as the attempt rather than as a message — `right-now.tsx`'s arrangement, and
 * the banner hands it straight back to the handler.
 *
 * The fields are carried on the attempt rather than read from state at retry
 * time, so a retry writes what was refused and not what the boxes happen to
 * hold a minute later.
 */
type Attempt =
  | { kind: "record"; status: WorkoutLogStatus; note: string; duration: string }
  | { kind: "clear" }
  | { kind: "log-set"; exerciseId: string; setIndex: number; reps: number }
  | { kind: "remove-set"; exerciseId: string; setIndex: number };

/** The two that move a row of the sub-list rather than the session's record. */
type SetAttempt = Extract<Attempt, { kind: "log-set" | "remove-set" }>;

/** § Tone of Voice: name what happened. Never "Something went wrong". */
function banner(failure: Attempt): string {
  switch (failure.kind) {
    case "clear":
      return "Couldn’t clear that.";
    // Named apart from the session's own record, because they are different
    // things to have lost: one is a status, and this is a set the reader just
    // performed and would otherwise re-enter blind.
    case "log-set":
      return "Couldn’t save that set.";
    case "remove-set":
      return "Couldn’t remove that set.";
    default:
      return "Couldn’t save that.";
  }
}

/**
 * Where the session state remembers that it is entered — Brand Guide § Desktop.
 *
 * "The only client state is whether the session state is entered at all: one
 * boolean, in `localStorage`, keyed to the date and wrapped in try/catch like
 * every other read of it. It writes no row."
 *
 * Keyed to the date so that entering Wednesday's session does not open
 * Thursday's, and read only for today — a past date has no session state at
 * all, so a key left behind by a date that has passed is unreachable rather
 * than stale. They accumulate at about thirty bytes a training day, which is
 * the reason this is not worth a reaper.
 *
 * Every access is wrapped: `localStorage` throws outright in a Safari private
 * window and in any browser set to block site data, and a screen that cannot
 * render because it could not remember a boolean is a worse answer than one
 * that opens in the plan state.
 */
const SESSION_KEY = (date: CalendarDate) => `fuel:training-session:${date}`;

/**
 * `localStorage` is an external store, and this is how React reads one.
 *
 * `useSyncExternalStore` rather than a `useState` seeded in an effect. The
 * effect version is what this was first written as, and the lint rule that
 * refused it is right: a `setState` in an effect body is a second render pass
 * on every mount, and the hook exists precisely so that a value living outside
 * React does not need one.
 *
 * `getServerSnapshot` is `false` — the server has no `localStorage`, and a
 * screen rendered on it is a screen in the plan state. That is also what makes
 * the resumption safe rather than a hydration mismatch: React renders the
 * server's snapshot, hydrates against it, and then switches to the client's.
 *
 * The `storage` event is subscribed to as well, so a session entered in another
 * tab is not a tab left showing a stale composition of the same date. It does
 * not fire in the tab that made the change, which is what `emit` is for.
 */
const listeners = new Set<() => void>();

function subscribeToStorage(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readEntered(date: CalendarDate): boolean {
  try {
    return window.localStorage.getItem(SESSION_KEY(date)) === "1";
  } catch {
    return false;
  }
}

function rememberEntered(date: CalendarDate, entered: boolean): void {
  try {
    if (entered) window.localStorage.setItem(SESSION_KEY(date), "1");
    else window.localStorage.removeItem(SESSION_KEY(date));
  } catch {
    // Nothing to do and nothing to say: the state still works for as long as
    // the page is open, and a reload starts it in the plan state.
  }

  for (const listener of listeners) listener();
}

/** One identity for "no sets", so the optimistic base does not change per render. */
const NO_SETS: readonly LoggedSetView[] = [];

/**
 * The screen for one date.
 *
 * @param sessions the date's items in template order — the session first, the
 *   walk after it, exactly as `resolveTraining` returns them. Order is the
 *   template's and is not re-sorted here; `lib/seed/plan.ts` gives the walk
 *   `sortOrder: 1` on days that have a session precisely so it lands second.
 */
export function Training({
  date,
  today,
  sessions,
  adherence,
  bodyweightKg,
}: {
  date: CalendarDate;
  today: CalendarDate;
  sessions: readonly TrainingItem[];
  /** Six weeks of dots from `lib/adherence.ts`. */
  adherence: Week[];
  /**
   * The weigh-in nearest the VIEWED date — `lib/energy.ts`'s `nearestWeight`,
   * resolved in `queries/training.ts` against this date and no other.
   *
   * One number rather than a history, and already addressed to the date, so
   * nothing here can cost a past session at today's weight by forgetting to.
   */
  bodyweightKg: number;
}) {
  /*
   * The session is what the BAR's actions act on. The walk is on the template
   * every day and has its own row with its own one-tap log (FUEL-29), written
   * through `actions/log-walk.ts`; `actions/training.ts` still refuses it, so
   * the three statuses, the note and the duration field below can never be
   * pointed at a row this screen renders as a row.
   *
   * KNOWN LIMITATION: a date with TWO sessions renders only the first, and the
   * second is dropped with no sign of it. Nothing in the schema forbids two
   * non-walk entries on one weekday — `training_template_entries` has no unique
   * constraint on `(user_id, day_of_week)` and could not have one, since the
   * walk shares every day with a session. PRD § P3 describes one session a day
   * and the seed schedules one, so the case does not arise today.
   *
   * It is recorded rather than handled because handling it is a product
   * question this task cannot answer alone: with two sessions, "Mark done" has
   * to say WHICH, and that is a second action bar or a selection model rather
   * than a fix. `lib/adherence.ts` makes the same first-session choice for the
   * same reason, and schema.ts records the identical shape of gap for the
   * seed's second snack, which `resolveSlot` also never surfaces.
   */
  const session = sessions.find((item) => item.kind === "session");
  const walk = sessions.find((item) => item.kind === "walk");

  const recorded = session?.entry ?? null;

  const [note, setNote] = useState(recorded?.note ?? "");
  // A string, not a number: the box has an empty state and `null` is not a
  // thing an input can hold. Parsing happens once, at the edge, in
  // `session-entry.ts` — which has to parse it anyway, since a Server Action is
  // reachable by anyone who can POST.
  const [duration, setDuration] = useState(
    recorded?.durationMin == null ? "" : String(recorded.durationMin),
  );
  const [failure, setFailure] = useState<Attempt | null>(null);

  /**
   * What is typed in the sub-list's rep boxes but not yet recorded, keyed
   * `exerciseId#setIndex`.
   *
   * Not in `SetList`, because it has to survive that component being handed a
   * different exercise: the current exercise is derived, so logging the last
   * set of one moves the screen to the next, and state living inside the row
   * would be lost on the same frame it was used. Cleared per key once the
   * server has the number, so the stored value takes over — and cleared on a
   * removal too, or a row would show a figure with an untouched tick beside it.
   */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());

  /**
   * Whether the session state is entered — the one thing this screen stores.
   *
   * Read from the browser rather than held here, so a reload mid-session comes
   * back to the same composition and nothing about it can go stale against the
   * rows: everything else the state shows is derived from the sets themselves.
   * See `subscribeToStorage` for why this is not a `useState` in an effect.
   */
  const entered = useSyncExternalStore(
    subscribeToStorage,
    () => readEntered(date),
    () => false,
  );

  // What the screen says is recorded, before the server has answered. One
  // optimistic value covering the whole entry, so a status and the note that
  // explains it cannot revert independently.
  const [entry, apply] = useOptimistic(
    recorded,
    (_current: SessionEntryView | null, next: SessionEntryView | null) => next,
  );

  /**
   * The date's sets, as the screen believes them — § Feedback's 300ms, applied
   * to a tick.
   *
   * A list rather than one value, unlike the entry above, because a set is not
   * a correction of the set beside it: two rows can be in flight at once and
   * each has to revert on its own. The reducer is an upsert and a delete over
   * the same address the database uses, so the optimistic answer and the stored
   * one are the same shape and the same rule.
   *
   * This is also what advances the screen. The current exercise is derived from
   * these rows, so the last set of an exercise moves the subject to the next one
   * on the frame it is ticked rather than on the render after the server agrees.
   */
  const [sets, applySet] = useOptimistic(
    session?.sets ?? NO_SETS,
    (current: readonly LoggedSetView[], attempt: SetAttempt) => {
      const rest = current.filter(
        (set) =>
          !(set.exerciseId === attempt.exerciseId && set.setIndex === attempt.setIndex),
      );

      return attempt.kind === "remove-set"
        ? rest
        : [
            ...rest,
            {
              exerciseId: attempt.exerciseId,
              setIndex: attempt.setIndex,
              reps: attempt.reps,
            },
          ];
    },
  );

  /**
   * What this session cost, from what the screen currently believes — FUEL-95.
   *
   * Computed HERE, from the optimistic `entry` and `sets`, rather than on the
   * server. `/training` revalidates nothing — there is no `router.refresh()` and
   * no `revalidatePath` behind either action — so a figure resolved during the
   * render would stay frozen at the duration the page loaded with, and a reader
   * who typed 30 into the box and saved would watch the estimate not appear.
   *
   * It follows the RECORD and not the draft: `entry.durationMin` is what was
   * saved, not what is typed in the duration box. An estimate that moved per
   * keystroke would be a live readout, and this is a fact about a session that
   * has been logged.
   *
   * `lib/energy.ts` is pure and imports no pg-core precisely so this is
   * possible — the contract every module this component already imports keeps.
   */
  const energy = session
    ? sessionEnergy({
        type: session.type,
        exercises: session.exercises,
        sets,
        durationMin: entry?.durationMin ?? null,
        weightKg: bodyweightKg,
      })
    : null;

  const act = (attempt: Attempt) => {
    // Unreachable through the screen — every control below is inside a branch
    // that has a session — and a guard rather than a `!` so it stays that way.
    if (!session) return;

    setFailure(null);

    startTransition(async () => {
      if (attempt.kind === "log-set" || attempt.kind === "remove-set") {
        applySet(attempt);

        const result =
          attempt.kind === "log-set"
            ? await logExerciseSet({
                date,
                entryId: session.entryId,
                exerciseId: attempt.exerciseId,
                setIndex: attempt.setIndex,
                reps: attempt.reps,
              })
            : await removeExerciseSet({
                date,
                entryId: session.entryId,
                exerciseId: attempt.exerciseId,
                setIndex: attempt.setIndex,
              });

        if (!result.ok) setFailure(attempt);

        return;
      }

      apply(
        attempt.kind === "clear"
          ? null
          : {
              status: attempt.status,
              note: attempt.note.trim() || null,
              durationMin: attempt.duration === "" ? null : Number(attempt.duration),
            },
      );

      const result =
        attempt.kind === "clear"
          ? await clearSessionStatus({ date, entryId: session.entryId })
          : await setSessionStatus({
              date,
              entryId: session.entryId,
              status: attempt.status,
              note: attempt.note,
              durationMin: attempt.duration,
            });

      // The optimistic value has already reverted by the time this renders —
      // the transition ending is what discards it — so the banner reports a
      // screen that is back where it started.
      if (!result.ok) setFailure(attempt);
    });
  };

  const record = (status: WorkoutLogStatus) =>
    act({ kind: "record", status, note, duration });

  /**
   * Whether this date can be trained rather than merely read.
   *
   * Today, a session rather than the walk, and something to work through.
   * § Desktop: "Only today has one. A past date is a record, which is what the
   * paginator is for; you cannot start Tuesday's session on Thursday." The
   * refusal lives here rather than in the action, because it is a rule about
   * this composition and not about the row — see `logExerciseSet`.
   *
   * "Something to work through" means the WORKING rows since FUEL-92, and the
   * distinction is the whole reason this line changed. Until sections existed
   * the two were the same set. Now a session could hold rows and no work — a
   * mobility day is warm-up rows and nothing else — and counting those would
   * offer Start session for a state that has no exercise to show: `currentEx`
   * would be `undefined`, the measure would fall back to the plan list, and the
   * reader would be left inside the session chrome with the list they started
   * from and no way out but recording a status.
   *
   * So this is the invariant the composition below relies on: `canEnter`
   * implies `currentEx` exists. No seeded workout can break it — all three have
   * working rows — which is exactly why it needs stating rather than trusting.
   */
  /**
   * The rows the session is WORKED through — § P10, FUEL-92.
   *
   * The working section and nothing else. A warm-up is done or not done: three
   * sets of a hip opener is not information anybody wants recorded, and offering
   * rep entry against one is the mistake `workout_exercises.section` exists to
   * prevent. So the session state steps through these, the position reads
   * against these, and the plan state's set progress is derived from these.
   *
   * A session with no sections is entirely working rows, so this is the whole
   * list for every session stored before the column existed — which is what
   * keeps this screen's behaviour unchanged for them.
   *
   * Declared above `canEnter` because that rule depends on it — see below.
   */
  const workingExercises = working(session?.exercises ?? []);

  const canEnter =
    session !== undefined && date === today && workingExercises.length > 0;

  const inSession = entered && canEnter;

  const enter = () => rememberEntered(date, true);

  /**
   * Leaves the state, and records the session on the way out.
   *
   * PRD § P10: the state is "entered and left by the primary". All three
   * controls leave, not only Mark done — a session marked partial or skipped is
   * a session that has stopped, and leaving the reader inside a surface for
   * operating a session they have just said is over would be a state with no
   * way out but the same three buttons.
   */
  const finish = (status: WorkoutLogStatus) => {
    record(status);
    rememberEntered(date, false);
  };

  /**
   * Which exercise the session state is showing, and the rows under it.
   *
   * Derived from the optimistic sets, so it moves on the frame the last set of
   * an exercise is ticked. `currentExercise` carries the rule and the reason it
   * is a derivation rather than a stored cursor.
   */
  const current = session ? currentExercise(workingExercises, sets) : -1;
  const currentEx = workingExercises[current];

  /*
   * Which exercise the form sheet is open FOR — § P10, FUEL-94.
   *
   * An id rather than a boolean, and that is the whole of the reset logic.
   * `currentEx` is derived from the sets, so ticking the last set of an exercise
   * moves the subject on the same frame. A boolean would survive that move and
   * leave the sheet open over the NEXT exercise, showing one movement under
   * another one's name — and it would happen at exactly the moment the reader
   * is looking away from the phone, which is what the whole state is for.
   *
   * Comparing against the current id closes it by construction instead. No
   * effect, nothing to keep in sync, and the impossible state is unrepresentable
   * rather than merely unreached.
   */
  const [formFor, setFormFor] = useState<string | null>(null);
  const formOpen = formFor !== null && formFor === currentEx?.id;
  const setFormOpen = (open: boolean) =>
    setFormFor(open && currentEx ? currentEx.id : null);

  const draft = (exerciseId: string, setIndex: number, value: string) =>
    setDrafts((previous) => new Map(previous).set(`${exerciseId}#${setIndex}`, value));

  const forget = (exerciseId: string, setIndex: number) =>
    setDrafts((previous) => {
      const next = new Map(previous);

      next.delete(`${exerciseId}#${setIndex}`);

      return next;
    });

  /**
   * Set progress for the plan state's rows, in one pass over the date's sets.
   *
   * Built for the session rather than per row — `exercise-list.tsx` takes a map
   * for this reason — and from the optimistic sets, so a set logged in the
   * session state is already counted when the reader leaves it.
   *
   * Over the working rows only (FUEL-92). A warm-up row logs no sets, so it has
   * no progress to report, and a "0 of 3 sets" under a mobility drill would be
   * an absence reported about a row that was never going to have one.
   */
  const progress = new Map<string, string>();

  for (const exercise of workingExercises) {
    const label = setProgress(exercise, setsFor(exercise.id, sets));

    if (label) progress.set(exercise.id, label);
  }

  /*
   * Whether the boxes hold something the server has not been told.
   *
   * Only offered once a status exists, because before that the note has a
   * control already: it travels with whichever status button is tapped. After
   * that, a note edited on its own would otherwise have no way to be saved
   * short of re-tapping a status — which looks like it would change something
   * else.
   */
  const dirty =
    entry !== null &&
    ((note.trim() || null) !== entry.note ||
      (duration === "" ? null : Number(duration)) !== entry.durationMin);

  /*
   * The right of the header band — FUEL-86.
   *
   * Read off the same six weeks the dot grid draws, so the count and the dots
   * cannot disagree; `lib/adherence.ts` carries the counting rules. Not
   * optimistic: `adherence` is the server's, so a status tapped here moves the
   * dots and this number on the render that follows rather than on the frame of
   * the tap. That is the same latency the grid below has always had, and the
   * band is orientation rather than feedback — § Feedback's 300ms budget is
   * about the control the reader touched, which is the bar.
   */
  const standing = weekStanding(adherence, date);

  return (
    // 12px of head clearance below 768px — FUEL-82, the same reduction `/` takes
    // and for the same reason: this screen carries the identical 140px action bar
    // and 86px shell under the same two notice bands, so the fold sits in the
    // same place and the head room is the same 10px that cannot be spared.
    <PageMain className={`pt-3 md:pt-[22px] ${PAGE_ASIDE_GRID}`}>
      {/*
       * The two columns — § Desktop, FUEL-77. At 1272 this wrapper stops
       * generating a box and the two groups inside become `<main>`'s grid items;
       * below it they are `display: contents` and this is the single flex column
       * it has always been, in the order it was already written.
       *
       * This screen needed no resequencing at all, which is the evidence that
       * the division is the guide's rather than the ticket's: the session and
       * its exercises were already the first four sections and the pattern was
       * already the last three.
       */}
      <div className={`flex flex-col gap-7 ${PAGE_ASIDE_UNWRAP}`}>
        {/*
         * The header band — § Desktop's "one job per zone", FUEL-85/86.
         *
         * "Where am I in this?", and on this screen the paginator IS the
         * answer: it names the date and it is the control that moves it. The
         * week's standing joins it on the right, which is the same question at
         * the next scale up — the session on screen, and the week it is in.
         *
         * The band draws its own hairline here, where `/` does not. § Desktop
         * gives the rule as "the graphic's own hairline closes the band, so the
         * separator is the graphic rather than a rule drawn near it" — `/`'s
         * ruler has one and a row of links does not, so this band supplies what
         * the mock draws it with.
         *
         * `DateNav` moves out of the measure group and into this one, which
         * moves nothing below the cap: it was that group's first child and this
         * group sits immediately before it, so the flat column is the same list
         * in the same order. That is the whole reason the 375 and 820 baselines
         * are expected back byte-identical.
         *
         * The row overrides the band's default column, which `cn` resolves —
         * `xl:flex-row` and `xl:flex-col` are one property, so the later wins
         * rather than both landing.
         */}
        <div
          className={cn(
            PAGE_HEADER_BAND,
            "xl:flex-row xl:items-baseline xl:justify-between xl:gap-5 xl:border-b xl:border-border xl:pb-4",
          )}
          data-column="header"
        >
          <DateNav date={date} today={today} />

          {standing && (
            /* Micro and a caption, like `/`'s folio — § Desktop: "the folio is
               a caption, not a heading". Hidden below the cap, where the band
               does not exist and this would land under the paginator as a
               second line the phone was never measured with. */
            <p className="hidden text-micro uppercase text-text-tertiary xl:block">
              {standing.done} of {standing.sessions} sessions this week
            </p>
          )}
        </div>

        {/* § Desktop: "the measure keeps the session and the exercise list."
            The note and the recorded status join them — they are this session's
            own record, and the bar below acts on exactly what they hold. */}
        <div className={cn(PAGE_MEASURE_COLUMN, "xl:gap-7")} data-column="measure">

        {session && inSession && currentEx ? (
          /*
           * The session state's measure — § Desktop, and the mock's own
           * arrangement at both widths.
           *
           * The subject is the EXERCISE, not the session: the eyebrow carries
           * which session and the slash line carries the prescription and the
           * position, so nothing above has to repeat them and the 40px line is
           * spent on the thing being performed. § P3's re-aimed criterion is
           * exactly this — "the active exercise is what is visible when you are
           * working".
           *
           * The eyebrow carries the session and, where a session has sections,
           * the part being worked — "Bodyweight Circuit B · Work" (FUEL-92).
           * Only where it HAS them: a session whose rows are all one section has
           * no divisions to name, and appending "· Work" to it would be a
           * distinction drawn about nothing.
           */
          <>
            <div className="flex flex-col gap-3">
              <Eyebrow>
                {workingExercises.length === session.exercises.length
                  ? session.name
                  : `${session.name} · ${sectionLabel(WORKING_SECTION)}`}
              </Eyebrow>
              <h1 className="text-title text-text-primary">{currentEx.name}</h1>
              {/* Verbatim, and then where you are. `resolve-training.ts` keeps
                  the exercises in section order and in `sort_order` within one,
                  so the position is the list's own and not a second ordering
                  invented here — and it counts the WORKING rows, which are the
                  rows this state steps through. A warm-up in the denominator
                  would be a session reporting itself as longer than the work it
                  is asking for. */}
              <SlashMeta>
                {`${currentEx.prescription} · Exercise ${current + 1} of ${workingExercises.length}`}
              </SlashMeta>
              {/*
               * "Show form" — § P10, FUEL-94, and the mock draws it exactly
               * here: directly under the prescription, `align-self: flex-start`,
               * as a Text button.
               *
               * A Text button because it is tertiary to the set you are in the
               * middle of — the same weight `rest-timer.tsx` gives "Stop" in the
               * bar below, which is this state's other non-action control.
               *
               * WITH THE SUBJECT, not on each row of the plan list. FUEL-90's
               * ruling: § Progressive Disclosure's ban on accordions means the
               * reveal may not be a row that expands in place, and FUEL-92's
               * group headings already took the plan list from 281px to 597px,
               * so it has no room for a per-row affordance and does not get one.
               *
               * Rendered only when there is media. An exercise without it draws
               * nothing — not a disabled button, which would promise a reference
               * that does not exist, and § Desktop refuses a state that
               * "would promise an action that does not exist" for the same
               * reason. The gap closes because the button is simply absent from
               * the flex column rather than being hidden inside it.
               */}
              {currentEx.media ? (
                <Button
                  variant="link"
                  size="xs"
                  className="self-start px-0"
                  onClick={() => setFormOpen(true)}
                >
                  Show form
                </Button>
              ) : null}
            </div>

            {/*
             * Mounted only once opened, and unmounted on close.
             *
             * Not merely a saving: `dynamic` fetches the chunk when this element
             * first renders, so gating it on `formOpen` is what makes the import
             * lazy in fact rather than in principle. The media element goes with
             * it, which is the other half of "never loaded on `/`" — a `<video
             * preload="none">` that is never mounted cannot be fetched at all.
             */}
            {currentEx.media && formOpen ? (
              <FormMediaSheet
                open={formOpen}
                onOpenChange={setFormOpen}
                exerciseName={currentEx.name}
                media={currentEx.media}
              />
            ) : null}

            <section className="flex flex-col gap-[14px]">
              <Eyebrow>Sets</Eyebrow>
              <SetList
                exercise={currentEx}
                logged={setsFor(currentEx.id, sets)}
                drafts={drafts}
                onDraft={(setIndex, value) => draft(currentEx.id, setIndex, value)}
                onLog={(setIndex, reps) => {
                  forget(currentEx.id, setIndex);
                  act({ kind: "log-set", exerciseId: currentEx.id, setIndex, reps });
                }}
                onRemove={(setIndex) => {
                  forget(currentEx.id, setIndex);
                  act({ kind: "remove-set", exerciseId: currentEx.id, setIndex });
                }}
              />
            </section>
          </>
        ) : (
          <>
        {session ? (
          <Subject item={session} />
        ) : (
          <div className="flex flex-col gap-3">
            <Eyebrow>Training</Eyebrow>
            <h1 className="text-title text-text-primary">
              {walk ? "Walk only" : "Nothing scheduled"}
            </h1>
            {/* § Tone of Voice: describe what will appear. A weekend is a rest
              day by design, and a date before the program started simply has
              no plan — neither is a failure to do something. */}
            <SlashMeta>
              {walk
                ? "No session today. The daily walk still counts."
                : "The plan does not cover this date."}
            </SlashMeta>
          </div>
        )}

        {session && (
          <section className="flex flex-col gap-[14px]">
            <Eyebrow>Exercises</Eyebrow>
            {/* § Desktop gives the plan state set progress "on the exercise's
                own row, no rows added" — which is what keeps the list's window
                spendable, and what § P3's criterion is re-aimed against. */}
            <ExerciseList exercises={session.exercises} progress={progress} />
          </section>
        )}

        {session && (
          <section className="flex flex-col gap-[14px]">
            <Eyebrow>This session</Eyebrow>
            {/* The record, and then what it is estimated to have cost. Grouped
                so the slash line sits under the sentence it qualifies rather
                than a section's 14px away from it — the estimate is a fact
                ABOUT the record, not a second thing recorded. */}
            <div className="flex flex-col gap-2">
              <Recorded entry={entry} />
              <Estimate range={energy} />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="session-note" className="text-slash text-text-secondary">
                Note
              </label>
              <textarea
                id="session-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                // The same bound `session-entry.ts` refuses past, so the refusal
                // is unreachable through the screen and is only ever a forged
                // request. A control that can submit something the server will
                // not take is a control that reports a failure the user cannot
                // understand.
                maxLength={MAX_NOTE_LENGTH}
                rows={2}
                placeholder="Reps achieved, how it felt"
                className="rounded-md border border-border bg-surface px-3 py-2 text-body text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="session-duration"
                className="text-slash text-text-secondary"
              >
                Duration
              </label>
              <span className="flex items-center gap-2">
                <input
                  id="session-duration"
                  value={duration}
                  /*
                   * Digits only, stripped as they arrive.
                   *
                   * `inputMode` asks for a numeric keypad; it does not stop a
                   * paste. Without this, "1e2" or "ab" reaches `Number()` as
                   * `NaN`, and `NaN` is uniquely bad here: it renders as "NaN
                   * min" while the request is in flight, and because
                   * `NaN !== NaN` it makes the dirty check true forever — so
                   * "Save note" would stay on offer after every failed save,
                   * with nothing on screen explaining why. The action refuses
                   * the value either way; this stops the screen from lying
                   * about it in the meantime.
                   */
                  onChange={(event) => setDuration(event.target.value.replace(/\D/g, ""))}
                  // `inputMode` rather than `type="number"`, whose spinners are
                  // 24px targets and whose scroll-wheel behaviour changes a value
                  // nobody touched. `slot-times-form.tsx` made the same call.
                  inputMode="numeric"
                  // Three digits is every duration this program produces and the
                  // typo class it does not: a stray keypress cannot turn 28 into
                  // 2800. Values above `MAX_DURATION_MIN` are still refused by
                  // the action, with the same banner as any other refusal.
                  maxLength={3}
                  className="h-11 w-20 rounded-md border border-border bg-surface px-3 text-body tabular-nums text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <span className="text-slash text-text-tertiary">min</span>
              </span>
            </div>
          </section>
        )}
          </>
        )}

        </div>

        {/*
         * § Desktop: "the aside takes the dot grid and recent sessions, both of
         * which are below the fold at every width today — on the one screen
         * whose argument is the pattern rather than the day."
         *
         * The walk row goes with them, which the mock does not draw and this
         * ticket rules: it is the same Anytime list `/` renders, `/` puts it in
         * the aside, and a row that appeared in a different column depending on
         * which screen you reached it from would be two rows as far as a reader
         * is concerned.
         */}
        {/* Hidden below the cap while a session is being operated, and only
            there. § Desktop: "At ≥1272 the two states are one composition — the
            measure swaps its contents; the aside gains the rest of the list
            above what it already holds." A phone has one column and § Lists'
            window to spend in it, which is the whole reason the two states
            exist; below 1272 the session state is the exercise and its sets,
            and everything here is one tap away in the plan state. */}
        <div
          className={cn(PAGE_ASIDE_COLUMN, "xl:gap-7", inSession && "hidden")}
          data-column="aside"
        >
        {session && inSession && (
          <section className="flex flex-col gap-[14px]">
            <Eyebrow>This session</Eyebrow>
            <SessionList
              exercises={session.exercises}
              sets={sets}
              currentId={currentEx?.id}
            />
          </section>
        )}

        <section className="flex flex-col gap-[14px]">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Adherence</Eyebrow>
            <span className="text-micro uppercase text-text-tertiary">Last 6 weeks</span>
          </div>
          {/*
           * `today` rather than the date being viewed. The umber dot means "you
           * are here" — § The Four Rules — and reviewing a past date does not
           * move the present moment. When today falls outside the window the grid
           * omits it entirely, which is exactly right: a six-week window under
           * review after the fact has no present in it.
           */}
          <DotGrid
            weeks={adherence}
            today={today}
            /*
             * FUEL-30: a dot is a way to the date under it. The link is
             * pointer-only — 11px is not a touch target — and the list below is
             * the same dates at 54px, for a thumb and for a keyboard. Both are
             * explained at `hrefFor` in dot-grid.tsx.
             */
            hrefFor={(day) => `/training?date=${day}`}
          />
        </section>

        {/*
         * The dot grid's twin, and FUEL-30's actual control — the dots above are
         * pointer-only at 36×21px, and these rows are the same dates at 54px for
         * a thumb and for a keyboard. `recent-sessions.tsx` carries the whole
         * argument.
         *
         * A section of its own rather than more content under Adherence, so the
         * heading says what the rows are: the two are about the same six weeks
         * but they answer different questions — the grid is the pattern, and
         * this is the way back into it.
         *
         * Built from the grid's own days rather than from a second read, so a
         * row and the dot above it cannot disagree, and capped at seven because
         * this is a shortcut to the last few sessions and not an archive.
         * Anything older is `DateNav`'s job, which reaches every date there has
         * ever been.
         */}
        <section className="flex flex-col gap-[14px]">
          <Eyebrow>Recent</Eyebrow>
          <RecentSessions sessions={recentSessions(adherence, today)} viewing={date} />
        </section>

        {walk && (
          <section className="flex flex-col gap-[14px]">
            <Eyebrow>Anytime</Eyebrow>
            {/*
             * Loggable in one tap — FUEL-29, and the same row `/` renders. It is
             * on the template every single day, so a screen that left it out
             * would be describing a different plan from the one being followed,
             * and a rest day is exactly when it is the only thing there is to
             * log: the bar below this is absent on those days.
             *
             * The DATE is this screen's, not today's. That is the whole reason
             * the walk's action is addressed by date rather than by a key the
             * way `/`'s logs are — a walk missed on Tuesday is recorded on
             * Tuesday, from the screen that shows Tuesday.
             */}
            <ul className="flex flex-col">
              <WalkRow
                date={date}
                entryId={walk.entryId}
                name={walk.name}
                entry={
                  walk.entry ? { durationMin: walk.entry.durationMin } : null
                }
              />
            </ul>
          </section>
        )}
        </div>
      </div>

      {/*
       * § Touch Targets: "primary actions sit in the bottom third, within thumb
       * reach" — below 1024px, which is the width that sentence is about.
       * `sticky` on a `mt-auto` box keeps the bar inside the viewport while the
       * exercise list is long, and lets it settle at the end of the column when
       * it is not — `right-now.tsx` carries the measurement that made this
       * necessary rather than tidy. The safe-area inset is NOT here:
       * FUEL-58 moved it to the § Navigation shell, which is the last thing in
       * the page column and the only one with the home indicator beneath it.
       *
       * It stops at `--nav-shell-h` rather than at 0 because FUEL-65 pinned that
       * shell to the bottom of the viewport, and the two would otherwise occupy
       * the same strip with the shell on top. `right-now.tsx` carries that
       * argument in full; this bar and the `loading.tsx` skeleton follow it so
       * the primary does not move between the three — literally now, since
       * FUEL-83 gave the three one class string in `action-bar.ts` rather than
       * three copies kept in step by hand.
       *
       * At ≥1024px it stops at nothing, because it is no longer pinned at all —
       * FUEL-72, `lg:static`, and `action-bar.ts` carries the argument. This is
       * the screen that argument was measured on: at 1440×900 the pinned bar
       * held the bottom ~130px of the viewport in opaque `bg-background`, and
       * what it covered was the Recent list a dozen lines above, permanently and
       * mid-row. Released, the bar falls where the DOM already puts it — after
       * Recent — so the list ends above it rather than behind it.
       *
       * This screen is where the edge that string's `action-bar-fade` exists to
       * fix was measured too: at 375×667 the bar's top landed through the
       * x-height of the first exercise's prescription. See globals.css — and
       * note that the rule is scoped below `lg` for the reason above, since a
       * bar with nothing passing under it has no edge to soften.
       */}
      {session ? (
        // Under the measure at ≥1272 — FUEL-77, and inert below it. The bar acts
        // on the session in the first column, so it is never in the second.
        //
        // The session state's bar is the same bar minus the desktop release —
        // § Desktop's one named exception to FUEL-72, argued in `action-bar.ts`:
        // that release is a claim about thumb targets, and a rest timer
        // (FUEL-93) rides in this slot at every width.
        <div className={cn(inSession ? SESSION_ACTION_BAR : APP_ACTION_BAR, PAGE_MEASURE_FOOT)}>
          {failure && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b border-border pb-3"
            >
              <p className="text-slash text-error">{banner(failure)}</p>
              <Button variant="link" size="xs" onClick={() => act(failure)}>
                Try again
              </Button>
            </div>
          )}

          {/*
           * The bar's second row, and only in the session state — FUEL-93.
           *
           * § Desktop, FUEL-90: "the timer is a row of the action bar, above
           * the controls, in the slot § Feedback gives the failure banner. So
           * the bar is a flex column of at most three things — banner, timer,
           * controls — rather than growing a fourth button." Written after the
           * banner because a refusal outranks a readout, and both can be on
           * screen at once.
           *
           * Not in the plan state, which is a list you read before and after: a
           * rest is something you take BETWEEN exercises, so the control for it
           * belongs to the surface you operate during. It is also why the timer
           * needs no props — the session it belongs to is the one this bar is
           * already the bar for, and it stores nothing about which.
           */}
          {inSession && <RestTimer />}

          {/*
           * The mock's own arrangement: one primary, two secondaries beneath.
           * The recorded status is NOT shown by promoting its button — § Buttons
           * allows one primary per screen, and moving which button that is would
           * shift the bar under the reader's thumb between renders. It is said
           * in words instead, by `Recorded` above, which is also what makes it
           * survive greyscale.
           *
           * `aria-pressed` is how the same fact reaches a screen reader, and it
           * is the reason these are three buttons rather than a primary and two
           * alternatives: they are one choice with three answers.
           */}
          {/* A column of slabs on a phone, a row of content-width controls at
              the frame's cap — § Buttons, FUEL-85. `action-bar.ts` carries the
              argument and the strings; the banner above stays outside the row
              because it is a block that spans the column. */}
          <div className={ACTION_BAR_CONTROLS}>
            {/*
             * The primary changes because the screen's question does — § Desktop.
             *
             * § Buttons allows one primary and calls it "the one action the
             * screen exists for". Before you train that is starting; while you
             * are training it is finishing. Neither state has two, and Mark done
             * never appears as a secondary — a demotion of the action the whole
             * adherence record depends on.
             *
             * A date that is not today keeps Mark done, because Start session is
             * not offered where it would mean nothing: § Desktop gives the
             * session state to today alone, and PRD § P3 has always had past
             * sessions "viewable and editable by date". So the plan state's
             * primary is Start session exactly where the state is reachable.
             */}
            {canEnter && !inSession ? (
              <Button className={ACTION_BAR_PRIMARY} onClick={enter}>
                Start session
              </Button>
            ) : (
              <Button
                className={ACTION_BAR_PRIMARY}
                aria-pressed={entry?.status === "done"}
                onClick={() => (inSession ? finish("done") : record("done"))}
              >
                Mark done
              </Button>
            )}
            <div className={ACTION_BAR_SPLIT}>
              <Button
                variant="secondary"
                className={ACTION_BAR_SECONDARY}
                aria-pressed={entry?.status === "partial"}
                onClick={() => (inSession ? finish("partial") : record("partial"))}
              >
                Partial
              </Button>
              <Button
                variant="secondary"
                className={ACTION_BAR_SECONDARY}
                aria-pressed={entry?.status === "skipped"}
                onClick={() => (inSession ? finish("skipped") : record("skipped"))}
              >
                Skip
              </Button>
            </div>

          {/* Tertiary, so the Text variant — § Buttons gives it to Revert, and
              these are the same kind of thing: the way back from a tap that was
              made, for the uncommon case where it was the wrong one.

              Not offered in the session state, which the mock draws with three
              controls and no fourth. Clear takes the whole record away and its
              cascade takes the sets with it — a control the reader has no use
              for mid-session and every reason not to reach by accident while
              looking at a phone between sets. It is a tap away in the plan
              state, where taking a record back is what the screen is for. */}
          {entry && !inSession && (
            <div className={cn("flex items-center gap-4", ACTION_BAR_PRIMARY)}>
              {/* Offered only when the boxes hold something the server has
                  not been told. Before a status exists the note has a control
                  already — it travels with whichever status is tapped — and
                  after one exists, an edited note would otherwise have no way
                  to be saved short of re-tapping a status, which looks like it
                  would change something else. */}
              {dirty && (
                <Button variant="link" onClick={() => record(entry.status)}>
                  Save note
                </Button>
              )}
              <Button variant="link" onClick={() => act({ kind: "clear" })}>
                Clear
              </Button>
            </div>
          )}
          </div>
        </div>
      ) : null}
    </PageMain>
  );
}
