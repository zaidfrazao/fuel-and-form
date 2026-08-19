import type { DayOfWeek } from "./date";
import type { Meal, MealSlot } from "./db/schema";
import { SLOT_ORDER } from "./resolve-plan";

/**
 * The recurring week, shaped for the screen that edits it — FUEL-25.
 *
 * PRD § P2: "editing the template itself is a separate, explicit action". This
 * module is the pure half of that action — what the seven days look like, and
 * which values the endpoint behind them will accept.
 *
 * ## Why it is not part of resolve-plan.ts
 *
 * They answer opposite questions. `resolve-plan.ts` asks *what is eaten on this
 * date* and layers overrides over the template to say so; this asks *what does
 * the template itself say*, with no date involved at all — a weekday is not a
 * date, and the whole point of editing the template is that the answer applies
 * to every future one.
 *
 * Keeping them apart also keeps the resolver from acquiring a notion of an
 * EMPTY slot. Resolution returns the meals a day has; an editor has to render
 * the slots a day does not fill, because an empty Saturday lunch is a cell you
 * tap to fill it. A resolver that returned nulls so a screen could draw them
 * would be carrying presentation into the one module the project tests hardest.
 *
 * ## Pure, and given its rows
 *
 * No database, no session, no clock — the same contract `resolve-plan.ts` and
 * `rotation.ts` hold to, and for the same reason: the caller has already been
 * through `scope()`, so every row here belongs to one user by construction, and
 * the seven-day shape can be asserted from a fixture in milliseconds.
 *
 * ## The two guards
 *
 * `isDayOfWeek` and `isMealSlot` are here rather than in the action for the
 * reason `lib/repeat.ts` gives for living outside `actions/swap.ts`: they are
 * the endpoint's refusals, every branch of them is reachable by anyone who can
 * POST to the app, and a refusal that is only exercised through a Server Action
 * is one no hermetic test can hold still.
 *
 * What they guard is narrower than `repeat.ts`'s bound but not smaller. A
 * template write is the widest write in the app by blast radius — one row, but
 * one row that decides every future occurrence of a weekday — so an unchecked
 * `dayOfWeek` of `7` is not a bad row, it is a row the resolver can never
 * reach, silently accepted, that the editor then cannot show and the user
 * cannot delete.
 */

/**
 * The seven weekdays in the order the app displays them: Monday first.
 *
 * Storage stays 0 = Sunday to match `getUTCDay()` and the `day_of_week` column
 * — `date.ts`'s `startOfWeek` draws that same line and explains it. So Sunday
 * is `0` and sits LAST here, and nothing about the stored rows bends to make
 * the grid start where the PRD's mockup starts.
 */
export const WEEK_ORDER: readonly DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * The weekday's name, in full.
 *
 * Full names rather than "Mon", because the words appear in the sentence a
 * template edit is confirmed with — "Save to every Tuesday" — and an
 * abbreviation in a confirm is the wrong register for the one control in this
 * app whose effect is unbounded in time.
 *
 * A literal rather than `Intl.DateTimeFormat`. There is no date here to format,
 * only a column value, and manufacturing one to read a weekday name off it
 * would reintroduce exactly the timezone question `dayOfWeek` exists to close.
 */
const WEEKDAY_NAME: Record<DayOfWeek, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

export function weekdayName(day: DayOfWeek): string {
  return WEEKDAY_NAME[day];
}

/** What the template plans for one weekday's slot — `null` when it plans nothing. */
export type TemplateCell<M> = {
  slot: MealSlot;
  meal: M | null;
};

/** One weekday, every slot, whether or not the template fills it. */
export type TemplateDay<M> = {
  dayOfWeek: DayOfWeek;
  name: string;
  cells: readonly TemplateCell<M>[];
};

/** The rows this shaping needs — a subset of `plan_template_entries`. */
export type TemplateRow = {
  dayOfWeek: number;
  slot: MealSlot;
  mealId: string;
  sortOrder: number;
  id: string;
};

