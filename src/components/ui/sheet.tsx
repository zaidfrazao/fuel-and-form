"use client";

import { type ReactNode, useRef } from "react";
import { Dialog } from "radix-ui";

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
 * ## Presentation
 *
 * § Animation & Motion: sheets are Normal (250ms) on the entrance curve. Under
 * `prefers-reduced-motion: reduce` the guide asks for a 100ms cross-fade, which
 * is the `motion-reduce:` pair below — the slide distance goes to zero and the
 * duration drops, leaving the opacity change on its own.
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
            // `max-w` with `mx-auto` so the sheet stops at the guide's 640px
            // single-column measure instead of stretching across a desktop.
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[640px] flex-col gap-5",
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
              does not exist. */}
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
      </Dialog.Portal>
    </Dialog.Root>
  );
}
