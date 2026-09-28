import { figure } from "@/lib/format";
import { dayLabel } from "@/lib/now-display";
import { cn } from "@/lib/utils";
import type { DayFigures, WeekFigures } from "@/lib/week-totals";

/**
 * The week's figures, drawn where they belong — FUEL-33, moved by FUEL-138.
 *
 * ## Why this is no longer one block under the grid
 *
 * FUEL-33 drew the seven days and the average as a three-column key/value grid
 * under the table, and argued it was "the only cross-day comparison left on a
 * phone". FUEL-138 measured what that cost: at 375 the block sat at the foot of
 * a 3,020px page, so Monday's total was ~2,500px from Monday; at ≥768 it was a
 * 3/3/2 grid under a seven-column table, so Monday's figure was not under
 * Monday. PRD § P4's "week view shows daily kcal and protein" was met in the
 * letter and missed in the reading.
 *
 * So the block is split along the line the reader asks the question on. A
 * day's figures go WITH the day — `DayFigure`, drawn in the stacked shape's day
 * heading and in the wide shape's `<tfoot>` — and the week's figure goes above
 * the grid, where a summary of a 3,000px page can be seen without scrolling to
 * the end of it (`WeekAverage`).
 *
 * ## No umber here
 *
 * Today's heading takes the screen's one accent (§ The Four Rules), and nothing
 * here takes a second one however naturally the eye would look for today in
 * it. `week-grid.test.tsx` counts the accents per shape rather than
 * spot-checking them, so this is enforced rather than merely intended.
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

/**
 * One day's kcal and protein, and how many of the week's slots it leaves open.
 *
 * The units are visible here, unlike FUEL-33's bare figures: that block had a
 * header to name them once, and a figure in a day heading or a table foot has
 * no header of its own. A reader arriving at one cell should not have to go
 * and find out which number is which.
 *
 * The open-slot count is words rather than a tint, because § Accessibility
 * does not let a fact live in a hue alone, and it is the reason the day is
 * missing from the average above — so it is said where the day is.
 *
 * `inline` puts it on one line for the stacked shape's heading; otherwise each
 * figure takes its own line, which is what an 87px column at 768 can hold.
 */
export function DayFigure({
  day,
  inline = false,
  className,
}: {
  day: DayFigures;
  inline?: boolean;
  className?: string;
}) {
  if (!day.planned) {
    return (
      <span className={cn("text-slash text-text-tertiary", className)}>
        <span aria-hidden="true">{NOTHING}</span>
        <span className="sr-only">Not planned</span>
      </span>
    );
  }

  const open = day.unplannedSlots > 0 && (
    <span className="text-text-tertiary">
      {day.unplannedSlots} not planned
    </span>
  );

  // The middle dot is a separator for the eye and punctuation to a screen
  // reader, which reads it aloud as "dot". Hidden, and a comma said instead.
  const dot = (
    <>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
    </>
  );

  if (inline) {
    return (
      <span className={cn("text-slash tabular-nums text-text-secondary", className)}>
        <span className="text-text-primary">{figure(day.totals.kcal)} kcal</span>
        {dot}
        {figure(day.totals.proteinG)} g<span className="sr-only"> protein</span>
        {open && (
          <>
            {dot}
            {open}
          </>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex flex-col gap-0.5 text-slash tabular-nums text-text-secondary",
        className,
      )}
    >
      <span className="font-semibold text-text-primary">
        {figure(day.totals.kcal)} kcal
      </span>
      <span>
        {figure(day.totals.proteinG)} g<span className="sr-only"> protein</span>
      </span>
      {open}
    </span>
  );
}

/** "Sat 27 Jun and Sun 28 Jun" — the days the average leaves out, by name. */
const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/**
 * The week's average, and what it is an average OF — FUEL-138.
 *
 * `lib/week-totals.ts` decides the basis: the days that fill every slot the
 * week uses. This says so, in words, every time — the divisor and the days it
 * left out by name — because FUEL-138's first complaint was an average whose
 * basis could only be reverse-engineered, and one that could be read as the
 * plan falling 400 kcal short when it was really two half-planned days.
 *
 * Above the grid rather than after it. FUEL-33 put the summary last, "after
 * the days it summarises", which is a reading order that works on a page one
 * screen tall; at 375 the end of this one is 3,000px down.
 *
 * Nothing at all when the week plans nothing: the grid's hatch has already
 * said the week is empty, and a line insisting on it would be noise.
 */
export function WeekAverage({ figures }: { figures: WeekFigures }) {
  if (!figures.days.some((day) => day.planned)) return null;

  const leftOut = LIST.format(figures.leftOut.map((date) => dayLabel(date)));

  return (
    <section aria-labelledby="week-average" className="flex flex-col gap-[3px]">
      <h2 id="week-average" className="text-micro uppercase text-text-secondary">
        Weekly average
      </h2>

      {figures.average ? (
        <>
          <p className="text-value tabular-nums text-text-primary">
            {figure(figures.average.kcal)}
            <span className="text-slash text-text-secondary"> kcal</span>
            <span aria-hidden="true" className="text-text-tertiary">
              {" · "}
            </span>
            <span className="sr-only">, </span>
            {figure(figures.average.proteinG)}
            <span className="text-slash text-text-secondary"> g protein</span>
          </p>
          <p className="text-slash text-text-secondary">
            Of the {figures.completeDays} fully planned{" "}
            {figures.completeDays === 1 ? "day" : "days"}.
            {figures.leftOut.length > 0 &&
              ` ${leftOut} ${figures.leftOut.length === 1 ? "is" : "are"} left out: not every slot is planned.`}
          </p>
        </>
      ) : (
        <p className="text-slash text-text-secondary">
          No day this week has every slot planned yet, so there is no average.
        </p>
      )}
    </section>
  );
}
