import type { ReactNode } from "react";

import { DayRuler } from "@/components/day-ruler";
import { KeyValueGrid, SlashMeta } from "@/components/kv-grid";
import { Button } from "@/components/ui/button";
import type { Meal, WorkoutExercise } from "@/lib/db/schema";
import { itemLabel, itemName, rulerSlots } from "@/lib/now-display";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";

/**
 * The "Right Now" screen — PRD § P1, Brand Guide § Seven screens.
 *
 * The screen the app exists for, and the only one that has to answer its
 * question before a word is read: one dominant card for what is happening now,
 * the day's shape beneath it, what is next after that, and the actions in the
 * bottom third where a thumb already is.
 *
 * ## Pure, and given its view rather than resolving one
 *
 * Takes a resolved `NowView` and renders it. No database handle, no session, no
 * clock — `src/lib/today.ts` does all three and `app/page.tsx` wires the two
 * together in eight lines. That split is what makes this file testable at all:
 * an async component that opened a connection could not be rendered by the
 * hermetic suite, and every acceptance criterion this task has is about what
 * ends up on the screen.
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
 * ## Actions are laid out here and wired in FUEL-19
 *
 * `Log eaten`, `Swap` and `Skip` render `disabled`. The server actions behind
 * them, and the optimistic UI over them, are FUEL-19's whole task. They are
 * present rather than deferred because their placement is this task's
 * criterion — bottom third, within thumb reach, primary ink-filled — and
 * disabled rather than inert because a control that silently does nothing when
 * tapped is a worse answer than one that says it cannot be used yet.
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
            {exercise.notes !== null && <SlashMeta>{exercise.notes}</SlashMeta>}
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
 * Placed by `mt-auto` on a full-height column rather than by a fixed position,
 * so it sits at the foot of a short screen and below the content on a long one
 * without ever covering the last row of a list. On a 375×667 phone the primary
 * lands inside the bottom third of the viewport, which is the criterion.
 *
 * Swap is offered for a meal and not for a session: a swap substitutes one meal
 * for another from the library (PRD § P2), and there is no equivalent for a
 * scheduled session — a session that isn't happening is a skip.
 *
 * Every button is `disabled` until FUEL-19. See the file comment.
 */
function Actions({ item }: { item: NowItem }) {
  return (
    <div className="mt-auto flex flex-col gap-3 pt-[30px]">
      <Button disabled className="w-full">
        {item.kind === "meal" ? "Log eaten" : "Mark done"}
      </Button>
      <div className="flex gap-3">
        {item.kind === "meal" && (
          <Button disabled variant="secondary" className="flex-1">
            Swap
          </Button>
        )}
        <Button disabled variant="secondary" className="flex-1">
          Skip
        </Button>
      </div>
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
 * The bottom gutter takes the larger of 22px and the safe-area inset, so the
 * primary clears the home indicator on a notched phone without adding dead
 * space on anything else.
 */
function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-[22px] pt-[22px] pb-[max(1.375rem,env(safe-area-inset-bottom))] md:px-7">
      {children}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

export function RightNow({
  view,
  exercises,
}: {
  view: NowView;
  /** `workouts.id` → its exercises, from `loadToday`. */
  exercises: ReadonlyMap<string, WorkoutExercise[]>;
}) {
  // The ruler is drawn in all three states. The day's shape and where the
  // present moment falls in it are true whether or not anything is active, and
  // a screen that dropped the graphic on the two quiet states would answer
  // "where am I in the day?" only on the days it was already answering.
  const ruler = (
    <DayRuler slots={rulerSlots(view.timeline)} now={view.minutesOfDay} className="pt-2" />
  );

  if (view.state !== "active") {
    return (
      <Screen>
        <div className="flex flex-col gap-[30px]">
          <header className="flex flex-col gap-2">
            <p className="text-micro uppercase text-text-secondary">
              {view.state === "day-complete" ? "Day complete" : "Today"}
            </p>
            <h1 className="text-title text-text-primary">
              {view.state === "day-complete" ? "Nothing left today" : "Nothing planned"}
            </h1>
            {/* § Tone of Voice — empty states describe what will appear, they
                do not nudge. FUEL-20 replaces the day-complete line with the
                actual-versus-target summary the PRD asks for. */}
            <p className="text-body text-text-secondary">
              {view.state === "day-complete"
                ? "Every item on today's plan has been worked through."
                : "Meals and sessions appear here once the week's plan covers today."}
            </p>
          </header>

          {view.timeline.length > 0 && ruler}

          <Anytime items={view.anytime} />
        </div>
      </Screen>
    );
  }

  const { active } = view;

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

        <UpNext items={view.upcoming} />

        <Anytime items={view.anytime} />
      </div>

      <Actions item={active} />
    </Screen>
  );
}
