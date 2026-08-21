// A TYPE-only import, and the only thing in `lib/` that reaches into
// `components/`. `Slot` is the day ruler's own prop shape, so importing it is
// what stops this adapter and the component it feeds from drifting apart —
// re-declaring the shape here would compile just as happily on the day one of
// them gained a field. Types are erased, so nothing of the component reaches
// the bundle through this line.
import type { Slot } from "@/components/day-ruler";
import { addDays, type CalendarDate, type DateParts, parseCalendarDate } from "@/lib/date";
import type { MealSlot } from "@/lib/db/schema";
import type { NowItem, ScheduledItem } from "@/lib/resolve-now";

/**
 * How a resolved item is named and marked on P1 — the presentation half of
 * `resolve-now.ts`, kept out of the render.
 *
 * `resolveNow` answers what is happening; none of it is about words on a
 * screen. This file is the words, and it is separate for one reason: it is the
 * part of the screen that has answers worth asserting — a slot's label, the
 * order of the marks, which minute each one sits at — and a pure function is
 * cheaper to hold to those answers than a rendered tree.
 */

/**
 * Slot names as the screen says them.
 *
 * `extra` is the awkward one. The schema's fifth slot is the PRD's 06:00 coffee
 * and MCT oil, and "Extra" is what the enum calls it — vague, but the honest
 * label for a slot that holds whatever sits outside the four meals. The meal's
 * own name carries the specifics directly beneath it at 40px, so the eyebrow
 * does not have to.
 *
 * Written out rather than derived by capitalising the enum, because two of the
 * five would then be wrong the moment a slot is added whose name is a compound.
 */
const SLOT_LABEL: Readonly<Record<MealSlot, string>> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  dinner: "Dinner",
  extra: "Extra",
};

/**
 * A slot's name, without an item to read it from.
 *
 * `itemLabel` covers the common case, but the day-complete summary has to name a
 * logged row whose meal is no longer on today's plan — a log with nothing to
 * point at, which has a slot and nothing else. Exported so that fallback and the
 * eyebrow above the active card cannot end up with two different words for
 * breakfast.
 */
export function slotLabel(slot: MealSlot): string {
  return SLOT_LABEL[slot];
}

/** The item's own name — the 40px subject of the screen. */
export function itemName(item: NowItem): string {
  return item.kind === "meal" ? item.meal.meal.name : item.workout.workout.name;
}

/**
 * The eyebrow above the name: which slot this is.
 *
 * Every session reads "Training" rather than its `workouts.type`. The type is
 * free text precisely so a future 'strength' needs no migration
 * (resolve-now.ts:78-83), and an eyebrow rendering it raw would be the one
 * place a new type has to be remembered. It also says nothing the name beneath
 * it does not already say better — "Circuit A" is the workout's name.
 */
export function itemLabel(item: NowItem): string {
  return item.kind === "meal" ? slotLabel(item.meal.slot) : "Training";
}

/**
 * The date as the day-complete summary says it — `Mon 10 Aug`.
 *
 * Formatted in UTC from the date's own parts rather than by handing the string
 * to a `Date` and hoping. `new Date("2026-08-10")` is midnight UTC, which is the
 * 9th in New York and would label the summary with yesterday for everyone west
 * of Greenwich — the exact class of bug the suite pins a non-UTC zone to catch.
 * `parseCalendarDate` also rejects a malformed date loudly rather than rendering
 * "Invalid Date" into the corner of the screen.
 *
 * The locale is fixed rather than the visitor's. This is a personal app with one
 * user and a written brand voice; a runtime locale would make the same screen
 * read "Aug 10" on one device and "10 août" on another, and neither the guide
 * nor the PRD asks for translation.
 */
