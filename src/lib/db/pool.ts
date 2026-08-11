import "server-only";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

type PooledDb = ReturnType<typeof create>;

function create() {
  // No `ws` package: @neondatabase/serverless falls back to the global
  // WebSocket when no constructor is configured, and Node >= 22 (see
  // package.json `engines`, and Vercel's default runtime) provides one.
  // If a runtime ever lacks it, `npm i ws` and pass `{ ws }` to drizzle().
  return drizzle({ client: new Pool({ connectionString: databaseUrl() }), schema });
}

let cached: PooledDb | undefined;

/**
 * Transactional database handle — WebSocket-backed, supports `.transaction()`.
 *
 * Reach for this ONLY when a set of statements must commit or fail together.
 * The motivating case is demo provisioning: create the demo user, then copy the
 * owner's meals and plan template into it. A half-provisioned demo session is
 * something a stranger on the public URL would see.
 *
 * Everything else — every read path — uses `getDb()`, which is faster.
 */
export function getPool(): PooledDb {
  return (cached ??= create());
}
