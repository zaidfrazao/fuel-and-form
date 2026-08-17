// A TYPE-only import, and the only thing in `lib/` that reaches into
// `components/`. `Slot` is the day ruler's own prop shape, so importing it is
// what stops this adapter and the component it feeds from drifting apart —
// re-declaring the shape here would compile just as happily on the day one of
// them gained a field. Types are erased, so nothing of the component reaches
// the bundle through this line.
import type { Slot } from "@/components/day-ruler";
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
  return item.kind === "meal" ? SLOT_LABEL[item.meal.slot] : "Training";
}

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
