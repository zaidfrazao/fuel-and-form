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

The interface is flat: no gradients, no textures, no shadows outside sheets. What makes it read as designed rather than generic is scale, restraint, and two signature graphics.

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
| Skipped | 1.5px `text-tertiary` ring, no fill |
| Walk-only / no session | 4px `text-tertiary` or `border` dot |
| Today | Filled `accent` with a 3px `accent-subtle` halo |

Shows the pattern and refuses to grade it, which is the PRD's position on adherence. Lives on Training and Weight.

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
| `surface` | `#F4F1EC` | `#17150F` | — | Stone tiles only — the one fill permitted outside sheets |
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
- **Max content width:** 640px single-column, centred on desktop; 1024px for the week grid.
- **Elevation:** none, except sheets — `0 -8px 34px rgba(0,0,0,0.12)`.

### Touch Targets

44×44px minimum. Primary actions sit in the bottom third, within thumb reach. Destructive controls never sit adjacent to a frequently-tapped one.

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

### Sheets

`raised` fill, 26px top radius, grabber, 22px gutters. The only element with a shadow. They answer every question a modal would have.

### Navigation

- **Mobile:** a centred pill — 1px `border`, 4px padding. Inactive items are 46×40px icon-only with an `aria-label`; the active item is an `ink` pill showing icon plus text label.
- **Desktop:** the same four as a left sidebar at ≥1024px.
- **Depth:** two levels maximum. Anything deeper is a sheet.
- **`/` never requires navigation to be useful.** The PRD's first acceptance criterion.

## Materials

Flat, with four devices doing the work depth would otherwise do.

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

### Slash Metadata

A leading `/ ` in `text-tertiary` marks every secondary fact — `/ 612 kcal · 25 min · serves 1`. It replaces the parentheses, dashes and colons that make interface copy look unconsidered, and costs one character.

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
- **Dynamic Type:** sizes in `rem`, tested to 200% zoom with no horizontal scroll — the week grid excepted, which scrolls by design.

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
- **v3 (current):** display scale raised to 76px for a 7× ratio against 10.5px micro labels; accent restricted to meaning "now" only, with actions moving to ink; day ruler and dot grid introduced as signature graphics; flat line motifs, hatching, crop marks and slash metadata added as the material language. Flat discipline retained — no gradients, no textures, no shadows outside sheets.
