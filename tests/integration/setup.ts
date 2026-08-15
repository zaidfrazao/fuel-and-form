/**
 * Points the database modules at the test branch, inside each worker.
 *
 * The connection string and its production guard live in `env.ts`, which
 * `globalSetup.ts` shares — see the note there on why this is not @next/env.
 */

import { testDatabaseUrl } from "./env";

const testUrl = testDatabaseUrl();

if (testUrl) {
  // src/lib/db reads DATABASE_URL. Redirect it so the code under test is the
  // same code that runs in production, just pointed at the test branch.
  process.env.DATABASE_URL = testUrl;
}
