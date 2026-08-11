/**
 * Loads `.env.local` for the integration suite, then points the database
 * modules at the test branch.
 *
 * Why Node's own loader and not @next/env: Vitest sets NODE_ENV=test, and
 * @next/env deliberately skips `.env.local` in that mode (Next docs, Guides →
 * Environment Variables → Load Order). DATABASE_URL_TEST lives in `.env.local`,
 * so we would silently read nothing.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — CI, or a fresh clone. The suite skips itself below.
}

const testUrl = process.env.DATABASE_URL_TEST;

if (testUrl) {
  assertNotProduction(testUrl, process.env.DATABASE_URL);

  // src/lib/db reads DATABASE_URL. Redirect it so the code under test is the
  // same code that runs in production, just pointed at the test branch.
  process.env.DATABASE_URL = testUrl;
}

/**
 * These tests write and truncate. Refuse to run if the test branch resolves to
 * the same Postgres host as the app's own database.
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
