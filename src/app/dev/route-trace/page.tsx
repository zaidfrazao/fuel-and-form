import type { Metadata } from "next";

import { RouteTrace } from "@/components/route-trace";
import { ThemeToggle } from "@/components/theme-toggle";
import { EARTH_RADIUS_M, type Track, type TrackPoint } from "@/lib/route";
import { absences, kilometres, pace, shapeWord } from "@/lib/route-trace";

/**
 * The route trace, rendered — FUEL-102, Brand Guide § Data Display.
 *
 * ## Why this page exists at all
 *
 * The degenerate cases are invisible to both suites. The demo fixture is always
 * populated, so the visual suite only ever photographs an ordinary walk; jsdom
 * applies no stylesheet, so a unit test can assert the markup and can see
 * nothing about whether a two-point route draws as a line or as a broken box.
 * FUEL-102's criterion — *"a walk with no route, one with two points, and one
 * with a gap each render deliberately rather than as a broken box"* — is
 * therefore a criterion that nothing automated can check. This page is where a
 * person checks it.
 *
 * It carries its OWN fixtures, the way `/dev/right-now` hand-builds its day.
 * That is what makes it able to show a state the database has no row for.
 *
 * ## The fixtures are metre offsets, and that is not a convenience
 *
 * PRD § P11: no coordinate reaches a seed, a fixture, a test or the repository,
 * and this file is in the repository. Every walk below is built from offsets in
 * metres around one arbitrary latitude, so what is committed is a SHAPE and not
 * a place. `check-no-metrics.sh` would catch a position written any other way,
 * and it should never have to.
 */
export const metadata: Metadata = {
  title: "Route trace",
  robots: { index: false, follow: false },
};

const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * A latitude, not a place — and deliberately not the equator.
 *
 * The fit projects before it scales, because a degree of longitude shrinks by
 * the cosine of the latitude and an unprojected fit would draw every walk
 * stretched east-west. At the equator that bug is invisible; at 51° the square
 * below is 1.59 times wider than tall without the projection, which is a thing
 * you can see on this page with your own eyes.
 */
const SPECIMEN_LATITUDE = 51;
const COS_SPECIMEN = Math.cos((SPECIMEN_LATITUDE * Math.PI) / 180);

const at = (east: number, north: number, t = 0): TrackPoint => ({
  lat: SPECIMEN_LATITUDE + north / METRES_PER_DEGREE,
  lng: east / (METRES_PER_DEGREE * COS_SPECIMEN),
  t,
});

const CASES: {
  label: string;
  note: string;
  track: Track;
  distanceM: number | null;
  durationMin: number | null;
}[] = [
  {
    label: "A loop",
    note: "The mock's first specimen. Start is a 9px ring, end a 4px disc — they differ by SHAPE, so desaturate the page and the pair must still be tellable apart. The ends do not meet, because the trim moved them: 150m off each end, which is why the loop test is 2 × TRIM_METRES and not the receiver's accuracy.",
    track: [
      [
        at(0, 0, 0),
        at(600, 300, 600),
        at(900, -200, 1200),
        at(300, -400, 1700),
        at(0, 60, 2040),
      ],
    ],
    distanceM: 3200,
    durationMin: 34,
  },
  {
    label: "Point to point, with a recording gap",
    note: "The mock's second specimen. TWO polylines and nothing between them — no dashed chord, because that would draw a path nobody walked. Both segments share ONE fit, so the hole keeps its real proportion; the words beneath name the six minutes.",
    track: [
      [at(0, 0, 0), at(2000, 400, 1200)],
      [at(3000, 900, 1560), at(5800, 1400, 3660)],
    ],
    distanceM: 5800,
    durationMin: 61,
  },
  {
    label: "A square block",
    note: "The projection check, and the reason this page is not built at the equator. Four sides of 400m: it must draw SQUARE. Without the cosine correction it draws about 1.59 times wider than tall at this latitude — a rectangle, silently, with nothing on screen to say the shape had been changed.",
    track: [
      [at(0, 0, 0), at(400, 0, 300), at(400, 400, 600), at(0, 400, 900), at(0, 0, 1200)],
    ],
    distanceM: 1600,
    durationMin: 18,
  },
  {
    label: "Two points",
    note: "A criterion case. A straight line across the box, with the ring at one end and the disc at the other — not a broken box, not an empty one. This is what a walk down one road stores after the cap has thinned it to its two ends.",
    track: [[at(0, 0, 0), at(900, 600, 720)]],
    distanceM: 1400,
    durationMin: 12,
  },
  {
    label: "Due north",
    note: "One axis has no extent at all. The height governs the fit and the line stands in the middle of an empty width — the case that divides by zero if the fit takes a span without checking it.",
    track: [[at(0, 0, 0), at(0, 500, 300), at(0, 900, 600)]],
    distanceM: 950,
    durationMin: 10,
  },
  {
    label: "One point",
    note: "No polyline — a line needs two ends — so what draws is the ring and the disc on top of each other in the middle of the box. Deliberate rather than broken, and it says what it is: a walk the receiver saw once. There is no shape word, because a walk that went nowhere is not a loop.",
    track: [[at(0, 0, 0)]],
    distanceM: null,
    durationMin: 4,
  },
  {
    label: "A receiver that never moved",
    note: "Several fixes, all in one spot. Same drawing as the case above and the same reason — but this one reaches it through a zero span on BOTH axes rather than through a single point, which is the branch that returns Infinity if the guard is missing.",
    track: [[at(0, 0, 0), at(0, 0, 60), at(0, 0, 120)]],
    distanceM: null,
    durationMin: 3,
  },
  {
    label: "A stray one-point segment",
    note: "The receiver came back for one fix and lost the signal again. That segment paints nothing, so it is dropped rather than emitted as an empty polyline — and the segment COUNT beneath says one, because the count describes the picture rather than the array.",
    track: [
      [at(0, 0, 0), at(700, 200, 480)],
      [at(1400, 500, 1500)],
    ],
    distanceM: 1500,
    durationMin: 16,
  },
  {
    label: "No route at all",
    note: "The last criterion case, and the most important: NOTHING renders. Not an empty box, not a placeholder, not a disabled control — § The Route Trace's “a walk with no route draws nothing”. The row never opens a sheet for one, so this is the second half of that rule rather than a fallback anything relies on.",
    track: [],
    distanceM: null,
    durationMin: 20,
  },
];