/**
 * The recurring week as seven days of five slots, ready to render.
 *
 * ## Every slot, every day, filled or not
 *
 * Thirty-five cells, always. A template that plans nothing at the weekend still
 * renders Saturday with five empty rows, because an empty row is the control
 * for filling it — a screen that showed only what is planned would offer no way
 * to plan anything new, which is the one thing this screen exists for.
 *
 * `null` for the meal rather than omitting the cell, so the caller renders
 * "Not planned" and the editor's row count does not move as meals are added
 * and cleared underneath it.
 *
 * ## An entry naming a meal the library does not hold resolves to `null`
 *
 * It should not happen: `plan_template_entries.meal_id` is a composite foreign
 * key onto `(meals.id, meals.user_id)` with `ON DELETE CASCADE`, so a deleted
 * meal takes its template rows with it. This is what the screen does if it ever
 * does — an empty cell, which is both true and tappable — rather than throwing
 * on the one screen whose job is to repair the plan.
 *
 * Archived meals ARE shown. `resolve-plan.ts` still resolves them, so a
 * template row naming one is genuinely what next Tuesday will serve, and hiding
 * it here would show an empty cell for a slot that is not empty. The picker
 * refuses to SCHEDULE an archived meal (meal-picker.tsx filters them out and
 * `actions/template.ts` refuses one), which is the rule that matters: retiring
 * a meal stops it being chosen again, it does not rewrite the plan behind the
 * user's back.
 *
 * ## One cell, one meal — and why that needs a tie-break rather than a constraint
 *
 * `plan_template_entries` genuinely can hold two rows for one weekday's slot,
 * and does: `lib/seed/plan.ts` puts two snacks on every weekday, because the
 * pair is what makes the day's protein target. schema.ts explains why a unique
 * constraint cannot be added.
 *
 * So the cell shows ONE meal — lowest `sortOrder`, then id — and that is not a
 * simplification, it is `resolve-plan.ts`'s answer restated. `resolveSlot`
 * returns one meal per slot, so the meal named here is the meal that will
 * actually be eaten, and the row `writeTemplateEntry` edits is the same one.
 * All three agreeing is what stops this screen offering to change a row that is
 * not the one being served.
 *
 * The order is restated rather than imported because `resolve-plan.ts` does not
 * export it and both are three lines. The cost is that the two could drift; the
 * check is the integration test that edits a two-snack cell and asserts the
 * resolver serves what the editor changed.
 *
 * KNOWN, and named here because this is where it becomes visible: the second
 * snack has no cell of its own, so this screen shows one of the two at a time.
 * It cannot be eaten either — `resolveSlot` never returns it — which is the
 * pre-existing inconsistency schema.ts records. Clearing the slot removes the
 * one on screen and reveals the other, which is the only way a row the resolver
 * hides becomes visible at all.
 */
export function templateWeek<M extends Pick<Meal, "id">>(
  entries: readonly TemplateRow[],
  meals: readonly M[],
): readonly TemplateDay<M>[] {
  return WEEK_ORDER.map((dayOfWeek) => ({
    dayOfWeek,
    name: weekdayName(dayOfWeek),
    cells: SLOT_ORDER.map((slot) => {
      const entry = entries
        .filter((candidate) => candidate.dayOfWeek === dayOfWeek && candidate.slot === slot)
        .sort((a, b) => a.sortOrder - b.sortOrder || compare(a.id, b.id))
        .at(0);

      return {
        slot,
        meal: entry ? (meals.find((meal) => meal.id === entry.mealId) ?? null) : null,
      };
    }),
  }));
}

/**
 * Three-way string comparison, without a locale — `resolve-plan.ts` argues it
 * in full. A tie-break exists to give the same answer everywhere, so it cannot
 * be `localeCompare`, and it cannot be a ternary either: `a < b ? -1 : 1`
 * claims an order between a value and itself and breaks `sort`'s contract.
 */
const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * Whether `value` is a weekday this app will write.
 *
 * `Number.isInteger` does four jobs in one call — it rejects NaN, both
 * infinities, and any fraction, alongside whatever a widened type or a
 * `JSON.parse` delivers. Written as `value % 1 !== 0` it would accept
 * `Infinity`, which passes a `<= 6` test in no way anybody intended.
 *
 * Refused rather than clamped, on `repeat.ts`'s reasoning: nothing in the
 * product can produce an out-of-range weekday, so anything reaching here is a
 * forged request or a bug, and writing a Monday because a caller asked for a
 * day 8 would be answering a question nobody asked.
 */
export function isDayOfWeek(value: unknown): value is DayOfWeek {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6
  );
}

/**
 * Whether `value` is one of the five meal slots.
 *
 * Checked against `SLOT_ORDER`, which resolve-plan.test.ts already asserts
 * against the `meal_slot` enum — so this guard cannot drift from the database's
 * idea of a slot without a failing test somewhere else. A slot the enum does
 * not have would be refused by Postgres regardless; checking first is what
 * turns that from a 500 into an answer the screen can render.
 */
export function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === "string" && SLOT_ORDER.includes(value as MealSlot);
}
