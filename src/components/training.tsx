"use client";

import Link from "next/link";
import { type ReactNode, startTransition, useOptimistic, useState } from "react";

import { clearSessionStatus, setSessionStatus } from "@/app/actions/training";
import { APP_ACTION_BAR } from "@/components/action-bar";
import { DotGrid, type Week } from "@/components/dot-grid";
import { ExerciseList, type ListedExercise } from "@/components/exercise-list";
import { SlashMeta } from "@/components/kv-grid";
import { PageMain } from "@/components/page-main";
import { RecentSessions } from "@/components/recent-sessions";
import { Button } from "@/components/ui/button";
import { WalkRow } from "@/components/walk-row";
import { recentSessions } from "@/lib/adherence";
import { addDays, type CalendarDate } from "@/lib/date";
import type { WorkoutLogStatus } from "@/lib/db/schema";
import { dayLabel } from "@/lib/now-display";
import { MAX_NOTE_LENGTH } from "@/lib/session-entry";

/**
 * The Training screen — PRD § P3, Brand Guide § Seven screens → Training.
 *
 * A date's session with its full exercise list, the three statuses it can be
 * given, an optional note and duration, and six weeks of adherence underneath.
 * Deliberately not a workout tracker: no per-set entry, no volume, no totals.
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
  exercises: readonly ListedExercise[];
  entry: SessionEntryView | null;
};

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
    <nav aria-label="Date" className="flex items-center justify-between gap-3">
      <Link
        href={`/training?date=${previous}`}
        aria-label={`Previous day, ${dayLabel(previous)}`}
        className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
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
          className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
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
  | { kind: "clear" };

/** § Tone of Voice: name what happened. Never "Something went wrong". */
function banner(failure: Attempt): string {
  return failure.kind === "clear" ? "Couldn’t clear that." : "Couldn’t save that.";
}

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
}: {
  date: CalendarDate;
  today: CalendarDate;
  sessions: readonly TrainingItem[];
  /** Six weeks of dots from `lib/adherence.ts`. */
  adherence: Week[];
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

  // What the screen says is recorded, before the server has answered. One
  // optimistic value covering the whole entry, so a status and the note that
  // explains it cannot revert independently.
  const [entry, apply] = useOptimistic(
    recorded,
    (_current: SessionEntryView | null, next: SessionEntryView | null) => next,
  );

  const act = (attempt: Attempt) => {
    // Unreachable through the screen — every control below is inside a branch
    // that has a session — and a guard rather than a `!` so it stays that way.
    if (!session) return;

    setFailure(null);

    startTransition(async () => {
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

  return (
    // 12px of head clearance below 768px — FUEL-82, the same reduction `/` takes
    // and for the same reason: this screen carries the identical 140px action bar
    // and 86px shell under the same two notice bands, so the fold sits in the
    // same place and the head room is the same 10px that cannot be spared.
    <PageMain className="pt-3 md:pt-[22px]">
      <div className="flex flex-col gap-7">
        <DateNav date={date} today={today} />

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
            <ExerciseList exercises={session.exercises} />
          </section>
        )}

        {session && (
          <section className="flex flex-col gap-[14px]">
            <Eyebrow>This session</Eyebrow>
            <Recorded entry={entry} />

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

      {/*
       * § Touch Targets: "primary actions sit in the bottom third, within thumb
       * reach". `sticky` on a `mt-auto` box keeps the bar inside the viewport
       * while the exercise list is long, and lets it settle at the end of the
       * column when it is not — `right-now.tsx` carries the measurement that
       * made this necessary rather than tidy. The safe-area inset is NOT here:
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
       * This screen is where the edge that string's `action-bar-fade` exists to
       * fix was measured: at 375×667 the bar's top landed through the x-height
       * of the first exercise's prescription. See globals.css.
       */}
      {session ? (
        <div className={APP_ACTION_BAR}>
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
          <Button
            className="w-full"
            aria-pressed={entry?.status === "done"}
            onClick={() => record("done")}
          >
            Mark done
          </Button>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              aria-pressed={entry?.status === "partial"}
              onClick={() => record("partial")}
            >
              Partial
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              aria-pressed={entry?.status === "skipped"}
              onClick={() => record("skipped")}
            >
              Skip
            </Button>
          </div>

          {/* Tertiary, so the Text variant — § Buttons gives it to Revert, and
              these are the same kind of thing: the way back from a tap that was
              made, for the uncommon case where it was the wrong one. */}
          {entry && (
            <div className="flex items-center gap-4">
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
      ) : null}
    </PageMain>
  );
}
