import { KeyValueGrid, type KeyValueItem, SlashMeta } from "@/components/kv-grid";
import { figure } from "@/lib/format";
import { dayLabel } from "@/lib/now-display";
import type { WeekFigures } from "@/lib/week-totals";

/**
 * The week's daily figures and its average, under the grid (FUEL-33).
 *
 * ## A key/value grid, not a chart
 *
 * Seven days of two figures is exactly the shape § Key/Value Grid describes —
 * "micro label above, Value below, optional Slash metadata beneath", three
 * columns "when the figures are short", and these are four characters. A chart
 * would spend the width on an axis in order to say less precisely what eight
 * numbers say exactly, and the reader's question here is "what does Thursday
 * come to", which a bar answers only by being measured against a scale.
 *
 * Eight items over three columns lands 3/3/2, which puts the average in the
 * last cell of the last row. That is where a summary belongs — it reads after
 * the days it summarises rather than before them.
 *
 * ## What it became on a phone, without changing
 *
 * FUEL-81 turned the week ninety degrees below 768px, and this block did not
 * move: it was never inside the grid's scroller, so its width budget is the
 * same three ~110px columns it always had at 375px.
 *
 * Its JOB changed, though. Stacked, the grid can no longer be read across days
 * — comparing Tuesday against Thursday means scrolling — and § The Week, Two
 * Ways names that as the trade the phone shape makes. This is where the trade
 * is partly repaid: seven days of kcal and protein, side by side, in one glance.
 * It is the only cross-day comparison left on a phone, which is an argument for
 * keeping it exactly as it is rather than folding it into the day sections.
 *
 * ## No umber here
 *
 * Today's column in the table above takes the screen's one accent (§ The Four
 * Rules), and this block does not get a second one however naturally the eye
 * would look for today in it. `week-grid.test.tsx` counts the accents on the
 * screen rather than spot-checking them, so this is enforced rather than
 * merely intended.
 *
 * ## Why the units are hidden and the header carries them
 *
 * The value is a bare figure because a date is already in the label: "2,140
 * kcal" at 22px does not fit a third of a 375px screen, and wrapping the unit
 * onto its own line would read as another number. The header names the two
 * figures once for the eye, and each value carries its unit in `sr-only` text
 * for a reader who arrives at a single `dd` with the header long behind them.
 */

/**
 * An unplanned day is a dash, not a zero.
 *
 * `0` is a claim — that the day is planned and comes to nothing. An em dash is
 * the absence of a claim, which is the true state of a day before the program
 * starts or one the template does not cover. § Materials makes the same
 * argument for the hatch on an empty cell.
 */
const NOTHING = "—";

function dayItem(day: WeekFigures["days"][number]): KeyValueItem {
  if (!day.planned) {
    return {
      label: dayLabel(day.date),
      value: (
        <>
          <span aria-hidden="true">{NOTHING}</span>
          <span className="sr-only">Not planned</span>
        </>
      ),
    };
  }

  return {
    label: dayLabel(day.date),
    value: (
      <>
        {figure(day.totals.kcal)}
        <span className="sr-only"> kcal</span>
      </>
    ),
    meta: (
      <>
        {figure(day.totals.proteinG)} g<span className="sr-only"> protein</span>
      </>
    ),
  };
}

export function WeekTotals({ figures }: { figures: WeekFigures }) {
  const items: KeyValueItem[] = figures.days.map(dayItem);

  // Suppressed rather than dashed when there is nothing to average: a row of
  // seven dashes has already said the week is empty, and an eighth would be
  // the block insisting on it.
  if (figures.average) {
    items.push({
      label: "Average",
      emphasis: true,
      value: (
        <>
          {figure(figures.average.kcal)}
          <span className="sr-only"> kcal</span>
        </>
      ),
      meta: (
        <>
          {figure(figures.average.proteinG)} g<span className="sr-only"> protein</span>
          {/* The middle dot is a separator for the eye and punctuation to a
              screen reader, which reads it aloud as "dot" — noise in the one
              place the block is trying to be explicit. Hidden, and the join it
              stands for said in words instead. `SlashMeta` hides its own "/"
              for the same reason. */}
          <span aria-hidden="true"> · </span>
          <span className="sr-only"> over </span>
          {figures.plannedDays} {figures.plannedDays === 1 ? "day" : "days"}
        </>
      ),
    });
  }

  return (
    <section aria-labelledby="week-totals" className="flex flex-col gap-[14px]">
      <header className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="week-totals" className="text-micro uppercase text-text-secondary">
          Daily totals
        </h2>
        {/* The units, once, for the eye — every value below is a bare figure. */}
        <SlashMeta>kcal, then protein</SlashMeta>
      </header>
      <KeyValueGrid items={items} columns={3} className="tabular-nums" />
    </section>
  );
}