/** The widths the sheet's column actually takes — § The Route Trace names both. */
const WIDTHS = [331, 596] as const;

const SCALE_FIXTURE = CASES[0]!.track;

export default function RouteTraceSpecimen() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10 md:px-7"
    >
      <header className="flex flex-col gap-[14px]">
        <h1 className="text-title">Route trace</h1>
        <p className="text-body text-text-secondary">
          FUEL-102, rendered. The cases below are the ones neither suite can see:
          the demo fixture is always populated and jsdom applies no stylesheet, so
          a two-point walk, a one-point walk and a walk with no route are checked
          here or nowhere.
        </p>
        <p className="text-body text-text-secondary">
          What to look at. Every box is a fixed 3:2 and every walk is fitted to it
          on its own, so <b>the drawings are not comparable to each other</b> — the
          1.6km square and the 5.8km point-to-point both fill their frame, and the
          distance beneath is what carries the size. Desaturate the page: start and
          end differ by form, a ring against a disc, so the pair must survive it.
          Switch modes: the ink follows the theme and nothing else changes, there
          being no colour in this graphic at all. There is no draw-in, so reloading
          shows nothing new — the sheet is what animates, and a graphic arriving
          inside a container that is itself arriving would be two motions for one
          tap.
        </p>
        <ThemeToggle />
      </header>

      {/*
        The scaling rule, which is the one thing a single width cannot show.
        § The Route Trace: the geometry scales with the column and the ink does
        not — 2px at 375 in a 331px sheet, and 2px at 1272 in a 596px one. Both
        numbers are the section's own. Measure the stroke in each; measure the
        start ring in each. Neither may grow.
      */}
      <section className="flex flex-col gap-[14px]">
        <span className="flex flex-col gap-1">
          <span className="text-micro uppercase text-text-tertiary">
            One walk, both sheet columns
          </span>
          <span className="text-slash text-text-secondary">
            / The geometry scales and the ink does not. The stroke is 2px in both,
            and so is the ring — the marks are drawn in an unscaled layer over the
            box at percentage positions, which is the technique the mock&rsquo;s own
            comment says IS the prescription rather than an artefact of drawing it
            small.
          </span>
        </span>
        <div className="overflow-x-auto">
          <ul className="flex w-max flex-col gap-[22px]">
            {WIDTHS.map((width) => (
              <li key={width} className="flex flex-col gap-1">
                <span className="text-micro uppercase text-text-tertiary">
                  {width}px
                </span>
                <div style={{ width }}>
                  <RouteTrace
                    track={SCALE_FIXTURE}
                    walk="Morning Walk"
                    distanceM={3200}
                    durationMin={34}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ul className="flex flex-col gap-[30px]">
        {CASES.map(({ label, note, track, distanceM, durationMin }) => (
          <li key={label} className="flex flex-col gap-[14px]">
            <span className="flex flex-col gap-1">
              <span className="text-micro uppercase text-text-tertiary">{label}</span>
              <span className="text-slash text-text-secondary">/ {note}</span>
            </span>

            {/* At the phone's sheet column — 375 less § Sheets' 22px gutters —
                so the specimen is measured at the width the criterion names. */}
            <div className="flex w-full max-w-[331px] flex-col gap-[10px]">
              <RouteTrace
                track={track}
                walk="Morning Walk"
                distanceM={distanceM}
                durationMin={durationMin}
              />

              {/* The figures as the sheet draws them, so a case can be read
                  against its own words rather than against this file. */}
              <span className="flex flex-col gap-[2px]">
                <span className="text-value text-text-primary">
                  {distanceM === null ? "No distance" : kilometres(distanceM)}
                </span>
                <span className="text-slash text-text-secondary">
                  /{" "}
                  {[
                    durationMin === null ? null : `${durationMin} min`,
                    pace(distanceM, durationMin),
                    shapeWord(track) ?? "no shape word",
                    absences(track),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
