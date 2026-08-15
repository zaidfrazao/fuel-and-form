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
| `npm run test:coverage` | Unit suite with the 100% gate on the scope layer |
| `npm run test:integration` | Vitest against the test branch (see [Database](#database)) |
| `npm run db:generate` | Diff the schema and write SQL to `drizzle/` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Sync the schema without a migration — local only |
| `npm run db:studio` | Browse the database in Drizzle Studio |

## Database

Neon serverless Postgres with Drizzle. Neon's cold start is the PRD's named
latency risk for the kitchen view, so pooling is not optional here.

### Setup

Provision through Vercel's Neon integration — it sets `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` under exactly those names, which is what this code
expects, and keeps them in sync across Production, Preview, and Development.

```bash
vercel integration add neon      # pick the Free plan; region = your Vercel region
vercel env pull .env.local       # writes both connection strings locally
```

Then, for the integration tests, add the third string by hand:

1. In the Neon console (`vercel integration open neon` opens it via SSO),
   create a branch named `test` off `main`. This is the separate database the
   integration suite writes to and truncates.
2. Copy its **pooled** connection string into `.env.local` as
   `DATABASE_URL_TEST`. It is local- and CI-only — never set it in Vercel.

> **`vercel env pull` overwrites `.env.local`.** It only knows about variables
> Vercel holds, so it will silently drop `DATABASE_URL_TEST` — and the
> integration suite will go back to reporting *skipped*, which reads like
> success. Re-add it after any pull, and check for "skipped" before trusting a
> green run.

`.env.local` is gitignored. This repository is public, so a real connection
string must never be committed; `.env.example` is the only `.env*` file git
will accept.

> Doing it by hand instead? Create a project at
> [console.neon.tech](https://console.neon.tech), `cp .env.example .env.local`,
> and fill in all three from **Project → Connect**. Put `DATABASE_URL` and
> `DATABASE_URL_UNPOOLED` into Vercel's environment variables yourself.

### The three connection strings

| Variable | Endpoint | Used by |
| --- | --- | --- |
| `DATABASE_URL` | pooled — host contains `-pooler` | the app at runtime |
| `DATABASE_URL_UNPOOLED` | direct — same host without `-pooler` | `drizzle-kit` only |
| `DATABASE_URL_TEST` | the `test` branch | `tests/integration` only |

Migrations run on the **direct** endpoint on purpose: DDL needs a real session,
which pgbouncer's transaction pooling does not provide. Everything else uses the
pooled endpoint.

`drizzle-kit` requires `DATABASE_URL_UNPOOLED` and will not fall back to
`DATABASE_URL`. `db:migrate` and `db:push` are destructive, and a fallback would
let them silently target whatever `DATABASE_URL` holds — including a deployed
database, if you happen to have production env exported.

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

Neither is imported directly outside `src/lib/db/` — see below.

### Scoped queries

Every user-owned query goes through `scope()` from `@/lib/db/scope`, which binds
a user to a handle and puts `user_id` in the `WHERE` clause of every statement it
builds:

```ts
const s = scope(session.userId, getDb());

const meals = await s.select(meals);                          // only this user's
const recent = await s.select(meals, undefined, { orderBy: desc(meals.at), limit: 10 });
const one = await s.selectOne(meals, eq(meals.id, id));       // undefined if not theirs
await s.insert(meals, { name: "Oats", kcal: 500 });           // stamped with user_id

await getPool().transaction(async (tx) => {
  await scope(demoUserId, tx).insert(meals, rows);            // same scope in a transaction
});
```

Both arguments are required, so a scope cannot be built without deciding whose
data it reads. Conditions, ordering and pagination are all passed **as
arguments**: every method returns rows, never a query builder.

That last part is the load-bearing one. Drizzle's `.where()` *replaces* a
predicate rather than narrowing it, and `.$dynamic()` deliberately restores
methods stripped from a builder's type. Were a builder handed back, this would
compile cleanly and delete every user's rows:

```ts
scope(uid, db).delete(meals).$dynamic().where(eq(meals.kcal, 500))
```

Returning results closes that off — there is no builder left to reopen.

There is no get-by-id-then-check-owner helper, and there must not be one. It
would answer "exists but isn't yours" differently from "doesn't exist", letting a
demo visitor enumerate the owner's row ids. Here both are the same empty result.

ESLint blocks importing `@/lib/db` or `@/lib/db/pool` from anywhere outside
`src/lib/db/`, because an unscoped handle is the only way to write a query that
skips this. `npm run test:coverage` holds `scope.ts` at 100% in the unit suite —
hermetically, so the gate still runs in CI where there is no database.

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
reports **skipped**, so a fresh clone and CI stay green without a secret.

Because these tests truncate tables, the harness refuses to run if the test
branch resolves to the same host as `DATABASE_URL` — or if `DATABASE_URL` is
unset, since it then cannot prove the two differ. Set both.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/BRAND_GUIDE.md`](docs/BRAND_GUIDE.md) — brand and UX guidelines
- [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) — testing approach

## Configuration

Secrets are never committed. The owner password, session secret, and database URL live in `.env.local` locally and in Vercel's environment variables in production.
