import { BODYWEIGHT_CIRCUIT, type SeedExercise, type SeedWorkout } from "./types";

/**
 * The workout library — PRD § P7 → repository privacy.
 *
 * Exercises and prescriptions, no body data. The source program's arithmetic
 * about maintenance, deficit and goal pace is deliberately not reproduced here:
 * those are metrics, they belong in the database via the gitignored owner script
 * (FUEL-15), and this is a committed file.
 *
 * ## The shared warm-up and cool-down are ROWS — § P10, FUEL-92
 *
 * Every session opens with the same ~5 minute warm-up and closes with the same
 * ~3–4 minute cool-down. Until FUEL-92 those were markdown inside
 * `description`, on two arguments this file made and one it got wrong.
 *
 * The argument that held: rows would "trip P3's next-exercise affordance over
 * eleven rows of mobility work before reaching the first working set". True, and
 * `workout_exercises.section` is what answers it — the session state steps
 * through the working rows and no others, so a mobility drill is never what the
 * screen puts in front of somebody mid-session, and it is never offered the
 * per-set entry FUEL-91 gives the work.
 *
 * The argument that was wrong: that the bookends were "rendered alongside". They
 * were not rendered at all. `workouts.description` reaches no screen in this app
 * — `/training` narrows it away deliberately (see `TrainingItem.type`, which
 * says so, and the route's own test, which asserts it), and nothing else reads
 * it. So the warm-up this program calls non-negotiable was invisible in the
 * product for as long as it was prose. That is the fault FUEL-92 actually fixes,
 * and it is worth stating plainly because the sentence claiming otherwise sat
 * here, unchecked, through every ticket that touched this file.
 *
 * Duplication across the three sessions was the other objection, and it is
 * answered the way it always was: two constants, spread into each session, so a
 * change to the warm-up cannot land on two of them and miss the third.
 *
 * They are FOUR rows and not the ten the prose listed. The Brand Guide measured
 * the grouped list before this ticket was written — five drawn rows become "nine
 * rows and three headings", and PRD § P3 counts "a warm-up, six exercises and a
 * cool-down" as eight rows — so the bookends are two rows each and the
 * individual drills are the `notes` beneath them. A row per drill would spend
 * the list's whole height on the part of the session nobody needs to read.
 *
 * ## Why the circuits share a rotation group
 *
 * The program alternates A/B/A one week and B/A/B the next, so a fortnight gives
 * each circuit equal time. That is a continuous alternation across weeks rather
 * than a fixed weekday assignment, which is exactly the case `rotation_group`
 * exists for: `rotationWorkout()` counts elapsed sessions from
 * `profiles.program_start_date` and takes the count modulo the group size, so
 * the pattern never drifts and a skipped session does not shift what comes next.
 *
 * The kettlebell session and the walk name no group. They are scheduled by a fixed
 * `workout_id` on their template rows, and the schema's `workouts_rotation_pair`
 * check keeps `rotation_group` and `rotation_index` null together.
 *
 * ## The structured targets are transcribed by hand, and some of them are null
 *
 * § P10's per-set logging (FUEL-91) compares a set against `target_sets` and
 * the rep range beside it. Those are columns, filled in here by a person
 * reading each prescription — NOT derived from the string, which is displayed
 * verbatim and never parsed. This file is where the difference is visible, and
 * it is worth seeing:
 *
 *   - '3 x 12–20' is three sets of twelve to twenty, and transcribes cleanly.
 *   - '3 x 30–60 sec' is three sets of a HOLD. It has a set count and no rep
 *     target at all, because seconds are not reps, and a regex that took the
 *     first two numbers would offer "Target 30–60" against a plank. Since
 *     FUEL-123 it has a SECONDS target, 30 to 60, transcribed by the same hand
 *     into the columns that mean seconds, so the set rows log a hold as a hold.
 *     'each side' is per side, as the dead bug's '10 each side' is per side:
 *     the side plank's 20–30 is what one side is held for.
 *   - '8–12 rounds — 40 sec on / 40 sec off' had no target of either kind.
 *     Rounds are not sets, the first number in the string is 8, and an
 *     interval session logged as eight sets of eight reps would be a record of
 *     something nobody did. It was null. (The skipping session left this file
 *     in FUEL-130; an existing user's row still reads that way.)
 *   - '75 swings — sets of 10–25, ~60 s rest, until 75' is the same shape as
 *     the rounds, one level up: 75 is a TOTAL, not a set count. It goes in
 *     `target_total_reps`, the 10–25 is the per-set rep target, and
 *     `target_sets` stays null (FUEL-130).
 *
 * `seed/seed.test.ts` feeds every prescription here through the reader and
 * asserts that no number in a target came out of a string. (It is that file and
 * not `seed/workouts.test.ts`, which does not exist and never has — the same
 * class of unchecked citation as the "rendered alongside" above.)
 */

