import { KeyValueGrid, type KeyValueItem } from "@/components/kv-grid";
import { figure, signed } from "@/lib/format";
import { deltaFromTarget, type MacroTarget, type MacroTotals } from "@/lib/macros";
import { cn } from "@/lib/utils";

/**
 * Four figures against target, with signed deltas — PRD § P4, Brand Guide
 * § Key/Value Grid.
 *
 * The presentation half of `lib/macros.ts`. That module returns numbers and
 * says why it returns nothing else: *"the delta convention is `−21` rather than
 * '21 under', and that minus sign is a rendering decision — the Brand Guide's
 * glyph, in the Brand Guide's typeface."* This file is where that decision is
 * made, once.
 *
 * ## Why one component rather than a grid per screen
 *
 * Three screens ask the same question — the day's totals on `/`, the day's
 * totals inside the swap sheet before a confirm, and what the day actually came
 * to on the day-complete summary — and until this file they answered it with
 * three hand-written copies of the same twenty lines. The copies had already
 * begun to drift: the sheet wrote `delta.kcal > 0 ? "text-error" : undefined`
 * and the summary wrote `cn(delta.kcal > 0 && "text-error")`, which is the same
 * rule spelled two ways and one edit away from being two rules.
 *
 * That matters more than tidiness here, because of what the sheet is FOR. It
 * previews the day a swap would produce; the grid on the card underneath shows
 * the day as it stands. If the two disagreed about which overage is worth
 * colouring, the sheet would preview a swap as safe and the card would paint the
 * identical number red the moment it was confirmed.
 *
 * ## What it deliberately does not own
 *
 * No heading, no live region, no partial-day caveat. Where the figures sit and
 * what announces them is the screen's business — the sheet marks its copy
 * `aria-live` because the numbers move under a tile the user just tapped, and
 * `/`'s copy is under a heading because it sits beside a second grid showing the
 * active meal's own macros. A component that decided either would be wrong on
 * one of the three screens.
 */

/**
 * How far past target counts as material — 5% of the target figure.
 *
 * The Brand Guide defines `error` as "material overage" (§ Semantic Colors) and
 * gives exactly one worked example: `+220 kcal` in `error`, against a voice
 * written around a 1,780 kcal day (§ UI Copy Examples). That is 12.4%, so the
 * example is comfortably material and tells us only that the threshold is below
 * it. The floor is set by the other end: a day 3 kcal over target has not gone
 * over in any sense a person would recognise, and a screen that said so in red
 * would be the app having an opinion about a rounding error.
 *
 * 5% of the day the guide writes its examples against is 89 kcal — about a piece
 * of fruit. Under it the delta is reported and left alone; over it the figure is
 * coloured.
 *
 * A proportion rather than a constant because the target moves. PRD § P5
 * recalibrates it every 5kg, and a fixed band would be a different fraction of
 * the target at the end of a cut than at the start — the same day's overage
 * changing colour because of a number chosen months earlier.
 */
export const OVERAGE_TOLERANCE = 0.05;

/**
 * Whether a positive delta is worth colouring.
 *
 * Positive only, and that is the first half of the rule: § Semantic Colors says
 * the two semantic tokens are "used on numbers only — never on a skip, a missed
 * session, or an under-target figure", and § UI Copy Examples writes `−8g
 * protein` in `text-secondary` beside `You missed your protein goal` in red
 * under "Avoid". Being under target is a fact about the day, not a fault in it,
 * so a negative delta is grey however large it is.
 *
 * ## A target of zero colours nothing
 *
 * Stated rather than left to the multiplication, which would otherwise answer
 * `delta > 0` — every figure red, on precisely the profile that has not said
 * what it is aiming at. That is the opposite of what the tolerance is for, and
 * it would arrive as a screen full of red rather than as an error anyone could
 * trace. Overage is a claim about a target, so with no target there is no claim
 * to make, and the day's figures are reported without comment.
 *
 * Unreachable from the app today — `profiles` carries all four figures and
 * settings cannot clear them — which is why it is written down here rather than
 * discovered later. A seed, a migration or a future "no target for this day"
 * mode all reach it without touching this file.
 *
 * Exported so the threshold can be tested as arithmetic rather than inferred
 * from a class name on a rendered span.
 */
