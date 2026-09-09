"use client";

import { startTransition, useState, useSyncExternalStore } from "react";

import { nameRoute } from "@/app/actions/walk-route";
import { KeyValueGrid, type KeyValueItem, SlashMeta } from "@/components/kv-grid";
import { RouteTrace } from "@/components/route-trace";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { CalendarDate } from "@/lib/date";
import type { WalkRouteView } from "@/lib/db/queries/route";
import { MAX_ROUTE_NAME } from "@/lib/route";
import { absences, geoUri, kilometres, pace, startCoordinate } from "@/lib/route-trace";

/**
 * What was that walk — Brand Guide § Data Display → The Route Trace, FUEL-102.
 *
 * The sheet a logged walk's figures open. § Progressive Disclosure's test is
 * that what opens is a single question, and this one is *what was that walk*:
 * the shape, the figures, the route's name, and the way out to a map. It is
 * that section's fourth case, added the way the third was — a new question gets
 * the shape the guide already has, because a modal, an accordion and a tab are
 * each refused by name.
 *
 * § Sheets holds it to the measure's column at every width, so this component
 * states no width of its own, and § Desktop's existing ruling covers ≥1272
 * without amendment.
 *
 * ## The geometry arrives when the sheet does, and the ROW is what fetches it
 *
 * `walk_routes` is out of every list query by design, so the trace is fetched
 * on open rather than shipped with the page — `actions/walk-route.ts` sets out
 * why that is a storage rule holding rather than a round trip nobody needed.
 *
 * The fetch is started by the tap, in `walk-row.tsx`, and this component is
 * handed the outcome. That is not only lint-appeasing: opening the sheet and
 * asking for the route are ONE user action, and an effect that re-fetched
 * whenever `open` went true would be re-deriving the trigger from the state it
 * produced. It also keeps this file in the shape every other screen here has —
 * data resolved outside the thing that draws it.
 *
 * The waiting state is a Slash line rather than a skeleton: a skeleton of this
 * graphic would be a grey 3:2 box, which is a plate, and § The Route Trace
 * refuses one even when it is real.
 */
/** What the sheet is holding, or why it is not. */
export type RouteLoad =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "loaded"; route: WalkRouteView };

