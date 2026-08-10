import type { Metadata } from "next";

import { DayRuler, type Slot, parseClock } from "@/components/day-ruler";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The day ruler specimen. Two of its acceptance criteria — that it fits within
 * roughly 40px at 375px, and that it survives greyscale — are claims about
 * layout and colour that jsdom cannot evaluate, so this is the surface they are
 * checked on, alongside the Testing Strategy's manual Appearance checklist.
 *
 * The first fixture is the one `docs/BRAND_GUIDE.html` renders, so the two can
 * be opened side by side and diffed by eye. The rest are the states the mock
 * never shows and which would otherwise ship unlooked-at.
 *
 * Not a product screen. Delete it once the Right Now view covers the same
 * ground, as with /dev/tokens.
 */
export const metadata: Metadata = {
  title: "Day ruler",
  robots: { index: false, follow: false },
};

/**
 * The PRD's proposed default slot windows. Invented statuses — the repository is
 * public and the owner's real day is confined to docs/, per Testing Strategy
 * § 1.5.
 */
const DAY: Slot[] = [
  { id: "coffee", label: "Coffee + MCT oil", minutes: parseClock("06:00"), status: "logged" },
  { id: "breakfast", label: "Breakfast", minutes: parseClock("07:00"), status: "logged" },
  { id: "snack-1", label: "Snack 1", minutes: parseClock("10:30"), status: "logged" },
  { id: "lunch", label: "Lunch", minutes: parseClock("13:00"), status: "logged" },
  { id: "snack-2", label: "Snack 2", minutes: parseClock("16:00"), status: "skipped" },
  { id: "workout", label: "Circuit B", minutes: parseClock("17:30"), status: "logged" },
  { id: "dinner", label: "Dinner", minutes: parseClock("19:00"), status: "upcoming" },
];

const untouched = (slots: Slot[], status: Slot["status"]) =>
  slots.map((slot) => ({ ...slot, status }));

const CASES: { label: string; note: string; slots: Slot[]; now?: number }[] = [
  {
    label: "The mock",
    note: "The fixture BRAND_GUIDE.html renders. Open both and compare.",
    slots: DAY,
    now: parseClock("18:54"),
  },
  {
    label: "Now beside a scale mark",
    note: "The pill and the scale share a row. This is where they collide.",
    slots: DAY,
    now: parseClock("12:05"),
  },
  {
    label: "Now at the span start",
    note: "The marker and the first slot stack, both half outside the ruler.",
    slots: untouched(DAY, "upcoming"),
    now: parseClock("06:00"),
  },
  {
    label: "Now at the span end",
    note: "The pill stops at the edge rather than running off it, and covers 22.",
    slots: untouched(DAY, "logged"),
    now: parseClock("22:00"),
  },
  {
    label: "No now",
    note: "A past day under review. No accent mark on the screen.",
    slots: untouched(DAY, "logged"),
  },
  {
    label: "Day not started",
    note: "Seven hairlines and nothing else.",
    slots: untouched(DAY, "upcoming"),
    now: parseClock("06:20"),
  },
  {
    label: "Every slot skipped",
    note: "Rendered at the same weight as a logged day. Data, not guilt.",
    slots: untouched(DAY, "skipped"),
    now: parseClock("21:40"),
  },
  {
    label: "No slots",
    note: "Empty state. The scale still answers where the day is.",
    slots: [],
    now: parseClock("14:00"),
  },
];

export default function DayRulerSpecimen() {
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10 md:px-7">
      <header className="flex flex-col gap-[14px]">
        <h1 className="text-title">Day ruler</h1>
        <p className="text-body text-text-secondary">
          Brand Guide § Signature Graphics, rendered. Narrow the window to 375px,
          switch modes, and check it in greyscale — status is carried by fill,
          hatch and hairline, so nothing should be lost. Zoom to 200% too: the
          page must not scroll sideways.
        </p>
        <ThemeToggle />
      </header>

      <ul className="flex flex-col gap-[30px]">
        {CASES.map(({ label, note, slots, now }) => (
          <li key={label} className="flex flex-col gap-[14px]">
            <span className="flex flex-col gap-1">
              <span className="text-micro uppercase text-text-tertiary">
                {label}
              </span>
              <span className="text-slash text-text-secondary">/ {note}</span>
            </span>
            {/* Boxed at the phone's content width so the ~40px budget is being
                read at the size the criterion is written for, not at whatever
                the desktop window happens to be. */}
            <div className="w-full max-w-[331px] rounded-lg border border-border px-4 py-5">
              <DayRuler slots={slots} now={now} />
            </div>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-[14px]">
        <h2 className="text-micro uppercase text-text-secondary">Custom span</h2>
        <p className="text-slash text-text-secondary">
          / 08:00–20:00. The scale marks derive from the span, so they read 08 ·
          14 · 20 — nothing about 06 · 12 · 18 · 22 is hardcoded.
        </p>
        <div className="w-full max-w-[331px] rounded-lg border border-border px-4 py-5">
          <DayRuler
            slots={DAY}
            now={parseClock("18:54")}
            span={{ start: parseClock("08:00"), end: parseClock("20:00") }}
          />
        </div>
      </section>
    </main>
  );
}
