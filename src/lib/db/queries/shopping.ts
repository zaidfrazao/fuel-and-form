import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { addDays, type CalendarDate, startOfWeek, todayIn } from "@/lib/date";
import { type Plan, resolveWeek } from "@/lib/resolve-plan";
import { type ShoppingGroup, shoppingList } from "@/lib/shopping-list";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";

/**
 * One week's shopping, fetched — FUEL-45's read, and P8's other half.
 *
 * `week.ts`'s sibling and built on the same rules it argues in full: the
 * resolvers are pure and take their data as arguments, something impure has to
 * go and get it, and only a module in this directory may bind a scope to a
 * handle. Which week, and why the caller does not simply say, is `week.ts`'s
 * argument too — the timezone lives on the profile, so the date cannot be
 * derived until the profile is in hand, and `startOfWeek` then snaps whatever
 * the URL asked for onto its Monday.
 *
 * ## Why this is not `loadWeek` plus two more reads
 *
 * The obvious shape is to call `loadWeek` and fetch the ingredients and the
 * ticks beside it. That would work, and it would cost a third sequential wait —
 * the ticks cannot be asked for until the Monday is known, and the Monday comes
 * out of `loadWeek`. On Neon's HTTP driver every statement is its own request,
 * so a wait is a round trip.
 *
 * It would also fetch two things this screen has no use for. `loadWeek` returns
 * `templateDays` — what each date would hold with its overrides ignored, which
 * exists so the grid can render an optimistic revert — and the whole meal
 * library for the picker. A shopping list has no cells to revert and no picker.
 *
 * So the week is resolved here from the same `Plan`, in one wave: five reads
 * that all depend on nothing but the `user_id` and the Monday, and two waits
 * total. The duplication is the dozen lines between the profile and
 * `resolveWeek`, and it buys a read that fetches exactly what the screen draws.
 *
 * ## The ingredient table is fetched whole
 *
 * `meal_ingredients` is not narrowed to the meals the week plans, for
 * `loadWeek`'s reason one table across: deciding in SQL which rows the
 * aggregation is going to want means putting resolution's answer into the
 * WHERE clause, where it can fall out of step with resolution itself. PRD
 * § Assumptions has the library at "ten or so recipes", so the whole table is
 * on the order of a hundred rows. `shoppingList` ignores the ones it does not
 * need, and it is the only thing that knows which those are.
 *
 * The ticks ARE narrowed, to one week, because they accumulate without bound
 * as weeks pass and only one week's are ever rendered.
 */

/** What `/shopping` needs to render. */
export type ShoppingWeek = {
  /** The Monday the seven days start on — the week's identity in a URL. */
  monday: CalendarDate;
  /** Today in the PROFILE's zone, so the screen can tell which week it is on. */
  today: CalendarDate;
  /** The aggregated list, grouped by aisle. Empty when the week plans nothing. */
  groups: readonly ShoppingGroup[];
  /**
   * The normalised names ticked off for this week.
   *
   * Keys, not rows: `shopping_checks` stores presence and nothing else that a
   * screen reads, so what crosses is the set the list is joined against. Sent
   * as an array because a `Set` does not survive the server-to-client boundary;
   * the component rebuilds one.
   *
   * Keys the current list does not contain are included rather than filtered.
   * They render nowhere, and filtering here would mean this function deciding
   * which ticks still count — a second opinion about identity, one layer away
   * from the one `shopping-list.ts` already holds.
   */
  checked: string[];
};

/**
 * Resolves one week's shopping for one user.
 *
 * `undefined` means no profile row — `loadWeek`'s contract, and for its reason:
 * a user exists before it is set up, and without a timezone there is no day
 * boundary and so no week to shop for. The caller renders an empty state rather
 * than inventing a zone.
 *
 * `now` is an argument for the reason it is one everywhere else in this app:
 * the request is the only thing that genuinely knows the instant, and a view
 * whose correctness is about dates should not read a clock a test cannot reach.
 */
export async function loadShoppingWeek(
  userId: string,
  now: Date,
  anchor?: CalendarDate | null,
): Promise<ShoppingWeek | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  const today = todayIn(profile.timezone, now);
  const monday = startOfWeek(anchor ?? today);
  const sunday = addDays(monday, 6);

  const [meals, template, overrides, ingredients, checks] = await Promise.all([
    s.select(schema.meals),
    s.select(schema.planTemplateEntries),
    s.select(
      schema.dayPlanOverrides,
      and(
        gte(schema.dayPlanOverrides.date, monday),
        lte(schema.dayPlanOverrides.date, sunday),
      ),
    ),
    s.select(schema.mealIngredients),
    s.select(schema.shoppingChecks, eq(schema.shoppingChecks.weekStart, monday)),
  ]);

  const plan: Plan = {
    programStartDate: profile.programStartDate,
    template,
    overrides,
    meals,
  };

  return {
    monday,
    today,
    // Resolved days in, aggregated list out. The first acceptance criterion —
    // "reflecting all overrides" — is satisfied by construction rather than by
    // a rule stated twice: `resolveWeek` has already chosen the override over
    // the template wherever one exists, so what reaches the aggregation is what
    // will actually be cooked.
    groups: shoppingList(resolveWeek(plan, monday), ingredients),
    checked: checks.map((check) => check.itemKey),
  };
}

/**
 * One line of one week's list, ticked.
 *
 * An upsert rather than an insert, because a second tap on an already-ticked
 * line is an ordinary thing to do — a slow connection, a double tap, two tabs —
 * and `shopping_checks_user_week_item_key` would refuse the second insert with
 * an exception the screen has nowhere to put. The conflict target is
 * `(week_start, item_key)`; `scope.upsert` prepends `user_id` itself, which is
 * what makes the colliding row necessarily this user's.
 *
 * The update half writes `item_key` back onto itself, which is a deliberate
 * no-op. `scope.upsert` requires a `set` — there is no do-nothing arm — and the
 * only other column is `checked_at`, which records when the line was FIRST
 * ticked. Refreshing it on a re-tap would quietly turn "when I picked this up"
 * into "when I last touched the screen", on the one column anyone would later
 * reach for to reconstruct a shop.
 */
export async function checkItem(
  userId: string,
  weekStart: CalendarDate,
  itemKey: string,
): Promise<void> {
  const s = scope(userId, getDb());

  await s.upsert(
    schema.shoppingChecks,
    { weekStart, itemKey },
    {
      target: [schema.shoppingChecks.weekStart, schema.shoppingChecks.itemKey],
      set: { itemKey: sql`excluded.item_key` },
    },
  );
}

/**
 * The same line, unticked.
 *
 * A delete, because presence IS the state — see `shoppingChecks`. Unticking a
 * line that was never ticked removes nothing and is not an error: the caller is
 * a checkbox whose two directions are one control, and a screen that had drifted
 * from the row would otherwise fail on the tap that was putting it right.
 *
 * Scoped like every other statement, so the `week_start`/`item_key` pair can
 * only ever match this user's own row however the arguments arrived.
 */
export async function uncheckItem(
  userId: string,
  weekStart: CalendarDate,
  itemKey: string,
): Promise<void> {
  const s = scope(userId, getDb());

  await s.delete(
    schema.shoppingChecks,
    and(
      eq(schema.shoppingChecks.weekStart, weekStart),
      eq(schema.shoppingChecks.itemKey, itemKey),
    ),
  );
}