export function dayLabel(date: CalendarDate): string {
  const { year, month, day } = parseCalendarDate(date);

  return DAY_LABEL.format(Date.UTC(year, month - 1, day));
}

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * `Thu 14 Aug`, and the year too when it is not this one.
 *
 * `dayLabel` alone is what `/training`'s lists use, and there it is unambiguous
 * because the window is six weeks. The weigh-in history has no window — the
 * first reading may predate the program by years, since `lib/weigh-in.ts`
 * deliberately sets no lower bound on a weigh-in's date — so two rows could
 * otherwise read `Thu 14 Aug` and mean different Augusts.
 *
 * The year appears only when it differs, on `weekLabel`'s rule: the parts that
 * repeat are the parts to drop.
 *
 * Here rather than inside `weigh-ins.tsx`, where FUEL-34 first wrote it, because
 * FUEL-35's chart labels the same dates on its axis and in its data table. Two
 * copies of a disambiguation rule is two chances for the chart's axis to read a
 * date differently from the row it plots — and `format.ts` records being
 * extracted from `day-complete.tsx` for exactly this reason.
 *
 * Compared as strings rather than through `parseCalendarDate`, which cannot be
 * wrong about a timezone: both are `YYYY-MM-DD`, so the first four characters
 * are the year by construction.
 */
export function entryLabel(date: CalendarDate, today: CalendarDate): string {
  const label = dayLabel(date);

  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`;
}

/**
 * The seven days a week header names — `10 – 16 Aug 2026`.
 *
 * The range is built from its two ends rather than formatted as one thing,
 * because the parts that repeat are the parts to drop: a header reading
 * "10 Aug 2026 – 16 Aug 2026" makes the reader compare two strings to find the
 * one number that differs. So the month appears once when both ends share it,
 * and the year once when both ends share that.
 *
 * Three shapes, and each is the shortest unambiguous form of its case:
 *
 *   - `10 – 16 Aug 2026` — one month
 *   - `27 Jul – 2 Aug 2026` — across a month
 *   - `28 Dec 2025 – 3 Jan 2026` — across a year, where dropping either year
 *     would say something false
 *
 * `monday` is snapped by the caller (`loadWeek` runs `startOfWeek`), so this
 * formats the seven days from whatever it is given rather than re-deriving
 * them — one place decides where a week starts, and `date.ts` is it.
 *
 * An en dash with hair spaces around it, not a hyphen: the hyphen is a joiner
 * and reads as one date broken in half. Formatted in UTC from the dates' own
 * parts, for the reason `dayLabel` gives at length — `new Date("2026-08-10")`
 * is the 9th in New York.
 */
export function weekLabel(monday: CalendarDate): string {
  const from = parseCalendarDate(monday);
  const to = parseCalendarDate(addDays(monday, 6));

  const sameYear = from.year === to.year;
  const sameMonth = sameYear && from.month === to.month;

  const start = sameMonth
    ? `${from.day}`
    : sameYear
      ? `${from.day} ${monthName(from)}`
      : `${from.day} ${monthName(from)} ${from.year}`;

  return `${start} \u2013 ${to.day} ${monthName(to)} ${to.year}`;
}

/** The month's short name, from the date's own parts. See `dayLabel` on UTC. */
function monthName({ year, month, day }: DateParts): string {
  return MONTH_LABEL.format(Date.UTC(year, month - 1, day));
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
});

/**
 * The day's shape, as marks on the ruler.
 *
 * ## Why everything is `upcoming`
 *
 * The ruler's three statuses — logged, skipped, upcoming — are claims about
 * `meal_logs` and `workout_logs`. Nothing writes those rows until FUEL-19, so
 * there is no status to report, and the two alternatives both assert something
 * that is not known: a solid `logged` mark would say breakfast was eaten
 * because 07:00 has passed, and `skipped` would say it wasn't. `upcoming` is
 * the one of the three that claims nothing — an unlogged item is still an item
 * waiting to be logged, whatever the clock says.
 *
 * The cost is visible in the ruler's accessible table, which reads "Upcoming"
 * against this morning's breakfast at eight in the evening. That is the right
 * trade while logs do not exist and it disappears the moment they do: FUEL-19
 * passes the day's log rows through here and the statuses become real.
 *
 * The NOW marker is unaffected — it is positioned from the clock, never from
 * status — so the AC the ruler is on this screen to satisfy holds today.
 */
export function rulerSlots(timeline: readonly ScheduledItem[]): Slot[] {
  return timeline.map((item) => ({
    // The item's own key, which is built from the ENTRY id — so a swap that
    // changes which meal a slot holds keeps the same mark rather than
    // remounting it as a new one. See resolve-now.ts on `ScheduledItem.key`.
    id: item.key,
    label: itemName(item),
    minutes: item.minutes,
    status: "upcoming" as const,
  }));
}
