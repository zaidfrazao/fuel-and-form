import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * The Dot Grid — Brand Guide § Signature Graphics.
 *
 * Six weeks × seven days, one row per week, 11px dots on a 9px gutter. It shows
 * the pattern and refuses to grade it, which is the PRD's position on adherence:
 * divergence from plan is data rather than guilt. Lives on Training and Weight.
 *
 * Geometry transcribed from `docs/BRAND_GUIDE.html`, which the guide names as
 * the source of truth for appearance. One deliberate divergence, in `dotStyle`
 * below — read it before changing how `today` renders.
 *
 * No draw-in animation, for the same reason as the day ruler: the guide requires
 * any such motion to be dropped under `prefers-reduced-motion`, and having none
 * is the cheapest way to honour that.
 */

export type DayStatus = "done" | "skipped" | "walk" | "none";

export type Day = {
  /**
   * An ISO `YYYY-MM-DD` calendar date. It is both the identity of the day and
   * the thing `today` is matched against.
   *
   * A plain string rather than a `Date` so this component cannot be wrong about
   * a timezone or a DST boundary. Resolving what "today" is belongs to
   * `lib/resolve-plan.ts`, where the Testing Strategy already pins the DST cases
   * at 100% coverage; a graphic should not be a second place that can disagree
   * about what day it is. The day ruler took `now` as a plain number for exactly
   * this reason.
   */
  date: string;
  /** Shown in the data table only — `Circuit B`, `Walk`. Never on the graphic. */
  label?: string;
  status: DayStatus;
};

