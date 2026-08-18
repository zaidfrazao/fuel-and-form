import { describe, expect, it } from "vitest";

import { type CalendarDate, parseTimeOfDay } from "./date";
import {
  type Meal,
  type MealSlot,
  mealSlot,
  type PlanTemplateEntry,
  type TrainingTemplateEntry,
  type Workout,
} from "./db/schema";
import {
  advance,
  buildTimeline,
  type Cursor,
  DEFAULT_SLOT_TIMES,
  DEFAULT_WORKOUT_TIMES,
  type NowItem,
  type NowView,
  type NowViewBase,
  positionAt,
  positionOf,
  resolveNow,
  retreat,
  type Schedule,
  scheduleFor,
} from "./resolve-now";
import type { Plan } from "./resolve-plan";
import type { TrainingPlan } from "./rotation";

/**
 * "Right Now" resolution — PRD § P1, and the E2E row the Testing Strategy calls
 * "Log and advance".
 *
 * The strategy's Tier 1 predates this resolver, so there is no numbered case
 * list to work through; the cases below come from P1's acceptance criteria
 * instead, and each `describe` names the one it covers.
 *
 * What makes this file worth its length is that almost every failure here is
 * SILENT. A window comparison that is one minute out, a day boundary read in the
 * server's zone, a skip that consumes two items — none of them throw, and all of
 * them produce a confident card showing the wrong meal. So the assertions are on
 * values and on order, never on "it returned something".
 *
 * ## The fixture week
 *
 * Program start is Monday 2026-03-02, the same date resolve-plan.test.ts and
 * rotation.test.ts use, so all three suites share one calendar.
 *
 *   Mon-Fri  coffee (extra) | oats | yoghurt (snack) | salad | chilli
 *   Sat/Sun  coffee (extra) | pancakes
 *   Mon/Wed/Fri  a rotation circuit    Tue/Thu  fixed intervals    every day  a walk
 *
 * That is the seeded shape of the real plan, deliberately: weekends are two
 * meals and a walk, and the walk is on the template every single day, which is
 * what makes "the walk must never be the active card" a real risk rather than a
 * hypothetical one.
 *
 * With the default schedule, a weekday resolves to six windows:
 *
 *   06:00 coffee | 07:00 oats | 10:30 yoghurt | 13:00 salad | 17:30 circuit | 19:00 chilli
 *
 * Which circuit is `rotation.ts`'s answer, not this file's, and it is asserted
 * rather than assumed: Monday 2026-03-09 is the fourth circuit day since the
 * program began (Mon, Wed, Fri of week one, then this one), so index 3 % 2 = 1 —
 * Circuit B. The DST Monday three weeks later is index 12 and comes back as
 * Circuit A, which is the incidental proof that the letter is derived from the
 * date rather than pinned to the weekday.
 *
 * ## Reading the instants
 *
 * Europe/London is on GMT for every fixture date below (BST 2026 begins on
 * 2026-03-29), so a 'Z' instant on those dates IS the London wall clock and
 * `clock()` can build one by concatenation. The two DST blocks are the exception
 * and construct their instants in UTC explicitly, with the offset written out.
 */

const USER = "user-owner";
const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";
const PROGRAM_START = "2026-03-02"; // a Monday

const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

/** Dates in the first full fixture week. Every weekday named was checked. */
const MON = "2026-03-09";
const TUE = "2026-03-10";
const SAT = "2026-03-07";
const SUN = "2026-03-08";

/**
 * An instant at a London wall-clock time — valid only while London is on GMT,
 * which every date above is. The DST tests below do not use it.
 */
const clock = (date: CalendarDate, time: string) => new Date(`${date}T${time}:00Z`);

/* -------------------------------------------------------------------------- */
/* Meals                                                                      */
/* -------------------------------------------------------------------------- */

function meal(id: string, fields: Partial<Meal> = {}): Meal {
  return {
    id,
    userId: USER,
    name: id,
    slotType: "dinner",
    kcal: 500,
    proteinG: 40,
    fatG: 15,
    carbG: 45,
    method: null,
    notes: null,
    isArchived: false,
    ...fields,
  };
}

const MEALS = [
  meal("coffee", { slotType: "extra", kcal: 120 }),
  meal("oats", { slotType: "breakfast", kcal: 420 }),
  meal("pancakes", { slotType: "breakfast", kcal: 610 }),
  meal("yoghurt", { slotType: "snack", kcal: 180 }),
  meal("salad", { slotType: "lunch", kcal: 480 }),
  meal("chilli", { kcal: 700 }),
];

let nextMealEntryId = 0;

function entry(day: number, slot: MealSlot, mealId: string): PlanTemplateEntry {
  nextMealEntryId += 1;

  return {
    id: `meal-entry-${nextMealEntryId}`,
    userId: USER,
    dayOfWeek: day,
    slot,
    mealId,
    sortOrder: 0,
  };
}

const WEEKDAYS = [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY];

