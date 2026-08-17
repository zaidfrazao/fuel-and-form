# Fuel & Form — Testing Strategy

> Derived from `docs/PRD.md` and `docs/BRAND_GUIDE.md`. Every test below traces to a specific acceptance criterion or risk.

## Position

The PRD states it directly: test **"only the logic that is genuinely hard to eyeball by hand."** Its highest-ranked risk is the weekend overrunning and nothing being usable by Monday. A full testing pyramid built this weekend would make that risk worse, not better.

So this strategy is **tiered by phase**, and the tiering is the strategy:

| Tier | When | Rationale |
|---|---|---|
| **Tier 1 — Weekend** | Must exist before the feature it covers ships | Four pure functions and one security boundary. Everything here is either date arithmetic that will silently break, or a guarantee the PRD makes to strangers on the internet. |
| **Tier 2 — Phase 2** | After the app is in daily use | E2E, accessibility automation, CI, visual regression. Real value, but none of it is what makes Sunday night succeed. |

Anything not in Tier 1 is explicitly **not being built this weekend**, and that is a decision rather than an omission.

### Why not a coverage percentage

There is no repo-wide coverage gate. A global 80% on a one-user app rewards testing the easy 70% — form components, presentational rendering — and would still miss the DST boundary in `resolveDay()` that actually breaks the product. Coverage is enforced at 100% on the Tier 1 files and nowhere else — the four below, plus `lib/date.ts`, which FUEL-8 split out of `resolve-plan.ts` because the rotation resolver needs the same calendar arithmetic. A gate on a resolver that left its own date maths unmeasured would cover the easy half of the risk.

---

## Tier 1 — The Weekend Set

**Framework:** Vitest (per PRD stack). **Command:** `npm run test`.

These are pure functions by design. None of them touch the database, the network, or React — which is exactly why they are cheap to test exhaustively and why the rest of the app doesn't need to be.

### 1.1 Plan resolution — `lib/resolve-plan.ts`

**Traces to:** P2 acceptance criteria; PRD risk *"Plan resolution logic (overrides + rotation) has subtle date bugs — M/H"*.

The resolver: for a given `(user_id, date, slot)`, return the `day_plan_overrides` row if one exists, else the `plan_template_entries` row for that `day_of_week`.

| # | Case | Expected |
|---|---|---|
| 1 | No override exists | Template entry for that weekday |
| 2 | Override exists for that exact date+slot | The override, template untouched |
| 3 | Override exists for a *different* slot, same date | Template for the queried slot |
| 4 | Override exists for the same slot, *next* week | Template for the queried date |
| 5 | Sunday → Monday boundary | Correct `day_of_week` mapping (0-indexed, Monday-first) |
| 6 | Saturday and Sunday | Weekend template entries, not weekday |
| 7 | Date in a DST spring-forward transition | Day boundary follows configured timezone, not UTC, not server local |
| 8 | Date in a DST fall-back transition | Exactly one day, not 25 hours of two |
| 9 | Query date before `program_start_date` | Defined behaviour (empty, not a throw) |
| 10 | Slot with no template entry at all | Returns null, does not throw |
| 11 | Repeat-across-days: overrides on 3 consecutive dates | All three resolve to the override |
| 12 | Repeat spanning a month boundary | All dates resolve correctly |
| 13 | Reverted override (row deleted) | Falls back to template |
| 14 | Archived meal referenced by a template entry | Still resolves; archival affects the picker, not history |
| 15 | Override on a slot the template leaves empty | Resolves the override — a swap *into* an empty slot is an ordinary action |

**Coverage: 100%, enforced.**

Case 15 was added during FUEL-8. It is neither case 3 (a *different* slot is overridden) nor case 10 (nothing is overridden), and it settles whether overrides are consulted unconditionally or only as a replacement for an entry that already exists. It has to be unconditionally, or "add a meal to today only" has no way to work.

### 1.2 Circuit A/B rotation — `lib/rotation.ts`

**Traces to:** P3 — *"Circuit A/B alternation is deterministic by date and correct after skipped sessions."*

Resolution counts elapsed days matching a `rotation_group` since `program_start_date`, modulo the number of workouts in the group.

