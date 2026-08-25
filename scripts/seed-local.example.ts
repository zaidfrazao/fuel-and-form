import { Pool } from "@neondatabase/serverless";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import { type ScopedInsert, scope } from "@/lib/db/scope";
import * as schema from "@/lib/db/schema";
import { loadSeedLibraries } from "@/lib/seed/load";

/**
 * Brings a clean clone up: the owner account, the body metrics everything is
 * measured against, the recipe and workout libraries, and the weekly plan.
 *
 *     cp scripts/seed-local.example.ts scripts/seed-local.ts
 *     # edit the two blocks marked TODO below
 *     npm run db:seed
 *
 * ## Why the copy, and why it is gitignored
 *
 * PRD § P7: "My weight, targets, and logs are database-only, loaded via a
 * gitignored local seed script or entered in the app. No personal metrics in
 * git history, ever." This repository is public, so the file you actually run —
 * `scripts/seed-local.ts` — is in `.gitignore`, and this committed variant
 * carries the demo persona's invented figures in place of anyone's real ones.
 *
 * Everything that is NOT a body metric lives in `src/lib/seed/` and is
 * committed: the recipes, the workouts, and the weekly template that says which
 * dinner falls on which day. Those are food, exercises and routine, not personal
 * data, and keeping them in git is what lets FUEL-40's demo provisioner build a
 * populated demo account out of the same arrays. The gitignored half is only the
 * two blocks below.
 *
 * If you edit this file rather than the copy, `git status` will show it. That is
 * the intended safety net and the reason the split exists — see FUEL-16's
 * `scripts/check-no-metrics.sh` for the check that enforces it.
 *
 * ## Re-running
 *
 * Safe by default. The profile is written whether or not one exists, and the
 * libraries are skipped if this account already has meals — so a second run
 * updates your metrics and leaves the library alone. `--replace` deletes the
 * library and the template first and loads them fresh; it will refuse if
 * anything has been logged against a meal, because `meal_logs` protects history
 * with an `on delete no action` foreign key. That refusal is the schema working
 * as designed, not a bug: archive a meal rather than deleting it.
 */

/* ========================================================================== */
/* TODO 1 — your body metrics                                                 */
/*                                                                            */
/* Every figure below belongs to Sam Rivera, the fictional demo persona (PRD   */
/* § Target Users). Replace them all in your gitignored copy. If you are just  */
/* trying the app out, they are internally consistent and can be left alone.   */
/* ========================================================================== */

const OWNER_PROFILE = {
  heightCm: 172,

  /** Where the program started, and where it is going. */
  startWeightKg: 84.2,
  targetWeightKg: 76,

  /** Kilograms per week. 0.5 is the rate the PRD's deficit is built around. */
  goalPaceKgPerWeek: 0.5,

  /**
   * The daily targets P4 measures each day against.
   *
   * These are not free numbers: the seeded library delivers roughly 1,780 kcal
   * and 148g of protein on a weekday, so targets far from that produce a signed
   * delta that is never near zero and reads as an app fault rather than as a
   * missed day. `plan.test.ts` pins the library's actual totals — check them
   * before setting a target more than a few percent away.
   *
   * The fat figure is the one to look at hardest. The source plan's stated
   * daily fat target is well below what the seeded recipes can produce: MCT
   * coffee alone is 14g and the ciabatta 16g, and a weekday sums to 46.5-56g.
   * FUEL-14 set the persona to 50g rather than report "over on fat" every day
   * in perpetuity. See FUEL-14's closing note for the figure the plan actually
   * states — it is deliberately not repeated here, because this file is
   * committed. If the plan's figure is what yours really says, the plan and the
   * recipes disagree with each other and this file cannot fix that.
   */
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,

  /**
   * When each slot is eaten — display hints for P1's "Right Now" view, not
   * something any query filters on.
   *
   * One time per slot, not per weekday. The source routine has breakfast at
   * 07:40 on strength days and 07:10 on cardio days, which this column cannot
   * express; the earlier of the two is used. Noted in FUEL-14's closing comment
   * as a schema limit to know about before FUEL-21 builds slot-time editing.
   */
  slotTimes: {
    breakfast: "07:10",
    lunch: "12:30",
    snack: "16:00",
    dinner: "19:00",
    extra: "06:45",
  },

  /**
   * Day zero for the Circuit A/B alternation, and it must be a MONDAY.
   *
   * `rotationWorkout()` counts elapsed sessions from this date, so Circuit A
   * lands on it. The training template puts circuits on Mon/Wed/Fri, so a start
   * date mid-week shifts the whole alternation off the week it was designed
   * around. Set it to the Monday your program began.
   */
  programStartDate: "2026-08-10",

  /** IANA zone. One per account; there is no travel handling. */
  timezone: "Europe/London",
} satisfies ScopedInsert<typeof schema.profiles>;

