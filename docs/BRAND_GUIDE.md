# Fuel & Form — Brand & UX Guide

> Companion to `docs/PRD.md`. Where the PRD defines *what* is built, this defines *how it looks, moves, and speaks*.

**Visual reference:** [`docs/BRAND_GUIDE.html`](./BRAND_GUIDE.html) — seven annotated screens at true 375px, the day ruler and dot grid, live type specimen and swatches. Self-contained; open it directly in a browser. Also published at <https://claude.ai/code/artifact/71ccc216-6aae-4bd1-b528-bad1ff5786d5> (private to the repo owner).

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
- **Key/value grid:** two columns, 22px row gap, 16px column gap. Three columns for compact stats.
- **Radius:** `sm` 6px (tags) · `md` 12px (buttons) · `lg` 14px (tiles) · `xl` 26px (sheets) · `full` 999px (tab pill, NOW pill).
- **Hairlines:** 1px `border`, dropping to 0.5px at `min-resolution: 2dppx`.
- **Max content width:** 640px — the reading measure, at every width. 1024px for the week grid at ≥768px. Above 1024px the measure sits in a centred frame beside the navigation rail rather than being centred on what is left of the screen; § Desktop owns that grid and this line defers to it.
- **Elevation:** none, except sheets — `0 -8px 34px rgba(0,0,0,0.12)`.

### The Week, Two Ways

`/plan` draws the same week in two shapes, and which one you get is a width, not a preference.

| | **< 768px** | **≥ 768px** |
|---|---|---|
| Shape | Seven day sections, stacked | Seven day columns × five slot rows |
| Long axis | Vertical | Horizontal |
| Sideways scroll | None | Yes, to 1024px — by design. None at ≥1272px, where the frame is wide enough to hold all 1024 (§ Desktop) |
| Meal name | Full width, wraps, never clipped | Column width, wraps |

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

**The 44×44 minimum holds at every width; the bottom third does not.** The area a pointer must hit names no posture, but thumb reach is a one-handed phone posture named in the rule itself, so above 1024px the primary action sits at the end of its column and the action bars are not sticky. § Desktop carries the rule that decides this, and the reasoning belongs there rather than here.

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

**1272 is a sum rather than a round number:** the rail, a gutter, and the 1024px § Spacing already fixes as the week grid's maximum. The measure and the aside together come to exactly that 1024 — so `/plan`'s grid spans them both and, at this width and above, stops scrolling sideways for the first time.

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

Two are in use and neither is declared; both are the framework's defaults. Named here with the job each does, for FUEL-67 to declare in `@theme`.

| | Width | What changes at it | Why this width |
|---|---|---|---|
| — | < 768 | The phone. Pinned pill, 22px gutter, merged macro grid, stacked week, phone ruler | The case the PRD is written for |
| `md` | 768 | Gutter 22 → 28. The week becomes seven columns; `/` splits its macro grid and takes the wide ruler | Already load-bearing — § The Week, Two Ways and § The Day's Numbers on a Phone both turn here. Not moved, because moving it re-opens two settled sections |
| `lg` | 1024 | The pill becomes the rail. The action bars stop being sticky. The frame appears, fluid | Where the sidebar already is, and the width `min-w-0` was paid for |
| `xl` | 1272 | The frame caps and centres. The aside appears. `/plan`'s week grid stops scrolling | Rail + gutter + the 1024px week grid |

**768 to 1023 is a real band and it now has a rule.** Today it is a phone with a wide week grid: an iPad in portrait at 820px gets a floating pill on a 1180px-tall screen. The ruling is that this band takes the **phone's navigation and the desktop's content shapes** — the pill stays, because a 220px rail at 768px is a fifth of the width spent on four items, while the wide week and the split macro grid have the room they were drawn for. It is the one band nobody had looked at, and it is stated here rather than left to fall out of two breakpoints that were never chosen together.

#### The measure stays 640

**640px survives, unchanged.** It is a typographic bound rather than a layout one: it was set against § Typography's 17px body, which "stays at 17px" for its own stated reason, and widening the column would buy a longer line at the same type size on every screen in the app — the thing a measure exists to prevent.

What was wrong was never the 640. It was that 640 was the *whole app*, so the only thing extra width could become was void. **Screens gain columns beside the measure; the measure does not grow.** `/plan`'s 1024px is not an exception to that and never was — it is a table rather than prose, and no measure applies to a table. At ≥1272 it is exactly the measure plus the aside.

#### What each screen becomes

The mock's seven, which are four routes, one sheet and two states of `/`:

