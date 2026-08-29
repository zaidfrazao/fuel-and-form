/**
 * The `/` loading state — Brand Guide § Feedback: "skeletons matching final
 * layout. **No spinner on `/` ever.**"
 *
 * Every block below is the size and position of the thing it stands in for in
 * `right-now.tsx`: the 10.5px eyebrow, the 40px title, the 41px ruler band, the
 * two-column macro grid, two up-next rows, and the action bar held at the foot
 * by the same `mt-auto`. Nothing shifts when the real content swaps in, which
 * is the only property a skeleton has that a spinner does not.
 *
 * ## No pulse
 *
 * § Animation & Motion lists what animates, and a placeholder is not on it —
 * "motion clarifies origin and is otherwise absent". A static block also has
 * nothing to guard under `prefers-reduced-motion`, which is the cheapest way to
 * honour the requirement.
 *
 * Marked `aria-hidden` beneath a live region that says the one useful thing.
 * A screen reader reading out a dozen empty boxes is worse than silence, and
 * the boxes are, literally, nothing.
 */

import { APP_ACTION_BAR } from "@/components/action-bar";
import { PageMain } from "@/components/page-main";

/** A placeholder block. `surface` is the stone fill, so it recedes in both modes. */
function Block({ className }: { className: string }) {
  return <div className={`rounded-sm bg-surface ${className}`} />;
}

export default function Loading() {
  return (
    <PageMain className="pt-[22px]">
      <p className="sr-only" role="status">
        Loading today&rsquo;s plan.
      </p>

      <div aria-hidden className="flex flex-col gap-[30px]">
        {/* Subject — eyebrow, 40px title, slash metadata. */}
        <div className="flex flex-col gap-1">
          <Block className="h-[10px] w-20" />
          <Block className="h-[41px] w-4/5" />
          <Block className="h-[13px] w-16" />
        </div>

        {/* The ruler's own band, to the pixel — see day-ruler.tsx. */}
        <Block className="mt-2 h-[41px] w-full" />

        {/* Macro grid: two columns, 22px row gap, 16px column gap. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-[22px]">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="flex flex-col gap-[3px]">
              <Block className="h-[10px] w-14" />
              <Block className="h-[26px] w-20" />
            </div>
          ))}
        </div>

        {/* Up next — eyebrow plus two 54px rows. */}
        <div className="flex flex-col gap-[14px]">
          <Block className="h-[10px] w-16" />
          {[0, 1].map((row) => (
            <div
              key={row}
              className="flex min-h-[54px] items-center justify-between border-b border-border py-3 last:border-b-0"
            >
              <Block className="h-[23px] w-40" />
              <Block className="h-[23px] w-12" />
            </div>
          ))}
        </div>
      </div>

      {/* The action bar, at the same 52px / 46px heights, the same 30px off the
          content above it and pinned the same way, so the primary does not move
          on swap-in. "Pinned the same way" used to be a claim about two class
          strings that happened to match — a skeleton pinned to 0 while the real
          bar cleared `--nav-shell-h` would put its primary 86px lower and the
          swap-in would jump. FUEL-83 made it the same string: `APP_ACTION_BAR`,
          which both take, so the two cannot disagree about the pinning or about
          the fade over the bar's top.

          FUEL-72 is what that mechanism was for. It unpinned the bar at ≥1024px
          — `lg:static` — and this skeleton needed the change as much as the real
          bar did, since a skeleton still pinned to the viewport while the bar it
          stands in for sat at the end of its column would jump by whatever the
          two were apart. Nothing was edited here to get that: the release is in
          the shared string, so the skeleton took it by taking the string. */}
      <div
        aria-hidden
        className={APP_ACTION_BAR}
      >
        <Block className="h-13 w-full rounded-md" />
        <div className="flex gap-3">
          <Block className="h-[2.875rem] flex-1 rounded-md" />
          <Block className="h-[2.875rem] flex-1 rounded-md" />
        </div>
      </div>
    </PageMain>
  );
}
