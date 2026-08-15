import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

import { testDatabaseUrl } from "./env";
import { truncateAll } from "./tables";

/**
 * Brings the test branch's schema up to date before the suite, once per run.
 *
 * Until FUEL-11 the integration suite created the single throwaway table it
 * needed and dropped it again, so the test branch never held the application
 * schema at all. These tests read and write the real twelve tables, which means
 * the migrations have to be applied — and applying them here rather than in a
 * README step is what keeps `npm run test:integration` true on a fresh clone,
 * and workable from a CI job that has only the secret.
 *
 * ## Why the HTTP driver for DDL
 *
 * README → Database notes that migrations run on the DIRECT endpoint, because
 * pgbouncer's transaction pooling cannot hold the session a `drizzle-kit`
 * migration wants. `DATABASE_URL_TEST` is a pooled string, and asking for a
 * second unpooled one would be a fourth variable to keep in step for the sake of
 * a test database. Neon's HTTP driver sends each statement as its own request
 * with no session to hold, so it runs DDL over the pooled endpoint perfectly
 * well — the constraint the README describes does not apply to it.
 *
 * ## Torn down per run, not per suite
 *
 * The schema persists between runs; the DATA never does. Truncating on the way
 * in as well as on the way out means an aborted run — a killed process, a failed
 * assertion mid-write — cannot leave rows that make the NEXT run's fixtures
 * ambiguous. Each test file additionally truncates per test.
 */
export default async function setup() {
  const url = testDatabaseUrl();

  // Unconfigured: every suite skips itself, so there is nothing to prepare.
  // Returning here rather than throwing is what keeps a fresh clone green.
  if (!url) return;

  const db = drizzle({ client: neon(url) });

  await migrate(db, { migrationsFolder: "drizzle" });
  await truncateAll(db);

  return async () => {
    await truncateAll(db);
  };
}
