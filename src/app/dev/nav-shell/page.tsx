import type { Metadata } from "next";

import { NavShell } from "@/components/nav-shell";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The navigation shell — Brand Guide § Navigation, rendered.
 *
 * Most of what FUEL-57 promises is a claim about pixels that jsdom cannot
 * evaluate: the 46×40 inactive box, the 1px border and 4px padding, the sidebar
 * appearing at 1024px, and the one the task called out as needing resolving
 * rather than discovering — that the pill does not overlap `/`'s sticky action
 * bar. `nav-shell.test.tsx` takes the accessibility contract and leaves those
 * here, the same division `dot-grid` uses.
 *
 * The last section WAS the load-bearing one, and is now the only part of this
 * page that history has overtaken. It is the arrangement FUEL-58 had to build,
 * at 375×667, with a real scroll container and a real `sticky bottom-0` bar
 * copied from `right-now.tsx` — and FUEL-58 built it, so the real `/` is now
 * the honest specimen for that claim. It measured 0px overlap there too.
 *
 * Not a product screen, and FUEL-58 considered deleting it as this header
 * asked. Kept, for the reason /dev/tokens and /dev/day-ruler were kept: the
 * mounted shell shows ONE route state at a time, and the grid above shows all
 * eight side by side — including `/dev/nav-shell` itself lighting nothing,
 * which is the case that proves a route outside the hierarchy resolves to null
 * rather than to a neighbour. No mounted screen can show that.
 */
export const metadata: Metadata = {
  title: "Navigation shell",
  robots: { index: false, follow: false },
};

/**
 * Every state the shell has, which is every route it can be asked about plus the
 * one that is none of them.
 *
 * `/dev/nav-shell` is in the list because it is where this page lives: the
 * specimen renders its own route and lights nothing, which is what § Navigation
 * says should happen — `/dev/*` sits outside the hierarchy rather than at level
 * 1 of it.
 */
const CASES: { pathname: string; note: string }[] = [
  {
    pathname: "/",
    note: "Level 1. Now — the first slot, and the app's default.",
  },
  {
    pathname: "/plan",
    note: "Level 1. The widest label, so the widest active pill.",
  },
  {
    pathname: "/training",
    note: "Level 1. The one mark the mock does not carry — drawn for FUEL-56's fourth destination, which replaced More.",
  },
  { pathname: "/weight", note: "Level 1. The narrowest label." },
  {
    pathname: "/shopping",
    note: "Level 2 → Plan. A flat URL whose first segment is not a destination: the case that defeats prefix matching.",
  },
  {
    pathname: "/plan/template",
    note: "Level 2 → Plan. Nested URL, same parent, same lit slot.",
  },
  {
    pathname: "/settings",
    note: "Level 2 → Now. Parented to the root, and the sidebar foot below still does not claim to be current.",
  },
  {
    pathname: "/dev/nav-shell",
    note: "Outside the hierarchy. Four inactive items, nothing lit — this page's own route.",
  },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[14px]">
      <span className="flex flex-col gap-1">
        <span className="text-micro text-text-tertiary uppercase">{title}</span>
        <span className="text-slash text-text-secondary">/ {note}</span>
      </span>
      {children}
    </section>
  );
}