/** Up to seven days. Order does not matter; each is placed by its own date. */
export type Week = Day[];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Monday-first, matching the mock's `M T W T F S S` header. */
const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const STATUS_LABEL: Record<DayStatus, string> = {
  done: "Done",
  skipped: "Skipped",
  walk: "Walk only",
  none: "No session",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `1 week`, `6 weeks`. The summary is read aloud; "1 days" reads as a bug. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function parseISODate(date: string): Date {
  // Parsed at UTC, never in local time. `new Date("2026-08-11")` is already UTC
  // per spec, but the explicit suffix stops a future refactor to
  // `new Date(y, m, d)` — which is local — from silently shifting every dot by a
  // column for anyone west of Greenwich.
  const parsed = new Date(`${date}T00:00:00Z`);

  if (!ISO_DATE.test(date) || Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Not an ISO YYYY-MM-DD date: ${JSON.stringify(date)}`);
  }

  return parsed;
}

/**
 * `"2026-08-11"` → `1` (Tuesday). Monday is 0, matching the header row.
 *
 * Deriving the column from the date rather than from array position is what lets
 * a partial week sit under its real weekdays — the mock's own last row is exactly
 * that case, three days followed by four that have not happened yet. It also
 * makes the visible `M T W T F S S` header truthful rather than decorative.
 *
 * Throws on a malformed date, matching `parseClock` in day-ruler.tsx. A graphic
 * that silently draws a dot in the wrong column is worse than an error boundary:
 * the whole point of it is that the pattern can be trusted at a glance.
 */
export function weekdayIndex(date: string): number {
  // getUTCDay is Sunday-first; shift so Monday leads.
  return (parseISODate(date).getUTCDay() + 6) % 7;
}

/** `"2026-08-11"` → `"11 August 2026"`. Not `Intl` — see the note below. */
function formatDate(date: string): string {
  const at = parseISODate(date);

  // Hand-formatted rather than via `Intl.DateTimeFormat`, whose output depends
  // on the runtime's locale and ICU build. This string goes into an aria-label
  // rendered on the server and reconciled on the client; a locale mismatch
  // between the two is a hydration error, and a CI box with a different ICU is a
  // flaky test. The app is single-locale, so there is nothing to lose here.
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * The dot, per Brand Guide § The Dot Grid — and the one place this component
 * knowingly departs from `docs/BRAND_GUIDE.html`.
 *
 * The mock's `.dot.today` is an accent *fill* applied instead of the status
 * class, so today's own done/skipped/walk status is discarded. That breaks two
 * rules the guide states as absolutes — § Accessibility's "never colour alone",
 * and its own line that the dot grid encodes status "as solid / ring / size" and
 * survives greyscale. Desaturate the mock and today-done and today-skipped are
 * the same mid-grey disc.
 *
 * So `today` here is a change of tone, not of state: the dot keeps its geometry —
 * filled, ringed, or small — and only swaps its ink to `accent` and gains the 3px
 * halo. The mock's own fixture has today on a completed day, where this renders
 * pixel-identically; every other combination now stays legible with colour
 * removed. Both the criterion and the picture hold.
 *
 * Colours go through inline `var(--token)` rather than Tailwind arbitrary values
 * because a multi-part `box-shadow` inside `shadow-[…]` needs every space
 * underscore-escaped and fails *silently* when it does not — a missing ring, not
 * a build error. day-ruler.tsx made the same call for its hatch. No hex appears
 * outside the token layer either way, which `globals.tokens.test.ts` enforces.
 */
function dotStyle(status: DayStatus, isToday: boolean): CSSProperties {
  const ink = isToday ? "var(--accent)" : undefined;
  const small = status === "walk" || status === "none";

  const shadows = [
    status === "skipped" &&
      `inset 0 0 0 1.5px ${ink ?? "var(--text-tertiary)"}`,
    isToday && "0 0 0 3px var(--accent-subtle)",
  ].filter(Boolean);

  return {
    width: small ? 4 : 11,
    height: small ? 4 : 11,
    // Skipped is a ring with no fill — the absence of the fill is half the
    // signal, and filling it would make a skipped day read as a done one.
    backgroundColor:
      status === "skipped"
        ? undefined
        : (ink ??
          (status === "done"
            ? "var(--text-primary)"
            : status === "walk"
              ? "var(--text-tertiary)"
              : "var(--border)")),
    boxShadow: shadows.length ? shadows.join(", ") : undefined,
  };
}

/**
 * Places each week's days under their true weekday, leaving gaps where a day is
 * absent. A duplicate weekday within one week keeps the first day given rather
 * than silently overwriting it — losing a dot is worse than ignoring one.
 */
function layOut(weeks: Week[]): (Day | undefined)[][] {
  return weeks.map((week) => {
    const row: (Day | undefined)[] = Array.from({ length: 7 });

    for (const day of week) {
      const column = weekdayIndex(day.date);

      row[column] ??= day;
    }

    return row;
  });
}

/**
 * Summarises the *laid-out* rows rather than the incoming weeks, so the sentence
 * a screen reader hears counts exactly the dots that were drawn. Summarising the
 * raw input would let a day that `layOut` dropped still be tallied here — the
 * graphic and its own description disagreeing is the specific failure the
 * adjacent data table exists to prevent.
 */
function summarise(rows: (Day | undefined)[][], today?: string): string {
  const days = rows.flat().filter((day) => day !== undefined);

  const dates = days.map((day) => day.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  // Narrows for `noUncheckedIndexedAccess` as well as reading as the empty
  // case, which is a real one: Training renders before the first session.
  if (first === undefined || last === undefined) {
    return "Training adherence. No days recorded.";
  }

  const counts = days.reduce<Partial<Record<DayStatus, number>>>(
    (tally, day) => ({ ...tally, [day.status]: (tally[day.status] ?? 0) + 1 }),
    {},
  );

  const tallied = (["done", "skipped", "walk", "none"] as const)
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${STATUS_LABEL[status].toLowerCase()}`)
    .join(", ");

  const current = days.find((day) => day.date === today);

  // Reports; never grades. No percentage, no streak, no adjective — the PRD
  // wants adherence visible without a score, and Brand Guide § Tone of Voice
  // has the app as a neutral instrument.
  return [
    `Training adherence, ${plural(rows.length, "week")},`,
    `${formatDate(first)} to ${formatDate(last)}.`,
    `${plural(days.length, "day")}: ${tallied}.`,
    current ? `Today ${formatDate(current.date)}, ${STATUS_LABEL[current.status].toLowerCase()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function DotGrid({
  weeks,
  today,
  className,
}: {
  /** One array per week, oldest first. Up to seven days each. */
  weeks: Week[];
  /**
   * An ISO `YYYY-MM-DD` date, matched against `Day.date` by string equality —
   * which cannot be wrong about a timezone the way a `Date` comparison can.
   *
   * Optional, and simply absent from the graphic when it falls outside the
   * weeks shown: a six-week window being reviewed after the fact has no today in
   * it, and accenting an edge would assert a present moment that isn't one. The
   * day ruler omits its NOW marker on the same grounds.
   */
  today?: string;
  className?: string;
}) {
  const rows = layOut(weeks);

  return (
    <div className={cn("flex max-w-[240px] flex-col gap-[10px]", className)}>
      <div
        role="img"
        aria-label={summarise(rows, today)}
        className="flex flex-col gap-[10px]"
      >
        {/* The header is text inside a role="img", which ARIA already makes
            presentational — but that relies on the browser pruning it, and
            Chrome still lists it. Hidden explicitly so no screen reader reads
            "M T W T F S S" after a summary that has already said it better.
            day-ruler.tsx hit this with its 06 · 12 · 18 · 22 scale. */}
        <div aria-hidden className="grid grid-cols-7 gap-[9px]">
          {/* Keyed on the full weekday because two of the seven initials
              repeat — T and S each appear twice. */}
          {WEEKDAYS.map((weekday) => (
            <span
              key={weekday}
              className="text-center text-[0.59375rem] leading-none font-semibold tracking-[0.08em] text-text-tertiary uppercase"
            >
              {weekday[0]}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-[9px]">
          {rows.map((row, week) =>
            row.map((day, column) => (
              // A fixed 11px cell that centres its dot, rather than letting the
              // dot size the row. The mock relies on an 11px sibling to give
              // each row its height, so a week of nothing but 4px walk dots
              // would collapse to a 4px row and break the grid's rhythm — a
              // wholly ordinary week in a plan with weekend walks.
              <span
                key={`${week}-${column}`}
                className="grid h-[11px] place-items-center"
              >
                {day && (
                  <span
                    className="rounded-full"
                    style={dotStyle(day.status, day.date === today)}
                  />
                )}
              </span>
            )),
          )}
        </div>
      </div>

      {/* Brand Guide § Accessibility — each signature graphic carries an
          accessible summary *plus* an adjacent data table, because "a mark on a
          screen is not the data". Built from the same rows as the dots, so the
          two cannot drift.

          The wrapper is load-bearing. `sr-only` hides an element by shrinking it
          to 1px and clipping, but a `display: table` box treats that width as a
          suggestion and lays out at its natural width — which day-ruler.tsx
          records pushing the page into horizontal scroll at 200% zoom, against
          the guide's Dynamic Type rule. A block wrapper honours the 1px and
          clips the table inside it, and the table keeps its semantics. */}
      <div className="sr-only">
        <table>
          <caption>Training adherence by day</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              {WEEKDAYS.map((weekday) => (
                <th key={weekday} scope="col">
                  {weekday}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, week) => {
              const [earliest] = row
                .filter((day) => day !== undefined)
                .map((day) => day.date)
                .sort();

              return (
                <tr key={week}>
                  <th scope="row">
                    {earliest
                      ? `Week of ${formatDate(earliest)}`
                      : "Empty week"}
                  </th>
                  {row.map((day, column) => (
                    <td key={column}>
                      {day
                        ? [
                            STATUS_LABEL[day.status],
                            day.label,
                            day.date === today ? "today" : undefined,
                          ]
                            .filter(Boolean)
                            .join(", ")
                        : "No day"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
