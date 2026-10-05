import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { recordLog } from "@/lib/db/queries/log";
import { loadExport } from "@/lib/db/queries/export";
import { loadWeekExport } from "@/lib/db/queries/week-export";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";
import { buildExport } from "@/lib/export";
import { buildWeekCsv } from "@/lib/export-week";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * A recipe edited after it was eaten — FUEL-146.
 *
 * `meal_logs` carries the meal's four figures as they stood when it was
 * logged, so editing the meal afterwards must leave every reading of LOGGED
 * history where it was: the rows, the JSON backup and the weekly CSV. Asserted
 * here against Postgres rather than only over fixtures, because the property
 * lives in what the queries select — a reader that joined back to `meals`
 * would pass every pure test and fail this.
 */

const configured = testDatabaseUrl() !== undefined;

/** The fixture porridge, as seeded and therefore as logged. */
const PORRIDGE = { kcal: 420, proteinG: 24, fatG: 12, carbG: 55 };

/** The same recipe after an edit. Every figure differs. */
const EDITED = { kcal: 610, proteinG: 41, fatG: 14, carbG: 77 };

const MONDAY = "2026-03-02";

describe.skipIf(!configured)("a meal's macros, snapshotted onto its log", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();

    // A second log through the app's own write path, on the Tuesday, beside
    // the fixture's Monday breakfast.
    await recordLog(fixture.alice.userId, {
      kind: "meal",
      date: "2026-03-03",
      slot: "lunch",
      mealId: fixture.alice.mealId,
      status: "eaten",
      ...PORRIDGE,
    });
  });

  const owned = () => scope(fixture.alice.userId, getDb());

  async function editRecipe() {
    const [edited] = await owned().update(
      schema.meals,
      EDITED,
      eq(schema.meals.id, fixture.alice.mealId),
    );

    expect(edited).toMatchObject(EDITED);
  }

  async function backup() {
    const payload = await loadExport(fixture.alice.userId, new Date());

    if (!payload) throw new Error("expected a payload for a seeded user");

    return buildExport({
      account: payload.account,
      exportedAt: new Date("2026-03-10T00:00:00.000Z"),
      tables: payload.tables,
    });
  }

  async function weekCsv() {
    const payload = await loadWeekExport(
      fixture.alice.userId,
      new Date("2026-03-05T12:00:00.000Z"),
      MONDAY,
    );

    if (!payload) throw new Error("expected a payload for a seeded user");

    return buildWeekCsv(payload.input);
  }

  /** The meals section's rows, without its name or header. */
  function mealRows(csv: string): string[] {
    const all = csv.split("\r\n");
    const rest = all.slice(all.indexOf("meals") + 2);
    const end = rest.indexOf("");

    return end === -1 ? rest : rest.slice(0, end);
  }

  it("leaves the rows themselves as they were logged", async () => {
    await editRecipe();

    const rows = await owned().select(schema.mealLogs);

    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject(PORRIDGE);
  });

  it("leaves the JSON backup's logs unchanged, while its library moves", async () => {
    const before = await backup();

    await editRecipe();

    const after = await backup();

    expect(after.meals[0]).toMatchObject(EDITED);
    expect(after.mealLogs).toEqual(before.mealLogs);
    expect(after.mealLogs.map(({ kcal }) => kcal)).toEqual([420, 420]);
    expect(after.derived.planVsActual).toEqual(before.derived.planVsActual);
  });

  it("leaves the weekly CSV's logged rows unchanged", async () => {
    const before = mealRows(await weekCsv());

    await editRecipe();

    const after = mealRows(await weekCsv());
    const logged = after.filter((row) => row.includes(",eaten,"));

    expect(after).toEqual(before);
    // Both logs, counted at 420 — not vacuously equal over an empty section.
    expect(logged).toHaveLength(2);
    for (const row of logged) expect(row).toContain(",eaten,420,24,12,55,");
  });
});
