import type { Day, DayStatus, Week } from "@/components/dot-grid";
import { addDays, type CalendarDate, startOfWeek } from "./date";
import type { WorkoutExercise, WorkoutLog, WorkoutLogStatus } from "./db/schema";
import { trainingDay } from "./resolve-training";
import type { TrainingPlan } from "./rotation";

/**
 * Six weeks of training, as the dot grid draws it — FUEL-27, PRD § P3.
 *
 * `resolve-training.ts` answers what was PLANNED on a date; `workout_logs`
 * records what HAPPENED. The dot grid needs the two joined, one dot per day,
 * across a six-week window. This file is that join, and nothing else.
 *
 * ## It reports; it does not grade
 *
 * The PRD's position on adherence is that divergence from plan is "data rather
 * than guilt", and § The Governing Principle turns that into rules this module
 * has to keep rather than merely avoid breaking:
 *
 *   - **An unlogged session is `none`, never `skipped`.** A skip is a thing
 *     someone did and recorded — `logItem` writes a row for it — and inferring
 *     one from an empty database would mean the graphic accusing the user of a
 *     decision they never made. Absence of a record is absence of a record.
 *   - **No percentage, no streak, no total.** The grid counts its own dots for
 *     the screen-reader summary and stops there. Nothing here returns a score,
 *     because a score is the grade the whole graphic exists to avoid.
 *   - **Partial is an outcome, not a shortfall.** It maps to its own dot, the
 *     same 11px as done. schema.ts calls it "a first-class outcome, not a
 *     failure state"; rounding it into either neighbour would decide, on the
 *     user's behalf, which one it was really closer to.
 *
 * ## The window is a WEEK window, not a 42-day one
 *
 * Six rows of seven, each starting on a Monday, because that is what the grid
 * draws — `docs/BRAND_GUIDE.html` heads it `M T W T F S S`. So the range runs
 * from the Monday six weeks back to the Sunday of the anchor's own week, and
 * the anchor sits wherever in the last row its weekday puts it. The mock's own
 * last row is exactly that: three days, then four that have not happened yet.
 *
 * `adherenceWindow` is exported so the read that fetches the logs and the
 * shaping that places them agree about which dates are in play by construction
 * — one definition, used twice, rather than a `between` in SQL that has to be
 * kept in step with an arithmetic here.
 *
 * ## Pure, like everything it reads
 *
 * No database access, no `user_id`, no `server-only`, and only TYPE imports
 * from the schema — the contract `resolve-training.ts`, `resolve-plan.ts` and
 * `rotation.ts` all keep. The types from `components/dot-grid` are erased at
 * build too, and taking them from there rather than restating them is
 * deliberate: the statuses are the GRAPHIC's vocabulary, and a second copy of
 * that union in `lib/` would be a second thing to update when the guide gains
 * a rendering. The dependency is one direction only — the component knows
 * nothing about this file.
 */

/** Six, per Brand Guide § The Dot Grid and the "Last 6 weeks" the mock heads. */
export const ADHERENCE_WEEKS = 6;

/** The `workout_logs` columns this module reads. A row satisfies it. */
export type SessionLog = Pick<WorkoutLog, "date" | "workoutId" | "status">;

/**
 * A log status, as a dot.
 *
 * Written out rather than passed through, even though the three names coincide
 * today. They are two independent vocabularies: `workout_log_status` is what
 * the database stores and `DayStatus` is what the graphic can draw, and the
 * latter already holds `walk` and `none`, which no log will ever be. Spelling
 * the mapping out means a fourth log status — the gym restart's, say — is a
 * compile error here rather than a value that silently reaches `dotStyle` and
 * renders as the fallback dot.
 */
const DOT: Record<WorkoutLogStatus, DayStatus> = {
  done: "done",
  partial: "partial",
  skipped: "skipped",
};

/** `2026-08-12` + a workout id → the one log that can be about both. */
function keyOf(date: CalendarDate, workoutId: string): string {
  return `${date} ${workoutId}`;
}

/**
 * The dates the grid covers, inclusive — six Monday-first weeks ending with the
 * week `anchor` falls in.
 *
 * Exported for the query that fetches the logs: `workout_logs` grows without
 * bound, and the rows outside this range cannot change a single dot.
 */