const MEAL_TEMPLATE: PlanTemplateEntry[] = [
  ...WEEKDAYS.flatMap((day) => [
    entry(day, "extra", "coffee"),
    entry(day, "breakfast", "oats"),
    entry(day, "snack", "yoghurt"),
    entry(day, "lunch", "salad"),
    entry(day, "dinner", "chilli"),
  ]),
  ...[SATURDAY, SUNDAY].flatMap((day) => [
    entry(day, "extra", "coffee"),
    entry(day, "breakfast", "pancakes"),
  ]),
];

const PLAN: Plan = {
  programStartDate: PROGRAM_START,
  template: MEAL_TEMPLATE,
  overrides: [],
  meals: MEALS,
};

/* -------------------------------------------------------------------------- */
/* Training                                                                   */
/* -------------------------------------------------------------------------- */

function workout(id: string, fields: Partial<Workout> = {}): Workout {
  return {
    id,
    userId: USER,
    name: id,
    type: "circuit",
    description: null,
    rotationGroup: null,
    rotationIndex: null,
    ...fields,
  };
}

const CIRCUIT = "bodyweight-circuit";

const WORKOUTS = [
  workout("circuit-a", { rotationGroup: CIRCUIT, rotationIndex: 0 }),
  workout("circuit-b", { rotationGroup: CIRCUIT, rotationIndex: 1 }),
  workout("intervals", { type: "intervals" }),
  workout("walk", { type: "walk" }),
];

let nextTrainingEntryId = 0;

function training(
  day: number,
  fields: Pick<TrainingTemplateEntry, "workoutId" | "rotationGroup">,
  sortOrder = 0,
): TrainingTemplateEntry {
  nextTrainingEntryId += 1;

  return {
    id: `training-entry-${nextTrainingEntryId}`,
    userId: USER,
    dayOfWeek: day,
    sortOrder,
    ...fields,
  };
}

const rotated = (day: number) =>
  training(day, { workoutId: null, rotationGroup: CIRCUIT }, 0);

const fixed = (day: number, workoutId: string, sortOrder = 0) =>
  training(day, { workoutId, rotationGroup: null }, sortOrder);

const TRAINING: TrainingPlan = {
  programStartDate: PROGRAM_START,
  template: [
    rotated(MONDAY),
    rotated(WEDNESDAY),
    rotated(FRIDAY),
    fixed(TUESDAY, "intervals"),
    fixed(THURSDAY, "intervals"),
    // The walk, every day, sorting after the session on days that have one.
    ...[SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY].map((day) =>
      fixed(day, "walk", 1),
    ),
  ],
  workouts: WORKOUTS,
};

/* -------------------------------------------------------------------------- */
/* Schedules                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The fixture routine, written out rather than taken from `DEFAULT_SLOT_TIMES`.
 *
 * Everything below this line tests RESOLUTION — how a tie breaks, which window
 * owns the boundary minute, how far one tap moves the cursor — and none of it is
 * a claim about what time anyone eats. Built from the defaults, those tests
 * inherited a dependency on the product's configuration: FUEL-21 re-confirmed
 * the routine, moved training from 17:30 to 06:30, and fourteen tests about
 * mechanics failed for it. None of them had found a bug.
 *
 * So the two are separated. These times are a fixture and are chosen to exercise
 * the resolver — spread across the day, with a deliberate tie at 13:00 — and the
 * real defaults are asserted on their own, in `describe("the default schedule")`
 * below, which is where a wrong figure genuinely is a failure.
 */
const SCHEDULE: Schedule = {
  timeZone: LONDON,
  slotTimes: {
    extra: "06:00",
    breakfast: "07:00",
    snack: "10:30",
    lunch: "13:00",
    dinner: "19:00",
  },
  workoutTimes: { circuit: "17:30", intervals: "17:30" },
};

/** The same routine, resolved for someone whose zone is not the fixture's. */
const NEW_YORK_SCHEDULE: Schedule = { ...SCHEDULE, timeZone: NEW_YORK };

/**
 * A readable label for an item: 'oats' or 'circuit-b', not an entry id.
 *
 * Every assertion below compares these rather than whole objects. An entry id is
 * a fixture accident, and a failure reading "expected oats, got yoghurt" says
 * which meal was served where a diff of two hydrated rows does not.
 */
const nameOf = (item: NowItem): string =>
  item.kind === "meal" ? item.meal.meal.name : item.workout.workout.name;

const namesOf = (items: NowItem[]) => items.map(nameOf);

/** The active item's name, or the state when there is no active item. */
function activeName(view: NowView): string {
  return view.state === "active" ? nameOf(view.active) : view.state;
}

