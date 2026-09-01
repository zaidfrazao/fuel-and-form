import { SlashMeta } from "@/components/kv-grid";
import type { WorkoutExercise } from "@/lib/db/schema";

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
  "id" | "name" | "prescription" | "notes"
>;

/**
 * The full exercise list — P1's criterion for a training session, and P3's.
 *
 * Rows on the canvas separated by hairlines, no card and no outer rule, with
 * ordinal indices in `text-tertiary` where sequence matters (§ Lists). 46px
 * minimum, the guide's dense figure, which is what it names exercises as.
 *
 * The prescription is rendered verbatim. `workout_exercises.prescription` is
 * '3 x 12' or '30s on / 30s off' as written, and the schema says outright that
 * it is "displayed verbatim, never parsed" — so no formatting happens here that
 * could disagree with what was entered.
 *
 * ## Its own file, from FUEL-27
 *
 * It began inside `right-now.tsx` and was lifted out when `/training` needed the
 * same list. Two screens showing the same rows in two spellings is how "01" on
 * one and "1." on the other happens, and the version that drifts is the one
 * nobody is looking at. There is no server or client boundary crossed by the
 * move: no state, no handlers, just rows — so both an RSC and a client
 * component can render it.
 */
export function ExerciseList({
  exercises,
  progress,
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
}) {
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
          /*
           * Wraps rather than squeezing — FUEL-27.
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
           */
          className="flex min-h-[46px] flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0"
        >
          <span className="font-mono text-slash text-text-tertiary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="flex min-w-[9rem] flex-1 flex-col gap-[3px]">
            <span className="text-body text-text-primary">{exercise.name}</span>
            {/* Truthy, not `!== null`. `notes` is a nullable text column with
                no length constraint, so an empty string is storable — and it
                would render as a bare "/ " with nothing after it, which reads
                as a note that failed to load rather than one that isn't there. */}
            {exercise.notes && <SlashMeta>{exercise.notes}</SlashMeta>}
            {/* A line of its own rather than appended to the note above. A note
                is a sentence — "Feet shoulder-width, sit back like you're
                reaching for a chair" — and a fact tacked onto the end of one
                lands wherever that sentence happens to stop wrapping. */}
            {progress?.has(exercise.id) && (
              <SlashMeta>{progress.get(exercise.id)}</SlashMeta>
            )}
          </span>
          <span className="ml-auto shrink-0 text-body text-text-secondary">
            {exercise.prescription}
          </span>
        </li>
      ))}
    </ol>
  );
}
