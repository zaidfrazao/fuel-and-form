import type { Metadata, Viewport } from "next";

import { DemoBanner } from "@/components/demo-banner";
import { ThemeProvider } from "@/components/theme-provider";
import { WalkReminder } from "@/components/walk-reminder";

import "./globals.css";

export const metadata: Metadata = {
  title: "Fuel & Form",
  description:
    "A personal fitness & nutrition tracker: meal planning with swaps, workout scheduling, and weekly check-in exports.",
};

// The PRD targets the phone first, so the viewport is fixed here rather than
// left to Next's default.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Both modes are supported, so native UI — form controls, scrollbars — is
  // told as much in the static HTML. next-themes narrows this to the resolved
  // mode at runtime; this covers the paint before its script has run.
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required, not defensive: next-themes' inline
    // script sets `class` and `style` on <html> before React hydrates, and
    // without this React would discard the correction and flash the wrong mode.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {/*
           * P7's "persistent" banner — every screen, which is what makes the
           * layout the right place for it and the five pages the wrong one.
           * Renders nothing at all unless the session is a demo, so the owner's
           * app is untouched: see components/demo-banner.tsx.
           *
           * ABOVE `children` and in normal flow rather than fixed, so it pushes
           * the page down instead of covering it. The pages are `min-h-dvh`, so
           * on a demo session `/` gains the banner's height in scroll — the one
           * cost of this placement, paid only by demo visitors, and reclaimable
           * by the dismiss button. Fixing it to the bottom of the viewport would
           * put it over `/`'s action bar, which is worse: that bar is the thumb
           * target the whole screen is arranged around.
           */}
          <DemoBanner />

          {/*
           * P9's evening nudge — FUEL-46. Every screen, for the reason above,
           * and BELOW the demo banner when a demo session shows both: the demo
           * banner is a fact about the whole session and this one is a fact
           * about today, so the wider statement reads first.
           *
           * Renders nothing at all until the reminder time, and nothing ever for
           * a user who has switched it off or already logged the walk — see
           * components/walk-reminder.tsx.
           */}
          <WalkReminder />

          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
