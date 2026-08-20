import type { Metadata } from "next";
import Link from "next/link";

import { RightNow } from "@/components/right-now";
import { ThemeToggle } from "@/components/theme-toggle";
import type { LoggedEntry } from "@/lib/day-summary";
import type { WalkEntryView } from "@/lib/walk";
import type { Meal, Workout, WorkoutExercise } from "@/lib/db/schema";
import type { MacroTarget } from "@/lib/macros";
import type { AnytimeItem, NowItem, NowView, ScheduledItem } from "@/lib/resolve-now";

/**
 * The Right Now specimen.
 *
 * Four of P1's acceptance criteria are claims about layout that jsdom cannot
 * evaluate: that the screen is usable one-handed at 375px, that the primary
 * action falls in the bottom third, that exactly one umber element is visible,
 * and that nothing scrolls sideways at 200% Dynamic Type. This is the surface
 * they are checked on — the same arrangement /dev/day-ruler makes for the
 * ruler's own two, and for the same reason.
 *
 * It also reaches the screen without a session or a database, which is what
 * makes it usable at all: `/` is behind the owner login and renders the owner's
 * real plan, and neither belongs in a screenshot.
 *
 * ## The fixture is invented
 *
 * Testing Strategy § 1.5 and PRD § Risks: the repository is public and the
 * owner's real day is confined to `docs/`. Every meal, macro and workout below
 * is made up for this page. They are plausible so the layout is exercised
 * honestly — a four-digit kcal beside a one-decimal gram weight is the case
 * that decides whether the grid holds at 375px — and they are nobody's.
 *
 * Not a product screen. Delete it once P1 is covered end to end by the
 * Playwright specs in FUEL-48, as with /dev/tokens.
 */
export const metadata: Metadata = {
  title: "Right Now",
  robots: { index: false, follow: false },
};

const USER = "dev-user";

const meal = (
  id: string,
  name: string,
  fields: Partial<Meal> = {},
): Meal => ({
  id,
  userId: USER,
  name,
  slotType: "dinner",
  kcal: 500,
  proteinG: 40,
  fatG: 15,
  carbG: 45,
  method: null,
  notes: null,
  isArchived: false,
  ...fields,
});

const workout = (id: string, name: string, fields: Partial<Workout> = {}): Workout => ({
  id,
  userId: USER,
  name,
  type: "circuit",
  description: null,
  rotationGroup: null,
  rotationIndex: null,
  ...fields,
});

const mealItem = (m: Meal, slot: Meal["slotType"], entryId: string): NowItem => ({
  kind: "meal",
  meal: { slot, meal: m, source: "template", entryId },
});

const workoutItem = (w: Workout, entryId: string): NowItem => ({
  kind: "workout",
  workout: { workout: w, source: "rotation", entryId },
});

const at = (item: NowItem, key: string, time: string, minutes: number): ScheduledItem => ({
  ...item,
  key,
  at: time,
  minutes,
});

/* -------------------------------------------------------------------------- */
/* The invented day                                                           */
/* -------------------------------------------------------------------------- */

const COFFEE = at(
  mealItem(meal("m0", "Coffee + MCT oil", { slotType: "extra", kcal: 118, proteinG: 0, fatG: 13, carbG: 0.4 }), "extra", "e0"),
  "meal:e0",
  "06:00",
  360,
);

const BREAKFAST = at(
  // The long-name case: 40px Title has to wrap without pushing the page wide.
  mealItem(meal("m1", "Overnight oats with berries", { slotType: "breakfast", kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 }), "breakfast", "e1"),
  "meal:e1",
  "07:00",
  420,
);

const SNACK = at(
  mealItem(meal("m2", "Greek yoghurt", { slotType: "snack", kcal: 184, proteinG: 19.4, fatG: 5.1, carbG: 14 }), "snack", "e2"),
  "meal:e2",
  "10:30",
  630,
);

const LUNCH = at(
  mealItem(meal("m3", "Chicken and rice bowl", { slotType: "lunch", kcal: 612, proteinG: 54.2, fatG: 14.6, carbG: 63.8 }), "lunch", "e3"),
  "meal:e3",
  "13:00",
  780,
);

const SESSION = at(
  workoutItem(workout("w1", "Circuit A", { rotationGroup: "bodyweight-circuit", rotationIndex: 0 }), "e4"),
  "workout:e4",
  "17:30",
  1050,
);

const DINNER = at(
  // The four-digit kcal case.
  mealItem(meal("m4", "Beef chilli", { kcal: 1024, proteinG: 68.3, fatG: 34.1, carbG: 82.5 }), "dinner", "e5"),
  "meal:e5",
  "19:00",
  1140,
);

const WALK: AnytimeItem = {
  ...workoutItem(workout("w2", "Daily walk", { type: "walk" }), "e6"),
  key: "workout:e6",
};

const TIMELINE = [COFFEE, BREAKFAST, SNACK, LUNCH, SESSION, DINNER];