| Screen | Is | At ≥1272 |
|---|---|---|
| **Right Now** | `/` | Two columns — the measure keeps the meal, the macro grid and the action bar; the aside takes the day ruler and the Anytime list, which is what the 544px of nothing sat in front of |
| **Swap** | `/`, a sheet | Stays a sheet at the measure's width: a swap is one decision about one meal, and putting the cost and the choice on opposite sides of a gutter would make it two |
| **Meal detail** | a state of `/` | The same column with more air — one object, read top to bottom, with nothing to set beside it |
| **Training** | `/training` | Two columns — the measure keeps the session and the exercise list; the aside takes the dot grid and recent sessions, which are below the fold at every width today |
| **Weight** | `/weight` | Two columns — the measure keeps the chart and the entry control; the aside takes the weigh-in history FUEL-84 bounded |
| **Weekly plan** | `/plan` | One column at 1024px — the measure and the aside spanned, the grid at its natural width and no sideways scroll. The only screen where the extra width goes to the content rather than beside it |
| **Day complete** | a state of `/` | The same column, with more air. Crop marks close the day, and a second column would set something beside a screen whose whole argument is that there is nothing left |

**The three the mock never drew.** `/shopping`, `/plan/template` and `/settings` are each a single list or form, and each is the measure with more air. Written down rather than left to whichever ticket meets them first: the mock's seven are not the app's seven, and a screen with no ruling is a screen that gets argued about.

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

#### What does not change

`<main>` keeps `min-w-0`, and the frame does not retire the reason for it: `/plan`'s grid is still wider than the space beside a rail at 1024px, and without it the page pushes off the right of the screen at exactly that width, silently. `--nav-shell-h` is a below-1024px measurement and stays one — above it the shell is a rail with no height to clear, and the two bars that read it are no longer sticky. Both notice bands keep their full-bleed hairline and their independence; only the position of their inner box changes.

#### The mock is silent above 375px, not authoritative there

`BRAND_GUIDE.html` draws all seven screens at `.device { width: 375px }`, captioned "True 375px — the width the PRD names as the dominant case". That caption says what the mock *is*, not what the app may be. It is recorded here as the fourth named override for the same reason as the other three: so that nobody reads "the mock has no second column" as a prohibition, and restores a single column later as a fidelity fix. The mock remains the source of truth for appearance at 375px, which is every rule in it except the one width it was drawn at.

## Component Patterns

### Buttons

| Variant | Appearance | When |
|---|---|---|
| **Primary** | `ink` fill, `ink-fg` text, radius 12, 52px | The one action the screen exists for. One per screen. |
| **Secondary** | No fill, 1px `border`, 46px, weight 500 | Real actions that aren't the main one — Swap, Skip, Partial |
| **Text** | No fill, `text-primary`, underlined in `text-tertiary` | Tertiary — Revert, Repeat for 2 days |
| **Destructive** | No fill, `error` text; fill only inside a confirmation sheet | Delete, discard |

### Key/Value Grid

The default way to present numbers. Micro label above, Value below, optional Slash metadata beneath. Two columns on mobile, three when the figures are short. It replaces the macro "strip" entirely.

### Lists

Rows on the canvas, separated by hairlines. No card, no fill, no outer rule. 54px minimum; 46px in dense contexts (ingredients, exercises). Ordinal indices — `01`, `02` — in mono `text-tertiary` where sequence matters.

### Tiles

Flat, radius 14, either `ink` or `surface`. Layout: name at top (15px/600), a single line motif centred, `/ ` metadata at the bottom. Selection is a 1.5px `accent` inset ring, never a fill. Used in the meal picker and on meal detail.

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
| Draw-in | 400ms, once per mount. Dropped under `prefers-reduced-motion` |

**Why the plot area gets a fill.** It is the one thing in this system that must be read *against* something. A trend line on the bare canvas has no extent, so a reading near the top and one near the bottom carry no meaning until an edge says where the top and the bottom were. Everywhere else, hairlines and space do that work and a fill would be decoration.

**Start and target share a stroke and differ by their labels.** Telling them apart by ink would need a second accent, which § Deliberately Absent forbids, and § Accessibility's "never colour alone" would rule out doing it with colour regardless. The band between the two lines is the whole journey, which is worth being able to see at a glance.

**No vertical gridline, ever.** Time is continuous and a weigh-in is a moment in it, so a vertical rule would draw an edge the data does not have.

**The empty state draws nothing at all.** § UI Copy Examples already writes it — "No weigh-ins yet. Your first entry starts the chart" — and the sentence says the chart does not exist yet. An empty ruled plate would contradict the copy sitting directly above it.

Added in FUEL-35 and not in `BRAND_GUIDE.html`, which predates the chart. Recorded here rather than left to the component, on § The Dot Grid's precedent: a divergence that is written down is a decision, and one that is not is an accident waiting to be re-litigated.

