# Fuel & Form — Product Requirements Document

> Working title. A personal fitness & nutrition tracker, built as a weekend project, published as a portfolio piece.

## Vision

One screen that answers "what do I eat right now?" and "what's today's workout?" with zero taps — backed by a meal plan flexible enough to survive real life, and a log honest enough to hand to my nutrition assistant every week.

## Problem Statement

I have a meal plan and a training program that both work on paper. The friction is entirely in the day-to-day execution:

1. **Recall cost.** Knowing what's scheduled means opening a document, finding today's column, and reading across. In the kitchen, on a phone, this is enough friction to cause improvisation — and improvisation is where the calorie target dies.
2. **Plans meet reality.** I run out of chicken. I thaw too much mince. The plan says Tuesday is Chicken & Rice; the fridge says otherwise. A plan that can't absorb a substitution gets abandoned rather than adjusted.
3. **Swaps silently break macros.** Substituting a meal without seeing the day's revised kcal/protein totals means drifting off target without noticing.
4. **Check-ins need evidence.** My nutrition assistant needs actual data — what I weighed, what I trained, what I actually ate versus what was planned — not my recollection of the week.

Existing apps (MyFitnessPal and friends) solve a different problem: logging arbitrary food from a giant database. My food isn't arbitrary — it's ten known recipes on a rotation. I don't need a search index, I need a scheduler with an override mechanism.

**Why now:** the plan is already written and the cut is already underway (84.2kg → 76kg, ~4 months). The tracking tool needs to exist while the program is running, not after. A gym restart in 1–2 months will force a plan revision — the app must be built to absorb that rather than assume bodyweight training forever.

**Secondary motive:** this is also a portfolio project. The repository is public and a one-click demo lets a visitor use the real thing without an account.

## Target Users

### Primary User — the owner (single, authenticated)

> **A note on the figures in this document.** Every weight, target and macro
> number below belongs to **Sam Rivera, the fictional demo persona** — not to the
> repository owner. This is a public repository and P7 commits to keeping real
> body metrics out of it; the owner's actual figures live in the database only,
> loaded by a gitignored script (FUEL-15). Read the numbers here as illustrative.

Sam Rivera. 34, 172cm, 84.2kg → 76kg target, cutting at ~0.5kg/week on ~1,780 kcal / 148g protein / 50g fat / 185g carb. Training 5 days/week at home — bodyweight circuits Mon/Wed/Fri, skipping intervals + core Tue/Thu, plus a 30–45 minute walk every day including weekends.

**Goals**
- Get the answer to "what now?" in under three seconds, one-handed, mid-cook.
- Substitute a meal in seconds without touching the underlying plan.
- See immediately whether a substitution costs me the day's targets.
- Produce a weekly summary for check-ins without assembling it by hand.

**Pain points**
- Consulting a document is too slow to compete with just eating something.
- A rigid plan feels like failure the first time it's broken; a flexible one gets followed.
- Manual logging in general-purpose trackers is disproportionate effort for a fixed ten-meal rotation.
- Losing months of weight history to a dead laptop or a cleared browser is unacceptable.

**Context of use**
- Phone, in the kitchen, hands busy — this is the dominant case.
- Phone, mid-workout, sweaty, checking the next exercise.
- Desktop, Sunday evening, reviewing the week and generating the export.

### Secondary User — the nutrition assistant

Reviews progress at weekly check-ins. Never logs into the app. Consumes an exported file (JSON or CSV) containing weight trend, training adherence, and planned-versus-actual meals.

**Goals:** spot adherence gaps and trend deviations quickly; recalibrate targets every ~5kg lost.
**Pain points:** self-reported recall is unreliable and vague; needs dated, structured data.

### Secondary User — the portfolio visitor

A recruiter, hiring manager, or engineer arriving from the public repository or a CV link. Spends 60–120 seconds, will not create an account, and judges the project on whether it feels like a real product.

