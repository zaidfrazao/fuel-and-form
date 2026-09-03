# Fuel & Form — Brand & UX Guide

> Companion to `docs/PRD.md`. Where the PRD defines *what* is built, this defines *how it looks, moves, and speaks*.

**Visual reference:** [`docs/BRAND_GUIDE.html`](./BRAND_GUIDE.html) — eight annotated screens at true 375px and again at true 1272px, the day ruler and dot grid, live type specimen and swatches. Self-contained; open it directly in a browser. Also published at <https://claude.ai/code/artifact/71ccc216-6aae-4bd1-b528-bad1ff5786d5> (private to the repo owner).

The two documents are kept in sync. If they ever disagree, **the HTML is the source of truth for appearance** — it is the thing that was actually looked at and approved — and this file is the source of truth for rules, rationale and copy.

## Brand Personality

### Core Attributes

- **Personality:** Calm · Precise · Unsentimental
- **Emotional Response:** Confidence without pressure. The user should open the app mid-cook, get an answer, and close it — feeling informed, never judged and never sold to.
- **Brand Voice:** A neutral instrument. It reports; it does not congratulate, scold, or motivate.

### The Governing Principle

The PRD states the product thesis directly: divergence from plan should become **"data rather than guilt."** That sentence governs every decision in this document.

Practical consequences:

- No streaks, badges, rings-to-close, or celebratory animation.
- A missed workout and a completed workout are rendered with the same visual weight — only the status label differs.
- Red is reserved for genuine numeric overage, never for "you didn't do the thing."
- Empty states describe what will appear, they do not nudge.

## The Four Rules

The interface is flat: no gradients, no textures, no shadows outside sheets. One exception, named and scoped in § Materials → The Scroll Edge. What makes it read as designed rather than generic is scale, restraint, and two signature graphics.

### 1. Scale — 7× contrast, minimum

76px display against a 10.5px label. The space between Value (22px) and Micro (10.5px) is deliberately empty. Mid-sized type is what makes an interface read as a default rather than a decision.

### 2. Accent — umber means "now"

Not a brand colour, not actions, not emphasis. Umber marks the present moment and nothing else: the NOW marker on the day ruler, today's dot in the grid, the latest reading on the chart, today's column header in the week grid, and the swap tint. **One umber element per screen**, and it always says: you are here.

This removes the last judgement call in the system. There is never a question of whether something should be accented.

### 3. Actions — ink, not colour

Primary buttons and the active tab are near-black in light mode, near-white in dark. Nothing competes with the accent, and the screen stays monochrome.

### 4. Graphics — two devices, two time-scales

The **day ruler** for intraday, the **dot grid** for weeks. Split this way they never appear as alternatives to each other on the same screen.

## Signature Graphics

Both are abstractions of data the app already holds. Neither is decoration, and neither needs colour to work.

### The Day Ruler — intraday

A horizontal timeline spanning 06:00–22:00, roughly 40px tall including its scale.

| Element | Rendering |
|---|---|
| Logged slot | 5px filled bar, 15px tall, `text-primary` |
| Skipped slot | 5px bar, 45° hatch pattern, 1px `text-tertiary` outline |
| Upcoming slot | 1px hairline tick, 9px tall, `text-tertiary` |
| Now | 2px `accent` rule, plus a NOW pill in `accent` beneath the baseline |
| Scale | 06 · 12 · 18 · 22 in 10px caps, `text-tertiary` |

It answers "where am I in the day?" before a single word is read. Lives on `/` only.

### The Dot Grid — multi-week

Six weeks × seven days, one row per week, 11px dots on a 9px gutter.

| Element | Rendering |
|---|---|
| Done | Filled `text-primary` |
| Partial | Filled `text-tertiary`, same 11px as Done |
| Skipped | 1.5px `text-tertiary` ring, no fill |
| Walk-only / not recorded | 4px `text-tertiary` or `border` dot |
| Today | Filled `accent` with a 3px `accent-subtle` halo |

Shows the pattern and refuses to grade it, which is the PRD's position on adherence. Lives on Training and Weight.

**Partial** was added in FUEL-27 and is not in `BRAND_GUIDE.html`. It has to exist: `workout_log_status` has held it since the first migration, the schema calls it "a first-class outcome, not a failure state", and both neighbouring dots misreport it — Done overstates, and the Skipped ring says something the user explicitly did not say. It differs by *ink* rather than by weight, so § The Governing Principle's "same visual weight" still holds across all three outcomes and the encoding survives greyscale.

**An unrecorded day is not a skipped one.** A session nobody logged draws the small dot, not the ring, and the adjacent data table reads "Not recorded". A skip is something the user did and recorded; inferring one from an empty table would be the graphic accusing them of a decision they never made — which is the opposite of data rather than guilt.

**Why they never collide:** they operate at different resolutions — one day at hour precision versus six weeks at day precision. No screen shows both.

## Visual Identity

### Appearance Modes

System-adaptive. Both modes are first-class and fully specified; neither is a derived afterthought. Implement via `prefers-color-scheme` with a manual override stored in settings.

> The signal is read through `matchMedia('(prefers-color-scheme: dark)')` rather than a CSS `@media` block, so that a manual override can win over it. The tokens are therefore declared once per mode, not a third time inside a media query — the trade is that a client with JavaScript disabled renders light, which is moot in an app that needs JavaScript to function at all. Decided in FUEL-3; recorded here so it is not re-litigated.

### Color Palette

All values are **light / dark** pairs, with contrast measured against that mode's canvas.

| Token | Light | Dark | Contrast | Usage |
|---|---|---|---|---|
| `accent` | `#8A5A3B` | `#C89A6B` | 5.8:1 / 7.8:1 | **"Now" only** — NOW marker, today's dot, latest reading, today's column header |
| `accent-subtle` | `#F3EBE3` | `#251B14` | 4.9:1 / 6.7:1 for accent on it | Swapped cells and the Swapped tag — the only tinted grounds in the system |
| `ink` | `#1C1917` | `#F5F3F0` | 17.5:1 / 16.4:1 | Primary buttons, active tab, ink tiles, the trend line |
| `ink-fg` | `#FFFFFF` | `#1C1917` | — | Text on an ink fill |
| `canvas` | `#FFFFFF` | `#0C0B0A` | — | Where nearly everything sits |
| `surface` | `#F4F1EC` | `#17150F` | — | Stone tiles, and the chart's plot area — see § Data Display. Nothing else outside sheets |
| `raised` | `#FFFFFF` | `#1F1C19` | — | Sheets |
| `border` | `#E5E1DB` | `#2A2724` | — | Hairlines, separators, hatch strokes |
| `text-primary` | `#1C1917` | `#F5F3F0` | 17.5:1 / 16.4:1 | Titles, values, meal names |
| `text-secondary` | `#78716C` | `#A8A29E` | 4.8:1 / 7.9:1 | Micro labels, slash metadata, trailing values |
| `text-tertiary` | `#B5AEA6` | `#5C5650` | — | Ruler ticks, dots, hatch, placeholders. Never for information the user must read |

#### Semantic Colors

| Token | Light | Dark | Usage |
|---|---|---|---|
| `success` | `#2F7D3E` | `#4ADE80` | On-target deltas, goal-pace rate |
| `error` | `#A93226` | `#F0776B` | Material overage; destructive confirmation |

Used on numbers only. Never on a skip, a missed session, or an under-target figure.

#### Why brown, not amber

The amber this started from (`#E8833A`) measured 2.7:1 on white — it failed AA as text and missed even the 3:1 threshold for UI components, so it needed a second darker token for ink plus a rule about which to use where. Umber clears 5.8:1, so fill and ink are one value. Confining it to "now" then removed the remaining ambiguity.

### Typography

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
```

No webfont. SF Pro on the phone this is built for, and no blocking request in the PRD's sub-1.5s budget for the "Right Now" view.

**Numerals:** `tabular-nums` on every value, weight, time and table figure.

| Level | Size / Line | Weight | Tracking | Usage |
|---|---|---|---|---|
| Display | 76 / 70 | 600 | −0.045em | The one number a screen is about — current weight, day kcal |
| Title | 40 / 41 | 600 | −0.035em | Active item name, screen subject |
| Value | 22 / 26 | 600 | −0.022em | Every figure in a key/value grid |
| Body | 17 / 23 | 400 | −0.011em | List rows, running text |
| Slash | 12.5 / 17 | 500 | 0 | Secondary metadata, prefixed `/ ` |
| Micro | 10.5 / 16 | 600 | +0.16em, caps | Labels, section eyebrows, status |

**The ratio is the rule: 76 ÷ 10.5 ≈ 7.2×.**

Two exceptions that outrank the aesthetic:

- **Body stays at 17px.** The obvious move is 15 or 16. Refused — the dominant case is a phone at arm's length, one-handed, mid-cook. Legibility beats refinement on the one screen the app exists for.
- **Protein stays emphasised by weight, not colour** (700 against 600). Colour is spoken for.

### Spacing & Layout

- **Base unit:** 4px. Multiples: 4, 8, 12, 14, 20, 22, 26, 30, 40.
- **Screen gutter:** 22px mobile, 28px ≥768px.
- **Section rhythm:** 30px between blocks, 14px between a Micro label and its content.
- **Key/value grid:** two columns, 22px row gap, 16px column gap. Three columns for compact stats, on the test in § Desktop — exactly three values, each holding one line in 110px — which is a fact about the figures rather than about the width.
- **Radius:** `sm` 6px (tags) · `md` 12px (buttons) · `lg` 14px (tiles) · `xl` 26px (sheets) · `full` 999px (tab pill, NOW pill).
- **Hairlines:** 1px `border`, dropping to 0.5px at `min-resolution: 2dppx`.
- **Max content width — the rule:** 640px, **for prose**, at every width. A line of running text never gets longer; § Typography's 17px body is what the number was set against. Amended FUEL-85: it used to read "at every width. It does not grow; screens gain columns beside it", which was a rule about *screens* rather than about text, and § Desktop carries the correction.
- **Max content width — what may take the frame:** a graphic, a figure, a folio line or a table. The week grid was written here as "the one exception" and is now simply the first case: it is a table rather than prose and so has no measure to keep. It is a **ceiling the grid reaches, not a width it insists on** — below the width that affords it the seven day columns share what there is rather than the week losing days off its right edge (§ The Week, Two Ways). The grid is also the one element exempt from the screen gutter above: at ≥1024px it bleeds back through `main`'s 28px, because the frame already spends one gutter beside its column and the table cannot afford to pay twice. Everything else on the screen keeps the inset and stays on the measure's x.
- **Above 1024px** the measure sits in a centred frame beside the navigation rail rather than being centred on what is left of the screen. § Desktop owns that grid and these three lines defer to it.
- **Elevation:** none, except sheets — `0 -8px 34px rgba(0,0,0,0.12)`. The stone tile's hover ring is drawn with `box-shadow: inset` and is not elevation: it is a hairline inside the element's own edge, lifting nothing. § Desktop argues it.

### The Week, Two Ways

`/plan` draws the same week in two shapes, and which one you get is a width, not a preference.

| | **< 768px** | **≥ 768px** |
|---|---|---|
| Shape | Seven day sections, stacked | Seven day columns × five slot rows |
| Long axis | Vertical | Horizontal |
| Sideways scroll | None | None |
| Day column | — | Whatever the page affords: 132px at ≥1272px, down to 87px at 768px |
| Meal name | Full width, wraps, never clipped | Column width, wraps |

**Neither shape scrolls sideways, and the wide one had to be made to stop.** It scrolled at every desktop width it was ever drawn at, 1920 included, which is the thing this section used to describe as "by design" and it was not a design — it was three faults agreeing. The columns were declared on an *auto* table, where a width is a floor the longest meal name grows past, so 86 + 7 × 132 measured 1023.3px. The 28px screen gutter was spent twice, once as the frame's own and once as `main`'s padding inside it, leaving 968px for that 1023.3. And the columns were fixed, so when the navigation rail arrived at 1024px and took 248px, the week could give nothing back and simply lost 1.87 days — widening the window made the week smaller.

The rule that replaces it: **the day column is a consequence, not a constant.** The table is fixed-layout with a `<colgroup>`; the slot column states 100px; the seven day columns state nothing and split what is left. At the 1024px cap that division lands on 132px exactly. Below it the columns narrow — measured at 124px at 1023, 97px at 1024, 87px at 768 — and all seven days stay on screen at every one of them. A meal name wraps taller in a narrower column, which is the same trade the stacked shape makes and the one this guide has always preferred to truncation.

**The slot column is 100px, and the 86px this section first specified was a number that only ever worked on paper.** A fixed table grows nothing, so the column has to be wide enough for its longest label outright: "Breakfast" is 79.3px at § Typography's Micro — 10.5px, 0.16em tracking — and the cell spends 20px on padding, so it needs 99.3px and at 86 it spilled over the hairline into Monday. The mock draws this table at 9.5px with 9px of padding and would have got away with 86, which is why the number is taken from the app's type scale rather than the drawing's, and why the drawing has been redrawn to match. This is also the rehabilitation of a number that was read as waste: the auto table resolved its pinned column to 99.3px, and that was not bloat — it was the column fitting its content, the one thing an auto table does well.

**And 132 is where the day column started.** The original `w-[132px]` was never the fault. What was wrong was an 86 that measured 99.3, and a gutter paid for twice; correct both and the same 132 falls out of the division, this time as a result rather than a guess.

**Which is why there is no scroll affordance.** The wide grid carried a right-edge fade, and it was honest while the grid scrolled. A cue for a scroll that can no longer happen is the same lie pointing the other way, so it is gone.

**Why they diverge.** A meal's name is up to fifty characters — `Steak with Garlic Butter, Chips & Peppercorn Sauce` — and the grid never truncates one, because a half-read meal name is not a meal you can recognise. Seven columns carrying that at 375px gives each about 45px, and narrower columns do not fit more of the week: they wrap the same text taller. The horizontal shape fails on a phone for a reason no amount of CSS reaches, so below 768px the week turns ninety degrees and scrolls the way a phone already scrolls.

**What does not change.** Both shapes are one real `<table>`, because a cell still means what it means by the day and the slot it belongs to. The stacked shape makes the day a `<th scope="rowgroup">` and keeps the slot a `<th scope="row">`; the wide shape keeps `scope="col"` for the day. Every cell is the same button, opening the same sheet, optimistic on the same terms. Only one shape is in the accessibility tree at a time.

**The one umber mark** is per shape, not per document: today's day heading when stacked, today's column header when wide. A screen still shows exactly one.

**The cost, stated.** Stacked, you cannot compare Tuesday's dinner against Thursday's at a glance — that comparison is the wide shape's, and it is what the ≥768px screen is for.

### The Day's Numbers on a Phone

`/` draws the meal's macros and the day's totals in two shapes, and which one you get is a width, not a preference.

| | **< 768px** | **≥ 768px** |
|---|---|---|
| Shape | One grid | Two named sections, `This meal` and `Today` |
| The meal's figure | The value | The value, under `This meal` |
| The day's figure | The slash line beneath it | Its own grid, under `Today` |
| Height | ~144px | 354px |
| The day ruler | Below the figures | Above them |

**Why they diverge, and it is arithmetic rather than taste.** At 375×667 the chrome comes to **313px — 46.9%**: the demo banner, the walk reminder, a 140px action bar and the 86px navigation shell. That leaves a 354px window, and the two grids wanted all 354 of it before the title and the ruler had taken anything. Half the meal's macros were sliced mid-glyph by the action bar's opaque edge and the day's totals were off-screen entirely. Four bands had each taken their share independently and nothing had summed them.

**Alternatives weighed, and why they were not taken.** The action bar's 140px and its place in the bottom third is § Touch Targets working as designed, and the shell's 86px was settled against measurement — neither is available. The § Spacing rhythm would have given ~30px app-wide for a fault local to one screen. The mock's own two-figure summary (`Today so far`, `Protein left`) was shorter still, and is the reason this section exists rather than a straight adoption of it: `week-totals.tsx` carries only kcal and protein, and the four-value grid appears on `/` and the day-complete summary and nowhere else — so dropping fat and carbs on a phone would satisfy **PRD § P4's "all four values shown against target with a signed delta" on no phone screen in the app.** Merging keeps all four. It was the only shape that was both short enough and complete.

**Which way round.** The `<h1>` above names the meal, so the value slot describes the thing that was named; the day is the secondary fact, which is what § Slash Metadata is for. It also resolves a problem the two-grid shape had at every width — two unlabelled grids reading `Calories / Protein / Fat / Carbs` one after the other are not a layout a reader can resolve. Merged, there is only one.

**The ruler moves, and this is the real trade.** A meal name runs to fifty characters against a Title fixed at 40/41 with no smaller step in the scale, so the longest wraps to four lines and 164px — 46% of the window on its own. Measured across all seventeen meals in the library, the ruler above the grid put three of them under the action bar; below it, all seventeen clear. On the longest names something goes under the bar, and it is not the figures: they are what § P4 is measured on, while the ruler is orientation and carries a complete `aria-label` summary of its own. Only a meal card reorders — a workout card has no merged grid to move it past.

**Two notice bands, and they stay two.** The demo banner and the walk reminder are independent by design: one is dismissed with a cookie, the other by logging the walk, and merging them would mean dismissing one took the other with it. Neither is dropped, because the case where both are up — a first-time visitor in the evening, which on a public repository is the common case rather than the rare one — is exactly the case each was written for. The height came out of the demo banner instead: its 57px was the dismiss control's 44px box, not its copy, and § Touch Targets asks for a 44×44 **area**, which a 24px mark with a pseudo-element hit area satisfies exactly. 57 → 47px, no rule bent and no notice hidden.

**What does not change.** Every figure is the same figure, from the same `deltaFromTarget`, with the same signed convention and the same single `error` on a material calorie overage. Protein keeps its weight-700 emphasis in both shapes. Only one shape is in the accessibility tree at a time, and the ruler is rendered twice rather than reordered with CSS `order`, so the sequence a screen reader walks matches what is drawn at both widths.

**The limit, stated.** At **320×568** the chrome is 56.3% of the viewport and the window is 248px — enough for the title and the first row of figures, not the second. There is no arrangement of a 40px title, a two-row grid and 320px of chrome that fits 248px, and this section does not pretend otherwise.

### Touch Targets

44×44px minimum. Primary actions sit in the bottom third, within thumb reach. Destructive controls never sit adjacent to a frequently-tapped one.

The minimum is about the **area that responds to a thumb**, not the size of the mark drawn inside it. A smaller glyph with its hit area expanded to 44×44 — by padding, or by a pseudo-element where padding would set the height of the row — meets this in full. The demo banner's dismiss is the one place that distinction is currently load-bearing; see § The Day's Numbers on a Phone.

**The 44×44 minimum holds at every width; the bottom third does not.** The area a pointer must hit names no posture, but thumb reach is a one-handed phone posture named in the rule itself, so above 1024px the primary action sits at the end of its column and the action bars are not sticky. § Desktop carries the rule that decides this, and the reasoning belongs there rather than here — including its one exception, `/training`'s session state, whose bar carries a running readout rather than only a thumb target and stays pinned at every width (FUEL-90).

### Desktop

Everything above this line was drawn at 375px and grown outward, and above 1024px that shows. Measured at 1920×1080 on `/shopping`, before this section:

| | |
|---|---|
| Sidebar | x 0 → 220 |
| Content column | x 764 → 1404 (640px) |
| Void between them | **544px** |
| Void to the right | **516px** |
| Notice band centre against content centre | **−124px** |

**The void and the offset are one fault with two symptoms.** The demo banner and the walk reminder centre a 640px box on the **viewport**, because the root layout renders them above `children`. `<main>` centres its 640px column on the **post-sidebar remainder**, because it is a flex item beside the shell. Two centres, 124px apart, on every screen a demo visitor meets. Nothing is on a shared grid, and a fix for either symptom alone leaves the other standing.

#### The frame

**One container holds the rail and the content, and everything drawn on a screen is inside it — the notice bands included.** It is 1272px wide and centred; below that width it is fluid and its left edge is the screen's.

| Column | Width | |
|---|---|---|
| Rail | 220px | The sidebar — § Navigation's four, with Settings at its foot |
| Gutter | 28px | § Spacing's ≥768px gutter, doing the same job between columns |
| Measure | 640px | The reading column. Every screen has one |
| Gutter | 28px | |
| Aside | 356px | The second column, on the screens that have one |

**1272 is a sum rather than a round number:** the rail, a gutter, and the 1024px § Spacing already fixes as the week grid's maximum. The measure and the aside together come to exactly that 1024 — so `/plan`'s grid spans them both and, at this width and above, is drawn at the full 1024 the sum promises.

**The sum is only true if the column is not paid for twice, and at first it was.** These are border-box columns, so `main`'s own 28px padding sat *inside* the 1024 and left the grid 968 — a number this arithmetic never mentions, and 55px short of the table. The gutter between two columns is the grid's own, which is why the mock draws the frame with no horizontal padding at all. The resolution is stated in § Spacing and is narrow on purpose: the **grid alone** bleeds back out through that padding at ≥1024px, because it is the only element on the screen that cannot be inset and still be right. `/plan`'s heading, week nav and totals keep the inset and stay on the measure's x with the notice bands above them, which is what this section requires of them.

At 1920 the three measurements resolve together:

```
|<--- 324 --->|  rail 220  |28|<--- measure 640 --->|28|<- aside 356 ->|<--- 324 --->|
             324         544 572                  1212 1240          1596          1920