/**
 * Dinner as it looks after a swap — FUEL-23.
 *
 * Resolved from an OVERRIDE rather than the template, which is the only thing
 * that puts the Swapped tag and the note on the card. The numbers are chosen so
 * the note reads the Brand Guide's own example: chickpea curry against the beef
 * chilli in `TEMPLATE_PLAN` is −21g protein and −140 kcal.
 */
const SWAPPED_DINNER = at(
  {
    kind: "meal",
    meal: {
      slot: "dinner",
      meal: meal("m7", "Chickpea curry", { kcal: 884, proteinG: 47.3, fatG: 26.4, carbG: 108.1 }),
      source: "override",
      entryId: "override-1",
    },
  },
  "meal:e5",
  "19:00",
  1140,
);

const SWAPPED_TIMELINE = [COFFEE, BREAKFAST, SNACK, LUNCH, SESSION, SWAPPED_DINNER];

/**
 * The library the picker offers, and what the template plans today.
 *
 * Both invented, like everything else on this page. The library is deliberately
 * more than one slot type deep so the sheet's "Show all meals" toggle has
 * something to reveal, and it includes an archived row so the filter that drops
 * it is visible by its absence.
 */
const LIBRARY = [
  meal("m4", "Beef chilli", { kcal: 1024, proteinG: 68.3, fatG: 34.1, carbG: 82.5 }),
  meal("m7", "Chickpea curry", { kcal: 884, proteinG: 47.3, fatG: 26.4, carbG: 108.1 }),
  meal("m8", "Salmon and greens", { kcal: 742, proteinG: 52.1, fatG: 38.4, carbG: 28.9 }),
  meal("m9", "Lentil stew", { kcal: 690, proteinG: 34.2, fatG: 18.1, carbG: 92.4 }),
  meal("m1", "Overnight oats with berries", { slotType: "breakfast", kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 }),
  meal("m2", "Greek yoghurt", { slotType: "snack", kcal: 184, proteinG: 19.4, fatG: 5.1, carbG: 14 }),
  meal("m10", "Retired traybake", { isArchived: true }),
];

/** What the template plans, which a swap never changes. */
const TEMPLATE_PLAN = TIMELINE.filter((item) => item.kind === "meal").map((item) => ({
  slot: item.meal.slot,
  meal: item.meal.meal,
}));


const EXERCISES = new Map<string, WorkoutExercise[]>([
  [
    "w1",
    [
      ["Press-ups", "3 x 12", null],
      ["Goblet squats", "3 x 15", "Keep the chest up"],
      ["Mountain climbers", "30s on / 30s off", null],
      ["Reverse lunges", "3 x 10 each side", null],
      ["Plank", "3 x 45s", "Hips level, ribs down"],
      ["Burpees", "2 x 8", null],
    ].map(([name, prescription, notes], sortOrder) => ({
      id: `ex-${sortOrder}`,
      userId: USER,
      workoutId: "w1",
      name: name as string,
      prescription: prescription as string,
      sortOrder,
      notes: notes as string | null,
    })),
  ],
]);

const base = (minutesOfDay: number) => ({
  date: "2026-03-09",
  minutesOfDay,
  timeline: TIMELINE,
  anytime: [WALK],
});

/**
 * The demo persona's targets — the same figures the seed library uses.
 *
 * Not invented freely, unlike the meals above: `targetKcal` and friends are
 * profile columns, and `scripts/check-no-metrics.sh` treats any literal
 * assigned to one as a body metric unless it is the persona's. Borrowing Sam
 * Rivera's numbers keeps the specimen honest AND keeps the repo-hygiene check
 * meaningful rather than exempting a path from it.
 *
 * The invented day above runs well over them, so the `complete` case exercises
 * the over-target reading — a `+460` in `error` on kcal — while
 * `complete-empty` shows the same screen entirely under. Between them the sign
 * convention is visible in both directions.
 */
const TARGET: MacroTarget = {
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
};

/** The day above, as it would look logged: two eaten, one skipped, two done. */
const LOGGED: LoggedEntry[] = [
  { id: "l1", name: "Coffee + MCT oil", status: "eaten", macros: { kcal: 118, proteinG: 0, fatG: 13, carbG: 0.4 } },
  { id: "l2", name: "Overnight oats with berries", status: "eaten", macros: { kcal: 486, proteinG: 32.5, fatG: 11.8, carbG: 58.2 } },
  { id: "l3", name: "Greek yoghurt", status: "skipped" },
  { id: "l4", name: "Chicken and rice bowl", status: "eaten", macros: { kcal: 612, proteinG: 54.2, fatG: 14.6, carbG: 63.8 } },
  { id: "l5", name: "Circuit A", status: "done" },
  { id: "l6", name: "Beef chilli", status: "eaten", macros: { kcal: 1024, proteinG: 68.3, fatG: 34.1, carbG: 82.5 } },
  // The walk's line carries `walk` (FUEL-29), which is what keeps the Undo
  // control off it: the bar's stack is over what the bar logged.
  { id: "l7", name: "Daily walk", status: "done", walk: true },
];

const activeAt = (
  index: number,
  minutesOfDay: number,
  timeline = TIMELINE,
): NowView => ({
  ...base(minutesOfDay),
  timeline,
  state: "active",
  index,
  active: timeline[index]!,
  upcoming: timeline.slice(index + 1),
});