**Goals:** understand what the app does and how well it's built, fast.
**Pain points:** dead screenshots prove nothing; signup walls end the visit; empty states make a project look unfinished.

## Features

Listed in build priority order. P1–P5 are the weekend's non-negotiables; P6–P9 are in scope if the core lands cleanly.

### Core Features (Must-Have)

#### P1 — "Right Now" View

**Description:** The default route (`/`). Resolves the current date, day-of-week, and clock time against the day's plan and surfaces the active item — a meal slot or a workout — as a single dominant card, with the next two upcoming items listed beneath it. The active card exposes its actions inline: log it, or swap it.

Resolution uses **configurable time windows with manual advance**. Each slot has a start time; the active slot is the one whose window contains the current time. A "skip / next" control moves to the following item when I'm off-schedule, so the view is never wrong for longer than one tap.

Default windows (**confirmed — Open Question 3, FUEL-21**). These are defaults, not the contract: every one is editable in settings, and a slot cleared there has no window at all.

| Slot | Window | |
|---|---|---|
| Coffee + MCT oil | 06:00 | start of the morning routine |
| Workout | 06:30 | inside the morning routine, before breakfast |
| Breakfast | 07:30 | after the session |
| Snack 1 | 10:30 | the mid-morning walk |
| Lunch | 12:30 | start of the lunch break |
| Snack 2 | 16:00 | the afternoon walk — **not yet resolvable, see below** |
| Dinner | 18:30 | start of the evening meal |
| Walk | any time (logged, not scheduled) | twice daily in practice |

Two of those eight rows do not resolve to a schedulable slot today, and both are deliberate:

- **The two snacks share one window.** `meal_slot` has a single `snack` value, so 10:30 is the only snack time that currently resolves. Snack 2 at 16:00 is recorded here as the confirmed figure for FUEL-55, which adds the second.
- **The walk has no window on purpose.** It is on the template every single day, so a start time would make it the active card every evening, displacing dinner on the five days that also have a real session. It is logged whenever.

**User Value:** Removes the recall cost that causes improvisation. This is the screen the app exists for.

**Acceptance Criteria:**
- [ ] `/` renders the current item with no navigation, no tab selection, and no loading spinner on a warm cache
- [ ] The card shows meal name, kcal, and P/F/C for a meal; workout name and full exercise list for a training session
- [ ] The next two upcoming items are shown with their scheduled times
- [ ] "Log eaten" / "Mark done" records the item and advances the view to the next
- [ ] A "skip" action advances without logging completion, and records the skip
- [ ] After the last item of the day, the view shows a day-complete summary with actual versus target macros
- [ ] Slot times are editable in settings and take effect immediately
- [ ] Fully usable one-handed at 375px width; primary actions sit within thumb reach
- [ ] Day boundary respects the configured timezone, not the server's

**Reading "no navigation, no tab selection".** The first criterion constrains the answer, not the chrome. `/` must answer "what now?" at the moment it loads — the current item already on screen, nothing to choose first, no spinner on a warm cache. It does not mean the shell is absent from the route. Navigation is something the user *does*, and a pill sitting at the foot of the screen asks for none of it: the answer arrives without a tap either way. So the shell renders on `/`, and this criterion is satisfied by what `/` shows on arrival rather than by what it leaves out at its edges.

The day-complete state was a separate question with a separate source — the Brand Guide's mock captions that screen "No tab bar" — and it never turned on this criterion, though it was repeatedly argued as though it did. That carve-out has since been reversed: day-complete carries the shell like every other authenticated screen. Brand Guide § Navigation records the reversal and the caption it overrides.

Written down in FUEL-56 because it was being re-argued from scratch in four files — the Right Now component, its day-complete summary, its test and its specimen page — citing four different authorities between them: this criterion, Brand Guide § Navigation, § Materials, and "the task's criterion". None cites the mock caption that actually carries the day-complete half of the rule. This paragraph is the reading; Brand Guide § Navigation defers to it and does not restate it.

