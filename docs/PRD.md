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

Sam Rivera. 34, 172cm, 84.2kg → 76kg target, cutting at ~0.5kg/week on ~1,780 kcal / 148g protein / 50g fat / 185g carb. Training 5 days/week at home — bodyweight circuits Mon/Wed/Fri, skipping intervals + core Tue/Thu, plus 30–45 minutes of walking every day including weekends, taken as **two** walks — mid-morning and afternoon (§ P1).

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

Listed in build priority order. P1–P5 are the weekend's non-negotiables; P6–P9 are in scope if the core lands cleanly. The series does not stop at the weekend: P10 onwards are built on top of a shipped MVP and are listed under Post-MVP below, rather than promoted into must-haves they were never part of.

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
| Walks | any time (logged, not scheduled) | **two of them**, every day |

Two of those eight rows do not resolve to a schedulable slot today, and both are deliberate:

- **The two snacks share one window.** `meal_slot` has a single `snack` value, so 10:30 is the only snack time that currently resolves. Snack 2 at 16:00 is recorded here as the confirmed figure for FUEL-55, which adds the second.
- **The walks have no window on purpose.** They are on the template every single day, so a start time would make a walk the active card twice over — over Snack 1 at 10:30, and over dinner on the five days that also have a real session. They are logged whenever.

**There are two walks, and until FUEL-98 the app could only hold one.** This table said "twice daily in practice" from the day it was confirmed, and the snack rows above anchor themselves to a *mid-morning* walk and an *afternoon* one by name — but `workouts` held a single `Daily Walk` row, and `workout_logs` is unique on `(user_id, date, workout_id)`. So the afternoon walk was not refused; it **overwrote** the morning one, duration and all, and adherence, the export and the reminder then all agreed on a number that was half the truth.

The fix is two rows rather than a widened key: **Morning Walk** and **Afternoon Walk**, each with its own template entry on all seven days. Two workouts on one date are two ids, which that index has always allowed. It is what makes the anchoring above mean something — the walk each snack names is now a row with that name — and it needed no schema change, which is § Gym-restart readiness' claim spent a second time. Neither walk gains a window; the displacement argument does not weaken with two, it doubles.

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

**Description:** Today's session — Circuit A, Circuit B, or skipping intervals + core — with its full exercise list and prescriptions. Mark done, partial, or skipped, with an optional free-text note (reps achieved, how it felt) and optional duration. The **two** daily walks are separate, always-present items, each logged with a single tap of its own (FUEL-98) — see § P1 for why there are two and what the app was doing before there were. Deliberately not a full workout tracker — which has narrowed rather than gone. Per-set logging is § P10's; the rest of the sentence still holds. There is no exercise search, no movement library beyond the workouts this app already has rows for, no personal-record tracking, and nothing that decides what to do next. The status, note and duration below are untouched by P10 and are not derived from anything it added.

**What a walk *holds* is § P11's; the one tap is not.** A route, a distance and an estimated step count are a Post-MVP addition to the same row, and the criteria below are what they are built around rather than something they replace. A walk logs in one tap with no permission granted, no receiver and no recording — including on a rest day, when it is the only thing on the screen to log.

**The "visible without scrolling" criterion is re-aimed rather than met or dropped (FUEL-90).** As written it was one criterion about one screen, and § P10 makes `/training` two: a list you read before and after, and a surface you operate during. The whole list cannot survive what P10 adds to it — per-set entry, section headings, a form-media affordance and a rest timer are four tickets each spending the same measured window, and a warm-up, six exercises and a cool-down is eight rows and three headings under any density the Brand Guide is willing to define. So the criterion splits along the states rather than being softened: **the whole list is what is visible when you are planning; the active exercise is what is visible when you are working.** The escape clause is unchanged and still does its own work — "where the list allows" has always meant a long enough list scrolls, and a group heading spends that window exactly as a row does. What it does not license is rows drawn under the Brand Guide's 46px accessible minimum to buy the height back.

Circuit A/B **alternate across sessions**, not by fixed weekday — Mon=A, Wed=B, Fri=A, next Mon=B. Resolution is computed deterministically from the program start date so it never drifts (see Data Model).

**User Value:** Tells me what to do without opening the program document, and produces the adherence record the weekly export depends on.

