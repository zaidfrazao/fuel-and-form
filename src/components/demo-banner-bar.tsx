"use client";

import { XIcon } from "lucide-react";
import { useOptimistic } from "react";

import { dismissDemoBanner } from "@/app/actions/demo-banner";
import { Button } from "@/components/ui/button";
import { BANNER_COPY, REPOSITORY_URL } from "@/lib/demo-banner";

/**
 * The banner itself — FUEL-42, PRD § P7, Brand Guide § UI Copy.
 *
 * Split from `demo-banner.tsx` because only the dismissal needs to be a client
 * component: the sentence, the link and the decision to show any of it are all
 * server-side, which is what keeps the banner out of the first paint rather than
 * removing it after one. This file is the button and the frame around it.
 *
 * ## What it looks like, and what it may not
 *
 * § Color Palette reserves `accent` for "now" — the NOW marker, today's dot, the
 * latest reading — so a banner may not use it, however much a tinted strip is
 * the conventional way to draw one. `surface` is spoken for too: exactly two
 * uses, stone tiles and the chart's plot area, "nothing else outside sheets".
 *
 * What is left is the material language the rest of the app is built from: the
 * canvas, a hairline underneath, and `/ `-scale secondary text. That is not a
 * compromise — a banner that shouted would be competing with the one dominant
 * card `/` exists to show, on the session type where the app has sixty seconds
 * to look like a real product.
 *
 * The container's width and padding match every page's `main`, so the sentence
 * lines up with the content beneath it instead of floating over a wider band.
 *
 * ## The dismiss control is an icon with no visible label
 *
 * § Deliberately Absent forbids "icons that repeat their own label" — an icon
 * BESIDE the word it duplicates. A bare X carrying `aria-label="Dismiss"` is the
 * opposite case: one control, named once, for screen readers and pointer users
 * alike. At 44px it clears the touch target the guide sets for every action.
 */
export function DemoBannerBar() {
  /**
   * Hidden on the frame the button is pressed, and honest afterwards.
   *
   * `useOptimistic` rather than `useState`, because the two differ exactly where
   * it matters. A `useState(true)` would hide the banner permanently even when
   * the cookie was never written — a dropped connection, a cold start that timed
   * out — and the visitor would find it back on the next navigation with no idea
   * why. This value resets when the server's render arrives: if the dismissal
   * landed, the server renders no banner at all and there is nothing to reset;
   * if it did not, the banner comes back immediately, which is the truth.
   */
  const [dismissed, hide] = useOptimistic(false, () => true);

  if (dismissed) return null;

  return (
    // `aside` rather than a bare div: this is genuinely tangential to the page
    // it sits above, and the landmark lets a screen-reader user skip it once
    // per screen rather than hearing it before every one.
    <aside aria-label="Demo session" className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3 px-[22px] py-1.5 md:px-7">
        <p className="text-slash text-text-secondary">
          {BANNER_COPY.statement}{" "}
          {/*
           * A new tab, so reading the source does not end the demo. Two hours
           * is the session's whole life and a visitor who navigated away would
           * come back to a page they have to start again.
           *
           * `rel="noreferrer"` covers `noopener` in every browser that supports
           * it, and both matter for a link this page does not control the
           * destination of.
           */}
          <a
            className="text-text-primary underline decoration-text-tertiary underline-offset-4"
            href={REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            {BANNER_COPY.link}
          </a>
        </p>

        {/*
         * A form, so the button works with no JavaScript running — the action
         * writes the cookie and calls `refresh()`, and the banner is gone on the
         * render that follows. React wraps a form action in a transition of its
         * own, which is what lets `hide()` be called here rather than inside a
         * `startTransition` of ours.
         */}
        <form
          action={async () => {
            hide(true);

            // The `try` covers the CALL, not the action: `dismissDemoBanner`
            // catches everything itself, but reaching it is a network request
            // that can fail on its own — no signal, a dropped connection, a
            // cold start that times out. Those reject, and an escaping
            // rejection would be an unhandled error from a decorative button.
            // Swallowed, the transition simply ends and the optimistic hide
            // resets, which puts the banner back — the honest outcome, since
            // no cookie was written. `walk-row.tsx` carries the same wrapper.
            try {
              await dismissDemoBanner();
            } catch {
              // Nothing to report: the banner returning IS the report.
            }
          }}
        >
          <Button aria-label="Dismiss" size="icon-xs" type="submit" variant="ghost">
            <XIcon />
          </Button>
        </form>
      </div>
    </aside>
  );
}
