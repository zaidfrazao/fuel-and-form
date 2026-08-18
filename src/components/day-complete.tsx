import { KeyValueGrid, type KeyValueItem } from "@/components/kv-grid";
import type { CalendarDate } from "@/lib/date";
import { entryTotals, type LoggedEntry, type LogStatus } from "@/lib/day-summary";
import { deltaFromTarget, type MacroTarget, type MacroTotals } from "@/lib/macros";
import { dayLabel } from "@/lib/now-display";
import { cn } from "@/lib/utils";

/**
 * The day-complete summary — PRD § P1's last criterion, Brand Guide § Seven
 * screens → Day complete.
 *
 * "After the last item of the day, the view shows a day-complete summary with
 * actual versus target macros." What the day came to, how far that is from
 * target, and the day's log with each item's status. The guide's caption is the
 * shape of it: *"the day is a finished page"*.
 *
 * ## Crop marks, and why they are here and nowhere else
 *
 * § Materials: print registration marks, 11px, `text-tertiary`, "at the four
 * corners of the day-complete summary **and nowhere else**. A device used once
 * keeps its meaning." So they live in this component rather than in a shared
 * frame — a `<CropMarks>` available to any screen is a rule enforced by whoever
 * remembers it, and this one is worth more than that.
 *
 * They are `aria-hidden`: registration marks are a graphic device with nothing
 * to announce, and four unlabelled corners read to a screen reader as noise.
 *
 * ## No tab bar
 *
 * The task's criterion, and there is nothing to suppress yet — the app is one
 * route, so no navigation chrome exists to hide. What this file can do is not
 * introduce any, and say plainly what the future obligation is: when P2 and P6
 * add the tab bar, this screen renders without it, so the summary owns the
 * screen. `right-now.test.tsx` asserts the absence, which turns the criterion
 * into something that fails if a bar is ever added above this state.
 *
 * ## No score, no streak, no praise
 *
 * § Tone of Voice: `Day complete. 1,715 / 1,780 kcal · 141 / 148g protein.` and
 * NOT `Awesome day! You crushed your goals!`. There is no derived "quality of
 * day" figure anywhere below, because there is no honest one — a day under
 * target on a rest day and the same day after a session are not comparable, and
 * a number that pretended otherwise would be the app having an opinion about
 * someone's eating. The four figures and the log are the whole report.
 */

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Grouped thousands, at most one decimal — `1,715`, `32.5`.
 *
 * A fixed locale rather than the visitor's: `Intl` with no locale reads the
 * runtime's, which would print `1.715` for a European browser against a brand
 * voice written in English, and would make the suite's assertions depend on the
 * machine running them.
 *
 * One decimal because that is what the grams columns store (`numeric(6, 1)`).
 * kcal is an integer column, so the option never fires on it.
 */
const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/**
 * A delta, with the Brand Guide's sign in front of it.
 *
 * U+2212 MINUS SIGN, not a hyphen: it is the glyph the guide writes the
 * convention in (`−21`, never "21 under") and the one that lines up under
 * tabular figures. Zero carries no sign at all — `+0` and `−0` both read as a
 * near miss on a day that hit the target exactly, and `macros.ts` already
 * guarantees the value is a true zero rather than JavaScript's `-0`.
 */
