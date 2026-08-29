"use client";

import { type ReactNode, useRef } from "react";
import { Dialog } from "radix-ui";

import { FRAME, FRAME_MEASURE } from "@/lib/frame";
import { cn } from "@/lib/utils";

/**
 * The bottom sheet — Brand Guide § Sheets.
 *
 * `raised` fill, 26px top radius, grabber, 22px gutters, and the only shadow in
 * the system. Geometry transcribed from `docs/BRAND_GUIDE.html`: `padding: 12px
 * 22px 26px`, a 20px stack gap, and a 36×5 grabber at half opacity.
 *
 * ## "No modals" and `aria-modal="true"`
 *
 * § Progressive Disclosure ends "No modals, no accordions, no tabs within a
 * screen", and § Sheets says a sheet "answers every question a modal would
 * have". Both are about the design vocabulary: the thing being refused is the
 * centred box that interrupts a screen, and a sheet is what replaces it.
 *
 * The ARIA layer is a different question with a different right answer. Radix's
 * `Dialog` is what supplies the focus trap, the Escape handler, the scroll lock,
 * the restore-focus-on-close and the accessible name — and a picker whose
 * content behind it is still reachable by Tab is not a design choice, it is a
 * keyboard user landing in a list they cannot see. So this renders
 * `role="dialog" aria-modal="true"` and is, visually, never a modal.
 *
 * ## At desktop it is still a sheet, and it stands in the measure's column
 *
 * § Desktop → Sheets, against a pointer: "A sheet stays a sheet, held to the
 * measure's column. It does not become a centred dialog, it does not take a
 * width of its own, and it does not span the frame." The grabber stays drawn —
 * "a hybrid laptop still has the thumb, and it is the mark that says the panel
 * is dismissible at all" — the radius stays on the top two corners, and
 * `--shadow-sheet` keeps aiming upward because the panel still rises from the
 * bottom edge. `BRAND_GUIDE.html` draws it: `.sheet.dsheet { left: calc(var(
 * --rail) + var(--gutter)); right: auto; width: var(--measure) }`.
 *
 * What was wrong was the x. `mx-auto` inside a `fixed inset-x-0` box centres on
 * the VIEWPORT, and above 1024px the measure is not viewport-centred — it is the
 * frame's second column, whose centre sits 68px to the left of the viewport's at
 * the frame's cap and drifts by a different amount at every width below it. So
 * the sheet opened from a control at one x and arrived at another.
 *
 * ## Why the frame is worn rather than computed
 *
 * The arithmetic is available — `left: calc(max(0px, (100vw - 1272px) / 2) +
 * 248px)` is the same number — and it is the wrong way to get it twice over.
 * It would be a fourth statement of a grid that `globals.css` declares once
 * precisely so that "two independent centrings can disagree, two readers of one
 * template cannot", which is the fault FUEL-70 exists to have ended. And it
 * would be wrong in the real case regardless: `100vw` counts the scrollbar that
 * the frame's own `mx-auto` does not.
 *
 * So the portal wears the grid instead, and lands on the measure by construction
 * rather than by agreement. `lib/frame.ts` gains a fourth reader.
 */

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The sheet's own name, shown in the topbar and used as the accessible name.
   *
   * Required, and one string for both jobs on purpose: a visible title that
   * disagrees with the announced one is the most common way a dialog ends up
   * labelled "Dialog" for a screen reader and something useful for everyone else.
   */
  title: string;
  /** The right-hand side of the topbar — a date, typically. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Sheet({ open, onOpenChange, title, meta, children, className }: SheetProps) {
  /**
   * Whatever had focus when the sheet opened, so it can be given it back.
   *
   * Radix restores focus to a `Dialog.Trigger`, and this sheet is controlled —
   * `open` comes from the caller, there is no trigger element for Radix to hold
   * a ref to. Its close handler therefore cancels the default restore and then
   * focuses `null`, which drops the user on `<body>`: for anyone on a keyboard,
   * closing the picker means losing their place and tabbing back through the
   * whole page. § Accessibility does not spell this case out, but "focus is
   * never removed" is plainly about not doing that.
   *
   * Captured in `onOpenAutoFocus` because that fires in the moment before Radix
   * moves focus into the sheet — `document.activeElement` is still the control
   * that opened it. An effect would be too late: child effects run before the
   * parent's, so focus is already inside the content by then.
   */
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-scrim",
            "data-[state=open]:animate-in data-[state=open]:fade-in",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out",
            "duration-[250ms] motion-reduce:duration-[100ms]",
          )}
        />

        {/*
         * The positioning layer: the viewport, minus whatever the scroll lock
         * took. It exists to be the body's content box rather than the viewport,
         * so that the frame inside it centres on exactly what the frame in
         * `(app)/layout.tsx` centres on.
         *
         * The two disagree without this, and only while a sheet is open, which
         * is the only time anyone could see it. Radix locks the page by hiding
         * the body's overflow and padding it by the scrollbar's width, so
         * `<main>` keeps its centre: the scrollbar leaves and an equal padding
         * takes its place. A `fixed` box is laid out against the viewport
         * instead, and the viewport is the one thing that got WIDER — so it
         * would centre ~7.5px to the right of the column it is supposed to be
         * standing in. `--removed-body-scroll-bar-size` is the width
         * react-remove-scroll took, published for this, and absent (hence the
         * `0px`) whenever there was no scrollbar to remove.
         *
         * `pointer-events-none` so that the transparent width either side of the
         * sheet is not a click target: a press there must reach the scrim and
         * dismiss, which is § Desktop's "clickable backdrop … at every width".
         * Radix disables pointer events on `<body>` for a modal dialog and would
         * cover this on its own; it is stated because this element is the reason
         * the question arises, and a later non-modal use would inherit the trap.
         */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 pr-[var(--removed-body-scroll-bar-size,0px)]">
          <div className={FRAME}>
            <Dialog.Content
              // Radix warns when a dialog has no description. This one is described
              // by its own contents — a grid of named tiles — and inventing a
              // sentence for a screen reader to read before them would be noise.
              aria-describedby={undefined}
              onOpenAutoFocus={() => {
                const active = document.activeElement;

                // `instanceof` rather than a cast: `activeElement` is typed `Element`
                // and is `<body>` whenever nothing is focused, which is not somewhere
                // to give focus back to — storing it would "restore" to exactly the
                // dead end this handler exists to avoid.
                opener.current =
                  active instanceof HTMLElement && active !== document.body ? active : null;
              }}
              onCloseAutoFocus={(event) => {
                const trigger = opener.current;

                // Only take the event over when there is somewhere to put focus.
                // `isConnected` because the opener may have been unmounted while
                // the sheet was up — a grid cell behind a re-render — and focusing
                // a detached node silently does nothing at all, which is the same
                // dead end by a longer route. Left alone, Radix's own handler runs
                // and lands on `<body>`, which is the honest last resort.
                if (!trigger?.isConnected) return;

                event.preventDefault();
                trigger.focus();
              }}
              className={cn(
                // The measure's column, and the whole of the desktop change. Below
                // `lg` `FRAME_MEASURE` is `mx-auto w-full max-w-[640px]` inside a
                // full-width fixed box, which is what this element already was —
                // so the phone is untouched, and its baselines are the control.
                FRAME_MEASURE,
                "pointer-events-auto flex max-h-[85dvh] flex-col gap-5",
                "overflow-y-auto rounded-t-xl bg-raised px-[22px] pt-3 text-text-primary shadow-sheet",
                // The home indicator sits below `bottom: 0`, so the guide's 26px
                // foot is added to the inset rather than replaced by it.
                "pb-[calc(26px+env(safe-area-inset-bottom))]",
                "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-bottom",
                "duration-[250ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
                "motion-reduce:duration-[100ms] motion-reduce:slide-in-from-bottom-0 motion-reduce:slide-out-to-bottom-0",
                className,
              )}
            >
              {/* Decorative. The sheet is dismissed by Escape or by the scrim, not
                  by dragging this — it is the affordance that says "this came from
                  the bottom edge", and announcing it would promise a gesture that
                  does not exist. § Desktop keeps it drawn at every width: a hybrid
                  laptop still has the thumb, and it is the mark that says the panel
                  is dismissible at all. */}
              <div
                aria-hidden="true"
                className="h-[5px] w-9 shrink-0 self-center rounded-full bg-text-tertiary opacity-50"
              />

              <div className="flex items-baseline justify-between gap-4">
                <Dialog.Title className="text-micro uppercase text-text-primary">
                  {title}
                </Dialog.Title>
                {meta !== undefined && (
                  <span className="text-micro uppercase text-text-secondary">{meta}</span>
                )}
              </div>

              {children}
            </Dialog.Content>
          </div>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
