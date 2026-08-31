import { figure } from "@/lib/format";
import type { CalendarDate } from "@/lib/date";
import { entryLabel } from "@/lib/now-display";
import { cn } from "@/lib/utils";
import {
  CHART_SHAPE,
  CHART_SHAPE_WIDE,
  type ChartPlot,
  type ChartShape,
  chartGeometry,
  type Reading,
} from "@/lib/weight-chart";

/**
 * The weight trend chart — FUEL-35, PRD § P5.
 *
 * A polyline, five hairlines and one dot. Everything about where those go is
 * `lib/weight-chart.ts`; what happens here is ink, words and the draw-in.
 *
 * ## Two layers, because only one of them may scale — FUEL-76
 *
 * The viewBox scales with the column, and until FUEL-76 everything drawn inside
 * it scaled with it: on a 584px column the factor is 1.825, so § Typography's
 * 10.5px Micro painted at 19.2px — larger than Body, and the one place in the
 * app where the type scale was not honoured. The 2px trend painted at 3.65px and
 * the 4px latest-reading disc at 7.3px. It got worse as the column got wider.
 *
 * So the chart is drawn twice over. The scaled `<svg>` below keeps everything
 * whose SHAPE is the data — the plate, the rules, the trend — and an unscaled
 * `<svg>` stacked on top of it takes everything whose SIZE is specified: the
 * labels and the mark. The overlay carries no viewBox, so its user units are CSS
 * pixels and 10.5px is 10.5px at 375, 1280 and 1920; positions inside it are
 * percentages, which land exactly on the geometry beneath because `h-auto` locks
 * the box to the viewBox's own 320:170 aspect and neither layer is letterboxed.
 * Measured at a 331px column and a 1200px one: same font-size, same label width,
 * same 8px disc, each label the same 2px above its own rule.
 *
 * The two layers are why the constants below are in two units. Anything the
 * overlay draws is in CSS pixels. Anything the scaled `<svg>` draws, and every
 * position either layer reads out of `plot`, is in viewBox units.
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

/**
 * The trend line, in `ink`, at 2 **pixels**. § Color Palette: "the trend line".
 *
 * A pixel rather than a unit because the polyline carries
 * `vector-effect="non-scaling-stroke"`: the shape scales with the column and the
 * ink laid along it does not, which is what keeps 2px 2px at every width.
 */
const TREND_WIDTH = 2;

/**
 * The latest reading's mark, in pixels — radius, then the canvas-coloured ring.
 *
 * Drawn in the overlay, so both are pixels outright rather than units that would
 * paint at 7.3px and 3.65px on a 584px column.
 */
const LATEST_RADIUS = 4;
const LATEST_RING = 2;

/**
 * Where a reference line's label sits relative to the line itself, in pixels.
 *
 * Above it, by enough to clear the 10.5px Micro cap-height. A label centred on
 * its own rule would have the rule struck through it. Pixels because the thing
 * being cleared is a cap-height, and since FUEL-76 that is a fixed 10.5px at
 * every width — a lift in viewBox units would grow past what it has to clear.
 */
const LABEL_LIFT = 4;

/**
 * Below the line instead, when there is no room above. Pixels, as the lift.
 *
 * A reference that lands on the top of the domain sits at the plate's own
 * ceiling, and a label lifted above it would be clipped by the viewBox — the
 * `<svg>` element clips at its bounds, so half a word simply vanishes with
 * nothing to say it did. The case is ordinary: it happens whenever the starting
 * weight is both the heaviest figure on the chart and already a multiple of the
 * gridline step, which is most of the first fortnight of a program.
 */
const LABEL_DROP = 11;

/**
 * How near the top a rule may be before its label flips below it — in viewBox
 * UNITS, and the one number FUEL-76 had to raise rather than convert.
 *
 * The label is a fixed 10.5px however wide the column is, but the space above
 * its rule is 17 units of a box that scales, so the narrowest column is the case
 * that decides this: 320px of viewport less § Spacing & Layout's 22px gutters
 * leaves 276, which is 0.8625 of the 320-unit box. A label needs its 4px lift
 * plus about 10.5px of ascender above the rule, and 14.5px of a 0.8625 scale is
 * 16.8 units. At the old threshold of 12 the label fitted because it shrank with
 * the box; now that it does not, 17 is where it stops fitting. Above 320px of
 * viewport the flip is merely early, which costs nothing — a label below its
 * rule is as legible as one above it.
 */
const LABEL_HEADROOM = 17;

