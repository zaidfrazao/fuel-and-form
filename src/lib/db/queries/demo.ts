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

/**
 * How much one run of the reaper may delete, and why there is a limit at all.
 *
 * The obvious reaper is one unbounded `delete from users`. What makes that the
 * wrong shape is arithmetic rather than taste: the concurrency cap bounds LIVE
 * sessions at a hundred, not sessions per day. An expired row stops counting
 * towards `DEMO_LIMITS.concurrent` the moment it expires, so provisioning
 * continues all day and a busy day's steady state is roughly a hundred accounts
 * turning over every two hours — call it a thousand accounts, each with about
 * two hundred rows cascading beneath it.
 *
 * Two hundred thousand rows is not a large delete for Postgres. It is, however,
 * a single statement inside a serverless function with a hard duration ceiling,
 * and its failure mode is the bad one: the job times out, the transaction rolls
 * back, NOTHING is deleted, and the next run has strictly more to do than this
 * one. That repeats daily, forever, and the only symptom is the row growth the
 * job was added to prevent.
 *
 * Batches make progress durable. Each batch is its own statement and commits on
 * its own, so a run that is cut off has still deleted everything it got through.
 *
 * `maxBatches` bounds the work of a single invocation rather than the work
 * overall — a run that hits it returns `complete: false`, which the route
 * reports, and the next run continues from where it stopped.
 */
export type ReapLimits = {
  /** Expired accounts removed per statement. */
  batchSize: number;
  /** Statements per invocation, after which the run reports itself unfinished. */
  maxBatches: number;
};

/**
 * What one scheduled run is allowed to do.
 *
 * Two hundred accounts per batch is roughly forty thousand cascaded rows — a
 * statement measured in tens of milliseconds — and twenty batches is four
 * thousand accounts, comfortably more than a day of provisioning at the
 * concurrency cap. So the ceiling exists to bound a pathological run, not the
 * ordinary one, and `complete: false` should never be seen in practice.
 *
 * Constants rather than environment variables, for the reason `DEMO_LIMITS`
 * states: an env var here is a third thing to configure per deployment whose
 * failure mode is a job that quietly does less than it should.
 */
export const REAP_LIMITS: ReapLimits = {
  batchSize: 200,
  maxBatches: 20,
};

/** What a run of the reaper did. */
export type Reaping = {
  /** Expired demo accounts deleted. Their rows went with them, by cascade. */
  deleted: number;
  /** False when `maxBatches` was reached with expired accounts still to delete. */
  complete: boolean;
};

/**
 * Deletes expired demo accounts and everything beneath them — FUEL-42, § P7.
 *
 * The other end of the lifecycle `provisionDemoUser` starts, which is why it
 * lives in this file rather than one of its own: the two functions are the only
 * things in the app that create and destroy an identity, and the arguments for
 * how one behaves are mostly arguments about the other.
 *
 * ## One statement per batch, and no join
 *
 * Deleting a user deletes their profile, library, plan, logs and history,
 * because every user-owned table's `user_id` cascades — see `ownerId` in
 * schema.ts. Nothing here has to enumerate those tables, which is what stops a
 * table added by a later task from being quietly missed by the cleanup.
 *
 * The history tables (`meal_logs`, `day_plan_overrides`, `workout_logs`) hold
 * `no action` foreign keys to `meals` and `workouts`, so they refuse to be
 * orphaned. That is deliberate and schema.ts explains it: `no action` is checked
 * at END of statement, and this delete removes the logs and the meals they name
 * in that one statement, so the check finds nothing dangling. `restrict` would
 * abort the reaper instead. `tests/integration/reap.test.ts` holds that line
 * against a real Postgres, so the claim is measured rather than remembered.
 *
 * ## Why the owner is excluded twice
 *
 * `kind = 'demo'` AND `expires_at <= $now`. Either predicate alone would already
 * spare the owner — their `expires_at` is null, and `null <= now` is null rather
 * than true, so they can never match a comparison. Both are written because they
 * fail differently: the first survives a future demo row with no expiry, the
 * second survives an owner row that somehow acquired one. This is the statement
 * that deletes the owner's entire history if it is wrong, and it is worth two
 * predicates and a test for each.
 *
 * ## `<=` rather than `<`
 *
 * resolve.ts refuses a session when `expiresAt.getTime() <= now`. Matching it
 * exactly means the set of rows this deletes IS the set of sessions already
 * being refused — no instant in which a usable session is reaped, and none in
 * which a dead one is preserved. FUEL-42's testing note says `<`; the difference
 * is a millisecond, and this is the direction that cannot delete a live session.
 *
 * ## Safe to run concurrently
 *
 * Idempotent first: rerunning deletes nothing, because the rows are gone. There
 * is no state anywhere but the rows themselves, so there is nothing to
 * double-count or half-apply.
 *
 * Concurrency is then a question of contention rather than correctness. Two
 * plain deletes racing are already CORRECT under read committed — the second
 * blocks on the first's row locks, re-reads after it commits, finds the rows
 * gone and deletes zero — but they spend the whole statement queued behind each
 * other. `for update skip locked` in the subquery makes each run take a batch
 * nobody else holds, so two invocations (the scheduler retrying, or a manual run
 * during a scheduled one) do disjoint work instead of waiting. The guarantee
 * moves from "does not corrupt" to "does not even wait".
 *
 * ## Nothing here catches
 *
 * An unreachable database throws, the route logs it and answers 500, and the
 * next run does this run's work as well. A catch here would have to invent a
 * count for a run that did not happen.
 */
export async function reapExpiredDemos(
  now: Date,
  limits: ReapLimits = REAP_LIMITS,
): Promise<Reaping> {
  const expired = now.toISOString();

  let deleted = 0;

  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    // Written as one statement rather than through the query builder, which has
    // no way to express `for update skip locked` inside a subquery — and that
    // clause is the whole of the concurrency argument above. Every value is a
    // bound parameter.
    const removed = await getDb().execute<{ id: string }>(sql`
      delete from ${schema.users}
      where "id" in (
        select "id" from ${schema.users}
        where "kind" = 'demo'
          and "expires_at" <= ${expired}::timestamptz
        limit ${limits.batchSize}
        for update skip locked
      )
      returning "id"
    `);

    deleted += removed.rows.length;

    // A short batch means the query found fewer expired accounts than it was
    // allowed to take, so there are none left — for this run. Another run
    // holding rows under `skip locked` would also produce a short batch here,
    // and reporting `complete` in that case is honest: those rows are being
    // deleted, by someone else, right now.
    if (removed.rows.length < limits.batchSize) return { deleted, complete: true };
  }

  return { deleted, complete: false };
}
