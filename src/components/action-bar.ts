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
 * touched them changed all four by hand — FUEL-58, FUEL-65, and this one. The
 * next is FUEL-72, which changes the desktop half; there is no reason to make
 * it the fourth ticket to get that right by memory.
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
 */
export const ACTION_BAR =
  "action-bar-fade sticky bottom-[var(--nav-shell-h)] mt-auto flex flex-col gap-3 bg-background pt-[30px]";

/**
 * The three real bars, which also release the shell's offset at desktop widths:
 * above 1024px the shell is a sidebar to the left and there is nothing beneath
 * the bar to clear.
 *
 * The `/dev/nav-shell` specimen deliberately does NOT take this. It frames a
 * 375×667 phone inside a page that is usually being read on a desktop, so `lg:`
 * would answer to the browser window rather than to the frame and quietly show
 * the desktop arrangement in a specimen labelled with the phone's dimensions.
 */
export const APP_ACTION_BAR = `${ACTION_BAR} lg:bottom-0`;