| # | Case | Expected |
|---|---|---|
| 1 | Program start date itself | Index 0 → Circuit A |
| 2 | First Mon / Wed / Fri of week 1 | A / B / A |
| 3 | Second week Mon | B — the rotation continues across weeks, it does not reset Monday |
| 4 | A session was skipped | Same result as if it had been done — resolution never reads `workout_logs` |
| 5 | Query a date months out | Deterministic, no drift |
| 6 | Query a past date | Same answer as it gave on the day |
| 7 | Rotation group with 3 workouts | Modulo 3, not hardcoded 2 |
| 8 | Date before `program_start_date` | Defined behaviour, no negative modulo |

**Coverage: 100%, enforced.** Case 4 is the one that matters: it is the difference between a deterministic function and one that drifts the first time a session is missed.

### 1.3 Macro totalling — `lib/macros.ts`

**Traces to:** P4 — *"Totals derive from the resolved (post-override) plan for that specific date."*

| # | Case | Expected |
|---|---|---|
| 1 | Full day, no overrides | Sum of template meals |
| 2 | Day with one override | Sum uses the override's macros, not the template's |
| 3 | Day containing an untracked/flexible slot | Excluded from totals; day is flagged partial |
| 4 | Empty day | Zeroes, not NaN |
| 5 | Delta against target | Signed, correct sign convention (`−21`, not `21 under`) |
| 6 | Swap preview | Totals computed for a hypothetical meal without persisting anything |

**Coverage: 100%, enforced.** Case 6 backs the acceptance criterion that a swap's cost is visible *before* confirmation.

### 1.4 Demo isolation — `lib/db/scope.ts`

**Traces to:** P7 — *"No demo session can read or write the owner's data (verified by test)"*, and the PRD's security section. This is the only Tier 1 test that touches a database.

**Type:** integration, against a real test Postgres (Neon branch or local container).

| # | Case | Expected |
|---|---|---|
| 1 | Demo session reads meals / logs / weigh-ins | Only its own `user_id` rows; zero owner rows |
| 2 | Demo session writes a log, swap, or weigh-in | Persists to its own `user_id`; owner rows unchanged |
| 3 | Demo session exports | Export contains demo data only |
| 4 | Two concurrent demo sessions | Neither sees the other's writes |
| 5 | Demo session with a forged/expired cookie | Rejected, no data returned |

**Coverage: 100%, enforced.** This is the guarantee made to strangers on a public URL, so it is not optional and does not move to Phase 2.

### 1.5 Repository hygiene — `scripts/check-no-metrics.sh`

**Traces to:** P7 — *"`git log -p` contains no real weight, target, or body-metric values"*, and the risk *"Personal metrics leak into the public repository — L/H."*

Not a Vitest test. A script, run in a pre-publish check and in a pre-commit hook. Four checks, all of which run before it exits, so one run gives the whole picture:

1. **Working tree** — tracked and untracked files, `docs/` included, no whitelist.
2. **History** — every patch on every ref (`git log -p --all`).
3. **`.env` files** — none tracked except the deliberate `.env.example` template.
4. **`scripts/seed-local.ts`** — still gitignored and still absent from the index.

**It is an allowlist, not a denylist** (FUEL-16). The obvious design — grep for the owner's real figures — is self-defeating in a public repository, because the list of figures to hide would itself be published. Instead the script matches the *shape* of a body metric (a weight in kg, a height in cm, a daily kcal or macro target) and passes only values known to belong to Sam Rivera, the fictional persona. Everything else metric-shaped fails. So the script never contains a real number, and it catches figures nobody enumerated in advance.

Sensitivity comes from domain bounds rather than keyword matching: a body weight is forty to two hundred kilograms, a height one hundred forty to two hundred centimetres, a daily macro target one hundred to three hundred grams. (Spelled out in words because writing them as numerals beside their units makes this paragraph trip the check it is describing — which is the `docs/`-is-not-exempt rule working as intended.) Those bounds are why the plate weights in the PRD, the ingredient sizes in `src/lib/seed/meals.ts`, and every per-recipe macro stay quiet. Two patterns need more help — fat, because a daily target and one meal's fat share a range, and kcal, because four-digit kcal figures are ordinary (typography specimens, the seed library's aggregate output, fixture prose). Both additionally require a target-ish word on the line, and kcal is also skipped in test files. Neither is load-bearing: the weight, height, protein and carb patterns catch the real figure set on bounds alone, in every file, unfiltered.

