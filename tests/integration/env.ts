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

let loaded = false;

/**
 * The test branch's connection string, or `undefined` when unconfigured — in
 * which case every integration suite skips itself rather than failing.
 *
 * Throws only when the configuration is present but unsafe; see below.
 */
export function testDatabaseUrl(): string | undefined {
  if (!loaded) {
    loaded = true;

    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local — CI, or a fresh clone. The suites skip themselves.
    }
  }

  const testUrl = process.env.DATABASE_URL_TEST;

  if (!testUrl) return undefined;

  assertNotProduction(testUrl, process.env.DATABASE_URL);

  return testUrl;
}

/**
 * These tests migrate, write and truncate. Refuse to run if the test branch
 * resolves to the same Postgres host as the app's own database.
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

  // Never interpolate a connection string into an error — these surface in CI
  // logs, and the first characters alone carry the username.
  const host = (url: string, name: string) => {
    try {
      return new URL(url).host;
    } catch {
      throw new Error(`Could not parse ${name} as a URL.`);
    }
  };

  if (host(testUrl, "DATABASE_URL_TEST") === host(appUrl, "DATABASE_URL")) {
    throw new Error(
      "DATABASE_URL_TEST points at the same host as DATABASE_URL. " +
        "The integration suite truncates tables — point it at a separate Neon branch.",
    );
  }
}
