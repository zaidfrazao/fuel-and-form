import type { Track } from "@/lib/route";
import {
  percent,
  summarise,
  TRACE_VIEW_HEIGHT,
  TRACE_VIEW_WIDTH,
  traceGeometry,
  type WalkSummary,
} from "@/lib/route-trace";

/**
 * One walk, drawn — Brand Guide § Data Display → The Route Trace, FUEL-102.
 *
 * Transcribed from `BRAND_GUIDE.html` § 02, which draws two specimens beside
 * the ruler and the grid. That file's own caption on `/weight` says a graphic
 * drawn in it "is an obligation on whoever builds the screen", and § The Route
 * Trace names this ticket as the intended case: transcribe geometry the way
 * `day-ruler.tsx` did rather than invent it from a sentence the way
 * `nav-shell.tsx` had to.
 *
 * ## Not a third signature graphic
 *
 * § The Four Rules #4 is SCOPED rather than extended (FUEL-99). It splits two
 * devices by TIME-SCALE — one day at hour precision, six weeks at day precision
 * — and a shape is not a time-scale device. The trace clears the rule twice
 * over: by kind, and by placement, because it never appears on a canvas at all.
 * It lives in a sheet. Two devices is still the count.
 *
 * ## What is deliberately absent
 *
 * No plate, no gridline, no axis, no scale bar, no north arrow, no colour, and
 * no draw-in. Each has a reason in § The Route Trace and none of them is an
 * omission:
 *
 * - **No plate.** `surface` has two permitted uses and the chart's plot area is
 *   the second and last. A trend must be read AGAINST something; a route
 *   carries its own extent — the shape IS the datum — so there is no edge for a
 *   fill to provide.
 * - **No scale bar, no north arrow.** Both are basemap furniture. Without
 *   streets a north arrow orients a shape against nothing anyone can check, and
 *   a scale bar restates the distance figure in a form that reads less
 *   precisely.
 * - **No colour.** A finished walk has no *now* in it, so it takes no accent.
 *   Start and end differ by SHAPE — a ring against a disc — so the drawing
 *   survives greyscale (§ Accessibility, never colour alone).
 * - **No draw-in.** The sheet is already animating at 250ms and a graphic that
 *   animates inside a container which is itself arriving is two motions for one
 *   tap. § Reduced motion consequently has nothing to drop, which is the
 *   cheapest way to be correct — and it is why this component has no
 *   `prefers-reduced-motion` branch rather than having forgotten one.
 *
 * ## Two layers, and the trap that comes with them
 *
 * The geometry scales with the sheet's column and the ink does not — the
 * chart's rule, inherited rather than restated (§ Data Display). So the route is
 * drawn into a fixed unit box that stretches to the column, and the marks sit in
 * an unscaled layer stacked over it at percentage positions, which is how the
 * two agree at every width without either being measured. The trace is 2px in a
 * 331px sheet at 375 and 2px in a 596px one at 1272.
 *
 * Holding a stroke to a width takes `vector-effect="non-scaling-stroke"`, and
 * under it a browser normalises a dash against the path in USER units while
 * painting it in CSS pixels — so `pathLength` is broken here exactly as it was
 * on the chart. There is no draw-in to get wrong today; if one is ever wanted it
 * is a `clip-path` wipe and never a dash. The reason is recorded here so it is
 * not rediscovered a third time.
 */
export function RouteTrace({
  track,
  ...summary
}: WalkSummary & { track: Track }) {
  const geometry = traceGeometry(track);

  // § The Route Trace: "A walk with no route draws nothing" — not an empty box
  // and not a placeholder. The sheet is not opened for one, because the row
  // draws no control; this is the second half of that rule rather than a
  // fallback the interface relies on.
  if (!geometry) return null;

  const left = (x: number) => percent(x, TRACE_VIEW_WIDTH);
  const top = (y: number) => percent(y, TRACE_VIEW_HEIGHT);

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={summarise({ ...summary, track })}
        viewBox={`0 0 ${TRACE_VIEW_WIDTH} ${TRACE_VIEW_HEIGHT}`}
        // `meet` at the box's own 3:2, with `h-auto` holding that ratio, so
        // there is no letterboxing for the overlay's percentages to be wrong
        // about. The two layers land on each other by construction.
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
      >
        {geometry.segments.map((points, index) => (
          <polyline
            // Keyed by position: segments are a static ordered list derived
            // from one track and are never reordered in place, which is the
            // case an index key is correct for. They also have no id of their
            // own — a segment is a gap's two sides, not a stored entity.
            key={index}
            points={points}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // The whole reason the marks are a layer up. Without this the
            // stroke would scale with the box and draw thin at 375 and heavy at
            // 1272 — § Data Display's rule is that the geometry scales and the
            // ink does not.
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/*
        The unscaled layer — CSS pixels over user units.

        `aria-hidden` covers all of it, and it is not an optimisation. The
        `role="img"` beneath has already said everything these marks mean, and
        `dot-grid.tsx` records that Chrome lists a graphic's descendants anyway
        where it is supposed to prune them — these are not its descendants at
        all, so nothing would prune them. Without this a screen reader announces
        two unlabelled shapes after a sentence that has described the walk.

        `pointer-events-none` because a decorative layer covering the whole
        graphic is one that can intercept something meant for what is beneath
        it — which is `weight-chart.tsx`'s reason, and it is cheapest to apply
        while nothing under it is interactive.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* Start: a 9px ring in `text-tertiary`, 1.5px. The negative margins
            are half its own size, so the ring is CENTRED on the position
            rather than hanging from its top-left corner. */}
        <span
          className="absolute size-[9px] rounded-full border-[1.5px] border-text-tertiary"
          style={{
            left: left(geometry.start.x),
            top: top(geometry.start.y),
            margin: "-4.5px 0 0 -4.5px",
          }}
        />

        {/* End: a 4px filled `ink` disc. It differs from the start by FORM and
            not by ink, which is what makes the pair readable in greyscale and
            to a reader who cannot separate the two colours — § Accessibility's
            "never colour alone", and the reason this graphic needs no key. */}
        <span
          className="absolute size-[4px] rounded-full bg-ink"
          style={{
            left: left(geometry.end.x),
            top: top(geometry.end.y),
            margin: "-2px 0 0 -2px",
          }}
        />
      </div>
    </div>
  );
}
