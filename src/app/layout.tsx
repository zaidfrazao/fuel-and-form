import type { Metadata, Viewport } from "next";

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
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
