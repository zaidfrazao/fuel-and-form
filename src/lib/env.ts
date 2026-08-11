import "server-only";

/**
 * Server-side environment access.
 *
 * The guard above makes that a build error rather than a convention: a client
 * component importing this file fails to compile. Non-`NEXT_PUBLIC_` variables
 * are never inlined into a browser bundle, so this is defence in depth rather
 * than a plugged leak — but the Next data-security guide is explicit that only
 * the data-access layer should read `process.env`, and this enforces it.
 *
 * Every read is a function call, never a module-scope constant, so importing
 * this file can never throw at build time — only the code path that actually
 * needs a variable pays for its absence. That matters because `next build`
 * imports far more modules than any single request touches.
 *
 * Nothing here is prefixed `NEXT_PUBLIC_`, so none of it reaches the browser.
 */

/** Throws a message that names the variable and where to define it. */
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in (see README → Database).`,
    );
  }

  return value;
}

/**
 * The pooled Neon connection string — the `-pooler` host.
 *
 * Pooled is the default for everything at runtime: the PRD names Neon's cold
 * start as the main latency risk for the kitchen view, and the pooler is what
 * mitigates it. `drizzle.config.ts` deliberately uses the direct endpoint
 * instead, because DDL wants a real session rather than pgbouncer.
 */
export function databaseUrl(): string {
  return requireEnv("DATABASE_URL");
}