const resolve = (now: Date, cursor?: Cursor | null, schedule: Schedule = SCHEDULE) =>
  resolveNow({ plan: PLAN, training: TRAINING, schedule, now, cursor });

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("buildTimeline", () => {
  it("orders the day by the clock, not by slot order", () => {
    // The coffee is an `extra`, which is LAST in SLOT_ORDER and first in the day.
    // A timeline built on the slot enum's order would put it after dinner — the
    // 06:00 item, bottom of the list.
    const { timeline } = buildTimeline(PLAN, TRAINING, SCHEDULE, MON);

    expect(namesOf(timeline)).toEqual([
      "coffee",
      "oats",
      "yoghurt",
      "salad",
      "circuit-b",
      "chilli",
    ]);
    expect(timeline.map((item) => item.at)).toEqual([
      "06:00",
      "07:00",
      "10:30",
      "13:00",
      "17:30",
      "19:00",
    ]);
  });

  it("carries both the printable time and the minute count", () => {
    // The card renders one and the resolution compares the other, so a divergence
    // between them is a view that says 13:00 and behaves like something else.
    const { timeline } = buildTimeline(PLAN, TRAINING, SCHEDULE, MON);

    for (const item of timeline) {
      expect(item.minutes).toBe(parseTimeOfDay(item.at));
    }
  });

  it("keeps the walk out of the timeline and in anytime", () => {
    // The walk is on the template every day. Give it a window and it becomes the
    // active card every evening, displacing dinner five days a week.
    const { timeline, anytime } = buildTimeline(PLAN, TRAINING, SCHEDULE, MON);

    expect(namesOf(timeline)).not.toContain("walk");
    expect(namesOf(anytime)).toEqual(["walk"]);
  });

  it("treats a workout type it does not recognise as unscheduled", () => {
    // `workouts.type` is text, not an enum, so that a future 'strength' is new
    // rows and no migration. The resolver has to survive meeting one: unscheduled
    // is the answer, not a crash and not 17:30 by assumption.
    const gymPlan: TrainingPlan = {
      ...TRAINING,
      template: [fixed(MONDAY, "gym", 2), ...TRAINING.template],
      workouts: [...WORKOUTS, workout("gym", { type: "strength" })],
    };

    const { timeline, anytime } = buildTimeline(PLAN, gymPlan, SCHEDULE, MON);

    expect(namesOf(timeline)).not.toContain("gym");
    expect(namesOf(anytime)).toContain("gym");
  });

  it("treats a meal slot with no configured time as unscheduled", () => {
    // `slot_times` is partial JSON. A slot missing from it is the weekend's flex
    // lunch, not a reason to invent a window for it.
    const partial: Schedule = {
      ...SCHEDULE,
      slotTimes: { ...DEFAULT_SLOT_TIMES, lunch: undefined },
    };

    const { timeline, anytime } = buildTimeline(PLAN, TRAINING, partial, MON);

    expect(namesOf(timeline)).not.toContain("salad");
    expect(namesOf(anytime)).toEqual(["salad", "walk"]);
  });

  it("breaks a tie between a meal and a session by putting the meal first", () => {
    // Two items can share a start time, and the order still has to be total —
    // manual advance walks through them one tap each, so a pair that reordered
    // itself between renders would make a tap skip the wrong one.
    const collide: Schedule = {
      ...SCHEDULE,
      slotTimes: { ...DEFAULT_SLOT_TIMES, dinner: "17:30" },
    };

    const { timeline } = buildTimeline(PLAN, TRAINING, collide, MON);

    expect(namesOf(timeline)).toEqual([
      "coffee",
      "oats",
      "yoghurt",
      "salad",
      "chilli",
      "circuit-b",
    ]);
  });

  it("breaks a tie between two meals by slot order", () => {
    // Both at 13:00: lunch precedes snack because SLOT_ORDER does, which is the
    // order resolveDay returned them in.
    const collide: Schedule = {
      ...SCHEDULE,
      slotTimes: { ...DEFAULT_SLOT_TIMES, snack: "13:00" },
    };

    const { timeline } = buildTimeline(PLAN, TRAINING, collide, MON);

    expect(namesOf(timeline).slice(2, 4)).toEqual(["salad", "yoghurt"]);
  });

  it("is empty before the program starts", () => {
    const { timeline, anytime } = buildTimeline(PLAN, TRAINING, SCHEDULE, "2026-02-23");

    expect(timeline).toEqual([]);
    expect(anytime).toEqual([]);
  });
});

