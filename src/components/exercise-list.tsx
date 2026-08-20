import { SlashMeta } from "@/components/kv-grid";
import type { WorkoutExercise } from "@/lib/db/schema";

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
export function ExerciseList({ exercises }: { exercises: readonly WorkoutExercise[] }) {
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
