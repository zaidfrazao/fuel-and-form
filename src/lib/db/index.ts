import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof create>;

function create() {
  return drizzle({ client: neon(databaseUrl()), schema });
}

let cached: Db | undefined;

/**
 * The default database handle — use this for everything that reads.
 *
 * Backed by Neon's HTTP driver: one `fetch` per query, no WebSocket handshake,
 * no connection held open across a render. Pooling happens at Neon's proxy, on
 * the `-pooler` endpoint in `DATABASE_URL`. This is the shape the PRD's "<1.5s
 * on 4G" kitchen view depends on.
 *
 * It cannot do interactive transactions — that is what `getPool()` is for.
 *
 * Resolved lazily and memoised: the connection string is read on first use
 * rather than at import, so `next build` never needs credentials, and dev
 * hot-reload does not leak a new client per edit.
 */
export function getDb(): Db {
  return (cached ??= create());
}