**Findings are redacted by default.** CI logs on a public repository are public, so a check that printed the leaked value into a build log would have moved the leak rather than reported it. Output masks the digits and keeps the unit (`7****kg`, `1**g protein`); `--show-values` is for local use.

**Two modes, deliberately.** The default scans everything. `--tree-only` skips history and is what the pre-commit hook runs, because history is the one thing a commit cannot fix — see the note below. A shallow clone is a hard **failure**, not a pass: a `depth-1` checkout would otherwise report an unscanned history as clean, so CI needs `fetch-depth: 0`.

One deliberate blind spot: gitignored files are not scanned, because `scripts/seed-local.ts` exists to hold the owner's real profile and weigh-ins and scanning it would mean the check could never pass. Check 4 covers the property that actually matters — that the file is never committed.

> **Resolved in the working tree, still present in history.** `docs/PRD.md` and `docs/BRAND_GUIDE.md` previously carried the owner's real figures. As of FUEL-14 they carry the demo persona's instead (Sam Rivera — 84.2kg → 76kg, 1,780 kcal, 148g protein), and the PRD says so explicitly at the top of its Target Users section, so a reader cannot mistake them for real.
>
> **The old values remain reachable in published git history.** The substitution fixed the files, not the commits behind them; scrubbing those needs a history rewrite and a force-push on an already-public repository. That is FUEL-43's job (pre-publish history scan), and it is the reason this script scans `git log -p` and not just the working tree — a clean checkout is not evidence of a clean repository.
>
> **So the default run fails today, and that is the correct result.** `--tree-only` is green; the full scan reports seven real figures across ten commits and exits non-zero. It stays red until FUEL-43 rewrites history. This is also why the pre-commit hook runs `--tree-only`: gating commits on a pre-existing history problem would block every commit until the rewrite lands, everyone would learn to reach for `--no-verify`, and the hook would be worthless on the day it mattered.

### 1.6 The Tier 1 gate

```bash
npm run test           # Vitest — all of the above
npm run typecheck      # tsc --noEmit, strict
npm run lint           # eslint
npm run check:metrics  # scripts/check-no-metrics.sh — full scan, needs a complete clone
```

All four pass before the repository goes public. `npm run test` alone passes before each of P1–P6 is considered done.

The pre-commit hook lives in `.githooks/pre-commit` and runs `check:metrics:tree`. It is enabled by `git config core.hooksPath .githooks`, which `package.json`'s `prepare` script sets on `npm install` — so a fresh clone gets it without anyone remembering to. No hook manager dependency.

---

## Tier 2 — Phase 2

Built once the app is in daily use and the plan revision for the gym restart is on the horizon. Written down now so the decision to defer is recorded, not forgotten.

### 2.1 End-to-end — Playwright

Four flows, chosen because each is a place where a break would be invisible to unit tests:

| Flow | Steps | Success criterion (from PRD) |
|---|---|---|
| **Demo cold start** | Clean browser profile → land on `/` → "Try the demo" → populated Right Now view | *"A stranger reaches a populated view in one click, no errors"* — verified on mobile and desktop viewports |
| **Log and advance** | Log the active item → view advances → totals update → day-complete summary after the last item | P1 acceptance criteria, end to end |
| **Swap with preview** | Open swap → see resulting day totals → confirm → weekly grid shows the override → revert in one tap | P2 + P4; the override must not touch the template |
| **Export** | Trigger export → file downloads → JSON parses → contains planned, actual and swapped-with columns | P6 acceptance criteria |

**Note on the meantime:** Playwright is available as an MCP server in this environment, so the real app can be driven interactively for verification during the weekend build without a spec suite existing. That is manual verification with a good tool — it is not a substitute for the suite, and it leaves no artefact in CI.

**Dev server:** `npm run dev` on port `3000`.

### 2.2 Accessibility

**Standard:** WCAG 2.1 AA, per the Brand Guide.

Automated — `@axe-core/playwright` across the seven screens in the Brand Guide, in both light and dark modes:

- [ ] Right Now · Meal picker sheet · Meal detail · Training · Weight · Weekly plan · Day complete

Manual, and not automatable:

