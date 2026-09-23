import { SlashMeta } from "@/components/kv-grid";
import type { WorkoutExercise } from "@/lib/db/schema";
import type { MediaFrame } from "@/lib/form-media";
import { FOCUS_RING, HOVER_GROUND, HOVER_LIFT, POINTER } from "@/lib/pointer";
import { bySection } from "@/lib/section";
import { cn } from "@/lib/utils";

/**
 * What a row opens — FUEL-127.
 *
 * `form` is FUEL-108's reference sheet. `sets` is the sheet that reads and
 * corrects the sets logged against a working exercise, on any date, which the
 * session state cannot reach because it is today's alone. A row opens ONE of
 * the two, and the screen decides which: a working exercise opens its sets
 * (the reference is one tap further, inside that sheet), a warm-up or
 * cool-down row opens its reference, since § P10 offers it no sets at all.
 *
 * The value is also what the row's `sr-only` prefix says, so a screen reader
 * hears what THIS row does rather than what the list's first row did.
 */
export type RowOpens = "form" | "sets";

/** The prefix each kind of row announces before its contents. */
const OPENS_PREFIX: Record<RowOpens, string> = {
  form: "Show form for ",
  sets: "Show sets for ",
};

/**
 * The row affordance, offered by the screen rather than by the row — § P10,
 * FUEL-108, and what it opens since FUEL-127.
 *
 * ## Why this is a prop and not something the row works out for itself
 *
 * Two screens render this list, and only one of them may offer form media.
 * FUEL-94's criterion is that media is "never loaded on `/`", and `/`'s whole
 * argument for rendering a session at all is that it is showing you today at a
 * glance. So the affordance is opt-in: `/training` passes this, `/` passes
 * nothing, and a row with no `affordance` renders precisely the markup it
 * rendered before FUEL-108 — no button, no underline, no `group`, no hover
 * classes.
 *
 * That is also what keeps the component renderable from a server component,
 * which `/` needs and this file's closing note has claimed since FUEL-27: with
 * the prop absent there is still no state and no handler here.
 *
 * ## One object rather than two optional props
 *
 * `available` and `onShow` are useless apart, and apart they are also
 * silently wrong in both directions: a handler with no map makes every row
 * inert, and a map with no handler draws underlines that do nothing. Neither
 * would throw and neither would look broken in a screenshot. Bundling them
 * makes both states unrepresentable rather than merely unlikely.
 *
 * `available` is a map rather than a predicate for `progress`'s reason one prop
 * up: the caller derives it once, and the row does a lookup instead of
 * re-deciding per render.
 */
export type RowAffordance = {
  /**
   * The rows that open something, by id, and what each opens.
   *
   * A row outside this map draws nothing at all — not a disabled control, which
   * would promise a sheet that does not exist. `training.tsx` refuses the same
   * state at the other end for the same reason: the session's "Show form" is
   * absent rather than disabled where `media` is null.
   */
  available: ReadonlyMap<string, RowOpens>;
  onShow: (exerciseId: string) => void;
  /**
   * The photograph each row leads with, by id — § Lists › The row's
   * photograph, FUEL-129. The reference's working frame, resolved by the
   * caller, never a stored `media_key`.
   *
   * On the affordance rather than beside it, so a photograph is only ever drawn
   * inside the control that opens its sheet, and so `/` — which passes no
   * affordance — cannot draw one by construction: FUEL-94's "never loaded on
   * `/`" is a type, not a convention.
   *
   * Optional, so a screen may offer the doors without the pictures.
   */
  thumbnails?: ReadonlyMap<string, RowThumbnail>;
};

/** What a row's photograph needs of a frame: the file and its own size. */
export type RowThumbnail = Pick<MediaFrame, "path" | "width" | "height">;

/**
 * The photograph's column — § Lists › The row's photograph.
 *
 * 72px wide at every width. The height is the frame's own ratio rather than a
 * fixed 48: every photograph but one is 850×567, which IS 72×48, and the dead
 * bug's is 1280×720, which a 48px box could only take by cropping it or by
 * filling the difference. The guide refuses both ("never cropped", "no fill"),
 * so that one draws 72×41, top-aligned like the rest.
 *
 * `self-start` because the row is `items-baseline`, and a replaced element's
 * baseline is its bottom edge — the photograph would hang its foot on the
 * name's first line instead of standing beside it.
 */
