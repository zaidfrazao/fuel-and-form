import { BODYWEIGHT_CIRCUIT, type SeedWorkout } from "./types";

/**
 * The workout library — PRD § P7 → repository privacy.
 *
 * Exercises and prescriptions, no body data. The source program's arithmetic
 * about maintenance, deficit and goal pace is deliberately not reproduced here:
 * those are metrics, they belong in the database via the gitignored owner script
 * (FUEL-15), and this is a committed file.
 *
 * ## The shared warm-up and cool-down live in `description`, not `exercises`
 *
 * Every session opens with the same ~5 minute warm-up and closes with the same
 * ~3–4 minute cool-down. Modelling those as `workout_exercises` rows would
 * trip P3's "next exercise" affordance over eleven rows of mobility work before
 * reaching the first working set, and would duplicate them across all three
 * sessions. So `exercises` holds the working set — the part that changes between
 * A and B, and the part progression applies to — and the invariant bookends are
 * markdown in `description`, rendered alongside.
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
 */

/**
 * Prepended to every session's description. One constant rather than three
 * copies, so a change to the warm-up cannot land on two sessions and miss one.
 */
const WARM_UP = [
  "### Warm-up (~5 min, non-negotiable)",
  "",
  "- 30 sec light skipping or marching on the spot",
  "- 10 arm circles forward, 10 backward",
  "- 10 bodyweight squats, slow and controlled",
  "- 10 leg swings each leg, front to back",
  "- 10 shoulder rolls + 5 slow torso twists each side",
].join("\n");

/** Likewise, appended to every session. */
const COOL_DOWN = [
  "### Cool-down (~3–4 min)",
  "",
  "Hold each for 30 sec: quad stretch (each leg), hamstring stretch (each leg),",
  "calf stretch against a wall (each leg — especially after skipping), chest",
  "doorway stretch, child's pose.",
].join("\n");

/** The circuits share a format line as well as their bookends. */
const CIRCUIT_FORMAT = [
  "### Format",
  "",
  "3 rounds. Each exercise back to back with ~20 sec rest between exercises,",
  "then 90 sec rest between rounds. Start at the bottom of each rep range and",
  "work up over the weeks.",
].join("\n");

const describe = (...sections: string[]) =>
  [WARM_UP, ...sections, COOL_DOWN].join("\n\n");

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
    exercises: [
      {
        name: "Squats",
        prescription: "3 x 12–20",
        notes:
          "Feet shoulder-width, sit back like you're reaching for a chair, chest up. Thighs to at least parallel.",
      },
      {
        name: "Push-ups",
        prescription: "3 x 8–15",
        notes:
          "On toes if you can. If you can't get 8 clean, put your hands on a couch or step — not on your knees; elevated hands keeps the full-body line.",
      },
      {
        name: "Reverse lunges",
        prescription: "3 x 8–12 each leg",
        notes:
          "Step back, drop the back knee toward the floor, push through the front heel to stand.",
      },
      {
        name: "Glute bridges",
        prescription: "3 x 15–20",
        notes:
          "On your back, heels close to your bum, drive the hips up, squeeze at the top for 1 sec.",
      },
      {
        name: "Plank",
        prescription: "3 x 30–60 sec",
        notes:
          "Straight line from heel to head. Squeeze the glutes — that's what stops the hips sagging.",
      },
    ],
  },

  {
    key: "bodyweight-circuit-b",
    name: "Bodyweight Circuit B",
    type: "circuit",
    rotationGroup: BODYWEIGHT_CIRCUIT,
    rotationIndex: 1,
    description: describe(CIRCUIT_FORMAT),
    exercises: [
      {
        name: "Squat pulses",
        prescription: "3 x 15–20",
        notes:
          "Sit into a squat, then pulse up and down in the bottom third of the range. Burns fast.",
      },
      {
        name: "Pike push-ups",
        prescription: "3 x 6–12",
        notes:
          "Hands and feet on the floor, hips high in an upside-down V, lower the crown of your head toward the floor. This is the shoulder work standing in for overhead pressing.",
      },
      {
        name: "Split squats",
        prescription: "3 x 8–12 each leg",
        notes:
          "Like a lunge, but the back foot stays planted for the whole set. Harder than reverse lunges — expect fewer reps.",
      },
      {
        name: "Single-leg glute bridge",
        prescription: "3 x 8–12 each leg",
        notes: "As the glute bridge, one foot off the floor. Keep the hips level.",
      },
      {
        name: "Mountain climbers",
        prescription: "3 x 30–40 total",
        notes:
          "Plank position, drive the knees to the chest alternately. Keep the hips low — don't let them bounce up.",
      },
      {
        name: "Superman hold",
        prescription: "3 x 20–40 sec",
        notes:
          "Face down, lift chest and thighs off the floor. The only real posterior-chain and back work available without a pull-up bar — don't skip it.",
      },
    ],
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
    exercises: [
      {
        name: "Skipping intervals",
        prescription: "8–12 rounds — 40 sec on / 40 sec off",
        notes:
          "Build to 12 rounds before shortening the rest. Trips don't cost you the interval.",
      },
      {
        name: "Plank",
        prescription: "3 x 30–45 sec",
        notes: "Core finisher, straight after the intervals.",
      },
      {
        name: "Dead bug",
        prescription: "3 x 10 each side",
        notes:
          "On your back, opposite arm and leg extend slowly. The lower back stays pressed to the floor throughout.",
      },
      {
        name: "Side plank",
        prescription: "2 x 20–30 sec each side",
        notes: null,
      },
    ],
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