export default function NavShellSpecimen() {
  return (
    <main className="mx-auto flex max-w-[860px] flex-col gap-[42px] px-[22px] py-10 md:px-7">
      <header className="flex flex-col gap-[14px]">
        <h1 className="text-title">Navigation shell</h1>
        <p className="text-body text-text-secondary">
          Brand Guide § Navigation, rendered. Narrow below 1024px for the pill
          and widen past it for the sidebar — the same component reflows, so
          both cannot be on screen at once. Check the inactive item measures
          46×40, the border is one hairline, and the active fill is{" "}
          <code>ink</code> in both modes. Tab through it: every item takes a 2px
          accent ring at 2px offset, and the DOM order is the order you see.
          Zoom to 200% — the labels are in <code>rem</code> and the page must
          not scroll sideways. Inactive items are <code>text-secondary</code>{" "}
          rather than the mock&rsquo;s <code>text-3</code>, which measured
          2.19:1 light and 2.72:1 dark and missed § Accessibility&rsquo;s bar in
          both — sample one against the canvas if the palette ever moves.
        </p>
        <ThemeToggle />
      </header>

      <Section
        title="Every state"
        note="One shell per route. Below 1024px these are pills; above it they are sidebars, and the Settings foot appears."
      >
        <ul className="flex flex-col gap-[26px]">
          {CASES.map(({ pathname, note }) => (
            <li key={pathname} className="flex flex-col gap-[10px]">
              <span className="flex flex-col gap-1">
                <span className="text-slash text-text-primary">{pathname}</span>
                <span className="text-slash text-text-tertiary">{note}</span>
              </span>
              {/*
               * Boxed so each shell has an edge to be measured against, and
               * without the page's own background so the `ink` fill is judged on
               * the surface it will actually sit on.
               */}
              {/*
               * Capped at a sidebar's width above 1024px. Left to fill the page
               * the column would render 770px wide, which is not a sidebar and
               * would make its full-width active fill look like a mistake.
               */}
              <div className="rounded-lg border border-border px-4 py-2 lg:max-w-[220px]">
                {/*
                 * `mt-auto` and the bottom inset are the shell's own, and both
                 * are meaningless in a box that is not a page column — the inset
                 * is stripped here so these read at their true height. The
                 * arrangement that keeps them is the last section.
                 */}
                <NavShell pathname={pathname} className="mt-0 pb-0" />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="The touch target"
        note="§ Navigation fixes the inactive item at 46×40 and § Touch Targets sets a 44×44 minimum, so the height is 4px short. The box stays 40px and the hit area extends 2px above and below it, into the pill's own 4px padding."
      >
        {/*
         * The overlay is invisible by design, so the only way to check it is to
         * point at the 2px band just inside the pill's border and confirm the
         * cursor still reads as a link. Outlining every `::after` in devtools is
         * the other way.
         */}
        <div className="rounded-lg border border-border px-4 py-2 lg:max-w-[220px]">
          <NavShell pathname="/" className="mt-0 pb-0" />
        </div>
      </Section>

      <Section
        title="The collision, at 375×667"
        note="`/`'s sticky action bar and the shell both want the bottom of the screen. Scroll this frame to the end: the bar stops where <main> does, and the shell sits below it."
      >
        {/*
         * The arrangement FUEL-58 has to build, not a drawing of it.
         *
         * The frame is a scroll container at the phone's viewport size. Inside
         * it, the page column is `min-h-full flex flex-col`; `<main>` is
         * `flex-1` and holds the sticky bar; the shell is main's SIBLING, after
         * it. That sibling relationship is the whole resolution: a `sticky
         * bottom-0` element is clamped to its own parent's box, so once the bar
         * lives inside `<main>` it can only reach main's bottom edge — which is
         * where the shell begins. Nothing overlaps, and the bar keeps the
         * reach-friendly placement `right-now.tsx:396` argues for.
         *
         * Put the shell INSIDE `<main>` instead and the bar floats over it, which
         * is the failure this section exists to make visible.
         *
         * The bar below is copied from `right-now.tsx:437` with its own bottom
         * inset removed — FUEL-58 moves that inset onto the shell, and the
         * comment at `right-now.tsx:403` explaining why it lives on the bar has
         * to be rewritten when it does.
         */}
        {/*
         * Breaking out of the page's own 22px gutters, so the frame is genuinely
         * 375px wide and not the 331 that is left after them. The collision is
         * vertical and would resolve the same either way, but the criterion
         * names 375×667 and a specimen that quietly tests something else is how
         * a number stops meaning anything.
         */}
        <div className="-mx-[22px] flex justify-center md:mx-0">
          <div className="h-[667px] w-[375px] shrink-0 overflow-y-auto rounded-lg border border-border">
            <div className="flex min-h-full flex-col">
              <main className="flex flex-1 flex-col gap-[30px] px-[22px] pt-[22px]">
                <h2 className="text-title">Now</h2>
                {/* Enough to overflow 667px, so the sticky behaviour is real
                    rather than a bar that happens to sit at the bottom. */}
                {Array.from({ length: 8 }, (_, index) => (
                  <p key={index} className="text-body text-text-secondary">
                    Filler, so the frame scrolls. The bar below is sticky, so it
                    stays in reach while this moves past it.
                  </p>
                ))}

                <div className="sticky bottom-0 mt-auto flex flex-col gap-3 bg-background pt-[30px]">
                  <span className="flex h-12 items-center justify-center rounded-md bg-ink text-body font-medium text-ink-fg">
                    Log eaten
                  </span>
                  <span className="flex h-12 items-center justify-center rounded-md border border-border text-body font-medium text-text-primary">
                    Swap
                  </span>
                </div>
              </main>

              <NavShell pathname="/" />
            </div>
          </div>
        </div>
      </Section>
    </main>
  );
}