const PHOTO_COLUMN = "w-[72px] shrink-0 self-start";

/**
 * The row's own geometry, split from its hairline so the control can take one
 * without the other.
 *
 * § Lists' dense figure is 46px and § Touch Targets' minimum is 44, so where a
 * row becomes a control the `min-h` has to travel WITH the flex box onto the
 * button — a hairline left on the `<li>` and a target that stops short of it is
 * a row that looks 46 and answers a thumb at less.
 */
const ROW_LAYOUT = "flex min-h-[46px] flex-wrap items-baseline gap-x-3 gap-y-1 py-3";
const ROW_HAIRLINE = "border-b border-border last:border-b-0";

/**
 * What a row needs, which is less than a `workout_exercises` row holds.
 *
 * A structural subset rather than the row itself, so `/training` can narrow the
 * payload it sends to the browser — `app/page.tsx` argues the principle: what
 * crosses is what the screen draws. `WorkoutExercise[]` satisfies this, so `/`
 * still passes the map it already has straight through.
 */
export type ListedExercise = Pick<
  WorkoutExercise,
  "id" | "name" | "prescription" | "notes" | "section"
>;

/**
 * The full exercise list — P1's criterion for a training session, and P3's.
 *
 * Rows on the canvas separated by hairlines, no card and no outer rule, with
 * ordinal indices in `text-tertiary` where sequence matters (§ Lists). 46px
 * minimum, the guide's dense figure, which is what it names exercises as.
 *
 * ## Divided into its sections when it has more than one — § P10, FUEL-92
 *
 * A session is a warm-up, the work and a cool-down, and § Lists makes those the
 * group heading's second case: the same Slash-uppercase heading `/shopping` has
 * drawn over its aisles since that screen shipped, with the rows of each section
 * beneath it. Both screens that render this list get the divisions, because the
 * guide says a screen showing a session "may not draw its own" — the
 * alternative, a `sections` prop that `/` passes false, would be the second
 * device wearing the first one's clothes.
 *
 * Marking the rows instead was the alternative and § Lists refuses it there
 * rather than here: a section that exists only as a mark on a row is not a
 * section to a screen reader, and § P10 asks for the warm-up as a PART of the
 * session.
 *
 * The prescription is rendered verbatim. `workout_exercises.prescription` is
 * '3 x 12' or '30s on / 30s off' as written, and the schema says outright that
 * it is "displayed verbatim, never parsed" — so no formatting happens here that
 * could disagree with what was entered.
 *
 * ## A row may be the affordance — § P10, FUEL-108, FUEL-127
 *
 * Where the screen passes `affordance`, a row with something to open becomes
 * the control that opens it: its sets on a working row, its reference on a
 * bookend (FUEL-127 added the first). FUEL-90 refused a per-row affordance on
 * two grounds and only one of them was about this: the accordion ban stands,
 * and is why the row OPENS A SHEET rather than expanding in place. The other was height — the plan
 * list had no room to grow a control — and that argument is spent by a shape
 * that adds none, because the row itself is the control.
 *
 * ## Its own file, from FUEL-27
 *
 * It began inside `right-now.tsx` and was lifted out when `/training` needed the
 * same list. Two screens showing the same rows in two spellings is how "01" on
 * one and "1." on the other happens, and the version that drifts is the one
 * nobody is looking at. There is no server or client boundary crossed by the
 * move: no state, no handlers, just rows — so both an RSC and a client
 * component can render it. `affordance` does not change that; it is the caller's
 * handler, and the screen that has one is a client component already.
 */
