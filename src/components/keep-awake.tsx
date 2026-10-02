"use client";

import { useEffect, useRef } from "react";

import { hold, release } from "@/lib/wake-lock";

/**
 * Keeps the screen on for as long as it is mounted — Brand Guide § Recipe
 * (FUEL-145).
 *
 * Cooking from a phone means messy hands and a screen that locks partway
 * through a step, so `/recipe/[mealId]` holds the lock for as long as it is
 * open. There is no control and nothing on screen: unlike a walk, which states
 * its battery cost because it asks to hold the lock in a pocket, a recipe only
 * holds it while it is the page in front of you — the platform drops it the
 * moment the tab is hidden, and this lets it go on navigate-away. A browser
 * without the API, or one that refuses, is the same screen with the platform's
 * own timeout, and says nothing about it.
 *
 * The lock is `lib/wake-lock.ts`'s, which carries the two guards and the reason
 * for both. What it leaves to its callers is done here: re-requesting on
 * `visibilitychange` and on `pageshow` — a phone back from the bfcache after an
 * hour in another app fires only the second — and clearing `wanted` BEFORE the
 * release, so a grant still in flight when the page is left is let go rather
 * than filed.
 *
 * A component rather than a line in `RecipePrep`, which re-renders on every
 * tick and whose job is the ticks; mounted by the route rather than by
 * `RecipeView`, so `/dev/recipe`'s specimens do not take a lock.
 */
export function KeepAwake() {
  const lock = useRef<WakeLockSentinel | null>(null);
  const wanted = useRef(false);

  useEffect(() => {
    wanted.current = true;
    void hold(lock, wanted);

    const restore = () => {
      if (document.visibilityState !== "visible") return;

      void hold(lock, wanted);
    };

    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", restore);

    return () => {
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", restore);
      // Before the release — see `lib/wake-lock.ts`.
      wanted.current = false;
      release(lock);
    };
  }, []);

  return null;
}
