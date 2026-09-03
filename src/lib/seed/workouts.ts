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
 * The skipping session and the walk name no group. They are scheduled by a fixed
 * `workout_id` on their template rows, and the schema's `workouts_rotation_pair`
 * check keeps `rotation_group` and `rotation_index` null together.
 *
 * ## The structured targets are transcribed by hand, and three of them are null
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
 *     first two numbers would offer "Target 30–60" against a plank.
 *   - '8–12 rounds — 40 sec on / 40 sec off' has no target of either kind.
 *     Rounds are not sets, the first number in the string is 8, and an
 *     interval session logged as eight sets of eight reps would be a record of
 *     something nobody did. It is null, and the screen still logs sets against
 *     it — they simply have nothing to be compared to.
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
          "The bottom of a push-up: the body held in one straight line from heel to head, hands under the shoulders, elbows bent and tucked back along the ribs rather than flared out sideways, chest lowered to just above the floor.",
      },
      {
        name: "Reverse lunges",
        prescription: "3 x 8–12 each leg",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 12,
        notes:
          "Step back, drop the back knee toward the floor, push through the front heel to stand.",
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
          "The top of a glute bridge: lying face up with the arms flat at the sides, heels drawn in close to the bum, and the hips pushed up until the knees, hips and shoulders form one straight line.",
      },
      {
        name: "Plank",
        prescription: "3 x 30–60 sec",
        targetSets: 3,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes:
          "Straight line from heel to head. Squeeze the glutes — that's what stops the hips sagging.",
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
      },
      {
        name: "Pike push-ups",
        prescription: "3 x 6–12",
        targetSets: 3,
        targetRepsLow: 6,
        targetRepsHigh: 12,
        notes:
          "Hands and feet on the floor, hips high in an upside-down V, lower the crown of your head toward the floor. This is the shoulder work standing in for overhead pressing.",
      },
      {
        name: "Split squats",
        prescription: "3 x 8–12 each leg",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 12,
        notes:
          "Like a lunge, but the back foot stays planted for the whole set. Harder than reverse lunges — expect fewer reps.",
      },
      {
        name: "Single-leg glute bridge",
        prescription: "3 x 8–12 each leg",
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 12,
        notes: "As the glute bridge, one foot off the floor. Keep the hips level.",
        mediaKey: "glute-bridge",
        mediaKind: "image",
        mediaAlt:
          "The top of a two-footed glute bridge, which this version holds with one foot lifted clear: shoulders and the working heel on the floor, hips driven up until knee, hip and shoulder line up, and the pelvis kept level rather than dropping on the free side.",
      },
      {
        name: "Mountain climbers",
        prescription: "3 x 30–40 total",
        targetSets: 3,
        targetRepsLow: 30,
        targetRepsHigh: 40,
        notes:
          "Plank position, drive the knees to the chest alternately. Keep the hips low — don't let them bounce up.",
      },
      {
        name: "Superman hold",
        prescription: "3 x 20–40 sec",
        targetSets: 3,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes:
          "Face down, lift chest and thighs off the floor. The only real posterior-chain and back work available without a pull-up bar — don't skip it.",
        mediaKey: "superman",
        mediaKind: "image",
        mediaAlt:
          "The lift of a superman hold: face down with the arms stretched out ahead and the legs straight behind, both raised clear of the floor so that only the hips and stomach stay in contact with it.",
      },
    ]),
  },

  /* ------------------------------------------------------------------------ */
  /* Cardio — Tue / Thu                                                       */
  /* ------------------------------------------------------------------------ */

  {
    key: "skipping-intervals-core",
    name: "Skipping Intervals + Core",
    type: "intervals",
    rotationGroup: null,
    rotationIndex: null,
    description: describe(
      [
        "### Format",
        "",
        "After the warm-up: 8–12 rounds of 40 sec skipping at a pace you can just",
        "about sustain, then 40 sec rest — walk on the spot, don't sit down.",
        "",
        "Start at 8 rounds. Add a round each week until you reach 12, then start",
        "shortening the rest to 30 sec rather than adding further rounds.",
      ].join("\n"),
      [
        "### Coming back to the rope",
        "",
        "Your calves and feet will complain before your lungs do. For the first two",
        "sessions cut to 6 rounds of 30 sec even if it feels easy — the tissue needs",
        "time to adapt, and calf or Achilles soreness from going too hard too early is",
        "the single most likely thing to derail this.",
        "",
        "Tripping is normal and doesn't matter. Keep the clock running, pick the rope",
        "back up, carry on. Don't restart the interval.",
      ].join("\n"),
    ),
    exercises: session([
      {
        name: "Skipping intervals",
        prescription: "8–12 rounds — 40 sec on / 40 sec off",
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes:
          "Build to 12 rounds before shortening the rest. Trips don't cost you the interval.",
      },
      {
        name: "Plank",
        prescription: "3 x 30–45 sec",
        targetSets: 3,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes: "Core finisher, straight after the intervals.",
      },
      {
        name: "Dead bug",
        prescription: "3 x 10 each side",
        targetSets: 3,
        targetRepsLow: 10,
        targetRepsHigh: 10,
        notes:
          "On your back, opposite arm and leg extend slowly. The lower back stays pressed to the floor throughout.",
      },
      {
        name: "Side plank",
        prescription: "2 x 20–30 sec each side",
        targetSets: 2,
        targetRepsLow: null,
        targetRepsHigh: null,
        notes: null,
        mediaKey: "side-plank",
        mediaKind: "image",
        mediaAlt:
          "A side plank: propped on one forearm with the body turned onto its side, feet stacked one on the other, and the hips lifted so that head, hips and heels make one straight line.",
      },
    ]),
  },

  /* ------------------------------------------------------------------------ */
  /* Every day, including weekends                                            */
  /* ------------------------------------------------------------------------ */

  {
    key: "daily-walk",
    name: "Daily Walk",
    type: "walk",
    rotationGroup: null,
    rotationIndex: null,
    description: [
      "Separate from the training sessions, and every day including weekends.",
      "",
      "30–45 min. Split it if that's easier — 20 min after the midday work block and",
      "20 min in the evening — or do the lot in one go. Brisk enough that you could",
      "talk but wouldn't want to sing.",
      "",
      "This is the single biggest lever available against a desk job, and it costs",
      "nothing in hunger or recovery.",
    ].join("\n"),

    // No exercises. A walk is one undifferentiated activity, and P3 logs it with
    // a single tap rather than stepping through a list — an empty array is the
    // honest model, not a missing one.
    exercises: [],
  },
];