describe("the active item is the one whose window contains the clock", () => {
  it.each([
    ["06:00", "coffee", "the first window, at its own start"],
    ["06:30", "coffee", "inside the first window"],
    ["09:00", "oats", "mid-morning"],
    ["12:00", "yoghurt", "the snack window runs until lunch, not until noon"],
    ["13:00", "salad", "lunch, at its start"],
    ["16:00", "salad", "still lunch — nothing else has started"],
    ["18:00", "circuit-b", "the session"],
    ["20:00", "chilli", "dinner"],
    ["23:59", "chilli", "the last window runs to midnight"],
  ])("at %s resolves %s — %s", (time, expected) => {
    expect(activeName(resolve(clock(MON, time)))).toBe(expected);
  });

  it("gives the boundary minute to the later window", () => {
    // Half-open windows: [start, next start). One minute apart, and the pair is
    // the whole of what "the window containing the clock" means.
    expect(activeName(resolve(clock(MON, "12:59")))).toBe("yoghurt");
    expect(activeName(resolve(clock(MON, "13:00")))).toBe("salad");
  });

  it("makes the first of two items sharing a window the active one", () => {
    // Dinner moved onto the session's 17:30. The clock cannot separate them, so
    // the first is active and a tap moves to the second — the same mechanism as
    // everywhere else, rather than a window that skips its own first item.
    // Coverage cannot see this: taking the LAST of the tie runs exactly the same
    // lines.
    const collide: Schedule = {
      ...SCHEDULE,
      slotTimes: { ...DEFAULT_SLOT_TIMES, dinner: "17:30" },
    };

    const view = resolve(clock(MON, "17:30"), null, collide);

    expect(activeName(view)).toBe("chilli");
    expect(activeName(resolve(clock(MON, "17:30"), advance(view), collide))).toBe(
      "circuit-b",
    );
  });

  it("clamps to the first item before the day's first start", () => {
    // 05:00 is before the coffee. "Nothing yet" is the honest answer and an empty
    // screen is the wrong one: P1 promises a single dominant card.
    const view = resolve(clock(MON, "05:00"));

    expect(view.state).toBe("active");
    expect(activeName(view)).toBe("coffee");
    if (view.state === "active") expect(view.index).toBe(0);
  });

  it("lists everything still to come, in order", () => {
    const view = resolve(clock(MON, "09:00"));

    expect(view.state).toBe("active");
    if (view.state !== "active") return;

    expect(view.index).toBe(1);
    expect(namesOf(view.upcoming)).toEqual(["yoghurt", "salad", "circuit-b", "chilli"]);
    // P1 shows the next two. The slice is the view's, so the resolver hands over
    // all of them rather than deciding a layout question here.
    expect(namesOf(view.upcoming.slice(0, 2))).toEqual(["yoghurt", "salad"]);
  });

  it("has nothing upcoming in the last window", () => {
    const view = resolve(clock(MON, "22:00"));

    expect(view.state).toBe("active");
    if (view.state === "active") expect(view.upcoming).toEqual([]);
  });

  it("offers the walk at every hour without ever making it the active card", () => {
    for (const hour of ["05:00", "09:00", "13:00", "18:00", "23:59"]) {
      const view = resolve(clock(MON, hour));

      expect(namesOf(view.anytime)).toEqual(["walk"]);
      expect(activeName(view)).not.toBe("walk");
    }
  });

  it("reports the clock it resolved against", () => {
    // The card's "now" line, and the reason nothing downstream needs to read a
    // clock of its own and risk reading a different one.
    expect(resolve(clock(MON, "13:20")).minutesOfDay).toBe(13 * 60 + 20);
  });
});

describe("the day boundary follows the configured timezone", () => {
  it("resolves one instant differently for two zones", () => {
    // 03:00 Tuesday in London is 23:00 Monday in New York — EDT by then, since US
    // clocks changed on 2026-03-08 and Britain's have not. A different DATE and a
    // different item, from one instant. Whichever of the two the server's zone
    // happens to be, reading it instead is wrong for the other.
    const instant = new Date("2026-03-10T03:00:00Z");

    const london = resolve(instant);
    const newYork = resolve(instant, null, NEW_YORK_SCHEDULE);

    expect(london.date).toBe(TUE);
    expect(activeName(london)).toBe("coffee");

    expect(newYork.date).toBe(MON);
    expect(activeName(newYork)).toBe("chilli");
  });

  it("serves the new day's plan after local midnight, not the old day's (§ 1.1 case 7)", () => {
    // 23:30 UTC on Sunday the 29th is 00:30 BST on Monday the 30th. Truncating
    // the ISO string would say Sunday, and Sunday's plan is pancakes with no
    // lunch — the whole shape of the day, not just its clock, would be wrong.
    const instant = new Date("2026-03-29T23:30:00Z");
    const view = resolve(instant);

    expect(instant.toISOString().slice(0, 10)).toBe("2026-03-29");
    expect(view.date).toBe("2026-03-30");
    expect(namesOf(view.timeline)).toEqual([
      "coffee",
      "oats",
      "yoghurt",
      "salad",
      "circuit-a",
      "chilli",
    ]);
    expect(activeName(view)).toBe("coffee");
  });

  it("resolves both passes of the repeated hour identically (§ 1.1 case 8)", () => {
    // 01:30 happens twice on Sunday 2026-10-25 in London, an hour apart. The same
    // wall-clock minute resolves the same item both times: the clock is not
    // monotonic within a day, and nothing here assumes it is.
    const firstPass = resolve(new Date("2026-10-25T00:30:00Z")); // 01:30 BST
    const secondPass = resolve(new Date("2026-10-25T01:30:00Z")); // 01:30 GMT

    expect(firstPass).toEqual(secondPass);
    expect(firstPass.date).toBe("2026-10-25");
    expect(firstPass.minutesOfDay).toBe(90);
    expect(activeName(firstPass)).toBe("coffee");
  });
});

