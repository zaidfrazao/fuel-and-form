import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { getPool } from "@/lib/db/pool";

import { testDatabaseUrl } from "./env";

// Skipped, not failed, when DATABASE_URL_TEST is unset — a fresh clone and CI
// both report "skipped", which is truthful, rather than a false green. Resolved
// through the shared helper rather than read off `process.env`, so the decision
// does not depend on setup.ts having run first; see scope.test.ts.
const configured = Boolean(testDatabaseUrl());

describe.skipIf(!configured)("database connectivity", () => {
  it("reaches the test branch over the HTTP driver", async () => {
    const rows = await getDb().execute(sql`select 1 as ok`);

    // Number(): what matters is that a value round-trips, not whether the
    // driver's type parsers hand back 1 or "1" for an int4. Asserting the
    // stricter form would fail on the first real run and point at the driver
    // instead of at the credentials.
    expect(Number(rows.rows.at(0)?.ok)).toBe(1);
  });

  it("runs a transaction over the WebSocket driver", async () => {
    // Also proves the global WebSocket fallback works, which is why pool.ts
    // carries no `ws` dependency.
    const ok = await getPool().transaction(async (tx) => {
      const rows = await tx.execute(sql`select 1 as ok`);
      return rows.rows.at(0);
    });

    expect(Number(ok?.ok)).toBe(1);
  });
});

describe.skipIf(configured)("database connectivity (unconfigured)", () => {
  it.skip("needs DATABASE_URL_TEST — see README → Database", () => {});
});
