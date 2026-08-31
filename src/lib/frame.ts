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
 * no `xl:` variant is involved, because a max-width caps itself.
 *
 * That used to come with a warning — § Desktop redefines Tailwind's `xl` from
 * 1280 to 1272, nothing had declared it, so an `xl:` utility written here would
 * silently have been the 1280 default. FUEL-77 declared it in `@theme` and is
 * the first `xl:` in the codebase; `frame.css.test.ts` compiles the variant and
 * reads the width out of the emitted media query, because a deleted breakpoint
 * is replaced by a default 8px away rather than by nothing.
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

/* -------------------------------------------------------------------------- */
/* A screen's own two columns — FUEL-77                                        */
/* -------------------------------------------------------------------------- */

/**
 * The screens that have an aside: `<main>` becomes the page's own grid.
 *
 * § Desktop gives four screens a second column — `/`, `/training`, `/weight`
 * and, differently, `/plan` — and the first two are this ticket's. The shape is
 * the mock's `.dbody`: the measure keeps the subject and the primary action, the
 * aside takes what the 544px of nothing used to sit in front of.
 *
 * ## Why `xl` and not `lg`, when the ticket says ≥1024
 *
 * The breakpoint table gives each width one job, and `xl`'s is "the frame caps
 * and centres. **The aside appears.**" `lg`'s is the rail and the unpinning,
 * both of which already happened (FUEL-72). The arithmetic agrees and is the
 * harder argument: below the cap the frame is fluid, so the third track is
 * `1fr` of what is left — 108px at 1024, which is not a column, it is a margin
 * with ambitions. A composition that arrived at `lg` would have to invent a
 * second set of widths for the 1024–1271 band, and § Desktop is explicit that
 * that band gets "a composition of two drawn widths rather than a third
 * drawing".
 *
 * So between 1024 and 1271 these screens stay one column at the measure, with
 * the rail beside them and the bars already released. Recorded on FUEL-77
 * against its first acceptance criterion rather than left as a silent reading.
 *
 * ## The tracks
 *
 * `xl:col-end-[-1]` spans the measure and the aside, which is `/plan`'s move at
 * one breakpoint later — and `col-end` rather than `col-span-2` for the reason
 * `FRAME_MEASURE_AND_ASIDE` gives above: the shorthand would set both ends and
 * `cn` would drop the `lg:col-start-2` it conflicts with, placing the span from
 * column one, over the rail.
 *
 * Inside, the reading column is `--frame-measure-inset` — the 584 a sentence
 * has occupied on every screen since FUEL-70 — and the aside is `1fr`, which at
 * the cap resolves to 356 exactly. globals.css carries that arithmetic beside
 * the declaration. The measure does not change width when the aside arrives,
 * which is § Desktop's requirement that "the column does not move under the
 * reader as they navigate", and it is the reason for the inset rather than the
 * 640: a page that took the full measure here would be 56px wider at 1272 than
 * at 1271 and nowhere else.
 *
 * `content-start` is load-bearing and is easy to lose. `<main>` is stretched to
 * the viewport by the frame — `min-h-dvh` on the container, one row, and a grid
 * item that fills it — so a grid inside it distributes that height across its
 * own rows unless told not to. Without this the two rows spread to the foot of
 * the window and the action bar leaves the content behind, which is the same
 * look FUEL-72 removed at the other end of the page.
 *
 * There is no row gap, and that is deliberate rather than an omission: the bar
 * brings its own `pt-[30px]` (`action-bar.ts`), so a 30px row gap would draw 60.
 *
 * ## `max-w-none`, which is not decoration either
 *
 * `FRAME_MEASURE` carries an unscoped `max-w-[var(--frame-measure)]` — the
 * below-`lg` half of the measure, where there is no grid track to be the width.
 * It is a no-op at `lg`, where the track is already exactly 640, and it is a
 * *cap* the moment a screen spans two tracks: the item would resolve to 640 of
 * the 1024 it was given, the inner grid would get 584 of content, and the aside
 * would come out at zero with its content overflowing. `/plan` meets the same
 * edge and answers it by naming its own 1024.
 *
 * `none` rather than a number, because at this breakpoint there is nothing left
 * to cap: the frame has capped and centred, so the span is 640 + 28 + 356 by
 * construction. A `max-w-[1024px]` here would be that sum written a second time
 * in a form an edit to the frame could put out of step.
 */
export const PAGE_ASIDE_GRID =
  "xl:col-end-[-1] xl:grid xl:max-w-none xl:grid-cols-[var(--frame-measure-inset)_minmax(0,1fr)] xl:grid-rows-[auto_auto_1fr] xl:content-start xl:gap-x-[var(--frame-gutter)]";