describe("manual advance", () => {
  it("moves to the next item", () => {
    const before = resolve(clock(MON, "09:00"));
    const after = resolve(clock(MON, "09:00"), advance(before));

    expect(activeName(before)).toBe("oats");
    expect(activeName(after)).toBe("yoghurt");
  });

  it("advances without logging anything or removing the item", () => {
    // "Advances without logging completion": the item advanced past is still in
    // the day, unchanged. Nothing here records that it happened — and nothing
    // here could, which is the stronger of the two guarantees: a resolver that
    // is never handed logs cannot come to depend on them.
    const before = resolve(clock(MON, "09:00"));
    const after = resolve(clock(MON, "09:00"), advance(before));

    expect(namesOf(after.timeline)).toEqual(namesOf(before.timeline));
    expect(after.timeline[1]).toEqual(before.timeline[1]);
  });

  it("does not advance again when the clock catches up", () => {
    // Skip the snack at 12:00 and lunch is active an hour early. At 13:00 the
    // clock reaches lunch on its own, and the tap must not still be pushing:
    // one tap is one item. A COUNT of taps gives 'circuit-a' here — two items
    // skipped for one tap, and the bug is invisible until an hour later.
    const skipped = advance(resolve(clock(MON, "12:00")));

    expect(activeName(resolve(clock(MON, "12:00"), skipped))).toBe("salad");
    expect(activeName(resolve(clock(MON, "13:00"), skipped))).toBe("salad");
    expect(activeName(resolve(clock(MON, "17:30"), skipped))).toBe("circuit-b");
  });

  it("walks the whole day, one item per tap, and ends complete", () => {
    // The property behind "never wrong for longer than one tap", asserted as a
    // sequence rather than as seven separate cases: from the first window, taps
    // visit every item in order and then stop.
    const now = clock(MON, "06:00");
    const visited: string[] = [];

    let view = resolve(now);
    let cursor = advance(view);

    while (cursor) {
      visited.push(activeName(view));
      view = resolve(now, cursor);
      cursor = advance(view);
    }

    expect(visited).toEqual([
      "coffee",
      "oats",
      "yoghurt",
      "salad",
      "circuit-b",
      "chilli",
    ]);
    expect(view.state).toBe("day-complete");
  });

  it("ignores a cursor from another day", () => {
    // It expires at the day boundary with nothing having to clear it. Yesterday's
    // dinner tap must not open today on a day-complete summary.
    //
    // The cursor is yesterday's DATE with a key that is real today, which is the
    // only version of this test that can fail: one naming an item the clock has
    // already passed anyway would pass whether the date is checked or not.
    const dinnerTap = advance(resolve(clock(MON, "20:00")));
    const yesterday: Cursor = { ...dinnerTap!, date: SUN };

    expect(activeName(resolve(clock(MON, "09:00"), yesterday))).toBe("oats");
    // What honouring it would do, spelled out: the day, over, at nine in the
    // morning.
    expect(activeName(resolve(clock(MON, "09:00"), dinnerTap))).toBe("day-complete");
  });

  it("ignores a cursor naming an item the day no longer has", () => {
    // A swap can reshape the day underneath a cursor. Falling back to the clock
    // is right; picking whatever now sits at that position is how a tap ends up
    // silently applied to a different meal.
    const stale: Cursor = { date: MON, advancedPast: "meal:deleted-entry" };

    expect(activeName(resolve(clock(MON, "09:00"), stale))).toBe("oats");
  });

  it("returns no cursor when there is nothing to advance past", () => {
    const dinner = resolve(clock(MON, "20:00"));
    const complete = resolve(clock(MON, "20:00"), advance(dinner));

    expect(complete.state).toBe("day-complete");
    expect(advance(complete)).toBeNull();
  });
});

describe("the day-complete state", () => {
  it("follows the last item, once it has been advanced past", () => {
    // The last window has no end — the clock alone runs dinner to midnight and
    // then the date rolls over. Advancing past it is the deliberate "I'm done",
    // which is why it is a state and not a cutoff time someone has to configure.
    const dinner = resolve(clock(MON, "20:00"));
    const view = resolve(clock(MON, "20:00"), advance(dinner));

    expect(view.state).toBe("day-complete");
    // The day's items are all still there: the summary is rendered FROM them,
    // and a state that emptied the timeline would have nothing to total.
    expect(namesOf(view.timeline)).toHaveLength(6);
    expect(namesOf(view.anytime)).toEqual(["walk"]);
  });

  it("is not reached by the clock alone, however late", () => {
    expect(resolve(clock(MON, "23:59")).state).toBe("active");
  });
});

describe("weekends resolve to walk-only for training", () => {
  it.each([
    [SAT, "Saturday"],
    [SUN, "Sunday"],
  ])("has no session on %s (%s)", (date) => {
    const view = resolve(clock(date, "18:00"));

    expect(namesOf(view.timeline)).toEqual(["coffee", "pancakes"]);
    expect(namesOf(view.anytime)).toEqual(["walk"]);
    // 18:00 on a weekday is the circuit. Here the day is over as far as windows
    // go, and breakfast is still the active card until it is tapped past.
    expect(activeName(view)).toBe("pancakes");
  });

  it("still has a session on a weekday, so the above is not vacuous", () => {
    // The weekend assertions above pass just as well against a resolver that
    // dropped training entirely. This is the positive that rules that out.
    expect(namesOf(resolve(clock(MON, "18:00")).timeline)).toContain("circuit-b");
    expect(activeName(resolve(clock(MON, "18:00")))).toBe("circuit-b");
  });
});