#### P2 — Weekly Plan & Meal Swap

**Description:** Two connected pieces.

*Weekly grid* — a 7-day × slot table showing the resolved plan for the current week (template plus any overrides), navigable forward and back by week. Editable: tapping a cell opens the meal picker.

*Swap* — changing a single day's meal creates a dated **override** rather than editing the template. The template is the recurring intent; overrides are what actually happened on a given date. Two swap modes matter:

- **Substitute** — replace this date's dinner with another dinner from the library (ran out of chicken → Tuesday becomes Chilli).
- **Repeat** — push the same meal onto one or more following days (thawed too much mince → Chilli on Tuesday *and* Wednesday).

Overrides are visually distinguished from template entries, and each is individually revertible. Editing the template itself is a separate, explicit action.

**User Value:** The plan absorbs reality instead of being abandoned by it — and the divergence between intent and reality becomes data rather than guilt.

**Acceptance Criteria:**
- [ ] Grid shows all seven days with every meal slot, resolved template + overrides, for any selected week
- [ ] Swapping a meal writes an override for that date+slot only; the template is unchanged
- [ ] Next week's same weekday still shows the original template meal after a swap
- [ ] "Repeat for N days" creates overrides across the selected consecutive dates in one action
- [ ] Overridden cells are visually marked and can be reverted to template in one tap
- [ ] The meal picker filters to meals matching that slot type by default, with an option to show all
- [ ] Editing the template is reachable but distinct from swapping, and never triggered accidentally
- [ ] The day's macro totals (P4) update immediately on swap

#### P3 — Training Log

**Description:** Today's session — Circuit A, Circuit B, or skipping intervals + core — with its full exercise list and prescriptions. Mark done, partial, or skipped, with an optional free-text note (reps achieved, how it felt) and optional duration. The daily walk is a separate, always-present item logged with a single tap. Deliberately not a full workout tracker: no per-set entry, no volume calculations.

Circuit A/B **alternate across sessions**, not by fixed weekday — Mon=A, Wed=B, Fri=A, next Mon=B. Resolution is computed deterministically from the program start date so it never drifts (see Data Model).

**User Value:** Tells me what to do without opening the program document, and produces the adherence record the weekly export depends on.

**Acceptance Criteria:**
- [ ] Today's session resolves correctly per the 5-day schedule, with weekends showing walk-only
- [ ] Circuit A/B alternation is deterministic by date and correct after skipped sessions
- [ ] Full exercise list with prescriptions (sets/reps/duration) is visible without scrolling on a 375px screen where the list allows
- [ ] Status can be set to done / partial / skipped
- [ ] Optional note and duration persist against that date's session
- [ ] The daily walk is loggable in one tap, every day including weekends
- [ ] Past sessions are viewable and editable by date

#### P4 — Macro & Calorie Totals

**Description:** The day's planned macros — kcal, protein, fat, carbohydrate — summed from whatever meals are *actually scheduled for that date after overrides*, shown against target with the delta. Present as a compact strip on the "Right Now" view and in full on the day and week views. A swap that costs the day 30g of protein says so at the moment of the swap, not in hindsight.

**User Value:** Flexibility without silent drift. This is what makes swapping safe.

**Acceptance Criteria:**
- [ ] Totals derive from the resolved (post-override) plan for that specific date
- [ ] All four values shown against target with a signed delta
- [ ] Totals recompute immediately on any swap, revert, or template edit
- [ ] Protein is visually emphasised as the binding constraint
- [ ] A swap preview shows the resulting day totals *before* the swap is confirmed
- [ ] Week view shows daily kcal and protein, plus a weekly average

#### P5 — Weight Tracking

**Description:** Weekly weigh-in entry (date, weight in kg, optional note). Line chart of the trend over time, with a target line at the goal weight. Progress shown both in kilograms remaining and as a percentage of the start → target journey. A trailing average smooths daily noise if weigh-ins become more frequent than weekly.