/**
 * ## The rows are declared, and the third one is flexible — FUEL-86
 *
 * `xl:grid-rows-[auto_auto_1fr]`: the band, the measure's sections, and the bar.
 * Left implicit they were three `auto` tracks, and that is a different layout
 * the moment the aside is the taller column.
 *
 * A grid distributes a SPANNING item's height across the tracks it spans, and
 * the aside spans rows two and three. With both `auto`, an aside taller than
 * the measure plus the bar has its surplus split evenly between them — so the
 * measure's row grows for a reason that has nothing to do with the measure, and
 * the bar goes down with it. Measured on `/` at 1272 after `The day` landed:
 * the measure's own content was 187px, its row was 370, and the primary sat
 * 183px below the last figure it acts on. That is the void this milestone
 * exists to remove, drawn again by the fix for it.
 *
 * `1fr` on the last row is what confines the surplus to it. A flexible track is
 * sized after the intrinsic ones, so row two is the measure's content and
 * nothing else, and whatever the aside still needs is taken by row three —
 * BELOW the bar, which `xl:mt-0` in `PAGE_MEASURE_FOOT` holds at the top of it.
 *
 * Checked in a browser at both of the two regimes a flexible track behaves
 * differently in, because the difference is exactly where an `fr` is easy to
 * get wrong: a page shorter than the viewport, where `<main>` is stretched by
 * `flex-1` and the row resolves against a definite height, and a page taller
 * than it, where the height is indefinite and the `fr` falls back to its
 * content. The bar sits on the measure's last figure in both, and the aside's
 * last row is inside `<main>` in both.
 */

/**
 * The content wrapper each screen already had, dissolved at `xl`.
 *
 * `display: contents` is what lets one DOM serve both shapes. The two column
 * groups below are the grid's items, but they sit inside the flex column the
 * screen has always wrapped its sections in — so at `xl` that wrapper stops
 * generating a box and its children become `<main>`'s own grid items, and below
 * `xl` it is the flex column it has always been, with the gap it has always
 * had.
 *
 * The alternative was moving the groups up to be `<main>`'s direct children and
 * giving `<main>` the gap. That reads simpler and changes the phone: the gap
 * would then also fall between the last section and the action bar, which
 * carries its own 30px, and every screen below 768px would gain 22px it was
 * measured without. § Spacing's rhythm on `/` is FUEL-82's and this ticket does
 * not get to reopen it by accident.
 */
export const PAGE_ASIDE_UNWRAP = "xl:contents";

/**
 * The header band, across both columns — FUEL-86.
 *
 * § Desktop's "one job per zone" gives this one the question *where am I in
 * this?*, and answers it with "a Micro folio line, and the screen's own time
 * graphic if it has one — `/`'s ruler, `/training`'s paginator". Those are the
 * two things FUEL-85's amendment released from the measure: the 640 "binds
 * prose, and only prose", and "a folio line, a time axis, a trend line and a
 * table are none of them".
 *
 * ## Why this is a third row rather than a taller first one
 *
 * The band spans the measure and the aside, so it cannot be a member of either
 * column group — a grid item spans tracks, not columns it is nested inside. It
 * is a sibling of the two groups, placed in a row of its own above them, which
 * is why every placement below moved down one:
 *
 * ```
 * rail |28|<---- measure 584 ---->|28|<- aside 356 ->|
 *      |  |  row 1  the band, spanning 1024          |
 *      |  |  row 2  measure column | aside column    |
 *      |  |  row 3  action bar     | (aside spans)   |
 * ```
 *
 * `col-end-[-1]` rather than `col-span-2` for the reason `FRAME_MEASURE_AND_
 * ASIDE` gives: the shorthand sets both ends, so `cn` would drop the
 * `xl:col-start-1` it conflicts with.
 *
 * ## The margin is not a row gap, and that is the same argument as before
 *
 * `PAGE_ASIDE_GRID` has no `row-gap` on purpose — the action bar brings its own
 * `pt-[30px]` from `action-bar.ts`, so a 30px row gap would draw 60 under the
 * measure. That was true when there were two rows and it is still true now, so
 * the 30px between the band and the content is the band's own bottom margin
 * rather than a gap the bar would also pay.
 *
 * `contents` below `xl` like the two column groups, so the folio and the
 * graphic stay where they already are in the phone's flat flex column and the
 * margin — which `display: contents` ignores — never reaches it.
 */
