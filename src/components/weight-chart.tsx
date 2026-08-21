import { figure } from "@/lib/format";
import type { CalendarDate } from "@/lib/date";
import { entryLabel } from "@/lib/now-display";
import { cn } from "@/lib/utils";
import {
  type ChartPlot,
  chartGeometry,
  PLOT_HEIGHT,
  type Reading,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "@/lib/weight-chart";

/**
 * The weight trend chart — FUEL-35, PRD § P5.
 *
 * A polyline, five hairlines and one dot. Everything about where those go is
 * `lib/weight-chart.ts`; what happens here is ink, words and the draw-in.
 *
 * ## Not a signature graphic, and it still carries their obligations
 *
 * Brand Guide § Rule 4 names two graphics — the day ruler and the dot grid — and
 * this is neither. But § Accessibility's requirement is written about what a
 * graphic IS rather than about which two are on the list: "a mark on a screen is
 * not the data", so a summary and an adjacent data table come with it. Both are
 * built from the same `plot` the marks are, so the picture and its description
 * cannot drift.
 *
 * ## The one fill outside a tile
 *
 * § Color Palette gives `surface` to "stone tiles only". This is the documented
 * second use, and the reason is that a plot area is the one thing in this system
 * that has to be read AGAINST something: a trend line sitting on the bare canvas
 * has no extent, so a reading near the top of the plate and one near the bottom
 * carry no meaning until an edge says where the top and the bottom were. The
 * amendment is recorded in the guide rather than only here.
 *
 * ## Rendered wherever its caller is
 *
 * No `"use client"` and no hooks, but no `server-only` either. `weigh-ins.tsx`
 * is a client component holding the history in `useOptimistic`, and it passes
 * those optimistic rows straight through — so a weigh-in that has been logged
 * but not yet acknowledged moves the line at the same moment it appears in the
 * list beneath. A server-rendered chart would show the old trend beside the new
 * row, which § Feedback's "the UI reflecting the new state IS the confirmation"
 * rules out, and which reads as the chart being broken rather than as being
 * behind.
 */

/** The trend line, in `ink`, at 2 units. § Color Palette: "the trend line". */
const TREND_WIDTH = 2;

/** The latest reading's mark. Radius, then the canvas-coloured ring around it. */
const LATEST_RADIUS = 4;
const LATEST_RING = 2;

/**
 * Where a reference line's label sits relative to the line itself.
 *
 * Above it, by enough to clear the 10.5px Micro cap-height. A label centred on
 * its own rule would have the rule struck through it.
 */
const LABEL_LIFT = 4;

/**
 * Below the line instead, when there is no room above.
 *
 * A reference that lands on the top of the domain sits at the plate's own
 * ceiling, and a label lifted above it would be clipped by the viewBox — the
 * `<svg>` element clips at its bounds, so half a word simply vanishes with
 * nothing to say it did. The case is ordinary: it happens whenever the starting
 * weight is both the heaviest figure on the chart and already a multiple of the
 * gridline step, which is most of the first fortnight of a program.
 */
const LABEL_DROP = 11;
const LABEL_HEADROOM = 12;

/**
 * How close two reference labels may sit before they are merged into one.
 *
 * Roughly the Micro line-height in viewBox units. Below it the two labels
 * overprint into an unreadable smear, and the case that produces it is not
 * exotic: start and target are the same number for the whole of a maintenance
 * phase, which is to say from the day the goal is met onwards.
 *
 * The LINES are left alone and both still drawn. Two coincident hairlines are
 * the same pixels as one, and where the references are merely close rather than
 * equal, two rules a millimetre apart is the truth. It is only the words that
 * cannot overlap.
 */
const LABEL_MIN_GAP = 14;

/** A reference's label text and the line it belongs to, collisions resolved. */
function referenceLabels(
  start: ChartPlot["start"],
  target: ChartPlot["target"],
): { key: string; y: number; text: string }[] {
  const startText = `Start ${figure(start.weightKg)}`;
  const targetText = `Target ${figure(target.weightKg)}`;

  if (Math.abs(start.y - target.y) >= LABEL_MIN_GAP) {
    return [
      { key: "start", y: start.y, text: startText },
      { key: "target", y: target.y, text: targetText },
    ];
  }

  return [
    {
      key: "both",
      // The higher of the two, so the merged label clears both rules.
      y: Math.min(start.y, target.y),
      text:
        start.weightKg === target.weightKg
          ? // One number, said once. "Start 76 · Target 76" spends a whole line
            // repeating a figure to say the two references are the same, which
            // naming them together already says.
            `Start · Target ${figure(start.weightKg)}`
          : `${startText} · ${targetText}`,
    },
  ];
}

/** The baseline a label sits on, flipped below its rule when the top is close. */
function labelBaseline(y: number): number {
  return y < LABEL_HEADROOM ? y + LABEL_DROP : y - LABEL_LIFT;
}

/**
 * The sentence a screen reader hears instead of the picture.
 *
 * Reports what is DRAWN and stops there. The change from the starting weight is
 * included because it is the thing the line depicts — a chart whose summary
 * declined to say which way it went would be describing an ornament. P5's other
 * progress figures, kg remaining and the percentage of the way to target, are
 * FUEL-36's and belong beside the chart rather than inside its description.
 *
 * Every number goes through `figure`, so the summary and the table below say a
 * reading the same way, and both say it the way the history list does.
 */
function summarise(plot: ChartPlot, today: CalendarDate): string {
  const { latest, points, start, target } = plot;

  const change = latest.weightKg - start.weightKg;
  const first = points[0];

  return [
    `Weight trend, ${points.length === 1 ? "1 weigh-in" : `${points.length} weigh-ins`}`,
    first && points.length > 1
      ? `, ${entryLabel(first.date, today)} to ${entryLabel(latest.date, today)}.`
      : ".",
    ` Latest ${figure(latest.weightKg)} kg on ${entryLabel(latest.date, today)}.`,
    ` Started at ${figure(start.weightKg)} kg, target ${figure(target.weightKg)} kg.`,
    // A true zero is a real outcome — a reading back at the starting weight —
    // and "up 0 kg" would be a sentence about a direction that did not happen.
    change === 0
      ? " Level with the starting weight."
      : ` ${change < 0 ? "Down" : "Up"} ${figure(Math.abs(change))} kg from the starting weight.`,
  ].join("");
}

export function WeightChart({
  entries,
  today,
  startWeightKg,
  targetWeightKg,
  className,
}: {
  /**
   * Every weigh-in, in any order — `lib/weight-chart.ts` sorts them.
   *
   * `readonly` because they are the screen's optimistic state, and a graphic
   * that reordered its caller's rows would reorder the history list drawn under
   * it.
   */
  entries: readonly Reading[];
  /** Today in the user's own zone, for the year-disambiguating date labels. */
  today: CalendarDate;
  /** `profiles.start_weight_kg`. Where the journey began. */
  startWeightKg: number;
  /** `profiles.target_weight_kg`. Never a literal — see `chartGeometry`. */
  targetWeightKg: number;
  className?: string;
}) {
  const plot = chartGeometry(entries, { startWeightKg, targetWeightKg });

  // § UI Copy Examples writes the empty state as "No weigh-ins yet. Your first
  // entry starts the chart" — the guide's own sentence says there is no chart
  // yet, and `/weight` already renders it above this. Drawing an empty ruled
  // plate here would contradict the sentence and repeat it.
  if (plot === null) return null;

  const { domain, gridlines, latest, path, points, start, target } = plot;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <svg
        role="img"
        aria-label={summarise(plot, today)}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        // Scales with the column at any width, which is what makes "legible at
        // 375px" a proportion fixed once in the viewBox rather than a
        // measurement. `h-auto` keeps the aspect ratio, so nothing is squashed
        // on the way to a 640px desktop column.
        className="w-full h-auto"
      >
        {/* The plot area — the documented second use of `surface`. `rx` is the
            14px tile radius from § Implementation Notes: this is the one place
            the fill appears outside a tile, so it should at least be shaped
            like one. */}
        <rect
          x={0}
          y={0}
          width={VIEW_WIDTH}
          height={PLOT_HEIGHT}
          rx={14}
          fill="var(--surface)"
        />

        {/* Horizontal only. There is no vertical rule anywhere on this chart:
            time is continuous and a weigh-in is a moment in it, so a vertical
            gridline would be an edge the data does not have. FUEL-35's
            criterion, and § Deliberately Absent's disposition generally.

            `vector-effect` keeps a hairline one device pixel wide however far
            the viewBox is scaled up — which is what "hairline" means in
            § Materials, and what a plain stroke width of 1 stops being the
            moment the column is wider than 320px. */}
        {gridlines.map((rule) => (
          <line
            key={rule.weightKg}
            x1={0}
            x2={VIEW_WIDTH}
            y1={rule.y}
            y2={rule.y}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Start and target: the same dashed hairline, told apart by their
            labels rather than by their ink. § Accessibility's "never colour
            alone", applied to a pair of lines that would otherwise need a
            second accent to separate them — which § Deliberately Absent
            forbids. The band between them is the whole journey, which is a
            thing worth being able to see. */}
        {[
          { rule: start, name: "start" },
          { rule: target, name: "target" },
        ].map(({ rule, name }) => (
          <line
            key={name}
            x1={0}
            x2={VIEW_WIDTH}
            y1={rule.y}
            y2={rule.y}
            stroke="var(--text-tertiary)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Drawn after both rules and separately from them, because a label may
            belong to one line, or — when the two references coincide — to both.
            See `referenceLabels`. */}
        {referenceLabels(start, target).map(({ key, y, text }) => (
          <text
            key={key}
            x={8}
            y={labelBaseline(y)}
            // 10.5px Micro. § Accessibility permits it here on its own terms:
            // the figure it names sits at 22px in the hero above, and the exact
            // number is in the table below either way.
            className="text-micro uppercase fill-text-secondary"
          >
            {text}
          </text>
        ))}

        {/* The trend. `fill="none"` is the criterion — no area fill, and there
            is no gradient anywhere in this file to go with it.

            `pathLength={1}` is what lets the draw-in be pure CSS: it normalises
            the line's length to 1, so a dash array of 1 covers it exactly and
            the animation offsets from 1 to 0 without anything having to measure
            the path in a browser. That keeps the whole component free of
            client-side work and of a `useEffect` that would run after paint. */}
        {path !== null && (
          <polyline
            points={path}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={TREND_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="weight-chart-trend"
          />
        )}

        {/* The one umber mark on the screen — § Rule 2: "umber marks the present
            moment and nothing else … the latest reading on the chart". No other
            point carries a marker, which is both the criterion and the reason
            this dot means anything.

            The ring is `canvas` rather than `surface` so the dot reads as
            lifted off the plate in both modes; it is a hole in the trend line,
            not a second colour. */}
        <circle
          cx={latest.x}
          cy={latest.y}
          r={LATEST_RADIUS}
          fill="var(--accent)"
          stroke="var(--canvas)"
          strokeWidth={LATEST_RING}
          className="weight-chart-latest"
        />

        {/* The date axis, outside the plate. Only the ends: the readings between
            them are in the table, and a label per weigh-in would be unreadable
            at 375px on a history of any length. Suppressed for a single reading,
            where the two labels would be the same date printed twice at opposite
            ends of a chart with one point in the middle. */}
        {points.length > 1 && points[0] && (
          <>
            <text
              x={0}
              y={VIEW_HEIGHT - 4}
              className="text-micro uppercase fill-text-tertiary"
            >
              {entryLabel(points[0].date, today)}
            </text>
            <text
              x={VIEW_WIDTH}
              y={VIEW_HEIGHT - 4}
              textAnchor="end"
              className="text-micro uppercase fill-text-tertiary"
            >
              {entryLabel(latest.date, today)}
            </text>
          </>
        )}
      </svg>

      {/*
        § Accessibility — the summary above, and the data table here, because "a
        mark on a screen is not the data".

        The block wrapper is load-bearing, and dot-grid.tsx records why: sr-only
        hides an element by shrinking it to 1px and clipping, but a
        `display: table` box treats that width as a suggestion and lays out at
        its natural width, pushing the page into horizontal scroll at 200% zoom.
        A block wrapper honours the 1px; the table keeps its semantics inside it.
      */}
      <div className="sr-only">
        <table>
          <caption>
            Weigh-ins, oldest first. Started at {figure(start.weightKg)} kg, target{" "}
            {figure(target.weightKg)} kg. Chart spans {figure(domain.lowKg)} to{" "}
            {figure(domain.highKg)} kg.
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Weight</th>
              <th scope="col">Mark</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{entryLabel(point.date, today)}</th>
                <td>{figure(point.weightKg)} kg</td>
                {/* The third column is what the graphic encodes that the first
                    two do not: which point is the one the umber dot is on. A
                    table that omitted it would describe the data but not the
                    picture. */}
                <td>{point.date === latest.date ? "Latest reading" : "No mark"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
