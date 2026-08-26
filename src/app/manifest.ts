import type { MetadataRoute } from "next";

/**
 * The web app manifest — FUEL-47, PRD § P9.
 *
 * Here for one reason, and it is worth being honest about which: iOS delivers a
 * web push only to a site that has been added to the Home Screen, and a site is
 * installable only with a manifest. Without this file P9's second layer is
 * unreachable on the platform this app is actually used on, and the criterion
 * "subscribe from settings" would be a control that never works.
 *
 * It is NOT an offline layer. The PRD lists "offline support / PWA install —
 * service worker caching for the kitchen" under Nice-to-Have, deferred, and
 * `lib/service-worker.js` deliberately caches nothing. Installability and
 * offline support are separate things that usually arrive together; only the
 * first is claimed here.
 *
 * ## The icon is the walk mark on an ink tile
 *
 * `components/motifs.tsx`'s `walk`, on `ink` — the Brand Guide's own material,
 * rather than a new piece of artwork the guide has no rule for. § Motifs gives
 * eight marks and says they "cover the entire library"; § Component Patterns
 * gives ink tiles. This is those two, and nothing invented.
 *
 * The walk rather than a food mark, though this is a nutrition tracker as much
 * as a training one, for two reasons. It is the one motif that is not about a
 * specific meal, so it does not put breakfast on the home screen of an app that
 * plans four slots. And it reads as a line rising between two points, which is
 * the same shape as the weight chart's trend — the figure P5 calls "the single
 * number the whole program is judged on".
 *
 * Two sizes and no more. 192 and 512 are what Chrome's install criteria ask for
 * and what iOS scales from; a fuller set is a favicon generator's output, and
 * every extra file is another thing to redraw when the mark changes.
 *
 * `purpose: "maskable"` alongside the plain one, from the same files: Android
 * crops an icon to whatever shape the launcher uses, and the mark sits inside
 * the central 56% of the tile precisely so that crop cannot reach it. Declaring
 * only `maskable` would leave iOS padding an already-padded icon; declaring only
 * `any` leaves Android drawing a white plate behind a full-bleed square.
 *
 * ## `display: "standalone"` and `start_url: "/"`
 *
 * Standalone because the thing being installed is a kitchen and gym tool used
 * one-handed, and a browser chrome bar costs it a row of screen for a URL nobody
 * needs. `/` because that is the screen the app exists for — the same
 * destination the reminder banner and the notification both point at, so all
 * three ways in agree.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fuel & Form",
    // The Home Screen label. Two words is already at the limit of what iOS
    // shows without an ellipsis, so this is the full name rather than a
    // shortening that would only ever be truncated differently.
    short_name: "Fuel & Form",
    description:
      "Meal planning with swaps, workout scheduling, and weekly check-in exports.",
    start_url: "/",
    display: "standalone",
    // The canvas and the ink, § Color Palette. `background_color` is the splash
    // screen while the app starts; `theme_color` is the system bar around it.
    background_color: "#FFFFFF",
    theme_color: "#1C1917",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
