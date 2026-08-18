"use client";

import { type ReactNode, startTransition, useOptimistic, useState } from "react";

import { logItem, undoLastLog } from "@/app/actions/log";
import { DayRuler } from "@/components/day-ruler";
import { KeyValueGrid, SlashMeta } from "@/components/kv-grid";
import { Button } from "@/components/ui/button";
import type { Meal, WorkoutExercise } from "@/lib/db/schema";
import type { LogVerb } from "@/lib/log-intent";
import { itemLabel, itemName, rulerSlots } from "@/lib/now-display";
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
 * what the optimistic advance genuinely needs crosses: the day's log history
 * stays on the server and arrives as `logged`, a count.
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
 * Swap remains `disabled` — the meal picker and the override it writes are P2's,
 * not this task's. It stays on the screen because its placement is P1's
 * criterion, and disabled rather than absent because a control that silently
 * does nothing when tapped is worse than one that says it cannot be used yet.
 */

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** Micro eyebrow above a section. 14px to its content — § Spacing & Layout. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="text-micro uppercase text-text-secondary">{children}</h2>;
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
function Subject({ item, at }: { item: NowItem; at?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-micro uppercase text-text-secondary">{itemLabel(item)}</p>
      {/* The one h1 on the page. A screen whose whole job is answering "what
          now?" should have the answer as its heading, not the product name. */}
      <h1 className="text-title text-text-primary">{itemName(item)}</h1>
      {at !== undefined && <SlashMeta>{at}</SlashMeta>}
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
 */
function MealMacros({ meal }: { meal: Meal }) {
  return (
    <KeyValueGrid
      items={[
        { label: "Calories", value: `${meal.kcal}` },
        { label: "Protein", value: `${meal.proteinG} g`, emphasis: true },
        { label: "Fat", value: `${meal.fatG} g` },
        { label: "Carbs", value: `${meal.carbG} g` },
      ]}
    />
  );
}

/**
 * The full exercise list — the P1 criterion for a training session.
 *
 * Rows on the canvas separated by hairlines, no card and no outer rule, with
 * ordinal indices in `text-tertiary` where sequence matters (§ Lists). 46px
 * minimum, the guide's dense figure, which is what it names exercises as.
 *
 * The prescription is rendered verbatim. `workout_exercises.prescription` is
 * '3 x 12' or '30s on / 30s off' as written, and the schema says outright that
 * it is "displayed verbatim, never parsed" — so no formatting happens here that
 * could disagree with what was entered.
 */
function ExerciseList({ exercises }: { exercises: readonly WorkoutExercise[] }) {
  if (exercises.length === 0) {
    // A workout with no exercise rows is valid data — the daily walk is exactly
    // that. Saying so beats an empty gap where a list was expected.
    return <p className="text-body text-text-secondary">No exercises listed.</p>;
  }

  return (
    <ol className="flex flex-col">
      {exercises.map((exercise, index) => (
        <li
          key={exercise.id}
          className="flex min-h-[46px] items-baseline gap-3 border-b border-border py-3 last:border-b-0"
        >
          <span className="font-mono text-slash text-text-tertiary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-body text-text-primary">{exercise.name}</span>
            {/* Truthy, not `!== null`. `notes` is a nullable text column with
                no length constraint, so an empty string is storable — and it
                would render as a bare "/ " with nothing after it, which reads
                as a note that failed to load rather than one that isn't there. */}
            {exercise.notes && <SlashMeta>{exercise.notes}</SlashMeta>}
          </span>
          <span className="text-body text-text-secondary">{exercise.prescription}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * What comes after this, with the times it comes at.
 *
 * Two of them. `NowView.upcoming` holds every remaining item precisely so the
 * view decides how many to show (resolve-now.ts:203-208), and the PRD's
 * criterion is "the next two upcoming items are shown with their scheduled
 * times". More than two turns a glance into a list to be read.
 */
function UpNext({ items }: { items: readonly ScheduledItem[] }) {
  const next = items.slice(0, 2);

  if (next.length === 0) return null;

  return (
    <section className="flex flex-col gap-[14px]">
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
 * Things with no window — the daily walk, and any slot with no time set.
 *
 * Offered alongside the active card and never as it, which is the distinction
 * `resolveNow` draws by putting them in a separate bucket: the walk is on the
 * template every day, and an item pinned to a window it has no basis for would
 * displace dinner every evening.
 */
function Anytime({ items }: { items: readonly AnytimeItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-[14px]">
      <Eyebrow>Anytime</Eyebrow>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex min-h-[54px] items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <span className="truncate text-body text-text-primary">{itemName(item)}</span>
            <span className="text-micro uppercase text-text-tertiary">{itemLabel(item)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The action bar — § Touch Targets: "primary actions sit in the bottom third,
 * within thumb reach".
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
 * `sticky bottom-0` fixes the reach without giving up the natural placement:
 * the bar keeps its own box at the end of the column, so it never overlaps the
 * last row once the page is scrolled to the end, and it is pinned inside the
 * viewport until then. `bg-background` is what makes it opaque as content
 * passes beneath it, and the 30px of it above the primary is the separation —
 * no border and no shadow, since § Materials allows neither outside sheets.
 *
 * The safe-area inset lives here rather than on the page, because a bar pinned
 * to `bottom: 0` sits below any padding its parent has: the inset only clears
 * the home indicator if it is inside the thing being pinned.
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
}: {
  item?: ScheduledItem;
  undoable: boolean;
  failure: Attempt | null;
  onAct: (attempt: Attempt) => void;
}) {
  if (!item && !undoable && !failure) return null;

  return (
    <div className="sticky bottom-0 mt-auto flex flex-col gap-3 bg-background pt-[30px] pb-[max(1.375rem,env(safe-area-inset-bottom))]">
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
          <p className="text-caption text-error">
            {failure.kind === "undo" ? "Couldn’t undo that." : "Couldn’t save that."}
          </p>
          <Button variant="link" size="xs" onClick={() => onAct(failure)}>
            Try again
          </Button>
        </div>
      )}

      {item && (
        <>
          <Button
            className="w-full"
            onClick={() => onAct({ kind: "act", key: item.key, verb: "log" })}
          >
            {item.kind === "meal" ? "Log eaten" : "Mark done"}
          </Button>
          <div className="flex gap-3">
            {item.kind === "meal" && (
              <Button disabled variant="secondary" className="flex-1">
                Swap
              </Button>
            )}
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => onAct({ kind: "act", key: item.key, verb: "skip" })}
            >
              Skip
            </Button>
          </div>
        </>
      )}

      {/*
       * Tertiary, so the text variant — § Buttons gives that one to "Revert".
       * Undo must not compete with the primary for attention: the common case
       * is a tap that was correct, and the control for taking it back is for
       * the uncommon one.
       */}
      {undoable && (
        <Button variant="link" className="self-start" onClick={() => onAct({ kind: "undo" })}>
          Undo
        </Button>
      )}
    </div>
  );
}

/**
 * The page frame.
 *
 * `min-h-dvh` rather than the `min-h-screen` the login page uses: `100vh` on
 * mobile Safari is the viewport with the browser chrome retracted, so an action
 * bar pushed to the bottom of it sits under the toolbar until the user scrolls.
 * The dynamic unit is the one that keeps the primary action reachable, which is
 * the whole point of putting it there.
 *
 * The bottom gutter is deliberately absent here and sits on the action bar
 * instead — see `Actions`, which is pinned to `bottom: 0` and would otherwise
 * be pinned below the page's own padding rather than inside it. The two quiet
 * states carry the same inset themselves, because their bar is conditional:
 * it is there only when a log can be taken back.
 */
function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-[22px] pt-[22px] md:px-7">
      {children}
    </main>
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
  | { kind: "act"; key: string; verb: LogVerb }
  | { kind: "undo" };

/**
 * What a tap does to the screen before the server has answered.
 *
 * A position and a count of today's logs, moved together: logging advances the
 * card AND makes an undo available, undoing does both in reverse. Holding them
 * in ONE optimistic value is what keeps them consistent — two `useOptimistic`
 * calls could revert independently, leaving an undo control offered for a log
 * that failed to write.
 */
type Progress = { position: number; logged: number };

const applyMove = (current: Progress, move: "logged" | "undone"): Progress =>
  move === "logged"
    ? { position: current.position + 1, logged: current.logged + 1 }
    : { position: current.position - 1, logged: current.logged - 1 };

export function RightNow({
  view,
  exercises,
  logged,
}: {
  view: NowView;
  /** `workouts.id` → its exercises, from `loadToday`. */
  exercises: ReadonlyMap<string, WorkoutExercise[]>;
  /**
   * How many logs today already holds — `logCount(today.logs)`.
   *
   * A number rather than the rows, because a count is all the undo affordance
   * asks and the rows would otherwise be shipped to the browser to be counted
   * there. The timeline has to cross that boundary for the optimistic advance
   * to work at all; the log history does not, so it does not.
   */
  logged: number;
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
  const [progress, move] = useOptimistic(
    { position: positionOf(view), logged },
    applyMove,
  );

  const [failure, setFailure] = useState<Attempt | null>(null);

  function act(attempt: Attempt) {
    setFailure(null);

    startTransition(async () => {
      move(attempt.kind === "undo" ? "undone" : "logged");

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
        const result =
          attempt.kind === "undo"
            ? await undoLastLog()
            : await logItem(attempt.key, attempt.verb);

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

  const actions = (
    <Actions
      item={now.state === "active" ? now.active : undefined}
      undoable={progress.logged > 0}
      failure={failure}
      onAct={act}
    />
  );

  // The ruler is drawn in all three states. The day's shape and where the
  // present moment falls in it are true whether or not anything is active, and
  // a screen that dropped the graphic on the two quiet states would answer
  // "where am I in the day?" only on the days it was already answering.
  const ruler = (
    <DayRuler slots={rulerSlots(base.timeline)} now={base.minutesOfDay} className="pt-2" />
  );

  if (now.state !== "active") {
    return (
      <Screen>
        {/* The quiet states carry the bottom inset themselves, because the bar
            is only there when there is a log to take back. */}
        <div className="flex flex-col gap-[30px] pb-[max(1.375rem,env(safe-area-inset-bottom))]">
          <header className="flex flex-col gap-2">
            <p className="text-micro uppercase text-text-secondary">
              {now.state === "day-complete" ? "Day complete" : "Today"}
            </p>
            <h1 className="text-title text-text-primary">
              {now.state === "day-complete" ? "Nothing left today" : "Nothing planned"}
            </h1>
            {/* § Tone of Voice — empty states describe what will appear, they
                do not nudge. FUEL-20 replaces the day-complete line with the
                actual-versus-target summary the PRD asks for. */}
            <p className="text-body text-text-secondary">
              {now.state === "day-complete"
                ? "Every item on today's plan has been worked through."
                : "Meals and sessions appear here once the week's plan covers today."}
            </p>
          </header>

          {base.timeline.length > 0 && ruler}

          <Anytime items={base.anytime} />
        </div>

        {actions}
      </Screen>
    );
  }

  const { active } = now;

  return (
    <Screen>
      {/* 30px between blocks — § Spacing & Layout's section rhythm. */}
      <div className="flex flex-col gap-[30px]">
        <Subject item={active} at={active.at} />

        {ruler}

        {active.kind === "meal" ? (
          <MealMacros meal={active.meal.meal} />
        ) : (
          <ExerciseList exercises={exercises.get(active.workout.workout.id) ?? []} />
        )}

        <UpNext items={now.upcoming} />

        <Anytime items={base.anytime} />
      </div>

      {actions}
    </Screen>
  );
}
