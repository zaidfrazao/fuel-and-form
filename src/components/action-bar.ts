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
 */
export const SESSION_ACTION_BAR = `${ACTION_BAR} action-bar-fade-pinned`;

/* -------------------------------------------------------------------------- */
/* A control is its content plus air — § Buttons, FUEL-85; built in FUEL-86     */
/* -------------------------------------------------------------------------- */

/**
 * The controls, as a row at the frame's cap.
 *
 * § Buttons, amended by FUEL-85: "On a phone a page's action bar is full-width,
 * because a full-width target is what a thumb wants and § Touch Targets asks
 * for it. That is a phone's reason, so by this section's own carry-over test it
 * does not travel: at ≥1272 the buttons in a **page action bar** take their
 * content's width and sit in a row. A 584px slab is a thumb target drawn on a
 * screen with no thumb, and a row is what lets a fourth control — Undo, when
 * there is a log to take back — be a fourth item rather than a third row of
 * slabs."
 *
 * ## Why this is a wrapper inside the bar rather than the bar itself
 *
 * Because the bar holds one thing that is not a control. § Feedback puts a
 * refusal "at the point of action", so the inline banner is the bar's first
 * child and it is a block that spans the column — turning the BAR into a row
 * would stand the banner beside the buttons it is reporting on. The bar stays a
 * flex column of at most two things: the banner, and this.
 *
 * `contents` below `xl`, so the phone is untouched: the primary, the
 * Swap/Skip pair and the Undo row are the bar's own flex items in the order
 * they are written, with the 12px gap they have always had.
 *
 * ## The gap is 12 and the mock draws 10
 *
 * Kept at `gap-3`. § Spacing's base scale is 4, 8, 12, 14, 20, 22, 26, 30 — 10
 * is not on it and 12 is, the bar already uses 12 between its rows at every
 * width, and a row that changed its gap by 2px at one breakpoint would be a
 * number no rule in the guide can defend. Recorded rather than silently
 * rounded: it is the one place this bar does not transcribe the drawing.
 */
export const ACTION_BAR_CONTROLS = "contents xl:flex xl:flex-row xl:items-center xl:gap-3";

/**
 * A pair of controls that share a row below the cap and dissolve into the row
 * above it — Swap and Skip, Partial and Skip.
 *
 * The same `display: contents` device the column groups use in `lib/frame.ts`,
 * for the same reason: one DOM, two shapes, and nothing reordered at either, so
 * a screen reader meets these controls in one sequence at every width.
 */
export const ACTION_BAR_SPLIT = "flex gap-3 xl:contents";

/**
 * The primary, and the Undo row's wrapper: full-width below the cap, its own
 * width at it.
 *
 * `xl:w-auto` rather than a width, because the whole rule is that the control
 * is its content plus air. `Button` already carries the air — the size variants
 * set the padding — so there is nothing here to name.
 */
export const ACTION_BAR_PRIMARY = "w-full xl:w-auto";

/**
 * A control that shares the phone's second row.
 *
 * `flex-1` splits that row in two; `xl:flex-none` gives the shorthand back at
 * the cap, where the pair has become two items of the controls row and `flex: 1
 * 1 0%` would stretch them to fill the measure — the slab this rule exists to
 * remove, drawn twice instead of once.
 */
export const ACTION_BAR_SECONDARY = "flex-1 xl:flex-none";
