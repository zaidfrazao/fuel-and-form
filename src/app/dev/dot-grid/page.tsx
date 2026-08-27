import type { Metadata } from "next";

import { type Day, DotGrid, type Week } from "@/components/dot-grid";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The dot grid specimen. Two of its acceptance criteria — the 11px dot on its
 * 9px gutter, and that status survives greyscale — are claims about pixels and
 * colour that jsdom cannot evaluate, so this is the surface they are checked on,
 * alongside the Testing Strategy's manual Appearance checklist.
 *
 * The first fixture is the one `docs/BRAND_GUIDE.html` renders, so the two can
 * be opened side by side and diffed by eye. The two that follow are the ones the
 * mock cannot show and which the greyscale criterion actually turns on.
 *
 * Not a product screen. Delete it once Training covers the same ground, as with
 * /dev/tokens and /dev/day-ruler.
 */
export const metadata: Metadata = {
  title: "Dot grid",
  robots: { index: false, follow: false },
};

type Status = Day["status"];

/** 2026-07-06 is a Monday, so the first fixture week starts clean. */
const FIRST_MONDAY = Date.UTC(2026, 6, 6);
const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (at: number) => new Date(at).toISOString().slice(0, 10);

function build(pattern: Status[][], from = FIRST_MONDAY): Week[] {
  return pattern.map((week, index) =>
    week.map((status, offset) => ({
      date: iso(from + (index * 7 + offset) * DAY_MS),
      status,
    })),
  );
}

/**
 * The pattern BRAND_GUIDE.html renders — five full weeks, then a sixth cut short
 * at today. Invented data: the repository is public and the owner's real training
 * is confined to docs/, per Testing Strategy § 1.5.
 */
const PATTERN: Status[][] = [
  ["done", "done", "skipped", "done", "done", "walk", "walk"],
  ["done", "done", "done", "done", "done", "walk", "walk"],
  ["done", "skipped", "done", "done", "done", "walk", "walk"],
  ["done", "done", "done", "done", "skipped", "walk", "walk"],
  ["done", "done", "done", "done", "done", "walk", "walk"],
  ["done", "done", "done", "none", "none", "none", "none"],
];

/** The Wednesday of the final week — the dot the mock draws in umber. */
const TODAY = iso(FIRST_MONDAY + 37 * DAY_MS);

const withToday = (status: Status): Status[][] =>
  PATTERN.map((week, index) =>
    index === 5 ? week.map((day, offset) => (offset === 2 ? status : day)) : week,
  );

const CASES: { label: string; note: string; weeks: Week[]; today?: string }[] = [
  {
    label: "The mock",
    note: "The fixture BRAND_GUIDE.html renders. Open both and compare.",
    weeks: build(PATTERN),
    today: TODAY,
  },
  {
    label: "Today skipped",
    note: "An accent ring, not an accent disc. The state the mock cannot show — desaturate this and the row above; both must still read.",
    weeks: build(withToday("skipped")),
    today: TODAY,
  },
  {
    label: "Done, partial, skipped, side by side",
    note: "FUEL-27's addition, and the case the greyscale rule now turns on. Three outcomes, three renderings, one weight — desaturate and all three must still be told apart.",
    weeks: build([["done", "partial", "skipped", "partial", "done", "walk", "none"]], Date.UTC(2026, 7, 10)),
  },
  {
    label: "Today partial",
    note: "The accent takes the fill and the geometry is unchanged — an 11px disc, exactly as a done today is. The status is carried by the table beside it, not by the tone.",
    weeks: build(withToday("partial")),
    today: TODAY,
  },
  {
    label: "Today walk-only",
    note: "Still 4px, still small. Today changes the tone, never the geometry.",
    weeks: build(withToday("walk")),
    today: TODAY,
  },
  {
    label: "A week that starts mid-week",
    note: "Placed by date, not by position — the first three columns stay empty rather than shifting the week left.",
    weeks: build([["done", "skipped", "walk", "done"]], Date.UTC(2026, 7, 13)),
    today: "2026-08-14",
  },
  {
    label: "Every session skipped",
    note: "Rendered at the same weight as a completed block. Data, not guilt.",
    weeks: build(PATTERN.map((week) => week.map(() => "skipped" as Status))),
    today: TODAY,
  },
  {
    label: "Nothing but walks",
    note: "A whole grid of 4px dots. The rows must keep their 11px rhythm, not collapse onto each other.",
    weeks: build(PATTERN.map((week) => week.map(() => "walk" as Status))),
  },
  {
    label: "No today",
    note: "A past six weeks under review. No umber anywhere on the screen.",
    weeks: build(PATTERN),
  },
  {
    label: "No weeks",
    note: "Empty state. The header still says what will appear; it does not nudge.",
    weeks: [],
  },
];

export default function DotGridSpecimen() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10 md:px-7">
      <header className="flex flex-col gap-[14px]">
        <h1 className="text-title">Dot grid</h1>
        <p className="text-body text-text-secondary">
          Brand Guide § Signature Graphics, rendered. Narrow to 375px, switch
          modes, and check it in greyscale — status is carried by solid, ring and
          size, so nothing should be lost. The three &ldquo;today&rdquo; fixtures
          are the ones that prove it. Zoom to 200% too: the page must not scroll
          sideways.
        </p>
        <ThemeToggle />
      </header>

      <ul className="flex flex-col gap-[30px]">
        {CASES.map(({ label, note, weeks, today }) => (
          <li key={label} className="flex flex-col gap-[14px]">
            <span className="flex flex-col gap-1">
              <span className="text-micro text-text-tertiary uppercase">
                {label}
              </span>
              <span className="text-slash text-text-secondary">/ {note}</span>
            </span>
            {/* Boxed at the phone's content width, and without an
                `overflow-hidden` that would clip today's 3px halo. */}
            <div className="w-full max-w-[331px] rounded-lg border border-border px-4 py-5">
              <DotGrid weeks={weeks} today={today} />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
