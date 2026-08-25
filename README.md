# Fuel & Form

A personal fitness & nutrition tracker: meal planning with swaps, workout scheduling, and weekly check-in exports.

Built for one user — the owner — with ephemeral, fully writable demo sessions so the app can be shown to strangers without exposing real data.

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
| `npm run db:seed` | Load the owner account, libraries and weekly plan (see [Seeding](#seeding)) |
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
hermetically, so it needs neither a database nor credentials to run.

The three files in `src/lib/auth/` that read `users` are named individually in
that ESLint rule. `users` is the one table `scope()` cannot read — it carries no
`user_id`, its own `id` *is* the user — and resolving a cookie to an identity
necessarily happens before there is an identity to scope by. They are listed
file by file rather than as a directory, so a new file added beside them does
not inherit the exemption.

> No GitHub Actions workflow runs the test suite yet — the only workflow is
> `check-metrics`, and Vercel builds. Run `npm run test:coverage` before merging
> anything that touches this layer.

## Auth

One password, in `OWNER_PASSWORD`, compared server-side. No auth provider, no
signup, no password reset — one human uses this. Demo visitors get their own
ephemeral `users` row and their own cookie.

| File | Holds | Tested by |
| --- | --- | --- |
| `auth/compare.ts` | Constant-time comparison | Unit suite, gated at 100% |
| `auth/token.ts` | HMAC-SHA256 sign / verify | Unit suite, gated at 100% |
| `auth/resolve.ts` | Token → user, against the database | `tests/integration/session.test.ts` |
| `auth/session.ts` | Cookies, and the only `SESSION_SECRET` read | — |

`token.ts` and `compare.ts` take their secret and clock as **arguments** and
import nothing `server-only`. That is what lets the hermetic suite cover them
with no server, no request and no configured secret — the same seam `scope.ts`
uses, and the reason both are in the coverage gate.

### The rejection ladder

A cookie becomes an identity only after five checks, in this order:

```
1. signature valid?                      no query yet
2. payload not past its signed expiry?   no query yet
3. userId shaped like a uuid?            no query yet
4. row exists, and users.kind matches the cookie it arrived in?
5. users.expires_at absent, or still in the future?
```

Every rung returns exactly `undefined` — not a reason, not an error, not a log
line. Absent, malformed, forged, replayed in the wrong cookie, and expired are
therefore indistinguishable from outside, so none of them can be probed. This is
the same argument `scope()` makes for collapsing "not yours" into "not there",
and it is Testing Strategy § 1.4 case 5.

Rungs 1–3 run before any query, so a flood of forged cookies costs a hash rather
than a round trip.

Both expiries are checked on purpose. The signed one is free; the row is
authoritative, because it is what P7's reaper reads and what can be shortened
*after* a cookie has been issued.

### Cookies

Three: two sessions, `ff_owner` and `ff_demo`, plus `ff_cursor`, which is a view
position rather than an identity (see below). All are `HttpOnly` +
`SameSite=Lax` + `Secure` + `path=/`.

For the two sessions, the cookie **name** carries the kind and the payload does
not repeat it, so there is one fact rather than two that could disagree;
`users.kind` must then match the name, which is what stops a genuine demo token
being worth anything in the owner's jar. Separate cookies also mean signing out
of the demo leaves the owner signed in.

`Secure` is omitted only under `next dev`, where the app is served over
`http://localhost` and the browser would drop a Secure cookie silently — login
would appear to succeed and simply not work. It is set everywhere else,
including test.

The token is **signed, not encrypted**: whoever holds the cookie can read the
user id and expiry inside it. That is deliberate — a user id is not a secret,
and `scope()` already assumes an attacker may know one. Nothing sensitive may be
added to that payload later on the assumption that it is hidden.

`ff_cursor` is the odd one out and is **not signed**. It holds how far the
manual advance on `/` has got — a date and an item key, as `2026-03-09|meal:<id>`
— and the only thing forging one achieves is the screen you would get by tapping
Skip. A signature would imply a threat that does not exist. It carries no expiry
either: the date inside it is the expiry, checked against the user's *configured*
timezone by `resolveNow`, which a deadline set on a server has no access to. The
value is parsed by `src/lib/cursor.ts`, which returns `null` for anything
malformed rather than throwing — `/` is the one screen that must always render,
and a cookie a stranger controls must not be able to 500 it.

### Demo sessions

"Try the demo" on the login screen provisions a fresh account per click: a
`users` row of kind `demo`, the persona's profile, and the whole seeded library
beneath it — created in **one transaction**, because a user row whose library
never landed renders "No plan yet" and is a stranger's first impression of the
app. It is fully writable, and every statement under it goes through `scope()`,
so nothing it does can reach the owner or another visitor.

Each session carries `users.expires_at`, two hours out and matched to the
cookie's own lifetime. The row is the authoritative deadline — a cookie that
outlives it is refused (see the rejection ladder above).

It is a **POST**, behind a form, not a link. A GET would be followed by every
crawler, preview fetcher and link-unfurler that ever saw the page, each one
provisioning an account nobody asked for.

Two limits bound it, both counted in Postgres because a serverless runtime
gives each invocation its own memory and an in-process counter would count
nothing:

| Limit | What it stops |
| --- | --- |
| 3 per client per 10 minutes | one visitor consuming the whole site's budget |
| 100 live sessions at once | unbounded growth |

The cap is deliberately **soft**: the counts are read outside the transaction
that writes, so simultaneous provisions can overshoot it by one or two. Making
it exact costs a lock on the app's most public endpoint to defend a limit whose
entire consequence is one extra row, and a crawler — which is what the limit is
for — is sequential and sees each of its own rows anyway.

#### `users.ip_hash`

The per-client limit needs something to count per client, and that column is it.
It holds an **HMAC of the address under `SESSION_SECRET`**, never an address: a
bare hash of an IPv4 address is reversible by anyone willing to hash four
billion values, and the key is neither in this repository nor in the database.
Because the key differs per deployment, the same visitor cannot be lined up
across two of them either.

It needs no retention policy of its own. The rate-limit window is minutes and a
session lives two hours, so a row the limit still cares about cannot yet have
expired — the reaper that deletes expired demo users is the only cleanup there
is, and it removes the column with the row it describes.

#### The reaper

`GET /api/cron/reap-demos`, scheduled from `vercel.json`. It deletes `users`
rows where `kind = 'demo'` and `expires_at <= now`; everything beneath them —
profile, library, plan, logs, history — goes with them by cascade, so no table
is enumerated anywhere and a table added by a later task is cleaned up the day
it exists.

The owner is excluded **twice**, by `kind` and by the expiry comparison. Their
`expires_at` is null and `null <= now` is null rather than true, so either
predicate alone would already spare them. Both are written because they fail
differently, and this is the statement that would delete the owner's entire
history if it were wrong.

It deletes in batches of 200 accounts, each its own statement, taking rows with
`for update skip locked`. That makes it idempotent (a second run finds nothing),
safe to run concurrently (two runs take disjoint batches instead of queueing),
and durable against a timeout (a run that is cut off has still committed every
batch it finished). A run that reaches its batch ceiling answers
`{"complete": false}` and the next run continues.

Access is `CRON_SECRET`, compared in constant time — the route's path is
published in `vercel.json` in this public repository, so the token is the whole
of the difference between the scheduler and a stranger. A wrong token is a
silent 401; an **unset** `CRON_SECRET` throws, because a deployment turning its
own scheduler away every day would otherwise look exactly like a probe.

The schedule is **daily** (`0 4 * * *`, ±59 minutes). That is a platform
constraint rather than a preference: Vercel Hobby accounts are limited to cron
expressions running at most once a day, and a sub-daily expression fails at
deploy time. So an expired session's rows can survive up to about twenty-five
hours. Harmless in both directions that matter — `resolveSession` refuses an
expired row on sight, so a lingering account is unreachable by anyone; and the
concurrency cap counts only sessions whose expiry is still in the future, so a
backlog cannot lock new visitors out. On Pro, `0 * * * *`.

Run it by hand against a local server with:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/reap-demos
```

### Migrations

```bash
npm run db:generate   # after editing src/lib/db/schema.ts — writes SQL to drizzle/
npm run db:migrate    # apply pending migrations
```

Generated SQL in `drizzle/` is committed and reviewed like any other source. Use
`npm run db:push` for local schema iteration only — it skips the migration
history, so it must never touch a deployed database.

### Seeding

Bringing a clean clone up to a working app:

```bash
cp scripts/seed-local.example.ts scripts/seed-local.ts
# edit the two blocks marked TODO — your body metrics, and any weigh-in history
npm run db:seed
```

That writes the owner account, the profile, the recipe and workout libraries,
and the weekly plan — 17 meals, 155 ingredients, 4 workouts and 46 template
entries. Log in and the app is populated.

**`scripts/seed-local.ts` is gitignored, and that is the point.** PRD § P7:
*"No personal metrics in git history, ever."* This repository is public, so the
seed is split in two:

| Half | Holds | In git |
| --- | --- | --- |
| `src/lib/seed/` | recipes, workouts, and which meal falls on which weekday | **yes** — food, exercises and routine |
| `scripts/seed-local.ts` | height, weights, macro targets, weigh-ins | **no** |

The committed half is plan *shape*, which is what the PRD says the demo shares
with the owner — so the demo provisioner loads the same arrays through the same
`loadSeedLibraries()` rather than keeping a second copy. Only the profile row
and the weigh-in history are personal.

The demo persona's own profile is the one exception, and it lives in
`src/lib/seed/persona.ts`, committed. Every figure in it belongs to Sam Rivera,
who is invented, published in the PRD, and on the allowlist
`scripts/check-no-metrics.sh` checks every metric-shaped value against. That
file may hold Sam's numbers and nobody else's.

`scripts/seed-local.example.ts` is the committed template. Every figure in it
belongs to Sam Rivera, the fictional demo persona (PRD § Target Users) — if you
are only trying the app out, they are internally consistent and can be left
alone. Edit the copy, never the example: `git status` will show it if you
confuse the two.

Re-running is safe. The profile is rewritten every time, so correcting a metric
is just another `npm run db:seed`; the library is skipped once it exists. Pass
`--replace` to reload it from `src/lib/seed/`:

```bash
npx tsx scripts/seed-local.ts --replace
```

`--replace` refuses once a library entry has any history behind it. Three tables
hold their parents with `on delete no action` — `meal_logs`, `workout_logs`, and
`day_plan_overrides` — so a meal that has been eaten, a session that has been
logged, *or a meal that has been swapped in on some date* all block the delete,
and the whole run rolls back. The overrides are the easy one to forget: a swap
does not feel like history, but the export's "planned" column reads it.

That is the schema keeping the promise the weekly export depends on, not a bug.
Archive a library entry (`is_archived`) rather than deleting it.

> The seed runs through `scope()` like every other write, so each row is stamped
> with the account it belongs to. It does **not** use `getDb()`/`getPool()`:
> those are `server-only`, which throws outside the `react-server` condition, so
> the script opens its own connection and passes it to the same scope the app
> uses.

### Integration tests

`npm run test:integration` runs `tests/integration/` against the `test` branch,
in a separate Vitest config from the unit suite. Without `DATABASE_URL_TEST` it
reports **skipped**, so a fresh clone and CI stay green without a secret.

Because these tests truncate tables, the harness refuses to run if the test
branch resolves to the same host as `DATABASE_URL` — or if `DATABASE_URL` is
unset, since it then cannot prove the two differ. Set both.

The suite migrates the `test` branch itself before it runs, so there is no
`db:migrate` step to remember and no way for it to test yesterday's schema. Data
is truncated at the start and end of every run, and between tests; the schema
persists.

`tests/integration/scope.test.ts` is the demo-isolation proof — Testing Strategy
§ 1.4, and the PRD's promise that no session can reach another user's rows. It
runs against the real tables. Treat a failure there as a release blocker, and
check the run said **passed** rather than **skipped** before trusting it.

## Export

Two files, because P6 has two readers. **JSON** is the backup — the whole
account, in one file, against "don't lose my history". **CSV** is the check-in —
one week, in the shape a nutrition assistant opens in a spreadsheet. Neither is
a rendering of the other: the JSON carries ids so it can be restored, the CSV
carries names so it can be read.

### The account, as JSON

`GET /api/export` returns the whole account as one JSON file, named
`fuel-form-<date>.json`. The link is on `/settings`. It is a **route handler**
rather than a Server Action so the browser's own download mechanism does the
work — no JavaScript, no `Blob`, and the same behaviour on iOS Safari as on
desktop Chrome. The server names the file, because the only correct date is
today in the *user's* timezone and a client would read the browser's clock.

The response carries `Cache-Control: no-store`. It is one person's entire
history returned on the strength of a cookie, from an app behind a CDN.

#### What is in it

Every table the account owns — not just the logs. P6 calls this the backup
against "don't lose my history", and logs alone cannot restore an account:
every `meal_log` names a `meal_id`, and a file holding the log without the meal
restores a uuid pointing at nothing.

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-21T09:30:00.000Z",
  "account": { "id": "…", "kind": "owner", "displayName": "…", "timezone": "Europe/London" },
  "profile":  { "heightCm": …, "startWeightKg": …, "targetKcal": …, "slotTimes": {…}, … },

  "meals":                   [ { "id", "name", "slotType", "kcal", "proteinG", "fatG", "carbG", "method", "notes", "isArchived" } ],
  "mealIngredients":         [ { "id", "mealId", "name", "grams", "nonScaleMeasure", "category", "sortOrder" } ],
  "planTemplateEntries":     [ { "id", "dayOfWeek", "slot", "mealId", "sortOrder" } ],
  "dayPlanOverrides":        [ { "id", "date", "slot", "mealId", "createdAt" } ],
  "mealLogs":                [ { "id", "date", "slot", "mealId", "status", "note", "loggedAt" } ],

  "workouts":                [ { "id", "name", "type", "description", "rotationGroup", "rotationIndex" } ],
  "workoutExercises":        [ { "id", "workoutId", "name", "prescription", "sortOrder", "notes" } ],
  "trainingTemplateEntries": [ { "id", "dayOfWeek", "workoutId", "rotationGroup", "sortOrder" } ],
  "workoutLogs":             [ { "id", "date", "workoutId", "status", "note", "durationMin", "loggedAt" } ],

  "weightLogs":              [ { "id", "date", "weightKg", "note", "createdAt" } ],

  "derived": { "plannedIs": "template-as-of-export",
               "planVsActual": [ { "date", "slot", "plannedMealId", "swappedWithMealId", "actualMealId", "status", "note" } ] }
}
```

Dates are `YYYY-MM-DD` in the account's timezone. Instants — `createdAt`,
`loggedAt`, `exportedAt` — are ISO 8601 in UTC. `profile` is an object rather
than an array because `profiles` holds exactly one row per user.

#### `derived`, the one key that is not rows

Every other key is rows. This one is a reading of them: for each slot, what the
**template** planned, what a **swap** put there, and what was **logged**.

It is nested and written **last** so it cannot be mistaken for restorable state.
**A restore should skip `derived` entirely** — that is a rule you can follow
without knowing what is inside it, today or after anything else is added.

```jsonc
{ "date": "2026-08-17", "slot": "lunch",
  "plannedMealId":     "…chicken",   // plan_template_entries, overrides ignored
  "swappedWithMealId": "…beef",      // day_plan_overrides, null if not swapped
  "actualMealId":      "…chicken",   // meal_logs, null if not logged
  "status": "eaten", "note": null }
```

That row is the case the section exists for: the lunch was logged, and only
afterwards swapped. `null` always means *nothing to report* — never *the same as
the column beside it* — so an unswapped slot has no swap and an unlogged one
nothing eaten.

Meals are named by **id**, resolved against this file's own `meals` array. The
CSV carries names because nothing downstream of it will resolve a uuid; a reader
of this file has the library. Both artefacts get the three values from
`src/lib/plan-vs-actual.ts`, so they cannot come to disagree about what
"planned" means.

**Which dates.** Those carrying a meal log or a swap, and no others. PRD
§ Success Metrics asks that planned-versus-actual be computable for 100% of
logged days, and the weekly CSV only reaches the seven days you ask it for.
Dates with neither are left out deliberately: the template recurs forever and
the account has no end date, so covering every date since `program_start_date`
would assert an intent for every day between then and now.

**It is not history.** `plannedMealId` resolves against the template as it
stands **today**, because `plan_template_entries` carries no timestamps and the
app keeps no record of template edits. Re-export an old week after editing the
template and its `planned` changes.

That is why `derived.plannedIs` is in the file rather than only in this README:
a reader who keeps the string can tell two exports of the same date apart
instead of assuming the earlier one was wrong. The rows above are facts; this is
a present-tense reading of them. The same caveat applies to the CSV's `planned`
column, which has nowhere to say so.

#### What is not in it, and why

**`user_id`.** The same value on all eleven tables, and `account.id` already
says it once. A second copy invites an importer to trust the row over the
account the file came from, which is the one disagreement that could restore a
person's data into somebody else's id.

**The `users` row.** Its columns belong to the session layer — `expires_at` is
the demo reaper's — so four chosen fields cross as `account` instead.

**Ids are kept.** `/weight` strips ids from the payload it sends the browser and
argues why; that argument is about a screen's payload. This is a backup, and
`meal_logs.meal_id → meals.id` is the whole reason it can be restored.

#### What `schemaVersion` promises

That a reader of version 1 keeps working. A later change may **add** a key or a
field. Renaming one, removing one, or changing what one means is a new version.
The field is first in the document so a reader can learn which version it holds
without parsing the rest.

#### Two guarantees worth relying on

**It is deterministic.** Every array is totally ordered — by the row's natural
key, with `id` as the final tie-break — so two exports of unchanged data are
byte-identical and `diff` between last week's backup and this week's shows only
what actually changed.

**It is scoped to the caller.** All eleven reads go through `scope()`, so a demo
session exports demo data and nothing else. Asserted in
`tests/integration/export.test.ts`, which is Testing Strategy § 1.4 case 3.

#### Adding a table

`src/lib/export.test.ts` enumerates every table `schema.ts` exports and fails
when one is neither in the document nor on a named exclusion list. So a new
table forces a decision at the commit that adds it, rather than being missed
until someone tries to restore from a backup that quietly stopped being one.

### The week, as CSV

`GET /api/export/week?week=YYYY-MM-DD` returns one week, named
`fuel-form-week-<monday>.csv`. The link is on `/plan`, beside the prev/next
week navigation — the week is chosen there, so the export has no picker and no
screen of its own. `?week=` takes any date in the wanted week and snaps to its
Monday; a value it cannot read is the current week rather than an error, since
a query parameter is an input a stranger controls.

Dated by the week's **Monday**, not by the day of the download: a backup's
question is "when was this taken", a check-in's is "which week is this". Two
downloads of one week overwrite rather than accumulate.

#### The shape

A four-line preamble, then three sections separated by blank lines. The file is
deliberately ragged — three tables, three different column counts, which P6
allows as "one section or file each" and every spreadsheet imports.

```csv
week,2026-08-17
dates,2026-08-17,2026-08-23
timezone,Europe/London
exported_at,2026-08-21T09:30:00.000Z

weight
date,weight_kg,note
2026-08-17,80.4,
2026-08-19,80.1,"lighter, after a long walk"

training
date,session,type,scheduled,status,duration_min,note
2026-08-17,Push A,strength,yes,done,52,
2026-08-17,Daily walk,walk,yes,,,

meals
date,slot,planned,swapped_with,actual,status,kcal,protein_g,fat_g,carb_g,note
2026-08-17,breakfast,Oats and whey,,Oats and whey,eaten,430,32,9,58,
2026-08-17,lunch,Chicken rice bowl,Beef and potato,Beef and potato,eaten,640,45,22,60,
```

The preamble carries the timezone because a column of bare dates is not
readable without one — `2026-08-17` is a day only in some zone.

#### The columns that need explaining

**`planned`, `swapped_with`, `actual`** are P6's three, one each. `planned` is
what the weekly template names for that weekday and slot — the recurring
intent. `swapped_with` is the one-off override, blank when the slot was never
swapped. `actual` is the meal the log names, blank when the slot was never
logged.

They usually agree. They come apart in the case worth reporting: a slot logged
and only afterwards swapped, where `actual` is what was eaten and
`swapped_with` is what the plan says now.

The three come from `src/lib/plan-vs-actual.ts`, which is also where the JSON's
`planVsActual` gets them. One rule rendered twice, rather than two derivations
that would disagree on exactly the swapped days.

**The four macro columns** describe the meal in `actual` when there is one, and
otherwise the meal that stood. So a summed column is intake *as recorded*, and
a row with a blank `status` is intake that was planned and never confirmed —
**filter on `status = eaten`** to separate them.

**`scheduled`** in the training section is `yes` or `no`. A session can be
logged on a date the template no longer covers, because the template is edited
for future weeks while a past week resolves against it as it is today. Those
rows are kept and marked rather than dropped. A blank `status` means the
session was never logged, which is a different fact from `skipped`.

**Empty sections are written**, headers and all. A header with no rows says
"nothing was recorded that week"; a missing section is indistinguishable from a
broken export by the person opening the file.

#### Two things the file does deliberately

**Fields that could be formulas are prefixed with `'`.** A note beginning `=`,
`+`, `-` or `@` would otherwise be evaluated by the spreadsheet that opens it.
This is the one file in the app whose contents are opened by another program,
on someone else's machine, and the notes in it are free text. The cost is that
a note legitimately starting with a minus sign shows its prefix in the formula
bar; no generated column can begin with a guarded character.

**There is no byte-order mark.** The response declares `charset=utf-8`. A BOM
is a workaround for a reader that ignores that, and is itself three stray
characters glued to the first cell for every reader that does not.

#### The same two guarantees

**Deterministic.** Row order comes from the data's own keys — the week's dates,
then slot order, then the template's order for sessions — never from a row id
or from whatever order Postgres returned. Two exports of an unchanged week are
byte-identical.

**Scoped to the caller.** All seven reads go through `scope()`, asserted in
`tests/integration/week-export.test.ts` — Testing Strategy § 1.4 case 3, the
same criterion as the JSON export's, on a different set of statements.

One summary the CSV makes that the JSON does not: where a slot holds more than
one log — `meal_logs` has no unique constraint, and `alreadyLogged` is what
normally prevents it — the check-in reports the most recent one. Every row is
still in the JSON backup.

## Deploy

From a clean clone to a running deployment. Everything here assumes the Neon
integration from [Setup](#setup) — that is what puts `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` into the project under the names this code expects.

```bash
npm install
vercel link                 # connect the clone to a Vercel project
vercel integration add neon # provisions the database, sets both connection strings
```

Then the three secrets Neon does not provide. Generate two of them; choose the
third:

```bash
openssl rand -base64 32     # SESSION_SECRET
openssl rand -base64 32     # CRON_SECRET — a separate value, not a copy
```

```bash
vercel env add SESSION_SECRET production
vercel env add OWNER_PASSWORD production
vercel env add CRON_SECRET   production
```

Repeat for `preview` and `development` if you want the preview deployments to
work. `DATABASE_URL_TEST` is the one variable that must **not** go into Vercel —
it belongs to the integration suite, which truncates tables.

Apply the schema before the first request, not after:

```bash
vercel env pull .env.local  # brings the deployed connection strings down
npm run db:migrate          # runs on the direct endpoint, against the deployed database
```

Then deploy, and seed through the app or with `npm run db:seed` (see
[Seeding](#seeding)) — a deployment with no owner account will render the login
gate and reject every password, because there is nothing to log in to yet.

```bash
vercel deploy --prod
```

### Two things that bite on a first deploy

**`CRON_SECRET` must exist before the first scheduled run, not merely before you
next think about it.** `vercel.json` schedules `/api/cron/reap-demos` daily at
04:00 UTC, and that route *throws* when the variable is absent rather than
answering 401 — deliberately, so a job that has never once run cannot be
mistaken for a job being probed. Set it with the other two, not later. See
[the reaper](#the-reaper).

**`DATABASE_URL` is the live database in every environment.** The Neon
integration sets one value and keeps it in sync across Production, Preview and
Development, so a preview deployment, a local `vercel env pull`, and production
all point at the same Postgres. There is no staging database unless you make
one. A migration is a production migration; a row you insert while poking at a
preview URL is a production row. The `test` Neon branch is the only database
that is genuinely separate, and only the integration suite uses it.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/BRAND_GUIDE.md`](docs/BRAND_GUIDE.md) — brand and UX guidelines
- [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) — testing approach

## Configuration

Secrets are never committed. The owner password, session secret, cron secret, and database URL live in `.env.local` locally and in Vercel's environment variables in production.

`CRON_SECRET` is the one that must be set in Vercel **before** the first
scheduled run rather than whenever convenient: `/api/cron/reap-demos` throws
without it, deliberately, so that a job which has never run cannot be mistaken
for a job being probed. See [the reaper](#the-reaper).

Define each one in **both** places. `vercel env pull` overwrites `.env.local`
with the variables Vercel knows about, so a secret that only ever existed on one
machine is gone after the next pull — and shows up later as a missing-variable
error, a long way from the cause. `.env.example` lists every variable the app
reads.

Generate the session secret — and the cron secret, which is a separate value —
with:

```bash
openssl rand -base64 32
```

## Repository hygiene

This repository is public and the app holds one real person's body metrics. The
PRD's rule is absolute — *"No personal metrics in git history, ever"* (§ P7) —
and `scripts/check-no-metrics.sh` is what enforces it.

```bash
npm run check:metrics        # tree + history + published refs + structure
npm run check:metrics:tree   # tree and structure only, no network
```

It runs five checks: the working tree, this clone's history, **the refs the host
publishes that this clone does not have**, that no `.env` but the template is
tracked, and that `scripts/seed-local.ts` stays ignored and untracked. No
directory is exempt — least of all `docs/`, which is where the leak actually
happened. `.githooks/pre-commit` runs the tree-only subset on every commit, and
`.github/workflows/check-metrics.yml` runs the full scan on every push and pull
request — with `fetch-depth: 0`, without which the checkout would be shallow and
the history check would fail rather than pass on a history it never read.

Exit codes carry the distinction that matters: `1` is a finding you must fix,
`3` is the published-refs residue below and nothing else. CI fails on the first
and warns on the second.

The script matches the *shape* of a body metric and passes only values known to
belong to Sam Rivera, the fictional demo persona. It is an allowlist rather than
a list of the owner's figures for the obvious reason: a denylist committed to a
public repository would publish the very numbers it exists to protect.

### Where this repository actually stands

Checked 2026-08-25, by running the scan and reading the output rather than
trusting the exit code:

| Check | Result |
| --- | --- |
| Working tree | clean |
| This clone's history | clean |
| Refs GitHub publishes | **not clean — see below** |
| Tracked `.env` files | none but `.env.example` |
| `scripts/seed-local.ts` | ignored, never tracked |

**The history rewrite did not reach GitHub's pull-request refs.** On 2026-08-19
`git filter-repo` and a force-push removed the pre-FUEL-14 figures from every
branch, which is why a fresh clone is clean. GitHub creates `refs/pull/N/head`
when a pull request is opened and keeps it for the life of the repository: a
force-push does not touch it, merging does not delete it, and closing the PR
does not either. 22 of the 42 PR refs here — numbers 1 to 22, the ones predating
the fix — still serve the original values, readable at each PR's "Files changed"
tab and by anyone who fetches `refs/pull/*`.

This is a **known and accepted state**, not an oversight. Closing it needs
either GitHub Support purging the stale refs or the repository deleted and
recreated, and recreating it would destroy the pull-request history that is part
of what this repository is for. The exposure is a fictional-persona-sized set of
body measurements, not a credential, and no secret was ever committed.

It is reported on every full run so that it stays *accepted* rather than
*forgotten*. That is also why the scan looks at the host at all: a green result
against local refs proves the clone is clean, which is a different and much
weaker claim than the one § P7 makes.

### The figures in `docs/`

`docs/PRD.md` and `docs/BRAND_GUIDE.md` are full of heights, weights and macro
targets, and they are all Sam Rivera's. FUEL-14 substituted them throughout on
2026-08-16, and the PRD says so at the head of the section that carries them.

They are left in place deliberately. The alternative — stripping the figures out
of the product documentation — would make both documents worse at their job for
no gain, because an invented person's measurements are not private. They are on
the scan's allowlist by value, individually, and they are checked in every
directory. `docs/` is **not** whitelisted, and must not be: exempting the path
where the leak originally happened would convert a real exposure into a green
check.
