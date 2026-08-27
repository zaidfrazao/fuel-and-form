import type { Metadata } from "next";

import { ThemeToggle } from "@/components/theme-toggle";
import { WeightChart } from "@/components/weight-chart";
import { addDays } from "@/lib/date";
import type { Reading } from "@/lib/weight-chart";

/**
 * The weight chart specimen — FUEL-35.
 *
 * Three of its acceptance criteria are claims jsdom cannot evaluate. "Legible
 * at 375px" is a claim about pixels, "the single umber mark" is a claim about
 * colour, and the draw-in's suppression under `prefers-reduced-motion` is a
 * claim about a media query — so this is the surface they are checked on,
 * alongside the Testing Strategy § 2.2 manual checklist. Everything structural
 * is in `weight-chart.test.tsx`; nothing here duplicates it.
 *
 * The fixtures after the first are the ones the product screen cannot show on
 * demand: an empty history, a single reading, a flat line, a history sitting on
 * its target, and a decade of it. Four of those are the arithmetic that would
 * otherwise divide by zero, which is the whole reason `lib/weight-chart.ts`
 * exists as its own module.
 *
 * Not a product screen. Delete it once `/weight` covers the same ground, as with
 * /dev/tokens, /dev/day-ruler and /dev/dot-grid.
 */
export const metadata: Metadata = {
  title: "Weight chart",
  robots: { index: false, follow: false },
};

/**
 * Invented figures throughout — the repository is public and the owner's real
 * weight lives in the database, per Testing Strategy § 1.5. The persona is the
 * PRD's: starting at 84.2kg, heading for 76.
 */
const START_KG = 84.2;
const TARGET_KG = 76;

const TODAY = "2026-08-20";

/** Weekly readings back from a Monday, so the fixtures land on real weigh-in days. */
function weekly(weights: number[], from = "2026-08-17"): Reading[] {
  return weights.map((weightKg, index) => ({
    date: addDays(from, -7 * (weights.length - 1 - index)),
    weightKg,
  }));
}

const CASES: {
  label: string;
  note: string;
  entries: Reading[];
  /**
   * Only the on-target fixture moves the references, and it moves both — that
   * case is defined by the readings, the start and the target being one number.
   * Every other fixture keeps the persona's, which is also what stops this file
   * accumulating body metrics that `check:metrics` would then have to be taught
   * to ignore.
   */
  startWeightKg?: number;
  targetWeightKg?: number;
}[] = [
  {
    label: "Twelve weeks",
    note: "The ordinary case, and the one the demo persona renders. Narrow to 375px: the trend, both reference labels and the two date labels must all still be readable.",
    entries: weekly([84.2, 83.6, 83.1, 82.4, 82.6, 81.9, 81.6, 81.2, 80.9, 80.4, 80.1, 79.6]),
  },
  {
    label: "One reading",
    note: "P5's single-data-point state. The mark sits at the centre, not the right edge — with one reading it is both the first and the latest, and pinning it right would imply a history running off the left. There is no trend line and no date axis.",
    entries: weekly([80.1]),
  },
  {
    label: "No readings",
    note: "P5's empty state. Nothing renders at all — § UI Copy Examples already says “Your first entry starts the chart”, and /weight prints that sentence above this. An empty ruled plate would contradict it.",
    entries: [],
  },
  {
    label: "A flat fortnight",
    note: "Every reading identical. The vertical span across the data is zero; the domain still has a height, and the line sits mid-plate rather than on the floor.",
    entries: weekly([80, 80, 80]),
  },
  {
    label: "Flat, and exactly on target",
    note: "The readings, the start and the target are all one number, so widening the domain to the references does not rescue it. Maintenance on the day the goal is met — the least likely day for the chart to be allowed to break.",
    entries: weekly([76, 76, 76]),
    startWeightKg: 76,
    targetWeightKg: 76,
  },
  {
    label: "Above the starting weight",
    note: "The domain follows the data rather than assuming the start is the ceiling. The summary reads “Up”, not a negative loss.",
    entries: weekly([84.2, 85.1, 86.5]),
  },
  {
    label: "A missed month",
    note: "Time-proportional, so the gap is drawn as the gap it was. An index axis would space these evenly and imply a regularity the data does not have.",
    entries: [
      { date: "2026-06-01", weightKg: 83.4 },
      { date: "2026-06-08", weightKg: 82.9 },
      { date: "2026-07-13", weightKg: 81.1 },
      { date: "2026-08-17", weightKg: 80.1 },
    ],
  },
  {
    label: "A decade, and a very wide range",
    note: "The gridline step climbs so the plate does not fill with rules. Check the count here against the twelve-week fixture: similar furniture, wildly different ranges. The start line sits inside the data rather than above it, which is the other thing to look at.",
    entries: [
      { date: "2016-08-17", weightKg: 120 },
      { date: "2019-08-17", weightKg: 104.5 },
      { date: "2022-08-17", weightKg: 91.2 },
      { date: "2026-08-17", weightKg: 70 },
    ],
  },
  {
    label: "A reading from another year",
    note: "The date axis carries the year when it differs from today's — the history has no window, so two labels could otherwise read the same August.",
    entries: [
      { date: "2024-08-19", weightKg: 91.4 },
      { date: "2025-08-18", weightKg: 87.2 },
      { date: "2026-08-17", weightKg: 80.1 },
    ],
  },
];

export default function WeightChartSpecimen() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10 md:px-7">
      <header className="flex flex-col gap-[14px]">
        <h1 className="text-title">Weight chart</h1>
        <p className="text-body text-text-secondary">
          FUEL-35, rendered. Narrow to 375px and check every label is still
          readable. Switch modes, then desaturate: the trend, the two dashed
          references and the gridlines are told apart by weight and by their
          labels, so nothing should be lost — the umber mark is the one thing
          that changes, and it is the one thing that is also the last point on
          the line. Zoom to 200%: the page must not scroll sideways.
        </p>
        <p className="text-body text-text-secondary">
          The draw-in runs once per mount, so reload to see it again. Turn on
          Reduce Motion in the OS and reload: the line must appear whole and the
          umber mark must be visible — dropped, not merely shortened, and not
          left half-drawn.
        </p>
        <ThemeToggle />
      </header>

      <ul className="flex flex-col gap-[30px]">
        {CASES.map(({ label, note, entries, startWeightKg, targetWeightKg }) => (
          <li key={label} className="flex flex-col gap-[14px]">
            <span className="flex flex-col gap-1">
              <span className="text-micro text-text-tertiary uppercase">{label}</span>
              <span className="text-slash text-text-secondary">/ {note}</span>
            </span>
            {/* Boxed at the phone's content width — 375px less § Spacing &
                Layout's 22px gutters — so the specimen is measured at the width
                the criterion names rather than at the desktop column's. */}
            <div className="w-full max-w-[331px]">
              <WeightChart
                entries={entries}
                today={TODAY}
                startWeightKg={startWeightKg ?? START_KG}
                targetWeightKg={targetWeightKg ?? TARGET_KG}
              />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
