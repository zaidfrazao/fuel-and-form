"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { HOVER_FILL, HOVER_GROUND, POINTER } from "@/lib/pointer";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
] as const;

/** Never changes, so it never notifies — the snapshot pair does the work. */
const noSubscribe = () => () => {};

/**
 * The manual appearance override. `theme` is the stored preference — "system"
 * included — which is what this control edits; `resolvedTheme` is what that
 * currently evaluates to, and is not what a settings control should display.
 *
 * The store is next-themes' `localStorage["theme"]`. When account settings land
 * this becomes a server-persisted field and only the read/write moves; the
 * control itself is final.
 *
 * Rule 3 — actions are ink, not colour. The active segment is an ink fill, not
 * an accent one: accent means "now" and nothing else.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // The preference lives in localStorage, so the server render cannot know it.
  // The two snapshots differ — false on the server, true in the browser — which
  // is precisely how React is told to re-render this after hydration without a
  // mismatch. The group renders unselected for that one frame; the markup is
  // identical either way, so nothing shifts.
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  return (
    <div
      role="group"
      aria-label="Appearance"
      aria-busy={!mounted}
      className="inline-flex gap-1 rounded-full border border-border p-1"
    >
      {OPTIONS.map((option) => {
        const active = mounted && theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              // 44px minimum touch target, per the Brand Guide and WCAG.
              `min-h-11 min-w-11 rounded-full px-4 text-micro uppercase ${POINTER}`,
              "transition-colors duration-150 ease-out",
              // Focus: 2px accent ring, 2px offset, never removed.
              "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              // Brand Guide § Desktop. This was the eighth of the app's
              // pre-§ Desktop `hover:` declarations and the only one that
              // reached for a colour rather than a ground — a ninth convention
              // in a file nobody outside `/dev/*` renders. It answers like
              // every other segmented control now: nothing rests as nothing and
              // gains `surface`, a solid fill goes to that fill at 90%.
              active
                ? `bg-ink text-ink-fg ${HOVER_FILL}`
                : `text-text-secondary ${HOVER_GROUND} hover:text-text-primary`,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