/**
 * The name on the account. Shown in the app; never used to identify anything.
 */
const OWNER_DISPLAY_NAME = "Sam Rivera";

/* ========================================================================== */
/* TODO 2 — your weigh-in history, oldest first                               */
/*                                                                            */
/* Optional: leave it empty and log weigh-ins in the app instead. P5's chart   */
/* and its trailing rate need a few weeks of data before they say anything,    */
/* so backfilling what you already have is worth the typing.                   */
/*                                                                            */
/* One row per date — the schema is unique on (user, date), because two        */
/* readings on one morning are the same measurement taken twice. Re-running    */
/* updates a date that is already there rather than failing.                   */
/* ========================================================================== */

const OWNER_WEIGH_INS: readonly { date: string; weightKg: number; note?: string }[] = [
  { date: "2026-08-10", weightKg: 84.2, note: "Start of the program." },
  { date: "2026-08-17", weightKg: 83.6 },
  { date: "2026-08-24", weightKg: 83.1 },
];

/* ========================================================================== */
/* The seeder. Nothing below here holds a personal figure.                    */
/* ========================================================================== */

/**
 * A database handle for a plain Node process.
 *
 * Deliberately not `getPool()` from `@/lib/db/pool`. That module is
 * `server-only`, which resolves to a throwing stub outside the `react-server`
 * condition — importing it here would fail before the first query, the same
 * reason `vitest.integration.config.mts` sets that condition explicitly.
 *
 * `scope()` is the part that matters and it is importable: it is deliberately
 * NOT `server-only` (see the note at the top of scope.ts), takes its executor as
 * an argument, and holds no connection of its own. So this script writes every
 * owned row through exactly the same ownership filter the app uses, over its own
 * connection.
 */
function connect(connectionString: string) {
  return drizzle({ client: new Pool({ connectionString }), schema });
}

type Tx = Parameters<Parameters<ReturnType<typeof connect>["transaction"]>[0]>[0];

/**
 * The owner's `users` row, created if this is a fresh database.
 *
 * Not scoped, and cannot be: `users` is the one table with no `user_id` — its
 * own `id` IS the user — which is why `src/lib/auth/` is named file by file in
 * the ESLint rule that otherwise forbids raw handles. This script is outside
 * `src/` and outside that rule, and this is the same exemption for the same
 * reason.
 *
 * Reuses an existing owner rather than inserting a second one. That is the
 * common case, not the edge case: `ownerUserId()` provisions the owner row on
 * the first correct login, so anyone who has logged in before seeding already
 * has one.
 *
 * ## Insert first, then select — the same shape as `ownerUserId()`
 *
 * Select-then-insert reads more naturally and is wrong, for the reason
 * src/lib/auth/owner.ts sets out at length: it is a check-then-act race. A seed
 * run concurrent with a first login — or with another seed run — has both sides
 * read "no owner" and both attempt the insert. `users_single_owner_key` then
 * refuses the loser, and because everything here is one transaction, the whole
 * seed aborts rather than the loser simply reusing the winner's row.
 *
 * Attempting the insert FIRST closes the window: `onConflictDoNothing` turns
 * the loser into an empty `returning()`, and the select below picks up the row
 * the winner committed. The database decides existence and creation at once, so
 * there is no gap between them. Costs one no-op insert on every run after the
 * first, which is the same price owner.ts pays on every login.
 */
async function ownerUser(tx: Tx): Promise<{ id: string; created: boolean }> {
  const [created] = await tx
    .insert(schema.users)
    .values({ kind: "owner", displayName: OWNER_DISPLAY_NAME, expiresAt: null })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (created) return { id: created.id, created: true };

  // Empty `returning()` means the row was already there — from an earlier seed,
  // an earlier login, or the far side of a race that has now committed.
  const [existing] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.kind, "owner"))
    .limit(1);

  // Neither branch produced a row: the insert was refused and the select found
  // nothing. That is a broken database rather than anything this script can
  // recover from, and it says so instead of failing later on a null id.
  if (!existing) throw new Error("Could not resolve or create the owner account.");

  return { id: existing.id, created: false };
}

