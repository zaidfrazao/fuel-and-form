/**
 * The parts of a session — § P10, FUEL-92.
 *
 * A session is a warm-up, the work, and a cool-down. `workout_exercises.section`
 * says which part a row belongs to; this module says what the parts ARE, what
 * order they present in, and what they are called. Three questions the database
 * deliberately does not answer.
 *
 * ## The order is code, not data
 *
 * `sort_order` orders rows WITHIN a section, and the schema says so. The order
 * the sections themselves appear in is not a column, because it is not a
 * property of anybody's data: a cool-down after the work is what those words
 * mean, and a row that could claim otherwise is a row that could put the
 * stretching first. So the sequence is `SECTIONS` below, one array, and every
 * reader takes its order from `bySection` rather than sorting for itself.
 *
 * That is also what makes the acceptance criterion mechanical rather than
 * hopeful: "the resolved session presents sections in a fixed order regardless
 * of insertion order" is true because insertion order is never consulted.
 *
 * ## An open vocabulary, like `workouts.type`
 *
 * The column is `text` with a CHECK rather than a `pgEnum`, for the reason
 * schema.ts gives on both columns: a new value would otherwise be
 * `ALTER TYPE ... ADD VALUE`, a migration, which the PRD's gym-restart claim
 * rules out. The consequence lands here — every function below takes a `string`
 * and not a `Section`, because a row read from the database is whatever is
 * stored in it, and this module has to keep working on the commit where the
 * CHECK gains 'finisher' but the constant below has not been edited yet.
 *
 * An unrecognised section is therefore ordered LAST and labelled with its own
 * raw value rather than being dropped or folded into the work. Dropping it would
 * hide exercises somebody scheduled; folding it in would hand them set logging
 * and, later, a burn estimate at the working MET — the two mistakes this column
 * exists to prevent.
 *
 * ## Pure, like every module the client imports
 *
 * No database access and only a TYPE import from the schema, which is the
 * contract `resolve-plan.ts`, `session-entry.ts` and `exercise-set.ts` all keep:
 * a client component can import this without dragging Drizzle's pg-core into the
 * browser bundle. `schema.ts` imports `WORKING_SECTION` from here for its column
 * default, which is the same direction — the constant is the value, and the
 * table takes it rather than restating the string.
 */

/**
 * The sections, in the order a session performs them.
 *
 * The array IS the presentation order — see the module comment. Adding a value
 * here and to the column's CHECK is the whole change; nothing reads a rank from
 * anywhere else.
 */
export const SECTIONS = ["warmup", "work", "cooldown"] as const;

/** One of the sections this build knows about. A stored value may be another. */
export type Section = (typeof SECTIONS)[number];

/**
 * The section a row belongs to when nobody said otherwise.
 *
 * The column's default, and the one section that logs sets. Exported as a value
 * rather than spelled `'work'` at each site for the reason `WALK_TYPE` is: a
 * second spelling of a string is a second thing to get wrong, and this one
 * decides whether an exercise is offered rep entry.
 */
export const WORKING_SECTION = "work";

/** What a section is called in a heading. */
const LABELS: Record<Section, string> = {
  warmup: "Warm-up",
  work: "Work",
  cooldown: "Cool-down",
};

/**
 * The heading for a section — 'Warm-up', 'Work', 'Cool-down'.
 *
 * A value this build does not know is returned as itself. § Lists renders the
 * heading uppercase, so an unrecognised slug reads as a heading rather than as
 * broken text, and printing what is stored is what `training.tsx` already does
 * with `workouts.type` for the same reason.
 */
export function sectionLabel(section: string): string {
  return LABELS[section as Section] ?? section;
}

/**
 * Where a section sorts. Unknown values come last, in the order they arrived.
 *
 * `indexOf` on three items rather than a lookup object: the array is the
 * ordering, and a second structure derived from it is a second thing that can
 * disagree with it.
 */
function rank(section: string): number {
  const index = SECTIONS.indexOf(section as Section);

  return index === -1 ? SECTIONS.length : index;
}

/** A section's rows, kept together and in the section's own order. */
export type SectionGroup<T> = {
  section: string;
  /** `sectionLabel(section)`, resolved once so a renderer does not repeat it. */
  label: string;
  exercises: readonly T[];
};

/**
 * A list of exercises, divided into the sections present in it.
 *
 * Only sections that HAVE rows come back, which is § Lists' rule — "a group with
 * no rows renders nothing at all" — answered in the data rather than in a
 * renderer's conditional. A caller cannot draw an empty heading because it is
 * never given one.
 *
 * A list whose rows are all one section comes back as a single group. That is
 * what lets `ExerciseList` render today's flat list unchanged for every session
 * stored before this ticket: one group is not a grouping, and the component
 * tests for exactly that.
 *
 * Order within a group is the order it was given, untouched — the queries
 * deliver `(sort_order, id)` and that is the ordering `sort_order` is for.
 * Unknown sections keep their relative order behind the known ones, so two of
 * them do not swap places between renders.
 */
export function bySection<T extends { section: string }>(
  exercises: readonly T[],
): SectionGroup<T>[] {
  const groups: SectionGroup<T>[] = [];

  for (const exercise of exercises) {
    const existing = groups.find((group) => group.section === exercise.section);

    if (existing) {
      // `exercises` is `readonly` to callers and built here, so the cast is the
      // narrowing of a list this function owns rather than a promise broken.
      (existing.exercises as T[]).push(exercise);
      continue;
    }

    groups.push({
      section: exercise.section,
      label: sectionLabel(exercise.section),
      exercises: [exercise],
    });
  }

  return groups.sort((a, b) => rank(a.section) - rank(b.section));
}

/**
 * The rows a session's WORK is done on — everything set logging is offered for.
 *
 * FUEL-91's surface is scoped through this: the session state steps through
 * these and no others, and the plan state's progress metadata is derived from
 * these and no others. A warm-up is done or not done, and three sets of a hip
 * opener is not information anybody wants recorded.
 *
 * An unrecognised section is NOT working, which is the conservative half of the
 * open vocabulary: a section this build has never heard of gets a heading and
 * its rows, and does not get rep entry until somebody decides it should.
 */
export function working<T extends { section: string }>(
  exercises: readonly T[],
): readonly T[] {
  return exercises.filter((exercise) => exercise.section === WORKING_SECTION);
}
