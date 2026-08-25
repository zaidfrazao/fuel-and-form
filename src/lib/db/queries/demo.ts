import "server-only";

import { eq, sql } from "drizzle-orm";

import {
  decideProvisioning,
  demoExpiry,
  type ProvisioningCounts,
  rateLimitWindowStart,
  type Refusal,
} from "@/lib/demo";
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
 * Both counts the limits need, in one round trip.
 *
 * A single aggregate over `users` rather than two `count()` queries: the demo
 * is a visitor's first sixty seconds and this is on the way to their first
 * paint, so a second HTTP round trip to Neon buys nothing. `filter` is what
 * lets one scan answer two questions.
 *
 * The instants are bound as ISO strings rather than `Date` objects. Inside a
 * raw fragment there is no column mapper to convert them, and Postgres infers
 * `timestamptz` from the comparison — which a `Date` handed straight to the
 * driver cannot be relied on to produce.
 *
 * `count(*)` is `bigint`, which the driver returns as a string; `mapWith(Number)`
 * is what stops `"3" >= 3` from being compared as text. A session count large
 * enough to lose precision as a JS number is not a state this app can reach.
 */
async function countAgainstLimits(ipHash: string, now: Date): Promise<ProvisioningCounts> {
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

  // An aggregate with no GROUP BY returns exactly one row, even over no rows at
  // all — so this is unreachable rather than merely unlikely. It is here
  // because `noUncheckedIndexedAccess` requires an answer, and the honest one
  // names the impossibility rather than asserting it away with `!`.
  if (!counts) throw new Error("Counting demo sessions returned no row.");

  return counts;
}

/**
 * Creates a demo account, seeds it, and returns its id.
 *
 * ## The counts are read outside the transaction
 *
 * So two provisions arriving together can both pass a cap only one of them
 * should have, and the site can end up one or two sessions over its ceiling.
 * That is accepted rather than overlooked. Making the cap exact means a
 * serialisable transaction or an advisory lock on every single provision — a
 * round trip and a contention point, on the app's most public endpoint, to
 * defend a soft limit whose entire consequence is a hundred and one live demo
 * sessions instead of a hundred.
 *
 * The overshoot is bounded by how many provisions can race inside one round
 * trip, and the next request reads the higher count and refuses. What the limit
 * is actually for — a crawler in a loop — is unaffected either way, because a
 * loop is sequential and sees each of its own rows.
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
  const decision = decideProvisioning(await countAgainstLimits(ipHash, now));

  if (!decision.allowed) return { ok: false, refusal: decision.refusal };

  const userId = await getPool().transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        kind: "demo",
        displayName: DEMO_DISPLAY_NAME,
        // The row's own deadline, and the authoritative one — resolve.ts checks
        // it on every request precisely so a cookie cannot outlive it.
        expiresAt: demoExpiry(now.getTime()),
        ipHash,
      })
      .returning({ id: schema.users.id });

    if (!user) throw new Error("Provisioning a demo account returned no user row.");

    // From here down the scope owns every statement. `loadSeedLibraries` never
    // learns whose scope it was handed, which is the same arrangement the
    // owner's gitignored seed script uses — one library, two callers, and no
    // second way to write these rows.
    const owned = scope(user.id, tx);

    await owned.insert(schema.profiles, demoProfile(now));
    await loadSeedLibraries(owned);

    return user.id;
  });

  return { ok: true, userId };
}
