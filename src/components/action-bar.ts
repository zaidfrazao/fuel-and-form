/**
 * The action bar's class string, in one place — FUEL-83.
 *
 * `/`'s bar, `/training`'s, the `/` skeleton that stands in for the first, and
 * the `/dev/nav-shell` specimen that measures all of them were four identical
 * literals. They have to agree: the skeleton exists so the primary does not
 * move on swap-in, and the specimen is where the bar-versus-shell geometry is
 * checked, so a specimen that has drifted is a measurement of nothing.
 *
 * Four copies stayed in step for as long as they did because every ticket that
 * touched them changed all four by hand — FUEL-58 and FUEL-65. FUEL-72 was the
 * next, and it changed the desktop half: the first ticket to do that by editing
 * one string rather than by getting four right by memory.
 *
 * `right-now.tsx` carries the reasoning for what the string says: why `sticky`
 * as well as `mt-auto`, why the offset is `--nav-shell-h` and not 0, and why
 * the safe-area inset is not here. `globals.css` carries `action-bar-fade`.
 */

/**
 * Everything the four share.
 *
 * `bg-background` is what makes the bar opaque as the page passes beneath it.
 * `action-bar-fade` is what keeps that opacity from arriving as a hard edge:
 * below `lg` it masks the top 24px of the bar so a line of type meeting it runs
 * out instead of being cut through the middle. The fill is unchanged — see
 * globals.css for why a mask and not a shadow, a rule, or a painted gradient.
 *
 * Both of those describe a bar with a page moving under it, and below `lg` that
 * is what this is. Above it the same declarations are inert rather than wrong:
 * `bottom-[…]` does nothing to a static box, the mask's media query does not
 * match, and `bg-background` on a bar that no longer covers anything paints the
 * canvas its own colour. They stay here because they are the shared half, and
 * the release below is expressed as one utility rather than as the removal of
 * four.
 */
export const ACTION_BAR =
  "action-bar-fade sticky bottom-[var(--nav-shell-h)] mt-auto flex flex-col gap-3 bg-background pt-[30px]";

/**
 * The three real bars, which stop being pinned at desktop widths — FUEL-72.
 *
 * Brand Guide § Desktop: "above 1024px there is no thumb, so the bar has no
 * posture to serve, and a control pinned over content the reader is reading is
 * only a cost. The primary action sits at the end of its column." That is
 * § Desktop's carry-over rule applied rather than a taste exercised — a mobile
 * decision carries to desktop unless its written rationale names the phone, and
 * § Touch Targets' "primary actions sit in the bottom third, within thumb
 * reach" names it. The 44×44 minimum in the same section names no posture and
 * carries, so the primary is the same size here as it is on a phone; it is only
 * the pinning that is a phone's.
 *
 * ## `lg:static`, and not the `lg:bottom-0` that stood here first
 *
 * `bottom-0` re-offsets a box that is still pinned, and that was the defect
 * rather than a partial fix of it: at 1440×900 on `/training` the bar held the
 * bottom ~130px of the viewport — 14% of the screen — in opaque `bg-background`,
 * cutting the Recent list mid-row for as long as the reader stayed on the page.
 * The offset it released was the shell's, which is real below `lg` and which
 * `--nav-shell-h` exists for; releasing it while keeping the pinning answered
 * the smaller half of the question.
 *
 * `static` releases the pinning itself, and the `bottom-[…]` inset in the shared
 * string goes inert with it — an inset has no effect on a static box — so this
 * is one utility rather than a position and a second offset that have to agree.
 *
 * ## `mt-auto` is not part of this and must not be
 *
 * It does separate work at every width: it puts the bar at the foot of a short
 * page. A released bar without it would sit directly beneath whatever content
 * there was and end mid-screen with a gap under it, which is the state
 * `app/(app)/layout.tsx` bought `flex-1` to prevent. So the desktop bar is at
 * the end of its column in both senses — after the content in the DOM, and at
 * the bottom of `<main>` when the content does not reach it.
 *
 * ## The specimen
 *
 * `/dev/nav-shell` deliberately does NOT take this. It frames a 375×667 phone
 * inside a page that is usually being read on a desktop, so `lg:` would answer
 * to the browser window rather than to the frame and quietly show the desktop
 * arrangement in a specimen labelled with the phone's dimensions.
 */