export function adherenceWindow(
  anchor: CalendarDate,
  weeks: number = ADHERENCE_WEEKS,
): { from: CalendarDate; to: CalendarDate } {
  const last = startOfWeek(anchor);

  return { from: addDays(last, -7 * (weeks - 1)), to: addDays(last, 6) };
}

/** Shared, not rebuilt per date — it is empty in every call and always will be. */
const EMPTY_EXERCISES = new Map<string, readonly WorkoutExercise[]>();

/**
 * One day: what the template put there, and what was recorded against it.
 *
 * The status is decided by the day's SESSION, not by its walk. A weekday holds
 * both — `lib/seed/plan.ts` gives the walk `sortOrder: 1` on days that have a
 * session, "the day's second activity, not its headline" — and a grid that let
 * the walk speak for the day would show a completed dot for a session that was
 * never done. A day with no session is where the walk answers, which is what
 * makes a weekend a small dot rather than an empty one.
 *
 * `label` names the workout for the adjacent data table, which Brand Guide §
 * Accessibility requires and which is where "Circuit B" is allowed to appear —
 * never on the graphic itself.
 */
function dayFor(
  plan: TrainingPlan,
  logs: ReadonlyMap<string, WorkoutLogStatus>,
  date: CalendarDate,
): Day {
  // An empty exercise map: this file draws dots, and a dot has no exercises in
  // it. `trainingDay` is still the right resolver to ask, because `kind` — the
  // walk / session distinction the whole function turns on — is its answer and
  // reproducing the `type === 'walk'` test here would be a second copy of it.
  const { sessions } = trainingDay(plan, EMPTY_EXERCISES, date);

  const session = sessions.find((item) => item.kind === "session");

  if (session) {
    const status = logs.get(keyOf(date, session.workout.id));

    return {
      date,
      label: session.workout.name,
      // No log is `none`, and deliberately not `skipped` — see the module
      // comment. It is also what a future date is, which is right: today's
      // session has not been done yet either, and the grid says so by drawing
      // the same small dot for both rather than pre-judging one of them.
      status: status ? DOT[status] : "none",
    };
  }

  const walk = sessions.find((item) => item.kind === "walk");

  return walk
    ? { date, label: walk.workout.name, status: "walk" }
    : // Nothing planned: a date before `program_start_date`, or one the
      // template does not cover. Not an error and not a gap — the grid draws
      // it as the faintest dot it has, which is what "nothing here" looks like.
      { date, status: "none" };
}

/** How many rows `/training` offers under the grid — see `recentSessions`. */
export const RECENT_SESSIONS = 7;

/** One row of the list beneath the grid: a date, what was on it, how it went. */
export type RecentSession = {
  date: CalendarDate;
  /** The workout's name. Present by construction — see the filter below. */
  label: string;
  status: DayStatus;
};

/**
 * The most recent session dates the grid covers, newest first — FUEL-30.
 *
 * The dot grid is the picture of this data and it is 11px wide per day, which
 * makes it a shortcut rather than a control: `dot-grid.tsx` gives the reasoning
 * at its `hrefFor` prop. This is the same days as a list a thumb can actually
 * hit, and it is built from the dots THEMSELVES rather than from a second read,
 * so a row and the dot above it cannot end up disagreeing about a date.
 *
 * ## What is left out, and why
 *
 *   - **Days with no session.** A walk-only weekend and a date the template does
 *     not cover are both real, viewable dates — `DateNav` walks to them and the
 *     screen has an honest state for each. They are not rows here because the
 *     list exists to reach the thing this screen can EDIT, and a row offering a
 *     weekend would mostly be offering an empty screen.
 *   - **Dates after `today`.** A future session cannot have happened, and
 *     `training.tsx` already refuses to walk forward past today for the same
 *     reason: a list that offered tomorrow would be inviting a record the user
 *     would then have to notice and take back.
 *
 * Unlogged days stay in, as `none`. That is the case the list is most useful
 * for — a session nobody recorded is exactly the one worth going back to — and
 * dropping it would make the list quietly agree that an unrecorded day did not
 * happen, which is the inference `lib/adherence.ts` refuses everywhere else.
 *
 * Neither `weeks` nor the arrays inside it are reordered: the days are mapped
 * out before anything is sorted, because `sort` is in-place and a shaping
 * function that rearranged the grid it was handed would move the dots as a side
 * effect of drawing a list.
 */