/**
 * Empties this account's library and template so it can be loaded again.
 *
 * Order follows the foreign keys down: template entries and children first,
 * then the parents they name. The meal and workout deletes are the ones that
 * can fail — THREE tables hold their parents with `on delete no action`, and
 * any of them is enough to refuse the delete:
 *
 *   - `meal_logs`      — a meal that has been eaten
 *   - `workout_logs`   — a session that has been logged
 *   - `day_plan_overrides` — a meal that has been swapped IN on some date
 *
 * The overrides are easy to forget because a swap does not feel like history,
 * but the export's "planned" column reads that table (P6), so it outlives the
 * meal it names exactly as a log does.
 *
 * Let the error surface unchanged. Catching it would be catching the schema
 * keeping the promise the export depends on — `is_archived` is the supported
 * way to retire a library entry, and this refusal is what makes it the only one.
 */
async function clearLibrary(s: ReturnType<typeof scope>): Promise<void> {
  await s.delete(schema.planTemplateEntries);
  await s.delete(schema.trainingTemplateEntries);
  await s.delete(schema.mealIngredients);
  await s.delete(schema.workoutExercises);
  await s.delete(schema.meals);
  await s.delete(schema.workouts);
}

async function main(): Promise<void> {
  // Nothing has loaded .env.local for us — this runs outside the Next runtime.
  // @next/env is Next's own loader, so the script reads the same files in the
  // same order as `next dev`, exactly as drizzle.config.ts does.
  loadEnvConfig(process.cwd());

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL. Copy .env.example to .env.local and fill it in " +
        "(see README → Database).",
    );
  }

  const replace = process.argv.includes("--replace");
  const db = connect(connectionString);

  try {
    const summary = await db.transaction(async (tx) => {
      const owner = await ownerUser(tx);
      const s = scope(owner.id, tx);

      /* ---- Profile: written every run, so metrics can be corrected ---- */

      const profile = await s.selectOne(schema.profiles);

      if (profile) {
        await s.update(schema.profiles, OWNER_PROFILE);
      } else {
        await s.insert(schema.profiles, OWNER_PROFILE);
      }

      /* ---- Library and template: once, unless --replace --------------- */

      const existingMeals = await s.select(schema.meals, undefined, { limit: 1 });
      const hasLibrary = existingMeals.length > 0;

      if (hasLibrary && replace) await clearLibrary(s);

      const loaded = hasLibrary && !replace ? undefined : await loadSeedLibraries(s);

      /* ---- Weigh-ins: upsert by date ---------------------------------- */

      let weighInsWritten = 0;

      for (const weighIn of OWNER_WEIGH_INS) {
        const existing = await s.selectOne(
          schema.weightLogs,
          eq(schema.weightLogs.date, weighIn.date),
        );

        const values = {
          date: weighIn.date,
          weightKg: weighIn.weightKg,
          note: weighIn.note ?? null,
        };

        if (existing) {
          await s.update(schema.weightLogs, values, eq(schema.weightLogs.date, weighIn.date));
        } else {
          await s.insert(schema.weightLogs, values);
        }

        weighInsWritten += 1;
      }

      return {
        userId: owner.id,
        createdUser: owner.created,
        wroteProfile: profile ? "updated" : "created",
        loaded,
        skippedLibrary: hasLibrary && !replace,
        weighInsWritten,
      };
    });

    /* ---- Report ------------------------------------------------------- */

    console.log(`Owner account ${summary.createdUser ? "created" : "found"}: ${summary.userId}`);
    console.log(`  profiles                   ${summary.wroteProfile}`);

    if (summary.skippedLibrary) {
      console.log("  library and template       skipped — already seeded");
    } else if (summary.loaded) {
      for (const [table, count] of Object.entries(summary.loaded.counts)) {
        console.log(`  ${table.padEnd(26)} ${count}`);
      }
    }

    console.log(`  weight_logs                ${summary.weighInsWritten}`);
    console.log("\nDone.");

    if (summary.skippedLibrary) {
      console.log("Re-run with --replace to reload the library from src/lib/seed/.");
    }
  } finally {
    // The WebSocket pool holds the process open otherwise.
    await db.$client.end();
  }
}

/**
 * Called rather than top-level awaited: this package has no `"type": "module"`,
 * so tsx compiles the script to CommonJS, where top-level await is a syntax
 * error. The explicit catch is the better shape regardless — it sets a non-zero
 * exit code, so a failed seed fails the command that ran it.
 */
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
