import type { TrainingTemplateEntry, Workout } from "./db/schema";
import { type CalendarDate, dayOfWeek, daysBetween } from "./date";

/**
 * Circuit A/B alternation — which workout is scheduled on a given date.
 *
 * The rule, from PRD § Circuit A/B alternation, is one sentence: a
 * `training_template_entries` row may name a `rotation_group` instead of a fixed
 * `workout_id`, and resolution counts how many days matching that group have
 * elapsed since `program_start_date`, modulo the number of workouts in the
 * group.
 *
 * ## Why it counts dates and not sessions
 *
 * The obvious implementation is to look at what was last done and serve the
 * other one. It is also the one that breaks the first time a Wednesday is
 * missed: skip a session and the rotation either stalls on A forever or jumps,
 * and from then on the app and the program disagree about which circuit is due
 * — silently, and with no way back other than editing history.
 *
 * So nothing here reads `workout_logs`. `TrainingPlan` has three fields and none
 * of them is a log; a caller cannot pass session history in even by mistake,
 * which is a stronger guarantee than a rule everyone has to remember. The
 * consequence is the one the Testing Strategy asks for in § 1.2 case 4: a
 * skipped session produces exactly the answer a completed one would, because
 * completion was never an input. It also means every date has an answer before
 * it arrives — next month's Wednesday is already decided — and that a past date
 * still reports what it reported on the day.
 *
 * ## Counted, not iterated
 *
 * The count is closed-form over the seven-day cycle: whole weeks times the
 * number of training days in a week, plus the days in the part-week remainder.
 * Stepping day by day would give the same answer today and be O(days) for a
 * query two years out, which the weekly grid and the export both make routine.
 * More to the point, an accumulating loop is the shape a drift bug hides in;
 * arithmetic from `program_start_date` has nowhere to accumulate.
 *
 * ## Pure, and given its data rather than fetching it
 *
 * Same contract as `resolve-plan.ts`: no database access, no `user_id`, no
 * `server-only`, and only TYPE imports from the schema so a client component can
 * import this without pulling Drizzle's pg-core into the bundle. The caller has
 * already been through `scope()`, so every row here belongs to one user.
 */

/** Whether the day's workout was named outright or derived from a rotation. */
export type TrainingSource = "fixed" | "rotation";

/** One resolved session: the workout, and what put it on this date. */
export type ResolvedWorkout = {
  workout: Workout;
  source: TrainingSource;

  /**
   * The `training_template_entries` row that produced it — the entry, never the
   * workout. A rotated day's workout changes with the date; the entry is what
   * the UI edits, and what a "not this one today" action would have to name.
   */
  entryId: string;
};

/**
 * Everything training resolution needs, for one user, already fetched.
 *
 * Note what is absent: `workout_logs`. See the module comment — the omission is
 * the feature, and it is why this type is spelled out rather than being
 * "whatever the query returned".
 */
export type TrainingPlan = {
  /** `profiles.program_start_date`. Day zero of the rotation. */
  programStartDate: CalendarDate;
  template: TrainingTemplateEntry[];
  /** The user's workout library — tens of rows, so lookups scan it. */
  workouts: Workout[];
};

/**
 * Three-way string comparison, without a branch and without a locale.
 *
 * A tie-break exists to give the same answer on every machine, so it cannot go
 * through `localeCompare`. Same comparator, same reasoning, as `resolve-plan.ts`
 * — deliberately duplicated rather than shared, because a `compare.ts` holding
 * one line would be a module invented for tidiness alone.
 */
const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * The weekdays this group trains on, deduped.
 *
 * A set, not a count: two template rows on the same Wednesday are one training
 * day, and counting them twice would advance the rotation twice for a day that
 * happens once. The dedupe is also what keeps `size` usable as the per-week
 * stride below.
 */
function trainingDays(template: TrainingTemplateEntry[], group: string): Set<number> {
  const days = new Set<number>();

  for (const entry of template) {
    if (entry.rotationGroup === group) days.add(entry.dayOfWeek);
  }

  return days;
}

/**
 * The group's workouts, in rotation order.
 *
 * Ordered by `rotation_index` and then by id, and — importantly — selected from
 * by POSITION rather than by looking up an index equal to the count. Position is
 * total where the column is not: `rotation_index` is a plain nullable integer
 * with no uniqueness and no requirement to be contiguous, so a group left as
 * (0, 1, 3) after Circuit C was replaced would return nothing at all for index 2
 * under a lookup, and a duplicated index would return whichever row came back
 * first. Under position, both still alternate cleanly through everything in the
 * group. `rotation_index` orders the group, which is exactly what the PRD says
 * it does; it does not have to enumerate it.
 */
function groupWorkouts(plan: TrainingPlan, group: string): Workout[] {
  return plan.workouts
    .filter((workout) => workout.rotationGroup === group)
    .sort(
      (a, b) =>
        (a.rotationIndex ?? 0) - (b.rotationIndex ?? 0) || compareStrings(a.id, b.id),
    );
}