export function WalkSheet({
  open,
  onOpenChange,
  date,
  entryId,
  name,
  durationMin,
  distanceM,
  load,
  onRetry,
  onNamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: CalendarDate;
  entryId: string;
  /** The WALK's name — "Morning Walk". Never the route's. */
  name: string;
  durationMin: number | null;
  distanceM: number | null;
  load: RouteLoad;
  onRetry: () => void;
  onNamed: (name: string | null) => void;
}) {
  const route = load.state === "loaded" ? load.route : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={name}>
      <div className="flex flex-col gap-5">
        {route ? (
          <RouteTrace
            track={route.points}
            walk={name}
            distanceM={distanceM}
            durationMin={durationMin}
          />
        ) : (
          <SlashMeta>
            {load.state === "failed" ? "No route to draw." : "Loading the route…"}
          </SlashMeta>
        )}

        {/*
          The drawing's absences, in words — § The Route Trace's gap rule. "The
          segments simply stop and start, and the summary beneath names the
          absence in words." Nothing is drawn for the ordinary unbroken walk,
          because a line reading "1 segment" would be the app narrating a normal
          state.
        */}
        {route && absences(route.points) !== null && (
          <SlashMeta>{absences(route.points)}</SlashMeta>
        )}

        {/*
          The data table § Accessibility asks a graphic for — and for a route it
          is the walk's FIGURES, which is a ruling rather than a shortcut.
          "Nobody can read a list of latitudes; it is not what any reader came
          for; and it would write the trace into the accessibility tree, which
          is the one surface PRD § P11's storage rules do not otherwise reach."

          Visible rather than `sr-only`, unlike the chart's: these are the
          figures every reader came for, and the key/value grid § Component
          Patterns already carries is what draws them, with nothing invented.
        */}
        <KeyValueGrid items={figures(distanceM, durationMin, route?.name ?? null)} />

        {route && (
          <RouteName date={date} entryId={entryId} route={route} onNamed={onNamed} />
        )}

        {route && <MapHandOff route={route} />}

        {load.state === "failed" && (
          <div role="alert" className="flex items-center justify-between gap-3">
            {/* § Tone of Voice: name what happened. Never "Something went wrong". */}
            <p className="text-slash text-error">Couldn’t load the route.</p>
            <Button variant="link" size="xs" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Distance, duration, pace and the route's name.
 *
 * § The Route Trace names exactly these, plus "the step estimate and its
 * source" — which is FUEL-103's and is deliberately absent rather than
 * stubbed. A column reading "—" would be this screen promising a figure the
 * app cannot yet produce.
 *
 * A figure the walk does not have is DROPPED rather than drawn empty, which is
 * § P11's "absent rather than zeroed" applied to a grid: a one-tap walk shows a
 * duration and nothing else, and the reader is not asked to interpret three
 * dashes.
 */
function figures(
  distanceM: number | null,
  durationMin: number | null,
  routeName: string | null,
): KeyValueItem[] {
  const items: KeyValueItem[] = [];

  if (distanceM !== null) items.push({ label: "Distance", value: kilometres(distanceM) });
  if (durationMin !== null) items.push({ label: "Duration", value: `${durationMin} min` });

  const perKm = pace(distanceM, durationMin);

  if (perKm !== null) items.push({ label: "Pace", value: perKm });
  if (routeName !== null) items.push({ label: "Route", value: routeName });

  return items;
}

/**
 * Naming a route, and being offered a name — PRD § P11, FUEL-102.
 *
 * "A route can be named; a later matching walk **offers** that name and never
 * applies it silently."
 *
 * The offer is the whole point of the control's shape. A match is drawn as a
 * question with the evidence beside it — how far apart the two walks began — so
 * the guess can be judged rather than trusted. Nothing here writes a name that
 * the reader did not press.
 */
function RouteName({
  date,
  entryId,
  route,
  onNamed,
}: {
  date: CalendarDate;
  entryId: string;
  route: WalkRouteView;
  onNamed: (name: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(route.name ?? "");
  const [failed, setFailed] = useState(false);

  const write = (value: string | null) => {
    setFailed(false);

    startTransition(async () => {
      // Applied to the sheet before the server answers, and reverted on a
      // refusal — the optimism every other control in this app is written with
      // (§ Feedback), and the reason the name appears in the grid on the tap.
      onNamed(value);
      setEditing(false);

      try {
        const result = await nameRoute({ date, entryId, name: value });

        if (!result.ok) {
          startTransition(() => {
            onNamed(route.name);
            setFailed(true);
          });
        }
      } catch {
        startTransition(() => {
          onNamed(route.name);
          setFailed(true);
        });
      }
    });
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-micro uppercase text-text-secondary" htmlFor="route-name">
          Name this route
        </label>
        <input
          id="route-name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          // The column's own bound, worn rather than restated — `route.ts`
          // holds the number and the action refuses anything past it.
          maxLength={MAX_ROUTE_NAME}
          className="min-h-[46px] rounded-md border border-border bg-transparent px-3 text-body text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="xs" onClick={() => write(draft.trim() || null)}>
            Save
          </Button>
          <Button
            variant="link"
            size="xs"
            onClick={() => {
              setDraft(route.name ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {route.suggestion && (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            The offer, with the evidence beside it. The distance between the two
            starts is shown because it is the only thing a reader can check the
            guess against — and because a suggestion that explains itself is one
            somebody can decline for a reason.
          */}
          <SlashMeta>
            {`Looks like ${route.suggestion.name} · started ${Math.round(
              route.suggestion.metresApart,
            )}m from it`}
          </SlashMeta>
          {/* Adjacent to the offer rather than pushed to the far edge. An
              `ml-auto` here reads fine in the row's 331px column and badly in
              the sheet's 596px one, where it leaves ~230px between a question
              and its answer — the "islands rather than a grid" fault § Desktop
              names when it measures the 2×2 macro grid at 584. */}
          <Button
            variant="secondary"
            size="xs"
            onClick={() => write(route.suggestion!.name)}
          >
            Use this name
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant={route.suggestion ? "link" : "secondary"}
          size="xs"
          onClick={() => setEditing(true)}
        >
          {route.name === null
            ? route.suggestion
              ? "Name it something else"
              : "Name this route"
            : "Rename"}
        </Button>

        {/* The way back from a name that was wrong. § Buttons gives the Text
            variant to the uncommon way back, which is what unnaming is. */}
        {route.name !== null && (
          <Button variant="link" size="xs" className="ml-auto" onClick={() => write(null)}>
            Remove name
          </Button>
        )}
      </div>

      {failed && (
        <p role="alert" className="text-slash text-error">
          Couldn’t save that name.
        </p>
      )}
    </div>
  );
}

/**
 * The way out to a map — PRD § P11, and the half that makes no-basemap
 * affordable.
 *
 * **This is not an integration.** No request is made, no key is held, no tile
 * is fetched, and nothing is loaded from another origin. The app hands a string
 * to the operating system and the OS decides what opens it, which is why no map
 * provider is named anywhere in this codebase. PRD § Integrations still reads
 * "None" and § P11 records why that survives.
 *
 * ## Two affordances, because a `geo:` link is not universal
 *
 * A phone resolves `geo:` to whatever map application it has. A desktop browser
 * has no handler at all, and a link that silently does nothing when clicked is
 * the "defined behaviour on desktop" criterion failed rather than met. So the
 * coordinate is ALWAYS rendered, as text somebody can read and copy, and the
 * link is added where the platform is likely to resolve it.
 *
 * The test is `pointer: coarse` and deliberately not a width. A phone in
 * landscape and a hybrid laptop both defeat a breakpoint, and § Desktop's bands
 * are about layout rather than about what an OS can open. Reading the pointer
 * is also the idiom this feature already uses one row up: `walk-row.tsx` asks
 * whether the browser can record before it offers to.
 *
 * The hybrid laptop — coarse pointer, no `geo:` handler — is why both are drawn
 * rather than one being swapped for the other. It gets a link that may do
 * nothing AND a coordinate it can copy, which is a worse guess with no dead
 * end behind it.
 *
 * ## The coordinate this shows is not a front door
 *
 * `trimEnds` removed the first 150 metres before the trace was stored (§ P11,
 * FUEL-100), so the most this hands over is a point a few minutes into a walk.
 * That is the trim's whole purpose, and it is what makes showing this at all a
 * reasonable thing to do — the number is deliberately NOT in the trace's
 * accessible name, where § The Route Trace refuses it, because that is a
 * surface the reader did not choose to look at.
 */
function MapHandOff({ route }: { route: WalkRouteView }) {
  const start = startCoordinate(route.points);
  const [copied, setCopied] = useState(false);

  // `useSyncExternalStore` rather than `useEffect`, so the server render and
  // the first client render agree: the server has no pointer and answers
  // false, and a mismatch here would be a hydration error on a sheet.
  const coarse = useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );

  if (!start) return null;

  const pair = `${start.lat}, ${start.lng}`;

  const copy = () => {
    // Best effort, and a failure is silent by design. The coordinate is already
    // on screen and selectable, so the button is a convenience over a thing
    // that already works — an error message about the clipboard would be the
    // app making more of the failure than the failure deserves. § P9's silent
    // degradation, at a much smaller scale.
    void navigator.clipboard
      ?.writeText(pair)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SlashMeta>{`Starts at ${pair}`}</SlashMeta>

      {/* The desktop's half of the hand-off. A `geo:` link is dead on a machine
          with no handler, so the coordinate itself is the affordance there —
          and it is drawn at every width rather than swapped in below one,
          because a pointer test cannot tell a hybrid laptop from a phone. */}
      <Button variant="link" size="xs" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>

      {coarse && (
        <Button variant="link" size="xs" className="ml-auto" asChild>
          <a
            href={geoUri(start)}
            // It leaves the app, so it says so. The arrow is the mark this
            // system uses for a link out (`form-media-sheet.tsx` underlines
            // its licence link for the same reason), and `rel` is habit rather
            // than need here: a `geo:` target has no opener to reach back
            // through, but the day this becomes an https link it would.
            rel="noreferrer noopener"
          >
            Open in Maps<span aria-hidden> ↗</span>
          </a>
        </Button>
      )}
    </div>
  );
}

/** The pointer can change under a hybrid — a mouse plugged into a tablet. */
function subscribeToPointer(listener: () => void): () => void {
  const query = window.matchMedia("(pointer: coarse)");

  query.addEventListener("change", listener);

  return () => query.removeEventListener("change", listener);
}