**Acceptance Criteria:**
- [ ] Today's session resolves correctly per the 5-day schedule, with weekends showing walks-only
- [ ] Circuit A/B alternation is deterministic by date and correct after skipped sessions
- [ ] **Planning:** the full exercise list with prescriptions (sets/reps/duration), grouped, is visible without scrolling on a 375px screen where the list allows
- [ ] **Working:** the exercise being performed and its sets are what is visible without scrolling, on the same screen (§ P10's session state)
- [ ] Status can be set to done / partial / skipped
- [ ] Optional note and duration persist against that date's session
- [ ] Each of the two daily walks is loggable in one tap, and revertible from its own row, every day including weekends
- [ ] Two walks on one date are both stored, and logging the second does not modify the first
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
- [ ] Export a selected week as CSV — one section or file each for weight, training, and meals; § P10 adds a fourth for sets, because a training row is one per session and a set row is many and they cannot share a header
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

**Description:** An evening nudge if a daily walk is unlogged. Two layers: an **in-app banner** on every screen after the reminder time (cheap, reliable, always built), and **web push** via a scheduled job for a notification when the app is closed (fits on iOS only as an installed PWA, and is historically unreliable there).

**One reminder for two walks, and its sentence agrees with the day (FUEL-98).** Still one configurable time, one banner and one notification a day — two reminder times would be the shape most likely to breach the cap below. What changed is the question: "is the walk logged" became "is EVERY walk logged", because the first reading let a morning walk logged at 10:30 buy silence for the evening about an afternoon walk nobody took. And the sentence names a walk in the one case where naming it is the news: with both outstanding it reads "Walks not logged. Reminder set for 19:00.", and with the morning one done it reads "Afternoon Walk not logged." — because a banner that says nothing is logged about a day holding a log is contradicting the record it is reporting on. Naming both in both cases was written first and rejected on length: at 82 characters it wrapped the notice band to two lines, and Brand Guide § Desktop counts that band in the arithmetic giving `/` its 354px window.

Walk *logging* is part of P3 and ships regardless. This item is only the reminder. **This is the first feature to cut if the weekend runs short** — the in-app banner alone satisfies most of the value.

**Acceptance Criteria:**
- [ ] In-app banner appears after the configured reminder time while ANY walk is unlogged, names the walk when exactly one is, and dismisses when the last one is logged
- [ ] Reminder time is configurable; the reminder can be disabled entirely
- [ ] Web push: subscribe from settings, delivered by a scheduled job, one notification per day maximum
- [ ] Push failure degrades silently to the banner — no errors surfaced to the user
- [ ] Notification deep-links to the walk logging action

### Post-MVP Features

The same series and the same standard, built on top of a shipped MVP rather than during the weekend. Never weekend scope and never claimed to be — these are here rather than under Nice-to-Have because they are specified and scheduled, not wished for.

#### P10 — Training Tools

**Description:** The training screen stops being a checklist and becomes a record of the session. Five additions, none of which replaces anything § P3 already does.

- **Per-set logging** — reps against an exercise, set by set, in a new table hanging off the session log rather than off the plan, because a set is history. A `load_kg` column ships dormant so the gym restart stays a data change. Structured targets arrive as nullable columns beside the prescription; the prescription string itself is still rendered verbatim and still never parsed, because a set count derived by regex from prose reads 8 for "8–12 rounds".
- **A manual rest timer** between exercises, started and stopped by hand. Client-only — nothing about a rest interval is worth a row — and counted from a stored end instant rather than an accumulated one, since the phone is locked for most of a ninety-second rest and a throttled tab stops counting.
- **Warm-up and cool-down** as first-class parts of a session rather than rows indistinguishable from the work. This matters the moment per-set logging exists: a mobility drill would otherwise be offered set entry it does not want, and would be costed at the working exercise's rate.
- **Form reference media** per exercise, shipped as bundled assets. No storage service and no third-party embeds, so § Integrations stays at "none" — and because this repository is public, no asset lands without a recorded licence it can carry.
- **An estimated energy cost** per session, shown as a range, from the standard MET formula against the bodyweight of the weigh-in nearest the session's own date. A March session stays costed at March's weight rather than re-pricing itself every time a new weigh-in lands.

**These five arrive on a second state of the screen, not on top of the first.** Brand Guide § Desktop rules it (FUEL-90): `/training` keeps the plan state it has today, and gains a session state — reachable only for today, entered by the primary — where the measure holds the current exercise and its sets instead of the whole list, the rest timer rides in the action bar, and at ≥1272 the remaining exercises sit in the aside so the desktop shows both at once. It is a state rather than a route, § Navigation's two levels are untouched, and the current exercise is derived from the sets already logged rather than stored. The alternative — sets expanding in place under each row — is an accordion, which the Brand Guide has banned since before this milestone was written.

**The session's own record is unchanged.** The status stays three-way, the note stays free text, the duration stays optional, and none of the three is derived from set data. § P3 calls partial a first-class outcome; a status computed from set completion would quietly turn adherence into a percentage, which is the one thing this app has decided not to do.

**The estimate is never netted against intake.** Not in the view, not in the export, not in a summary anywhere. The intake side is measured — stored per-serving macros, summed in fixed point precisely because a total that disagrees with the sum of its parts is a real defect. The burn side is a population average with a wide error bar. Subtracting a modelled number from a measured one produces a figure that looks like arithmetic and is not, and in a deficit it is the specific mistake that eats the deficit. It is shown beside the day's numbers and never inside them. It is a range for the same reason: a single figure would claim a precision the method does not have.

**User Value:** The session is recorded as it was actually performed, which a note field could only ever approximate — and the record reaches the weekly export, where the person it was written for never opens the app.

**Acceptance Criteria:**
- [ ] Sets are loggable, correctable and removable against an exercise for the date being viewed, with a load column present and unwritten until the gym restart
- [ ] The prescription is not parsed anywhere; structured targets are separate columns, and an exercise without them still logs sets
- [ ] Session status, note and duration are unchanged, and none of them is derived from set data
- [ ] A session presents as warm-up, work and cool-down in a fixed order, with set logging offered on the working section only, and a section with no rows renders no empty heading
- [ ] Existing sessions render identically and need no backfill
- [x] The rest timer starts and stops by hand, reads correctly after a backgrounded tab and a reload, and writes nothing to the database
- [ ] Every shipped media asset has recorded provenance and a licence this public repository can carry; an exercise without media renders no affordance and no gap
- [ ] The energy figure is a range, is presented as an estimate, and yields nothing at all — never a zero — for a workout type it has no value for
- [ ] The estimate is not subtracted from, added to, or combined with `target_kcal` or any macro total anywhere, the export included
- [ ] Sets, sections and the estimate all reach both export formats and both scopes, and a session logged before P10 exports cleanly as a session with no sets
- [ ] A demo visitor can neither read nor write the owner's sets
- [ ] The session state is reachable only for today, entered and left by the primary, and resumes correctly after a reload with nothing about it stored in the database

#### P11 — Walk Tracking

**Description:** The walk stops being a row you tick and becomes something the app has a record of. A recorded route, a distance, a duration, an estimated step count, a drawn trace, a name for a route you walk often, and a hand-off to the phone's own map for the times you want streets — with all of it reaching the export and the walk's own energy estimate. There are **two** walks a day (§ P1), so every figure here arrives twice and every screen that shows one shows two.

**Recording only runs with the phone unlocked and the app open. That is a property of the platform, not a defect to be fixed later.** `watchPosition` stops when the screen locks or the app is backgrounded — there is no background geolocation on the web, no service-worker wake-up for a position — and there is no step-counter API at all, on any browser or OS, because the native counters run on a low-power coprocessor a page cannot reach. Everything in this section is built for the foreground rather than around it: a screen wake lock held while recording and re-requested when the tab becomes visible, the in-progress track persisted on every fix, and a gap treated as a gap rather than as a straight line across it. FUEL-105 files the only thing that would lift the boundary — a native companion with a background location service — as a deferred spike, not a promise. This is stated up front because a limitation discovered mid-build gets designed *around*, and one written into the requirement gets designed *for*.

**One tap still logs a walk, with no GPS at all.** § P3's criterion does not bend here: a denied permission, a receiver that never settles, or simply a walk you did not feel like recording — each logs exactly as it does today, with no error surfaced — the same shape as § P9's push degrading silently to the banner. Recording is additive. A walk with no route is a complete walk with fewer figures, never a partial one, and the permission is requested on the tap that starts a recording rather than on page load, so the prompt arrives with a reason attached.

**The step figure is an estimate and says so.** Distance divided by a stride derived from `profiles.height_cm`, rounded to a precision that admits what it is — 4,300 rather than 4,317, which is a lie with three significant figures. A `source` recorded beside the number carries the origin, estimated today and device-supplied if FUEL-105 is ever built, and a device count is never overwritten by a re-estimate. There is **no daily step total**: this app sees only the walking it recorded, so a daily figure would read low every day while looking like a health metric rather than an app-usage one.

**No basemap — recorded here rather than reopened.** The route is drawn in the app's own ink, like the weight chart and the dot grid. The cost is known and accepted: a bare polyline tells you the shape of a walk and not which streets it used. It is closed by naming routes and by handing off to the map application the phone already has, and Brand Guide § Data Display → The Route Trace rules how the trace is drawn, where it lives and what its accessible equivalent is. This document does not restate that ruling.

**Route data is the most sensitive thing this app has ever held, which is why § Risks' leak row is extended rather than inherited.** A trace of a twice-daily walk starts and ends at the front door, repeats, and is timestamped; ten of them identify a home address to anyone who reads them. So the rules are requirements of this section rather than one ticket's judgement: never seeded, never in a fixture, never committed — database-only through the gitignored script, the same rule weight and targets already live under; coordinate precision truncated on the way in; the pre-publish metrics scan taught to see a coordinate; the demo persona's route invented, in a place the owner has never walked; and **routes absent from the export by default**, because the export is a file that gets emailed. If a route is ever exported it is on an explicit opt-in with the consequence stated in the interface, and never in the weekly check-in scope.

**§ Data Model's rows were left to FUEL-100, and it has now built them.** The storage this needs is a table and a few columns, and every number in it was a decision to be made with real sampling in front of it rather than guessed at here — which is the failure § Data Model spent FUEL-89 recovering from. The three figures, and what each is derived from:

- **Coordinate precision: five decimal places, truncated on write.** About a metre. Seven decimals is centimetres, which no consumer GPS measures — it is not accuracy but a claim about a doorway.
- **Point cap: five hundred, reduced by Ramer–Douglas–Peucker.** Taken from the graphic rather than from the storage: Brand Guide § The Route Trace fixes the box at a 3:2 landscape filling the sheet's column, which is 596px at 1272, so five hundred points is already about one per pixel. RDP rather than dropping every other point, which rounds off corners — and a corner is the only thing a shape carries. In practice a walk stores a few dozen points and the cap is a backstop against a jittering receiver rather than the mechanism.
- **End-trimming: yes, 150 metres from each end, on write and irreversibly.** With the honest note the decision has to carry: this protects against the repository far more than against the database, since the row still holds the date and the untrimmed middle still identifies a neighbourhood. What it removes is the one thing a leak would otherwise hand over for free — the point the walk starts and ends at, twice a day, timestamped. A walk shorter than twice the trim stores no trace at all.

**Distance is measured before the trim and the trace stored after it, so the two disagree by design.** The trim is a privacy control over stored geometry; `distance_m` is a measured quantity about somebody's day that reaches the export, the step estimate and the energy range. Shortening it by 300m on every walk — to protect a coordinate the trim has already removed — would corrupt a real figure for nothing. § The Route Trace makes that safe without needing to know it: each walk is fitted to its own box, so the trace shows shape and not size, and the size is carried by the figure beneath it.

**User Value:** The walk is half of this program's movement and the app has been recording it as a tick. A distance and a shape are what make two walks a day legible as something other than compliance — and, like everything else here, they reach the weekly export, where the person they were written for never opens the app.

**Acceptance Criteria:**
- [ ] Each of the day's two walks records independently: a route, a distance and a duration against that walk's own log
- [ ] Recording holds a screen wake lock, re-requests it when the tab becomes visible, and states its battery cost in the interface before it starts
- [ ] An interrupted recording is resumable or savable, never silently lost, and a gap contributes no straight-line distance
- [ ] A denied or unavailable permission logs the walk exactly as today with no error surfaced, and one-tap logging with no recording at all still works from both `/` and `/training`
- [ ] The foreground-only limitation is stated where recording is offered, not only in this document
- [ ] Steps are estimated from distance and height, labelled as an estimate, rounded to a precision that matches their accuracy, and carry a source a device count can later claim without a re-estimate overwriting it
- [ ] No daily step total is presented anywhere
- [ ] The trace is drawn in the app's own ink: no basemap, no tile fetched, nothing loaded from another origin
- [ ] A route can be named; a later matching walk **offers** that name and never applies it silently; names appear in no seed or fixture
- [ ] The map hand-off opens the phone's own map application, loads nothing from another origin, and has a defined behaviour on desktop
- [ ] No coordinate reaches a seed, a fixture, a test or the repository, and the metrics scan detects one — proven by planting it rather than assumed
- [ ] The demo persona walks twice a day with plausible figures and an invented route, nowhere the owner has been
- [ ] Routes are absent from the export unless explicitly opted in, and are never in the weekly scope; distance, duration, steps and step source reach both formats and both scopes, one row per walk
- [ ] The walk's energy estimate uses pace where a distance exists, falls back cleanly where it does not, is shown as a range, and appears in no total anywhere — not `target_kcal`, not a macro, not the export's
- [ ] A walk logged before P11 renders and exports cleanly, its fields absent rather than zeroed

### Nice-to-Have Features

Wished for rather than specified — which is what separates these from § Post-MVP above, where the deferral has since turned into a plan. Nothing here is scheduled.

- **Weigh-in note field** — *promoted into P5 acceptance criteria; it costs minutes, not hours.*
- **Photo attachment** on weigh-ins for progress pictures.
- **Recipe scaling** — adjust a recipe to a different serving count with recalculated macros.
- **Gym-mode program** — weighted training templates for when the gym restart lands. The logging half of this is no longer deferred: § P10 builds it and ships the load column unwritten, so what remains here is the templates themselves and the figures that go in them. Still new rows, still no migration.
- **Target recalibration assistant** — prompt a macro recalculation every 5kg lost, using the actual measured rate rather than the original projection.
- **Streaks and adherence scoring** — plan-versus-actual percentages over time.
- **Offline support / PWA install** — service worker caching for the kitchen, where signal is fine but latency is annoying.
- **Multi-user support** — genuinely out of scope; the demo mechanism is the only reason the schema is user-scoped at all.

### Non-Goals

| Not building | Why |
|---|---|
| A searchable food database (MyFitnessPal-style) | The whole premise is a fixed ten-meal rotation. A search index solves a problem I don't have. |
| Barcode scanning | Same reason. My food comes from recipes, not packets. |
| An automatic progression or programming engine | The app records what was done; it does not decide what to do next. No prescribed load increases, no personal records, and no movement library beyond the workouts already in it. § P10 adds per-set logging and none of this. |
| Real user accounts, signup, password reset, email | One human uses this. Demo sessions are ephemeral and credential-free. |
| Native iOS/Android apps | A responsive web app reaches the phone in the kitchen at a fraction of the cost. One carve-out is **filed rather than granted**: § P11 can only record a walk with the phone awake and the app open, and FUEL-105 asks whether a recording *companion* — a sensor with an ingest and no interface, not a second copy of this app — is the only way past that. It is a deferred spike whose honest alternative is carrying the phone unlocked, which is free. This row stands until that spike says otherwise. |
| Calorie estimation from photos, or any ML | Nothing here needs a model. |
| Social features, sharing, leaderboards | Personal tool — and § P11's route data is what tests that rather than merely restating it. Live location sharing, segment times against other people, a published route: each is a short step from data the app now stores, and none of them is why any of it is recorded. A route leaves this app only through the owner's own export, and § P11 rules that it does not go there by default either. |
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

Sixteen tables, all sixteen built — `exercise_sets` landed with FUEL-91, `workout_exercises.section` with FUEL-92, and `walk_routes` with FUEL-100, which is where § P11's three deferred figures were decided (below). Anything below marked `-- P10` is still specified rather than built, columns as well as tables; everything unmarked is in `schema.ts` today. Every user-owned table carries `user_id` so the demo isolation is enforced at the query layer rather than by convention.

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
  -- TWO rows carry type 'walk' since FUEL-98: Morning Walk and Afternoon
  -- Walk. They are two rows and not one logged twice because `workout_logs`
  -- is unique on (user_id, date, workout_id) — see § P1.

workout_exercises
  id, workout_id, name, prescription ('3 x 12', '30s on / 30s off'),
  sort_order, notes,
  target_sets, target_reps_low, target_reps_high (nullable),
  section ('warmup' | 'work' | 'cooldown', defaulted),
  media_key, media_kind, media_alt, media_credit                 -- P10, FUEL-94, nullable

training_template_entries
  id, user_id, day_of_week, workout_id (nullable), rotation_group (nullable), sort_order

workout_logs
  id, user_id, date, workout_id, status ('done'|'partial'|'skipped'),
  note, duration_min, distance_m (P11; null for a session and for a walk
  logged without recording), steps, steps_source ('estimated'|'device';
  P11, and null together with steps under a CHECK — a count whose origin
  is unnamed is a claim nobody can read), logged_at
  -- unique (user_id, date, workout_id). One row per workout per date, which
  -- is what makes a correction an update — and what made a second walk on
  -- one date an overwrite until there were two walk rows to key it by.

walk_routes                    -- P11; the drawn shape of one recorded walk
  id, user_id, workout_log_id, points (jsonb), point_count,
  simplified_tolerance_m, created_at
  -- unique (user_id, workout_log_id). One trace per walk: a walk recorded
  -- again after an interruption is one walk with a better trace, not two.
  -- Held apart from the summary so that no list query can select the point
  -- array — structural rather than remembered, since no list names this table.
  -- Never seeded, never fixtured, never committed; absent from the export.

exercise_sets                  -- one row per set performed, keyed to the log
  id, user_id, workout_log_id, exercise_id, set_index, reps,
  load_kg (null until the gym restart), created_at

weight_logs
  id, user_id, date, weight_kg, note, created_at

shopping_checks                -- P8; ticked items, scoped to a week by its Monday
  id, user_id, week_start, item_key, checked_at

push_subscriptions             -- P9; where a browser can be reached
  id, user_id, endpoint, p256dh, auth, created_at, last_notified_on
```

**Plan resolution.** For any date, the plan for a slot is: the `day_plan_overrides` row for that `(user_id, date, slot)` if one exists, otherwise the `plan_template_entries` row for that `(user_id, day_of_week, slot)`. Overrides are sparse, so a week with no swaps stores no override rows at all. This is the mechanism that makes swaps one-off by construction rather than by discipline — the template is physically untouched.

**Plan versus actual.** `day_plan_overrides` records what was *scheduled* after a swap; `meal_logs` records what was *consumed*. Keeping them separate is what lets the export show planned, actual, and swapped-with as three distinct columns.

**Circuit A/B alternation.** A `training_template_entries` row may name a `rotation_group` instead of a fixed `workout_id`. Resolution counts how many days matching that group have elapsed since `program_start_date` and takes that count modulo the number of workouts in the group. Deterministic from the date alone, so it never drifts and never depends on whether a session was logged.

**Gym-restart readiness.** Adding weighted training means new `workouts` rows and new `training_template_entries` — no schema migration. Per-set load logging turned out to be wanted, and § P10 is where this sentence gets spent. The claim was not an assumption there but the standard it was held to: if per-set logging needed anything beyond one additive table and additive columns, this paragraph was wrong when it was written.

**It held, with one correction (FUEL-91).** `exercise_sets` is the table and the three `target_*` columns are the columns; nothing existing changed its meaning, and no session logged before P10 needs a backfill. What the paragraph did not cover is that a composite foreign key has to point at a unique constraint, so `workout_exercises` and `workout_logs` each gained `unique(id, user_id)` — additions rather than changes, trivially satisfied by every row already stored, and the only thing the original sentence was silent about. The restart itself stays a data change, `exercise_sets.load_kg` waiting for the first row that fills it.

**And it held again for the sections (FUEL-92), with the cost stated rather than glossed.** `workout_exercises.section` is one additive column with a default, so no stored row needed a backfill and no existing constraint changed. But it is a column and therefore a migration, which the sentence above does not promise to avoid — what that sentence rules out is a migration to add a new *training shape*, and a section is not one. The honest footnote is the CHECK: the column is `text` rather than a `pgEnum` on `workouts.type`'s reasoning, and that keeps the vocabulary out of the type system, but a future 'activation' or 'finisher' still means dropping and re-adding one constraint. Cheaper than `ALTER TYPE`, and not free. `workouts.type` remains the only genuinely open column in the schema, because it is the only one with no constraint at all.

### Integrations

None. No third-party APIs, no wearables, no health platforms. The only external service beyond hosting is the browser Push API for P9, which degrades to an in-app banner when unavailable.

**§ P11 looks like it breaks this sentence and does not, which is worth saying rather than leaving to a reader's benefit of the doubt.** Three things arrive with walk tracking and none of them is a third party:

- **Geolocation is a browser API**, the same kind of thing as the Push API above. The receiver is in the phone; the page asks the browser for a position and the browser asks the device. No account, no key, no request leaving the origin, and nothing that can be deprecated out from under this app by a company that has never heard of it.
- **No map tiles are fetched, because there is no basemap.** This is the decision that keeps the sentence true rather than a happy consequence of it: an embedded map would have been a third-party service, an API key and a request per view, whether or not anyone called it an integration. § P11 records what the no-basemap choice costs and what closes the gap.
- **The map hand-off is a string handed to the operating system** — a `geo:` URI or a maps URL in a link, resolved by whatever application the phone already has. Nothing is loaded from another origin, nothing is fetched, and the app never learns what happened next. A link to a website has never been an integration, and this is a link.

**The honest edge, named rather than pre-approved.** FUEL-105 asks whether a native recording companion is worth building; a companion writing to this app's own ingest would not be a third party either — it is a second client of this codebase, the way the browser is. What it would reach for on the other side is **Health Connect**, which is an on-device store rather than a network service and is also, literally, a health platform, which this sentence names by name. So the deferral carries the question rather than the answer: if that companion is ever built, this section is amended then, with the design in front of it.

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
| Personal metrics leak into the public repository | L | H | Recipes and workouts in seed files; metrics database-only via a gitignored script. Pre-publish history scan before the repo goes public. **§ P11's routes extend this row rather than inherit it** — a coordinate trace identifies a home address, which no weight or macro figure does — so: coordinates never seeded or fixtured, precision truncated on write, the demo's route invented, and `check-no-metrics.sh` taught to see a coordinate with a pattern of its own, proven by planting one (FUEL-100). |
| Data loss — Neon incident or accidental deletion | L | H | JSON export is a one-click full backup; Neon point-in-time restore as backstop. Export ships in the MVP (P6) specifically for this. |
| Macro totals drift from reality because logs are aspirational | M | M | Export separates planned from actual, so the gap is visible at check-ins rather than hidden. |
| Gym restart forces a larger rewrite than expected | L | M | Workout model is already generic (library + template + rotation groups). Weighted training is new rows, not a migration. |
| Neon cold starts make the kitchen experience feel slow | M | M | Server-side fetching, connection pooling, optimistic UI on logging actions. Measure before optimising further. |
| Building for the portfolio distorts the tool into demo-ware | L | M | P7 sits below the functional core deliberately. The demo showcases the real app; it never drives its design. |

## Open Questions

To resolve before or during the build — none of these block starting.

1. ~~**Full recipe data**~~ — **Resolved (FUEL-14).** All ten rotation meals are seeded in `src/lib/seed/meals.ts`, with seven treat recipes alongside them. Two caveats remain: the three oats flavours, both snacks and all seven treats have **estimated** macros derived from their ingredient lists rather than supplied figures (each row is flagged `ESTIMATED` in its notes), and the ciabatta's stated 540 kcal disagrees with its own macros by 12.6%.
2. ~~**Exact exercise lists**~~ — **Resolved (FUEL-14).** Circuit A, Circuit B, skipping intervals + core, and the daily walk are seeded in `src/lib/seed/workouts.ts` with full prescriptions, and the A/B alternation is pinned by test. The walk became two — Morning and Afternoon — in FUEL-98, which is a row each and no change to the prescriptions.
3. ~~**Slot times**~~ — **Resolved (FUEL-21).** The table in § P1 above now holds the confirmed routine, and the times are editable in settings. Two corrections came out of confirming it: the workout moves from 17:30 to **06:30**, because 17:30 fell inside a work block and the session actually happens in the morning routine between the coffee and breakfast; and lunch, dinner and breakfast shift to 12:30, 18:30 and 07:30. Snacks are **fixed, not opportunistic** — they are anchored to the two daily walks, at 10:30 and 16:00.
4. **Weekend meals** — should "fried eggs + bangers" and the flexible lunch/dinner be real library entries with macros, or a "flexible / untracked" placeholder slot?
5. **Template weekday assignment** — which specific dinner and which oats flavour land on which weekday, so the template seeds correctly.
6. **Product name** — "Fuel & Form" is a placeholder; it appears in the repo name, page title, and export filenames.
7. ~~**Demo persona**~~ — **Resolved (FUEL-14).** Sam Rivera: 34, 172cm, 84.2kg → 76kg at ~0.5kg/week, on 1,780 kcal / 148g protein / 50g fat / 185g carb. Targets were chosen to sit within ~3% of what the seeded meal library actually delivers, so the demo's macro deltas read near-zero rather than permanently over. These are the figures now used throughout this document and the Brand Guide.

## Document History

- **Created:** 2026-08-10
- **Last Updated:** 2026-09-09 — **§ Data Model gains `workout_logs.steps` and `steps_source`, and § P11's step figure is built as an estimate that says so (FUEL-103).** No rule changes here; the section has specified this figure since FUEL-99 and the app catches up. **The coefficient is STEP length, not stride**, and the distinction is recorded because § P11's own wording invites the error: a stride is two steps, the words are used interchangeably in casual writing, and taking the stride ratio would have halved every count in the app while leaving a figure that still looked plausible. The check that catches it is steps-per-kilometre against the usual band, and it is a test rather than a comment. **The precision is two significant figures**, which is the honest reading of "a precision that matches its accuracy": rounding to the nearest hundred was the obvious alternative and is wrong at exactly the walks this app records, being 1% at four thousand steps and 50% at one hundred. **The source column is the point of the ticket and the estimate is the smaller half.** `steps_source` declares `'device'` today with nothing able to write it — FUEL-105 is the deferred native companion that could — and the rule that a device count is never overwritten by a re-estimate lives in the upsert's own `DO UPDATE`, where it is atomic, rather than in a read-then-write beside it. That branch is unreachable from every path a user can take, so the integration test **plants the row itself**; a suite that only ever wrote estimates would pass against an implementation that clobbers, and the planted break confirmed exactly one test fails when it does. **Both columns are null or neither is**, under a CHECK, because a count whose origin is unnamed is the confusion the source column exists to prevent. **The cost is stated rather than discovered:** the estimate is stored, so correcting `profiles.height_cm` does not re-estimate past walks — deliberate, since a settings save that silently rewrote every historical figure is the worse failure, and it would rewrite device counts too. § P11's "no daily step total" is enforced rather than merely absent: `steps.convention.test.ts` bans the import from every module that reports a day or a week, and — because this figure is STORED where the energy estimate is computed — a second ban stops the aggregators naming a step field at all. **The export is FUEL-104's** and is not built here; the columns reach the JSON backup regardless, because it serialises the whole row.
- **Previously:** 2026-09-08 — **§ Data Model gains `walk_routes` and `workout_logs.distance_m`, and § P11's three deferred figures are settled (FUEL-100).** The section above deliberately left the point cap, the coordinate precision and the end-trimming to the ticket that could measure them, and this is that ticket. **Precision is five decimal places**, about a metre, truncated on write — seven is centimetres, which no consumer GPS measures, so the extra digits are a claim about a doorway rather than accuracy. **The cap is five hundred points**, taken from the graphic rather than from the storage: Brand Guide § The Route Trace fixes the box at 596px at its widest, so five hundred is already about one point per pixel. It is reduced by Ramer–Douglas–Peucker rather than by dropping every other point, which rounds off corners — and a corner is the only thing a shape carries; a real walk stores a few dozen points, so the cap is a backstop and not the mechanism. **The ends are trimmed, 150 metres from each, on write and irreversibly**, and the decision carries the honest note that it protects against the repository far more than against the database. **Distance is measured before the trim and the trace stored after it**, so the figure and the drawn line disagree by design: the trim is a privacy control over geometry, and distance is a measured quantity that reaches the export, the step estimate and the energy range. § Risks' leak row is now enforced rather than promised — `check-no-metrics.sh` gained **two** coordinate patterns, a paired form and a named-field form, because neither sees the other's case, and both were proven by planting a coordinate and watching the scan go red rather than by trusting a green one. **Routes are absent from the export**, as § P11 requires, recorded in `export.test.ts` and the README beside the two exclusions that came before.
- **Previously:** 2026-09-08 — **§ P11 written, and the walk milestone's standing questions answered before anything is built against them (FUEL-99).** The walk has been one sentence inside § P3 since this document was created — "a separate, always-present item logged with a single tap" — while a whole milestone was scheduled against it. § P11 now carries the feature in its own right, and what it states first is the limitation: **recording only runs with the phone unlocked and the app open**, a property of the web platform rather than a defect, written into the requirement so that it is designed *for* rather than *around*. Two existing statements are amended rather than contradicted. **§ Integrations still reads "None"** and now says why walk tracking does not break it — geolocation is a browser API, no tile is fetched because there is no basemap, and the map hand-off is a string handed to the operating system — with Health Connect named as the honest edge that FUEL-105's deferral carries rather than pre-approves. **§ Non-Goals' social row gains its reason**: "personal tool" was true and untested, and route data is what tests it; its native-apps row gains a carve-out that is filed rather than granted, for a recording companion that is a sensor with an ingest and not a second copy of this app. § Risks' leak row is **extended rather than inherited**, because a coordinate trace identifies a home address and no weight figure does. **§ Data Model gains nothing, on purpose** — the point cap, the coordinate precision and the end-trimming are FUEL-100's decisions to make with sampling in front of it, and a schema written here would be this document guessing at figures it has no way to check. Brand Guide v5.5 carries the other half: where the trace lives, and why § The Four Rules is scoped rather than extended.
- **Previously:** 2026-09-08 — the second daily walk built (FUEL-98). This document has said "twice daily in practice" since FUEL-21 confirmed the routine, and § P1's snack rows anchor themselves to a mid-morning walk and an afternoon one by name — while the app held one `workouts` row and a unique index that made the second walk overwrite the first rather than join it. So this is a defect against the document, not a feature added to it, and what moves is the description of a thing already stated: § P1 says there are two and why they are two rows rather than a widened key, § P3 gives each its own one-tap criterion and adds the storage claim whose absence let the defect live, § P9 records that one reminder now asks whether EVERY walk is logged and names the walk when one of them is all that is left, and § Data Model carries the two rows and the index that motivated them. No schema migration — the walks arrive as rows, which is § Gym-restart readiness' claim spent again.
- **Previously:** 2026-09-02 — `workout_exercises.section` built (FUEL-92), so § Data Model's listing carries it unmarked and § Gym-restart readiness states what it cost. One additive column with a default: no backfill, no existing constraint changed, and every session stored before it renders identically. The claim it is held against is narrower than it looks — "no schema migration" rules out a migration to add a new training SHAPE, and a section is not one — so the paragraph now says plainly that the column is a migration and that its CHECK makes a future 'finisher' one too. Cheaper than `ALTER TYPE`, and not free. The seed's warm-up and cool-down become rows on the way, which fixes something neither document had noticed: they were markdown in `workouts.description`, and nothing in the app renders that column, so the warm-up the program calls non-negotiable was invisible.
- **Previously:** 2026-09-01 — § P3's "visible without scrolling" criterion re-aimed along the two states of `/training`, and § P10 given the state its five additions arrive on (FUEL-90). The criterion was one line about one screen, and § P10 makes that screen two: per-set entry, section headings, a form affordance and a rest timer are four tickets spending one measured window, and a warm-up, six exercises and a cool-down does not fit it under any density the Brand Guide will define. So it splits — the whole list when you are planning, the active exercise when you are working — rather than being softened or quietly dropped. Its "where the list allows" clause is unchanged and still does its own work. The Brand Guide carries the composition, the group heading and the sub-list; nothing about the session's own record, the three-way status or the non-goals moves.
- **Previously:** 2026-09-01 — the per-set non-goal reversed and § P10 written (FUEL-89), because every ticket in that milestone built something this document ruled out by name. § Non-Goals now rules out a progression engine instead; § P3's "not a full workout tracker" is narrowed rather than withdrawn; § Gym-restart readiness' conditional is spent; and § Data Model is reconciled with `schema.ts` — it counted nine tables, enumerated twelve, and had never listed P8's check state or P9's push subscriptions.
- **Updated:** 2026-08-18 — slot-time defaults confirmed and corrected, and P1's § Slot times table rewritten (FUEL-21); Open Question 3 resolved.
- **Updated:** 2026-08-16 — demo persona figures substituted for the owner's throughout (FUEL-14); Open Questions 1, 2 and 7 resolved.
