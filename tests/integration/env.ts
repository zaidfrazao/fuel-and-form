/**
 * Where the integration suite's connection string comes from.
 *
 * Two callers need it and they run in different processes: `globalSetup.ts`
 * migrates the test branch once in Vitest's main process, and `setup.ts` points
 * the database modules at it inside each worker. Resolving it in one place means
 * the production guard below cannot be applied to one path and forgotten on the
 * other.
 *
 * Why Node's own loader and not @next/env: Vitest sets NODE_ENV=test, and
 * @next/env deliberately skips `.env.local` in that mode (Next docs, Guides →
 * Environment Variables → Load Order). DATABASE_URL_TEST lives in `.env.local`,
 * so we would silently read nothing.
 */

/**
 * Resolved once per process, result and all.
 *
 * Not merely an optimisation. `setup.ts` REPLACES `DATABASE_URL` with the test
 * branch so the code under test reads it — after which the two variables hold
 * the same string, and a second trip through `assertNotProduction` would refuse
 * to run on the grounds that the test database is the app's own. Caching the
 * answer means the guard sees the real pair, once, and every later caller gets
 * that verdict rather than a fresh comparison against a value we ourselves set.
 */
let resolved: { url: string | undefined } | undefined;

/**
 * The test branch's connection string, or `undefined` when unconfigured — in
 * which case every integration suite skips itself rather than failing.
 *
 * Throws only when the configuration is present but unsafe; see below.
 */
export function testDatabaseUrl(): string | undefined {
  if (resolved) return resolved.url;

  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local — CI, or a fresh clone. The suites skip themselves.
  }

  const testUrl = process.env.DATABASE_URL_TEST;

  // Deliberately not cached before the guard runs: a throw must stay a throw on
  // every call, not be answered from a cache on the second one.
  if (testUrl) assertNotProduction(testUrl, process.env.DATABASE_URL);

  resolved = { url: testUrl };

  return resolved.url;
}

/**
 * Which database a connection string reaches, as a comparable string.
 *
 * The host, with Neon's `-pooler` suffix normalised away. That normalisation is
 * the whole point rather than a tidy-up: Neon's pooled endpoint is the direct
 * one with `-pooler` inserted into the same endpoint id, so
 * `ep-x-pooler.eu-west-2.aws.neon.tech` and `ep-x.eu-west-2.aws.neon.tech` are
 * two doors into ONE database. Comparing raw hosts would call them different and
 * wave through the exact misconfiguration the guard exists to catch — the app's
 * production database in `DATABASE_URL` as pooled, and the same database pasted
 * into `DATABASE_URL_TEST` as direct, followed by a truncate.
 *
 * Exported for `tests/unit/database-guard.test.ts`. A guard whose failure mode
 * is "the integration suite silently truncates production" should not itself be
 * the one thing in the repository with no test.
 */
export function databaseIdentity(url: string, name: string): string {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    // Never interpolate a connection string into an error — these surface in CI
    // logs, and the first characters alone carry the username.
    throw new Error(`Could not parse ${name} as a URL.`);
  }

  return parsed.host.replace(/-pooler(?=\.)/i, "");
}

/**
 * These tests migrate, write and truncate. Refuse to run if the test branch
 * resolves to the same database as the app's own.
 *
 * Fails closed: with no DATABASE_URL there is nothing to compare against, and
 * an unverifiable guard is worse than none — it reads as protection while
 * providing none. Someone whose only configured string is a production one
 * pasted into DATABASE_URL_TEST is exactly the case this exists to catch.
 */
function assertNotProduction(testUrl: string, appUrl: string | undefined) {
  if (!appUrl) {
    throw new Error(
      "DATABASE_URL_TEST is set but DATABASE_URL is not, so the integration " +
        "suite cannot confirm they are different databases. Set DATABASE_URL " +
        "as well (see README → Database).",
    );
  }

  if (databaseIdentity(testUrl, "DATABASE_URL_TEST") === databaseIdentity(appUrl, "DATABASE_URL")) {
    throw new Error(
      "DATABASE_URL_TEST reaches the same database as DATABASE_URL — pooled and " +
        "direct endpoints of one Neon branch count as the same. The integration " +
        "suite truncates tables; point it at a separate branch.",
    );
  }
}