**User Value:** The single number the whole program is judged on, and the anchor for recalibration every 5kg.

**Acceptance Criteria:**
- [ ] Log a weigh-in with date, weight, and optional note; edit or delete any past entry
- [ ] Line chart renders the full history, legible at 375px width
- [ ] Target line at the goal weight and starting weight are both visible on the chart
- [ ] Progress displayed as kg lost, kg remaining, and % of the way to target
- [ ] Current rate (kg/week over the trailing 4 weeks) shown against the configured goal pace
- [ ] Chart handles the empty state and the single-data-point state without breaking

#### P6 — Export

**Description:** One action producing a complete, dated dump of weight logs, workout logs, meal logs, and swap history (planned versus actual). JSON for completeness, CSV for the assistant's spreadsheet. Two scopes: everything (backup) and a selected week (check-in). No formatting, no PDF — structured data only.

Doubles as the backup mechanism against the "don't lose my history" requirement.

**User Value:** Turns the check-in from recollection into evidence, and guarantees the data is never trapped in the app.

**Acceptance Criteria:**
- [ ] Export all data as a single JSON file with a stable, documented schema
- [ ] Export a selected week as CSV — one section or file each for weight, training, and meals
- [ ] Meal export distinguishes planned, actual, and swapped-with for every slot
- [ ] Filenames are dated (e.g. `fuel-form-2026-08-10.json`)
- [ ] Export downloads directly on both mobile and desktop browsers
- [ ] The export runs against the logged-in account only — demo sessions export demo data

#### P7 — Demo Mode & Public Repository

**Description:** The app is a public portfolio piece with a one-click demo. Clicking "Try the demo" on the login screen provisions a **fresh, ephemeral demo account per visit** — a clone of a seeded fictional persona, bound to a signed cookie. It is fully writable: the visitor can swap meals, tick workouts, log a weigh-in, and download an export. Nothing they do touches my data or any other visitor's session. Expired demo sessions are reaped by a scheduled job.

The demo persona shares the plan's *shape* — same recipe library, same training structure — but is an invented person with different body metrics and roughly 12 weeks of generated weigh-in and training history, so every chart and list looks populated.