export const PAGE_HEADER_BAND =
  "contents xl:col-start-1 xl:col-end-[-1] xl:row-start-1 xl:mb-[30px] xl:flex xl:min-w-0 xl:flex-col";

/**
 * The first column: the subject, the figures, and the action bar under them.
 *
 * `contents` below `xl` for the reason above — this wrapper exists to group the
 * sections for the grid, and a group that generated a box would insert a flex
 * item into the phone's column and take its sections out of the rhythm.
 */
export const PAGE_MEASURE_COLUMN =
  "contents xl:col-start-1 xl:row-start-2 xl:flex xl:min-w-0 xl:flex-col xl:gap-[30px]";

/**
 * The second column: what the 544px of nothing is given to hold.
 *
 * `row-span-2` is what keeps the bar where the mock draws it. The measure's
 * sections are the content row and the action bar is the one below it, so an
 * aside confined to the content row would make that row as tall as whichever
 * column was taller — and on a day with a long Anytime list that is the aside,
 * which would push the bar an arbitrary distance below the figures it belongs
 * to. Spanning both rows lets the two columns end where their own content ends.
 *
 * The span is still two and not three: the band above is a row this column has
 * no business in, which is the whole point of giving it one. FUEL-86 moved the
 * start from row 1 to row 2 and left the count alone.
 *
 * `min-w-0`, because a grid item's `min-width` is `auto` and the dot grid and
 * the recent-session rows are content that would rather not shrink.
 */
export const PAGE_ASIDE_COLUMN =
  "contents xl:col-start-2 xl:row-start-2 xl:row-span-2 xl:flex xl:min-w-0 xl:flex-col xl:gap-[30px]";

/**
 * The action bar, at the foot of the measure rather than the foot of the page.
 *
 * Placed explicitly rather than left to auto-placement, which would put it in
 * the next free slot and get the same answer today for a reason no one wrote
 * down — the answer changes the moment a screen renders a third group.
 *
 * § Desktop: "the primary action sits at the end of its column", and the mock
 * draws it 30px under the last figure at the measure's width.
 *
 * Row three since FUEL-86 put the header band in row one. The bar is still the
 * row after the measure's sections; what changed is what is above them.
 *
 * ## `xl:mt-0`, which used to be true by luck
 *
 * This said, until FUEL-86, that `mt-auto` in `ACTION_BAR` "goes inert here
 * exactly as `bottom-[…]` went inert under FUEL-72's `lg:static`: the bar's
 * grid area is its own height, so there is no free space for an auto margin to
 * absorb". The conclusion was right and the reason was not. The bar's row is
 * its own height only while the ASIDE fits in the rows it spans — and the aside
 * spans this one. A taller aside pushes its surplus into this track, an auto
 * top margin absorbs every pixel of it, and the primary lands at the foot of
 * the aside instead of under the figures it acts on.
 *
 * `page-columns.spec.ts` had already written the warning down — "an aside
 * taller than the measure plus the bar would grow row one and push the primary
 * an arbitrary distance below the figures it acts on... Neither is true on
 * these two screens today — the measure is the longer column on both, by a wide
 * margin". FUEL-86 is what made it false: `The day` gives `/`'s aside the whole
 * timeline, and at 1272 the bar was measured 212px below the measure's last
 * figure, in the middle of the void this milestone exists to remove.
 *
 * So the inertness is declared rather than inherited, and it takes two
 * utilities because the auto margin and the stretch are two different things.
 *
 * `xl:mt-0` is the position. An auto margin outranks `align-self` — a grid item
 * with `margin-top: auto` ignores its alignment entirely — so `self-start`
 * alone would have done nothing, and zeroing the margin is what leaves the bar
 * at the TOP of its row wherever that row ends up.
 *
 * `xl:self-start` is the height. Row three is `1fr` and so absorbs whatever the
 * aside still needs, and a grid item stretches to its area by default: the bar
 * kept the right y and grew an 800px `bg-background` box beneath itself on a
 * tall window. Nothing was drawn wrong, which is exactly why this is declared —
 * `action-bar.spec.ts` and `page-columns.spec.ts` both measure the bar's BOX,
 * and a box that is not the bar's own height makes every one of those numbers
 * mean something slightly different from what it says.
 *
 * `mt-auto` stays in the shared string because it is still doing its work below
 * this breakpoint — it is what puts the bar at the foot of a short page — and
 * this is the one width where the page has a second column to be shorter than.
 */
export const PAGE_MEASURE_FOOT = "xl:col-start-1 xl:row-start-3 xl:mt-0 xl:self-start";