describe("the nothing-planned state", () => {
  it("covers a date before the program starts", () => {
    const view = resolve(clock("2026-02-23", "09:00"));

    expect(view.state).toBe("nothing-planned");
    expect(view.timeline).toEqual([]);
    expect(view.anytime).toEqual([]);
  });

  it("covers a day the template does not cover", () => {
    const weekdaysOnly: TrainingPlan = {
      ...TRAINING,
      template: TRAINING.template.filter((row) => WEEKDAYS.includes(row.dayOfWeek)),
    };

    const view = resolveNow({
      plan: { ...PLAN, template: MEAL_TEMPLATE.filter((row) => row.dayOfWeek !== SATURDAY) },
      training: weekdaysOnly,
      schedule: SCHEDULE,
      now: clock(SAT, "09:00"),
    });

    expect(view.state).toBe("nothing-planned");
  });

  it("does not mean the day is empty — an unscheduled day still has its items", () => {
    // Nothing has a window, so there is no active card and nothing to advance
    // through, but every item is there to be logged. A state that discarded them
    // would lose the whole day rather than just its clock.
    const untimed: Schedule = { timeZone: LONDON, slotTimes: {}, workoutTimes: {} };
    const view = resolve(clock(MON, "09:00"), null, untimed);

    expect(view.state).toBe("nothing-planned");
    // Meals in SLOT_ORDER then training, which is the order the two resolvers
    // returned them in — `anytime` has no clock to sort by, so it keeps theirs.
    expect(namesOf(view.anytime)).toEqual([
      "oats",
      "salad",
      "yoghurt",
      "chilli",
      "coffee",
      "circuit-b",
      "walk",
    ]);
    expect(advance(view)).toBeNull();
  });
});

