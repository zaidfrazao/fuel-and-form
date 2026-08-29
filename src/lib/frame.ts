/**
 * The frame, as classes — Brand Guide § Desktop, FUEL-70.
 *
 * `globals.css` declares the grid: a 1272px container holding a 220px rail, a
 * 28px gutter, the 640px measure, and whatever is left. This file is how a
 * component says which part of it to stand in.
 *
 * ## Why the strings live here rather than in the components
 *
 * Because the two things that have to agree are in different layouts and one of
 * them may not move. `app/(app)/layout.tsx` renders the rail and the content
 * column; `app/layout.tsx` renders the demo banner and the walk reminder ABOVE
 * `children`, which `skip-link.tsx` argues is the only position that makes the
 * skip link the first focusable element. So the bands are outside the app
 * layout's grid and have to reach the same column from the root of the document.
 *
 * They do it by taking the same template and the same column index. § Desktop
 * puts it as "the root layout does not learn the sidebar's width; it reads the
 * same rail declaration the sidebar reads", and names the alternative it
 * rejects: giving the bands a `padding-left` of rail-plus-gutter would make the
 * root layout depend on something that exists only under `(app)`, at one
 * breakpoint — the shape of the original fault rather than a fix for it.
 *
 * Repeating the class string in three files would be the same fault again. One
 * declaration with three readers is the whole design; a constant is what makes
 * "three readers" a fact a test can hold rather than a habit.
 *
 * ## Below `lg` none of this applies, and that is the control
 *
 * The grid begins at 1024px, where the rail does. Below it the measure centres
 * on the viewport exactly as it always has — which is why `FRAME_MEASURE`
 * carries `mx-auto` as well as its column, and why the 375px and 820px visual
 * baselines are expected to come back byte-identical. A diff at either width
 * means this leaked below the breakpoint.
 */

/**
 * The container. Worn by the app layout's wrapper and by each notice band's
 * outer box — the three elements that need the grid itself rather than a place
 * in it.
 *
 * `mx-auto` with `max-w` is the whole of "fluid below 1272, centred above it";
 * no `xl:` variant is involved, because a max-width caps itself. That matters
 * for one reason worth writing down: § Desktop redefines Tailwind's `xl` from
 * 1280 to 1272 and nothing has declared it yet, so an `xl:` utility written
 * today would silently be the 1280 default.
 */
export const FRAME =
  "mx-auto w-full max-w-[var(--frame-max)] lg:grid lg:grid-cols-[var(--frame-columns)] lg:gap-x-[var(--frame-gutter)]";

/**
 * Column one. Worn by the navigation shell.
 *
 * This is what replaced `lg:order-first`, and the replacement is the stronger
 * statement rather than a weaker one: the shell is still LAST in the DOM at
 * every width — `app/(app)/layout.tsx` and `skip-link.tsx` both depend on that
 * reading order — and now says which column it occupies instead of which way it
 * shuffles among its siblings.
 *
 * There is no width here either. The track is the rail, so the sidebar is 220px
 * because the frame says so, which is the point of the frame.
 */
export const FRAME_RAIL = "lg:col-start-1 lg:row-start-1";

/**
 * Column two, the measure. Worn by `<main>` and by each notice band's inner box
 * — the elements whose centres § Desktop requires to be the same one.
 *
 * `mx-auto w-full max-w-[…]` is the below-`lg` half and does nothing at `lg`,
 * where the track is already exactly the measure. `max-w` is first in the string
 * so a caller can still override it: `/plan` does, and is the only screen that.
 */
export const FRAME_MEASURE =
  "mx-auto w-full max-w-[var(--frame-measure)] lg:col-start-2 lg:row-start-1";

/**
 * Columns two and three, taken together — `/plan`, and only `/plan`.
 *
 * § Desktop: the week grid is "the measure and the aside spanned, the grid at
 * its natural width and no sideways scroll. The only screen where the extra
 * width goes to the content rather than beside it." At the frame's cap that span
 * is 640 + 28 + 356 = 1024 exactly, which is the width § Spacing fixes for the
 * grid and the reason 1272 is a sum.
 *
 * `col-end` rather than `col-span-2`, and not as a matter of taste: `col-span-2`
 * sets both ends of the shorthand, so `cn` would drop the `lg:col-start-2` it
 * conflicts with and the grid would place the span from column one — over the
 * rail.
 *
 * This is composition rather than a second column: what goes IN an aside on the
 * other screens is FUEL-77 and FUEL-78's. It is here because without it `/plan`
 * would lose 384px to a change that was supposed to give width back.
 */
export const FRAME_MEASURE_AND_ASIDE = "lg:col-end-[-1]";
