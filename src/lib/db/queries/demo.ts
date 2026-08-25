import "server-only";

import { eq, sql } from "drizzle-orm";

import { todayIn } from "@/lib/date";
import {
  decideProvisioning,
  DEMO_LIMITS,
  demoExpiry,
  rateLimitWindowStart,
  type Refusal,
} from "@/lib/demo";
import { demoHistory } from "@/lib/seed/history";
import { loadSeedLibraries } from "@/lib/seed/load";
import { DEMO_DISPLAY_NAME, demoProfile } from "@/lib/seed/persona";

import { getDb } from "../index";
import { getPool } from "../pool";
import * as schema from "../schema";
import { scope } from "../scope";

/**
 * Provisioning a demo account — FUEL-40, PRD § P7.
 *
 * In `queries/` for the reason today.ts and profile.ts set out: `getDb()` and
 * `getPool()` hand back unscoped handles, the eslint rule confines them to
 * `src/lib/db/`, and a module here runs statements and returns ROWS rather than
 * a handle. The task named `app/actions/demo.ts`; that is the Server Action,
 * and it is thin precisely because everything touching a connection is here.
 *
 * ## What is unscoped here, and why that is the whole list
 *
 * Two statements read or write `users`, which carries no `user_id` — its own
 * `id` IS the user — so `scope()` cannot express them. That is the same
 * exemption src/lib/auth/owner.ts documents, for the same reason: an identity
 * has to exist before there is an identity to scope by.
 *
 * EVERYTHING else goes through `scope(user.id, tx)`, including the whole seeded
 * library, because `loadSeedLibraries` takes a `Scope` and never learns whose
 * it is. FUEL-40's testing note asks that this task "must not introduce a query
 * path that bypasses the scope helper", and the way that promise is kept is
 * that no such path is written — not that one is written carefully.
 *
 * ## Why one transaction
 *
 * A half-provisioned demo is a stranger's first impression of the app: an
 * account with a profile and no meals renders "No plan yet" and looks broken.
 * `getPool()` exists for this — its own doc comment says so — and the user row,
 * the profile and the library commit together or not at all.
 */

/** The account a visitor was given, or the reason they were not given one. */
export type Provisioning = { ok: true; userId: string } | { ok: false; refusal: Refusal };

/**
 * Why a provision was refused, worked out AFTER the fact.
 *
 * The limits are enforced by the INSERT itself (see `provisionDemoUser`), which
 * answers only "yes" or "no". This is what turns a "no" into a sentence, and it
 * runs ONLY on the refusal path — the happy path never pays for it.
 *
 * A single aggregate over `users` rather than two queries: `filter` lets one
 * scan answer both questions, and this is already the slow path.
 *
 * The instants are bound as ISO strings rather than `Date` objects. Inside a
 * raw fragment there is no column mapper to convert them, and Postgres infers
 * `timestamptz` from the comparison — which a `Date` handed straight to the
 * driver cannot be relied on to produce.
 *
 * `count(*)` is `bigint`, which the driver returns as a string; `mapWith(Number)`
 * is what stops `"3" >= 3` from being compared as text.
 */
async function refusalFor(ipHash: string, now: Date): Promise<Refusal> {
  const windowStart = rateLimitWindowStart(now.getTime()).toISOString();

  const [counts] = await getDb()
    .select({
      recentForClient: sql<number>`
        count(*) filter (
          where ${schema.users.ipHash} = ${ipHash}
            and ${schema.users.createdAt} > ${windowStart}
        )
      `.mapWith(Number),
      liveSessions: sql<number>`
        count(*) filter (where ${schema.users.expiresAt} > ${now.toISOString()})
      `.mapWith(Number),
    })
    .from(schema.users)
    .where(eq(schema.users.kind, "demo"));

  const decision = counts
    ? decideProvisioning(counts, DEMO_LIMITS)
    : ({ allowed: false, refusal: "at-capacity" } as const);

  // Refused by the database, but allowed by a count taken a moment later —
  // the rows that blocked it have since expired or aged out of the window.
  // Rare, and it must still be a refusal, because the insert really did not
  // happen. "At capacity" is the honest answer: something site-wide stopped
  // it, and it is not the visitor's own allowance.
  return decision.allowed ? "at-capacity" : decision.refusal;
}