- [ ] Keyboard traversal of every interactive element; visible 2px umber focus ring never suppressed
- [ ] VoiceOver pass on the Right Now flow
- [ ] **Day ruler and dot grid** expose an accessible summary plus an adjacent data table — the Brand Guide's requirement that "a mark on a screen is not the data"
- [ ] Status is never conveyed by colour alone (both signature graphics already encode by fill/hatch/hairline and solid/ring/size, so they should pass in greyscale)
- [ ] 10.5px Micro labels remain legible and scale under Dynamic Type
- [ ] 200% zoom without horizontal scroll — the weekly grid excepted, which scrolls by design
- [ ] `prefers-reduced-motion` suppresses the chart and ruler draw-in

Contrast ratios are already measured and recorded in the Brand Guide; re-verify only when a token changes.

### 2.3 Visual regression

Playwright screenshots at 375px and 1280px, light and dark, for the seven screens. Baselines in `tests/visual/__screenshots__/`, updated by an explicit `--update-snapshots` run referenced in the PR description.

Low priority: with one user and no design team, drift is unlikely and cheap to spot.

### 2.4 CI — GitHub Actions

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Lint & Types │ → │ Unit (Vitest)│ → │ Integration  │ → │ E2E (PW)     │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

- **On every PR:** lint, typecheck, unit, integration, `check-no-metrics.sh`
- **On merge to `main`:** the above plus E2E against a Vercel preview deployment
- **Weekly:** full E2E, visual regression, Lighthouse

PRs are not blocked on review — `.claude/project.yaml` sets `require_pr_approval: false` — but they **are** blocked on a red pipeline.

### 2.5 Performance

**Requirements, from the PRD:**

| Metric | Target | How |
|---|---|---|
| Right Now interactive | < 1.5s on 4G, mid-range Android | Lighthouse mobile throttled, on the deployed URL |
| Log / swap confirmation | < 300ms | Manual timing; optimistic UI is the mechanism |
| Time to "what now?" | < 3s from unlock | Manual, 5 trials — a PRD success metric, not automatable |

The main risk is Neon's serverless cold start, not bundle size. Measure it before optimising anything else. The system font stack already removes webfont loading from the critical path, which is the Brand Guide's stated reason for choosing it.

### 2.6 Security

- `npm audit` in CI; Dependabot on.
- Manual review of the auth boundary whenever it changes: password compared server-side only, cookie `HttpOnly` + `Secure` + `SameSite=Lax`, demo provisioning rate-limited behind a POST.
- Every data-access function scoped by `user_id` — enforced by test 1.4, reviewed by hand on any new query path.

No regulatory surface: no third-party PII, no payments, no health data belonging to anyone else. GDPR/HIPAA out of scope per the PRD.

---

## Test Data

- **Unit:** inline fixtures. The resolvers are pure — a template array, an override array, a date. No factories needed.
- **Integration:** a seeded test database, torn down per run. Recipes and workouts come from the same seed files the app ships; body metrics are invented.
- **E2E:** the demo persona. It already exists for P7 and has ~12 weeks of generated history, so every chart and list is populated. Using it for E2E means the fixture and the product feature maintain each other.

| Account | Purpose |
|---|---|
| `owner` (test) | Full-access paths, export, settings |
| `demo-a`, `demo-b` | Isolation tests 1.4.4 — two concurrent sessions |

No real credentials in any test file. The owner test password comes from a `.env.test` that is gitignored.

---

## Manual Checklist Per Milestone

**Functional**
- [ ] Every acceptance criterion for the shipped P-item is met
- [ ] Empty state and single-data-point state both render (P5 names these explicitly)
- [ ] Error states display inline, not as modals

**Cross-browser** — Safari first; it is the actual target device
- [ ] Safari iOS · Chrome Android · Chrome desktop · Firefox desktop

**Device**
- [ ] 375px one-handed — primary actions in the bottom third, within thumb reach
- [ ] 768px · 1280px

**Appearance**
- [ ] Light and dark both correct; umber appears exactly once per screen and always means "now"

---

## Bug Report Format

**Summary** · one line
**Steps to reproduce** · numbered
**Expected / Actual**
**Environment** · browser, device, light or dark
**Linked criterion** · the PRD acceptance criterion it violates, if any

---

## Document History

- **Created:** 2026-08-10
- **Derived from:** `docs/PRD.md` (2026-08-10), `docs/BRAND_GUIDE.md` v3 (2026-08-10)