/**
 * How far below the plate the date axis sits, in pixels.
 *
 * Measured from the plate's own bottom edge rather than from the box's, because
 * the strip between the two is 22 units of a box that scales: anchored to the
 * box, the dates would drift 40px clear of the plate on a wide column and read
 * as belonging to whatever came next. Anchored to the plate, they sit under it
 * at every width. 14px clears the plate edge by the label's own descender at the
 * narrowest column and still leaves the box's floor below it.
 */
const AXIS_DROP = 14;

/**
 * How close two reference labels may sit before they are merged into one.
 *
 * Roughly the Micro line-height in viewBox units, and units is where FUEL-76
 * left it: the gap between two rules is geometry, so it shrinks with the box,
 * and 14 units is the threshold at the narrowest column the app supports. On a
 * wider one the labels are further apart in pixels than the test requires, which
 * merges a pair that would not quite have collided — the safe direction, and one
 * label saying both numbers is a sentence either way.
 *
 * Below it the two labels overprint into an unreadable smear, and the case that
 * produces it is not exotic: start and target are the same number for the whole
 * of a maintenance phase, which is to say from the day the goal is met onwards.
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
  // Compared as DISPLAYED rather than as stored, and the gap between the two is
  // real: `weight_logs.weight_kg` is `numeric(5, 2)` while `figure` shows one
  // decimal, so a start of 76.04 against a target of 76.01 is two different
  // numbers that both print as "76". Testing the raw floats there would take the
  // branch below that spells both out, and produce "Start 76 · Target 76" — a
  // whole line spent printing one figure twice to say the two are different.
  const startShown = figure(start.weightKg);
  const targetShown = figure(target.weightKg);

  const startText = `Start ${startShown}`;
  const targetText = `Target ${targetShown}`;

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
        startShown === targetShown
          ? // One number, said once. "Start 76 · Target 76" spends a whole line
            // repeating a figure to say the two references are the same, which
            // naming them together already says.
            `Start · Target ${startShown}`
          : `${startText} · ${targetText}`,
    },
  ];
}

/**
 * The pixels from a reference's rule to its label's baseline.
 *
 * Negative lifts the label above the rule, positive drops it below. A `dy` on
 * the `<text>` rather than a `y` of its own, because the rule's position is a
 * percentage of a box that scales and the offset from it is not — the two are in
 * different units and this keeps them in different attributes.
 */
function labelOffset(y: number): number {
  return y < LABEL_HEADROOM ? LABEL_DROP : -LABEL_LIFT;
}

/**
 * A viewBox coordinate as a percentage of the box, for the unscaled overlay.
 *
 * This is the whole trick of the two layers: the overlay has no viewBox of its
 * own, so a percentage in it resolves against the rendered box — the same box
 * the scaled `<svg>` maps its units onto — and the two agree at every width
 * without either of them being measured. Rounded to two places for the reason
 * `chartGeometry` rounds its coordinates: enough for a 320-unit box, and stable
 * in a test: two places is at most 0.005% of error, which is 0.06px on the
 * widest column the frame allows and less than that everywhere else.
 */
function pct(value: number, extent: number): string {
  return `${Math.round((value / extent) * 10000) / 100}%`;
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
  // Rounded before it is judged, for `referenceLabels`' reason one sentence
  // over: the column holds two decimals and `figure` prints one, so a reading
  // 40 grams from the starting weight is a non-zero `change` that formats as
  // "0" — and the sentence would read "Down 0 kg from the starting weight",
  // which is the exact wording the branch below exists to prevent.
  const changeShown = figure(Math.abs(change));
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
    changeShown === figure(0)
      ? " Level with the starting weight."
      : ` ${change < 0 ? "Down" : "Up"} ${changeShown} kg from the starting weight.`,
  ].join("");
}

/**
 * The chart itself, at one shape — FUEL-78.
 *
 * Extracted rather than invented: every line of this was `WeightChart`'s own
 * body until `/weight` needed the same drawing at two aspects, and what changed
 * is that the three geometry constants became the `shape` it is handed.
 *
 * ## Two of these render, and only one is ever in the accessibility tree
 *
 * `WeightChart` draws both shapes and hides one with `xl:hidden` /
 * `hidden xl:block`. That is `display: none`, which removes an element from the
 * accessibility tree entirely — so exactly one `role="img"` with exactly one
 * `aria-label` is exposed at any width, and the sr-only table below them is
 * outside both and is rendered once.
 *
 * A CSS switch rather than a measurement because the geometry is computed on
 * the server, where there is no viewport: the y of a gridline depends on the
 * box's height, so a single SVG whose viewBox changed at a breakpoint would be
 * drawing one shape's coordinates in the other shape's box.
 */
