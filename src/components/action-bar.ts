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
