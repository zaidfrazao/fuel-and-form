import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { getPool } from "@/lib/db/pool";

// Skipped, not failed, when DATABASE_URL_TEST is unset — a fresh clone and CI
// both report "skipped", which is truthful, rather than a false green.
const configured = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!configured)("database connectivity", () => {
  it("reaches the test branch over the HTTP driver", async () => {
    const rows = await getDb().execute(sql`select 1 as ok`);

    expect(rows.rows[0]).toEqual({ ok: 1 });
  });

  it("runs a transaction over the WebSocket driver", async () => {
    // Also proves the global WebSocket fallback works, which is why pool.ts
    // carries no `ws` dependency.
    const ok = await getPool().transaction(async (tx) => {
      const rows = await tx.execute(sql`select 1 as ok`);
      return rows.rows[0];
    });

    expect(ok).toEqual({ ok: 1 });
  });
});

describe.skipIf(configured)("database connectivity (unconfigured)", () => {
  it.skip("needs DATABASE_URL_TEST — see README → Database", () => {});
});
