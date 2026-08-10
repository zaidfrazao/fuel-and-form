import type { Metadata, Viewport } from "next";

import { ThemeProvider } from "@/components/theme-provider";

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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
