import { describe, expect, it } from "vitest";

import { todayIn } from "./date";
import {
  type DayPlanOverride,
  type Meal,
  type MealSlot,
  mealSlot,
  type PlanTemplateEntry,
} from "./db/schema";
import {
  type Plan,
  resolveDay,
  resolveSlot,
  resolveWeek,
  SLOT_ORDER,
  templateDay,
  templateSlot,
} from "./resolve-plan";

/**
 * Testing Strategy § 1.1 — the fourteen cases, in order, each named by number.
 *
 * The PRD ranks subtle date bugs in this resolver as an M/H risk, and the
 * strategy calls it "the single most test-worthy file in the project". Cases 7
 * and 8 are the two that surface twice a year and look like data corruption, so
 * they are asserted here end to end — an instant, through the configured
 * timezone, to the meals the app would actually render — as well as one level
 * down in date.test.ts.
 *
 * ## The fixture week
 *
 * A plausible plan rather than a minimal one, because most of these cases are
 * about a query landing on the WRONG row, and rows have to exist for that to be
 * possible at all.
 *
 *   Mon-Fri  breakfast oats   | lunch chicken salad | dinner chilli
 *   Sat      breakfast pancakes                     | dinner curry
 *   Sun      breakfast pancakes                     | dinner stew (ARCHIVED)
 *   Wed also has a snack. No day has an `extra`.
 *
 * The gaps are load-bearing: weekend lunch is case 6's evidence that weekdays
 * are not being served on a Saturday, the missing snacks are case 10, and
 * Sunday's archived stew is case 14.
 *
 * Program start is Monday 2026-03-02. Every date below was checked against the
 * calendar: 2026-03-29 and 2026-10-25 are Sundays, and they are Europe/London's
 * two 2026 transitions.
 */

const USER = "user-owner";
const LONDON = "Europe/London";
const PROGRAM_START = "2026-03-02"; // a Monday

const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

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
  meal("oats", { slotType: "breakfast", kcal: 420 }),
  meal("pancakes", { slotType: "breakfast", kcal: 610 }),
  meal("chicken-salad", { slotType: "lunch", kcal: 480 }),
  meal("chilli", { kcal: 700 }),
  meal("curry", { kcal: 760 }),
  meal("yoghurt", { slotType: "snack", kcal: 180 }),
  // Retired from the picker, still named by Sunday's template entry (case 14).
  meal("stew", { kcal: 690, isArchived: true }),
];

let nextEntryId = 0;

function entry(day: number, slot: MealSlot, mealId: string, sortOrder = 0): PlanTemplateEntry {
  nextEntryId += 1;

  return {
    id: `entry-${nextEntryId}`,
    userId: USER,
    dayOfWeek: day,
    slot,
    mealId,
    sortOrder,
  };
}

const WEEKDAYS = [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY];

const TEMPLATE: PlanTemplateEntry[] = [
  ...WEEKDAYS.flatMap((day) => [
    entry(day, "breakfast", "oats"),
    entry(day, "lunch", "chicken-salad"),
    entry(day, "dinner", "chilli"),
  ]),
  entry(WEDNESDAY, "snack", "yoghurt"),
  entry(SATURDAY, "breakfast", "pancakes"),
  entry(SATURDAY, "dinner", "curry"),
  entry(SUNDAY, "breakfast", "pancakes"),
  entry(SUNDAY, "dinner", "stew"),
];

function override(
  date: string,
  slot: MealSlot,
  mealId: string,
  id = `override-${date}-${slot}`,
): DayPlanOverride {
  return {
    id,
    userId: USER,
    date,
    slot,
    mealId,
    createdAt: new Date("2026-03-01T12:00:00Z"),
  };
}

function plan(overrides: DayPlanOverride[] = [], fields: Partial<Plan> = {}): Plan {
  return {
    programStartDate: PROGRAM_START,
    template: TEMPLATE,
    overrides,
    meals: MEALS,
    ...fields,
  };
}