### Sheets

`raised` fill, 26px top radius, grabber, 22px gutters. The only element with a shadow. They answer every question a modal would have.

### Navigation

**The four:** **Now** `/` · **Plan** `/plan` · **Training** `/training` · **Weight** `/weight`.

- **Mobile:** a centred pill — 1px `border`, 4px padding. Inactive items are 46×40px icon-only with an `aria-label`; the active item is an `ink` pill showing icon plus text label. The `aria-label` is the label, so the four names above are the only names these destinations have anywhere. It is **pinned to the bottom of the viewport**, overriding the mock — see below.
- **Desktop:** the same four as a left sidebar at ≥1024px — the rail, and § Desktop places it. It is a left sidebar rather than a flush one: above 1272px it begins at the frame's edge, not the screen's.
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

### Crop Marks

Print registration marks, 11px, `text-tertiary`, at the four corners of the day-complete summary **and nowhere else**. The day is a finished page. A device used once keeps its meaning.

A finished page still sits in the app's frame. The § Navigation shell renders below this screen like every other authenticated one — it did not always, and that section records the reversal and the mock caption it overrides. Crop marks close the day; they do not close the app.

### Slash Metadata

A leading `/ ` in `text-tertiary` marks every secondary fact — `/ 612 kcal · 25 min · serves 1`. It replaces the parentheses, dashes and colons that make interface copy look unconsidered, and costs one character.

### The Scroll Edge

The sticky action bars on `/` and `/training` are opaque, so the page scrolls out of sight at their top edge. Below 1024px that edge is masked over its top 24px, and a line of type meeting it runs out rather than being cut through the x-height.

The **one permitted exception to "no gradients"**, and narrow on purpose: it is a mask, not a material. Nothing is painted — the bar's flat fill is unchanged and the stencil only decides where the bar stops covering. What the flat rule bans is a ramp standing in for depth, which is why Hatching is "a pattern, not a texture" and why charts get no area fill. A shadow would have been the system's second and § Materials reserves the only one for sheets; a rule would have said "boundary" where the screen needs to say "there is more below".

Nowhere else. A device used once keeps its meaning.

### Deliberately Absent

Icons that repeat their own label · filled status pills · card borders · elevation · any second accent · area fills and gradients under charts.

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

One question per screen. Bottom sheets for the meal picker and swap preview; the swap's resulting day totals appear *inside* the sheet, above the confirm button. No modals, no accordions, no tabs within a screen.

## Accessibility

**Target:** WCAG 2.1 Level AA. Where restraint and contrast conflict, contrast wins and the hairline gets darker.