describe("the default schedule", () => {
  it("gives every slot in the enum a time", () => {
    // Asserted against `mealSlot.enumValues` rather than restated, so a slot
    // added to the schema without a default here is a failing test rather than a
    // meal that silently never appears on the timeline.
    expect(Object.keys(DEFAULT_SLOT_TIMES).sort()).toEqual([...mealSlot.enumValues].sort());
  });

  it("is the PRD § P1 table, in order", () => {
    const order = (["extra", "breakfast", "snack", "lunch", "dinner"] as const).map((slot) =>
      parseTimeOfDay(DEFAULT_SLOT_TIMES[slot]),
    );

    expect(DEFAULT_SLOT_TIMES.extra).toBe("06:00");
    expect(DEFAULT_SLOT_TIMES.dinner).toBe("18:30");
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("leaves the walk unscheduled", () => {
    // Load-bearing, not an omission: the walk is on the template every day, and
    // a time here would make it the active card every evening.
    expect(DEFAULT_WORKOUT_TIMES).not.toHaveProperty("walk");
    expect(DEFAULT_WORKOUT_TIMES.circuit).toBe("06:30");
    expect(DEFAULT_WORKOUT_TIMES.intervals).toBe("06:30");
  });

  it("puts training inside the morning routine, before breakfast", () => {
    // FUEL-21, and the ordering consequence of it: the session is at 06:30,
    // between the 06:00 coffee and breakfast at 07:30. Pinned because it is the
    // whole reason `buildTimeline` sorts by the clock rather than by kind — a
    // resolver that ordered meals before training would put breakfast first and
    // be wrong about the morning every day.
    expect(parseTimeOfDay(DEFAULT_WORKOUT_TIMES.circuit!)).toBeGreaterThan(
      parseTimeOfDay(DEFAULT_SLOT_TIMES.extra),
    );
    expect(parseTimeOfDay(DEFAULT_WORKOUT_TIMES.circuit!)).toBeLessThan(
      parseTimeOfDay(DEFAULT_SLOT_TIMES.breakfast),
    );
  });

  it("holds only times this app can parse", () => {
    for (const time of [
      ...Object.values(DEFAULT_SLOT_TIMES),
      ...Object.values(DEFAULT_WORKOUT_TIMES),
    ]) {
      expect(() => parseTimeOfDay(time)).not.toThrow();
    }
  });
});

describe("scheduleFor", () => {
  it("prefers the profile's times and falls back to the defaults", () => {
    const schedule = scheduleFor({
      timeZone: LONDON,
      slotTimes: { breakfast: "08:15" },
    });

    expect(schedule.slotTimes.breakfast).toBe("08:15");
    expect(schedule.slotTimes.lunch).toBe(DEFAULT_SLOT_TIMES.lunch);
    expect(schedule.timeZone).toBe(LONDON);
    expect(schedule.workoutTimes).toEqual(DEFAULT_WORKOUT_TIMES);
  });

  it("takes effect immediately — an edited time moves the window", () => {
    // P1's "slot times are editable in settings and take effect immediately".
    // Nothing is cached between these two calls because there is nothing to
    // cache: the schedule is an argument.
    const later = scheduleFor({ timeZone: LONDON, slotTimes: { lunch: "14:00" } });

    expect(activeName(resolve(clock(MON, "13:30")))).toBe("salad");
    expect(activeName(resolve(clock(MON, "13:30"), null, later))).toBe("yoghurt");
  });

  it("survives an empty slot_times, which is how a profile starts", () => {
    const schedule = scheduleFor({ timeZone: LONDON, slotTimes: {} });

    expect(schedule.slotTimes).toEqual(DEFAULT_SLOT_TIMES);
  });

  it("distinguishes a slot never configured from one cleared to null", () => {
    // The distinction FUEL-21 added, and the reason the merge is not a spread.
    // Absent takes the default; `null` — which only settings writes — removes
    // the key, so the slot has no window at all.
    const schedule = scheduleFor({
      timeZone: LONDON,
      slotTimes: { lunch: null },
    });

    expect(schedule.slotTimes.breakfast).toBe(DEFAULT_SLOT_TIMES.breakfast);
    expect(schedule.slotTimes).not.toHaveProperty("lunch");
  });

  it("leaves the key absent rather than present-and-null", () => {
    // The failure this guards is specific and would not show up above: spreading
    // `{ lunch: null }` over the defaults leaves the KEY there holding `null`,
    // and `buildTimeline` tests `at === undefined`. A null would sail past that
    // check into `parseTimeOfDay(null)` and throw — on `/`, on every request.
    const schedule = scheduleFor({ timeZone: LONDON, slotTimes: { lunch: null } });

    expect(Object.keys(schedule.slotTimes)).not.toContain("lunch");
    expect(schedule.slotTimes.lunch).toBeUndefined();
  });

  it("sends a cleared slot to anytime rather than dropping its meal", () => {
    // The behaviour the null is FOR. The meal is still on the plan and still
    // loggable; it just has no window, exactly like the daily walk.
    const cleared = scheduleFor({
      timeZone: LONDON,
      slotTimes: { ...SCHEDULE.slotTimes, lunch: null },
    });
    const view = resolve(clock(MON, "13:30"), null, cleared);

    expect(namesOf(view.timeline)).not.toContain("salad");
    expect(namesOf(view.anytime)).toContain("salad");
  });

  it("survives a slot_times holding a JSON null rather than an object", () => {
    // `jsonb NOT NULL` forbids a SQL NULL and permits a JSON one, so the column
    // can hold `'null'::jsonb` whatever the TypeScript type claims. The merge
    // this replaced spread rather than iterated, and `{ ...null }` is `{}` —
    // so tolerating this is not a new nicety, it is not regressing.
    const schedule = scheduleFor({
      timeZone: LONDON,
      slotTimes: null as never,
      workoutTimes: null as never,
    });

    expect(schedule.slotTimes).toEqual(DEFAULT_SLOT_TIMES);
    expect(schedule.workoutTimes).toEqual(DEFAULT_WORKOUT_TIMES);
  });

  it("renders a day rather than throwing on a corrupt slot_times", () => {
    // The failure that matters is not the wrong window, it is `/` returning a
    // 500 on every request until someone edits the row by hand.
    const corrupt = scheduleFor({ timeZone: LONDON, slotTimes: "07:00" as never });

    expect(() => resolve(clock(MON, "13:30"), null, corrupt)).not.toThrow();
    expect(corrupt.slotTimes).toEqual(DEFAULT_SLOT_TIMES);
  });

  it("treats a non-string time as no time, rather than handing it to the parser", () => {
    // A number or a nested object in the column would reach `parseTimeOfDay`
    // and throw. Unscheduled is the degradation that keeps the screen up.
    const schedule = scheduleFor({
      timeZone: LONDON,
      slotTimes: { lunch: 1300, dinner: { at: "18:30" } } as never,
    });

    expect(schedule.slotTimes).not.toHaveProperty("lunch");
    expect(schedule.slotTimes).not.toHaveProperty("dinner");
    expect(schedule.slotTimes.breakfast).toBe(DEFAULT_SLOT_TIMES.breakfast);
  });

  it("reads workout times from the profile, defaulting the types it omits", () => {
    const schedule = scheduleFor({
      timeZone: LONDON,
      slotTimes: {},
      workoutTimes: { circuit: "18:00" },
    });

    expect(schedule.workoutTimes.circuit).toBe("18:00");
    expect(schedule.workoutTimes.intervals).toBe(DEFAULT_WORKOUT_TIMES.intervals);
  });

  it("unschedules a workout type cleared to null", () => {
    const schedule = scheduleFor({
      timeZone: LONDON,
      slotTimes: {},
      workoutTimes: { circuit: null },
    });

    expect(schedule.workoutTimes).not.toHaveProperty("circuit");
    expect(schedule.workoutTimes.intervals).toBe(DEFAULT_WORKOUT_TIMES.intervals);
  });

  it("defaults workout times when the profile has none — the pre-FUEL-21 row", () => {
    // `workout_times` was added with a `{}` default, so every profile written
    // before the migration reads as absent rather than as deliberately empty.
    // Those rows must keep resolving their sessions, not lose them.
    const schedule = scheduleFor({ timeZone: LONDON, slotTimes: {} });

    expect(schedule.workoutTimes).toEqual(DEFAULT_WORKOUT_TIMES);
  });
});

describe("a malformed slot time", () => {
  it("throws rather than resolving a window that never opens", () => {
    // `slot_times` is free-shaped JSON with no CHECK behind it, so a typo in a
    // settings form reaches here. Throwing is right: silently dropping the slot
    // would hide breakfast for a day and look like a plan that lost a meal.
    const typo: Schedule = {
      ...SCHEDULE,
      slotTimes: { ...DEFAULT_SLOT_TIMES, breakfast: "7am" },
    };

    expect(() => resolve(clock(MON, "09:00"), null, typo)).toThrow(/Not a time of day/);
  });
});

/* -------------------------------------------------------------------------- */
/* Positioning — the rule P1's optimistic card shares with the resolver        */
/* -------------------------------------------------------------------------- */

/** The day's shape on its own, which is what a position is applied to. */
const baseFor = (date: CalendarDate, time: string): NowViewBase => {
  const view = resolve(clock(date, time));

  return {
    date: view.date,
    minutesOfDay: view.minutesOfDay,
    timeline: view.timeline,
    anytime: view.anytime,
  };
};

/** A day where everything is unscheduled — the walk, and nothing else. */
const EMPTY_DAY: NowViewBase = {
  date: MON,
  minutesOfDay: 9 * 60,
  timeline: [],
  anytime: [],
};

describe("positionAt", () => {
  it("gives the same answer the resolver gives for the same position", () => {
    // The whole reason it is exported: the card advances by calling this, and a
    // second implementation living in a component would be free to disagree
    // with the server about what a tap did.
    const view = resolve(clock(MON, "13:30"));
    const base = baseFor(MON, "13:30");

    expect(positionAt(base, view.state === "active" ? view.index : -1)).toEqual(view);
  });

  it("names the item at the position, and everything after it as upcoming", () => {
    const base = baseFor(MON, "07:30");

    const view = positionAt(base, 2);

    expect(activeName(view)).toBe("yoghurt");
    expect(view.state === "active" && namesOf(view.upcoming)).toEqual([
      "salad",
      "circuit-b",
      "chilli",
    ]);
  });

  it("is day-complete one past the end", () => {
    const base = baseFor(MON, "07:30");

    expect(positionAt(base, base.timeline.length).state).toBe("day-complete");
  });

  it("is nothing-planned when the day has no scheduled items at all", () => {
    // A day whose every item is unscheduled. Position is irrelevant when there
    // is nothing to be positioned in, so it is checked at both ends.
    expect(positionAt(EMPTY_DAY, 0).state).toBe("nothing-planned");
    expect(positionAt(EMPTY_DAY, 4).state).toBe("nothing-planned");
  });

  it("clamps a negative position rather than indexing off the front", () => {
    // Reachable from the optimistic reducer: undo taken twice against a base
    // that has already moved back. `timeline[-1]` is `undefined`, and rendering
    // that is a crash on the one screen that must always render.
    const base = baseFor(MON, "07:30");

    expect(activeName(positionAt(base, -3))).toBe("coffee");
  });
});

describe("positionOf", () => {
  it("reads the index of an active view", () => {
    const view = resolve(clock(MON, "13:30"));

    expect(positionOf(view)).toBe(3);
  });

  it("puts a day-complete view one past the end, where it came from", () => {
    // The round trip that matters: a position turned into a view and back.
    const base = baseFor(MON, "19:30");
    const complete = positionAt(base, base.timeline.length);

    expect(complete.state).toBe("day-complete");
    expect(positionOf(complete)).toBe(base.timeline.length);
  });

  it("puts a nothing-planned view at zero of zero", () => {
    expect(positionOf(positionAt(EMPTY_DAY, 0))).toBe(0);
  });
});

describe("retreat", () => {
  it("names the item before the one being taken back", () => {
    // At 13:30 the salad is active; undoing the yoghurt's log brings the
    // yoghurt back, which means having advanced past the oats and no further.
    const view = resolve(clock(MON, "13:30"));

    expect(activeName(view)).toBe("salad");
    expect(retreat(view)).toEqual({
      date: MON,
      advancedPast: view.state === "active" ? view.timeline[view.index - 2]!.key : null,
    });
    expect(activeName(positionAt(baseFor(MON, "13:30"), 2))).toBe("yoghurt");
  });

  it("clears the cursor at the start of the day, rather than pointing before it", () => {
    const view = resolve(clock(MON, "06:30"));

    expect(retreat(view)).toBeNull();
  });

  it("steps back into the last item from a day-complete view", () => {
    // The case with no active item to read, and the one that happens every time
    // the final log of the day is taken back.
    const base = baseFor(MON, "19:30");
    const complete = positionAt(base, base.timeline.length);

    expect(retreat(complete)).toEqual({
      date: MON,
      advancedPast: base.timeline[base.timeline.length - 2]!.key,
    });
  });

  it("has nothing to step back into on a day with no timeline", () => {
    expect(retreat(positionAt(EMPTY_DAY, 0))).toBeNull();
  });
});