/* -------------------------------------------------------------------------- */
/* The cases                                                                  */
/* -------------------------------------------------------------------------- */

const CASES: Record<
  string,
  {
    label: string;
    note: string;
    view: NowView;
    entries?: LoggedEntry[];
    /** What is recorded against the walk — FUEL-29. Unlogged unless named. */
    walk?: WalkEntryView;
  }
> = {
  meal: {
    label: "Meal",
    note: "The default case. 40px name, macro grid, three actions, NOW at 08:00.",
    view: activeAt(1, 8 * 60),
  },
  workout: {
    label: "Session",
    note: "Full exercise list, no macro grid, and no Swap — a session is skipped, not substituted.",
    view: activeAt(4, 17 * 60 + 45),
  },
  long: {
    label: "Long figures",
    note: "Four-digit kcal beside one-decimal grams. The case that decides whether the grid holds at 375px.",
    view: activeAt(5, 19 * 60 + 20),
  },
  swapped: {
    label: "Swapped",
    note: "Dinner resolved from an override. The Swapped tag is accent-subtle — a tinted ground, not the accent, which stays on the NOW marker. The note is the Brand Guide's own copy example, and Revert is offered beside Undo.",
    view: activeAt(5, 19 * 60 + 20, SWAPPED_TIMELINE),
  },
  last: {
    label: "Last item",
    note: "Nothing after it, so no Up next block. The action bar must still sit at the foot.",
    view: activeAt(5, 21 * 60),
  },
  complete: {
    label: "Day complete",
    note: "The finished page: actual against target, the day's log, and crop marks at the four corners. No ruler, no tab bar, no score.",
    view: { ...base(21 * 60 + 30), state: "day-complete" },
    entries: LOGGED,
  },
  "complete-empty": {
    label: "Day complete · nothing logged",
    note: "Reached by advancing past the last item by hand. Zero against target is the honest reading, and the log says what would have appeared.",
    view: { ...base(21 * 60 + 30), state: "day-complete" },
  },
  empty: {
    label: "Nothing planned",
    note: "Before the program starts, or a date the template does not cover. No ruler — there is no day to draw.",
    view: { ...base(9 * 60), state: "nothing-planned", timeline: [], anytime: [WALK] },
  },
  "walk-logged": {
    label: "Walk logged",
    note: "The Anytime row after one tap, with a duration set. Done and the minutes are words, not colour, and the presets stay on offer so 45 can become 60 or nothing.",
    view: activeAt(5, 19 * 60 + 20),
    walk: { durationMin: 45 },
  },
  "complete-walk": {
    label: "Day complete · walk outstanding",
    note: "The one thing the closed page still offers. The evening is when the walk is usually logged, so the day being finished and the walk being unlogged routinely overlap — everything else about the page stays closed.",
    view: { ...base(21 * 60 + 30), state: "day-complete" },
    entries: LOGGED.slice(0, 6),
  },
};

const DEFAULT_CASE = "meal";

export default async function RightNowSpecimen({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const requested = (await searchParams).case ?? DEFAULT_CASE;
  const key = requested in CASES ? requested : DEFAULT_CASE;
  const current = CASES[key]!;

  return (
    <>
      {/* The specimen comes FIRST and the switcher after it, deliberately.
          Nothing may sit above or over the screen under test: `min-h-dvh` with
          a `sticky` action bar is precisely what the 375px criterion is about,
          and both resolve against the viewport only when the specimen starts at
          its top. A fixed bar across the top was tried and hid the 40px title
          behind itself in every screenshot. Each case is addressable by URL, so
          the switcher is a convenience rather than the way in. */}
      <RightNow
        view={current.view}
        exercises={EXERCISES}
        entries={current.entries ?? []}
        walk={current.walk ?? null}
        target={TARGET}
        meals={LIBRARY}
        templatePlan={TEMPLATE_PLAN}
      />

      <div className="mx-auto flex max-w-[640px] flex-col gap-3 border-t border-border px-[22px] py-6 md:px-7">
        <p className="text-slash text-text-tertiary">{current.note}</p>

        {/* `overflow-x-auto`, because this page is where the "no horizontal
            scroll at 200% Dynamic Type" check is run and the harness must not
            be what fails it. The theme toggle is a single pill that cannot wrap
            internally, so at 200% it pushed the document to 508px while the
            specimen above it stayed at 375. Scrolling the chrome inside its own
            box is § Accessibility's own escape hatch, and keeps the failure —
            if there ever is one — attributable to the screen. */}
        <nav className="flex max-w-full flex-wrap items-center gap-2 overflow-x-auto">
          {Object.entries(CASES).map(([id, { label }]) => (
            <Link
              key={id}
              href={`/dev/right-now?case=${id}`}
              aria-current={id === key ? "page" : undefined}
              className="rounded-sm border border-border px-2 py-1 text-micro uppercase text-text-secondary aria-[current=page]:bg-ink aria-[current=page]:text-ink-fg"
            >
              {label}
            </Link>
          ))}
          <ThemeToggle />
        </nav>
      </div>
    </>
  );
}
