import { normaliseKey } from "../shopping-list";
import { seedMeals } from "./meals";
import type { SeedMeal } from "./types";

/**
 * What `drizzle/0017` wrote into databases seeded before FUEL-137.
 *
 * The seed only runs at provisioning, so the owner's `meal_ingredients` rows
 * predate the shop columns and would keep the old list — "1 clove ×5" for the
 * owner while every new demo read "5 cloves". The migration back-fills them by
 * matching `(name, non_scale_measure)`: no screen edits an ingredient, so every
 * stored row is a seed row verbatim, and the pair identifies one.
 *
 * A migration cannot import TypeScript, so its VALUES are literals. They are
 * rendered by this module, and `shop-backfill.test.ts` asserts the committed
 * SQL still contains exactly this rendering: an edit to the seed's shop fields
 * that is not carried into a migration fails there rather than leaving two
 * libraries that disagree about what to buy.
 */

/** One row of the back-fill, keyed by the pair it matches on. */
export type BackfillRow = {
  name: string;
  nonScaleMeasure: string | null;
  shopName: string | null;
  shopQty: number | null;
  shopUnit: string | null;
  pantry: boolean;
  category: string | null;
};

/**
 * Every seed row carrying a shop field, once per `(name, measure)` pair.
 *
 * Throws if two rows share a pair and disagree, because the UPDATE would then
 * write whichever the database happened to join last.
 */
export function backfillRows(meals: readonly SeedMeal[] = seedMeals): BackfillRow[] {
  const rows = new Map<string, BackfillRow>();

  for (const meal of meals) {
    for (const row of meal.ingredients) {
      const shaped: BackfillRow = {
        name: row.name,
        nonScaleMeasure: row.nonScaleMeasure ?? null,
        shopName: row.shopName ?? null,
        shopQty: row.shopQty ?? null,
        shopUnit: row.shopUnit ?? null,
        pantry: row.pantry ?? false,
        category: row.category ?? null,
      };

      if (shaped.shopName === null && shaped.shopQty === null && !shaped.pantry) continue;

      const pair = JSON.stringify([shaped.name, shaped.nonScaleMeasure]);
      const seen = rows.get(pair);

      if (seen && JSON.stringify(seen) !== JSON.stringify(shaped)) {
        throw new Error(`Two seed rows share ${pair} and disagree about the shop.`);
      }

      rows.set(pair, shaped);
    }
  }

  return [...rows.values()];
}

/**
 * Every stored tick key that FUEL-137 renames: a row's old key (its normalised
 * `name`) to its new one (its normalised `shop_name`), where they differ.
 */
export function renamedKeys(meals: readonly SeedMeal[] = seedMeals): [string, string][] {
  const renames = new Map<string, string>();

  for (const row of backfillRows(meals)) {
    if (row.shopName === null) continue;

    const from = normaliseKey(row.name);
    const to = normaliseKey(row.shopName);

    if (from !== to) renames.set(from, to);
  }

  return [...renames].sort(([a], [b]) => Number(a > b) - Number(a < b));
}

/** A SQL string literal, with Postgres' own quote-doubling. */
const text = (value: string | null) =>
  value === null ? "NULL::text" : `'${value.replaceAll("'", "''")}'::text`;

/** The back-fill's VALUES list, one row per line. */
export function backfillValuesSql(rows: readonly BackfillRow[] = backfillRows()): string {
  return rows
    .map(
      (row) =>
        `  (${[
          text(row.name),
          text(row.nonScaleMeasure),
          text(row.shopName),
          row.shopQty === null ? "NULL::numeric" : `${row.shopQty}::numeric`,
          text(row.shopUnit),
          `${row.pantry}`,
          text(row.category),
        ].join(", ")})`,
    )
    .join(",\n");
}

/** The tick renames' VALUES list, one pair per line. */
export function renamesValuesSql(pairs: readonly [string, string][] = renamedKeys()): string {
  return pairs.map(([from, to]) => `  (${text(from)}, ${text(to)})`).join(",\n");
}