function signed(value: number): string {
  if (value === 0) return "0";

  return value > 0 ? `+${NUMBER.format(value)}` : `−${NUMBER.format(-value)}`;
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One corner mark: a 1px cross with its centre cut out, 11px each way.
 *
 * Transcribed from `.crop` in docs/BRAND_GUIDE.html — the two rules are offset
 * 5px into an 11px box, which is what makes a registration mark rather than a
 * plus sign. `bg-current` on both, so the pair inherits one colour.
 */
function CropMark({ corner, className }: { corner: string; className: string }) {
  return (
    <span
      aria-hidden
      // `data-crop` is the only handle a test has on a decorative element that
      // is deliberately invisible to the accessibility tree. The criterion is
      // "at the four corners, and this screen only", which is a claim about
      // four elements existing here and nowhere else.
      data-crop={corner}
      className={cn("pointer-events-none absolute size-[11px] text-text-tertiary", className)}
    >
      <span className="absolute top-0 left-[5px] h-[11px] w-px bg-current" />
      <span className="absolute top-[5px] left-0 h-px w-[11px] bg-current" />
    </span>
  );
}

/**
 * The four figures — § Key/Value Grid, which "replaces the macro strip
 * entirely".
 *
 * Actual is the value; the target and the signed delta sit beneath it as slash
 * metadata, which is the guide's own arrangement in the mock. The kcal pair
 * reads `1,780` / `−65` because the number above it is already labelled by the
 * display figure; the three macros read `of 148 · −7`, so a column can be read
 * on its own without carrying a heading down from the top of the screen.
 *
 * Every one of the four carries its delta, including fat and carbs — the mock
 * shows deltas on kcal and protein only, and the acceptance criterion asks for
 * "kcal and all three macros with signed deltas". A column with the target but
 * no delta also makes the reader do the subtraction the screen exists to do.
 *
 * Protein is emphasised by weight — § Typography's "protein stays emphasised by
 * weight, not colour", because colour is spoken for by the accent.
 *
 * ## The one figure that takes a colour
 *
 * Over-target kcal, in `error` — § Tone of Voice writes exactly that: `+220
 * kcal` in `error` against `−8g protein` in `text-secondary`. It stops at kcal
 * deliberately: over target on protein is the day going well, and a rule that
 * painted every positive delta red would report a good day as a fault.
 */
function Figures({ actual, target }: { actual: MacroTotals; target: MacroTarget }) {
  const delta = deltaFromTarget(actual, target);

  const meta = (targetValue: number, deltaValue: number) => (
    <>
      of {NUMBER.format(targetValue)} · {signed(deltaValue)}
    </>
  );

  const items: KeyValueItem[] = [
    {
      label: "Target",
      value: NUMBER.format(target.targetKcal),
      meta: (
        <span className={cn(delta.kcal > 0 && "text-error")}>{signed(delta.kcal)}</span>
      ),
    },
    {
      label: "Protein",
      value: `${NUMBER.format(actual.proteinG)} g`,
      meta: meta(target.targetProteinG, delta.proteinG),
      emphasis: true,
    },
    {
      label: "Fat",
      value: `${NUMBER.format(actual.fatG)} g`,
      meta: meta(target.targetFatG, delta.fatG),
    },
    {
      label: "Carbs",
      value: `${NUMBER.format(actual.carbG)} g`,
      meta: meta(target.targetCarbG, delta.carbG),
    },
  ];

  return <KeyValueGrid items={items} />;
}

/**
 * The word on the right of a logged row.
 *
 * The four statuses the two log tables hold, in the app's own vocabulary.
 * 'partial' has no verb on P1 — one tap means done — but the schema keeps room
 * for it and an export or a later screen can write one, so it is named here
 * rather than left to fall through to something wrong.
 */
const STATUS_LABEL: Readonly<Record<LogStatus, string>> = {
  eaten: "Eaten",
  done: "Done",
  partial: "Partial",
  skipped: "Skipped",
};

/**
 * The day's log — every item logged today, with what it was logged as.
 *
 * ## Skipped and Done differ by weight and by nothing else
 *
 * The acceptance criterion, and the guide's own caption for this screen: *"no
 * score, no praise — Skipped and Done are set in the same 10.5px caps, differing
 * only in weight."* Same size, same caps, same colour; 400 against 600.
 *
 * The mock's stylesheet actually separates them by COLOUR (`text-3` against
 * `text`) and leaves the weight equal. The caption and the criterion agree with
 * each other against it, and they are the ones that state the intent: a skip is
 * a neutral fact about the day, and greying it out is the closest this screen
 * could come to a judgement. Weight recedes without dimming.
 *
 * An empty list says so rather than rendering an empty gap — § Tone of Voice
 * asks an empty state to describe what would appear. Reaching this screen with
 * nothing logged is ordinary: the manual advance walks past the last item of the
 * day without logging anything, which is the "I'm done" gesture.
 */
function Logged({ entries }: { entries: readonly LoggedEntry[] }) {
  return (
    <section className="flex flex-col gap-[14px]">
      <h2 className="text-micro text-text-secondary uppercase">Logged</h2>

      {entries.length === 0 ? (
        <p className="text-body text-text-secondary">
          Nothing was logged today. Items appear here as they are logged or skipped.
        </p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex min-h-[44px] items-center justify-between gap-4 border-b border-border py-[10px] last:border-b-0"
            >
              <span className="truncate text-body text-text-primary">{entry.name}</span>
              <span
                className={cn(
                  "text-micro text-text-secondary uppercase",
                  // § Type tokens set Micro at 600; a skip steps down to 400 and
                  // keeps everything else — size, caps, tracking, colour.
                  entry.status === "skipped" && "font-normal",
                )}
              >
                {STATUS_LABEL[entry.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

export function DayComplete({
  date,
  entries,
  target,
}: {
  /** The day being summarised, in the user's own zone. */
  date: CalendarDate;
  /** The day's log, in the order it happened — `dayLog`, plus any pending tap. */
  entries: readonly LoggedEntry[];
  /** The four figures from `profiles`, and nothing else off that row. */
  target: MacroTarget;
}) {
  const actual = entryTotals(entries);

  return (
    // `relative` is what the crop marks are positioned against, and `flex-1`
    // is what makes that box the whole page rather than the height of the
    // content — a page marked at its corners has to be the page.
    <div className="relative flex flex-1 flex-col gap-[26px]">
      {/* Out into the page gutter, not at the text's own edge. Measured at
          375px: a mark flush with the content column sits on top of the date in
          the corner it shares — registration marks belong OUTSIDE the trim, and
          the 22px gutter is where the trim is. */}
      <CropMark corner="tl" className="top-0 -left-4" />
      <CropMark corner="tr" className="top-0 -right-4" />
      <CropMark corner="bl" className="bottom-0 -left-4" />
      <CropMark corner="br" className="-right-4 bottom-0" />

      {/* The date is the other half of the topbar in the mock, and it earns its
          place: this screen is a record of a specific day, and it is the one
          state of `/` that can still be on screen after midnight. */}
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-micro text-text-secondary uppercase">Day complete</h1>
        <p className="text-micro text-text-tertiary uppercase">{dayLabel(date)}</p>
      </header>

      <div className="flex flex-col gap-[26px]">
        {/* The day's calories at Display — the 7× ratio against the 10.5px
            labels that the guide calls "the design". The unit sits on the
            baseline beside it rather than above, so the figure reads as one
            number and not as a labelled cell. */}
        <p className="flex items-baseline gap-[10px]">
          <span className="text-display text-text-primary">
            {NUMBER.format(actual.kcal)}
          </span>
          <span className="text-micro text-text-secondary uppercase">kcal</span>
        </p>

        <Figures actual={actual} target={target} />

        <Logged entries={entries} />
      </div>
    </div>
  );
}