/**
 * Creates a demo account, seeds it, and returns its id.
 *
 * ## The limits are in the INSERT, not in front of it
 *
 * The obvious shape — count, decide, then insert — is a time-of-check /
 * time-of-use race, and a worse one than it first appears. The window is not
 * "a moment": it is a full network round trip to Neon, during which every
 * concurrently executing invocation reads the same pre-insert counts. Vercel
 * runs many invocations at once, so a burst arriving while the site sits one
 * session under its ceiling does not overshoot by one — every request in the
 * burst passes the same check and the ceiling is missed by the width of the
 * burst.
 *
 * So the check moved INTO the statement that writes. The insert supplies its
 * own rows only if both counts are still under their limits at the moment
 * Postgres executes it, and returns nothing otherwise. That collapses the
 * window from a round trip to the execution of one statement.
 *
 * ## What this does and does not guarantee
 *
 * It does NOT make the ceiling exact, and it must not be described as if it
 * did. Under READ COMMITTED two such statements running at the same instant
 * each take their own snapshot, so neither subquery sees the other's uncommitted
 * row. A small overshoot is still reachable.
 *
 * What it buys is proportion: the race is now as wide as one statement rather
 * than as wide as a round trip, so the overshoot is bounded by genuine
 * simultaneity instead of by how many requests arrive during a network hop.
 *
 * An exact ceiling needs SERIALIZABLE or an advisory lock, which puts a
 * serialisation point on the app's most public endpoint and needs retry
 * handling for serialisation failures. That is not bought here, deliberately:
 * the limit exists to prevent unbounded growth, every row it admits expires
 * within two hours, and a handful over a soft ceiling costs nothing that a
 * lock on every provision would not cost more of.
 *
 * ## Ordering
 *
 * The conditional insert is the FIRST statement in the transaction, so a
 * refusal has written nothing and there is nothing to roll back. Everything
 * after it is scoped.
 *
 * ## Nothing here catches
 *
 * A failed insert, an unreachable database, a seed library that no longer
 * matches its own template — each throws, the transaction rolls back, and no
 * partial account survives. `app/actions/demo.ts` is what turns that into a
 * message; a catch here would have to invent a refusal reason for a failure
 * that is not a refusal.
 */
export async function provisionDemoUser(ipHash: string, now: Date): Promise<Provisioning> {
  const windowStart = rateLimitWindowStart(now.getTime()).toISOString();
  const expiresAt = demoExpiry(now.getTime()).toISOString();

  const userId = await getPool().transaction(async (tx) => {
    // Written as one statement rather than assembled by the query builder,
    // because the builder has no way to express "insert these values only if
    // these aggregates hold" — and that conjunction IS the limit. Every value
    // is a bound parameter; the two thresholds come from DEMO_LIMITS, so the
    // numbers still have exactly one definition.
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into ${schema.users} ("kind", "display_name", "expires_at", "ip_hash")
      select
        'demo'::user_kind,
        ${DEMO_DISPLAY_NAME},
        ${expiresAt}::timestamptz,
        ${ipHash}
      where (
          select count(*) from ${schema.users}
          where "kind" = 'demo'
            and "ip_hash" = ${ipHash}
            and "created_at" > ${windowStart}::timestamptz
        ) < ${DEMO_LIMITS.client.max}
        and (
          select count(*) from ${schema.users}
          where "kind" = 'demo'
            and "expires_at" > ${now.toISOString()}::timestamptz
        ) < ${DEMO_LIMITS.concurrent}
      returning "id"
    `);

    const user = inserted.rows.at(0);

    // No row means the WHERE was false: a limit refused it. Nothing has been
    // written, so the transaction commits empty and the caller works out which
    // limit it was.
    if (!user) return undefined;

    // From here down the scope owns every statement. `loadSeedLibraries` never
    // learns whose scope it was handed, which is the same arrangement the
    // owner's gitignored seed script uses — one library, two callers, and no
    // second way to write these rows.
    const owned = scope(user.id, tx);

    const profile = demoProfile(now);

    await owned.insert(schema.profiles, profile);

    const seeded = await loadSeedLibraries(owned);

    // FUEL-41. The library is what the demo CAN do; this is what Sam has
    // already done, and without it the weight chart — the screen a portfolio
    // visitor is most likely to open — renders its empty state on an account
    // that is supposed to be twelve weeks old.
    //
    // Generated from the rows just written, so every id below came out of this
    // transaction and belongs to this user. That is not a convention: the
    // composite foreign keys on all four tables mean an id from anywhere else
    // fails the insert rather than writing a cross-tenant row.
    const history = demoHistory({
      profile,
      today: todayIn(profile.timezone, now),
      ...seeded.rows,
    });

    // Overrides before meal logs, because a swapped day's log names the meal the
    // override put there and the two should not be able to disagree about the
    // order they were decided in. Nothing enforces this — both tables reference
    // `meals`, not each other — but the export reads them together.
    //
    // Each guarded on being non-empty, exactly as `loadSeedLibraries` guards its
    // ingredients and exercises. Postgres has no statement for inserting no
    // rows — `scope.upsert` says so where it refuses one outright — and
    // Drizzle throws "values() must be called with at least one value" before a
    // statement is even built. That throw would roll back the transaction and
    // turn "Try the demo" into an error for EVERY visitor, not a degraded one.
    //
    // None of the four can be empty for the shipped seed library, and
    // history.test.ts holds that line across all seven weekdays. But the
    // generator can return an empty batch — two of its own tests make it do so,
    // with a one-recipe slot and with a program only days old — so the property
    // this depends on lives in the seed data, not in the type. That is exactly
    // the kind of guarantee that a later edit to `plan.ts` breaks silently.
    for (const [table, rows] of [
      [schema.weightLogs, history.weightLogs],
      [schema.dayPlanOverrides, history.dayPlanOverrides],
      [schema.mealLogs, history.mealLogs],
      [schema.workoutLogs, history.workoutLogs],
    ] as const) {
      if (rows.length > 0) await owned.insert(table, rows);
    }

    return user.id;
  });

  if (!userId) return { ok: false, refusal: await refusalFor(ipHash, now) };

  return { ok: true, userId };
}
