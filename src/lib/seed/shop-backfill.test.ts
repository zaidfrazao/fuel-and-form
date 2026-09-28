import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normaliseKey } from "../shopping-list";
import { seedMeals } from "./meals";
import {
  backfillRows,
  backfillValuesSql,
  renamedKeys,
  renamesValuesSql,
} from "./shop-backfill";

/**
 * FUEL-137 — the migration and the seed say the same thing.
 *
 * `drizzle/0017` carries the seed's shop fields as SQL literals, because a
 * migration cannot import the seed. This is what stops them drifting: the
 * seed is edited, this fails, and the fix is a new migration rather than two
 * libraries that disagree about what to buy — the owner's and every new demo's.
 */

const MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../drizzle/0017_clumsy_lily_hollister.sql"),
  "utf8",
);

describe("drizzle/0017", () => {
  it("back-fills exactly the seed's shop fields", () => {
    expect(MIGRATION).toContain(`FROM (VALUES\n${backfillValuesSql()}\n) AS v(`);
  });

  it("moves exactly the ticks whose line the seed renamed, in both statements", () => {
    const values = `(VALUES\n${renamesValuesSql()}\n) AS r(old_key, new_key)`;

    // Twice: once to copy the rows to their new key, once to delete the old.
    // A rename in one list and not the other either strands a tick under a key
    // nothing renders or duplicates it.
    expect(MIGRATION.split(values)).toHaveLength(3);
  });
});

describe("the back-fill", () => {
  it("covers every seed row that carries a shop field", () => {
    const flagged = seedMeals.flatMap((meal) =>
      meal.ingredients.filter((row) => row.shopName != null || row.shopQty != null || row.pantry),
    );
    const pairs = new Set(backfillRows().map((row) => `${row.name}|${row.nonScaleMeasure}`));

    expect(flagged.filter((row) => !pairs.has(`${row.name}|${row.nonScaleMeasure}`))).toEqual([]);
  });

  it("refuses two rows that share a match pair and disagree", () => {
    const row = { name: "Garlic", grams: null, nonScaleMeasure: "1 clove", category: "produce" };
    const meal = (shopQty: number) => ({
      ...seedMeals[0]!,
      ingredients: [{ ...row, shopQty, shopUnit: "clove" }],
    });

    expect(() => backfillRows([meal(1), meal(2)])).toThrow(/disagree/);
  });

  it("doubles a quote rather than ending the literal", () => {
    expect(
      backfillValuesSql([
        {
          name: "Baker's flour",
          nonScaleMeasure: null,
          shopName: null,
          shopQty: 1.5,
          shopUnit: null,
          pantry: true,
          category: null,
        },
      ]),
    ).toBe("  ('Baker''s flour'::text, NULL::text, NULL::text, 1.5::numeric, NULL::text, true, NULL::text)");
  });
});

describe("the tick renames", () => {
  it("never rename a key that is still some line's own key", () => {
    // The DELETE removes every row under an old key. If a row still keyed its
    // line on that spelling, its ticks would vanish with the variant's.
    const kept = new Set(
      seedMeals.flatMap((meal) =>
        meal.ingredients.map((row) => normaliseKey(row.shopName ?? row.name)),
      ),
    );

    expect(renamedKeys().filter(([from]) => kept.has(from))).toEqual([]);
  });

  it("send every old key to a key the list actually draws", () => {
    const kept = new Set(
      seedMeals.flatMap((meal) =>
        meal.ingredients.map((row) => normaliseKey(row.shopName ?? row.name)),
      ),
    );

    expect(renamedKeys().filter(([, to]) => !kept.has(to))).toEqual([]);
  });

  it("include the variants the ticket named", () => {
    expect(renamedKeys()).toEqual(
      expect.arrayContaining([
        ["olive oil (for the fish)", "olive oil"],
        ["olive oil (for the potatoes)", "olive oil"],
        ["chilli flakes or cayenne", "chilli flakes"],
        ["plain yoghurt", "plain greek yoghurt"],
      ]),
    );
  });
});
