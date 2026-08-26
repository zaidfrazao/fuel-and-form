import { NavShellMount } from "@/components/nav-shell-mount";

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
 * ## The shell is `<main>`'s sibling, and that resolves the collision
 *
 * `/`'s action bar and `/training`'s are `sticky bottom-0` inside `<main>`. A
 * sticky box is clamped to its own parent, so with the shell as main's SIBLING
 * the bar can only reach main's bottom edge — which is exactly where the shell
 * begins. Nothing overlaps and the bar keeps the reach-friendly placement
 * § Touch Targets asks for. Put the shell INSIDE `<main>` and the bar floats
 * over it instead. `/dev/nav-shell` measured this arrangement at 375×667 before
 * it was built here: 0px overlap, not 1.
 *
 * That is also why `flex-1` is not optional. The shell's own `mt-auto` would
 * push it to the bottom of a short page either way, but a content-sized `<main>`
 * ends above the fold, and the bar clamped to it ends there too — detached from
 * the bottom third, floating in the middle of the screen with a gap beneath.
 *
 * ## Desktop: the same nav, reordered rather than re-rendered
 *
 * At ≥1024px `NavShell` reflows from a centred pill into a column, and the
 * wrapper becomes a row to give it a left edge to sit against. The shell stays
 * LAST in the DOM at every width and is moved with `lg:order-first`, so the
 * reading order is content-then-navigation on the phone and on the desktop
 * alike. A landmark that a screen reader meets in a different place depending on
 * the window width is the kind of inconsistency § Navigation exists to remove,
 * and there is nothing above the content to skip past, so no skip link is owed.
 *
 * `self-start` before `sticky`: a flex item in a row stretches to its
 * container's full height by default, and an element as tall as its container
 * has no room to stick — it would scroll away with the page. `self-start` gives
 * it its natural height back, and `top-0` then holds it while a long screen
 * moves past.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row lg:gap-7">
      {children}

      <NavShellMount
        className={
          // 220px is the width `/dev/nav-shell` capped its sidebar specimens at,
          // where it is described as "a sidebar's width" — wide enough for the
          // longest label beside its mark, narrow enough that the active item's
          // full-width fill reads as a row rather than a banner.
          //
          // `pl-7` matches the 28px gutter every page takes at `md:` and above,
          // so the sidebar's left edge lines up with the content's; `py-8` is
          // `/plan`, `/settings` and `/plan/template`'s own top padding.
          "lg:sticky lg:top-0 lg:order-first lg:w-[220px] lg:shrink-0 lg:self-start lg:py-8 lg:pl-7"
        }
      />
    </div>
  );
}
