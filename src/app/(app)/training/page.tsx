import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Training, type TrainingItem } from "@/components/training";
import { getSession } from "@/lib/auth/session";
import { type CalendarDate, parseCalendarDate } from "@/lib/date";
import { loadTraining } from "@/lib/db/queries/training";
import type { TrainingSession } from "@/lib/resolve-training";
import type { WorkoutLog } from "@/lib/db/schema";

/**
 * `/training` — a date's session. PRD § P3, and FUEL-27.
 *
 * Thin, like `/`, `/plan`, `/settings` and `/plan/template`: the fetch is
 * `lib/db/queries/training.ts`, the shaping is `lib/adherence.ts` and
 * `lib/resolve-training.ts`, the render is `components/training.tsx`. What
 * happens here is the auth check, the date the URL asks for, and the narrowing.
 *
 * ## Why the date lives in the URL
 *
 * `/` holds its cursor in a COOKIE and `lib/cursor.ts` argues why: the promise
 * attached to a tap is that the view "is never wrong for longer than one tap",
 * which has to survive the phone being locked.
 *
 * This is `/plan`'s case rather than `/`'s, and takes `/plan`'s answer. A date
 * is a PLACE — "past sessions are viewable and editable by date" is a criterion
 * about navigation — so it belongs in the URL, where the back button works,
 * prev and next prefetch, and a bookmark means the same thing whenever it is
 * opened.
 *
 * ## A bad `?date=` renders today rather than failing
 *
 * `parseCalendarDate` throws on a malformed date, and this is the one input on
 * the screen a stranger fully controls. `parseCursor` and `/plan`'s
 * `requestedWeek` both make the same call: the honest answer to a value we do
 * not recognise is the answer to no value at all, and a throw would turn an
 * edited URL into a 500.
 *
 * The date is not otherwise constrained. A date before the program started
 * resolves to no sessions, which renders as the empty state — and the WRITE
 * path refuses it for the same reason, because there is no entry to name.
 *
 * ## The auth check is here rather than in a layout
 *
 * The reasoning every other page in this app sets out: a check in a layout does
 * not stop nested segments or Server Actions from running, so it belongs next
 * to the data. `loadTraining` is the next line and is scoped to the session's
 * user; the two Server Actions behind the screen resolve the session again for
 * themselves, because they are separately reachable.
 */

export const metadata: Metadata = {
  title: "Training · Fuel & Form",
  robots: { index: false, follow: false },
};

/**
 * The date a query parameter asks for, or `null` for today.
 *
 * Never throws. A repeated parameter arrives as an array and is refused rather
 * than having one of its values picked — a URL that says two different things
 * has not asked a question this screen can answer. `/plan`'s `requestedWeek` is
 * the same function for the same reason.
 */
function requestedDate(value: string | string[] | undefined): CalendarDate | null {
  if (typeof value !== "string") return null;

  try {
    parseCalendarDate(value);

    return value;
  } catch {
    return null;
  }
}

/**
 * One resolved session, narrowed to what the browser is allowed to hold.
 *
 * `workouts` carries a row's `user_id`, its rotation group, its rotation index
 * and a `description` holding the session's entire protocol in markdown;
 * `workout_exercises` carries a `user_id` and a `workout_id`; and `workout_logs`
 * carries an id and a `logged_at`. None of them is drawn. What crosses is the
 * name, the type under it, the prescriptions, and the three fields of the entry
 * — the same rule `app/page.tsx` and `/plan` apply to the meal library, and here
 * it keeps several hundred words of protocol out of the payload of a screen
 * that shows a list and three buttons.
 *
 * The `entryId` crosses because a write names it. It is the TEMPLATE entry, not
 * the workout: `resolve-training.ts` explains that a rotated day's workout
 * changes with the date, so the entry is the stable thing for a screen to hold,
 * and the action re-resolves the workout from it server-side.
 */
function narrow(session: TrainingSession, logs: readonly WorkoutLog[]): TrainingItem {
  const log = logs.find((row) => row.workoutId === session.workout.id);

  return {
    entryId: session.entryId,
    name: session.workout.name,
    type: session.workout.type,
    kind: session.kind,
    exercises: session.exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      prescription: exercise.prescription,
      notes: exercise.notes,
    })),
    entry: log
      ? { status: log.status, note: log.note, durationMin: log.durationMin }
      : null,
  };
}

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();

  if (!session) redirect("/login");

  const { date } = await searchParams;

  // The clock is read once, here. Everything below takes the instant as an
  // argument — the arrangement `/` and `/plan` both keep, and the reason the
  // date a test asks for is the date it gets.
  const training = await loadTraining(session.userId, requestedDate(date), new Date());

  // No profile row: the user exists but has not been set up, so there is no
  // timezone and therefore no day to resolve. § Tone of Voice asks an empty
  // state to describe what will appear rather than nudge.
  if (!training) {
    return (
      <main className="mx-auto flex w-full min-w-0 flex-1 max-w-[640px] flex-col justify-center gap-2 px-[22px] md:px-7">
        <h1 className="text-title text-text-primary">No training yet</h1>
        <p className="text-body text-text-secondary">
          Sessions appear here once a profile and a weekly training template exist
          for this account.
        </p>
      </main>
    );
  }

  return (
    <Training
      // Remounts on navigation, which is what resets the note and duration
      // boxes to the new date's own entry. Without it React reuses the instance
      // across a route change and Tuesday's note would sit in Wednesday's
      // textarea, one save away from being filed against the wrong session.
      key={training.date}
      date={training.date}
      today={training.today}
      sessions={training.day.sessions.map((item) => narrow(item, training.logs))}
      adherence={training.adherence}
    />
  );
}