/** What a slot resolved to, compressed to the two things every case asserts. */
const resolved = (result: ReturnType<typeof resolveSlot>) =>
  result && { meal: result.meal.id, source: result.source };

const dayMeals = (subject: Plan, date: string) =>
  resolveDay(subject, date).map((item) => [item.slot, item.meal.id, item.source]);

describe("SLOT_ORDER", () => {
  it("still matches the meal_slot enum exactly, in order", () => {
    // resolve-plan.ts restates the slots rather than importing the enum at
    // runtime, so that a client component can use the resolver without pulling
    // Drizzle into its bundle. This is the price of that: a slot added to the
    // schema and not to SLOT_ORDER would silently never resolve, in the day
    // view and in the macro totals alike. Here it is a failing test instead.
    //
    // The test may import the schema freely — nothing bundles a test file.
    expect(SLOT_ORDER).toEqual([...mealSlot.enumValues]);
  });
});

/* -------------------------------------------------------------------------- */
/* The fourteen cases                                                         */
/* -------------------------------------------------------------------------- */

describe("§ 1.1 case 1 — no override exists", () => {
  it("resolves the template entry for that weekday", () => {
    // Tuesday 2026-03-10.
    expect(resolved(resolveSlot(plan(), "2026-03-10", "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
  });

  it("resolves the whole day from the template, in the order it is eaten", () => {
    expect(dayMeals(plan(), "2026-03-10")).toEqual([
      ["breakfast", "oats", "template"],
      ["lunch", "chicken-salad", "template"],
      ["dinner", "chilli", "template"],
    ]);
  });
});

describe("§ 1.1 case 2 — an override exists for that exact date and slot", () => {
  const swapped = plan([override("2026-03-10", "dinner", "curry")]);

  it("resolves the override, marked as one", () => {
    expect(resolved(resolveSlot(swapped, "2026-03-10", "dinner"))).toEqual({
      meal: "curry",
      source: "override",
    });
  });

  it("hands back the override's id, so the swap can be reverted in one tap", () => {
    expect(resolveSlot(swapped, "2026-03-10", "dinner")?.entryId).toBe(
      "override-2026-03-10-dinner",
    );
  });

  it("leaves the template physically untouched", () => {
    // The PRD's claim in the one form that can actually be checked: resolution
    // is a read, and reading a swapped day does not reorder or edit the
    // recurring plan even in memory.
    const before = structuredClone(TEMPLATE);

    resolveDay(swapped, "2026-03-10");
    resolveWeek(swapped, "2026-03-10");

    expect(TEMPLATE).toEqual(before);
  });
});

describe("§ 1.1 case 3 — an override on a different slot, same date", () => {
  it("leaves the queried slot on its template entry", () => {
    const swapped = plan([override("2026-03-10", "breakfast", "pancakes")]);

    expect(dayMeals(swapped, "2026-03-10")).toEqual([
      ["breakfast", "pancakes", "override"],
      ["lunch", "chicken-salad", "template"],
      ["dinner", "chilli", "template"],
    ]);
  });
});

describe("§ 1.1 case 4 — an override on the same slot, next week", () => {
  it("resolves the template for the queried date", () => {
    // The acceptance criterion in P2: "next week's same weekday still shows the
    // original template meal after a swap". Both Tuesdays, one swapped.
    const swapped = plan([override("2026-03-10", "dinner", "curry")]);

    expect(resolved(resolveSlot(swapped, "2026-03-17", "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
    expect(resolved(resolveSlot(swapped, "2026-03-03", "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
  });
});

describe("§ 1.1 case 5 — the Sunday to Monday boundary", () => {
  it("steps from Sunday's plan to Monday's, not back into the week", () => {
    // Sunday 2026-03-08 into Monday 2026-03-09: day_of_week 0 -> 1. An
    // off-by-one here would serve Saturday's pancakes on a Sunday, or the
    // weekend plan on a Monday.
    expect(dayMeals(plan(), "2026-03-08")).toEqual([
      ["breakfast", "pancakes", "template"],
      ["dinner", "stew", "template"],
    ]);
    expect(dayMeals(plan(), "2026-03-09")).toEqual([
      ["breakfast", "oats", "template"],
      ["lunch", "chicken-salad", "template"],
      ["dinner", "chilli", "template"],
    ]);
  });

  it("puts Sunday at the end of a Monday-first week, not the start", () => {
    // Storage is 0=Sunday; the grid runs Monday to Sunday. This is where the
    // two conventions meet, and the only place either of them is visible.
    const week = resolveWeek(plan(), "2026-03-08");

    expect(week.map((day) => day.date)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    expect(week.at(-1)?.meals.map((item) => item.meal.id)).toEqual(["pancakes", "stew"]);
  });
});

describe("§ 1.1 case 6 — Saturday and Sunday", () => {
  it("resolves weekend entries, and not the weekday ones", () => {
    expect(dayMeals(plan(), "2026-03-07")).toEqual([
      ["breakfast", "pancakes", "template"],
      ["dinner", "curry", "template"],
    ]);
    expect(dayMeals(plan(), "2026-03-08")).toEqual([
      ["breakfast", "pancakes", "template"],
      ["dinner", "stew", "template"],
    ]);
  });

  it("does not invent the weekday lunch the weekend template omits", () => {
    expect(resolveSlot(plan(), "2026-03-07", "lunch")).toBeNull();
  });
});

describe("§ 1.1 case 7 — a date in the spring-forward transition", () => {
  // Europe/London, 2026-03-29: the clocks go forward at 01:00 GMT, so the day
  // is 23 hours long and BST begins.
  const springForward = plan();

  it("keeps the short day a single date", () => {
    for (const instant of ["2026-03-29T00:30:00Z", "2026-03-29T12:00:00Z", "2026-03-29T22:30:00Z"]) {
      expect(todayIn(LONDON, new Date(instant))).toBe("2026-03-29");
    }

    expect(dayMeals(springForward, "2026-03-29")).toEqual([
      ["breakfast", "pancakes", "template"],
      ["dinner", "stew", "template"],
    ]);
  });

  it("follows the configured timezone rather than UTC", () => {
    // 23:30 UTC is 00:30 BST — Monday has begun in London while UTC still says
    // Sunday. Truncating an ISO string would serve Sunday's pancakes to someone
    // looking at their phone after midnight on Monday morning.
    const justAfterMidnightInLondon = new Date("2026-03-29T23:30:00Z");

    expect(justAfterMidnightInLondon.toISOString().slice(0, 10)).toBe("2026-03-29");

    const date = todayIn(LONDON, justAfterMidnightInLondon);

    expect(date).toBe("2026-03-30");
    expect(dayMeals(springForward, date)).toEqual([
      ["breakfast", "oats", "template"],
      ["lunch", "chicken-salad", "template"],
      ["dinner", "chilli", "template"],
    ]);
  });

  it("follows the configured timezone rather than the server's", () => {
    // One instant, two configured zones, two days' plans. Whatever zone this
    // suite runs under, it cannot be both — so nothing here can be passing by
    // accident because the machine happens to sit in London.
    const instant = new Date("2026-03-29T23:30:00Z");

    expect(todayIn(LONDON, instant)).toBe("2026-03-30");
    expect(todayIn("America/New_York", instant)).toBe("2026-03-29");
    expect(dayMeals(springForward, todayIn("America/New_York", instant))).toEqual([
      ["breakfast", "pancakes", "template"],
      ["dinner", "stew", "template"],
    ]);
  });
});

describe("§ 1.1 case 8 — a date in the fall-back transition", () => {
  // Europe/London, 2026-10-25: the clocks go back at 02:00 BST, so 01:00-02:00
  // happens twice and the day is 25 hours long.
  const fallBack = plan();

  it("resolves both passes of the repeated hour to the same single day", () => {
    const firstPass = new Date("2026-10-25T00:30:00Z"); // 01:30 BST
    const secondPass = new Date("2026-10-25T01:30:00Z"); // 01:30 GMT, an hour later

    expect(todayIn(LONDON, firstPass)).toBe("2026-10-25");
    expect(todayIn(LONDON, secondPass)).toBe(todayIn(LONDON, firstPass));

    // A resolver that treated the repeated hour as a second day would serve
    // this Sunday's meals twice and lose Monday's.
    expect(dayMeals(fallBack, todayIn(LONDON, firstPass))).toEqual([
      ["breakfast", "pancakes", "template"],
      ["dinner", "stew", "template"],
    ]);
    expect(dayMeals(fallBack, todayIn(LONDON, secondPass))).toEqual(
      dayMeals(fallBack, todayIn(LONDON, firstPass)),
    );
  });

  it("covers all 25 hours with one date, and then moves on to the next", () => {
    // The boundaries either side of the long day. The 24th's dinner is curry
    // (Saturday), the 25th's is stew (Sunday), the 26th's is chilli (Monday) —
    // three different days, each once.
    const boundaries = [
      ["2026-10-24T22:30:00Z", "2026-10-24", "curry"],
      ["2026-10-24T23:30:00Z", "2026-10-25", "stew"],
      ["2026-10-25T23:30:00Z", "2026-10-25", "stew"],
      ["2026-10-26T00:30:00Z", "2026-10-26", "chilli"],
    ] as const;

    for (const [instant, expectedDate, expectedDinner] of boundaries) {
      const date = todayIn(LONDON, new Date(instant));

      expect(date).toBe(expectedDate);
      expect(resolveSlot(fallBack, date, "dinner")?.meal.id).toBe(expectedDinner);
    }
  });

  it("gives the long week exactly seven distinct days", () => {
    const week = resolveWeek(plan(), "2026-10-25");

    expect(week.map((day) => day.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(new Set(week.map((day) => day.date)).size).toBe(7);
  });
});

describe("§ 1.1 case 9 — a date before program_start_date", () => {
  it("resolves to nothing, and does not throw", () => {
    // 2026-03-01, the Sunday before the program starts.
    expect(resolveDay(plan(), "2026-03-01")).toEqual([]);
    expect(resolveSlot(plan(), "2026-03-01", "breakfast")).toBeNull();
  });

  it("resolves to nothing even where an override exists", () => {
    // Nothing was planned then, so nothing was swapped then either. One rule,
    // applied before the tables are consulted at all.
    const swapped = plan([override("2026-03-01", "dinner", "curry")]);

    expect(resolveDay(swapped, "2026-03-01")).toEqual([]);
    expect(resolveSlot(swapped, "2026-03-01", "dinner")).toBeNull();
  });

  it("starts on the start date itself", () => {
    expect(resolveSlot(plan(), PROGRAM_START, "breakfast")?.meal.id).toBe("oats");
  });
});

describe("§ 1.1 case 10 — a slot with no template entry at all", () => {
  it("returns null rather than throwing", () => {
    // Monday has no snack; no day has an `extra`.
    expect(resolveSlot(plan(), "2026-03-09", "snack")).toBeNull();
    expect(resolveSlot(plan(), "2026-03-09", "extra")).toBeNull();
  });

  it("omits it from the day rather than filling it in", () => {
    expect(dayMeals(plan(), "2026-03-09").map(([slot]) => slot)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
  });

  it("still resolves the slots the day does have", () => {
    // Wednesday is the one day with a snack, so the gap is a property of the
    // template rather than of the resolver.
    expect(resolveSlot(plan(), "2026-03-11", "snack")?.meal.id).toBe("yoghurt");
  });
});

describe("§ 1.1 case 11 — a repeat across three consecutive dates", () => {
  it("resolves the override on all three, and the template on the fourth", () => {
    // "Thawed too much mince" — Tuesday, Wednesday and Thursday become curry.
    const repeat = plan([
      override("2026-03-10", "dinner", "curry"),
      override("2026-03-11", "dinner", "curry"),
      override("2026-03-12", "dinner", "curry"),
    ]);

    for (const date of ["2026-03-10", "2026-03-11", "2026-03-12"]) {
      expect(resolved(resolveSlot(repeat, date, "dinner"))).toEqual({
        meal: "curry",
        source: "override",
      });
    }

    expect(resolved(resolveSlot(repeat, "2026-03-13", "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
  });
});

describe("§ 1.1 case 12 — a repeat spanning a month boundary", () => {
  it("resolves every date across the boundary", () => {
    // Monday 2026-03-30 through Wednesday 2026-04-01.
    const repeat = plan([
      override("2026-03-30", "dinner", "curry"),
      override("2026-03-31", "dinner", "curry"),
      override("2026-04-01", "dinner", "curry"),
    ]);

    expect(
      ["2026-03-30", "2026-03-31", "2026-04-01"].map((date) =>
        resolved(resolveSlot(repeat, date, "dinner")),
      ),
    ).toEqual([
      { meal: "curry", source: "override" },
      { meal: "curry", source: "override" },
      { meal: "curry", source: "override" },
    ]);

    // The days either side keep the template — the repeat did not smear across
    // the month end in either direction.
    expect(resolved(resolveSlot(repeat, "2026-03-29", "dinner"))).toEqual({
      meal: "stew",
      source: "template",
    });
    expect(resolved(resolveSlot(repeat, "2026-04-02", "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
  });

  it("resolves a week that straddles the boundary", () => {
    const repeat = plan([override("2026-04-01", "dinner", "curry")]);
    const week = resolveWeek(repeat, "2026-04-01");

    expect(week.map((day) => day.date)).toEqual([
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
    ]);
    expect(week.map((day) => day.meals.at(-1)?.meal.id)).toEqual([
      "chilli",
      "chilli",
      "curry",
      "chilli",
      "chilli",
      "curry", // Saturday
      "stew", // Sunday
    ]);
  });
});

describe("§ 1.1 case 13 — a reverted override", () => {
  it("falls back to the template once the row is gone", () => {
    // A revert is a DELETE, not a tombstone: the same query, with the row no
    // longer among the overrides, answers from the template again.
    const swapped = plan([override("2026-03-10", "dinner", "curry")]);
    const reverted = plan([]);

    expect(resolved(resolveSlot(swapped, "2026-03-10", "dinner"))).toEqual({
      meal: "curry",
      source: "override",
    });
    expect(resolved(resolveSlot(reverted, "2026-03-10", "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
  });

  it("reverts only the slot whose row was removed", () => {
    const partiallyReverted = plan([override("2026-03-10", "breakfast", "pancakes")]);

    expect(dayMeals(partiallyReverted, "2026-03-10")).toEqual([
      ["breakfast", "pancakes", "override"],
      ["lunch", "chicken-salad", "template"],
      ["dinner", "chilli", "template"],
    ]);
  });
});

describe("§ 1.1 case 14 — an archived meal referenced by a template entry", () => {
  it("still resolves, with the meal attached", () => {
    // Archival affects the picker, not history. Sunday's dinner is archived and
    // must keep rendering — the alternative is an export that reads "deleted"
    // for a month of dinners.
    const sundayDinner = resolveSlot(plan(), "2026-03-08", "dinner");

    expect(sundayDinner?.meal.id).toBe("stew");
    expect(sundayDinner?.meal.isArchived).toBe(true);
    expect(sundayDinner?.meal.kcal).toBe(690);
  });

  it("still resolves when an override names it", () => {
    const swapped = plan([override("2026-03-10", "dinner", "stew")]);

    expect(resolved(resolveSlot(swapped, "2026-03-10", "dinner"))).toEqual({
      meal: "stew",
      source: "override",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Beyond the fourteen                                                        */
/* -------------------------------------------------------------------------- */

describe("an override on a slot the template leaves empty", () => {
  it("resolves the override anyway", () => {
    // Not case 3 (a different slot is overridden) and not case 10 (nothing is
    // overridden): a swap INTO an empty slot — an extra meal, today only. It
    // decides whether overrides are consulted unconditionally or only as a
    // replacement for something already there, and the answer has to be
    // unconditionally, or "add a meal to today" has no way to work.
    const added = plan([override("2026-03-09", "snack", "yoghurt")]);

    expect(dayMeals(added, "2026-03-09")).toEqual([
      ["breakfast", "oats", "template"],
      ["lunch", "chicken-salad", "template"],
      ["snack", "yoghurt", "override"],
      ["dinner", "chilli", "template"],
    ]);
  });
});

describe("a template that duplicates a (day, slot)", () => {
  // The database does not forbid this yet — `day_plan_overrides` is unique on
  // (user_id, date, slot) and `plan_template_entries` has no counterpart. Until
  // it does, resolution has to break the tie somehow, and "somehow" must not
  // mean "whichever row Postgres returned first".
  //
  // A template of exactly the competing rows, so the answer turns on the
  // tie-break and nothing else. All of them are Tuesday dinners, and every
  // query below is Tuesday 2026-03-10.
  const withTemplate = (rows: PlanTemplateEntry[]) => plan([], { template: rows });

  const row = (id: string, mealId: string, sortOrder: number): PlanTemplateEntry => ({
    ...entry(TUESDAY, "dinner", mealId, sortOrder),
    id,
  });

  it("takes the lowest sort_order, whichever order the rows arrive in", () => {
    const rows = [row("b", "chilli", 5), row("a", "curry", 1)];

    expect(resolveSlot(withTemplate(rows), "2026-03-10", "dinner")?.meal.id).toBe("curry");
    expect(resolveSlot(withTemplate([...rows].reverse()), "2026-03-10", "dinner")?.meal.id).toBe(
      "curry",
    );
  });

  it("breaks a sort_order tie by id, whichever order the rows arrive in", () => {
    // Equal sort_order, so the comparator falls through to the id. Reversing
    // the array must not change the answer — that is the entire point of having
    // a total order rather than a partial one.
    const rows = [row("b", "chilli", 0), row("a", "curry", 0)];

    expect(resolveSlot(withTemplate(rows), "2026-03-10", "dinner")?.entryId).toBe("a");
    expect(resolveSlot(withTemplate([...rows].reverse()), "2026-03-10", "dinner")?.entryId).toBe(
      "a",
    );
  });
});

describe("a plan whose meals do not cover it", () => {
  it("names the dangling reference rather than dropping the meal", () => {
    // The composite foreign keys make this impossible from the database, so it
    // can only mean the caller fetched the wrong `meals` array. Silently
    // omitting the meal would take it out of the day AND out of the macro
    // totals, with nothing anywhere saying so.
    const missing = plan([override("2026-03-10", "dinner", "risotto")]);

    expect(() => resolveSlot(missing, "2026-03-10", "dinner")).toThrow(/references meal risotto/);
    expect(() => resolveDay(missing, "2026-03-10")).toThrow(/not in the meals it was given/);
  });
});

describe("a malformed date", () => {
  it("throws rather than comparing as text", () => {
    // The program-start guard is a string comparison, which is exact for
    // 'YYYY-MM-DD' and meaningless for anything else. '10/03/2026' would sort
    // after any calendar date and quietly resolve as though it were valid.
    expect(() => resolveSlot(plan(), "10/03/2026", "dinner")).toThrow(/Not a calendar date/);
    expect(() => resolveDay(plan(), "2026-02-30")).toThrow(/No such date/);
  });

  it("throws for a malformed program start date", () => {
    expect(() => resolveDay(plan([], { programStartDate: "2026-3-2" }), "2026-03-10")).toThrow(
      /Not a calendar date/,
    );
  });
});

describe("templateSlot — the recurring intent, overrides ignored", () => {
  const TUE = "2026-03-10";

  it("answers the template's meal for a slot that is overridden", () => {
    // The whole reason it exists. `resolveSlot` says chilli became curry; this
    // says the template still means chilli — which is what the swap's note is
    // measured against, and what a revert would restore.
    const subject = plan([override(TUE, "dinner", "curry")]);

    expect(resolved(resolveSlot(subject, TUE, "dinner"))).toEqual({
      meal: "curry",
      source: "override",
    });
    expect(resolved(templateSlot(subject, TUE, "dinner"))).toEqual({
      meal: "chilli",
      source: "template",
    });
  });

  it("agrees with resolveSlot when nothing is overridden", () => {
    const subject = plan();

    for (const slot of SLOT_ORDER) {
      expect(templateSlot(subject, TUE, slot)).toEqual(resolveSlot(subject, TUE, slot));
    }
  });

  it("returns the template entry's own id, not the override's", () => {
    // A caller holding both answers tells them apart on either field. The
    // revert deletes `resolveSlot`'s entryId; it must never delete this one,
    // which names a row in `plan_template_entries`.
    const subject = plan([override(TUE, "dinner", "curry", "override-row")]);

    expect(resolveSlot(subject, TUE, "dinner")?.entryId).toBe("override-row");
    expect(templateSlot(subject, TUE, "dinner")?.entryId).toBe(
      templateSlot(plan(), TUE, "dinner")?.entryId,
    );
  });

  it("is null where the swap filled a slot the template leaves empty", () => {
    // Nothing was displaced, so there is no delta to state and nothing to
    // revert TO — the caller renders neither. Distinct from the swap having no
    // effect: `resolveSlot` still returns the yoghurt.
    const subject = plan([override(TUE, "snack", "yoghurt")]);

    expect(resolved(resolveSlot(subject, TUE, "snack"))).toEqual({
      meal: "yoghurt",
      source: "override",
    });
    expect(templateSlot(subject, TUE, "snack")).toBeNull();
  });

  it("is null before the program starts, override or not", () => {
    const subject = plan([override("2026-02-24", "dinner", "curry")]);

    expect(templateSlot(subject, "2026-02-24", "dinner")).toBeNull();
    expect(resolveSlot(subject, "2026-02-24", "dinner")).toBeNull();
  });

  it("throws on a malformed date rather than comparing it as text", () => {
    expect(() => templateSlot(plan(), "10/03/2026", "dinner")).toThrow(/Not a calendar date/);
  });
});

describe("templateDay", () => {
  const TUE = "2026-03-10";

  it("is what the day would have been, in the order it is eaten", () => {
    const subject = plan([override(TUE, "dinner", "curry")]);

    expect(templateDay(subject, TUE).map((item) => [item.slot, item.meal.id])).toEqual([
      ["breakfast", "oats"],
      ["lunch", "chicken-salad"],
      ["dinner", "chilli"],
    ]);
  });

  it("agrees with resolveDay on a day with no overrides", () => {
    expect(templateDay(plan(), TUE)).toEqual(resolveDay(plan(), TUE));
  });

  it("omits a slot the swap filled from nothing, and keeps one it emptied of nothing", () => {
    // Not "resolveDay minus the overridden slots". Tuesday has no template
    // snack, so a swapped-in snack has no counterpart here — and dinner keeps
    // its template entry even though a swap replaced it.
    const subject = plan([override(TUE, "snack", "yoghurt"), override(TUE, "dinner", "curry")]);

    expect(templateDay(subject, TUE).map((item) => item.slot)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
    expect(resolveDay(subject, TUE).map((item) => item.slot)).toEqual([
      "breakfast",
      "lunch",
      "snack",
      "dinner",
    ]);
  });

  it("is empty before the program starts", () => {
    expect(templateDay(plan(), "2026-02-24")).toEqual([]);
  });
});