export function ExerciseList({
  exercises,
  progress,
  affordance,
}: {
  exercises: readonly ListedExercise[];
  /**
   * How far through each exercise a session got, by exercise id — § P10,
   * FUEL-91. A missing key is an exercise with nothing logged against it.
   *
   * Optional, because the two screens that render this list answer the question
   * differently. § Desktop gives set progress to `/training`'s plan state as
   * "slash metadata on the exercise's own row"; `/` renders the same list inside
   * the day's card, where the question is what is happening NOW rather than what
   * was performed, and where a second slash line under six rows would spend
   * height the ruler needs. So `/` passes nothing and is unchanged, its
   * baselines included.
   *
   * A map rather than a function, so the row does one lookup rather than
   * computing a label twice to ask whether it exists — and so the caller
   * derives every exercise's progress in one pass over the date's sets.
   */
  progress?: ReadonlyMap<string, string>;
  /**
   * The row affordance, or nothing — § P10, FUEL-108, FUEL-127.
   *
   * Optional for `progress`'s reason and one further one: `progress` is a fact
   * `/` merely has no room for, while this is one `/` is forbidden to show. See
   * `RowAffordance` above.
   */
  affordance?: RowAffordance;
}) {
  if (exercises.length === 0) {
    // A workout with no exercise rows is valid data — the daily walk is exactly
    // that. Saying so beats an empty gap where a list was expected.
    return <p className="text-body text-text-secondary">No exercises listed.</p>;
  }

  const groups = bySection(exercises);

  /*
   * One section is not a grouping — § P10, FUEL-92.
   *
   * Every session stored before this ticket holds one section, so this branch is
   * what makes "existing sessions render identically" true rather than nearly
   * true: the same single `<ol>`, no heading above it, no wrapper around it, and
   * the same DOM a screen reader walked yesterday. A "WORK" heading standing
   * alone over an ungrouped list would also be a heading that groups nothing,
   * which is the reading § Lists refuses on the empty case for the same reason.
   *
   * The empty case needs no branch at all: `bySection` returns only sections
   * that have rows, so there is never a heading with nothing under it to draw.
   */
  /*
   * The photograph's column belongs to the group, not the row — § Lists › The
   * row's photograph. Decided here, once per list the component draws, so
   * every row in a group agrees on where its name starts.
   */
  const photoColumn = (rows: readonly ListedExercise[]) =>
    rows.some(
      // The same two conditions a row draws its photograph on, below — a frame
      // for a row that is not a control is dropped, so it cannot claim a column.
      (row) => affordance?.available.has(row.id) && affordance.thumbnails?.has(row.id),
    );

  if (groups.length === 1)
    return (
      <Rows
        exercises={exercises}
        progress={progress}
        affordance={affordance}
        photoColumn={photoColumn(exercises)}
      />
    );

  return (
    /*
     * `gap-7` between the sections and `gap-1` under each heading, which are
     * `shopping-list-view`'s own numbers rather than numbers chosen here. § Lists
     * says the group heading is "one device, not one per screen" and that this is
     * the aisle heading's second case, so the spacing is part of what is taken
     * unchanged — two screens drawing one device at two rhythms is how the device
     * stops being one device.
     */
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
        <section key={group.section} className="flex flex-col gap-1">
          {/*
           * § Lists' group heading, unchanged from the one `shopping-list-view`
           * has drawn since that screen shipped — Slash, uppercase, `0.16em`,
           * `text-secondary`. FUEL-90 named warm-up / work / cool-down as that
           * heading's second case and said outright that a screen showing a
           * session "may not draw its own", so this is the aisle heading's
           * register copied deliberately rather than a second device that
           * happens to look similar.
           *
           * `h2` for the same reason it is one there: the sections are the
           * divisions of the list, and a screen reader's rotor is the whole
           * argument for the group over marking the rows.
           */}
          <h2 className="text-slash uppercase tracking-[0.16em] text-text-secondary">
            {group.label}
          </h2>
          <Rows
            exercises={group.exercises}
            progress={progress}
            affordance={affordance}
            photoColumn={photoColumn(group.exercises)}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * The rows themselves — one `<ol>`, whether it is the list or a section of it.
 *
 * Its own component so the two shapes above share one row, rather than the
 * grouped list growing a second copy that drifts from the flat one. The ordinals
 * restart at `01` in each list it renders, which is what a numbered section
 * means: the third working exercise is 03 whether or not a warm-up was scheduled
 * before it, and the session state's "Exercise 3 of 5" counts the same rows.
 */
function Rows({
  exercises,
  progress,
  affordance,
  photoColumn,
}: {
  exercises: readonly ListedExercise[];
  progress?: ReadonlyMap<string, string>;
  affordance?: RowAffordance;
  /** Whether this list draws the photograph's column — see `ExerciseList`. */
  photoColumn: boolean;
}) {
  return (
    <ol className="flex flex-col">
      {exercises.map((exercise, index) => {
        /*
         * Whether THIS row is a control, and what it opens — § P10, FUEL-108,
         * FUEL-127.
         *
         * Two conditions, and the second is the one that matters: the screen
         * has to offer the affordance at all, and this row has to have
         * something to open. A cool-down with no reference has neither sets nor
         * a form, so its row stays exactly what it was.
         */
        const opens = affordance?.available.get(exercise.id);
        const onOpen =
          affordance && opens ? () => affordance.onShow(exercise.id) : undefined;

        /*
         * § Accessibility's 4.5, on the rows that became controls.
         *
         * `HOVER_GROUND` puts `surface` under this row, where `text-secondary`
         * measures 4.26:1 and `text-tertiary` far less — so the prescription,
         * the ordinal and the slash lines all fall under AA for exactly as long
         * as the pointer is here. `pointer.ts` sets out why the lift goes on
         * each child rather than on the parent: colour inherits, but a child
         * naming its own colour class beats an inherited one.
         *
         * `undefined` on an inert row rather than an empty string, so `cn`
         * appends nothing and `/`'s markup is the markup it had.
         */
        const lift = onOpen ? HOVER_LIFT : undefined;

        /*
         * Only a row that is a control draws its photograph — tapping it has
         * to open the sheet, and an inert row has no sheet to open.
         */
        const thumbnail = onOpen ? affordance?.thumbnails?.get(exercise.id) : undefined;

        const content = (
          <>
            <span className={cn("font-mono text-slash text-text-tertiary", lift)}>
              {String(index + 1).padStart(2, "0")}
            </span>
            {/*
             * The row's photograph — § Lists › The row's photograph, FUEL-129.
             *
             * `alt=""`: the row's accessible name is its contents, and a
             * described alt would enter it ("Show sets for 01 Squats Bottom of
             * the squat …"). The sheet carries the description.
             *
             * A plain `<img>` with the manifest's own `width` and `height`, so
             * the box is reserved before the file arrives and nothing shifts as
             * the column fills in; `h-auto` keeps that intrinsic ratio at 72
             * wide. `next/image` is refused for `form-media-sheet.tsx`'s
             * reasons: this is the same shipped file, byte for byte, and the
             * sheet opened afterwards reuses it.
             *
             * The sheet's hairline, drawn as an inset outline rather than a
             * border: a border would take 2px out of the 72 the frame is
             * scaled to and leave the box 48.7 tall. The outline paints over
             * the photograph's own edge, so the box stays the frame's ratio.
             *
             * An empty column is a bare box — no fill, no border, nothing a
             * reader could take for a missing picture — and hidden, because it
             * says nothing.
             */}
            {thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- see above
              <img
                src={thumbnail.path}
                width={thumbnail.width}
                height={thumbnail.height}
                alt=""
                loading="lazy"
                decoding="async"
                className={cn(PHOTO_COLUMN, "h-auto rounded-sm outline -outline-offset-1 outline-border")}
              />
            ) : (
              photoColumn && <span aria-hidden className={PHOTO_COLUMN} />
            )}
            <span className="flex min-w-[9rem] flex-1 flex-col gap-[3px]">
              {/*
               * The resting mark, and it costs no space — § P10, FUEL-108.
               *
               * It has to REST: a hover ground says nothing to a thumb, and
               * this screen's posture is a phone. It also has to cost nothing,
               * because the argument for putting the affordance on the row at
               * all is that the row is already there — an affordance that grows
               * the list is the one FUEL-90 refused.
               *
               * A trailing chevron was drawn first and MEASURED, which is the
               * only reason this is an underline. The name column is `flex-1`
               * and holds all of the row's slack, so a 4px glyph and its 12px
               * gap come out of the text: at 375 the seed's Plank row went from
               * 189px of name column to 172px, its note re-wrapped, and the row
               * grew 101px → 118. One row, seventeen pixels, invisible in
               * jsdom and unarguable in a screenshot — see § Lists.
               *
               * The underline is the app's own link treatment, at the same
               * decoration and offset `week-nav.tsx` and the form sheet use. It
               * adds no box, so no column narrows and no note re-wraps, and it
               * is not colour alone.
               */}
              <span
                className={cn(
                  "text-body text-text-primary",
                  onOpen && "underline decoration-text-tertiary underline-offset-4",
                )}
              >
                {exercise.name}
              </span>
              {/* Truthy, not `!== null`. `notes` is a nullable text column with
                  no length constraint, so an empty string is storable — and it
                  would render as a bare "/ " with nothing after it, which reads
                  as a note that failed to load rather than one that isn't there. */}
              {exercise.notes && <SlashMeta className={lift}>{exercise.notes}</SlashMeta>}
              {/* A line of its own rather than appended to the note above. A note
                  is a sentence — "Feet shoulder-width, sit back like you're
                  reaching for a chair" — and a fact tacked onto the end of one
                  lands wherever that sentence happens to stop wrapping. */}
              {progress?.has(exercise.id) && (
                <SlashMeta className={lift}>{progress.get(exercise.id)}</SlashMeta>
              )}
            </span>
            <span className={cn("ml-auto shrink-0 text-body text-text-secondary", lift)}>
              {exercise.prescription}
            </span>
          </>
        );

        /*
         * The row as it has always been — FUEL-27.
         *
         * The mock's prescriptions are `3 × 12`, and against those a fixed
         * two-column row is fine. The seed's are not: "8–12 rounds — 40 sec on
         * / 40 sec off" is wider than half a 375px screen, and with both
         * columns on one line it took the width from the name beside it,
         * leaving "Skipping intervals" broken over two lines and its note
         * rendering one word per row.
         *
         * `flex-wrap` plus a floor on the name column is the whole fix: the
         * prescription sits on the right while it fits and drops to its own
         * line, still right-aligned, when it does not. `min-h` stays, so a
         * one-line row is still the guide's 46px dense figure.
         *
         * This branch is what `/` renders, unchanged by FUEL-108.
         */
        if (!onOpen || !opens) {
          return (
            <li key={exercise.id} className={cn(ROW_LAYOUT, ROW_HAIRLINE)}>
              {content}
            </li>
          );
        }

        return (
          /*
           * The control, arranged as `recent-sessions.tsx` arranges its own:
           * the `<li>` keeps the hairline and the inner element takes the flex
           * box, the height floor and the pointer states. That component is
           * this app's tappable row and this is its second case at § Lists'
           * dense 46 rather than a second spelling of it.
           */
          <li key={exercise.id} className={ROW_HAIRLINE}>
            <button
              type="button"
              onClick={onOpen}
              className={cn(
                ROW_LAYOUT,
                "group w-full text-left",
                POINTER,
                HOVER_GROUND,
                FOCUS_RING,
              )}
            >
              {/*
               * The purpose, prefixed — and NOT `aria-label` on the button.
               *
               * `aria-label` was the first attempt and it is the well-known
               * trap for a control that wraps a whole row: the name it supplies
               * REPLACES the element's contents, so "Show form for Reverse
               * lunges" is all a screen reader gets and the note and the
               * prescription — which are the row's actual information, and are
               * announced today — stop being read at all. A concise name is not
               * worth silencing the content it names.
               *
               * So the name comes from the contents, as it does for every other
               * button, and this says what pressing it does: "Show form for, 01
               * Reverse lunges, / Step back…, 3 x 8–12 each leg". Longer than a
               * label, and it is the whole row rather than a summary of it.
               *
               * `sr-only` because the row already SHOWS what this says — it is
               * the affordance the underline draws, spelled out for a reader
               * who cannot see an underline. It shrinks its box to a clipped
               * pixel rather than removing it, which is why it announces at all
               * and why it costs no layout — `day-ruler.tsx` and `dot-grid.tsx`
               * lean on the same property.
               */}
              <span className="sr-only">{OPENS_PREFIX[opens]}</span>
              {content}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
