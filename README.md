# Fuel & Form

A personal fitness & nutrition tracker: meal planning with swaps, workout scheduling, and weekly check-in exports.

Built for one user — the owner — with read-only demo sessions so the app can be shown to strangers without exposing real data.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React Server Components, server actions) |
| Language | TypeScript, strict |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | Neon Postgres + Drizzle ORM |
| Testing | Vitest (unit), Playwright (E2E, a11y, visual) |
| Hosting | Vercel |

The PRD names Next.js 15 and a `tailwind.config.ts`; both predate the current majors. See the comment on FUEL-1 for the reasoning behind Next 16 and Tailwind v4's CSS-first tokens.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest — unit suite, no database required |
| `npm run test:integration` | Vitest against the test branch (see [Database](#database)) |
| `npm run db:generate` | Diff the schema and write SQL to `drizzle/` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Sync the schema without a migration — local only |
| `npm run db:studio` | Browse the database in Drizzle Studio |

## Database

Neon serverless Postgres with Drizzle. Neon's cold start is the PRD's named
latency risk for the kitchen view, so pooling is not optional here.

### Setup

1. Create a project at [console.neon.tech](https://console.neon.tech). Pick the
   region closest to your Vercel region — every query crosses that gap.
2. Create a branch named `test` off `main`. This is the separate database the
   integration suite writes to and truncates.
3. `cp .env.example .env.local`, then fill in the three connection strings from
   **Project → Connect**. `.env.local` is gitignored; this repository is public,
   so a real connection string must never be committed.
4. In Vercel, set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` as environment
   variables. `DATABASE_URL_TEST` is local- and CI-only.

### The three connection strings

| Variable | Endpoint | Used by |
| --- | --- | --- |
| `DATABASE_URL` | pooled — host contains `-pooler` | the app at runtime |
| `DATABASE_URL_UNPOOLED` | direct — same host without `-pooler` | `drizzle-kit` only |
| `DATABASE_URL_TEST` | the `test` branch | `tests/integration` only |

Migrations run on the **direct** endpoint on purpose: DDL needs a real session,
which pgbouncer's transaction pooling does not provide. Everything else uses the
pooled endpoint.

### Two handles

| Import | Driver | Use for |
| --- | --- | --- |
| `getDb()` from `@/lib/db` | HTTP | **everything that reads** — one `fetch`, no handshake |
| `getPool()` from `@/lib/db/pool` | WebSocket | only statements that must commit together |

`getDb()` is the default. `getPool()` exists because the HTTP driver has no
interactive transactions, and demo provisioning — create a demo user, then copy
the owner's meals and plan template into it — has to be atomic. Reaching for
`getPool()` on a read path reintroduces the latency the pooled HTTP driver is
there to avoid.

Both are `server-only` and resolve their connection string lazily, so `next
build` never needs credentials.

### Migrations

```bash
npm run db:generate   # after editing src/lib/db/schema.ts — writes SQL to drizzle/
npm run db:migrate    # apply pending migrations
```

Generated SQL in `drizzle/` is committed and reviewed like any other source. Use
`npm run db:push` for local schema iteration only — it skips the migration
history, so it must never touch a deployed database.

### Integration tests

`npm run test:integration` runs `tests/integration/` against the `test` branch,
in a separate Vitest config from the unit suite. Without `DATABASE_URL_TEST` it
reports **skipped**, so a fresh clone and CI stay green without a secret. The
harness refuses to run if the test branch resolves to the same host as
`DATABASE_URL`, because these tests truncate tables.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/BRAND_GUIDE.md`](docs/BRAND_GUIDE.md) — brand and UX guidelines
- [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) — testing approach

## Configuration

Secrets are never committed. The owner password, session secret, and database URL live in `.env.local` locally and in Vercel's environment variables in production.