function Plot({
  plot,
  shape,
  name,
  today,
  className,
}: {
  plot: ChartPlot;
  shape: ChartShape;
  /**
   * Which of the two this is, for a test to scope to.
   *
   * jsdom applies no stylesheet, so `xl:hidden` is a substring there and BOTH
   * shapes are in the tree at once — which is what makes a bare
   * `querySelectorAll("text")` over the container count everything twice. A
   * browser never shows two, and `page-columns.spec.ts` is where that is
   * asserted; here the tests say which drawing they mean.
   */
  name: "measure" | "frame";
  today: CalendarDate;
  className?: string;
}) {
  const { gridlines, latest, path, points, start, target } = plot;

  /*
   * The positioning context the overlay is stacked in. It takes its height from
   * the scaled `<svg>` below, which is what makes `inset-0` on the overlay the
   * same box the geometry is drawn in.
   *
   * `shrink-0` guards the one precondition the two layers rest on: that this box
   * keeps its viewBox's own aspect, whichever of the two shapes it is drawing.
   * `h-auto` gives it that from the width — but a flex item shrinks by default,
   * and every caller is a flex column, so a height-constrained parent could
   * compress it. The scaled layer would then letterbox itself inside the box
   * (its `preserveAspectRatio` centres what it cannot fill) while the overlay,
   * having no viewBox, would go on filling the whole of it — and the words would
   * drift off the rules they belong to, silently and only at that one caller.
   * Refusing to shrink turns that into overflow, which is visible.
   */

  return (
    <div className={cn("relative shrink-0", className)} data-chart-shape={name}>
      <svg
        role="img"
        aria-label={summarise(plot, today)}
        viewBox={`0 0 ${shape.viewWidth} ${shape.viewHeight}`}
        // Scales with the column at any width, which is what makes "legible at
        // 375px" a proportion fixed once in the viewBox rather than a
        // measurement. `h-auto` keeps the aspect ratio, so nothing is squashed
        // on the way to the measure's column — and so the overlay's percentages
        // land on this layer's units. What scales with it is the geometry
        // alone: since FUEL-76 the words and the mark are drawn a layer up, in
        // pixels.
        //
        // What this cannot do is CHANGE the aspect, which is why FUEL-78 gave
        // the geometry a second shape rather than simply handing this one a
        // wider box. On the frame's shape there is nothing left to scale: the
        // frame caps at 1272, so the box is 968px wide wherever it is shown and
        // one user unit is one device pixel — including the `rx` below, which
        // is the first time it has actually been the 14px § Implementation
        // Notes asks for rather than the column's scale times fourteen.
        className="w-full h-auto"
      >
        {/* The plot area — the documented second use of `surface`. `rx` is the
            14px tile radius from § Implementation Notes: this is the one place
            the fill appears outside a tile, so it should at least be shaped
            like one.

            A KNOWN DIVERGENCE, recorded by FUEL-85 rather than fixed by it and
            left standing here: `BRAND_GUIDE.html` draws this chart with no
            plate at all. It "belongs to whoever reconciles the chart's
            drawing", and FUEL-78 is a composition ticket — widening a graphic
            is not a licence to restyle it. */}
        <rect
          x={0}
          y={0}
          width={shape.viewWidth}
          height={shape.plotHeight}
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
            x2={shape.viewWidth}
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
            thing worth being able to see.

            `vector-effect` fixes the dash as well as the width: under it the
            `3 3` is three device pixels rather than three units, which is what
            § Data Display asks for and what it stopped being above 320px. */}
        {[
          { rule: start, name: "start" },
          { rule: target, name: "target" },
        ].map(({ rule, name }) => (
          <line
            key={name}
            x1={0}
            x2={shape.viewWidth}
            y1={rule.y}
            y2={rule.y}
            stroke="var(--text-tertiary)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* The trend. `fill="none"` is the criterion — no area fill, and there
            is no gradient anywhere in this file to go with it.

            `vector-effect` is what holds § Color Palette's 2px to 2px: the
            shape is the data and scales with the column, the ink laid along it
            is a specified width and does not.

            It is also why the draw-in is a clip rather than a dash. The line
            used to carry `pathLength={1}`, which normalised its length so one
            dash of 1 covered it exactly and nothing had to measure the path;
            under `non-scaling-stroke` a browser normalises that dash against
            the path in USER units and then paints it as that many CSS pixels,
            so on a 584px column the full-length dash covered 55% of the line
            and the trend rendered permanently half-drawn. Measured in Chromium
            and Firefox both. `globals.css` wipes the line in with `clip-path`
            instead, which needs no length at all — see FUEL-76 there. */}
        {path !== null && (
          <polyline
            points={path}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={TREND_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="weight-chart-trend"
          />
        )}
      </svg>

      {/*
        The unscaled layer — FUEL-76.

        No viewBox, so its user units ARE CSS pixels: a `<text>` in here is the
        10.5px § Typography specifies at every column width, and the mark is
        the 4px disc and 2px ring § Data Display specifies. `inset-0` puts it
        over the box the layer beneath is drawn in, and every position is a
        percentage of that same box, so the words and the mark sit exactly on
        the geometry they belong to without either layer measuring anything.

        `pointer-events-none` for the same reason in the other direction: this
        layer covers the whole chart, and a decorative box that answers a
        pointer is one that can intercept something meant for what is beneath
        it. Nothing under it is interactive today, which is exactly when a
        layer like this is cheapest to make transparent to the pointer.

        `aria-hidden` covers the whole layer, and it is not an optimisation:
        every word in here is drawn INSIDE a graphic whose `aria-label` has
        already said it. `role="img"` on the layer beneath is supposed to prune
        its own descendants, but dot-grid.tsx records that Chrome lists them
        anyway and day-ruler.tsx hit the same thing with its 06 · 12 · 18 · 22
        scale — and these are not its descendants at all, so nothing would
        prune them. Without this a screen reader reads "Start 84.2", "Target
        76" and both dates a second time, after a summary that has said all
        four in a sentence.
      */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
        {/* Drawn after both rules and separately from them, because a label may
            belong to one line, or — when the two references coincide — to both.
            See `referenceLabels`. The `x` is a percentage because the inset
            from the plate's edge is plot-area padding and belongs to the
            geometry; the `dy` is pixels because what it clears is a cap-height.
            10.5px Micro, which § Accessibility permits here on its own terms:
            the figure it names sits at 22px in the hero above, and the exact
            number is in the table below either way. */}
        {referenceLabels(start, target).map(({ key, y, text }) => (
          <text
            key={key}
            x={pct(8, shape.viewWidth)}
            y={pct(y, shape.viewHeight)}
            dy={labelOffset(y)}
            className="text-micro uppercase fill-text-secondary"
          >
            {text}
          </text>
        ))}

        {/* The one umber mark on the screen — § Rule 2: "umber marks the present
            moment and nothing else … the latest reading on the chart". No other
            point carries a marker, which is both the criterion and the reason
            this dot means anything.

            The ring is `canvas` rather than `surface` so the dot reads as
            lifted off the plate in both modes; it is a hole in the trend line,
            not a second colour. */}
        <circle
          cx={pct(latest.x, shape.viewWidth)}
          cy={pct(latest.y, shape.viewHeight)}
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
            ends of a chart with one point in the middle.

            Hung from the plate's bottom edge rather than from the box's floor —
            see `AXIS_DROP`. */}
        {points.length > 1 && points[0] && (
          <>
            <text
              x="0%"
              y={pct(shape.plotHeight, shape.viewHeight)}
              dy={AXIS_DROP}
              className="text-micro uppercase fill-text-tertiary"
            >
              {entryLabel(points[0].date, today)}
            </text>
            <text
              x="100%"
              y={pct(shape.plotHeight, shape.viewHeight)}
              dy={AXIS_DROP}
              textAnchor="end"
              className="text-micro uppercase fill-text-tertiary"
            >
              {entryLabel(latest.date, today)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
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

  const { domain, points, start, target, latest } = plot;

  /*
   * The same readings, laid out in the frame's box — FUEL-78.
   *
   * `chartGeometry` is pure arithmetic over at most a few dozen rows, so
   * running it twice is cheaper than any mechanism for avoiding it, and it is
   * the only way to have both shapes' coordinates available to a server render
   * that cannot know the viewport.
   *
   * Non-null by construction: it is the same readings and the same references
   * that just produced `plot`, and `chartGeometry` returns null only for an
   * empty history. The check is here because the type says it can be, and
   * `?? plot` would silently draw the phone's coordinates in a 968px box.
   */
  const widePlot = chartGeometry(entries, { startWeightKg, targetWeightKg }, CHART_SHAPE_WIDE);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Below the cap, where the chart has the measure and nothing else. */}
      <Plot plot={plot} shape={CHART_SHAPE} name="measure" today={today} className="xl:hidden" />

      {/* At it, where § Desktop gives it the frame. */}
      {widePlot && (
        <Plot
          plot={widePlot}
          shape={CHART_SHAPE_WIDE}
          name="frame"
          today={today}
          className="hidden xl:block"
        />
      )}

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