export const APP_ACTION_BAR = `${ACTION_BAR} lg:static`;

/**
 * The one bar that stays pinned at every width — `/training`'s session state,
 * FUEL-90 and FUEL-91.
 *
 * Brand Guide § Desktop names this as the single exception to the release
 * above, and calls it "the exception that proves what the rule is about":
 * FUEL-72 released the other bars on the grounds that "above 1024px there is no
 * thumb, so the bar has no posture to serve", and both halves of that sentence
 * are claims about a THUMB TARGET. A running rest timer (FUEL-93) is not one. A
 * live readout that scrolls out of sight has failed at its only job at 1920
 * exactly as at 375, so this bar keeps the pinning the others give up.
 *
 * It is `ACTION_BAR` without `lg:static` rather than a string of its own, so
 * everything the four bars share stays shared and the difference between them
 * is exactly the one utility that is different.
 *
 * `action-bar-fade-pinned` is the other half, and it is not optional: the mask
 * in the shared string is scoped below `lg`, so above it this bar would arrive
 * as a hard edge cutting through a line of type — the fault § The Scroll Edge
 * exists to prevent, now reachable at a width it never was before. globals.css
 * carries that argument and the shared value the two selectors both use.
 *
 * ## `lg:bottom-0`, because the offset was the one thing the release was hiding
 * — FUEL-106
 *
 * Removing `lg:static` kept the pinning and inherited the OFFSET with it, and
 * the offset is a below-1024px number. § Desktop is explicit, in the same
 * sentence that scopes the variable: "`--nav-shell-h` is a below-1024px
 * measurement and stays one... That stays true of the one bar that is [sticky]
 * (`/training`'s session state, FUEL-90): it is pinned above 1024px to the
 * bottom of the viewport, not to a shell height, because the thing it has to
 * clear there is nothing."
 *
 * Measured at 1100 before the fix: `bottom` computed to `86px`, so the bar
 * floated 86px above the foot of the viewport with the page scrolling through
 * the strip beneath it — a gap the size of a shell that is not there. The other
 * three bars never showed it because `lg:static` makes an inset inert, which is
 * the whole of why this string is the one that had to say something.
 *
 * The variable is not touched, and that is the point: it stays a below-1024px
 * measurement with one definition, and the bar that stops reading it above
 * `lg` says so itself. `lg:` and not `xl:` because 1024 is where the shell
 * becomes a rail — and because `xl` is redefined to 1272 and therefore SORTS
 * BEFORE `lg` in the emitted stylesheet, so an `xl:` offset here would be
 * overridden by this one at exactly the widths it was written for.
 */
export const SESSION_ACTION_BAR = `${ACTION_BAR} lg:bottom-0 action-bar-fade-pinned`;

/* -------------------------------------------------------------------------- */
/* A control is its content plus air — § Buttons, FUEL-85; built in FUEL-86     */
/* One row at every width — FUEL-109                                           */
/* -------------------------------------------------------------------------- */