Repository privacy: recipes and workout definitions ship as seed files (they're food and exercises). My weight, targets, and logs are database-only, loaded via a gitignored local seed script or entered in the app. No personal metrics in git history, ever.

**User Value:** A visitor experiences a working product in 60 seconds without an account, and my body metrics stay off the public internet.

**Acceptance Criteria:**
- [ ] "Try the demo" requires no credentials and lands directly on a populated "Right Now" view
- [ ] Each visit provisions an independent demo account; two concurrent visitors never see each other's changes
- [ ] Every write operation works in demo — swaps, logs, weigh-ins, export
- [ ] No demo session can read or write the owner's data (verified by test)
- [ ] Demo sessions carry an expiry and are deleted by a scheduled cleanup job
- [ ] Demo provisioning is a POST behind a user action, rate-limited, so crawlers cannot mass-create sessions
- [ ] A persistent, dismissible banner marks the session as a demo and links to the repository
- [ ] The owner account is protected by a password held in an environment variable — never committed
- [ ] `git log -p` contains no real weight, target, or body-metric values
- [ ] README covers local setup, seeding, and deployment from a clean clone

#### P8 — Shopping List

**Description:** Aggregates ingredients across a selected week's **resolved, post-swap** plan into a checkable list, combining duplicate ingredients across recipes and grouping by rough category (produce / dairy / meat / dry goods / other). Quantities shown in both grams and non-scale measures, since I don't own a kitchen scale. Checked items persist for that week.

**User Value:** A shop that matches what I'm actually going to cook, including this week's substitutions.

**Acceptance Criteria:**
- [ ] Generated from the resolved plan for a selected week, reflecting all overrides
- [ ] Identical ingredients across recipes are combined into a single line with summed quantities
- [ ] Both gram weights and non-scale measures are shown where the recipe defines them
- [ ] Items are grouped by category and individually checkable, with check state persisted
- [ ] Regenerating after a swap preserves existing check state for unchanged items
- [ ] Copy-to-clipboard as plain text

#### P9 — Daily Walk Reminder

**Description:** An evening nudge if the daily walk is unlogged. Two layers: an **in-app banner** on every screen after the reminder time (cheap, reliable, always built), and **web push** via a scheduled job for a notification when the app is closed (fits on iOS only as an installed PWA, and is historically unreliable there).

Walk *logging* is part of P3 and ships regardless. This item is only the reminder. **This is the first feature to cut if the weekend runs short** — the in-app banner alone satisfies most of the value.

**Acceptance Criteria:**
- [ ] In-app banner appears after the configured reminder time when the walk is unlogged, and dismisses on log
- [ ] Reminder time is configurable; the reminder can be disabled entirely
- [ ] Web push: subscribe from settings, delivered by a scheduled job, one notification per day maximum
- [ ] Push failure degrades silently to the banner — no errors surfaced to the user
- [ ] Notification deep-links to the walk logging action

### Nice-to-Have Features

Deferred to post-MVP; not built this weekend.

- **Weigh-in note field** — *promoted into P5 acceptance criteria; it costs minutes, not hours.*
- **Photo attachment** on weigh-ins for progress pictures.
- **Recipe scaling** — adjust a recipe to a different serving count with recalculated macros.
- **Gym-mode program** — weighted training templates with per-set load and rep logging, needed when the gym restart lands in 1–2 months. The workout data model is built to absorb this without migration.
- **Target recalibration assistant** — prompt a macro recalculation every 5kg lost, using the actual measured rate rather than the original projection.
- **Streaks and adherence scoring** — plan-versus-actual percentages over time.
- **Offline support / PWA install** — service worker caching for the kitchen, where signal is fine but latency is annoying.
- **Multi-user support** — genuinely out of scope; the demo mechanism is the only reason the schema is user-scoped at all.

### Non-Goals

| Not building | Why |
|---|---|
| A searchable food database (MyFitnessPal-style) | The whole premise is a fixed ten-meal rotation. A search index solves a problem I don't have. |
| Barcode scanning | Same reason. My food comes from recipes, not packets. |
| Per-set weight and rep tracking | No weights, no gym, until the restart. A note field covers "how it felt" today. |
| Real user accounts, signup, password reset, email | One human uses this. Demo sessions are ephemeral and credential-free. |
| Native iOS/Android apps | A responsive web app reaches the phone in the kitchen at a fraction of the cost. |
| Calorie estimation from photos, or any ML | Nothing here needs a model. |
| Social features, sharing, leaderboards | Personal tool. |
| Integrations with wearables, Apple Health, Google Fit | No device to integrate, and it would balloon a weekend build. |
| Automatic macro recalculation as weight drops | Recalibration is a conversation with my nutrition assistant, not an algorithm. |

## Technical Considerations

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15**, App Router, React Server Components + server actions | Single codebase, no separate API layer to build or deploy. Server actions collapse mutations into ordinary functions — the largest weekend time saving available. |
| Language | TypeScript, strict | Catches the plan-resolution edge cases at compile time. |
| Database | **Neon Postgres** (serverless) | Real relational modelling for a genuinely relational problem. Free tier is ample for one user plus demo sessions. |
| ORM | **Drizzle** | Typed schema, SQL-shaped migrations, negligible learning overhead. |
| Styling | Tailwind CSS + shadcn/ui | Accessible primitives, mobile-first, no design system to invent. |
| Charts | Recharts | One weight-trend line chart; not worth a heavier library. |
| Auth | Single owner password in an env var + signed HTTP-only session cookie; demo sessions via a separate signed cookie | No auth provider, no user table complexity. Roughly 40 lines. |
| Hosting | **Vercel** | Git push deploys. Cron jobs for demo cleanup and push reminders included. |
| Testing | Vitest for plan resolution, macro totalling, and demo isolation | Only the logic that is genuinely hard to eyeball by hand. |

**Explicitly rejected:** a Vite SPA with IndexedDB (phone and desktop would hold separate data — fatal given the backup requirement) and Railway (equivalent, but more setup time on Saturday morning).

### Data Model

Nine tables. Every user-owned table carries `user_id` so the demo isolation is enforced at the query layer rather than by convention.

```
users
  id, kind ('owner' | 'demo'), display_name, created_at, expires_at (demo only)

profiles
  user_id, height_cm, start_weight_kg, target_weight_kg, goal_pace_kg_per_week,
  target_kcal, target_protein_g, target_fat_g, target_carb_g,
  slot_times (jsonb), program_start_date, timezone

meals                          -- the meal library
  id, user_id, name, slot_type ('breakfast'|'lunch'|'snack'|'dinner'|'extra'),
  kcal, protein_g, fat_g, carb_g, method (markdown), notes, is_archived

meal_ingredients
  id, meal_id, name, grams, non_scale_measure ('1 cup', '2 handfuls'),
  category (for the shopping list), sort_order

plan_template_entries          -- the recurring weekly intent
  id, user_id, day_of_week (0-6), slot, meal_id, sort_order

day_plan_overrides             -- sparse; only rows where reality diverged
  id, user_id, date, slot, meal_id, created_at

meal_logs                      -- what was actually eaten
  id, user_id, date, slot, meal_id, status ('eaten'|'skipped'), note, logged_at

workouts                       -- the workout library
  id, user_id, name, type ('circuit'|'intervals'|'walk'), description,
  rotation_group (e.g. 'bodyweight-circuit'), rotation_index (0 = A, 1 = B)

workout_exercises
  id, workout_id, name, prescription ('3 x 12', '30s on / 30s off'),
  sort_order, notes

training_template_entries
  id, user_id, day_of_week, workout_id (nullable), rotation_group (nullable), sort_order

workout_logs
  id, user_id, date, workout_id, status ('done'|'partial'|'skipped'),
  note, duration_min, logged_at

weight_logs
  id, user_id, date, weight_kg, note, created_at
```

**Plan resolution.** For any date, the plan for a slot is: the `day_plan_overrides` row for that `(user_id, date, slot)` if one exists, otherwise the `plan_template_entries` row for that `(user_id, day_of_week, slot)`. Overrides are sparse, so a week with no swaps stores no override rows at all. This is the mechanism that makes swaps one-off by construction rather than by discipline — the template is physically untouched.

**Plan versus actual.** `day_plan_overrides` records what was *scheduled* after a swap; `meal_logs` records what was *consumed*. Keeping them separate is what lets the export show planned, actual, and swapped-with as three distinct columns.

**Circuit A/B alternation.** A `training_template_entries` row may name a `rotation_group` instead of a fixed `workout_id`. Resolution counts how many days matching that group have elapsed since `program_start_date` and takes that count modulo the number of workouts in the group. Deterministic from the date alone, so it never drifts and never depends on whether a session was logged.

**Gym-restart readiness.** Adding weighted training means new `workouts` rows and new `training_template_entries` — no schema migration. Per-set load logging, if it's ever wanted, is one additive table.

### Integrations

None. No third-party APIs, no wearables, no health platforms. The only external service beyond hosting is the browser Push API for P9, which degrades to an in-app banner when unavailable.

### Performance & Scale

- One real user; peak concurrency is a handful of demo visitors.
- "Right Now" view interactive in under 1.5s on 4G, mid-range Android. This is a kitchen tool — perceived speed is the feature.
- Log and swap actions confirm in under 300ms, optimistically where safe.
- Total data volume after a year: a few thousand rows. Indexing `(user_id, date)` is sufficient; no query will ever need more.
- Neon's serverless cold start is the main latency risk — mitigated by connection pooling and RSC-side fetching.

### Security & Compliance

- No regulatory surface: no third-party PII, no payments, no health data belonging to anyone else. GDPR/HIPAA are not in scope.
- Owner password lives in an environment variable, verified server-side, never shipped to the client. Session cookies are HTTP-only, `Secure`, and `SameSite=Lax`.
- Every query is scoped by `user_id` at the data-access layer, with an automated test asserting a demo session cannot read owner rows.
- Demo provisioning is a rate-limited POST behind an explicit user action so crawlers cannot mass-create sessions.
- Repository hygiene: no `.env`, no personal metrics, no logs in git. A pre-publish check confirms history is clean before the repo goes public.
- Backup: the JSON export is the user-facing mechanism; Neon's point-in-time restore is the infrastructure backstop.

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Weekend build completed | P1–P6 shipped and deployed by Sunday night | Working URL, features exercised end to end |
| Daily use sustained | Opened at least once a day for the first 4 weeks | Meal or workout logs present for ≥ 26 of 28 days |
| Time to "what now?" | < 3 seconds from unlock to answer | Manual timing on the phone, 5 trials |
| Swap actually gets used | ≥ 3 swaps in the first fortnight | Count of `day_plan_overrides` rows |
| Plan adherence visible | Planned-versus-actual computable for every day | Export contains both columns for 100% of logged days |
| Weigh-ins captured | 100% of weekly weigh-ins logged | One `weight_logs` row per week, unbroken |
| Training adherence | ≥ 80% of scheduled sessions marked done or partial | `workout_logs` versus scheduled sessions |
| Weight trend on track | Trailing 4-week average within the configured goal pace | Rate calculation in the app |
| Export used at check-ins | Every check-in backed by an export rather than recall | Assistant receives a file each week |
| Demo works cold | A stranger reaches a populated view in one click, no errors | Tested from a clean browser profile on mobile and desktop |
| Replaces the document | The source planning doc goes unopened after week 1 | Self-reported |

## Assumptions

- Ten or so recipes cover the rotation; the library will grow slowly, not explode.
- Full recipe data — ingredients, gram weights, non-scale measures, method, and per-serving macros — will be supplied up front, before the build starts.
- Recipe macros are per serving and already correct; the app displays them and does not recompute from ingredients.
- Meals are eaten as single whole servings. Partial or double portions are not modelled.
- Weigh-ins are weekly, in kilograms, in the morning. The chart tolerates a more frequent cadence.
- One timezone. No travel handling; day boundaries follow the configured timezone.
- The phone has connectivity in the kitchen — an online-only app is acceptable for MVP.
- The gym restart in 1–2 months will trigger a plan revision, not a rewrite. New workouts and template entries, same schema.
- Targets are recalibrated by a human every ~5kg; the app never adjusts them automatically.
- Weekends are deliberately looser — flexible meals are a slot type, not a failure state.
- The alternating Circuit A/B pattern runs continuously across weeks rather than resetting each Monday.
- Demo visitors are curious, not adversarial; per-session isolation plus rate limiting is proportionate.
- A single-password gate is adequate protection for personal body metrics on a public URL.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Weekend scope overruns; nothing is usable by Monday | M | H | Strict P1–P6 priority order; each ships independently. P9 is designated the first cut, then P8. A working P1–P4 alone is already better than the document. |
| Recipe data entry is more work than expected and stalls the build | M | M | Data supplied up front, before Saturday. Schema accepts a meal with macros and no ingredient rows, so P8 can be seeded later without blocking P1–P6. |
| Plan resolution logic (overrides + rotation) has subtle date bugs | M | H | Pure resolver functions with unit tests covering week boundaries, DST, repeat-across-days, and skipped sessions. This is the one area worth real test coverage. |
| App gets abandoned after a fortnight and the plan reverts to the document | M | H | P1 is optimised for a single job. If the "what now?" answer isn't faster than opening the doc, the app has failed regardless of feature count. |
| iOS web push is unreliable or requires PWA install | H | L | In-app banner is the primary mechanism and always ships. Push is strictly additive and fails silently. |
| Demo sessions accumulate and exhaust the free tier | L | M | Expiry on every demo session, scheduled cleanup job, rate-limited POST provisioning, and a cap on concurrent live demo sessions. |
| Personal metrics leak into the public repository | L | H | Recipes and workouts in seed files; metrics database-only via a gitignored script. Pre-publish history scan before the repo goes public. |
| Data loss — Neon incident or accidental deletion | L | H | JSON export is a one-click full backup; Neon point-in-time restore as backstop. Export ships in the MVP (P6) specifically for this. |
| Macro totals drift from reality because logs are aspirational | M | M | Export separates planned from actual, so the gap is visible at check-ins rather than hidden. |
| Gym restart forces a larger rewrite than expected | L | M | Workout model is already generic (library + template + rotation groups). Weighted training is new rows, not a migration. |
| Neon cold starts make the kitchen experience feel slow | M | M | Server-side fetching, connection pooling, optimistic UI on logging actions. Measure before optimising further. |
| Building for the portfolio distorts the tool into demo-ware | L | M | P7 sits below the functional core deliberately. The demo showcases the real app; it never drives its design. |

## Open Questions

To resolve before or during the build — none of these block starting.

1. ~~**Full recipe data**~~ — **Resolved (FUEL-14).** All ten rotation meals are seeded in `src/lib/seed/meals.ts`, with seven treat recipes alongside them. Two caveats remain: the three oats flavours, both snacks and all seven treats have **estimated** macros derived from their ingredient lists rather than supplied figures (each row is flagged `ESTIMATED` in its notes), and the ciabatta's stated 540 kcal disagrees with its own macros by 12.6%.
2. ~~**Exact exercise lists**~~ — **Resolved (FUEL-14).** Circuit A, Circuit B, skipping intervals + core, and the daily walk are seeded in `src/lib/seed/workouts.ts` with full prescriptions, and the A/B alternation is pinned by test.
3. ~~**Slot times**~~ — **Resolved (FUEL-21).** The table in § P1 above now holds the confirmed routine, and the times are editable in settings. Two corrections came out of confirming it: the workout moves from 17:30 to **06:30**, because 17:30 fell inside a work block and the session actually happens in the morning routine between the coffee and breakfast; and lunch, dinner and breakfast shift to 12:30, 18:30 and 07:30. Snacks are **fixed, not opportunistic** — they are anchored to the two daily walks, at 10:30 and 16:00.
4. **Weekend meals** — should "fried eggs + bangers" and the flexible lunch/dinner be real library entries with macros, or a "flexible / untracked" placeholder slot?
5. **Template weekday assignment** — which specific dinner and which oats flavour land on which weekday, so the template seeds correctly.
6. **Product name** — "Fuel & Form" is a placeholder; it appears in the repo name, page title, and export filenames.
7. ~~**Demo persona**~~ — **Resolved (FUEL-14).** Sam Rivera: 34, 172cm, 84.2kg → 76kg at ~0.5kg/week, on 1,780 kcal / 148g protein / 50g fat / 185g carb. Targets were chosen to sit within ~3% of what the seeded meal library actually delivers, so the demo's macro deltas read near-zero rather than permanently over. These are the figures now used throughout this document and the Brand Guide.

## Document History

- **Created:** 2026-08-10
- **Last Updated:** 2026-08-18 — slot-time defaults confirmed and corrected, and P1's § Slot times table rewritten (FUEL-21); Open Question 3 resolved.
- **Updated:** 2026-08-16 — demo persona figures substituted for the owner's throughout (FUEL-14); Open Questions 1, 2 and 7 resolved.
