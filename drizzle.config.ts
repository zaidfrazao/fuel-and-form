import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside the Next.js runtime, so nothing has loaded
// `.env.local` for us. @next/env is Next's own loader (docs: Guides →
// Environment Variables → "Loading Environment Variables with @next/env"),
// which keeps drizzle-kit reading the same files, in the same order, as
// `next dev` does.
loadEnvConfig(process.cwd());

// Migrations run on the DIRECT endpoint, not the `-pooler` one the app uses:
// DDL wants a real session, which pgbouncer's transaction pooling does not
// give it. Falls back to DATABASE_URL so a fresh clone with only one string
// still gets a working `db:generate`.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "Missing DATABASE_URL_UNPOOLED (or DATABASE_URL). " +
      "Copy .env.example to .env.local and fill it in (see README → Database).",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // Generated SQL is committed and reviewed, so print it and ask before
  // anything destructive runs against a real database.
  verbose: true,
  strict: true,
});