export function isMaterialOverage(delta: number, target: number): boolean {
  if (delta <= 0) return false;
  if (target <= 0) return false;

  return delta > target * OVERAGE_TOLERANCE;
}

/**
 * Which figure the calories cell shows.
 *
 * `"actual"` is the ordinary arrangement: the day's kcal as the value, the
 * target and the delta beneath it. `"target"` is for the day-complete summary,
 * which prints the actual kcal at 76px Display immediately above its grid —
 * repeating it in the first cell would spend a column restating the largest
 * thing on the screen, so that cell carries the target instead and the delta
 * stands alone beneath it.
 */
export type CaloriesFigure = "actual" | "target";

export function MacroGrid({
  totals,
  target,
  calories = "actual",
  columns,
  className,
}: {
  /** What the day comes to — planned, previewed or logged; the grid does not care. */
  totals: MacroTotals;
  /** The four figures from `profiles`, and nothing else off that row. */
  target: MacroTarget;
  calories?: CaloriesFigure;
  /** Passed through to the grid. Three only when the figures are short. */
  columns?: 2 | 3;
  className?: string;
}) {
  const delta = deltaFromTarget(totals, target);

  /*
   * The one figure that takes a colour.
   *
   * It stops at kcal deliberately, and the reason is not that the other three
   * are less important: over target on protein is the day going well, and over
   * target on fat or carbs on a day whose calories are in range is not an
   * overage at all — it is the same energy arriving in a different shape. A rule
   * that painted every positive delta red would report a good day as a fault
   * three times over.
   *
   * Always a span, even when it carries no class, so the delta is one
   * addressable element whichever branch it took.
   */
  const caloriesDelta = (
    <span className={cn(isMaterialOverage(delta.kcal, target.targetKcal) && "text-error")}>
      {signed(delta.kcal)}
    </span>
  );

  /** A macro's secondary line: what it was aiming at, and how far off it landed. */
  const meta = (targetValue: number, deltaValue: number) => (
    <>
      of {figure(targetValue)} · {signed(deltaValue)}
    </>
  );

  const items: KeyValueItem[] = [
    calories === "target"
      ? { label: "Target", value: figure(target.targetKcal), meta: caloriesDelta }
      : {
          label: "Calories",
          value: figure(totals.kcal),
          meta: (
            <>
              of {figure(target.targetKcal)} · {caloriesDelta}
            </>
          ),
        },
    {
      label: "Protein",
      value: `${figure(totals.proteinG)} g`,
      meta: meta(target.targetProteinG, delta.proteinG),
      // § Typography: "protein stays emphasised by weight, not colour", because
      // colour is spoken for. Weight 700 against the other three at 600.
      emphasis: true,
    },
    {
      label: "Fat",
      value: `${figure(totals.fatG)} g`,
      meta: meta(target.targetFatG, delta.fatG),
    },
    {
      label: "Carbs",
      value: `${figure(totals.carbG)} g`,
      meta: meta(target.targetCarbG, delta.carbG),
    },
  ];

  return (
    // `tabular-nums` here as well as on `body`, and the repetition is the point:
    // the criterion is that the grid does not reflow as digits change, and a
    // grid that depended on an inherited rule three files away would pass or
    // fail on an edit to `globals.css` that mentioned none of this. The columns
    // are `minmax(0, 1fr)` tracks, so they hold their width whatever lands in
    // them; the figures then hold their own alignment inside those tracks.
    <KeyValueGrid items={items} columns={columns} className={cn("tabular-nums", className)} />
  );
}