/**
 * The controls, as one row.
 *
 * § Buttons, amended by FUEL-85: at ≥1272 "the buttons in a **page action bar**
 * take their content's width and sit in a row". FUEL-109 took the same row to
 * the phone: "Full-width is a property of the bar, not of each control... On a
 * phone the bar is one row that spans the column", with the primary taking the
 * width the others leave. Below the cap this was `contents`, so the primary,
 * the Swap/Skip pair and the Undo row were the bar's own flex items, stacked —
 * a 140px bar that covered both of `/`'s Up next rows at 375×667 on arrival.
 * It is 82px now: the bar's 30px head and the 52px primary.
 *
 * ## Why this is a wrapper inside the bar rather than the bar itself
 *
 * Because the bar holds things that are not controls. § Feedback puts a
 * refusal "at the point of action", so the inline banner is the bar's first
 * child and it is a block that spans the column; `/training`'s rest timer
 * (FUEL-93) is a row in the same slot. Turning the BAR into a row would stand
 * both beside the buttons. The bar stays a flex column — banner, timer, this.
 *
 * ## `flex-wrap`, and what it is for
 *
 * Two things, both of them lines of their own rather than breakpoints.
 *
 * The Undo row (and `/training`'s note controls) is `ACTION_BAR_PRIMARY`, which
 * is `w-full` below the cap, so in a wrapping row it takes a line to itself
 * beneath the controls — where § Buttons keeps it on a phone, because it
 * appears after a tap and as a fourth item would pull the row sideways under
 * the thumb that just used it. At the cap it is `w-auto` and the row's fourth
 * item, as FUEL-85 drew it.
 *
 * And a column too narrow for the row. `Log eaten`, `Swap`, `Skip` and two gaps
 * come to 287px; a 320 screen's column is 276. There the pair wraps to a second
 * line at its own width — a 140px bar again — instead of the row running past the
 * gutter, which `whitespace-nowrap` on `Button` would otherwise make it do. It
 * happens where the labels stop fitting rather than at a width somebody
 * measured once, so a longer label moves the point with it.
 *
 * Nothing wraps at the cap: the widest row there is ~370px in a 584 measure,
 * and a wrapping container with one line lays out exactly as a non-wrapping
 * one, which the 1272 and 1920 baselines hold to the pixel.
 *
 * ## The gap is 12 and the mock draws 10
 *
 * Kept at `gap-3`. § Spacing's base scale is 4, 8, 12, 14, 20, 22, 26, 30 — 10
 * is not on it and 12 is, the bar already uses 12 between its rows at every
 * width, and a row that changed its gap by 2px at one breakpoint would be a
 * number no rule in the guide can defend. Recorded rather than silently
 * rounded: it is the one place this bar does not transcribe the drawing.
 */
export const ACTION_BAR_CONTROLS = "flex flex-wrap items-center gap-3";

/**
 * A pair of controls that share the row — Swap and Skip, Partial and Skip.
 *
 * One flex item below the cap, so that when the row is too narrow the pair
 * wraps as a pair rather than leaving Skip alone on a second line. At the cap
 * it dissolves into the row with the same `display: contents` device the
 * column groups use in `lib/frame.ts` — one DOM, and nothing reordered at
 * either width, so a screen reader meets these controls in one sequence.
 */
export const ACTION_BAR_SPLIT = "flex gap-3 xl:contents";

/**
 * The primary that leads the row — FUEL-109.
 *
 * `flex-1` below the cap: it takes whatever width the secondaries leave, so the
 * bar is still full-width as a whole and the primary is still its widest
 * target. Its basis is 0, which is what lets the secondaries be measured first;
 * its floor is its own label, because `Button` is `whitespace-nowrap` and a
 * flex item does not shrink below its min-content width. `flex-1` also displaces
 * `Button`'s `shrink-0` through `cn`'s merge, which is the intent.
 *
 * `xl:flex-none` gives the shorthand back at the cap, where the primary is its
 * content plus air like every other control in the row.
 */
export const ACTION_BAR_LEAD = "flex-1 xl:flex-none";

/**
 * A primary on a line of its own: full-width below the cap, its own width at it.
 *
 * The Undo row's wrapper and `/training`'s note controls, which take a line
 * beneath the bar's row; and the primaries of `weigh-ins.tsx` and
 * `slot-times-form.tsx`, which are not in a bar at all but are the one action
 * of their page and follow § Buttons' width rule with it.
 *
 * `xl:w-auto` rather than a width, because the whole rule is that the control
 * is its content plus air. `Button` already carries the air — the size variants
 * set the padding — so there is nothing here to name.
 */
export const ACTION_BAR_PRIMARY = "w-full xl:w-auto";

/**
 * A secondary in the row: its content's width, at every width — FUEL-109.
 *
 * This was `flex-1` below the cap, which split the phone's second row in two
 * and gave Swap and Skip 159px each — the width no thumb asked for that
 * FUEL-109 took back. `flex-none` rather than nothing, because `Button` is
 * `shrink-0` already and `flex-none` says the same thing about growing.
 */
export const ACTION_BAR_SECONDARY = "flex-none";