- **Contrast:** ≥4.5:1 body, ≥3:1 for large text and every control, tick, dot and hairline that carries meaning.
- **Never colour alone:** the ruler encodes status as fill / hatch / hairline; the dot grid as solid / ring / size. Both survive greyscale — and both already are greyscale.
- **Signature graphics** each carry an accessible summary plus an adjacent data table. A mark on a screen is not the data.
- **Micro labels** at 10.5px are permitted only where the value sits adjacent at 22px or more — never for standalone information — and scale with Dynamic Type.
- **Focus:** 2px `accent` ring, 2px offset, on every interactive element in both modes. Never removed.
- **Touch:** 44×44px minimum. Icon-only tabs carry an `aria-label`; the active tab shows its label as text.
- **Reduced motion:** `prefers-reduced-motion: reduce` drops the chart and ruler draw-in; sheets cross-fade at 100ms.
- **Dynamic Type:** sizes in `rem`, tested to 200% zoom with no horizontal scroll — the week grid at ≥768px excepted, which scrolls by design. Below 768px nothing on any screen scrolls sideways, the week grid included; see § The Week, Two Ways.

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
- **v3.8 (current):** § Desktop added (FUEL-66) — the decision the Desktop Version milestone is built on, and the first time this document specifies a width above 1024px. Driven by measurement: at 1920×1080 the sidebar ended at x 220 and the content column began at x 764, a **544px void**, while the demo banner and the walk reminder sat **124px** off the content's centre because the root layout centres them on the viewport and `<main>` centres itself on what the sidebar leaves. Two symptoms, one fault — nothing was on a shared grid — so they are fixed together by a single centred frame of **1272px** (the 220px rail, a 28px gutter, and the 1024px § Spacing already fixes for the week grid) whose columns are declared as custom properties both layouts read. Four breakpoints are named and given jobs, including the 768–1023 band that had none; **640px survives unchanged as the reading measure**, with screens gaining columns beside it rather than a wider column; each of the mock's seven screens gets its desktop composition in a sentence, as do the three routes the mock never drew; and a carry-over rule is stated — a mobile decision carries unless its written rationale names the phone — whose first application unsticks the action bars above 1024px, which is the removal § The Scroll Edge left to FUEL-72. § Spacing & Layout's max-content-width line now defers to § Desktop rather than restating a rule it no longer owns. The cost is named: the sidebar stops being flush with the screen edge. `BRAND_GUIDE.html` is unchanged — FUEL-67 draws the frames — and its silence above 375px is recorded as the fourth named override, so that a mock with no second column is not later read as a mock that forbids one. It remains the source of truth for appearance at 375px, which is every rule in it except the one width it was drawn at.
- **v3.7:** § Materials gains The Scroll Edge (FUEL-83) and, with it, the single exception to "no gradients" the guide has ever carried. The sticky action bars on `/` and `/training` are opaque, and at 375×667 the resulting hard edge cut the first exercise's prescription through the x-height — half of every letter drawn and half not, which reads as a rendering fault rather than as content continuing below. Below 1024px the top 24px of the bar is now masked so the line runs out instead. Recorded as an exception rather than waved through because the flat rule is stated three times in this document and twice in the mock: what it bans is a ramp painted as a material, and a mask paints nothing — the bar's flat fill is untouched and the stencil only decides where it stops covering. The alternatives are named in the section and both were rejected on the guide's own terms: a shadow would be the system's second, and a rule states a boundary where the screen needs to state continuation. No change to any bar's position, height or `--nav-shell-h` offset, and none above 1024px, where FUEL-72 may remove the pinning that creates the edge at all.
- **v3.6:** § The Day's Numbers on a Phone added (FUEL-82): below 768px `/` merges `This meal` and `Today` into one grid, the meal's figure as the value and the day's on the slash line, and the day ruler follows the figures rather than preceding them. Driven by measurement — 313px of the 667 at 375×667 is chrome, and the two grids wanted the whole 354px that left. All four macros survive against target with a signed delta, so PRD § P4 still holds on a phone; the mock's own two-figure summary would have satisfied it nowhere. § Touch Targets gains the sentence its 44×44 minimum always implied — the rule is about the area, not the mark — which is what lets the demo banner close from 57px to 47. The 375px Right Now frame in `BRAND_GUIDE.html` is redrawn to the merged shape and now carries the two notice bands it had always omitted; that omission is why four bands were never summed. Above 768px the two named sections are unchanged, and the mock remains the source of truth for everything else.
- **v3.5:** § Navigation pins the mobile pill to the bottom of the viewport (FUEL-65), overriding the mock's `.tabbar { margin-top: auto }` — the third override this section records against the HTML mock, after the fourth destination and the day-complete tab bar. Driven by measurement rather than taste: the shell sat at the end of the document, 3636px down on `/weight`. The action bars on `/` and `/training` now clear it by `--nav-shell-h`. Appearance of the pill itself is unchanged, and the desktop sidebar is untouched; the mock remains the source of truth for everything else.
- **v3.4:** § Navigation gains the naming rule its route table implied but never stated (FUEL-60): the Destination column is the name, every link that names a destination uses it, and the `<h1>` is a heading that must map to that name rather than a second name for it. Two carve-outs are named — a link inside a sentence and a link whose name is an action — and the labels corrected under the rule are listed. No visual change; the HTML mock is unchanged and remains the source of truth for everything else.
- **v3.3:** § Navigation names the four top-level destinations (FUEL-56) and gains a route table giving every authenticated route one level and one parent. Settings gives up its slot for a link at the foot of `/`; `/shopping` and `/plan/template` are both placed under `/plan`. The reading of the PRD's "no navigation" criterion moves to the PRD, where § Navigation now points instead of arguing, and day-complete's absent tab bar is re-sourced to the mock caption that actually requires it. A section that had specified a shell without naming its contents; the HTML mock predates the shell entirely and remains the source of truth for everything else.
- **v3.2:** § Data Display added for the weight trend chart (FUEL-35), and `surface` gains its second permitted use — the chart's plot area — in § Color Palette. Both are additions the HTML mock predates; it remains the source of truth for everything else.
- **v3.1:** the dot grid gains a Partial dot (FUEL-27) and its unrecorded day is named as such rather than as "no session". An addition to § The Dot Grid only; the HTML mock is unchanged and remains the source of truth for everything else.
- **v3:** display scale raised to 76px for a 7× ratio against 10.5px micro labels; accent restricted to meaning "now" only, with actions moving to ink; day ruler and dot grid introduced as signature graphics; flat line motifs, hatching, crop marks and slash metadata added as the material language. Flat discipline retained — no gradients, no textures, no shadows outside sheets.