/**
 * The warm-up every session opens with — two rows, § P10 (FUEL-92).
 *
 * One constant rather than three copies, so a change to the warm-up cannot land
 * on two sessions and miss one. Two rows and not five, split the way it is
 * actually performed: the five drills are the `notes`, which `ExerciseList`
 * already renders as slash metadata under the name.
 *
 * No structured targets on any of them. `target_sets` is what a set is compared
 * against, and these rows log no sets at all — they are done or they are not,
 * which is the whole reason the section exists.
 */
const WARM_UP: readonly SeedExercise[] = [
  {
    name: "Joint prep",
    prescription: "~2 min",
    section: "warmup",
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    notes:
      "10 arm circles forward, 10 backward, 10 shoulder rolls, 5 slow torso twists each side.",
  },
  {
    name: "Movement prep",
    prescription: "~3 min",
    section: "warmup",
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    notes:
      "30 sec light skipping or marching on the spot, 10 slow bodyweight squats, 10 leg swings each leg front to back.",
  },
];

/** Likewise, and closing every session. Hold each stretch for about 30 sec. */
const COOL_DOWN: readonly SeedExercise[] = [
  {
    name: "Lower-body stretches",
    prescription: "30 sec each",
    section: "cooldown",
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    notes:
      "Quad, hamstring and calf stretch, each leg. The calf against a wall, and don't skip it after skipping.",
  },
  {
    name: "Upper-body stretches",
    prescription: "30 sec each",
    section: "cooldown",
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    notes: "Chest doorway stretch, then child's pose.",
  },
];

/**
 * A session's rows: the warm-up, the work, the cool-down.
 *
 * The working rows are given without a `section` and take the column's default,
 * which keeps this file honest about where that default applies — the work is
 * the unmarked case here exactly as it is in the database.
 *
 * `sort_order` is assigned by the loader from this array's index, and the order
 * of the sections themselves is imposed by `resolve-training.ts` rather than
 * read off it, so a session whose rows come back in any other order still
 * presents its warm-up first.
 */
const session = (work: readonly SeedExercise[]): SeedExercise[] => [
  ...WARM_UP,
  ...work,
  ...COOL_DOWN,
];

/** The circuits share a format line as well as their bookends. */
const CIRCUIT_FORMAT = [
  "### Format",
  "",
  "3 rounds. Each exercise back to back with ~20 sec rest between exercises,",
  "then 90 sec rest between rounds. Start at the bottom of each rep range and",
  "work up over the weeks.",
].join("\n");

/**
 * What is left of the protocol prose now the bookends are rows.
 *
 * Deliberately NOT re-stating the warm-up and cool-down it used to wrap: they
 * are rows now, and a second copy of them in a column nothing renders is a copy
 * that drifts from the one people can actually see.
 */
const describe = (...sections: string[]) => sections.join("\n\n");