/**
 * The position in the rotation for `date`, or `null` if there is not one.
 *
 * `null` covers two states, both ordinary rather than exceptional:
 *
 *   - `date` is before `program_start_date`. Nothing is scheduled before day
 *     zero — the same rule `resolve-plan.ts` applies to meals — and returning
 *     early is what makes a negative modulo unrepresentable rather than handled.
 *     JS `%` keeps the sign of its left operand, so a count of -3 over two
 *     workouts is -1, which indexes nothing and would render an empty training
 *     day for every date before the program began.
 *   - The group has no workouts in the library. `rotation_group` is free text
 *     with no foreign key behind it, so deleting the last Circuit workout leaves
 *     a template entry pointing at a group that no longer exists — reachable
 *     through ordinary use, unlike the dangling meal id `resolve-plan.ts` throws
 *     over. An empty training day is the honest render; taking down the day view
 *     over a configuration gap is not.
 *
 * A group the template never trains on is not one of those states: the count of
 * elapsed matching days is genuinely zero, so the answer is 0 — where the
 * rotation would start if that group were scheduled tomorrow.
 *
 * The date needs no relationship to the group's training days. This answers
 * "what position is the rotation at on this date", which is defined for a
 * Tuesday in a Mon/Wed/Fri group; it is `resolveTraining` that decides whether
 * anything is scheduled, by only asking about days the template covers.
 */
export function rotationIndex(
  plan: TrainingPlan,
  group: string,
  date: CalendarDate,
): number | null {
  // Validates both dates on the way past — a malformed one throws here rather
  // than quietly comparing as a string and answering the wrong question.
  const elapsed = daysBetween(plan.programStartDate, date);

  if (elapsed < 0) return null;

  const size = groupWorkouts(plan, group).length;

  if (size === 0) return null;

  const days = trainingDays(plan.template, group);
  const startDay = dayOfWeek(plan.programStartDate);

  // Whole weeks contribute one full set of training days each; the remainder is
  // walked from the START weekday, which is the day the count is anchored to.
  // Walking it from the target's weekday instead would count backwards through
  // the wrong end of the part-week — right whenever the program happened to
  // start on the same weekday as the query, wrong the rest of the time.
  let count = Math.floor(elapsed / 7) * days.size;

  for (let offset = 0; offset < elapsed % 7; offset += 1) {
    if (days.has((startDay + offset) % 7)) count += 1;
  }

  return count % size;
}

/**
 * The workout the rotation lands on for `date`, or `null` if none does.
 *
 * The strictly-before boundary is what puts Circuit A on `program_start_date`
 * itself: no matching day has elapsed yet, so the count is zero. Day zero is a
 * training day, not the day before the first one.
 */
export function rotationWorkout(
  plan: TrainingPlan,
  group: string,
  date: CalendarDate,
): Workout | null {
  const index = rotationIndex(plan, group, date);

  // The index is a modulo of this array's own length, so it is in range whenever
  // it is not null. The assertion states that invariant; re-checking it with a
  // `?? null` would add a branch no test could ever take, and the file is gated
  // at 100% precisely so an unreachable branch is a thing someone has to notice.
  return index === null ? null : groupWorkouts(plan, group)[index]!;
}

/**
 * Everything scheduled on a date — fixed entries and rotated ones together.
 *
 * The shape the day view renders, and the reason the rotation index is not the
 * end of the story: a template mixes the two freely (a Sunday walk beside a
 * Mon/Wed/Fri circuit), and only the entries themselves know which is which.
 *
 * A fixed entry's workout is looked up in the library and its absence throws,
 * where a missing rotation group returns null. The asymmetry is deliberate and
 * follows what the database guarantees: `workout_id` carries a composite foreign
 * key, so a row naming a workout that does not exist is impossible — a missing
 * one means the caller passed a `workouts` array that does not cover its own
 * template, which is a bug worth a name and much worse as a session that
 * silently vanishes from the week.
 */
export function resolveTraining(plan: TrainingPlan, date: CalendarDate): ResolvedWorkout[] {
  if (daysBetween(plan.programStartDate, date) < 0) return [];

  const day = dayOfWeek(date);
  const resolved: ResolvedWorkout[] = [];

  const entries = plan.template
    .filter((entry) => entry.dayOfWeek === day)
    .sort((a, b) => a.sortOrder - b.sortOrder || compareStrings(a.id, b.id));

  for (const entry of entries) {
    // Branching on the GROUP rather than on `workout_id`, which the schema's
    // CHECK makes equivalent — exactly one of the two is non-null — but which
    // fails differently if a row ever gets past it. Testing `workout_id` first
    // would send a row with neither column set into the rotation branch with a
    // null group, and `groupWorkouts` matches `rotation_group === null`: every
    // workout that belongs to no rotation at all, the Sunday walk included. That
    // resolves, and puts the walk on a Monday with nothing to indicate anything
    // went wrong. This way round the same row falls through to the lookup below
    // and throws, which is the right noise for a state the database forbids.
    if (entry.rotationGroup !== null) {
      const workout = rotationWorkout(plan, entry.rotationGroup, date);

      if (workout) resolved.push({ workout, source: "rotation", entryId: entry.id });
      continue;
    }

    const workout = plan.workouts.find((candidate) => candidate.id === entry.workoutId);

    if (!workout) {
      throw new Error(
        `Training template entry ${entry.id} names workout ${entry.workoutId}, which ` +
          `is not in the workouts it was given. rotation.ts does not read the ` +
          `database — pass every workout the template names.`,
      );
    }

    resolved.push({ workout, source: "fixed", entryId: entry.id });
  }

  return resolved;
}