export function recentSessions(
  weeks: readonly Week[],
  today: CalendarDate,
  limit: number = RECENT_SESSIONS,
): RecentSession[] {
  return weeks
    .flat()
    .filter((day) => day.date <= today && day.status !== "walk")
    .flatMap((day) =>
      // A label is what says a day HAS something on it. `dayFor` sets one for a
      // session and for a walk and leaves it off a date with neither, so this
      // narrows away the empty days and `RecentSession.label` in one step —
      // walks having already gone in the filter above.
      day.label === undefined
        ? []
        : [{ date: day.date, label: day.label, status: day.status }],
    )
    // Newest first, and a genuine three-way rather than a `< ? 1 : -1`. Equal
    // dates have to compare 0 or the comparator is inconsistent, and 0 also
    // makes the sort stable, so two rows for one date keep the order they were
    // given — the call `layOut` already makes when a week holds a day twice.
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

/**
 * The six weeks of dots ending with `anchor`'s week.
 *
 * Every day in the window gets an entry, including ones that resolve to
 * nothing. The grid places each by its own date, so a week is allowed to be
 * sparse — but a *silently* sparse one would leave `layOut` guessing, and a day
 * that is genuinely empty is data the adjacent table should state rather than
 * omit.
 *
 * @param logs the window's `workout_logs` rows. Rows outside it are harmless
 *   and ignored; the map is keyed by date AND workout, so a log for the walk
 *   cannot answer for the session it shares a date with.
 */
export function adherenceWeeks(
  plan: TrainingPlan,
  logs: readonly SessionLog[],
  anchor: CalendarDate,
  weeks: number = ADHERENCE_WEEKS,
): Week[] {
  const recorded = new Map<string, WorkoutLogStatus>(
    logs.map((log) => [keyOf(log.date, log.workoutId), log.status]),
  );

  const { from } = adherenceWindow(anchor, weeks);

  return Array.from({ length: weeks }, (_, week) => {
    const monday = addDays(from, 7 * week);

    return Array.from({ length: 7 }, (_, day) =>
      dayFor(plan, recorded, addDays(monday, day)),
    );
  });
}

/**
 * How the viewed week is going — `3 of 5 sessions this week`, FUEL-86.
 *
 * The right of `/training`'s header band. § Desktop's redraw gives the band
 * "where am I in this?", and on a screen whose subject is one session the
 * useful second half of that answer is the week the session is in.
 *
 * ## Built from the grid rather than from a second read
 *
 * `recentSessions` is recorded as being built "from the dots THEMSELVES rather
 * than from a second read, so a row and the dot above it cannot end up
 * disagreeing about a date". This is the third reader of the same weeks and it
 * takes the same rule: the count in the header and the dots in the aside are
 * the same six weeks counted once.
 *
 * ## Which week, and why it is found rather than indexed
 *
 * The week the VIEWED date falls in, which is the week `adherenceWeeks` was
 * anchored on and so the last of the six. Found by looking for the date rather
 * than by taking `weeks.at(-1)`, because the index is a fact about how the
 * window happens to be built and the date is a fact about what is on screen.
 *
 * "This week" reads correctly on a past date for the same reason the paginator
 * beside it does: the band describes where the READER is, and the reader is on
 * that week.
 *
 * ## What counts
 *
 * A session is a day the template trains — a label, and not the walk, which is
 * on every day and would make every week seven. `done` is the numerator and
 * `partial` is not in it: § Buttons gives Partial its own control precisely to
 * say *not* done, and a count that folded the two would erase the distinction
 * the screen offers to make.
 *
 * `null` when the week trains on no day at all, so the caller draws nothing
 * rather than `0 of 0` — § Tone of Voice would rather say nothing than report a
 * ratio about a week with no sessions in it.
 */
export type WeekStanding = { done: number; sessions: number };

export function weekStanding(
  weeks: readonly Week[],
  date: CalendarDate,
): WeekStanding | null {
  const week = weeks.find((days) => days.some((day) => day.date === date));

  if (!week) return null;

  const sessions = week.filter((day) => day.label !== undefined && day.status !== "walk");

  if (sessions.length === 0) return null;

  return {
    done: sessions.filter((day) => day.status === "done").length,
    sessions: sessions.length,
  };
}