export const seedWorkouts: readonly SeedWorkout[] = [
  /* ------------------------------------------------------------------------ */
  /* The alternating bodyweight circuits — Mon / Wed / Fri                    */
  /* ------------------------------------------------------------------------ */

  {
    key: "bodyweight-circuit-a",
    name: "Bodyweight Circuit A",
    type: "circuit",
    rotationGroup: BODYWEIGHT_CIRCUIT,
    rotationIndex: 0,
    description: describe(CIRCUIT_FORMAT),
    exercises: session([
      {
        name: "Squats",
        prescription: "3 x 12–20",
        targetSets: 3,
        targetRepsLow: 12,
        targetRepsHigh: 20,
        notes:
          "Feet shoulder-width, sit back like you're reaching for a chair, chest up. Thighs to at least parallel.",
        mediaKey: "squat",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a bodyweight squat: standing with the feet about shoulder-width apart, then the bottom position with the hips sat back and down, the thighs at least parallel to the floor, the chest up and the heels still flat.",
      },
      {
        name: "Push-ups",
        prescription: "3 x 8–15",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 15,
        notes:
          "On toes if you can. If you can't get 8 clean, put your hands on a couch or step — not on your knees; elevated hands keeps the full-body line.",
        mediaKey: "push-up",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a push-up: the top, with the arms straight and the body in one line from heel to head, then the bottom, with the elbows bent and tucked back along the ribs rather than flared out sideways and the chest just above the floor.",
      },
      {
        name: "Reverse lunges",
        prescription: "3 x 8–12 each leg",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 12,
        notes:
          "Step back, drop the back knee toward the floor, push through the front heel to stand.",
        mediaKey: "reverse-lunge",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a lunge: standing tall, then the bottom position with one leg stepped back, the back knee lowered toward the floor, the front shin close to vertical and the torso upright. Photographed as a crossover step back; step straight back instead and the position is the same.",
      },
      {
        name: "Glute bridges",
        prescription: "3 x 15–20",
        targetSets: 3,
        targetRepsLow: 15,
        targetRepsHigh: 20,
        notes:
          "On your back, heels close to your bum, drive the hips up, squeeze at the top for 1 sec.",
        mediaKey: "glute-bridge",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a glute bridge: lying face up with the arms flat at the sides and the heels drawn in close to the bum, then the top, with the hips pushed up until the knees, hips and shoulders form one straight line.",
      },
      {
        name: "Plank",
        prescription: "3 x 30–60 sec",
        targetSets: 3,
        targetRepsLow: null,
        targetRepsHigh: null,
        targetSecondsLow: 30,
        targetSecondsHigh: 60,
        notes:
          "Straight line from heel to head. Squeeze the glutes — that's what stops the hips sagging.",
        mediaKey: "plank",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a front plank: setting up on the forearms with the elbows under the shoulders, then the hold, with the body in one straight line from heels to head and the hips neither sagging toward the floor nor piked up.",
      },
    ]),
  },

  {
    key: "bodyweight-circuit-b",
    name: "Bodyweight Circuit B",
    type: "circuit",
    rotationGroup: BODYWEIGHT_CIRCUIT,
    rotationIndex: 1,
    description: describe(CIRCUIT_FORMAT),
    exercises: session([
      {
        name: "Squat pulses",
        prescription: "3 x 15–20",
        targetSets: 3,
        targetRepsLow: 15,
        targetRepsHigh: 20,
        notes:
          "Sit into a squat, then pulse up and down in the bottom third of the range. Burns fast.",
        mediaKey: "squat",
        mediaKind: "image",
        mediaAlt:
          "The same squat as the full movement, shown standing and at the bottom. A pulse stays down near the bottom frame and moves through only the last few inches rather than standing all the way up between reps.",
      },
      {
        /*
         * Was "Pike push-ups" until FUEL-107.
         *
         * Swapped for a movement the form library actually photographs: no pike
         * push-up exists in it, `Hanging Pike` is a hanging leg raise and
         * `Handstand Push-Ups` is a far harder wall movement, so the pike would
         * have been the one working row on this circuit with no reference. It
         * holds the same slot — the vertical press and triceps work standing in
         * for overhead pressing — and needs only a chair, which the push-up note
         * two rows up already assumes you have.
         */
        name: "Bench dips",
        prescription: "3 x 8–15",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 15,
        notes:
          "Hands on the edge of a chair or step behind you, legs out in front, lower until the elbows are at about 90 degrees. Keep your back close to the chair — drifting forward turns it into a shoulder stretch.",
        mediaKey: "bench-dip",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a bench dip: arms straight with the hands on the edge of a chair behind you and the legs out in front, then the bottom, with the elbows bent to about 90 degrees and pointing straight back while the back stays close to the chair.",
      },
      {
        name: "Split squats",
        prescription: "3 x 8–12 each leg",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 12,
        notes:
          "Like a lunge, but the back foot stays planted for the whole set. Harder than reverse lunges — expect fewer reps.",
        mediaKey: "split-squat",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a split squat: standing in a long stride with one foot forward and one back, then the bottom, with the back knee lowered toward the floor and the weight kept over the front heel. The feet stay where they are between reps.",
      },
      {
        name: "Single-leg glute bridge",
        prescription: "3 x 8–12 each leg",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 12,
        notes: "As the glute bridge, one foot off the floor. Keep the hips level.",
        mediaKey: "single-leg-glute-bridge",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a single-leg glute bridge: lying face up with one heel drawn in and the other leg lifted clear of the floor, then the top, with the hips driven up until knee, hip and shoulder line up and the pelvis kept level rather than dropping on the free side.",
      },
      {
        name: "Mountain climbers",
        prescription: "3 x 30–40 total",
        targetSets: 3,
        targetRepsLow: 30,
        targetRepsHigh: 40,
        notes:
          "Plank position, drive the knees to the chest alternately. Keep the hips low — don't let them bounce up.",
        mediaKey: "mountain-climber",
        mediaKind: "image",
        mediaAlt:
          "Two frames of mountain climbers: the top of a push-up position with the arms straight and the body in one line, then one knee driven forward toward the chest while the hips stay low and the shoulders stay over the hands.",
      },
      {
        name: "Superman hold",
        prescription: "3 x 20–40 sec",
        targetSets: 3,
        targetRepsLow: null,
        targetRepsHigh: null,
        targetSecondsLow: 20,
        targetSecondsHigh: 40,
        notes:
          "Face down, lift chest and thighs off the floor. The only real posterior-chain and back work available without a pull-up bar — don't skip it.",
        mediaKey: "superman",
        mediaKind: "image",
        mediaAlt:
          "Two frames of a superman: lying face down with the arms stretched out ahead and the legs straight behind, then the lift, with the chest and thighs raised clear of the floor so only the hips and stomach stay in contact with it.",
      },
    ]),
  },

  /* ------------------------------------------------------------------------ */
  /* Kettlebell swings — Tue / Thu (FUEL-130)                                 */
  /* ------------------------------------------------------------------------ */

  /*
   * Kettlebell swings replaced Skipping Intervals + Core on Tue / Thu, after
   * Tim Ferriss's "The Perfect Posterior: Kettlebell Swings and Cheap
   * Alternatives" (tim.blog, 2011-01-08; The 4-Hour Body): the two-handed
   * Russian swing, 75 reps, 2–3 times a week.
   *
   * The skipping session is no longer in this file, and that is not the
   * history being rewritten. An existing user's skipping workout is a database
   * row their logs point at, and it stays; migration 0019 closes its template
   * rows the day before the change and opens this session's on it, so a past
   * Tuesday still resolves to skipping (schema.ts, `valid_from`). This file
   * seeds a NEW user, who never did the skipping session at all.
   *
   * Its own bookends rather than `session()`'s: the shared warm-up's "light
   * skipping" is movement prep for a rope, and a hinge session wants the
   * hinge rehearsed before it is loaded; the shared cool-down stretches the
   * calves "after skipping", where this one needs hamstrings and glutes.
   */
  {
    key: "kettlebell-swings",
    name: "Kettlebell Swings",
    type: "kettlebell",
    rotationGroup: null,
    rotationIndex: null,
    description: describe(
      [
        "### Format",
        "",
        "After the warm-up: 75 two-handed swings in total. If 75 in a row isn't",
        "there yet, do sets — anything from 10 to 25 — with about 60 sec rest",
        "between them, until the total reaches 75.",
      ].join("\n"),
      [
        "### The swing",
        "",
        "A hip hinge, not a squat. Hinge back with a flat back until the bell is",
        "between the thighs, then pop the hips forward and squeeze the glutes hard",
        "at the top. The bell floats to about chest height on straight arms — not",
        "overhead. Shoulders never go in front of the knees at the bottom.",
      ].join("\n"),
      [
        "### No core finisher",
        "",
        "The plank, dead bug and side plank that followed the skipping went with",
        "it. The swing is itself a posterior-chain and anti-extension movement —",
        "the plank at the top of every rep — so the session is the swings alone,",
        "as the source prescribes it.",
      ].join("\n"),
    ),
    exercises: [
      WARM_UP[0]!,
      {
        name: "Hinge prep",
        prescription: "~3 min",
        section: "warmup",
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes:
          "10 slow hip hinges with hands on the hips, 10 glute bridges, 10 bodyweight squats, then 5 easy swings.",
      },
      {
        name: "Kettlebell swings",
        prescription: "75 swings — sets of 10–25, ~60 s rest, until 75",
        // The total is its own column: 75 is not a set count, and the rows keep
        // coming until the logged reps reach it (FUEL-130). No `target_sets`,
        // because how many sets 75 takes is the reader's, not the program's.
        targetSets: null,
        targetRepsLow: 10,
        targetRepsHigh: 25,
        targetTotalReps: 75,
        takesLoad: true,
        notes:
          "Two hands. Hinge, snap the hips, squeeze the glutes; the bell floats to chest height.",
        // No form reference, and deliberately: see `form-media.ts` on FUEL-130.
      },
      {
        name: "Posterior-chain stretches",
        prescription: "30 sec each",
        section: "cooldown",
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes:
          "Hamstring stretch and figure-four glute stretch, each leg, then a kneeling hip-flexor stretch.",
      },
      COOL_DOWN[1]!,
    ],
  },

  /* ------------------------------------------------------------------------ */
  /* Every day, including weekends — and TWICE (FUEL-98)                      */
  /* ------------------------------------------------------------------------ */

  /*
   * Two walks, and they are two ROWS rather than one row logged twice.
   *
   * PRD § P1's routine table has always said "twice daily in practice", and its
   * snack rows anchor Snack 1 to "the mid-morning walk" and Snack 2 to "the
   * afternoon walk". The app modelled one, and the database could hold no more:
   * `workout_logs` is unique on `(user_id, date, workout_id)` and
   * `recordSession` upserts against that index, so a second walk on one date was
   * not refused — it OVERWROTE the first, and the duration went with it.
   *
   * Two rows is what fixes that with no migration and no widened key: two
   * workouts on one date are two `workout_id`s, which the index has always
   * allowed and which `resolve-training.ts` already resolves as two items. The
   * alternative — an occurrence number in the unique index — would be a live
   * migration on a table holding history, and it would buy a distinction nothing
   * could NAME. The names are the point: they are what makes § P1's anchoring
   * sentence describe the app rather than contradict it, and what lets two rows
   * on one screen be told apart by the person tapping them.
   *
   * Both keep `type: 'walk'`, so every layer that asks "is this the walk"
   * (`WALK_TYPE`, `isWalk`, `EDITABLE_WORKOUT_TYPES`, the reminder's library
   * read) goes on answering yes to both without learning a second vocabulary.
   * Neither gets a window — see `persona.ts` and the `workout_times` column
   * comment; a walk with a start time is the active card displacing a meal, and
   * with two walks that argument doubles rather than weakening.
   *
   * The old single row's description carried the split as an apology for the
   * model ("Split it if that's easier — 20 min after the midday work block and
   * 20 min in the evening"). It is the schedule now, so each row says when it is
   * and the sentence goes.
   */

  {
    key: "morning-walk",
    name: "Morning Walk",
    type: "walk",
    rotationGroup: null,
    rotationIndex: null,
    description: [
      "Separate from the training sessions, and every day including weekends.",
      "",
      "20 min, mid-morning — the walk Snack 1 is anchored to. Brisk enough that you",
      "could talk but wouldn't want to sing.",
      "",
      "This and the afternoon one together are the single biggest lever available",
      "against a desk job, and they cost nothing in hunger or recovery.",
    ].join("\n"),

    // No exercises. A walk is one undifferentiated activity, and P3 logs it with
    // a single tap rather than stepping through a list — an empty array is the
    // honest model, not a missing one.
    exercises: [],
  },

  {
    key: "afternoon-walk",
    name: "Afternoon Walk",
    type: "walk",
    rotationGroup: null,
    rotationIndex: null,
    description: [
      "Separate from the training sessions, and every day including weekends.",
      "",
      "20 min, late afternoon — the walk Snack 2 is anchored to. Do the lot in one",
      "go if the morning got away from you; 30–45 min across the day is the target.",
    ].join("\n"),

    exercises: [],
  },
];