notice band inner box:        572 ----------------- 1212        offset from content: 0
```

The 544px void becomes the 28px gutter. The right-hand void becomes a column with something in it, or — on a screen with no aside — the frame's own margin. And the notice bands stop having a centre of their own: they take the measure's position, which is what `walk-reminder.tsx` already says it wants ("the width and padding match every page's `main`, so the sentence lines up with the content beneath it") and which has never been true above 1024px.

**The mechanism is a grid, not a layout.** The frame, the rail, the gutter and the measure are declared once as custom properties in `globals.css` and read by both layouts. The root layout does not learn the sidebar's width; it reads the same rail declaration the sidebar reads. That distinction is the whole reason this drifted — two independent centrings can disagree, two readers of one declaration cannot.

**Content is left-aligned in the frame, not centred in it.** A rail, a 640px measure and a 1920px screen cannot all be symmetric, and this is where the asymmetry is spent. Every screen puts its measure at the same x whether or not it has an aside, so the column does not move under the reader as they navigate. A screen with no aside leaves that column empty, and the emptiness reads as margin because the rail balances it on the left.

**What this costs, stated.** The sidebar stops being flush with the screen edge — at 1920 it begins 324px in. § Navigation says "the same four as a left sidebar at ≥1024px" and does not say flush, so no rule is bent, but it is a visible change to a shipped screen and it is the price of the notice bands being right. The alternative — keep the rail at x 0 and teach the bands the rail's width — was rejected: it makes the root layout depend on something that exists only under `(app)`, at one breakpoint, which is the shape of the original fault rather than a fix for it.

#### The breakpoints

Two are in use and neither is declared; `md` and `lg` are the framework's defaults, and both keep their default widths. Named here with the job each does, for FUEL-67 to declare in `@theme` — Tailwind v4 is CSS-first, so a breakpoint is a `--breakpoint-*` custom property and there is no config file to hold one.

**`xl` is a redefinition and is called out as one.** Tailwind's default `xl` is 1280px; this sets it to **1272**, because the frame is a sum of its columns and 1280 would leave 8px belonging to no column. It is declared in `@theme` as `--breakpoint-xl`, which FUEL-77 did — this section asked FUEL-67 for it and FUEL-67 drew the frames instead, so for two tickets the redefinition existed only as this paragraph. Nothing used an `xl:` utility in that window, which is why nothing broke and also why nobody noticed; the first one written would have been the 1280 default. `frame.css.test.ts` now compiles a variant and reads the width out of the emitted media query, because a *deleted* breakpoint is not a missing utility — it is the same utility, silently eight pixels late, at the one width the mock is drawn at.

**Redefining a breakpoint moves where its rules are emitted, and this is the one thing to know before writing an `xl:` utility.** Tailwind puts a breakpoint the app has redefined *before* the ones it has not — the order is `xl`, then `sm`, `md`, `lg`, `2xl` — regardless of where the declaration sits in `@theme`. Two rules on one element for one property therefore resolve the opposite way round from how they read: **`md:` and `lg:` beat `xl:`**, so `hidden md:block xl:hidden` is a thing that never stands down. It fails silently and it fails as *duplication* — FUEL-77 shipped two day rulers, and so two umber NOW markers against § The Four Rules, into a baseline before anyone saw it. The rule that follows: **above 1024px, bound a variant to its band rather than overriding a smaller one** — `md:max-xl:block` is one rule true in one band with nothing to outrank it. The emission order is pinned by a test so that a Tailwind release which sorts it properly is noticed rather than assumed.

| | Width | What changes at it | Why this width |
|---|---|---|---|
| — | < 768 | The phone. Pinned pill, 22px gutter, merged macro grid, stacked week, phone ruler | The case the PRD is written for |
| `md` | 768 | Gutter 22 → 28. The week becomes seven columns; `/` splits its macro grid and takes the wide ruler | Already load-bearing — § The Week, Two Ways and § The Day's Numbers on a Phone both turn here. Not moved, because moving it re-opens two settled sections |
| `lg` | 1024 | The pill becomes the rail. The action bars stop being sticky — except `/training`'s session state, which holds the rest timer. The frame appears, fluid | Where the sidebar already is, and the width `min-w-0` was paid for |
| `xl` | 1272 | The frame caps and centres. The aside appears. `/plan`'s week grid reaches its full 1024 and its 132px day columns | Rail + gutter + the 1024px week grid |

**768 to 1023 is a real band and it now has a rule.** Today it is a phone with a wide week grid: an iPad in portrait at 820px gets a floating pill on a 1180px-tall screen. The ruling is that this band takes the **phone's navigation and the desktop's content shapes** — the pill stays, because a 220px rail at 768px is a fifth of the width spent on four items, while the wide week and the split macro grid have the room they were drawn for. It is the one band nobody had looked at, and it is stated here rather than left to fall out of two breakpoints that were never chosen together.

**Amended (FUEL-79): the band has a ceiling, and it is lower than the window.** The ruling above says what the band draws and not how wide it draws it, and building both halves without a ceiling produces a regression rather than a gain. The arithmetic is short: at 1023 there is no rail, so a released element has 967px; at 1024 the rail and its gutter take 248 of them and the same element has 720. Widening the window by one pixel takes 247 away. That is not hypothetical and it was not new — `/plan` has spanned since FUEL-71 with nothing capping it, and measured **967px at 1023 against 776px at 1024**, losing 191px of table and about 27px off every day column at the boundary. FUEL-71 fixed the sideways scroll it was named for; this was the other half, standing at a width no baseline photographs.

So the band does not take what it has. **It takes what it is about to be given** — the frame at `lg` less the rail and its gutter, 776px — at which the rail's arrival costs nothing and every screen widens monotonically from 320 to 1920. `--frame-band-max` derives it beside the frame's other numbers, and nothing new is drawn: this is the same instruction as "a composition of two drawn widths rather than a third drawing", applied to width rather than to layout. The band borrows the 1024 composition's measure early instead of inventing one it cannot keep.

**What the band gains is the shapes, and two of them were already owed.** The measure is 584px at every width from 768 up, so the four-macro grid's `xl:`-bound count had the identical column drawing four islands at 820 and a grid at 1272 — against § Density's own closing words, "the count is decided by the content, and so it is not a width rule". It goes four-across at 768. And FUEL-85's release of graphics from the measure was bound to the cap too, so the band drew its one time graphic in the prose column with the spare width as margin; the day ruler now takes the band's 720 through the whole of 768–1271. The weight chart deliberately does **not**: it has two drawn shapes, one tuned to 584 and one to 968, and a third tuned to 720 is the third drawing this section refuses the band. Its box stays on the measure until the cap.

**One narrowing survives and is named rather than tolerated.** § Spacing takes the gutter from 22px to 28px at 768, so a screen's content box loses 12px crossing that one boundary — 596 to 584 on the measure. The carry-over table settles it (the line reads "22px mobile"), so it stands; `monotonic.spec.ts` excludes that boundary by name rather than by a tolerance, because a threshold wide enough to admit it would also have admitted the 191px at 1024.

#### The measure stays 640

**640px survives, unchanged.** It is a typographic bound rather than a layout one: it was set against § Typography's 17px body, which "stays at 17px" for its own stated reason, and widening the column would buy a longer line at the same type size on every screen in the app — the thing a measure exists to prevent.

What was wrong was never the 640. It was that 640 was the *whole app*, so the only thing extra width could become was void. **Screens gain columns beside the measure; the measure does not grow.** `/plan`'s 1024px is not an exception to that and never was — it is a table rather than prose, and no measure applies to a table. At ≥1272 it is exactly the measure plus the aside.

**Amended (FUEL-85): the 640 binds prose, and only prose.** As first written, that paragraph read as a rule about *screens* — every element on a desktop screen lives in a 640px column or in an aside beside it — and FUEL-77 built it faithfully. The result is the phone with a second phone column next to it, and the fault is here rather than in the implementation. The bound is typographic: it was set against § Typography's 17px body, and **the thing it protects is a line of running text**. A folio line, a time axis, a trend line and a table are none of them.

So the rule is narrowed to what it can defend: **a paragraph, a heading and a sentence of explanation stay on the measure at every width. A graphic, a figure, a folio and a table may take the frame.** `/plan`'s grid stops being an exception and becomes the first case of the general rule. What is still forbidden is the thing this section was written to prevent — a longer line of type at the same size, which no screen in the app now has.

#### What each screen becomes

The mock's eight, which are four routes, one sheet, two states of `/` and two of `/training`:

| Screen | Is | At ≥1272 |
|---|---|---|
| **Right Now** | `/` | A folio and the day ruler across the frame; the measure keeps the meal, its four figures and the actions; the aside takes the day's totals, **the day's own items with their status**, and the Anytime list |
| **Swap** | `/`, a sheet | Stays a sheet at the measure's width: a swap is one decision about one meal, and putting the cost and the choice on opposite sides of a gutter would make it two |
| **Meal detail** | a state of `/` | The same column with more air — one object, read top to bottom, with nothing to set beside it |
| **Training** | `/training`, the plan state | The date paginator across the frame; the measure keeps the session, the exercise list and the note; the aside keeps the dot grid and recent sessions |
| **Session** | `/training`, the live state | The same three zones. The measure swaps the whole list for **the current exercise and its sets**; the aside gains **the rest of the list**, current row marked by weight, above the dot grid and recent sessions. The two states differ by what the measure holds and by nothing else |
| **Weight** | `/weight` | **The reading and the trend take the frame** — a chart is a data graphic and 584 is not its width; the measure keeps the figures and the entry control, the aside takes the weigh-in history FUEL-84 bounded |
| **Weekly plan** | `/plan` | One column at 1024px — the measure and the aside spanned, the grid at its full width and no sideways scroll at this or any width. The only screen where the extra width goes to the content rather than beside it, and the only one whose grid bleeds through the screen gutter to take all of it |
| **Day complete** | a state of `/` | The same column, with more air. Crop marks close the day, and a second column would set something beside a screen whose whole argument is that there is nothing left |

**The three the mock never drew, restated (FUEL-85).** They were ruled "each the measure with more air", and that phrase is what produces a 584px column on a 1920px screen three times over. It is replaced by a job each:

| Screen | At ≥1272 |
|---|---|
| **Shopping list** | `/shopping` — the header stays on the measure, because an up-link, a title and two sentences are prose. **The list flows into two columns across the frame**, grouped by aisle with no group split across a column. It is 3,331px tall today and the one screen where seeing all of it at once is the whole point |
| **Weekly template** | `/plan/template` — the same move, three columns: seven day groups of four slots, 2,776px today |
| **Settings** | `/settings` — **the form and the not-form**. Slot times, the walk reminder and Save are a form you fill in and take the measure; notify, the template link, the plan link, export and sign out are links you follow and take the aside, each keeping its sentence of explanation. A section index beside a panel was the alternative and is rejected: six short groups do not need navigation to reach, and hiding them behind it would be a desktop convention applied for its own sake |

The mock still does not draw them, and that stays true: the mock's eight are not the app's seven. What changes is that a ruling in prose is now specific enough to build from.

#### The header, and one job per zone — FUEL-85

The three amendments above say what a screen *may* do with the width. This says how to decide, and it is the rule the redrawn frames follow.

**One job per zone.** A desktop screen has three, and each answers exactly one question:

| Zone | The question | What answers it |
|---|---|---|
| **Header**, across the frame | Where am I in this? | A Micro folio line, and the screen's own time graphic if it has one — `/`'s ruler, `/training`'s paginator. The graphic's own hairline closes the band, so the separator is the graphic rather than a rule drawn near it |
| **Measure**, 640 | What is the subject? | The eyebrow, the title, the subject's own figures, its actions |
| **Aside**, 356 | What is the context? | The record, the pattern, the day around it, what can still be done |

**The folio is a caption, not a heading.** Micro is this system's register for metadata and a date on a screen that is always today is metadata. A second heading in the header is the failure this rule exists to prevent: it arrives before the subject, and the reader meets three things that all want to be read first.

**Nothing new goes in the box.** Every composition on a desktop screen is built from components § Component Patterns already has. This is stated as a rule because the first draft of `/`'s new header broke it: it put four figures with **progress meters** across the top, and a meter is not in this system — the one place a target is drawn as a length is the weight chart, which is a chart. Reaching outside the system for the most prominent element on a screen is the tell of a design that has stopped listening to the brand, and it is easiest to do in a header.

**Say a thing once.** That same draft stated one fact three ways — the figure, a bar showing its ratio, and the remainder in words — and put a count in the folio that the ruler beneath already drew in ticks. § Data Display gives a figure its value and its slash metadata. A third encoding is noise wearing the clothes of information.

**§ The Four Rules is not amended and is what the redraw is checked against.** One umber element per screen, and it always says *you are here*. The first version of the new `/` had three: the ruler's NOW marker, an accent eyebrow, and an accent status in the day list. The current item in a list is marked by **weight rather than colour** — the rows behind it recede to `text-secondary` and it does not. **The attribution this sentence carried is withdrawn (FUEL-90).** It read "which is the device `recent-sessions.tsx` already uses", and that component does something else: it marks the row being viewed with a `· Viewing` suffix, `aria-current="page"`, and by rendering a `<span>` where the others are `<Link>`s, so the row loses the hover ground rather than the rows behind it losing weight. Every title in that list is `text-primary`. No component in the app recedes a list's other rows, so this rule has been unimplemented since it was written; `/training`'s session aside is its first case, and FUEL-91 builds it.

#### What carries from the phone, and what does not

**A mobile decision carries to desktop unless its written rationale names the phone.** A test rather than a taste, and it settles the cases already on the table:

| Rule | Carries | Because |
|---|---|---|
| § Touch Targets, the 44×44 minimum | **Yes** | It is about the area a pointer must hit, and it names no posture. A mouse is not more accurate than a finger for a user with a tremor |
| § Touch Targets, "primary actions sit in the bottom third, **within thumb reach**" | **No** | Thumb reach is a one-handed phone posture, named in the rule itself |
| § Spacing & Layout, the 22px gutter | **No** | The line reads "22px mobile" and settles itself |
| § The Day's Numbers on a Phone, the merged grid | **No** | Titled for the phone, and its rationale is an arithmetic at 375×667 |
| § The Week, Two Ways, the stacked week | **No** | Its rationale is fifty characters in a 45px column at 375px |
| § Navigation, two levels maximum | **Yes** | Depth is a fact about the information architecture; FUEL-56 argued it without reference to a width |

**The action bars unsticking is the visible consequence,** and it is where the rule earns its keep. § The Scroll Edge already scopes its mask below 1024px, and § Document History records that "FUEL-72 may remove the pinning that creates the edge at all" above it. This is that removal, decided on a rule rather than screen by screen: above 1024px there is no thumb, so the bar has no posture to serve, and a control pinned over content the reader is reading is only a cost. The primary action sits at the end of its column.

**One exception has since been named, and it is the exception that proves what the rule is about.** `/training`'s session state (FUEL-90) puts a running rest timer in the bar, and both halves of the sentence above are claims about a *thumb target* rather than about a pinned box. A live value that scrolls out of sight has failed at its only job, at 1920 exactly as at 375. So that one state's bar stays sticky at every width; every other bar, the same screen's plan state included, is released here as written.

#### The two states of `/training` — FUEL-90

§ P10 turns this screen from a checklist you read before and after into a surface you operate during. Those are two compositions, and this is where the second one is ruled — before FUEL-91 through FUEL-94 each add rows to the same list, none of them able to decide the composition alone.

**There is a live state, and the alternative was ruled out by this document rather than by taste.** The other reading — one long list, sets expanding in place under the exercise you are working — is an accordion, and § Progressive Disclosure bans accordions by name alongside modals and tabs within a screen. It has been in this guide since before the milestone was written. So the choice was made three weeks before the ticket that asked the question, and what follows is the consequence rather than a preference.

**A state, not a route.** § Navigation allows two levels and this is not a third: `/` already carries three states, the screen table above counts them as screens rather than as destinations, and a route would put a session behind a URL that is meaningless the day after. The rail, the pill and the route table are untouched.

**Only today has one.** A past date is a record, which is what the paginator is for; you cannot start Tuesday's session on Thursday. This is the same refusal `plan.ts` and the training actions already make for dates before `program_start_date`, applied at the other end.

**What each state holds:**

| | Plan state | Session state |
|---|---|---|
| The measure | The whole list, grouped | The current exercise, its sets, its form-media affordance |
| Set progress | Slash metadata on the exercise's own row — `/ 3 of 3 sets`. No rows added | The sub-list, at § Lists' dense 46px |
| The primary | **Start session** | **Mark done** |
| The secondaries | Partial · Skip | Partial · Skip |
| The bar | As it is today: sticky below 1024, static at and above | **Sticky at every width** — see below |

**The primary changes because the screen's question does.** § Buttons allows one primary and calls it "the one action the screen exists for". Before you train, that is starting; while you are training, it is finishing. Neither state has two, and Mark done never appears as a secondary — a demotion of the action the whole adherence record depends on.

**The current exercise is derived, not stored.** It is the first working-section exercise whose sets are incomplete, read off the rows FUEL-91 writes. That is the schema's own principle — derive from an absolute, never accumulate — and it buys the reload for free: a phone locked mid-session and woken twenty minutes later resumes where the data says it is, with nothing to go stale. The only client state is whether the session state is entered at all: one boolean, in `localStorage`, keyed to the date and wrapped in try/catch like every other read of it. It writes no row, because § P10 already ruled that a rest interval is not worth one and this is the same class of thing.

**At ≥1272 the two states are one composition.** The measure swaps its contents; the aside gains the rest of the list above what it already holds. The current row is marked by **weight rather than colour** — the rows behind it recede to `text-secondary` and it does not — which is § The Four Rules holding at one umber element per screen. This is the **first** implementation of that device, not a reuse — see the correction above. So the desktop shows you the list and the exercise at once, which is why the desktop never needed the split: the two states are a phone's device, and they exist because 375×667 has one column and § Lists' window to spend in it.

**The rest timer is a row of the action bar, not a fourth button.** § Feedback already puts the failure banner there as a block spanning the column, so the bar is a flex column of at most three things: the banner, the timer, the controls. A fourth control would be a third row of slabs on a phone and would misfile a readout as an action; the timer is neither the thing you came to press nor a signature graphic, and § Desktop's header zone belongs to the screen's own time graphic, which on this screen is the paginator. It is **not a modal** — § Progressive Disclosure — and it is visible while the list is scrolled, which is the whole reason it is in the pinned surface.

**The session state's bar is sticky at every width, and this is the first counter-case to the carry-over rule above.** The release was argued on a posture: "above 1024px there is no thumb, so the bar has no posture to serve, and a control pinned over content the reader is reading is only a cost." Both halves are about a **thumb target**. A running timer is not one — it is a live value, and a live value that scrolls out of sight has failed at the only job it has. The carry-over test asks whether a rule's written rationale names the phone; this one names the thumb, which is narrower still, so it reaches the buttons and stops at the readout. Rather than pin a bar and release the controls inside it, the whole bar stays pinned in this state: a posture that changed when a timer started would move the primary under the reader's hand mid-session.

The plan state is untouched by this and keeps FUEL-72's release exactly. The exception is the session state's, it is named, and it is the only one.

**What it costs, paid where § The Scroll Edge is stated.** A pinned bar above 1024px has a page passing beneath it again, so the mask that stops a line of type being cut through its x-height can no longer be scoped by breakpoint. That section is amended rather than left to hold by luck.

**What was decided against, and why.** *Sets expanding in place* — an accordion, banned above. *A tighter set row* — § Lists' 46px is an accessible minimum and the window is not, so the density would have come out of the wrong one. *A third graphic device for sets* — § The Four Rules gives this system two, the day ruler and the dot grid, at two time-scales; a row of set marks would have been a third at a third. *A separate route* — a URL for a thing that is meaningless tomorrow. *The timer in the header band* — the header answers "where am I in this?", which the paginator already answers, and § Desktop's one job per zone, stated two subsections above, already gives that zone its answer. *The timer in the aside at ≥1272* — it would be the one element on this screen that changed column between two states, and § Desktop has refused that once already for `/training`'s Anytime row.

#### Pointer states

The guide has never had one. `hover` and `cursor` appear nowhere above this line, and that absence is the whole reason the app arrived at eight `hover:` declarations across five files a component at a time, each one a local decision nobody could check against anything. Below 1024px it cost nothing, because a thumb has no hover. The rail is the first control in this app that a pointer is the only way to use, and it is currently the one control that answers a mouse with nothing at all.

**The trigger is `@media (hover: hover)`, not a width.** This is the one rule in § Desktop that is not a breakpoint, and deliberately so. A hybrid laptop is a pointer and a touchscreen at the same width, and a phone brought in on width alone would answer a tap by leaving the hover state stuck to the control afterwards — a state whose whole meaning is "the pointer is here" left drawn on a device that has no pointer. Asking the device what it has is the only question that returns the right answer on all three.

**Two grounds and one ring, chosen by what a control already rests as rather than by what it is.** A rule about the drawing rather than about the component, so that a control invented later already has its hover without this table being reopened.

| What it rests as | On hover | Which controls |
|---|---|---|
| Nothing, an outline, or a ghost | Gains `surface` | Secondary, Text and Destructive buttons · list rows · links · checkboxes · week cells · inactive rail items |
| A solid fill | That fill at 90% over the canvas | Primary buttons · ink tiles · the active rail item · a Destructive button inside a confirmation sheet |
| A `surface` fill | A 1.5px inset rule in `text-3` | Stone tiles |

**The middle row says "that fill" rather than "`ink`" because one control has two rest states.** § Buttons gives Destructive no fill ordinarily and an `error` fill only inside a confirmation sheet, so it takes the first row in one place and the second in the other — and it is the control where getting this wrong is least affordable, since a delete that gives no feedback is a delete pressed twice. The filled half is what the app already writes — `hover:bg-destructive/90`. The unfilled half is the one place these rules do **not** ratify what is there: `button.tsx` currently hovers it to `hover:bg-destructive/10`, a tinted ground no other control has, and the mock draws `surface` like every other ghost. `surface` wins, because a hover says only "the pointer is here" and the ground it uses is not the place to restate what the control does — the `error` text already does that, and § Accessibility's "never colour alone" means it has to.

**The third case exists because the first cannot apply twice.** A `surface` ground hovering to `surface` is a control that does not answer, and the stone tile is the one control in the system already resting on the hover ground. It gets a rule instead of a fill.

**The ring is `text-3` and never `accent`, and selection outranks hover.** § Component Patterns makes tile selection a 1.5px `accent` inset ring, which is the same property at the same weight — so a hover that borrowed the accent would say *chosen* of whatever the pointer happened to cross, and a pointer crossing the chosen tile would take its umber away and leave grey, reporting the opposite of what had happened. A selected tile keeps its umber under the pointer. The ink tile has no such clash, because its hover is a fill.

**The ground the first row adds sits under text that was measured against the canvas, and one token does not survive the move.** § Color Palette states every ratio "against that mode's canvas", and `surface` is not the canvas: `text-secondary` reads 4.80:1 there and **4.26:1** on the hover ground, against § Accessibility's 4.5 for small text. It is not a rounding error and it is not rare — it is every list row, week cell, checkbox and rail item in the app, since the metadata inside those is exactly what `text-secondary` is for, and the second line of several of them is `text-tertiary`, which starts under the line and goes further under it. `BRAND_GUIDE.html` draws the same shortfall — `.row-trail` in `--text-2` on `--hover-ground` — so it is inherited rather than introduced, and it cannot be left where it is: § Accessibility's own tie-break is "where restraint and contrast conflict, contrast wins". **So `text-secondary` and `text-tertiary` inside a control taking the first row's ground are lifted to `text-primary` for as long as the pointer is there**, which reads 15.52:1. This is the mock's own move rather than a new one — `.railitem:not(.active):hover` and `.lnk:hover` both raise their colour to `var(--text)` — applied to the metadata inside a control rather than only to the control's own label, and the mock is amended to draw it. The alternative was darkening `--text-secondary` itself; that is § Color Palette's business and not a hover's, since it would move text on every screen at rest to fix a state that exists only under a pointer.

**Hover is not focus, and neither may be folded into the other.** § Accessibility fixes the focus ring — 2px `accent`, 2px offset, never removed — and that is a statement about where the keyboard is. A pointer user gets one of these two states and a keyboard user the other, so a control drawn with only the hover leaves the keyboard with nothing, and one drawn with only the focus ring answers a mouse with a claim about a caret. Both are specified, on every control class, for that reason.

**`cursor: pointer` on every control, `<button>` included.** This is worth stating flatly because the obvious assumption is wrong: browsers give `<button>` `cursor: default`, not `pointer`, and **Tailwind v4's preflight does not add one** — v3's did, and v4 dropped it, so an app carried across the versions loses the pointer on every button silently. The mock sets it explicitly on `.btn` for exactly this reason. `<a href>` is the one element that carries it natively and is left alone; everything else — buttons, list rows, tiles, checkboxes, week cells — is given it. It is the smallest rule here and the one most often missed, because it is invisible to the keyboard a developer tests with.

**The mobile pill is covered by the same table, and this is why the table is written that way.** A hybrid laptop below 1024px has a pointer and the pill, so "desktop rules apply above 1024px" would have left the app's most-used control unhovered on a real device. Nothing extra is needed: an inactive item rests as nothing and takes `surface`, the active item is an `ink` pill and takes the ink at 90%. The rail and the pill are the same four destinations answering the same way, which is what a rule keyed to the drawing buys over one keyed to the component.

**What takes no hover, said so it is not supplied later.** The chart is not a control — § Data Display gives it no interactive element, no tooltip and no hoverable point, and its obligations are met by the summary and data table § Accessibility requires rather than by anything a pointer uncovers. Neither signature graphic is a control either. Values, Micro labels and Slash metadata are text. A hover on any of these would promise an action that does not exist, which is worse than no feedback: the reader who chases it finds nothing, and learns that a hover in this app does not mean a control.

**The inset ring against § Deliberately Absent, recorded rather than waved through.** That section bans elevation, § Spacing & Layout says "Elevation: none, except sheets", and § Sheets holds the system's only shadow. The hover ring is drawn with `box-shadow: inset` for one reason: CSS gives an element one `border` and the tile's is already spent. It is a 1.5px hairline painted where a second border would go — inside the element's own edge, casting nothing, occupying no space and lifting the tile off nothing. It is held to the same test § The Scroll Edge was: what the flat rule bans is depth painted as a material, and an inset hairline is neither depth nor a material. The three statements above stay literally true and are each qualified in place, so a reader meeting one of them does not have to find this paragraph to know it holds.

**This ratifies a convention rather than replacing one.** The first two grounds are what the app's eight existing declarations already reach for — `hover:bg-surface` and `hover:bg-ink/90`. The values were never the problem. What was missing was anything saying they applied to the rail.

#### Density

§ Spacing & Layout permits "three columns for compact stats" and § Component Patterns permits "three when the figures are short". Neither says when, and a permission with no test is a decision taken again on every screen that meets it.

**Three columns when there are exactly three values and each is short; two otherwise.** Short means the value and its Micro label each hold one line in **110px** — a third of the measure inside the 22px phone gutter, which is the binding case. The mock settles it by drawing the same two grids the same way at both widths: `/weight`'s summary (`Lost 4.95 · To go 8.50 · Rate 0.44`) and the weekly figures on day-complete (`Avg kcal 1,772 · Avg protein 148 · Swaps 1`) are three-column at 375px and three-column at 1272px. The four-macro grid is four values and so is never in scope; § The Day's Numbers on a Phone governs it and merges rather than tightens it.

**The count is decided by the content, and so it is not a width rule.** Stated because width is the obvious test and it is the wrong one. If the count tracked width those two summaries would be two-column on a phone and three on a desktop — the same six numbers in two shapes, for no reason a reader could name, and the § Desktop grid would have to be consulted to read a weigh-in.

**Amended (FUEL-85).** This paragraph used to close with "extra width in this system becomes a second column *beside* the measure, never more columns inside it", which was a second statement of the width rule above and reached further than the density question it belongs to. The density rule stands exactly as written — three when there are three short values, two otherwise, decided by content — and the sentence that generalised it is withdrawn. **The four-macro grid, which this rule names out of scope, goes four-across on a measure and stays 2×2 in an aside**: at 584 the 2×2 puts around 300px between a label and the next value, which is four islands rather than a grid, and at 356 the 2×2 is the density the phone already proves. Same component, same rule about content, two column counts because the two columns are different widths.

**Nothing else gets denser above 1024px.** § Lists keeps 54px rows and its 46px dense contexts; § Spacing keeps its row gaps and its 30px section rhythm. A pointer is more precise than a thumb, but § Touch Targets' 44×44 minimum carries by the rule above — it names no posture — and spending that precision on fitting more list into a screen that has just gained an entire column to put things in is the trade backwards.

**Amended (FUEL-85): density and length are different questions, and this rule was answering both.** Nothing above gets *tighter* — every number in it stands, and a 54px row is a 54px row at 1920. What it was also forbidding, without saying so, is a list **taking more than one column**: `/shopping` is 3,331px tall at 1272 because fifty-six items in five named groups are stacked in a 584px column with 690px of nothing beside them, and `/plan/template` is 2,776px for the same reason. So: **a list of grouped items may flow into columns at ≥1272, with a group never split across one.** The rows keep their height, their gaps and their rhythm; what changes is how many of them are on screen at once, which is the one thing a desktop can offer a list that a phone cannot.

#### Sheets, against a pointer

§ Component Patterns gives a sheet its `raised` fill, 26px top radius, grabber and the system's only shadow; § Progressive Disclosure says "no modals"; § Feedback says a failure is "never a modal". All three were written for a phone, where a panel rising from the bottom edge is the shape a thumb expects, and none of them anticipated a pointer.

**A sheet stays a sheet, held to the measure's column.** It does not become a centred dialog, it does not take a width of its own, and it does not span the frame. It rises from the bottom of the viewport as it always has, and its content sits at the measure's x — the same 640px column the screen behind it is using.

**Why not a dialog, when a pointer is what dialogs were invented for.** Three reasons, in the order they bind. First, the ban on modals names no width, so by this section's own carry-over test it travels. Second, the sheet's content is the argument for its shape: § Progressive Disclosure puts the swap's resulting day totals *inside* the sheet, above the confirm button, and the per-screen ruling above already says why that may not be split — "a swap is one decision about one meal, and putting the cost and the choice on opposite sides of a gutter would make it two". Third, a dialog would be a second overlay pattern for the same job, so the same question would arrive in one shape at 1023px and another at 1273px and a reader would have to learn both.

**What a pointer does change is how it closes.** The grabber is a drag affordance for a thumb and a mouse will not drag it. The backdrop is clickable to dismiss and `Escape` closes the sheet — at every width, because neither costs a thumb anything and neither had a rule. The grabber stays drawn: a hybrid laptop still has the thumb, and it is the mark that says the panel is dismissible at all.

#### What does not change

`<main>` keeps `min-w-0`, and the frame does not retire the reason for it: `/plan`'s grid is still wider than the space beside a rail at 1024px, and without it the page pushes off the right of the screen at exactly that width, silently. `--nav-shell-h` is a below-1024px measurement and stays one — above it the shell is a rail with no height to clear, and the bars that read it are no longer sticky. That stays true of the one bar that is (`/training`'s session state, FUEL-90): it is pinned above 1024px to the bottom of the viewport, not to a shell height, because the thing it has to clear there is nothing. The offset is a below-1024px number in both cases and the variable's scope does not change. Both notice bands keep their full-bleed hairline and their independence; only the position of their inner box changes.

#### The mock is authoritative at two widths

When this section was first written, `BRAND_GUIDE.html` drew all seven screens at `.device { width: 375px }` and nothing else, and its silence above that width was recorded here as the fourth named override — so that "the mock has no second column" was not read as a prohibition and a single column restored later as a fidelity fix. **FUEL-67 drew the frames, and that override is spent.** The mock now carries two captions — "True 375px — the width the PRD names as the dominant case" and "True 1272px — the frame § Desktop fixes, drawn at size rather than scaled" — and it is the source of truth for appearance at **both**.

**The other three overrides stand:** the fourth destination, the day-complete tab bar, and the pinned pill. Each overrides something the mock *draws*, which is what an override is. The fourth overrode a silence, and a silence that has since been filled is retired rather than kept — recorded here rather than deleted, so the count § Document History carries can be read back.

**What the mock is not authoritative about is the band it does not draw.** 768 to 1023 has no frame and will not get one: the ruling above — the phone's navigation with the desktop's content shapes — is a composition of two drawn widths rather than a third drawing, and drawing it would create a specimen free to drift from both. Between 1024 and 1272 the frame is the 1272 drawing, fluid. The mock is authoritative where it draws and this section is authoritative between.

## Component Patterns

Every control class below rests as it is drawn here. **What each one does under a pointer — hover, and `cursor` — is in § Desktop**, which owns it because a hover is a claim about an input device rather than about a component, and is triggered by `@media (hover: hover)` rather than by a width. Focus is § Accessibility's and is never folded into hover.

### Buttons

| Variant | Appearance | When |
|---|---|---|
| **Primary** | `ink` fill, `ink-fg` text, radius 12, 52px | The one action the screen exists for. One per screen. |
| **Secondary** | No fill, 1px `border`, 46px, weight 500 | Real actions that aren't the main one — Swap, Skip, Partial |
| **Text** | No fill, `text-primary`, underlined in `text-tertiary` | Tertiary — Revert, Repeat for 2 days |
| **Destructive** | No fill, `error` text; fill only inside a confirmation sheet | Delete, discard |

**Width: a control is its content plus air — FUEL-85.** On a phone a page's action bar is full-width, because a full-width target is what a thumb wants and § Touch Targets asks for it. That is a phone's reason, so by this section's own carry-over test it does not travel: at ≥1272 the buttons in a **page action bar** take their content's width and sit in a row. A 584px slab is a thumb target drawn on a screen with no thumb, and a row is what lets a fourth control — Undo, when there is a log to take back — be a fourth item rather than a third row of slabs.

**The sheet is excluded, and deliberately.** A sheet *is* the measure — § Sheets holds it to that column at every width — so a full-width primary inside one is right, and the confirm button in the swap sheet is unchanged. The rule is about a bar at the foot of a page, not about every button on a desktop.

### Key/Value Grid

The default way to present numbers. Micro label above, Value below, optional Slash metadata beneath. Two columns by default; three when there are exactly three values and each holds one line in 110px, which § Desktop settles as a property of the figures rather than of the screen — the count does not change with width. It replaces the macro "strip" entirely.

### Lists

Rows on the canvas, separated by hairlines. No card, no fill, no outer rule. 54px minimum; 46px in dense contexts (ingredients, exercises). Ordinal indices — `01`, `02` — in mono `text-tertiary` where sequence matters.

#### Groups — named rather than invented (FUEL-90)

**A list may be divided into named groups, and the heading is Slash, uppercase, `0.16em`, `text-secondary`.** Not Micro: § Accessibility permits Micro "only where the value sits adjacent at 22px or more", and a group heading stands above rows rather than beside a figure. Not a heading in the type scale either — it labels a group and must not compete with the `<h1>` above it.

This is **not a new pattern**. `shopping-list-view.tsx` has rendered aisle headings in exactly that register since the screen shipped, and § Desktop legislates about them by name — "grouped by aisle with no group split across a column" — while this section never defined the thing being grouped. That is the fault this entry fixes: a device the app ships, the desktop rules rely on, and the guide does not describe, which is how a second spelling of it arrives on the next screen that needs one.

**One device, not one per screen.** A session's warm-up / work / cool-down (§ P10, FUEL-92) is the group heading's second case and takes it unchanged. A screen that shows a session may not draw its own.

**A group with no rows renders nothing at all** — no heading, no gap. An empty heading is a claim that something is missing rather than that nothing was scheduled, and § Tone of Voice already refuses to describe absence as failure.

**Marking the rows instead was the alternative, and it is rejected.** A section that exists only as a mark on a row is not a section to a screen reader, and § P10 asks for warm-up and cool-down as "first-class parts of a session rather than rows indistinguishable from the work". A mark makes them distinguishable; a group makes them parts. It is also the more expensive reading of the budget below, which is stated rather than hidden: three headings cost real height, and the criterion that height feeds is re-aimed on that basis rather than around it.

#### Sub-lists — the dense row, one level, never nested in a row

**A sub-list is the 46px dense row, indented to its parent's content column, and it appears only where its parent is the screen's subject.** A set against an exercise (§ P10, FUEL-91) is the first case: three to five rows, an ordinal index, the reps figure, one control.

**A list is never nested inside a row of another list.** That is an accordion, which § Progressive Disclosure bans by name, and the ban is worth restating geometrically because the alternative reads as a layout choice rather than as the forbidden thing: rows that grow when tapped are rows whose neighbours move, on the one screen in the app being operated with one hand and no attention to spare. So a sub-list is not reached by expanding its parent. Its parent becomes the subject and the sub-list is what the screen then holds — which is the second state § Desktop gives `/training`, and is why that state exists rather than being a smaller font.

**44×44 still binds, and it binds the area rather than the row.** A 46px row clears it outright. § Touch Targets' distinction — "the area that responds to a thumb, not the size of the mark drawn inside it" — is what lets a set's control be smaller than its hit box, and it is not a licence to draw the rows tighter than 46.

#### The list's window is a height, not a row count

`/training` at 375×667 has been described as fitting "five rows", and that number was always a consequence rather than a rule: it is the measured height between the last thing above the list and the top of the sticky action bar, divided by 46. Stating it as a count is what made it look like a budget that new devices could be argued into.

**So the rule is the height, and the row count is read off it.** Group headings spend that height like rows do, and a list that overruns it scrolls — which is permitted, and is what "where the list allows" has meant in PRD § P3's criterion since it was written. What is not permitted is buying the height back by making rows shorter than § Lists' figures, because the figures are the accessible minimum and the window is not.

The consequence is stated once, here, rather than discovered four times, and it is measured in the mock rather than argued: grouping `/training`'s five drawn rows into a warm-up, a work section and a cool-down takes the exercise block from **281px to 597px** — nine rows and three headings, each heading 20px and its gap 10 — and the phone frame from **973px to 1290px**. Against a window that ends where the sticky bar begins, that is not a list which needs a tighter row; it is a list which has stopped being the thing on the screen.

**The session state is the answer, and its own height is the evidence.** Drawn with one exercise, its three sets, the form affordance and the timer, that frame is **764px** — shorter than the plan state was at 973px *before* § P10 added anything to it. A screen that holds more information in less height is not a compromise reached by shrinking, and it is what tells you the split was the right cut rather than a way of hiding the overflow.

### Tiles

Flat, radius 14, either `ink` or `surface`. Layout: name at top (15px/600), a single line motif centred, `/ ` metadata at the bottom. Selection is a 1.5px `accent` inset ring, never a fill — and it outranks hover, which is a ring of the same weight in `text-3` on a stone tile and a fill on an ink one (§ Desktop). Used in the meal picker and on meal detail.

### Data Display — the Chart

One chart exists in this system: the weight trend on `/weight`. It is not a signature graphic — § Rule 4's two devices are the day ruler and the dot grid — but § Accessibility's obligations attach to what a graphic *is* rather than to which two are on the list, so it carries a summary and a data table like they do.

| Element | Rendering |
|---|---|
| Plot area | `surface` fill, radius 14 — the second and last permitted use of the token |
| Trend line | 2px `ink`, round caps, no fill beneath it |
| Latest reading | A 4px `accent` disc with a 2px `canvas` ring. The only marker on the chart |
| Gridlines | 1px `border`, horizontal only, at round kilogram values. Unlabelled |
| Target and start | 1px `text-tertiary`, 3/3 dashed, labelled in 10.5px Micro `text-secondary` |
| Date axis | The two ends only, 10.5px Micro `text-tertiary`, beneath the plot area |
| Draw-in | 400ms, once per mount, as a left-to-right wipe. Dropped under `prefers-reduced-motion` |

**Every size in that table is a pixel, and only the shapes scale.** The chart is drawn into a fixed 320-unit box that stretches to whatever column it is given, so until FUEL-76 every number above was multiplied by that column: at 584px the factor is 1.825, and the 10.5px Micro labels painted at **19.2px** — larger than Body, on a screen whose § Typography opens with "the ratio is the rule". The trend painted at 3.65px and the mark at 7.3px, and each got worse as the column got wider. The rule that replaces it: **a chart's geometry scales with its column and its type, ink and marks do not.** A figure in this table is a rendered pixel at 375, at 1280 and at 1920. What scales is the plot — the positions of the points, the plate and the spacing of the rules — because that is the data's own shape.

It is a rule about drawing rather than about this chart, and it costs a second layer to keep: the words and the mark are drawn in an unscaled box stacked on the scaled one, positioned in percentages so the two agree at every width without either being measured. Any future graphic that scales with its container inherits both the rule and the technique.

**The draw-in is a wipe, and it is a wipe for a reason worth writing down.** It was a `stroke-dashoffset` reveal normalised by `pathLength="1"`, which is the better mechanism: the dash was the line's own length, so it covered it exactly and nothing measured anything. It cannot survive the rule above. Holding the trend to 2px takes `vector-effect="non-scaling-stroke"`, and under that a browser normalises the dash against the path in *user* units and then paints it as that many CSS pixels — so at 584px the full-length dash covered 55% of the line and left the trend permanently half-drawn. Measured in Chromium and Firefox both; a percentage dash array fails the same way. A `clip-path` wipe needs no length at all, so it keeps what the dash was chosen for — no measurement, no client JavaScript — and for a series in date order it reveals the line in the direction time runs.

**Why the plot area gets a fill.** It is the one thing in this system that must be read *against* something. A trend line on the bare canvas has no extent, so a reading near the top and one near the bottom carry no meaning until an edge says where the top and the bottom were. Everywhere else, hairlines and space do that work and a fill would be decoration.

**Start and target share a stroke and differ by their labels.** Telling them apart by ink would need a second accent, which § Deliberately Absent forbids, and § Accessibility's "never colour alone" would rule out doing it with colour regardless. The band between the two lines is the whole journey, which is worth being able to see at a glance.

**No vertical gridline, ever.** Time is continuous and a weigh-in is a moment in it, so a vertical rule would draw an edge the data does not have.

**The empty state draws nothing at all.** § UI Copy Examples already writes it — "No weigh-ins yet. Your first entry starts the chart" — and the sentence says the chart does not exist yet. An empty ruled plate would contradict the copy sitting directly above it.

Added in FUEL-35 and not in `BRAND_GUIDE.html`, which predates the chart. Recorded here rather than left to the component, on § The Dot Grid's precedent: a divergence that is written down is a decision, and one that is not is an accident waiting to be re-litigated.

### Sheets

`raised` fill, 26px top radius, grabber, 22px gutters. The only element with a drop shadow — the one inset hover ring in § Desktop casts nothing and is not a second. They answer every question a modal would have, at every width: § Desktop rules that a sheet stays a sheet above 1024px, held to the measure's column, and gains a clickable backdrop and `Escape` for the pointer that will not drag its grabber.

### Navigation

**The four:** **Now** `/` · **Plan** `/plan` · **Training** `/training` · **Weight** `/weight`.

- **Mobile:** a centred pill — 1px `border`, 4px padding. Inactive items are 46×40px icon-only with an `aria-label`; the active item is an `ink` pill showing icon plus text label. The `aria-label` is the label, so the four names above are the only names these destinations have anywhere. It is **pinned to the bottom of the viewport**, overriding the mock — see below.
- **Desktop:** the same four as a left sidebar at ≥1024px — the rail, and § Desktop places it. It is a left sidebar but not one flush to the viewport edge: above 1272px it begins at the frame's edge, not the screen's.
- **Depth:** two levels maximum. Anything deeper is a sheet.
- **Presence:** every authenticated route carries the shell, with no carve-outs — including the day-complete state of `/`, which used to be one and is discussed below. `/login` and `/dev/*` are outside it entirely, and are held there by the route group rather than by a check the shell performs on itself.
- **`/` never requires navigation to be useful.** PRD § P1, which now carries the one reading of what that means. This section defers to it rather than restating it.

#### The routes

| Route | Destination | Level | Parent | In the shell |
|---|---|---|---|---|
| `/` | Now | 1 | — | Yes |
| `/plan` | Plan | 1 | — | Yes |
| `/training` | Training | 1 | — | Yes |
| `/weight` | Weight | 1 | — | Yes |
| `/plan/template` | Weekly template | 2 | `/plan` | No |
| `/shopping` | Shopping list | 2 | `/plan` | No |
| `/settings` | Settings | 2 | `/` | No |

`/login` and `/dev/*` sit outside this hierarchy rather than at level 1 of it: one is what you see instead of the app, the others are specimens of it. Nothing in the table is deeper than level 2, so nothing here is owed a sheet.

**Why these four.** A slot is earned by how often you come back to a screen, not by how much the screen matters. The four are the day, the week, the session and the weigh-in — the four things done on a cadence. Settings is configuration: set once, revisited rarely, and a permanent slot for it would be four-fifths wasted. Weight has the strongest claim of the five, and it is worth saying why: every other destination is a longer look at something `/` has already shown you, while a weigh-in has no slot, no window and no card on `/` at all. It is the one screen the day cannot reach past.

**Where Settings went.** To the foot of `/`, in the register it already occupies there — a text link below everything the screen is for. Two taps from anywhere: the Now pill, then the link. It renders in every state of `/`, day-complete included: once the day is logged that state *is* `/`, so a finished page without the link would make "two taps from anywhere" false every evening. Not a fifth pill, because the pill is four wide and a rule that bends the first time it is applied was never a rule. Not a header control either, which would be one tap but would oblige the shell to own a header, which today it does not: five screens render their own `<header>` and the other two open on a bare `<h1>`. All seven would have to give that top up to the shell — a large change to the app's surface bought for a single low-traffic destination. On desktop the sidebar has a foot, and Settings sits there under a rule.

**`/shopping` keeps a flat URL against its level.** The list is addressed by week through `?week=`, not nested inside a week, so `/plan/shopping` would assert a containment the data does not have. The shell reads this table, not the URL. Recorded rather than quietly tolerated, on § Data Display's precedent: a divergence that is written down is a decision, and one that is not is an accident waiting to be re-litigated.

**`/plan/template` has one parent and it is `/plan`,** matching its URL. The template is what recurs each week before any swaps, which is plan content — § Terminology reserves "Plan" for exactly that. Settings keeps its link to it, and the sentence there explaining which table it writes is worth keeping where it is, but a link is not a parent.

**Parent links and cross-links.** A screen has one parent link and it goes up — the one in the table, and the only one that may be rendered as an up-link. A cross-link goes sideways between two level-1 destinations: the weigh-in list to Training, the training screen to Plan. Cross-links are allowed, carry no hierarchy, and must never be styled as an up-link, because a second thing that looks like a way back is a second parent in everything but name.

The up-link is one component reading the table above — `components/up-link.tsx`, given the route a screen IS rather than the one it points at, so a screen cannot name its own parent. It renders nothing at level 1, which is why `/plan` opens on its `<h1>`: its link to `/` was a cross-link in an up-link's clothes, and the shell now carries Now one tap away. The mark that separates the two is a `‹` before the name, and the accessible name is "Back to <parent>" — a bare destination name announces identically in both directions.

**A link is named by the table.** The Destination column is the name, and every link that names a destination uses it — the pill's `aria-label`, the up-link's "Back to <parent>", and every in-page link to the same place. There is no second name for a destination anywhere in the app, which is the rule the shell and the up-links were already keeping and the in-page links were not.

The `<h1>` is the screen's heading, not its name, and the two are allowed to differ as long as the heading maps. Four of the seven already do differ: `/` heads on the current meal, `/weight` on the latest figure, `/training` on the session, and `/plan` on "Weekly plan" — the mock's own caption for that screen. A heading may say more than the name; it may not say something else, and it may not be what a link says instead. "Weekly plan" ⊃ "Plan" holds, which is the same containment WCAG 2.5.3 asks of the up-link. The three level-2 headings equal their names exactly while there is content to head; with none they name the same thing as an absence — "No shopping list yet" — which § Tone of Voice already governs and which maps for the same reason.

Two kinds of link are outside this. A link **inside a sentence** takes the sentence's grammar — Settings' line about the weekly CSV reads "open Plan and download the week you are looking at" — but still names the destination from the table. A link whose name is an **action** names what happens rather than where it goes: the walk reminder's "Log the walk." goes to `/`, and calling it "Now" would say less about the tap and nothing about the walk; the same string is the body of the push notification, where a destination name would mean nothing at all. Both still owe the scent test: a reader must be able to predict what is behind the tap.

What this corrected, recorded so it is not re-litigated: `/`'s foot link read **"Slot times"** — one section of `/settings`, dating from when it was the only one — and now reads **Settings**. `/plan`'s two foot links read "Shopping list for this week" and "Edit the weekly template", a qualified noun phrase beside an imperative, and now read **Shopping list** and **Weekly template**. Settings' link to `/plan` read "Weekly plan" and now reads **Plan**.

**The pill is pinned, overriding the mock's `margin-top: auto`.** `BRAND_GUIDE.html` draws `.tabbar` in normal flow and stacks it after the action bar on all five of its screens, and § Document History holds the mock as the source of truth for appearance. This file overrides it here, for the third time and in the same form as the other two — named, so nobody restores it later as a fidelity fix.

The cost of the mock's arrangement was measured at 375×667 before it was changed, on the real app: the shell sat at the end of the document, so reaching it meant scrolling **525px on `/`, 1373px on `/training` and 3636px on `/weight`**. On `/` the sticky action bar occupied the exact strip a tab bar would, so the screen showed a pinned bar and no navigation at all. Two of the four destinations were, in practice, unreachable without scrolling to the foot of a screen the user had no other reason to scroll.

**Why the mock could draw it that way and the app cannot.** The mock's screens are single static frames roughly one viewport tall — nothing in it scrolls, so "at the end of the column" and "at the bottom of the screen" are the same place. They stop being the same place the moment a screen has more content than fits, which every screen in this app does. The drawing is not wrong; it is a drawing of a case the app does not have. This is the same reason "no tab bar" did not survive: that caption too was drawn for a screen with nowhere to navigate to.

**What the override costs, and where it is paid.** The mock's flow arrangement was doing real work — it kept the shell clear of `/`'s and `/training`'s `sticky bottom-0` action bars without either knowing about the other. Pinning the shell puts both in the same strip, so the bars now stop one shell-height short of the bottom. That height is `--nav-shell-h` in `globals.css`, one declaration read by both bars and the loading skeleton. It is a hand-written sum rather than something derived from the shell, so `/dev/nav-shell` asserts it against the rendered shell and says so on the page: get it wrong and a screen's primary action goes under the nav, which is silent and happens on the two screens the PRD measures.

**Desktop was untouched by the pinning.** The sidebar at ≥1024px was already pinned — `sticky top-0` — and the pill's bottom pin is scoped below that breakpoint, so nothing about the sidebar changed here. Said of that override only: § Desktop later moved the rail off the screen edge and unstuck the action bars above 1024px, and this paragraph is not a standing claim that desktop is settled.

**Day-complete carries the shell, reversing what this section used to say.** The carve-out was real and had a source: `BRAND_GUIDE.html`'s caption for that screen reads "No tab bar, no score, no praise", and § Document History holds the mock as the source of truth for everything this file does not override. This file now overrides it, the same way it overrode the mock's fourth destination — named rather than quietly contradicted, so that caption is not read later as a live rule.

The cost was written down here before it was collected. With the shell carved out and no link of its own, day-complete was the one screen in the app with no way off it — the browser's back button and a typed URL were the only exits from a screen the user reaches every evening. A rule about how one card is composed had become a hole in the app's navigation. FUEL-56 recorded that cost precisely so whoever built the shell would re-open the question rather than inherit the answer, and FUEL-58 re-opened it.

**What the caption misses.** Crop marks close the *day*; the shell moves between *sections*. The shell is not part of the page it sits below — it is the app's frame, the same way the demo banner is, and a finished page inside a frame is still finished. "No score, no praise" survives untouched and is the half of that caption doing the real work: it forbids the app commenting on how the day went, which nothing here proposes to do. "No tab bar" does not survive, because it was drawn for a mock screen that never had anywhere to navigate to.

Keeping the carve-out is now also the expensive option, which is worth recording as a fact rather than an argument. The shell mounts in `app/(app)/layout.tsx`, and a layout does not know which state `right-now.tsx` returned. Carving day-complete back out would mean resolving the day a second time in the layout, or threading a flag up from the page — real machinery, to restore a screen with no way off it.

The attribution was wrong everywhere it appeared, and the comments and test that carried it are gone with the rule. For the record of why it was so hard to check: they called this "the acceptance criterion", PRD § P1 has no such criterion, and a search for one came back empty. The rule was the caption. Anyone reconciling this screen against the PRD was reading the wrong document.

## Materials

Flat, with five devices doing the work depth would otherwise do.

### Hatching

Hard-edged two-tone stripes at 45°:

```css
repeating-linear-gradient(-45deg, var(--border) 0 1px, transparent 1px 5px)
```

A **pattern, not a texture** — no blending, no opacity ramp, no noise. It marks the absence of data (untracked, flexible, skipped) without implying failure.

### Line Motifs

Eight marks cover the entire library: bowl, cup, roll, pot, plate, bar, egg, walk. 48×48 viewBox, 1.6px stroke, round caps and joins, `currentColor` so one set works on ink and stone in both modes. No photography to shoot, licence, or ship — which matters for a weekend build.

**Qualified (FUEL-94): that last sentence is about decoration, and reference media is not decoration.** It has read as a blanket ban since v3 and was very nearly applied as one. The distinction it was always making: a mark stands in for a thing the reader already knows — a bowl means a meal — so drawing it costs nothing and licensing one would be absurd. Form reference is the opposite case. The picture **is** the content, it is the reason the sheet was opened, and no mark in any register can convey where an elbow goes. So the library above stays exactly as it is and gains nothing, and **imagery is admitted for reference only, inside a sheet, never on a canvas**. Nothing decorative gets a photograph on the strength of this paragraph.

**Amended (FUEL-107): the register is photographs, and the theme argument lost to the reading argument.** This paragraph used to require monochrome line art, on the grounds that reference media cannot be `currentColor` — an `<img>` is an opaque boundary, and this app's theme is a manual toggle, so a `prefers-color-scheme` block inside a file follows the OS rather than the reader's choice. All of that is still true. It was the wrong thing to optimise. Line art inverts exactly and reads as almost nothing: the question a reader opens this sheet with is *how deep, and where does my knee go*, and a drawing does not settle it. So the media is photographic, `dark:invert` is withdrawn — inverting a photograph is a colour negative rather than the same picture — and the frames sit on the sheet's own `raised` fill in both modes, which is what a photograph wants anyway.

**A movement takes two frames.** One still shows a position, not a movement, which is the failure the drawings were only the more obvious half of. Each asset carries a start and a working position, captioned in the Slash register, stacked rather than set side by side: at 375px a two-column pair gives each photograph about 160px, which is narrower than the drawing this replaced *for being too small to read*. Height is the cheap axis — the sheet scrolls, and the reader has already chosen to look.

**The theme cost is now borne rather than designed around**, and that is the honest summary: a photograph is the same photograph in both modes, so dark mode gets a bright rectangle on a dark ground. That is what every photograph in every dark interface does, it is legible, and it is a smaller price than an illustration nobody can gauge depth from.

**And provenance is a rule of this section, not a detail of one ticket.** The repository is public. Every shipped asset records its author, licence, source and retrieval date beside itself in `lib/form-media.ts`, and where the licence requires attribution the app renders it. Assets ship byte-identical — nothing cropped, recoloured, combined or re-encoded — because that is what keeps a share-alike licence a verbatim redistribution rather than an adaptation, and because a file that has been altered is a file whose origin is harder to establish later.

**Provenance that ends at a declaration is recorded as ending there (FUEL-107).** The current assets come from a dataset declaring the Unlicense over photographs it does not document the origin of, and which are plainly professional studio work. They ship as an accepted risk rather than a settled licence. The rule this section takes from that is not "don't" — it is that the file must say so: a distinct licence key for a declaration rather than a licence, an author field reading *not documented upstream* rather than a plausible guess, and no rendered credit, because naming a creator the project cannot identify is worse than naming none. What makes an accepted risk acceptable is that it stays legible enough to reverse.

### Crop Marks

Print registration marks, 11px, `text-tertiary`, at the four corners of the day-complete summary **and nowhere else**. The day is a finished page. A device used once keeps its meaning.

A finished page still sits in the app's frame. The § Navigation shell renders below this screen like every other authenticated one — it did not always, and that section records the reversal and the mock caption it overrides. Crop marks close the day; they do not close the app.

### Slash Metadata

A leading `/ ` in `text-tertiary` marks every secondary fact — `/ 612 kcal · 25 min · serves 1`. It replaces the parentheses, dashes and colons that make interface copy look unconsidered, and costs one character.

### The Scroll Edge

The sticky action bars on `/` and `/training` are opaque, so the page scrolls out of sight at their top edge. **Wherever a bar is pinned, its top 24px is masked**, and a line of type meeting it runs out rather than being cut through the x-height.

**The scope is the pinning, not the breakpoint — amended (FUEL-90).** This read "below 1024px that edge is masked" from FUEL-83 until now, and the two were the same sentence for as long as pinning stopped at `lg`: FUEL-72 released the bars above it, so a bar with nothing passing under it had no edge to soften and the mask was scoped to match. § Desktop has since named one exception — `/training`'s session state keeps its bar pinned at every width, because it carries a running rest timer — and that exception restores a scrolling page beneath an opaque bar at 1920. A mask keyed to a width would have been absent at exactly the width the new state introduced the fault at, and it would have been absent *silently*, which is this document's recurring way of being wrong: the edge is invisible to the unit suite, jsdom applying no stylesheet, and it only appears once the list is long enough to scroll under a bar.

So the condition is stated as what it always meant. A pinned bar masks; a static one has nothing to mask and the declaration is inert on it, which is the same shape as `bottom-[…]` going inert under `lg:static` rather than being removed. Nothing changes for `/` or for `/training`'s plan state at any width.

The **one permitted exception to "no gradients"**, and narrow on purpose: it is a mask, not a material. Nothing is painted — the bar's flat fill is unchanged and the stencil only decides where the bar stops covering. What the flat rule bans is a ramp standing in for depth, which is why Hatching is "a pattern, not a texture" and why charts get no area fill. A shadow would have been the system's second and § Materials reserves the only one for sheets; a rule would have said "boundary" where the screen needs to say "there is more below".

Nowhere else. A device used once keeps its meaning.

### Deliberately Absent

Icons that repeat their own label · filled status pills · card borders · elevation · any second accent · area fills and gradients under charts.

"Elevation" bans depth, not the `box-shadow` property: the stone tile's hover ring is an inset 1.5px hairline standing in for a second `border`, and § Desktop holds it to the same test § The Scroll Edge was held to.

## Interaction Patterns

### Animation & Motion

- **Feel:** snappy, then settled. Motion clarifies origin and is otherwise absent.
- **Durations:** Fast 150ms · Normal 250ms (sheets, routes) · Slow 400ms (chart and ruler draw-in, once per mount).
- **Easing:** `cubic-bezier(0.32, 0.72, 0, 1)` for entrances; `ease-out` for state changes.
- **Animates:** sheet presentation, the hero advancing to the next item, the NOW marker moving, the macro delta after a swap, first chart render.
- **Does not:** logging confirmation, tab switches, list rendering, any value that merely updated.

### Feedback

- **Optimistic by default** — the PRD budgets 300ms and optimism is how that is met.
- **Loading:** skeletons matching final layout. **No spinner on `/` ever.**
- **Success:** silent. The UI reflecting the new state *is* the confirmation.
- **Failure:** inline banner at the point of action, value reverted, "Try again". Never a modal.
- **Undo:** any log or swap is revertible from where it was performed, for the rest of that day.

### Progressive Disclosure

One question per screen. Bottom sheets for the meal picker, the swap preview and the form reference (FUEL-94); the swap's resulting day totals appear *inside* the sheet, above the confirm button. No modals, no accordions, no tabs within a screen.

**The sheet is the disclosure device, and the list above is its cases rather than its licence.** Naming three where there were two is worth a sentence because the ban either side of it is what forces the choice: a reveal that is not a sheet has nowhere else to go, since a modal, an accordion and a tab are each refused by name. So a new question does not get a new shape, it gets this one — and the test it has to pass is the one already stated, that what opens is a single question. The form sheet holds a movement, the words for it and its attribution; it does not also log the set.

**"No accordions" is load-bearing and has been spent once.** It is what decided `/training`'s session state (§ Desktop, FUEL-90): sets expanding in place under an exercise row is an accordion, so the whole live-versus-list question was settled here before it was asked. Worth knowing before the next screen proposes rows that grow when tapped — the answer is a second state, not a shorter animation.

## Accessibility

**Target:** WCAG 2.1 Level AA. Where restraint and contrast conflict, contrast wins and the hairline gets darker.

- **Contrast:** ≥4.5:1 body, ≥3:1 for large text and every control, tick, dot and hairline that carries meaning.
- **Never colour alone:** the ruler encodes status as fill / hatch / hairline; the dot grid as solid / ring / size. Both survive greyscale — and both already are greyscale.
- **Signature graphics** each carry an accessible summary plus an adjacent data table. A mark on a screen is not the data.
- **Micro labels** at 10.5px are permitted only where the value sits adjacent at 22px or more — never for standalone information — and scale with Dynamic Type.
- **Focus:** 2px `accent` ring, 2px offset, on every interactive element in both modes. Never removed.
- **Hover:** a separate statement from focus and never folded into it — a pointer user gets one, a keyboard user the other, so a control drawn with only one of them answers half its users with nothing. Specified per control class in § Desktop, under `@media (hover: hover)` so that no touch device inherits a state it cannot clear.
- **Touch:** 44×44px minimum. Icon-only tabs carry an `aria-label`; the active tab shows its label as text.
- **Reduced motion:** `prefers-reduced-motion: reduce` drops the chart and ruler draw-in; sheets cross-fade at 100ms. Dropping an animation must not remove the thing it animated — the chart's wipe resets its `clip-path` with the animation, or the trend would stay part-drawn for the reader who asked for less motion, and the same trap took the mark's opacity before it (§ Data Display).
- **Dynamic Type:** sizes in `rem`, tested to 200% zoom with no horizontal scroll. Nothing on any screen scrolls sideways at any width from 320px to 1920px, the week grid included — the blanket exception this line used to grant it is withdrawn (FUEL-71), because the grid no longer scrolls at any width and an exception nothing uses is a licence left lying around. See § The Week, Two Ways.
  - **One narrow exception survives, and it is narrower than the old one.** Under *text-only* 200% — the root font size doubled while the layout's `px` boxes do not follow — the wide grid still overflows its container by a measured 13px at 768 and 6px at 820. There is none at 1024 and above. Under ordinary browser zoom, which scales the boxes too and so is just a narrower viewport, there is none at any width. The grid keeps its scroll container for this case; it is the only case left that uses it.
  - **Both labels wrap rather than push**, which is what keeps that residue in single figures. A fixed table cannot grow a column to its content, so at 200% the 100px slot column cannot become the 179px "Breakfast" needs — the word breaks inside the column instead. Measured without it: 27px at 820 and 18px at 1024. The same rule guards the meal name, where the margin is thin rather than theoretical — at 768px the day column is 87.4px, or 67.4px of content, and "Peppercorn" already renders at 64.6px. Breaking a word is not truncating it, and § The Week, Two Ways' "never clipped" is unaffected.

## Tone of Voice

### Writing Style

- **Formality:** plain and direct. Neither corporate nor chatty.
- **Perspective:** second person for actions ("Log eaten"); no person for facts ("Swapped. −21g protein today.").
- **Tense:** present. State what is, not what was achieved.

### Content Guidelines

**Do**
- Lead with the number or the noun.
- Use the user's real vocabulary: swap, log, weigh-in, circuit, walk.
- State consequences factually and immediately, including unwelcome ones.
- Use `−21g` over "21g less" — signed figures parse faster.
- Prefix secondary facts with `/ `.

**Don't**
- Praise, encourage, or commiserate.
- Anthropomorphise the app or use "we".
- Frame a skip or a swap as a failure, a slip, or a cheat.
- Use exclamation marks. Anywhere.
- Say "Oops" or "Something went wrong" — name what happened.
- Add motivational subtitles to empty states.

### UI Copy Examples

| Context | Good | Avoid |
|---|---|---|
| Active item | `Dinner · 19:00` / `Chilli con Carne` | `Time for dinner! 🍛` |
| Swap | `Swapped. −21g protein, −140 kcal today.` | `No problem! We've updated your plan.` |
| Skip | `Skipped. Logged.` | `That's OK — tomorrow's a new day!` |
| Day complete | `Day complete. 1,715 / 1,780 kcal · 141 / 148g protein.` | `Awesome day! You crushed your goals! 🎉` |
| Under target | `−8g protein` in `text-secondary` | `You missed your protein goal` in red |
| Over target | `+220 kcal` in `error` | `Uh oh, you went over!` |
| Empty — weight | `No weigh-ins yet. Your first entry starts the chart.` | `Let's get started on your journey! 💪` |
| Missed workout | `Circuit B · Skipped` | `Workout missed 😔` |
| Error | `Couldn't save. Your connection dropped. Try again.` | `Oops! Something went wrong.` |
| Destructive | `Delete this weigh-in? This can't be undone.` | `Are you sure you want to do this?` |
| Demo banner | `Demo session — your changes are temporary. View the source.` | `Welcome to the demo! Feel free to explore! 👋` |

### Terminology

| Use | Not |
|---|---|
| Swap | Substitute, replace, change |
| Log | Track, record, save, add |
| Weigh-in | Weight entry, measurement |
| Circuit A / Circuit B | Workout 1 / Workout 2 |
| Plan | Schedule, programme, routine |
| Target | Goal |
| Slot | Time, mealtime |

## Implementation Notes

The PRD specifies Tailwind CSS + shadcn/ui. Define every token as a CSS custom property on `:root` and `.dark`, then map them into Tailwind — so a component says `bg-surface` and `text-accent`, never a raw hex.

> The build uses Tailwind v4, which is CSS-first: there is no `tailwind.config.ts`. The mapping lives in the `@theme inline` block of `app/globals.css`, alongside the token definitions themselves. `app/globals.tokens.test.ts` asserts that every value in § Color Palette below is declared for both modes and that no hex appears anywhere else in `src/`.

shadcn/ui defaults require five overrides:

1. **Radius** — `--radius: 0.75rem` (12px) as the button base; tiles override to 14px, sheets to 26px.
2. **Neutrals** — replace the `slate` / `zinc` scale with the warm stone values above. The single change that most determines whether the app looks bespoke or templated.
3. **Card** — strip border, background and shadow, leaving a plain layout primitive. There is no card component in this design; tiles and lists replace it.
4. **Button** — `default` uses `ink`, not the accent. `secondary` is outlined, not filled.
5. **Type scale** — shadcn assumes a 14–16px base with no display tier. Add Display (76) and Micro (10.5); the gap between them is intentional.

The `sonner` toast ships with the shadcn set and has almost no use here — routine success is silent by design.

Two components are bespoke and worth building first, since every screen depends on their tokens:

- `<DayRuler slots={...} now={...} />`
- `<DotGrid weeks={...} today={...} />`

## Document History

- **Created:** 2026-08-10
- **v2:** accent changed from amber `#E8833A` to umber, collapsing the fill/ink token split; cards replaced by hairline-separated content on canvas.
- **v5.1 (current):** the form media becomes **photographs** (FUEL-107), and the entry below is amended one version after it was written. **v5.0 optimised the wrong property.** It admitted reference media and then required monochrome line art, reasoning that an `<img>` cannot take `currentColor` and that this app's manual theme toggle rules out a `prefers-color-scheme` block inside a file. Every clause of that is still true; it was simply the wrong thing to hold fixed. A drawing that inverts perfectly and shows almost nothing has optimised for the theme at the expense of the reader, and the reader's question is *how deep, and where does my knee go*. So legibility wins, `dark:invert` is withdrawn — inverting two-tone art is exact, inverting a photograph is a colour negative — and dark mode gets a bright rectangle on a dark ground, which is what every photograph in every dark interface does. **A movement takes two frames**, a start and a working position, stacked rather than paired side by side: at 375 a two-column pair gives each about 160px, which is narrower than the drawing it replaced *for being too small to read*, and height is the cheap axis because the sheet already scrolls. **Nothing in the database changed**, which is the part worth carrying: how many frames an asset has is a property of the ASSET, so `frames` went into the manifest and `media_key` still names one entry — a schema that had put the frame count in a column would have needed a migration to learn what a second photograph is. **§ Materials gains a provenance rule the previous entry did not need.** These assets come from a dataset declaring the Unlicense over photographs whose origin it does not document and which are plainly professional studio work; they ship as an accepted risk rather than a settled licence, and the rule taken from that is not "don't" but "say so" — a distinct licence key for a declaration rather than a licence, an author field reading *not documented upstream* rather than a plausible guess, and no rendered credit at all, because naming a creator the project cannot identify is worse than naming none. What makes an accepted risk acceptable is that it stays legible enough to reverse. **One exercise changed rather than going without**: pike push-ups became bench dips, because no pike push-up exists in the library and it would otherwise have been the single working row on its circuit with no reference. Skipping keeps none, deliberately — the nearest candidate is a plyometric bounding drill with no rope in it, and a reference showing a different movement is worse than an absent one.

- **v5.0:** form reference media is admitted, and it is the first imagery this system has ever carried (FUEL-94). **The rule that nearly stopped it was being read as something it never said.** § Materials has closed with "no photography to shoot, licence, or ship" since v3, and read as a blanket ban it forbids the ticket outright. It is qualified rather than overturned, because the distinction it was always drawing is a real one: a **mark** stands in for something the reader already knows — a bowl means a meal — so drawing it costs nothing and licensing one would be absurd. **Reference is the opposite case.** The picture IS the content, it is the reason the sheet was opened, and no mark in any register this document owns can show where an elbow goes. So the eight marks gain nothing and change nothing, and imagery is admitted **for reference only, inside a sheet, never on a canvas** — the ban stands for everything it was actually about. **The admission is narrower than "photography is allowed now", and the second reason is technical rather than editorial.** Reference media cannot be `currentColor`: an `<img>` is an opaque boundary, and this app's theme is a MANUAL toggle, so a `prefers-color-scheme` block inside a file would follow the OS and be wrong for exactly the readers who made a choice. Monochrome line art inverts exactly, so `dark:invert` over an explicit white ground is the raster restatement of what the marks get for free — and a photograph would not have that property. **§ Progressive Disclosure's sheet enumeration goes from two cases to three**, which is worth a sentence only because the bans either side of it are what force the choice: a modal, an accordion and a tab are each refused by name, so a reveal has nowhere else to go. A new question does not get a new shape; it gets this one, and it still has to be **one** question. The form sheet holds a movement, the words for it and its attribution, and does not also log the set. **Provenance becomes a rule of § Materials rather than a detail of one ticket**, because the repository is public and the failure is legal rather than visual: every asset records its author, licence, source and retrieval date beside itself, attribution renders where the licence requires it, and assets ship **byte-identical** — nothing cropped, recoloured, combined or re-encoded — which is what keeps a share-alike licence a verbatim redistribution rather than an adaptation. **Two things are recorded because they are what the work actually cost.** The licence allowlist was set at CC0/PD/CC BY and had to be widened to CC BY-SA: the permissive pool on Commons is almost entirely *contextual* photography, while the one purpose-built instructional library is share-alike throughout, so the allowlist and the usable assets did not overlap. And **every asset has to be looked at, because the filename is not the exercise** — three files were rejected that a licence check alone would have passed, `Squats` being a barbell back squat, `Lunges` a barbell lunge and `Push-up` a push-up on an exercise ball, each of them wrong for a bodyweight programme and each implying equipment the reader does not have. Coverage is five exercises of fourteen; the rest render no affordance and no gap, which is the state the schema was built around rather than a shortfall against it. **Nothing about appearance changes**: the affordance itself is transcribed from the mock v4.9 already drew — a Text button, "Show form", under the prescription in the session state — and the mock's own motif caption takes the same qualification as § Materials, so a reader meeting either one does not have to find the other.

- **v4.9:** `/training` gains a session state, and § Lists gains the two devices four P10 tickets were each about to invent (FUEL-90). **A specification rather than an implementation** — nothing in `src/` changes here, so the 56 screen baselines are the control. § P10 turns this screen from a checklist you read before and after into a surface you operate during, and it does it through four tickets that each add rows to one list: per-set entry (FUEL-91), section headings (FUEL-92), a rest timer (FUEL-93) and a form-media affordance (FUEL-94). None of them can decide the composition alone, and PRD § P3 measures the list at 375. **The live-versus-list question was settled before it was asked.** The alternative to a second state is one long list whose sets expand in place under the exercise you are working, which is an **accordion** — banned by name in § Progressive Disclosure alongside modals and tabs since long before this milestone. So the state is a consequence rather than a preference, § Progressive Disclosure now records that its ban has been spent once, and § Lists restates it geometrically, because "rows that grow when tapped" reads as a layout choice rather than as the forbidden thing. It is a **state and not a route**: `/` already carries three, § Seven screens counts states as screens, and a session behind a URL is a URL that means nothing tomorrow. Only today has one — a past date is a record, which is the refusal the training actions already make at the other end of the calendar. **Two premises of the ticket were stale in opposite directions, and the useful one is the second.** § Lists genuinely has no sub-list pattern. But it has had a **group** pattern in the app since `/shopping` shipped — `shopping-list-view.tsx` draws aisle headings in the Slash register, uppercase and tracked — and § Desktop has been legislating about them by name ever since, "grouped by aisle with no group split across a column", while this section never defined the thing being grouped. So warm-up / work / cool-down is not a new device and does not get one: it is the existing heading's second case, named here at last, and the mock now draws it in both `/training` plan frames. That is what the ticket's "one device rather than one per screen that shows a session" asks for, arrived at by finding the device rather than by designing it. **The five-row budget was never a rule and is restated as what it is, with the numbers measured rather than argued.** Grouping `/training`'s five drawn rows takes the exercise block from **281px to 597px** and the phone frame from **973px to 1290px**; the session state drawn beside it is **764px**, which is shorter than the plan state was at 973 *before* § P10 added anything to it — a screen holding more in less height, which is what says the split was the right cut rather than a way of hiding the overflow. It is the measured height between the last block above the list and the top of the sticky bar, divided by 46 — so stating it as a count made it look like something new devices could be argued into, and a group heading spends it exactly as a row does. The rule is now the height; the count is read off it; and rows may not be drawn under § Lists' 46px to buy the height back, because that figure is an accessible minimum and the window is not. **PRD § P3's criterion is re-aimed rather than met or dropped**, in both documents and along the states: the whole list is what is visible when you are planning, the active exercise when you are working. Its "where the list allows" clause is unchanged and does its own work — a warm-up, six exercises and a cool-down is eight rows and three headings, which was never going to fit under any density this guide is willing to define. **The timer is a row of the action bar**, in the slot § Feedback gives the failure banner, so the bar is a column of at most three things rather than growing a fourth button on a screen that has no room for a third row of slabs. **And it takes the first counter-case to the carry-over rule this document has had.** FUEL-72 released the action bars above 1024px on a posture — "there is no thumb, so the bar has no posture to serve" — and both halves of that sentence are claims about a *thumb target*. A running readout is not one, and one that scrolls out of sight has failed at its only job at 1920 exactly as at 375. So the session state's bar stays sticky at every width, the plan state's keeps the release untouched, and the exception is written into all five places the release is stated rather than into the one that was convenient. **That exception is what re-opens § The Scroll Edge**, which is the amendment that would have been missed: its mask has read "below 1024px" since FUEL-83 because pinning stopped at `lg`, and a pinned bar above `lg` restores an opaque edge with a page moving under it. The scope becomes the pinning rather than the breakpoint — which is what it always meant — and it matters because that fault is invisible to the unit suite, jsdom applying no stylesheet, and only appears once a list is long enough to scroll. **At ≥1272 the two states are one composition**, and that is the evidence the split belongs to the phone: the measure swaps the list for the exercise, the aside gains the rest of the session, and the current row is marked **by weight rather than colour**, which is the correction § Desktop made to `/`'s first redraw when it had three umber elements where one is allowed. **And that rule turned out to be unimplemented, which is a finding rather than a footnote.** v4.7 wrote it with an attribution — "the device `recent-sessions.tsx` already uses" — and that component marks its viewed row with a `· Viewing` suffix, `aria-current="page"` and the absence of a link, not by receding the rows behind it. Nothing in `src/` recedes a list's other rows. The attribution is withdrawn where it was stated, the rule stands, and the session aside is its first case rather than its second. Nothing about the header, the rail, the 584 or the 356 moves between the states; a state that had needed a fourth zone would have been the signal it was the wrong answer. **The mock goes from seven screens to eight**, at both widths, on v4.0's own reasoning for retiring the "silence above 375px" override: a mock that drew only the plan state would later be read as forbidding the second one, exactly as a mock with no second column was once read as forbidding a column. One drive-by is recorded rather than slipped in — the phone training frame's tagline read `P3 · /` and was a copy-paste from the frame above it; the route is `/training`. **What was decided against** is listed on the ruling itself and is the half of this entry the four blocked tickets most need: a tighter set row (§ Lists' 46px is the accessible minimum, so the density would have come out of the wrong number), a third graphic device for sets (§ The Four Rules gives this system two, at two time-scales), a separate route, the timer in the header band (the paginator already answers that zone's question), and the timer in the aside at 1272 (it would be the one element on this screen that changed column between two states, which § Desktop refused once already for `/training`'s Anytime row).
- **v4.8:** the tablet band is claimed, and capped (FUEL-79). § Desktop has named 768–1023 since v3.8 and given it a ruling — "the phone's navigation and the desktop's content shapes" — which the app had never implemented: every release FUEL-85 wrote was bound to `xl`, so the band drew the phone's shapes in a 584px column with the window's spare width as margin, 118px a side at 820. **The ticket's own framing was stale in two ways and both are recorded.** It says "every `md:` in the app today is a gutter change"; `md:` has carried the seven-column week, the split macro grid and the wide ruler since before the milestone, and FUEL-77 added bounded `md:max-xl:` rules on top. And it asks FUEL-66 for the sidebar-or-pill decision, which § Desktop had already made. **The fault that mattered was one nobody had looked for.** Not the margin but the boundary: `/plan` measured 967px at 1023 and 776px at 1024, so widening the window by a pixel cost 191px of table — the regression FUEL-79's fourth criterion names and asserts "must still be gone", live for three tickets, between two baselines that both looked right. It is why the band gets a **ceiling** rather than the width it has, argued in § Desktop above. **`/plan`'s prose had never been bounded at all** — 723px at 767, 967 at 1023 and 968 at 1272, the longest line of type in the app, at the width the mock is drawn at — so `PAGE_PROSE` moves from `xl` to `md`, which changes nothing on the two screens already wearing it. **And the assertion that was missing is the one added:** `monotonic.spec.ts` sweeps seventeen widths on every route, because every other spec in that directory asks its question at a width someone chose, and this fault lived at a width nobody had.
- **v4.7:** § Desktop asked a width question where the PRD had already answered a purpose question (FUEL-85). **Three rules are amended, one is added, and the mock's D1, D4 and D5 are redrawn.** This is the section correcting itself rather than a ticket correcting an implementation: FUEL-77 built what was written, and what was written permitted exactly one desktop move — take the phone's column and put a second phone column beside it. **The evidence is the rendered heights**, which say it in one line: `/shopping` is **3,331px** tall at 1272, `/plan/template` 2,776, `/weight` 1,779, `/settings` 1,484 — and `/plan`, the one screen that already spans the frame, is **1,043**, the second shortest in the app. On `/` at 1920×1080 there were 410px of empty column below the last control, ~300px between a macro label and the next value, a 584×52px primary, three items in a 356×900 aside, and none of the day's log on screen although the client already held it. **What the section never asked is what the PRD answers in a sentence.** § Target Users names three contexts of use — "Phone, in the kitchen, hands busy — this is the dominant case… **Desktop, Sunday evening, reviewing the week and generating the export**" — and the sub-three-second "what now?" threshold is measured, in the PRD's own success table, "on the phone, 5 trials". The desktop was given the kitchen's question in a bigger box. There is also a second desktop reader this section never mentions and who lands on `/` first: the **portfolio visitor**, 60–120 seconds, judging "whether it feels like a real product", for whom "empty states make a project look unfinished". **The 640 binds prose, and only prose.** That is the first amendment and the one the others follow from: the measure was set against § Typography's 17px body and what it protects is a line of running text, so a folio, a figure, a time axis, a trend line and a table may take the frame while a paragraph may not. `/plan`'s grid stops being an exception and becomes the first case of the general rule. **The density rule stands; the sentence that generalised it is withdrawn.** Three columns for three short values, two otherwise, decided by content — unchanged. What went with it is "extra width becomes a second column beside the measure, never more columns inside it", which was a second statement of the width rule reaching further than the question it belonged to. The four-macro grid, which the density rule names out of scope, is now **four-across on a measure and 2×2 in an aside**: at 584 the 2×2 leaves ~300px between a label and the next value, and at 356 it is the density the phone already proves. **"Nothing else gets denser" was answering two questions and only one of them was density.** No row gets tighter — 54px is 54px at 1920 — but the rule was also silently forbidding a list from taking more than one column, which is why fifty-six shopping items in five named groups are stacked in a 584px column. A list of grouped items may now flow into columns at ≥1272, with a group never split across one. **One rule is added: one job per zone.** The header says where you are — a Micro folio line and the screen's own time graphic, whose hairline closes the band; the measure says what the subject is; the aside says what the context is. With it come three things it is easy to get wrong and that this version got wrong first: **nothing new goes in the box** — the first draft of `/`'s header put four progress meters across the top, and a meter is not in this system; **say a thing once** — that draft stated one figure three ways and put a count in the folio that the ruler beneath already drew in ticks; and **§ The Four Rules is not amended** — that draft had three umber elements where one is allowed, so a current row in a list is now marked by weight rather than colour, which is the device `recent-sessions.tsx` already uses. **§ Buttons gains a width rule** for page action bars only: a control is its content plus air, because a full-measure button is a thumb target on a screen with no thumb, and a row is what lets Undo be a fourth item rather than a third row. The sheet is excluded by name — a sheet *is* the measure. **The three the mock never drew get a job each** instead of "the measure with more air": `/shopping` and `/plan/template` flow their groups into columns with the prose header staying on the measure, and `/settings` splits the form you fill in from the five links you follow. A section index beside a panel was considered and rejected — six short groups do not need navigation to reach. **In the mock, three frames change and four do not.** D1 takes the folio, the full-width ruler, the four-across grid, the content-width actions and an aside holding the day; D4 takes the header rule and the buttons and is otherwise left alone, because its columns were already full — which is why it read better than `/` before any of this, and **a redesign that churns a working screen to look busy is the same mistake in the other direction**; D5 gives the chart the frame, at 300px tall rather than 220 because widening a plot without heightening it flattens what it draws — 1024×220 is 4.65:1 against the old box's 3.27, a weight chart understating its own slope. D5's aside also loses a six-week weigh-in dot grid it had drawn since FUEL-67: the app has never had one, § The Four Rules gives the dot grid to adherence, and a signature graphic drawn in this file is an obligation on whoever builds the screen. **Two divergences are recorded rather than fixed.** The app draws the weight chart on a `surface` plate and the mock does not; and the mock draws its frames with no page gutter, so its content runs to the frame's edge where the app's is inset 28px — both predate this version, both belong to whoever reconciles them, and both are written down so the next person meets a decision rather than a surprise. Nothing about the phone changes: every 375px frame is untouched, and the byte-identical 375 and 820 baselines are what will say so.
- **v4.6:** `/` and `/training` are recomposed from the mock's frames (FUEL-77). **No rule changes** — § Desktop drew both compositions in a sentence each and this is the transcription — but **four things are recorded rather than waved through**, because each is a place the section and the app had drifted or had never met. **The breakpoint this section asked for did not exist.** § Desktop has specified `xl` as 1272 since v3.8 and named FUEL-67 as the ticket to declare it; FUEL-67 drew the frames instead, and `--breakpoint-xl` was never written. Nothing broke, because nothing in `src/` had used an `xl:` utility — which is exactly why nobody noticed, and why the first one written would have been Tailwind's 1280 default: the aside would have been absent at 1272, the width the mock is drawn at and the width the baselines photograph. It is declared now, and the emitted media query is read back by a test rather than the declaration being trusted, since a deleted breakpoint is not a missing utility but the same utility eight pixels late. **And declaring it cost something nobody had priced**, which is the paragraph added to § The breakpoints above: Tailwind emits a redefined breakpoint's rules *ahead* of the ones it did not, so `md:` and `lg:` outrank `xl:` on the same element and the same property. This ticket wrote `hidden md:block xl:hidden` for the day ruler's middle copy, shipped **two rulers and two umber NOW markers** into a 1272 baseline, and found it by looking at the picture — the unit suite cannot see it, jsdom applying no stylesheet, and every geometric assertion about the columns passed while it was true. The fix is to bind a variant to its band (`md:max-xl:`) rather than to override a smaller one, the ordering is now pinned by a test, and `page-columns.spec.ts` counts the *drawn* copies at five widths, which is the assertion that was missing rather than the one that failed. **The composition arrives at 1272 and not at 1024, and the ticket asked for 1024.** The breakpoint table settles it — `xl`'s job is "the frame caps and centres. The aside appears" — and the arithmetic agrees: below the cap the frame is fluid and its third track is what is left, which at 1024 is **108px**. That is not a column. So 1024–1271 stays one column with the rail beside it and the bars already released, which is what this section means by "a composition of two drawn widths rather than a third drawing". The ticket's first criterion is amended on the ticket rather than met. **The reading column is 584, and the aside is what is left of the pair.** These screens span the measure and the aside together and pay `main`'s 28px twice across the pair rather than twice inside the measure, so the reading column is the 640 track less its own gutters — the width a sentence has occupied on every screen since FUEL-70 — and 1024 − 56 − 28 − 584 leaves the aside **356**, the frame's third track exactly, still declared by nobody. Taking the full 640 here was the alternative and was rejected on this section's own words: the measure would have been 56px wider at 1272 than at 1271 and nowhere else, and "every screen puts its measure at the same x whether or not it has an aside". `--frame-measure-inset` derives it beside the frame's other numbers. **The action bar follows the mock rather than FUEL-72's `mt-auto`.** v4.2 put the released bar at the foot of a viewport-tall `<main>` and defended it; the mock draws it 30px under the last figure, and § Desktop says "the primary action sits at the end of its column", which the mock reads as the end of the content. At 1272 the mock wins and `mt-auto` goes inert of its own accord — the grid packs its rows to the top, so the bar's area is its own height and there is no free space for an auto margin to take. That is the same shape as v4.2's own note about `bottom-[…]` going inert under `lg:static`, and it is recorded on FUEL-72 as a change to what that ticket shipped. Below 1272, `mt-auto` and `flex-1` are untouched and still doing the work v4.2 describes. **One DOM at every width, which is the mechanism and not a detail.** The two columns are groups that are `display: contents` below the cap, so the phone's column is the sections in the order they were already written: nothing is reordered, and no screen reader meets a section where a sighted reader does not. `/training` needed no resequencing at all — its sections were already the session then the pattern — which is the evidence that the division is this section's rather than the ticket's. The day ruler takes a **third** copy under FUEL-82's device, and loses its 8px of head at the cap because that clearance is from the block above it and in the aside there is nothing above it. **Two sections the mock does not draw are ruled here.** `/`'s **Up next** goes to the aside, because it answers the ruler's question rather than the card's, and `/training`'s **Anytime** goes to the aside, because it is the same row `/` renders and a row that changed column depending on which screen you reached it from would be two rows. **Three things beside the composition, each a defect the frames exposed.** `/` carried **two links to `/settings`** above 1024 — its own foot link and the rail's — which made it the only screen in the app with a duplicate destination; the mock draws one, and the foot link now stands down at `lg`. Day-complete's **crop marks were the window's**: `flex-1` makes the marked box the page, which is true on a phone where the viewport *is* the page and false at 1920×1080, where the bottom pair sat ~480px below the summary they close and moved whenever the reader dragged a corner. And the **`/` skeleton had been drawing one layout since FUEL-82 split the screen into two** — the ruler above the figures where the phone puts it below, one macro grid where the phone has a three-line merged one and the desktop has two named ones, and 22px of head where FUEL-82 took the screen to 12. Every one of those is a shift on swap-in, which is the single property a skeleton has over a spinner; it now takes the same variants from the same constants, and `loading.test.tsx` holds the two together. **The third criterion was a verification and is recorded as one.** The ticket asks for the column count § Desktop specifies, changed once in `kv-grid.tsx`/`macro-grid.tsx`. Nothing changed: every grid on these two screens is the four-macro grid, which the density rule puts out of scope by name, and the chasm the ticket describes at 584px is closed by the aside taking 356px away rather than by a third column. The rule is content-keyed and not a width rule, so the assertion added is that no breakpoint variant is attached to the count at all. **What the mock is still not, said once:** it draws `.dmain` at the full 640 because it draws no page padding anywhere, on any screen. The app insets by 28 at both ends of the pair, which is this section's own resolution from FUEL-71 — "`/plan`'s heading, week nav and totals keep the inset and stay on the measure's x with the notice bands above them" — and applies to all seven screens rather than to these two, so the mock is left as drawn.
- **v4.5:** the chart's type scale stops inflating with the column (FUEL-76). § Data Display gains **one rule and one correction**, and the rule is the general one: **a chart's geometry scales with its column and its type, ink and marks do not.** The chart draws into a fixed 320-unit box that stretches to whatever column it is given, which is right on a phone — the column *is* 320-ish units — and wrong everywhere else: at 584px the factor is 1.825, so the 10.5px Micro labels painted at **19.2px**, larger than Body, on a screen whose § Typography opens with "the ratio is the rule: 76 ÷ 10.5 ≈ 7.2×". The 2px trend painted at 3.65px, the 4px mark at 7.3px with a 3.65px ring, and every widening in this milestone made it more visible. It is now **two layers**: the scaled box keeps the plate, the rules and the trend, because those shapes are the data; an unscaled box stacked on it takes the words and the mark, positioned in percentages so the two agree at every width without either being measured. Every figure in § Data Display's table is now a rendered pixel at 375, at 1280 and at 1920. **Two of the ticket's claims were wrong and are recorded as wrong.** The hairlines were already right — `vector-effect="non-scaling-stroke"` had been on the gridlines and both references since FUEL-35, which also holds their `3 3` dash to three real pixels — so that criterion was met before the work started. And § Materials' *other* hairline clause, 0.5px at `min-resolution: 2dppx`, is implemented **nowhere in the app**; fixing it inside the chart alone would have made it the one hairline in the app that behaved differently, so it is left for a ticket of its own. **The draw-in changed mechanism, and under protest.** `pathLength="1"` was the better device — the dash was the line's own normalised length, so it covered the trend exactly and nothing measured a path — but it cannot coexist with the 2px: under `non-scaling-stroke` a browser normalises the dash in *user* units and paints it as that many CSS pixels, so at 584px the "full-length" dash covered **55%** of the line and left the trend permanently half-drawn. Measured in Chromium and Firefox both, and a percentage dash array fails identically. A `clip-path` wipe needs no length at all, so it keeps everything the dash was chosen for — no measurement, no client JavaScript, no `useEffect` after paint — and for points in date order it reveals the line in the direction time runs. The ticket's fifth criterion named `pathLength` by name and is **amended rather than met**, which is recorded on it. **One number was raised rather than converted.** The threshold that flips a reference label below its rule was 12 units and is 17: the label used to shrink with the box and now does not, so the narrowest column the app supports decides it — 320px of viewport leaves a 276px column, which is 0.8625 of the box, and 14.5px of ascender and lift is 16.8 units of that. Above 320px the flip is merely early, which costs nothing. **Measured rather than eyeballed, and the measurements are kept.** `tests/visual/chart-scale.spec.ts` reads the rendered pixels on `/weight` at all four suite widths — the Micro labels at 10.5px *and* at one width to the tenth of a pixel, the trend's ink by hit-testing it, the mark's box, and the plot's own scale factor as the control that the chart still fills its column. The font-size assertion alone would not have caught this: `getComputedStyle` reports the declaration, 10.5px, while the glyphs paint at 19.2 — which was confirmed by planting the old markup and watching the width assertion fail where the font-size one passed. `/dev/weight-chart` gains the same chart at four column widths, because a specimen boxed at 331px could not show a desktop fault and that is why one shipped.
- **v4.4:** the pointer states are applied (FUEL-75). v4.0 wrote them and FUEL-67 drew them, so this is a sweep rather than a decision, and **one rule is added**: the lift, in § Desktop above — `text-secondary` measures 4.26:1 on the ground the first row adds, against a 4.5 requirement, and the mock draws that shortfall rather than avoiding it. Everything else was already settled and is merely obeyed. **The cursor was the larger fault and nobody had noticed it.** § Desktop predicted it — Tailwind v3's preflight gave `<button>` a pointer and v4's does not — and the app had exactly one `cursor-pointer` in `src/`, on a `<label>`, so every button in the app had been drawing an arrow since the v4 upgrade. It is invisible to a keyboard and invisible to a screenshot, which is why it survived: it is now asserted on the component, and a scan refuses any file that writes the class itself. **`@media (hover: hover)` turned out to be free**, which is worth recording because the section argues for it at length and nothing in the app states it: Tailwind v4 wraps every `hover:` and `group-hover:` utility in that query by default. The requirement is met by writing ordinary classes, and the assertion that it stays met is a test that compiles one and reads the emitted CSS — v3 did not do this, so a version move backwards would unstick every state silently. **Four things the ticket asked for were changed on the way.** `hover:bg-destructive/10` is gone and the unfilled Destructive hovers to `surface`, which is the one divergence v4.0 named. Links take the mock's colour change rather than the table's ground, because the two disagree, § Document History makes the mock authoritative for appearance, and it is also the reading that holds § Accessibility — every link in this app rests in `text-secondary`. **The swapped week cell diverges from the mock deliberately**: there the hover selector outranks `td.sw` and the tint is lost, which the mock can afford because it also draws those cells in `accent` text and this app marks them with the ground alone — so a swapped cell keeps `accent-subtle` and takes the third row's inset rule, the device that exists for a control whose ground cannot answer. And the ticket's request for a hover on **exercise rows is withdrawn rather than built**: they are static `<li>`s with no handler, and § Desktop's "what takes no hover" forbids a state that "would promise an action that does not exist". **The focus ring came along, and had to.** Roughly a dozen links had neither state — `up-link.tsx` had recorded the gap by name — and § Desktop refuses to let one arrive without the other: "a control drawn with only the hover leaves the keyboard with nothing." **The 56 screen baselines came back byte-identical**, which is the control the whole change rests on: nothing here alters a rest state, so a single moved pixel there would have meant something was applied that should not have been. Twenty-eight new baselines photograph one control per class hovered: fourteen controls in each theme, the Destructive button among them twice because § Buttons gives it two rest states and each takes a different row of the table. Both themes, because a hover is a colour and `surface` sits above the canvas in light and below it in dark; one width, because these are the one thing in § Desktop that no breakpoint decides.
- **v4.3:** the sheet stands in the measure's column (FUEL-73). **No rule changes: v4.0 had already decided this, and the entry below says so** — "the sheet-versus-dialog ruling FUEL-73 needs: a sheet stays a sheet at the measure's column". The ticket was written two days before that ruling and asks for the opposite of it — a centred dialog at ≥1024, radius on all four corners, no grabber, and `--shadow-sheet` re-aimed as a guide-level edit. § Document History makes this document authoritative for appearance and v4.0 names FUEL-73 as the ticket the ruling was written for, so three of the ticket's acceptance criteria are **withdrawn rather than built**, and the fourth was the only real fault. **One clause is corrected here and it is the only text that changes: § Sheets said a sheet stays a sheet "above 1272px"** where the column it names in the same sentence begins at 1024px, which is where the rail arrives and the frame becomes a grid — a sheet is in that column for the whole of the 1024–1271 band, so the number is now 1024 and agrees with § Desktop, which names no width at all. **What was wrong in the app was the x, and only the x.** `mx-auto` inside a `fixed inset-x-0` box centres on the *viewport*; the measure is the frame's second column, whose centre is a fixed 68px left of the window's once the frame has capped — 248 + 320 − 636 — and drifts by a different amount at every width below that. So the swap opened from a control at one x and arrived at another, which is the same fault as v3.8's 124px offset in a shape nobody had measured. **The portal wears the frame rather than restating it.** A positioning layer, `FRAME` inside it, and the sheet in `FRAME_MEASURE`'s column: `lib/frame.ts` gains a fourth reader and the sheet lands on the measure by construction. The alternative was arithmetic — `left: calc(max(0px, (100vw - 1272px) / 2) + 248px)` is the same number — and it was rejected twice over: it would be a fourth statement of a grid `globals.css` declares once precisely so that "two independent centrings can disagree, two readers of one template cannot", and `100vw` counts a scrollbar that the frame's own `mx-auto` does not. **The scroll lock is the part that had to be found rather than reasoned about.** Radix hides the body's overflow and pads it by the scrollbar's width, so `<main>` keeps its centre — but a `fixed` box is laid out against the window, and the window is the one thing that got *wider*, so the layer takes `--removed-body-scroll-bar-size` back off itself. Without it the sheet would sit ~7.5px right of its column, but only while it was open, which is the only time anyone could look. **Nothing else about the sheet changes**: the grabber stays drawn at every width (§ Desktop: "a hybrid laptop still has the thumb"), the radius stays on the top two corners, `--shadow-sheet` still aims upward because the panel still rises from the bottom edge, and § Materials keeps its one shadow. Below `lg` the classes compose to exactly what was there, so the 375px and 820px baselines are the control. § Desktop's two pointer closes were already Radix's and are now held by tests rather than assumed. **Two things are recorded rather than waved through.** The ticket scoped "two callers" of the sheet primitive; there is **one** — `swap-sheet.tsx` composes `meal-picker.tsx` and never touches it — so the production change is a single file. And the `<body>` focus fallback has a test that **cannot fail**: removing the `isConnected` guard leaves it green, because focusing a detached node and not focusing at all both end on `<body>`. That was found by planting the mutation rather than by reading the code, it is written into the test as what it is, and the guard stands as a statement of intent rather than as a line anything depends on — the honest version of the v4.2 entry's assertion that was passing on the class whose job was to unpin the bar. **Two things were measured rather than eyeballed.** The scrim is the guide's `rgb(28 25 23 / 0.34)` to the byte — a white pixel behind it reads `(178, 177, 176)` in the 1272 light baseline, which is `0.66 × 255 + 0.34 × (28, 25, 23)` exactly — so § Materials' dimming is now held by sixteen zero-tolerance PNGs rather than by a geometry assertion that a fully transparent scrim would also have passed. And the sheet takes the page out of the accessibility tree while it is up, which was found by a test failing for the right reason: `getByRole("main")` times out with the sheet open, because `aria-modal` is only as good as what it hides. Worth recording precisely, since the obvious assertion is wrong — `<main>` does **not** carry `aria-hidden`; the attribute lands on an ancestor at the top of the body, so the landmark is present in the DOM, absent from the tree, and back when the sheet closes.
- **v4.2:** the action bars stop floating over the page above 1024px (FUEL-72). No rule changes here — v3.8 decided this and v3.7 deferred to it, and both left the same sentence open: "FUEL-72 may remove the pinning that creates the edge at all". It did, and this entry closes the may. **What was there was not a partial fix but the wrong half of one.** `APP_ACTION_BAR` said `lg:bottom-0`, which releases the *shell's* offset — real below `lg`, which is what `--nav-shell-h` exists for — while leaving the bar pinned to the viewport. So at 1440×900 on `/training` three buttons, one of them 584px wide, held the bottom ~130px of the screen in opaque `bg-background` and cut the Recent list mid-row for as long as the reader stayed on the page. The replacement is `lg:static`: the pinning itself is released and the `bottom-[…]` inset goes inert with it, an inset having no effect on a static box, so the desktop behaviour is one utility rather than a position and an offset that have to agree. **`mt-auto` is untouched, and that is the load-bearing half.** It is unscoped and does separate work at every width — it puts the bar at the foot of `<main>` when the content does not reach it — so `flex-1` is now what stops a 1920px screen stranding the bar mid-screen with a gap beneath, which is the phone's old failure with no thumb left to explain it. Released and untethered are different bugs with the same look, and the second is the one this change could plausibly have introduced. § The Scroll Edge needs no amendment: FUEL-83 scoped the mask below `lg` in anticipation of exactly this, so a bar with nothing passing under it has no edge to soften and there was nothing to undo. **One production line changed**, because FUEL-83 had already made the four bars one string — the `/` skeleton took the release by taking the string, which is the property it exists to have, and the `/dev/nav-shell` specimen kept the phone's arrangement by continuing not to take it. The 44×44 minimum carries and the primary is the same 52px at every width; it is only the posture that was a phone's. Two things are recorded rather than waved through. A unit assertion labelled "pinned to the bottom" had been reading `toContain("bottom-0")` since before FUEL-65 moved the offset off zero, so the only match left in the string was `lg:bottom-0` — **the line checking that the bar was pinned was passing on the class whose job was to unpin it**, and would have gone on passing with the phone's offset deleted. And the desktop half had no test at all that a class string could not satisfy, jsdom applying no stylesheet; `tests/visual/action-bar.spec.ts` now measures the real thing across the breakpoint — `static` at 1024 and `sticky` at 1023, the Recent list clearing the bar at 1440, the shell still cleared at 375, and the bar at the foot of a 1600px-tall viewport rather than in the middle of it. Nothing below 1024px changes: the 375px and 820px baselines came back byte-identical, which is the control.
- **v4.1:** the week grid fits (FUEL-71). It had scrolled sideways at every desktop width it was ever drawn at, 1920 included, and crossing 1024px cost 1.87 days of the week — the milestone's sharpest symptom, and three faults that each looked like someone else's. The columns were declared on an **auto** table, where a width is a floor the longest meal name grows past, so 86 + 7 × 132 measured 1023.3px. The **28px screen gutter was spent twice**, once as the frame's own between columns and once as `main`'s padding inside the same column, leaving 968px for that 1023.3 — which is the ~55px of overflow no viewport width could remove, and the reason § Desktop's "1272 is a sum" was arithmetic the app never performed. And the columns were fixed, so when the rail arrived at `lg` and took 248px the week could give nothing back. § The Week, Two Ways had recorded the resulting scroll as "by design"; it was not a design, it was three faults agreeing, and that row now reads **None** in both shapes. The rule replacing it: **the day column is a consequence, not a constant** — a fixed-layout table with a `<colgroup>`, a slot column that states its width, seven day columns that state nothing and divide what is left. § Spacing's 1024 becomes a ceiling the grid reaches rather than a width it insists on, and the grid alone bleeds back through `main`'s gutter at ≥1024px, the same full-bleed device the phone already used one scale down — everything else on `/plan` keeps the inset and stays on the measure's x with the notice bands, which is what § Desktop requires. **Two numbers changed and the change is the point.** The slot column is **100px**, not the 86 FUEL-67 drew: a fixed table grows nothing, "Breakfast" needs 99.3px at the app's Micro against 71px at the mock's smaller one, and at 86 it spilled over the hairline into Monday — so the mock has been redrawn from the app's type scale rather than the app built to the drawing's. The day column comes out at **132px**, which is where it started; `w-[132px]` was never the fault. The mock now derives that 132 instead of stating it, so the specimen demonstrates the mechanism rather than the result. The right-edge scroll fade is removed, a cue for a scroll that can no longer happen being the same lie pointing the other way. § Accessibility's blanket Dynamic Type exception for the grid is **withdrawn** and replaced by a measured one: nothing scrolls sideways from 320 to 1920, and only *text-only* 200% still overflows — 13px at 768, 6px at 820, none at 1024 and above. The labels carry `break-words` for that: a fixed table cannot grow a column to its content, so "Breakfast" wraps inside its 100px rather than forcing the table wide (27px and 18px without it), and the same rule guards a meal name whose longest token already clears the narrowest column by only 2.8px. Breaking a word is not truncating it. Measured throughout rather than computed, every number in this ticket that was computed having been wrong at least once. Nothing below 768px changes: the 375px baselines came back byte-identical, which is the control.
- **v4.0:** the desktop specification is finished. `BRAND_GUIDE.html` draws the seven screens at 1272px (FUEL-67) and § Desktop gains the rules that are not width rules and so had no home in the grid FUEL-66 decided (FUEL-68). **The mock is now the source of truth for appearance at two widths rather than one** — captioned "True 375px" and "True 1272px" — and the fourth named override, its silence above 375px, is retired as spent; the other three stand, because each overrides something the mock draws. § Desktop gains **pointer states**, which this document has never carried: `hover` and `cursor` appeared nowhere in it, which is why the app arrived at eight `hover:` declarations across five files a component at a time and why the rail — the first control a pointer is the only way to use — answered a mouse with nothing. The rule is two grounds and one ring, chosen by what a control already rests as rather than by what it is: nothing, an outline or a ghost gains `surface`; a solid fill goes to that fill at 90% over the canvas, which is what lets one rule cover a Destructive button in both of the rest states § Buttons gives it; a `surface` fill takes a 1.5px inset rule in `text-3`, because the first case cannot apply twice and a surface hovering to surface does not answer. Triggered by `@media (hover: hover)` rather than a breakpoint, because a hybrid laptop is both and a phone brought in on width would leave the state stuck after a tap. Specified for every control class in § Component Patterns and for the rail; selection outranks hover and the ring is never `accent`, since a hover that borrowed the umber would say *chosen* of whatever the pointer crossed. The focus ring is untouched and the two are never folded together — a pointer user gets one and a keyboard user the other. The inset ring is recorded as an exception to § Deliberately Absent's ban on elevation, on § The Scroll Edge's precedent and qualified in all three places that state the flat rule: it is a hairline painted where a second `border` would go, casting nothing, and the sheet keeps the only drop shadow. § Desktop also gains a **density** rule — three columns when there are exactly three values each holding one line in 110px, a property of the figures rather than of the screen, so the count does not change with width — and the **sheet-versus-dialog** ruling FUEL-73 needs: a sheet stays a sheet at the measure's column, because "no modals" names no width and so travels, and because the swap's cost and its choice may not be put on opposite sides of a gutter. The pointer's two closes, a clickable backdrop and `Escape`, are added at every width. Two divergences from the app are recorded rather than ratified, and they are what the implementing tickets change rather than keep. `button.tsx` hovers an unfilled Destructive to `hover:bg-destructive/10` where the rule and the mock both say `surface`. And **no control in the app sets `cursor: pointer`** — there is one `cursor-pointer` in `src/`, on a `<label>` in `shopping-list-view.tsx` — because Tailwind v3's preflight supplied it for `<button>` and **v4's does not**, so every button in the app currently draws an arrow. That is a silent regression from the v4 upgrade rather than a decision, and it is why the rule is stated flatly instead of left to the user agent. Nothing about the frame, the breakpoints, the 640px measure or any screen's composition changes; v3.8 decided those and this adds only what it did not reach.
- **v3.8:** § Desktop added (FUEL-66) — the decision the Desktop Version milestone is built on, and the first time this document specifies a width above 1024px. Driven by measurement: at 1920×1080 the sidebar ended at x 220 and the content column began at x 764, a **544px void**, while the demo banner and the walk reminder sat **124px** off the content's centre because the root layout centres them on the viewport and `<main>` centres itself on what the sidebar leaves. Two symptoms, one fault — nothing was on a shared grid — so they are fixed together by a single centred frame of **1272px** (the 220px rail, a 28px gutter, and the 1024px § Spacing already fixes for the week grid) whose columns are declared as custom properties both layouts read. Four breakpoints are named and given jobs, including the 768–1023 band that had none; **640px survives unchanged as the reading measure**, with screens gaining columns beside it rather than a wider column; each of the mock's seven screens gets its desktop composition in a sentence, as do the three routes the mock never drew; and a carry-over rule is stated — a mobile decision carries unless its written rationale names the phone — whose first application unsticks the action bars above 1024px, which is the removal § The Scroll Edge left to FUEL-72. § Spacing & Layout's max-content-width line now defers to § Desktop rather than restating a rule it no longer owns. The cost is named: the sidebar stops being flush with the screen edge. `BRAND_GUIDE.html` is unchanged — FUEL-67 draws the frames — and its silence above 375px is recorded as the fourth named override, so that a mock with no second column is not later read as a mock that forbids one. It remains the source of truth for appearance at 375px, which is every rule in it except the one width it was drawn at.
- **v3.7:** § Materials gains The Scroll Edge (FUEL-83) and, with it, the single exception to "no gradients" the guide has ever carried. The sticky action bars on `/` and `/training` are opaque, and at 375×667 the resulting hard edge cut the first exercise's prescription through the x-height — half of every letter drawn and half not, which reads as a rendering fault rather than as content continuing below. Below 1024px the top 24px of the bar is now masked so the line runs out instead. Recorded as an exception rather than waved through because the flat rule is stated three times in this document and twice in the mock: what it bans is a ramp painted as a material, and a mask paints nothing — the bar's flat fill is untouched and the stencil only decides where it stops covering. The alternatives are named in the section and both were rejected on the guide's own terms: a shadow would be the system's second, and a rule states a boundary where the screen needs to state continuation. No change to any bar's position, height or `--nav-shell-h` offset, and none above 1024px, where FUEL-72 may remove the pinning that creates the edge at all.
- **v3.6:** § The Day's Numbers on a Phone added (FUEL-82): below 768px `/` merges `This meal` and `Today` into one grid, the meal's figure as the value and the day's on the slash line, and the day ruler follows the figures rather than preceding them. Driven by measurement — 313px of the 667 at 375×667 is chrome, and the two grids wanted the whole 354px that left. All four macros survive against target with a signed delta, so PRD § P4 still holds on a phone; the mock's own two-figure summary would have satisfied it nowhere. § Touch Targets gains the sentence its 44×44 minimum always implied — the rule is about the area, not the mark — which is what lets the demo banner close from 57px to 47. The 375px Right Now frame in `BRAND_GUIDE.html` is redrawn to the merged shape and now carries the two notice bands it had always omitted; that omission is why four bands were never summed. Above 768px the two named sections are unchanged, and the mock remains the source of truth for everything else.
- **v3.5:** § Navigation pins the mobile pill to the bottom of the viewport (FUEL-65), overriding the mock's `.tabbar { margin-top: auto }` — the third override this section records against the HTML mock, after the fourth destination and the day-complete tab bar. Driven by measurement rather than taste: the shell sat at the end of the document, 3636px down on `/weight`. The action bars on `/` and `/training` now clear it by `--nav-shell-h`. Appearance of the pill itself is unchanged, and the desktop sidebar is untouched; the mock remains the source of truth for everything else.
- **v3.4:** § Navigation gains the naming rule its route table implied but never stated (FUEL-60): the Destination column is the name, every link that names a destination uses it, and the `<h1>` is a heading that must map to that name rather than a second name for it. Two carve-outs are named — a link inside a sentence and a link whose name is an action — and the labels corrected under the rule are listed. No visual change; the HTML mock is unchanged and remains the source of truth for everything else.
- **v3.3:** § Navigation names the four top-level destinations (FUEL-56) and gains a route table giving every authenticated route one level and one parent. Settings gives up its slot for a link at the foot of `/`; `/shopping` and `/plan/template` are both placed under `/plan`. The reading of the PRD's "no navigation" criterion moves to the PRD, where § Navigation now points instead of arguing, and day-complete's absent tab bar is re-sourced to the mock caption that actually requires it. A section that had specified a shell without naming its contents; the HTML mock predates the shell entirely and remains the source of truth for everything else.
- **v3.2:** § Data Display added for the weight trend chart (FUEL-35), and `surface` gains its second permitted use — the chart's plot area — in § Color Palette. Both are additions the HTML mock predates; it remains the source of truth for everything else.
- **v3.1:** the dot grid gains a Partial dot (FUEL-27) and its unrecorded day is named as such rather than as "no session". An addition to § The Dot Grid only; the HTML mock is unchanged and remains the source of truth for everything else.
- **v3:** display scale raised to 76px for a 7× ratio against 10.5px micro labels; accent restricted to meaning "now" only, with actions moving to ink; day ruler and dot grid introduced as signature graphics; flat line motifs, hatching, crop marks and slash metadata added as the material language. Flat discipline retained — no gradients, no textures, no shadows outside sheets.
