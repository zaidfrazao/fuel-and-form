import { NavShellMount } from "@/components/nav-shell-mount";
import { RouteFocus } from "@/components/route-focus";
import { FRAME, FRAME_RAIL } from "@/lib/frame";

/**
 * The authenticated app's frame — Brand Guide § Navigation, mounted.
 *
 * FUEL-57 built the shell and FUEL-56 decided what is in it; this is the file
 * where it becomes something a user can tap. Everything below is one of two
 * arguments: where the shell sits in the DOM, and who owns the viewport height
 * now that it does.
 *
 * ## The route group, rather than a pathname check
 *
 * § Navigation puts `/login` and `/dev/*` outside the hierarchy — "one is what
 * you see instead of the app, the others are specimens of it" — so they carry no
 * shell. Two ways to honour that: a `pathname.startsWith("/dev")` test inside
 * the component, or a layout that only the app's own routes are underneath.
 *
 * The group wins because it fails closed. A string test is a list that a new
 * route can be forgotten from, and the failure is silent — a specimen page
 * quietly grows a nav that its screenshots then encode as correct. Under the
 * group, a route renders the shell if and only if its file sits in this
 * directory, which is a fact about the tree rather than a claim in a string.
 *
 * `loading.tsx` moved in here with the pages, which is a small correction it was
 * owed anyway: it is `/`'s skeleton, and at `app/loading.tsx` it was also the
 * loading UI for `/login` and every specimen.
 *
 * ## The height, which used to belong to `<main>`
 *
 * Every screen in this group was `min-h-dvh` on its own `<main>`. That cannot
 * survive a shell below it: main fills the viewport, the shell is appended
 * underneath, and every page is taller than the screen by the shell's height
 * before it has any content at all. So the constraint moves here and the pages
 * become `flex-1` — they fill what is left rather than claiming the whole thing.
 *
 * `min-h-dvh` and not `min-h-screen`, for the reason `right-now.tsx` used to
 * carry: `100vh` on mobile Safari is the viewport with the browser chrome
 * retracted, so a bar pushed to the bottom of it hides under the toolbar until
 * the user scrolls. The dynamic unit is the one that keeps the primary action
 * reachable, and that argument now lives with the class that acts on it.
 * `/login` keeps its own `min-h-screen` and is outside this group.
 *
 * ## The shell is `<main>`'s sibling, and the bars clear it by its own height
 *
 * `/`'s action bar and `/training`'s are `sticky` inside `<main>` below 1024px —
 * FUEL-72 releases them above it, and everything in this section is about the
 * widths where they are still pinned — and the shell is main's SIBLING rather
 * than its child. That sibling relationship was once the whole resolution to the
 * collision between them: a sticky box is clamped to its own parent, so a bar at
 * `bottom: 0` could only reach main's bottom edge, which was exactly where the
 * shell began.
 *
 * FUEL-65 pinned the shell to the viewport below `lg`, which ends that: a shell
 * that floats up over the page reaches the strip the bars occupy. The sibling
 * relationship still matters — it is what keeps the shell out of main's own
 * scroll and clip context — but the collision is now resolved by the bars
 * sticking to `--nav-shell-h` instead of to 0. That variable is the shell's
 * height, declared once in globals.css; `nav-shell.tsx` carries the reasoning
 * and `/dev/nav-shell` asserts the number against the rendered shell.
 *
 * That is also why `flex-1` is not optional. The shell's own `mt-auto` would
 * push it to the bottom of a short page either way, but a content-sized `<main>`
 * ends above the fold, and the bar clamped to it ends there too — detached from
 * the bottom third, floating in the middle of the screen with a gap beneath.
 *
 * `flex-1` is the one line in this section that outlived the pinning. FUEL-72's
 * desktop bar is `static` and lands wherever `mt-auto` puts it, which is the
 * foot of THIS box — so a content-sized `<main>` would strand it mid-screen at
 * 1920 exactly as it once did at 375, with no thumb-reach argument left to
 * explain what went wrong. The bar stopped needing a bottom to stick to; it did
 * not stop needing a bottom.
 *
 * ## Desktop: the same nav, reordered rather than re-rendered
 *
 * At ≥1024px `NavShell` reflows from a centred pill into a column and this
 * wrapper becomes the frame, which gives it a left edge to sit against. The
 * shell stays LAST in the DOM at every width — it is placed in the frame's first
 * column rather than moved there by source order — so the reading order is
 * content-then-navigation on the phone and on the desktop alike. A landmark that
 * a screen reader meets in a different place depending on the window width is
 * the kind of inconsistency § Navigation exists to remove, and there is nothing
 * above the content to skip past to reach it.
 *
 * That argument is about the shell and it still holds; it was once written here
 * as "no skip link is owed", which was too broad. FUEL-61 found the part it does
 * not cover: the ROOT layout renders a demo banner and a walk reminder above
 * `children`, both carrying focusables, so there is chrome to bypass on this
 * group's pages even though none of it is the nav. The skip link lives in
 * `app/layout.tsx` — above those two, which is the only position that makes it
 * the first focusable element — and it targets the `<main>` that `PageMain`
 * renders here. Nothing about it changes the shell's place in the DOM.
 *
 * `self-start` before `sticky`: an item in a row stretches to its container's
 * full height by default — a flex item did and a grid item does — and an element
 * as tall as its container has no room to stick, so it would scroll away with
 * the page. `self-start` gives it its natural height back, and `top-0` then
 * holds it while a long screen moves past.
 *
 * ## The frame, which is where the row went — FUEL-70
 *
 * The row is now a three-column grid: the rail, the measure, and what is left.
 * § Desktop's whole argument for it is that the two notice bands the ROOT layout
 * renders above `children` have to land on the measure's centre, and they cannot
 * be moved into this file to do it — `skip-link.tsx` requires them to stay above
 * `children`, and above the skip link nothing is focusable. So they read the
 * same template from `globals.css` and take the same column index instead. The
 * classes are in `lib/frame.ts`; the measurements and the diagram are in
 * globals.css beside the declaration.
 *
 * Three things this replaced rather than dropped:
 *
 *   - **`lg:order-first`.** The shell now says `lg:col-start-1`. The DOM order
 *     it was written to protect is unchanged and the paragraph above still
 *     describes it; what changed is that the position is stated rather than
 *     produced by shuffling siblings.
 *   - **`lg:w-[220px] lg:shrink-0`.** The rail's width is the frame's first
 *     track, so the sidebar is 220px because the frame says so. That is the
 *     point — a sidebar that declared its own width is a second declaration of
 *     the number the bands have to agree with.
 *   - **`lg:gap-7`.** The 28px between rail and content is the frame's gutter,
 *     which is § Spacing's ≥768px gutter doing the same job between columns.
 *     § Desktop: "the 544px void becomes the 28px gutter".
 *
 * ## The pages carry `min-w-0`, and it is not decoration
 *
 * Making `<main>` a flex item gave it `min-width: auto`, which refuses to
 * shrink below the intrinsic width of its content. `/plan`'s week grid is a
 * 1023px table, so at 1024px — the exact width the sidebar appears at — main
 * stayed 1024px wide beside a 220px sidebar and pushed 248px off the right of
 * the screen. Measured, not guessed: 1024 → 776 with `min-w-0`, which is the
 * space actually left.
 *
 * The grid was never the problem; it already scrolls inside its own
 * `overflow-x-auto` box, and does so again once main can shrink to contain it.
 * Anything that removes `min-w-0` as redundant re-breaks `/plan` at exactly one
 * breakpoint and nowhere else.
 *
 * A CSS grid does not retire that. `min-width: auto` is a property of the item
 * in both layout modes, and a fixed track does not grow to fit an item that
 * refuses to shrink — it overflows the track instead, which at 1024px is the
 * same 248px off the same edge.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${FRAME} flex min-h-dvh flex-col`}>
      {/*
       * Renders nothing. It moves focus into the new screen's `<main>` on a
       * navigation between destinations, and deliberately not on the `?date=`
       * and `?week=` steps that stay on one screen — see route-focus.tsx, which
       * carries the measurement that showed Next does not do this on its own.
       */}
      <RouteFocus />

      {children}

      <NavShellMount
        className={
          // The rail is the frame's first column, and its 220px is declared
          // there — `/dev/nav-shell` capped its sidebar specimens at the same
          // number, where it is described as "a sidebar's width": wide enough
          // for the longest label beside its mark, narrow enough that the active
          // item's full-width fill reads as a row rather than a banner.
          //
          // `pl-7` matches the 28px gutter every page takes at `md:` and above,
          // so the sidebar's items line up with the content's left edge the way
          // the measure's own padding lines its text up; `py-8` is `/plan`,
          // `/settings` and `/plan/template`'s own top padding.
          `${FRAME_RAIL} lg:sticky lg:top-0 lg:self-start lg:py-8 lg:pl-7`
        }
      />
    </div>
  );
}
